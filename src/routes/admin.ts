import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { calculateCommission } from '../services/commission';
import * as XLSX from 'xlsx';

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(requireRole('admin', 'supervisor', 'finance'));

// ==================== PRODUCER MANAGEMENT ====================

// GET /admin/producers
router.get('/producers', async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, page = '1', limit = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .eq('role', 'producer')
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status && typeof status === 'string') {
      query = query.eq('status', status);
    }

    if (search && typeof search === 'string') {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      producers: data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get producers error:', error);
    res.status(500).json({ error: 'Failed to get producers' });
  }
});

// POST /admin/producers/:id/approve
router.post('/producers/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if producer already has a promotor_code
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('promotor_code')
      .eq('id', id)
      .single();

    // Assign sequential promotor code if not already assigned
    let promotorCode = (existing as any)?.promotor_code;
    if (!promotorCode) {
      // Get the current max code and increment
      const { data: maxRow } = await supabaseAdmin
        .from('profiles')
        .select('promotor_code')
        .not('promotor_code', 'is', null)
        .order('promotor_code', { ascending: false })
        .limit(1)
        .single();
      promotorCode = ((maxRow as any)?.promotor_code || 1000) + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: req.user!.id,
        promotor_code: promotorCode,
      })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    // Send notification with promotor code
    await supabaseAdmin.from('notifications').insert({
      user_id: id,
      title: '¡Cuenta aprobada!',
      title_en: 'Account approved!',
      body: `Tu cuenta ha sido aprobada. Tu código de promotor es: ${promotorCode}. Ya puedes crear cotizaciones.`,
      body_en: `Your account has been approved. Your promotor code is: ${promotorCode}. You can now create quotes.`,
      type: 'account_approved',
      data: { promotor_code: promotorCode },
    });

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'approve_producer',
      entity_type: 'producer',
      entity_id: id,
      new_data: { status: 'approved', promotor_code: promotorCode },
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Approve producer error:', error);
    res.status(500).json({ error: 'Failed to approve producer' });
  }
});

// POST /admin/producers/:id/reject
router.post('/producers/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ status: 'rejected' })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: id,
      title: 'Cuenta rechazada',
      title_en: 'Account rejected',
      body: reason || 'Tu solicitud de cuenta fue rechazada.',
      body_en: reason || 'Your account request was rejected.',
      type: 'account_rejected',
    });

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'reject_producer',
      entity_type: 'producer',
      entity_id: id,
      new_data: { status: 'rejected', reason },
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Reject producer error:', error);
    res.status(500).json({ error: 'Failed to reject producer' });
  }
});

// POST /admin/producers/:id/suspend
router.post('/producers/:id/suspend', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ status: 'suspended' })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'suspend_producer',
      entity_type: 'producer',
      entity_id: id,
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Suspend producer error:', error);
    res.status(500).json({ error: 'Failed to suspend producer' });
  }
});

// POST /admin/producers/:id/reactivate
router.post('/producers/:id/reactivate', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: req.user!.id,
      })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'reactivate_producer',
      entity_type: 'producer',
      entity_id: id,
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Reactivate producer error:', error);
    res.status(500).json({ error: 'Failed to reactivate producer' });
  }
});

// PATCH /admin/producers/:id/commission-rate
router.patch('/producers/:id/commission-rate', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { commission_rate } = req.body;

    if (commission_rate < 0 || commission_rate > 1) {
      return res.status(400).json({ error: 'Commission rate must be between 0 and 1' });
    }

    const { data: oldProfile } = await supabaseAdmin
      .from('profiles')
      .select('commission_rate')
      .eq('id', id)
      .single();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ commission_rate })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'update_commission_rate',
      entity_type: 'producer',
      entity_id: id,
      old_data: { commission_rate: oldProfile?.commission_rate },
      new_data: { commission_rate },
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Update commission rate error:', error);
    res.status(500).json({ error: 'Failed to update commission rate' });
  }
});

// PATCH /admin/producers/:id — Update promotor data (Modificación)
router.patch('/producers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, dni, whatsapp, address, city, province } = req.body;

    // Build update object with only provided fields
    const updates: Record<string, any> = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (dni !== undefined) updates.dni = dni;
    if (whatsapp !== undefined) updates.whatsapp = whatsapp;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (province !== undefined) updates.province = province;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Get old data for audit
    const { data: oldProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    // If email changed, update auth email too
    if (email && email !== oldProfile?.email) {
      await supabaseAdmin.auth.admin.updateUserById(String(id), { email });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'update_producer',
      entity_type: 'producer',
      entity_id: id,
      old_data: oldProfile,
      new_data: updates,
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Update producer error:', error);
    res.status(500).json({ error: 'Failed to update producer' });
  }
});

// POST /admin/producers/:id/deactivate — Baja de promotor
router.post('/producers/:id/deactivate', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        status: 'suspended',
        deactivated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('role', 'producer')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producer not found' });
    }

    // Disable auth login
    await supabaseAdmin.auth.admin.updateUserById(String(id), { ban_duration: '876000h' }); // ~100 years

    await supabaseAdmin.from('notifications').insert({
      user_id: id,
      title: 'Cuenta desactivada',
      title_en: 'Account deactivated',
      body: reason || 'Tu cuenta ha sido desactivada. Contactá al administrador.',
      body_en: reason || 'Your account has been deactivated. Contact the administrator.',
      type: 'general',
    });

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'deactivate_producer',
      entity_type: 'producer',
      entity_id: id,
      new_data: { status: 'suspended', reason },
    });

    res.json({ producer: data });
  } catch (error) {
    console.error('Deactivate producer error:', error);
    res.status(500).json({ error: 'Failed to deactivate producer' });
  }
});

// ==================== QUOTE MANAGEMENT ====================

// GET /admin/quotes
router.get('/quotes', async (req: AuthRequest, res: Response) => {
  try {
    const { status, producer_id, date_from, date_to, plan_id, search, page = '1', limit = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('quotes')
      .select(`
        *,
        producer:profiles!producer_id(id, full_name, email),
        plan:insurance_plans(name, code),
        photos:quote_photos(id, photo_type, storage_url)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status && typeof status === 'string') query = query.eq('status', status);
    if (producer_id && typeof producer_id === 'string') query = query.eq('producer_id', producer_id);
    if (plan_id && typeof plan_id === 'string') query = query.eq('plan_id', plan_id);
    if (date_from && typeof date_from === 'string') query = query.gte('created_at', date_from);
    if (date_to && typeof date_to === 'string') query = query.lte('created_at', date_to);
    if (search && typeof search === 'string') {
      query = query.or(`vehicle_plate.ilike.%${search}%,customer_dni.ilike.%${search}%,quote_number.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      quotes: data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get admin quotes error:', error);
    res.status(500).json({ error: 'Failed to get quotes' });
  }
});

// POST /admin/quotes/:id/approve
router.post('/quotes/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        status: 'approved',
        admin_notes: notes,
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user!.id,
      })
      .eq('id', id)
      .in('status', ['pending_review'])
      .select()
      .single();

    if (error || !quote) {
      return res.status(404).json({ error: 'Quote not found or not in reviewable state' });
    }

    // Create policy
    const policyNumber = `POL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
    const { data: policy } = await supabaseAdmin
      .from('policies')
      .insert({
        quote_id: id,
        producer_id: quote.producer_id,
        policy_number: policyNumber,
        insurer_status: 'active',
        premium: quote.premium,
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      })
      .select()
      .single();

    // Calculate commission
    if (policy) {
      await calculateCommission(id as string, policy.id);
    }

    // Notify producer
    await supabaseAdmin.from('notifications').insert({
      user_id: quote.producer_id,
      title: '¡Cotización aprobada!',
      title_en: 'Quote approved!',
      body: `La cotización ${quote.quote_number} fue aprobada. Póliza: ${policyNumber}`,
      body_en: `Quote ${quote.quote_number} was approved. Policy: ${policyNumber}`,
      type: 'quote_approved',
      data: { quote_id: id, policy_number: policyNumber },
    });

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'approve_quote',
      entity_type: 'quote',
      entity_id: id,
      new_data: { status: 'approved', policy_number: policyNumber },
    });

    res.json({ quote, policy });
  } catch (error) {
    console.error('Approve quote error:', error);
    res.status(500).json({ error: 'Failed to approve quote' });
  }
});

// POST /admin/quotes/:id/reject
router.post('/quotes/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user!.id,
      })
      .eq('id', id)
      .in('status', ['pending_review'])
      .select()
      .single();

    if (error || !quote) {
      return res.status(404).json({ error: 'Quote not found or not reviewable' });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: quote.producer_id,
      title: 'Cotización rechazada',
      title_en: 'Quote rejected',
      body: `La cotización ${quote.quote_number} fue rechazada. Motivo: ${reason || 'No especificado'}`,
      body_en: `Quote ${quote.quote_number} was rejected. Reason: ${reason || 'Not specified'}`,
      type: 'quote_rejected',
      data: { quote_id: id, reason },
    });

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'reject_quote',
      entity_type: 'quote',
      entity_id: id,
      new_data: { status: 'rejected', reason },
    });

    res.json({ quote });
  } catch (error) {
    console.error('Reject quote error:', error);
    res.status(500).json({ error: 'Failed to reject quote' });
  }
});

// POST /admin/quotes/:id/request-fix
router.post('/quotes/:id/request-fix', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { instructions } = req.body;

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        status: 'needs_fix',
        fix_instructions: instructions,
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user!.id,
      })
      .eq('id', id)
      .in('status', ['pending_review'])
      .select()
      .single();

    if (error || !quote) {
      return res.status(404).json({ error: 'Quote not found or not reviewable' });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: quote.producer_id,
      title: 'Correcciones requeridas',
      title_en: 'Corrections required',
      body: `La cotización ${quote.quote_number} necesita correcciones: ${instructions}`,
      body_en: `Quote ${quote.quote_number} needs corrections: ${instructions}`,
      type: 'quote_needs_fix',
      data: { quote_id: id, instructions },
    });

    res.json({ quote });
  } catch (error) {
    console.error('Request fix error:', error);
    res.status(500).json({ error: 'Failed to request fix' });
  }
});

// PATCH /admin/quotes/:id/status - Update quote status (client feedback: edit states)
router.patch('/quotes/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['draft', 'pending_uploads', 'processing_ai', 'pending_review', 'approved', 'rejected', 'needs_fix'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const { data: oldQuote } = await supabaseAdmin
      .from('quotes')
      .select('status')
      .eq('id', id)
      .single();

    if (!oldQuote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .update({
        status,
        admin_notes: notes || undefined,
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.user!.id,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !quote) {
      return res.status(400).json({ error: error?.message || 'Failed to update status' });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'update_quote_status',
      entity_type: 'quote',
      entity_id: id,
      old_data: { status: oldQuote.status },
      new_data: { status, notes },
    });

    res.json({ quote });
  } catch (error) {
    console.error('Update quote status error:', error);
    res.status(500).json({ error: 'Failed to update quote status' });
  }
});

// ==================== COMMISSION MANAGEMENT ====================

// GET /admin/commissions
router.get('/commissions', async (req: AuthRequest, res: Response) => {
  try {
    const { status, producer_id, month, year, page = '1', limit = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('commission_entries')
      .select(`
        *,
        producer:profiles!producer_id(id, full_name, email),
        policy:policies(policy_number),
        quote:quotes(quote_number, vehicle_plate)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status && typeof status === 'string') query = query.eq('status', status);
    if (producer_id && typeof producer_id === 'string') query = query.eq('producer_id', producer_id);
    if (month && typeof month === 'string') query = query.eq('period_month', Number(month));
    if (year && typeof year === 'string') query = query.eq('period_year', Number(year));

    const { data, error, count } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Calculate totals
    const { data: totals } = await supabaseAdmin
      .from('commission_entries')
      .select('amount, status');

    const totalDue = totals?.filter(t => t.status === 'due').reduce((s, t) => s + Number(t.amount), 0) || 0;
    const totalPaid = totals?.filter(t => t.status === 'paid').reduce((s, t) => s + Number(t.amount), 0) || 0;

    res.json({
      commissions: data,
      totals: { due: totalDue, paid: totalPaid, total: totalDue + totalPaid },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get commissions error:', error);
    res.status(500).json({ error: 'Failed to get commissions' });
  }
});

// POST /admin/commissions/:id/mark-paid
router.post('/commissions/:id/mark-paid', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('commission_entries')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: req.user!.id,
      })
      .eq('id', id)
      .eq('status', 'due')
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Commission not found or already paid' });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: data.producer_id,
      title: 'Comisión pagada',
      title_en: 'Commission paid',
      body: `Se ha pagado tu comisión de $${data.amount}.`,
      body_en: `Your commission of $${data.amount} has been paid.`,
      type: 'commission_paid',
      data: { commission_id: id, amount: data.amount },
    });

    await supabaseAdmin.from('audit_logs').insert({
      user_id: req.user!.id,
      action: 'mark_commission_paid',
      entity_type: 'commission',
      entity_id: id,
    });

    res.json({ commission: data });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ error: 'Failed to mark commission as paid' });
  }
});

// ==================== REPORTS ====================

// GET /admin/reports/dashboard
router.get('/reports/dashboard', async (_req: AuthRequest, res: Response) => {
  try {
    const [
      monthlyResult,
      producerPendingResult,
      producerApprovedResult,
      producerSuspendedResult,
      quoteTotalResult,
      quotePendingResult,
      quoteApprovedResult,
      quoteRejectedResult,
      quoteApprovedPremiums,
      commDueResult,
      commPaidResult,
      topProducersResult,
      planDistResult,
    ] = await Promise.all([
      supabaseAdmin.from('monthly_quotes_summary').select('*').limit(12),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'producer').eq('status', 'pending'),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'producer').eq('status', 'approved'),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'producer').eq('status', 'suspended'),
      supabaseAdmin.from('quotes').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
      supabaseAdmin.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabaseAdmin.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabaseAdmin.from('quotes').select('premium').eq('status', 'approved'),
      supabaseAdmin.from('commission_entries').select('amount').eq('status', 'due'),
      supabaseAdmin.from('commission_entries').select('amount').eq('status', 'paid'),
      supabaseAdmin.from('producer_rankings').select('*').limit(10),
      supabaseAdmin.from('quotes').select('plan_id, plan:insurance_plans(name)').eq('status', 'approved'),
    ]);

    const totalPremium = quoteApprovedPremiums.data?.reduce((s, q) => s + Number(q.premium || 0), 0) || 0;
    const totalDue = commDueResult.data?.reduce((s, c) => s + Number(c.amount || 0), 0) || 0;
    const totalPaid = commPaidResult.data?.reduce((s, c) => s + Number(c.amount || 0), 0) || 0;

    const planCounts: Record<string, number> = {};
    planDistResult.data?.forEach(q => {
      const name = (q.plan as any)?.name || 'Unknown';
      planCounts[name] = (planCounts[name] || 0) + 1;
    });

    res.json({
      monthly: monthlyResult.data,
      producers: {
        total: (producerPendingResult.count || 0) + (producerApprovedResult.count || 0) + (producerSuspendedResult.count || 0),
        pending: producerPendingResult.count || 0,
        approved: producerApprovedResult.count || 0,
        suspended: producerSuspendedResult.count || 0,
      },
      quotes: {
        total: quoteTotalResult.count || 0,
        pending_review: quotePendingResult.count || 0,
        approved: quoteApprovedResult.count || 0,
        rejected: quoteRejectedResult.count || 0,
        total_premium: totalPremium,
      },
      commissions: { totalDue: totalDue, totalPaid: totalPaid },
      topProducers: topProducersResult.data,
      planDistribution: Object.entries(planCounts).map(([name, count]) => ({ name, count })),
    });
  } catch (error) {
    console.error('Dashboard report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /admin/reports/export
router.get('/reports/export', async (req: AuthRequest, res: Response) => {
  try {
    const { type = 'commissions', date_from, date_to } = req.query;

    let data: any[] = [];
    let filename = '';

    if (type === 'commissions') {
      let query = supabaseAdmin
        .from('commission_entries')
        .select(`
          *,
          producer:profiles!producer_id(full_name, email),
          policy:policies(policy_number),
          quote:quotes(quote_number, vehicle_plate)
        `);

      if (date_from) query = query.gte('created_at', date_from as string);
      if (date_to) query = query.lte('created_at', date_to as string);

      const result = await query;
      data = (result.data || []).map(c => ({
        'ID': c.id,
        'Producer': (c.producer as any)?.full_name,
        'Email': (c.producer as any)?.email,
        'Policy': (c.policy as any)?.policy_number,
        'Quote': (c.quote as any)?.quote_number,
        'Plate': (c.quote as any)?.vehicle_plate,
        'Premium': c.premium,
        'Rate': c.rate,
        'Commission': c.amount,
        'Status': c.status,
        'Period': `${c.period_month}/${c.period_year}`,
        'Created': c.created_at,
        'Paid At': c.paid_at || '',
      }));
      filename = `commissions_${new Date().toISOString().split('T')[0]}.xlsx`;
    } else if (type === 'quotes') {
      let query = supabaseAdmin
        .from('quotes')
        .select(`*, producer:profiles!producer_id(full_name, email)`);

      if (date_from) query = query.gte('created_at', date_from as string);
      if (date_to) query = query.lte('created_at', date_to as string);

      const result = await query;
      data = (result.data || []).map(q => ({
        'Quote #': q.quote_number,
        'Producer': (q.producer as any)?.full_name,
        'Plate': q.vehicle_plate,
        'DNI': q.customer_dni,
        'Status': q.status,
        'Premium': q.premium,
        'AI Score': q.ai_score,
        'Created': q.created_at,
        'Submitted': q.submitted_at || '',
        'Reviewed': q.reviewed_at || '',
      }));
      filename = `quotes_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

export default router;
