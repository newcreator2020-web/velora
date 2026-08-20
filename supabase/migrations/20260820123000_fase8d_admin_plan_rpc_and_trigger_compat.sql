-- =========================================================
-- FASE 8D — Admin Plan RPC + Trigger Compatibility (append-only)
-- Purpose:
-- 1. Ripristina bypass trusted per admin_set_tenant_plan usando
--    SET LOCAL app.billing_trusted = true (stesso trust boundary
--    di billing_apply_subscription_plan).
-- 2. Messaggio trigger compatibile PLAN_CHANGE_DENIED per FASE6/7.
-- =========================================================

DO $$ BEGIN
  IF to_regprocedure('public.admin_set_tenant_plan(uuid,text,uuid,text)') IS NOT NULL THEN
    -- noop
  END IF;
END $$;

-- Drop old 2-arg RPC (FASE7 baseline) to avoid "function is not unique" ambiguity.
DROP FUNCTION IF EXISTS public.admin_set_tenant_plan(uuid, text);

-- Aggiungi action 'tenant.plan_changed' alla whitelist audit_logs CHECK constraint.
ALTER TABLE IF EXISTS public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE IF EXISTS public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'system.seed','system.migration'
  ));

-- 1) Admin RPC trusted: riabilita SET LOCAL app.billing_trusted=true
--    (stesso pattern di billing_apply_subscription_plan).
CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
  p_target_tenant UUID,
  p_new_plan      TEXT,
  p_admin_id      UUID DEFAULT NULL,
  p_reason        TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok BOOL,
  code TEXT,
  old_plan TEXT,
  new_plan TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old TEXT;
  v_new TEXT;
  v_is_admin BOOL := FALSE;
  v_reason TEXT := COALESCE(left(p_reason, 240), '');
  v_actor UUID := COALESCE(p_admin_id, auth.uid());
BEGIN
  ok := FALSE;
  code := 'UNKNOWN';
  old_plan := NULL;
  new_plan := NULL;

  IF p_target_tenant IS NULL OR p_new_plan IS NULL THEN
    code := 'INVALID_INPUT';
    RETURN NEXT;
    RETURN;
  END IF;

  v_new := CASE
    WHEN lower(trim(p_new_plan)) = 'base'         THEN 'base'
    WHEN lower(trim(p_new_plan)) = 'pro'          THEN 'pro'
    WHEN lower(trim(p_new_plan)) = 'internal_test' THEN 'internal_test'
    ELSE NULL
  END;
  IF v_new IS NULL THEN
    code := 'INVALID_PLAN';
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_target_tenant) THEN
    code := 'TENANT_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Authoritative admin check: platform_admins table or passed-in admin_id resolved.
  IF v_actor IS NOT NULL THEN
    SELECT 1 INTO v_is_admin
      FROM public.platform_admins pa
     WHERE pa.user_id = v_actor
       AND pa.status = 'active'
     LIMIT 1;
  END IF;
  IF v_is_admin IS NOT TRUE THEN
    code := 'NOT_ADMIN';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT plan_id INTO v_old FROM public.tenants WHERE id = p_target_tenant;
  IF v_old = v_new THEN
    ok := TRUE;
    code := 'OK_NOOP';
    old_plan := v_old;
    new_plan := v_new;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Trusted transition (stesso boundary della billing RPC).
  PERFORM set_config('app.billing_trusted', 'true', true);
  UPDATE public.tenants
     SET plan_id = v_new, updated_at = now()
   WHERE id = p_target_tenant;

  BEGIN
    INSERT INTO public.audit_logs(id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      public.gen_random_uuid(),
      p_target_tenant,
      v_actor,
      'tenant.plan_changed',
      'tenant',
      p_target_tenant,
      jsonb_build_object(
        'source', 'admin_rpc',
        'old_plan', v_old,
        'new_plan', v_new,
        'reason', v_reason
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- audit append failure: NON-ATOMIC BY DESIGN (non rollback transition).
  END;

  ok := TRUE;
  code := 'OK';
  old_plan := v_old;
  new_plan := v_new;
  RETURN NEXT;
  RETURN;
END; $$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_plan(UUID,TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_plan(UUID,TEXT,UUID,TEXT) TO service_role, postgres, authenticated;

-- 2) Trigger BEFORE UPDATE tenants con messaggio PLAN_CHANGE_DENIED
--    per FASE6/7 test compatibility + blocca direct plan mutation utenti.
DROP TRIGGER IF EXISTS trg_before_tenants_plan_change_plan_denied ON public.tenants;
CREATE OR REPLACE FUNCTION public.trg_fn_block_direct_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_trusted BOOL;
  v_platform_admin_exists INT;
BEGIN
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;
  -- Trusted boundary #1: no end-user auth context (service_role / raw pg).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_trusted := current_setting('app.billing_trusted', true)::bool;
  EXCEPTION WHEN OTHERS THEN
    v_trusted := FALSE;
  END;
  IF v_trusted IS TRUE THEN
    RETURN NEW;
  END IF;
  SELECT 1 INTO v_platform_admin_exists
    FROM public.platform_admins pa
   WHERE pa.status = 'active'
     AND auth.uid() IS NOT NULL
     AND pa.user_id = auth.uid()
   LIMIT 1;
  IF v_platform_admin_exists = 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PLAN_CHANGE_DENIED: direct plan_id update not allowed for end-users'
    USING ERRCODE = 'insufficient_privilege';
END; $$;

CREATE TRIGGER trg_before_tenants_plan_change_plan_denied
  BEFORE UPDATE OF plan_id ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_block_direct_plan_change();

-- 4) Sovrascrivi protect_tenant_plan_id per usare platform_admins.status
--    (corregge riferimento a colonna booleana non esistente in FASE8a).
CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_platform_admin UUID;
  v_trusted BOOLEAN;
BEGIN
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;
  -- Trusted boundary #1: no end-user auth context (service_role / raw pg).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_trusted := current_setting('app.billing_trusted', true)::bool;
  EXCEPTION WHEN OTHERS THEN
    v_trusted := FALSE;
  END;
  IF v_trusted IS TRUE THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT pa.user_id INTO v_platform_admin
      FROM public.platform_admins pa
     WHERE pa.status = 'active'
       AND auth.uid() IS NOT NULL
       AND pa.user_id = auth.uid()
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_platform_admin := NULL;
  END;
  IF v_platform_admin IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PLAN_CHANGE_DENIED: direct plan_id update not allowed for this role'
    USING ERRCODE='insufficient_privilege';
END; $$;

-- 5) Ensure utility provision user per tests FASE6/7 (non solo transient).
--    Idempotent CREATE OR REPLACE + grant a service_role/postgres.
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
    INSERT INTO public.profiles(id, display_name) VALUES (v_id, v_email_lc) ON CONFLICT (id) DO NOTHING;
  ELSE
    UPDATE auth.users SET
      encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, v_confirmed_at),
      raw_user_meta_data = COALESCE(p_meta, raw_user_meta_data),
      aud = COALESCE(NULLIF(aud,''),'authenticated'),
      role = COALESCE(NULLIF(role,''),'authenticated'),
      updated_at = NOW()
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END; $inner$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO service_role, postgres;
