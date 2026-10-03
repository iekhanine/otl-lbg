import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SITE_SETTINGS_SLUG = 'site-navigation-settings';

const DEFAULT_NAV_ITEMS = [
  { title: 'Home', menu_label: 'Home', slug: 'menu-home', href: '/', menu_order: 0 },
  { title: 'Book a Repair', menu_label: 'Book a Repair', slug: 'menu-book-a-repair', href: '/book', menu_order: 10 },
  { title: 'Services', menu_label: 'Services', slug: 'menu-services', href: '/services', menu_order: 20 },
  { title: 'Contact', menu_label: 'Contact', slug: 'menu-contact', href: '/contact', menu_order: 9000 },
  { title: 'Admin Login', menu_label: 'Admin Login', slug: 'menu-admin-login', href: '/admin/login', menu_order: 10000 },
];

const safeHtml = (value: unknown) => String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
  .replace(/javascript:/gi, '');

function cleanContent(content: any) {
  if (!Array.isArray(content)) return [];
  return content.slice(0, 100).map((block: any) => ({
    ...block,
    html: block.html ? safeHtml(block.html) : undefined,
    href: block.href ? String(block.href).slice(0, 2048) : undefined,
    items: Array.isArray(block.items) ? block.items.slice(0, 3).map(safeHtml) : undefined,
  }));
}

function navHref(row: any) {
  const first = Array.isArray(row?.content) ? row.content[0] : null;
  if (first?.type === 'navlink') return String(first.href || '/');
  return `/${row.slug}`;
}

async function ensureNavigationInitialized(db: any) {
  const { data: settingsRow, error: settingsError } = await db
    .from('lbg_pages')
    .select('id,content')
    .eq('slug', SITE_SETTINGS_SLUG)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (settingsRow) return settingsRow;

  // Preserve existing custom pages but move them into the middle of the default menu order.
  const { data: existing, error: existingError } = await db
    .from('lbg_pages')
    .select('id,menu_order,slug')
    .order('menu_order')
    .order('title');
  if (existingError) throw existingError;
  const customRows = (Array.isArray(existing) ? existing : []).filter((x: any) => x.slug !== SITE_SETTINGS_SLUG);
  for (let i = 0; i < customRows.length; i++) {
    const { error } = await db.from('lbg_pages').update({ menu_order: 100 + i }).eq('id', customRows[i].id);
    if (error) throw error;
  }

  const seeded = DEFAULT_NAV_ITEMS.map(item => ({
    title: item.title,
    menu_label: item.menu_label,
    slug: item.slug,
    content: [{ id: item.slug, type: 'navlink', href: item.href }],
    published: true,
    show_in_menu: true,
    menu_order: item.menu_order,
    updated_at: new Date().toISOString(),
  }));
  const siteSettings = {
    title: 'Site Navigation Settings',
    menu_label: 'Site Navigation Settings',
    slug: SITE_SETTINGS_SLUG,
    content: [{ id: 'site-config', type: 'siteconfig', logo_href: '/', service_button_style: 'tiles', featured_service_ids: [], service_button_styles: {} }],
    published: false,
    show_in_menu: false,
    menu_order: -9999,
    updated_at: new Date().toISOString(),
  };

  const { error: seedError } = await db.from('lbg_pages').insert([...seeded, siteSettings]);
  if (seedError) throw seedError;
  const { data: created, error: createdError } = await db.from('lbg_pages').select('id,content').eq('slug', SITE_SETTINGS_SLUG).single();
  if (createdError) throw createdError;
  return created;
}

function getSiteConfig(settingsRow: any) {
  const block = Array.isArray(settingsRow?.content) ? settingsRow.content.find((x: any) => x?.type === 'siteconfig') : null;
  const allowedStyles = new Set(['tiles', 'solid', 'outline', 'wide']);
  const style = allowedStyles.has(String(block?.service_button_style)) ? String(block.service_button_style) : 'tiles';
  const featured = Array.isArray(block?.featured_service_ids) ? block.featured_service_ids.map(String).slice(0, 3) : [];
  const serviceButtonStyles: Record<string, string> = {};
  if (block?.service_button_styles && typeof block.service_button_styles === 'object' && !Array.isArray(block.service_button_styles)) {
    Object.entries(block.service_button_styles).slice(0, 250).forEach(([id, value]) => {
      if (allowedStyles.has(String(value))) serviceButtonStyles[String(id)] = String(value);
    });
  }
  return {
    logo_href: String(block?.logo_href || '/'),
    service_button_style: style,
    featured_service_ids: featured,
    service_button_styles: serviceButtonStyles,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Server database is not configured' });
  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    const siteSettings = await ensureNavigationInitialized(db);

    if (req.method === 'GET' && !req.query.action) {
      if (req.query.site === '1') {
        return res.json(getSiteConfig(siteSettings));
      }
      if (req.query.nav === '1') {
        const { data, error } = await db
          .from('lbg_pages')
          .select('id,title,menu_label,slug,menu_order,content')
          .neq('slug', SITE_SETTINGS_SLUG)
          .eq('published', true)
          .eq('show_in_menu', true)
          .order('menu_order')
          .order('title');
        if (error) throw error;
        return res.json((data || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          menu_label: row.menu_label,
          slug: row.slug,
          menu_order: row.menu_order,
          href: navHref(row),
        })));
      }
      const slug = String(req.query.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Page slug is required' });
      const { data, error } = await db
        .from('lbg_pages')
        .select('id,title,menu_label,slug,content')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      if (!data || slug === SITE_SETTINGS_SLUG || (Array.isArray(data.content) && data.content[0]?.type === 'navlink')) {
        return res.status(404).json({ error: 'Page not found' });
      }
      return res.json(data);
    }

    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) return res.status(401).json({ error: 'Sign in required' });
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: authError?.message || 'Invalid session' });
    const { data: admin } = await db.from('admin_users').select('email').eq('email', (user.email || '').toLowerCase()).maybeSingle();
    if (!admin) return res.status(403).json({ error: 'This Google account is not authorized' });

    const action = String(req.query.action || '');
    if (action === 'site' && req.method === 'GET') {
      return res.json(getSiteConfig(siteSettings));
    }
    if (action === 'site' && req.method === 'PATCH') {
      const current = getSiteConfig(siteSettings);
      const logoHref = req.body?.logo_href === undefined ? current.logo_href : (String(req.body.logo_href || '/').trim() || '/');
      const requestedStyle = req.body?.service_button_style === undefined ? current.service_button_style : String(req.body.service_button_style);
      const serviceButtonStyle = ['tiles', 'solid', 'outline', 'wide'].includes(requestedStyle) ? requestedStyle : current.service_button_style;
      const featuredServiceIds = req.body?.featured_service_ids === undefined
        ? current.featured_service_ids
        : (Array.isArray(req.body.featured_service_ids) ? Array.from(new Set(req.body.featured_service_ids.map(String))).slice(0, 3) : []);
      const serviceButtonStyles = req.body?.service_button_styles === undefined
        ? current.service_button_styles
        : (() => {
            const allowed = new Set(['tiles', 'solid', 'outline', 'wide']);
            const next: Record<string, string> = {};
            const raw = req.body?.service_button_styles;
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
              Object.entries(raw).slice(0, 250).forEach(([id, value]) => {
                if (allowed.has(String(value))) next[String(id)] = String(value);
              });
            }
            return next;
          })();
      const content = [{ id: 'site-config', type: 'siteconfig', logo_href: logoHref, service_button_style: serviceButtonStyle, featured_service_ids: featuredServiceIds, service_button_styles: serviceButtonStyles }];
      const { data, error } = await db.from('lbg_pages').update({ content, updated_at: new Date().toISOString() }).eq('slug', SITE_SETTINGS_SLUG).select().single();
      if (error) throw error;
      return res.json(getSiteConfig(data));
    }
    if (action === 'list' && req.method === 'GET') {
      const { data, error } = await db.from('lbg_pages').select('*').neq('slug', SITE_SETTINGS_SLUG).order('menu_order').order('title');
      if (error) throw error;
      return res.json(data || []);
    }
    if (action === 'reorder' && req.method === 'PATCH') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      for (let i = 0; i < ids.length; i++) {
        const { error } = await db.from('lbg_pages').update({ menu_order: i, updated_at: new Date().toISOString() }).eq('id', ids[i]).neq('slug', SITE_SETTINGS_SLUG);
        if (error) throw error;
      }
      return res.json({ ok: true });
    }
    if (action === 'save' && (req.method === 'POST' || req.method === 'PATCH')) {
      const b = req.body || {};
      const content = cleanContent(b.content);
      const isNavLink = content[0]?.type === 'navlink';
      const slug = isNavLink
        ? String(b.slug || `menu-link-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
        : String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      if (!b.title || !slug) return res.status(400).json({ error: isNavLink ? 'Menu item name is required' : 'Title and URL slug are required' });
      const row = {
        title: String(b.title),
        menu_label: String(b.menu_label || b.title),
        slug,
        content,
        published: isNavLink ? true : !!b.published,
        show_in_menu: b.show_in_menu !== false,
        menu_order: Number(b.menu_order || 0),
        updated_at: new Date().toISOString(),
      };
      const query = b.id ? db.from('lbg_pages').update(row).eq('id', b.id).neq('slug', SITE_SETTINGS_SLUG) : db.from('lbg_pages').insert(row);
      const { data, error } = await query.select().single();
      if (error) throw error;
      return res.json(data);
    }
    if (action === 'delete' && req.method === 'DELETE') {
      const { error } = await db.from('lbg_pages').delete().eq('id', req.body?.id).neq('slug', SITE_SETTINGS_SLUG);
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
