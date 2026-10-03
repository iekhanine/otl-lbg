import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const isQuarterHour = (value: unknown) =>
  !value || /^(?:[01]\d|2[0-3]):(?:00|15|30|45)(?::00)?$/.test(String(value));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return res.status(503).json({ error: 'Server database is not configured' });
    }

    const db = createClient(url, key, { auth: { persistSession: false } });
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in required' });

    const { data: authData, error: authError } = await db.auth.getUser(token);
    const user = authData.user;
    if (authError || !user) {
      console.error('[appointments auth]', authError);
      return res.status(401).json({ error: authError?.message || 'Invalid session' });
    }

    const email = String(user.email || '').trim().toLowerCase();
    const { data: admin, error: adminError } = await db
      .from('admin_users')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!admin) return res.status(403).json({ error: 'This Google account is not authorized' });

    if (req.method === 'GET') {
      const { data, error } = await db
        .from('appointments')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const row = req.body || {};
      if (!row.name || !row.email || !row.service || !row.preferred_date || !row.preferred_time) {
        return res.status(400).json({ error: 'Name, email, service, date and time are required' });
      }
      if (!isQuarterHour(row.preferred_time)) {
        return res.status(400).json({ error: 'Appointment times must be in 15-minute increments' });
      }
      const { data, error } = await db.from('appointments').insert(row).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PATCH') {
      const id = req.body?.id;
      const changes = req.body?.changes || {};
      if (!id) return res.status(400).json({ error: 'Appointment id is required' });
      if (Object.prototype.hasOwnProperty.call(changes, 'preferred_time') && !isQuarterHour(changes.preferred_time)) {
        return res.status(400).json({ error: 'Appointment times must be in 15-minute increments' });
      }
      const { error } = await db.from('appointments').update(changes).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.body?.id;
      if (!id) return res.status(400).json({ error: 'Appointment id is required' });
      const { error } = await db.from('appointments').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('[appointments api]', error);
    return res.status(500).json({ error: error?.message || 'Appointments request failed' });
  }
}
