# operandi-dashboard

Multi-tenant outreach dashboard for Operandi clients + master view for Max.

- Next.js 14 App Router
- Supabase Auth (magic link) + RLS for tenant isolation
- Deployed to Vercel; targets `dashboard.operandiconsultancy.com`
- Reads from Supabase project `xepotlbqlwmriwievyvc`, schema `outreach`

## Setup

```bash
pnpm install   # or npm/yarn
cp .env.example .env.local
# fill SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
pnpm dev
```

## Roles

Insert into `outreach.client_users` to grant access:

```sql
-- client login (sees only their data via RLS)
INSERT INTO outreach.client_users (user_id, client_slug, role, email, display_name)
VALUES ('<auth.users.id>', 'samourai', 'client', 'hugues@samourai-bruxelles.be', 'Hugues Polart');

-- operandi_admin (sees everything, can override)
INSERT INTO outreach.client_users (user_id, client_slug, role, email, display_name)
VALUES ('<auth.users.id>', NULL, 'operandi_admin', 'max@operandiconsultancy.com', 'Max Schock');
```

## Architecture

The dashboard is read-only for clients and read+override for admin.
All writes by the autonomous decisor happen in `operandi-services/strategist`
(Python).  This repo is purely the presentation layer.
