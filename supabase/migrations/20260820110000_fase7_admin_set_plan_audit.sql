-- FASE 7 — extends admin_set_tenant_plan to emit audit (PII-free plan_changed audit event).
-- Idempotent: replaces RPC with audit insert.

CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
    p_tenant_id UUID,
    p_new_plan  TEXT
) RETURNS TABLE (
    ok       BOOLEAN,
    code     TEXT,
    old_plan TEXT,
    new_plan TEXT
) LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_old_plan        TEXT;
  v_new_plan        TEXT;
  v_actor_user_id   UUID  := current_setting('app.current_user_id', true)::uuid;
  v_reason          TEXT  := 'trusted_admin_transition';
  v_changed_keys    JSONB := '["plan_id"]'::jsonb;
  v_meta            JSONB;
BEGIN
  IF p_tenant_id IS NULL OR p_new_plan IS NULL THEN
    ok := false; code := 'NULL_INPUT'; old_plan := NULL; new_plan := NULL; RETURN NEXT; RETURN; END IF;

  IF NOT public.is_platform_admin() THEN
    ok := false; code := 'NOT_PLATFORM_ADMIN'; old_plan := NULL; new_plan := NULL; RETURN NEXT; RETURN;
  END IF;

  IF p_new_plan NOT IN ('base','pro','internal_test') THEN
    ok := false; code := 'INVALID_PLAN'; old_plan := NULL; new_plan := NULL; RETURN NEXT; RETURN;
  END IF;

  SELECT t.plan_id INTO v_old_plan FROM public.tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    ok := false; code := 'TENANT_NOT_FOUND'; old_plan := NULL; new_plan := NULL; RETURN NEXT; RETURN;
  END IF;

  IF v_old_plan = p_new_plan THEN
    ok := true; code := 'OK_NOOP'; old_plan := v_old_plan; new_plan := p_new_plan; RETURN NEXT; RETURN;
  END IF;

  UPDATE public.tenants SET plan_id = p_new_plan, updated_at = NOW() WHERE id = p_tenant_id;
  v_new_plan := p_new_plan;

  v_meta := jsonb_build_object(
      'old_plan', v_old_plan,
      'new_plan', v_new_plan,
      'changed_keys', v_changed_keys,
      'reason', v_reason
  );
  BEGIN
    INSERT INTO public.audit_logs (
        id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata, created_at
    ) VALUES (
        public.gen_random_uuid(),
        p_tenant_id,
        v_actor_user_id,
        'tenant.plan_changed',
        'tenant',
        p_tenant_id,
        v_meta,
        NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  ok := true; code := 'OK'; old_plan := v_old_plan; new_plan := v_new_plan; RETURN NEXT; RETURN;
END; $$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT) TO service_role;
