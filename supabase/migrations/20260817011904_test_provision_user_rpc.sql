-- 009e - Robust test-only helper: provision (create+reset password) an auth.users row by email.
--
-- The GoTrue Admin API calls `listUsers`, `createUser`, and `updateUserById`
-- intermittently fail on some Supabase Cloud projects with messages like
-- "Database error finding users" or "Database error loading user" depending
-- on auth.instances state, partial migrations, and the GoTrue version that
-- backs the instance.
--
-- This RPC is SECURITY DEFINER (so it can write auth.users), restricted to
-- the service_role table owner / superuser only, and provides two behaviours:
--   (a) If no auth.users row exists with the given email → INSERT a new row
--       with a deterministic instance_id (picked from auth.instances) and a
--       bcrypt password hash.
--   (b) If a row already exists → reset encrypted_password, email_confirmed_at,
--       aud, role so the test suite can always sign in with the provided pw.
--
-- The function returns the final auth.users.id so the caller can re-link the
-- public.profiles / tenant_memberships / platform_admins rows to the real
-- GoTrue-produced id.

CREATE OR REPLACE FUNCTION public.test_provision_user(
    p_email      TEXT,
    p_password   TEXT,
    p_meta      JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_instance_id UUID := COALESCE(
    (SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  );
  v_id UUID;
  v_email_lc TEXT := lower(trim(both from p_email));
  v_confirmed_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_email_lc IS NULL OR length(v_email_lc) = 0 OR p_password IS NULL THEN
    RAISE EXCEPTION 'test_provision_user: email and password are required';
  END IF;

  -- (1) Look for an existing user (case-insensitive email match, oldest first).
  SELECT id
    INTO v_id
    FROM auth.users
   WHERE lower(email::text) = v_email_lc
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_id IS NULL THEN
    -- (2a) Not present: create with a fresh random UUID (GoTrue default).
    -- Keep column list short: only columns we know are stable across every
    -- Supabase GoTrue version. Others are either nullable or have defaults.
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        role,
        raw_user_meta_data,
        aud,
        is_super_admin,
        created_at,
        updated_at
    )
    VALUES (
        public.gen_random_uuid(),
        v_instance_id,
        v_email_lc,
        public.crypt(p_password, public.gen_salt('bf')),
        v_confirmed_at,
        'authenticated',
        COALESCE(p_meta, '{}'::jsonb),
        'authenticated',
        false,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_id;
  ELSE
    -- (2b) Already exists: just reset password + metadata and ensure confirmed.
    UPDATE auth.users
       SET encrypted_password  = public.crypt(p_password, public.gen_salt('bf')),
           raw_user_meta_data  = COALESCE(p_meta, raw_user_meta_data),
           email_confirmed_at   = COALESCE(email_confirmed_at, v_confirmed_at),
           aud                 = COALESCE(NULLIF(aud, ''), 'authenticated'),
           role                = COALESCE(NULLIF(role, ''), 'authenticated'),
           updated_at          = NOW()
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT, TEXT, JSONB) FROM anon, authenticated;

-- Simpler 2-arg overload so callers can skip the metadata argument.
CREATE OR REPLACE FUNCTION public.test_provision_user(p_email TEXT, p_password TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.test_provision_user($1, $2, '{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT, TEXT) FROM anon, authenticated;
