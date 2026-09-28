import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const safeHtml = (value: unknown) => String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
  .replace(/javascript:/gi, '');

function cleanContent(content: any) {
  if (!Array.isArray(content)) return [];
  return content.slice(0, 100).map((block: any) => ({
    ...block,
    html: block.html ? safeHtml(block.html) : undefined,
    items: Array.isArray(block.items) ? block.items.slice(0, 3).map(safeHtml) : undefined,
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Server database is not configured' });
  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    if (req.method === 'GET' && !req.query.action) {
      if (req.query.nav === '1') {
        const { data, error } = await db.from('lbg_pages').select('id,title,menu_label,slug,menu_order').eq('published', true).eq('show_in_menu', true).order('menu_order').order('title');
        if (error) throw error;
        return res.json(data || []);
      }
      const slug = String(req.query.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Page slug is required' });
      const { data, error } = await db.from('lbg_pages').select('id,title,menu_label,slug,content').eq('slug', slug).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Page not found' });
      return res.json(data);
    }

    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: authError?.message || 'Invalid session' });
    const { data: admin } = await db.from('admin_users').select('email').eq('email', (user.email || '').toLowerCase()).maybeSingle();
    if (!admin) return res.status(403).json({ error: 'This Google account is not authorized' });

    const action = String(req.query.action || '');
    if (action === 'list' && req.method === 'GET') {
      const { data, error } = await db.from('lbg_pages').select('*').order('menu_order').order('title');
      if (error) throw error;
      return res.json(data || []);
    }
    if (action === 'reorder' && req.method === 'PATCH') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      for (let i = 0; i < ids.length; i++) {
        const { error } = await db.from('lbg_pages').update({ menu_order: i, updated_at: new Date().toISOString() }).eq('id', ids[i]);
        if (error) throw error;
      }
      return res.json({ ok: true });
    }
    if (action === 'save' && (req.method === 'POST' || req.method === 'PATCH')) {
      const b = req.body || {};
      const slug = String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      if (!b.title || !slug) return res.status(400).json({ error: 'Title and URL slug are required' });
      const row = { title: String(b.title), menu_label: String(b.menu_label || b.title), slug, content: cleanContent(b.content), published: !!b.published, show_in_menu: b.show_in_menu !== false, menu_order: Number(b.menu_order || 0), updated_at: new Date().toISOString() };
      const query = b.id ? db.from('lbg_pages').update(row).eq('id', b.id) : db.from('lbg_pages').insert(row);
      const { data, error } = await query.select().single();
      if (error) throw error;
      return res.json(data);
    }
    if (action === 'delete' && req.method === 'DELETE') {
      const { error } = await db.from('lbg_pages').delete().eq('id', req.body?.id);
      if (error) throw error;
      return res.json({ ok: true });
    }
    if (action === 'upload' && req.method === 'POST') {
      const raw = String(req.body?.data || '');
      const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'JPEG, PNG, or WebP image required' });
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image must be 8MB or smaller' });
      const ext = match[1].split('/')[1].replace('jpeg', 'jpg');
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await db.storage.from('lbg-page-images').upload(path, bytes, { contentType: match[1], upsert: false });
      if (error) throw error;
      const { data } = db.storage.from('lbg-page-images').getPublicUrl(path);
      return res.json({ url: data.publicUrl });
    }
    return res.status(400).json({ error: 'Unsupported request' });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Page request failed' });
  }
}
