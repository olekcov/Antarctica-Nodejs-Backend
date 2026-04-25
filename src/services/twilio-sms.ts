/**
 * Twilio SMS Verification Service
 * 
 * Uses Twilio Verify API for phone number verification via SMS.
 * When Twilio is not configured, falls back to a mock mode that
 * accepts any 6-digit code (for development/testing).
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

const isTwilioConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);

let twilioClient: any = null;

function getTwilioClient() {
  if (!twilioClient && isTwilioConfigured) {
    try {
      const twilio = require('twilio');
      twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    } catch (err: any) {
      console.error('❌ Failed to initialize Twilio client:', err.message);
    }
  }
  return twilioClient;
}

// ─── Send Verification Code ─────────────────────────────────────────────────

export async function sendVerificationCode(phoneNumber: string): Promise<{ success: boolean; error?: string }> {
  // Normalize phone number (ensure +country code)
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number format' };
  }

  if (!isTwilioConfigured) {
    console.log(`📱 [MOCK SMS] Verification code sent to ${normalized} (Twilio not configured — any 6-digit code will work)`);
    return { success: true };
  }

  try {
    const client = getTwilioClient();
    if (!client) {
      return { success: false, error: 'Twilio client not available' };
    }

    await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to: normalized,
        channel: 'sms',
      });

    console.log(`📱 SMS verification sent to ${normalized}`);
    return { success: true };
  } catch (err: any) {
    console.error(`❌ Twilio send error:`, err.message);
    return { success: false, error: err.message || 'Failed to send SMS' };
  }
}

// ─── Check Verification Code ────────────────────────────────────────────────

export async function checkVerificationCode(
  phoneNumber: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number format' };
  }

  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return { success: false, error: 'Invalid verification code format' };
  }

  if (!isTwilioConfigured) {
    // In mock mode, accept any valid 6-digit code
    console.log(`📱 [MOCK SMS] Verification check for ${normalized}: code=${code} → APPROVED (mock mode)`);
    return { success: true };
  }

  try {
    const client = getTwilioClient();
    if (!client) {
      return { success: false, error: 'Twilio client not available' };
    }

    const verification = await client.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to: normalized,
        code,
      });

    if (verification.status === 'approved') {
      console.log(`✅ SMS verification approved for ${normalized}`);
      return { success: true };
    } else {
      console.log(`❌ SMS verification failed for ${normalized}: ${verification.status}`);
      return { success: false, error: 'Invalid verification code' };
    }
  } catch (err: any) {
    console.error(`❌ Twilio check error:`, err.message);
    return { success: false, error: err.message || 'Verification check failed' };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // If starts with 0, assume Argentina and add +54
  if (cleaned.startsWith('0')) {
    cleaned = '+54' + cleaned.substring(1);
  }
  // If doesn't start with +, assume Argentina
  if (!cleaned.startsWith('+')) {
    cleaned = '+54' + cleaned;
  }
  // Basic validation: must be at least 10 digits after +
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return cleaned;
}

export { isTwilioConfigured };
