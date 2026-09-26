# Local Bike Guy V6

V6 fixes the API routing/runtime problem from V5.

## What changed
- `/book` remains the clean Facebook share link: logo + booking form only.
- Public bookings and messages submit through `/api/submit`.
- Local `npm run dev` now executes the same `/api/*.ts` handlers through a Vite development middleware.
- Vercel routing uses filesystem-first routing so `/api/*` is executed before the SPA fallback.
- `/api/health` reports whether server configuration is present without exposing secrets.
- Frontend API parsing now validates the response instead of blindly calling `response.json()`.
- Admin continues to use real Supabase-backed appointments, messages, customers and settings.
- Notification email and notification on/off switch remain editable in Admin > Settings.

## Environment variables
Create `.env.local` for local development:

VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
NOTIFICATION_FROM_EMAIL=Local Bike Guy <notifications@your-verified-domain.com>

The service-role key must NEVER use a `VITE_` prefix.

Add the same server variables in Vercel Project Settings > Environment Variables.

## Database
Run `supabase/V5_SERVER_ADMIN.sql` once if you have not already run it.
Then whitelist the owner's Google email:

```sql
insert into public.admin_users(email)
values ('OWNER-GOOGLE-EMAIL@example.com')
on conflict do nothing;
```

Notifications default OFF so testing does not email the owner.

## Run
```powershell
npm install
npm run dev
```

Test API health in the browser:
`/api/health`

Expected shape:
`{"ok":true,"service":"local-bike-guy-api",...}`

Then test `/book`.

## Build
```powershell
npm run build
```

## V8 update
1. Run `supabase/V8_ADMIN_DATA.sql` in the Supabase SQL Editor.
2. Notifications are seeded OFF by default.
3. Admin Services & Pricing is database-backed and seeded by the V8 SQL file.
4. Admin Settings now upserts the settings row, so the first save works even if no row existed previously.
5. Appointments include Cancel and permanent Delete actions. Cancel preserves history; Delete removes the row.
6. V8 seeds clearly marked demo appointments and inbox messages. Demo email addresses use `demo.invalid`.

## V9 response normalization fix
V9 normalizes Admin API responses in one place. It accepts both raw JSON arrays/objects and `{ "data": ... }` wrapped responses. No V9 SQL migration is required. Keep the V8 database rows already seeded.
