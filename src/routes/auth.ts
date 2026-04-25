import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendVerificationCode, checkVerificationCode, isTwilioConfigured } from '../services/twilio-sms';

const router = Router();

// POST /auth/register-request
router.post('/register-request', async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, phone, dni, whatsapp, address, city, province } = req.body;

    if (!email || !password || !full_name || !dni) {
      return res.status(400).json({ error: 'Email, password, full name, and DNI are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'producer',
      },
    });

    if (authError) {
      if (authError.message.includes('already')) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      return res.status(400).json({ error: authError.message });
    }

    // Update profile with additional info
    if (authData.user) {
      await supabaseAdmin.from('profiles').update({
        phone,
        dni,
        whatsapp: whatsapp || phone,
        address,
        city,
        province,
      }).eq('id', authData.user.id);
    }

    // Notify admins about new registration
    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'supervisor']);

    if (admins) {
      const notifications = admins.map(admin => ({
        user_id: admin.id,
        title: 'Nuevo productor registrado',
        title_en: 'New producer registered',
        body: `${full_name} (${email}) solicita aprobación como productor.`,
        body_en: `${full_name} (${email}) is requesting approval as a producer.`,
        type: 'general' as const,
        data: { producer_id: authData.user?.id },
      }));
      await supabaseAdmin.from('notifications').insert(notifications);
    }

    res.status(201).json({
      message: 'Account request submitted successfully',
      user_id: authData.user?.id,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /auth/send-verification — Send SMS verification code
router.post('/send-verification', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await sendVerificationCode(phone);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to send verification code' });
    }

    res.json({
      success: true,
      mock: !isTwilioConfigured,
      message: isTwilioConfigured
        ? 'Verification code sent via SMS'
        : 'Mock mode: any 6-digit code will work',
    });
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// POST /auth/check-verification — Verify SMS code
router.post('/check-verification', async (req: Request, res: Response) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code are required' });
    }

    const result = await checkVerificationCode(phone, code);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Invalid verification code' });
    }

    res.json({ success: true, verified: true });
  } catch (error) {
    console.error('Check verification error:', error);
    res.status(500).json({ error: 'Verification check failed' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        ...profile,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token,
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    res.json({
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_at: data.session?.expires_at,
      },
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.CORS_ORIGIN}/reset-password`,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ user: profile });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PATCH /auth/me
router.patch('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const allowedFields = ['full_name', 'phone', 'address', 'city', 'province', 'locale', 'theme', 'push_token'];
    const updates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.user!.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ user: data });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
