import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, requireApproved, AuthRequest } from '../middleware/auth';
import { getProducerCommissionSummary } from '../services/commission';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /producer/me
router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    res.json({ producer: profile });
  } catch (error) {
    console.error('Get producer error:', error);
    res.status(500).json({ error: 'Failed to get producer info' });
  }
});

// GET /producer/quotes
router.get('/quotes', requireApproved, async (req: AuthRequest, res: Response) => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('quotes')
      .select('*, plan:insurance_plans(*), photos:quote_photos(id, photo_type, storage_url)', { count: 'exact' })
      .eq('producer_id', req.user!.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status && typeof status === 'string') {
      query = query.eq('status', status);
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
    console.error('Get quotes error:', error);
    res.status(500).json({ error: 'Failed to get quotes' });
  }
});

// GET /producer/commissions/summary
router.get('/commissions/summary', requireApproved, async (req: AuthRequest, res: Response) => {
  try {
    const summary = await getProducerCommissionSummary(req.user!.id);
    res.json({ summary });
  } catch (error) {
    console.error('Get commission summary error:', error);
    res.status(500).json({ error: 'Failed to get commission summary' });
  }
});

// GET /producer/commissions/entries
router.get('/commissions/entries', requireApproved, async (req: AuthRequest, res: Response) => {
  try {
    const { status, page = '1', limit = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabaseAdmin
      .from('commission_entries')
      .select('*, policy:policies(policy_number), quote:quotes(quote_number, vehicle_plate)', { count: 'exact' })
      .eq('producer_id', req.user!.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (status && typeof status === 'string') {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({
      entries: data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get commission entries error:', error);
    res.status(500).json({ error: 'Failed to get commission entries' });
  }
});

// GET /producer/notifications
router.get('/notifications', async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ notifications: data });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// PATCH /producer/notifications/:id/read
router.patch('/notifications/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', req.user!.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// POST /producer/notifications/read-all
router.post('/notifications/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', req.user!.id)
      .eq('read', false);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

export default router;
