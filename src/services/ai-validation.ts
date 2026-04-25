import { openai } from '../config/openai';
import { supabaseAdmin } from '../config/supabase';
import { AIValidationResult, QuotePhoto, PhotoType } from '../types';

// Normalize license plate text for comparison
function normalizePlate(plate: string): string {
  return plate
    .toUpperCase()
    .replace(/[\s\-\.]/g, '')
    .replace(/[OÓ]/g, '0')
    .replace(/[IÍ]/g, '1')
    .replace(/[SŚ]/g, '5')
    .trim();
}

interface TokenTracker {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

function createTokenTracker(): TokenTracker {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}

function trackUsage(tracker: TokenTracker, usage: any) {
  if (!usage) return;
  tracker.promptTokens += usage.prompt_tokens || 0;
  tracker.completionTokens += usage.completion_tokens || 0;
  tracker.totalTokens += usage.total_tokens || 0;
  tracker.calls += 1;
}

// Run OCR on plate photo using OpenAI Vision
async function extractPlateText(imageUrl: string, tracker: TokenTracker): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a license plate OCR system. Extract ONLY the license plate text from the image. Return just the plate text, nothing else. If you cannot read the plate, return "UNREADABLE".',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' },
            },
            {
              type: 'text',
              text: 'Read the license plate number from this image. Return only the plate text.',
            },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0,
    });

    trackUsage(tracker, response.usage);
    return response.choices[0]?.message?.content?.trim() || 'UNREADABLE';
  } catch (error) {
    console.error('Plate OCR error:', error);
    return 'ERROR';
  }
}

// Analyze photo quality using OpenAI Vision
async function analyzePhotoQuality(imageUrl: string, photoType: string, tracker: TokenTracker): Promise<{
  score: number;
  issues: string[];
}> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a photo quality analyzer for auto insurance verification. Analyze the ${photoType} photo and return a JSON object with: 
          - "score": number from 0-100 (100 = perfect quality)
          - "issues": array of strings describing any quality issues found
          
          Check for: blur, low light, glare, poor framing, obstruction, and whether the image actually shows what it should (${photoType} of a vehicle).
          Return ONLY valid JSON, no other text.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' },
            },
            {
              type: 'text',
              text: `Analyze the quality of this ${photoType} photo for insurance verification.`,
            },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0,
    });

    trackUsage(tracker, response.usage);
    const content = response.choices[0]?.message?.content || '{"score": 50, "issues": ["Unable to analyze"]}';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('Photo quality analysis error:', error);
    return { score: 50, issues: ['Quality analysis failed'] };
  }
}

// Main AI validation function
export async function validateQuote(quoteId: string): Promise<AIValidationResult> {
  // Update quote AI status to processing
  await supabaseAdmin
    .from('quotes')
    .update({ ai_status: 'processing' })
    .eq('id', quoteId);

  try {
    // Fetch quote and photos
    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single();

    if (!quote) throw new Error('Quote not found');

    const { data: photos } = await supabaseAdmin
      .from('quote_photos')
      .select('*')
      .eq('quote_id', quoteId);

    if (!photos || photos.length === 0) throw new Error('No photos found');

    const flags: AIValidationResult['flags'] = [];
    const photoQuality: Record<string, number> = {};
    let plateOcrText = '';
    let plateMatch = true;
    let autoBlock = false;
    const tokenTracker = createTokenTracker();

    // 1. Check required photo set completeness
    const requiredTypes = ['plate', 'front', 'rear', 'left', 'right', 'license_front', 'license_back'];
    const presentTypes = photos.map((p: QuotePhoto) => p.photo_type);
    const missingTypes = requiredTypes.filter(t => !presentTypes.includes(t as PhotoType));

    if (missingTypes.length > 0) {
      flags.push({
        type: 'missing_photos',
        severity: 'critical',
        message: `Missing required photos: ${missingTypes.join(', ')}`,
        details: { missing: missingTypes },
      });
      autoBlock = true;
    }

    // 2. GPS check
    if (!quote.gps_lat || !quote.gps_lng) {
      flags.push({
        type: 'missing_gps',
        severity: 'critical',
        message: 'GPS location was not captured',
      });
      autoBlock = true;
    }

    // 3. Process each photo
    for (const photo of photos) {
      // Generate signed URL for AI analysis
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from('quote-photos')
        .createSignedUrl(photo.storage_path, 3600);

      if (!signedUrlData?.signedUrl) continue;

      const imageUrl = signedUrlData.signedUrl;

      // Plate OCR
      if (photo.photo_type === 'plate') {
        plateOcrText = await extractPlateText(imageUrl, tokenTracker);

        // Update photo with OCR text
        await supabaseAdmin
          .from('quote_photos')
          .update({ ocr_text: plateOcrText })
          .eq('id', photo.id);

        // Compare with entered plate
        if (plateOcrText !== 'UNREADABLE' && plateOcrText !== 'ERROR') {
          const normalizedOcr = normalizePlate(plateOcrText);
          const normalizedEntered = normalizePlate(quote.vehicle_plate || '');

          if (normalizedOcr !== normalizedEntered) {
            plateMatch = false;
            flags.push({
              type: 'plate_mismatch',
              severity: 'critical',
              message: `Plate OCR "${plateOcrText}" does not match entered plate "${quote.vehicle_plate}"`,
              details: { ocr: normalizedOcr, entered: normalizedEntered },
            });
            autoBlock = true;
          }
        } else {
          flags.push({
            type: 'plate_ocr_failed',
            severity: 'warning',
            message: 'Could not read license plate from photo',
          });
        }
      }

      // Quality analysis for all photos
      const qualityResult = await analyzePhotoQuality(imageUrl, photo.photo_type, tokenTracker);
      photoQuality[photo.photo_type] = qualityResult.score;

      await supabaseAdmin
        .from('quote_photos')
        .update({
          quality_score: qualityResult.score,
          validation_flags: qualityResult.issues,
          ai_analysis: qualityResult,
        })
        .eq('id', photo.id);

      if (qualityResult.score < 30) {
        flags.push({
          type: 'low_quality',
          severity: 'critical',
          message: `${photo.photo_type} photo quality too low (${qualityResult.score}/100)`,
          details: { issues: qualityResult.issues },
        });
      } else if (qualityResult.score < 60) {
        flags.push({
          type: 'medium_quality',
          severity: 'warning',
          message: `${photo.photo_type} photo quality is borderline (${qualityResult.score}/100)`,
          details: { issues: qualityResult.issues },
        });
      }
    }

    // 4. Calculate overall score
    const qualityScores = Object.values(photoQuality);
    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0;

    let score = avgQuality;
    if (!plateMatch) score -= 30;
    if (missingTypes.length > 0) score -= missingTypes.length * 10;
    if (!quote.gps_lat) score -= 15;
    score = Math.max(0, Math.min(100, score));

    // 5. Generate summary
    const criticalFlags = flags.filter(f => f.severity === 'critical');
    const warningFlags = flags.filter(f => f.severity === 'warning');

    let summary = '';
    if (autoBlock) {
      summary = `AUTO-BLOCKED: ${criticalFlags.length} critical issue(s) found. `;
    } else if (warningFlags.length > 0) {
      summary = `MANUAL REVIEW: ${warningFlags.length} warning(s) found. `;
    } else {
      summary = 'PASSED: All validation checks passed. ';
    }
    summary += `Quality score: ${score.toFixed(1)}/100. Plate OCR: ${plateMatch ? 'Match' : 'Mismatch'}.`;

    const AI_CHECKPOINTS = [
      'Required photo completeness',
      'GPS location verification',
      'License plate OCR & match',
      'Per-photo quality analysis',
      'Overall score calculation',
      'Summary & status determination',
    ];

    const result: AIValidationResult = {
      score,
      flags,
      plateOcrText,
      plateMatch,
      photoQuality,
      summary,
      autoBlock,
      tokenUsage: tokenTracker,
      checkpoints: AI_CHECKPOINTS,
    };

    // 6. Update quote with AI results + token/checkpoint metadata
    const newStatus = autoBlock ? 'rejected' : 'pending_review';
    await supabaseAdmin
      .from('quotes')
      .update({
        ai_status: 'completed',
        ai_score: score,
        ai_flags: flags,
        ai_summary: summary,
        status: quote.status === 'processing_ai' ? newStatus : quote.status,
        vehicle_data: {
          ...(quote.vehicle_data || {}),
          ai_checkpoints: AI_CHECKPOINTS.length,
          ai_checkpoint_names: AI_CHECKPOINTS,
          ai_token_usage: tokenTracker.totalTokens,
          ai_token_details: tokenTracker,
        },
      })
      .eq('id', quoteId);

    console.log(`🤖 AI validation complete: score=${score.toFixed(1)}, tokens=${tokenTracker.totalTokens}, calls=${tokenTracker.calls}`);

    // If auto-blocked, create notification
    if (autoBlock) {
      await supabaseAdmin.from('notifications').insert({
        user_id: quote.producer_id,
        title: 'Cotización rechazada automáticamente',
        title_en: 'Quote automatically rejected',
        body: `La cotización ${quote.quote_number} fue rechazada por validación automática: ${summary}`,
        body_en: `Quote ${quote.quote_number} was automatically rejected: ${summary}`,
        type: 'quote_rejected',
        data: { quote_id: quoteId },
      });
    }

    return result;
  } catch (error) {
    console.error('AI validation error:', error);

    await supabaseAdmin
      .from('quotes')
      .update({ ai_status: 'failed' })
      .eq('id', quoteId);

    return {
      score: 0,
      flags: [{ type: 'system_error', severity: 'critical', message: 'AI validation failed' }],
      plateOcrText: '',
      plateMatch: false,
      photoQuality: {},
      summary: 'AI validation failed due to system error',
      autoBlock: false,
    };
  }
}
