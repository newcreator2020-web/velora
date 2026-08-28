-- FASE 14C — Re-ensure public.test_provision_user() utility.
-- (append-only). Migrazioni 011904 crea, 100010 droppa, 123000 ricrea.
-- In alcuni ambienti di reset la funzione non viene ricreata per ordine o
-- istruzioni DROP/GRANT successive; questa migration garantisce la presenza
-- della funzione service-only (service_role + postgres grant, NO public/no anon/no authenticated).

CREATE OR REPLACE FUNCTION public.test_provision_user(p_email text, p_password text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $inner$
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
    RAISE EXCEPTION 'test_provision_user: email and password required';
  END IF;
  SELECT id INTO v_id FROM auth.users WHERE lower(email::text) = v_email_lc ORDER BY created_at ASC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, raw_user_meta_data, aud, is_super_admin, created_at, updated_at)
    VALUES (public.gen_random_uuid(), v_instance_id, v_email_lc, public.crypt(p_password, public.gen_salt('bf')), v_confirmed_at, 'authenticated', COALESCE(p_meta,'{}'::jsonb), 'authenticated', false, NOW(), NOW())
    RETURNING id INTO v_id;
    INSERT INTO public.profiles(id, display_name) VALUES (v_id, coalesce(p_meta->>'display_name', coalesce(p_meta->>'full_name', v_email_lc))) ON CONFLICT (id) DO NOTHING;
  ELSE
    UPDATE auth.users SET
      encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, v_confirmed_at),
      raw_user_meta_data = COALESCE(p_meta, raw_user_meta_data),
      aud = COALESCE(NULLIF(aud,''),'authenticated'),
      role = COALESCE(NULLIF(role,''),'authenticated'),
      updated_at = NOW()
    WHERE id = v_id;
    INSERT INTO public.profiles(id, display_name) VALUES (v_id, coalesce(p_meta->>'display_name', coalesce(p_meta->>'full_name', v_email_lc))) ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN v_id;
END; $inner$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO service_role, postgres;
