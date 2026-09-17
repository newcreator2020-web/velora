-- ============================================================================
-- 2026-09-16 Final Gate T1 fix: test helper function test_provision_user(text,text,jsonb)
-- Used ONLY by tests/integration/auth-onboarding.test.ts provision() helper I8
--          and tests/db/fase7-entitlements.test.ts provisionUser helper.
-- Idempotent: returns existing uid if email already exists, otherwise INSERTs.
-- NO impact on production; security = SECURITY DEFINER SET search_path safe.
-- Note: pgcrypto extension is installed in schema PUBLIC (supabase-local default).
-- NOTE 2026-09-16 FINAL FIX: p_meta JSONB MUST HAVE NO DEFAULT VALUE, otherwise
--   Postgres sees OVERLOAD signatures (2-arg and 3-arg) and GRANT EXECUTE
--   ON FUNCTION (text,text,jsonb) throws "does not exist".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.test_provision_user(
  p_email TEXT,
  p_password_plain TEXT,
  p_meta JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'test_provision_user: email required';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE email = lower(trim(p_email));
  IF v_uid IS NOT NULL THEN
    RETURN v_uid;
  END IF;

  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    public.gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    public.crypt(p_password_plain, public.gen_salt('bf')),
    NOW(),
    COALESCE(p_meta ->> 'app', '{}')::jsonb,
    CASE WHEN p_meta ? 'display_name' THEN jsonb_build_object('display_name', p_meta ->> 'display_name') ELSE '{}'::jsonb END,
    NOW(),
    NOW()
  ) RETURNING id INTO v_uid;

  RETURN v_uid;
END $$;

GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO PUBLIC;
