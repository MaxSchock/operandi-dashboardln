// Emit the SQL to create (or delete) a disposable E2E fixture user.
// The SQL is meant to be executed against Supabase with a privileged role
// (e.g. via the Supabase MCP or psql as postgres). Passwords are hashed
// in-database with pgcrypto, so nothing sensitive is stored here.
//
// Usage:
//   node create-fixture-user.js create <email> <password> <role> [client_slug]
//   node create-fixture-user.js delete <email>
//
// role: operandi_admin | client
const crypto = require("crypto");

const [, , cmd, email, password, role, clientSlug] = process.argv;

function q(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

if (cmd === "create") {
  if (!email || !password || !role) {
    console.error("usage: create <email> <password> <role> [client_slug]");
    process.exit(1);
  }
  const id = crypto.randomUUID();
  console.log(`
-- fixture user ${email} (${role}${clientSlug ? ", " + clientSlug : ""})
DO $$
DECLARE uid uuid := ${q(id)};
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    ${q(email)}, extensions.crypt(${q(password)}, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', ''
  );
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), uid,
    jsonb_build_object('sub', uid::text, 'email', ${q(email)}, 'email_verified', true),
    'email', uid::text, now(), now(), now()
  );
  INSERT INTO outreach.client_users (user_id, role, client_slug, display_name, email)
  VALUES (uid, ${q(role)}, ${clientSlug ? q(clientSlug) : "NULL"}, 'E2E Fixture', ${q(email)});
END $$;
`);
} else if (cmd === "delete") {
  if (!email) { console.error("usage: delete <email>"); process.exit(1); }
  console.log(`
-- delete fixture user ${email}
DO $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = ${q(email)};
  IF uid IS NOT NULL THEN
    DELETE FROM outreach.client_users WHERE user_id = uid;
    DELETE FROM auth.identities WHERE user_id = uid;
    DELETE FROM auth.sessions WHERE user_id = uid;
    DELETE FROM auth.refresh_tokens WHERE user_id = uid::text;
    DELETE FROM auth.users WHERE id = uid;
  END IF;
END $$;
`);
} else {
  console.error("usage: create|delete ...");
  process.exit(1);
}
