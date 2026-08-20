-- FASE 8B: SECURITY FIX trust boundary.
-- Problema: app.billing_trusted custom GUC e' user-settable da authenticated.
-- Soluzione: rimuovere GUC e usare session_user check IMMUTABILE lato server.
-- session_user anon/authenticated = user connesso non trusted.
-- session_user = postgres/supabase_admin/service_role = solo da backend path trusted.

-- 1) Nuova protect_tenant_plan_id SENZA GUC.
CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_platform_admin UUID;
BEGIN
  -- (A) same plan -> noop
  IF NEW.plan_id = OLD.plan_id THEN
    RETURN NEW;
  END IF;

  -- (B) Trusted server path: session_user NON e' un ruolo connessione end-user.
  --     Solo backend/service-role hanno connessione con questi ruoli.
  IF session_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- (C) Platform admin logged-in user bypass (esistente FASE7).
  BEGIN
    SELECT id INTO v_platform_admin
      FROM public.platform_admins
      WHERE active = TRUE
        AND auth.uid() IS NOT NULL
        AND user_id = auth.uid()
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_platform_admin := NULL; END;
  IF v_platform_admin IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'direct plan_id update not allowed for this role'
    USING ERRCODE='insufficient_privilege';
END;
$$;

GRANT EXECUTE ON FUNCTION public.protect_tenant_plan_id() TO authenticated, service_role;

-- 2) Nuova billing_apply_subscription_plan SENZA set_config app.billing_trusted.
--    Il trigger ora riconosce session_user service_role/postgres.
CREATE OR REPLACE FUNCTION public.billing_apply_subscription_plan(
  p_tenant_id UUID,
  p_target_plan TEXT,
  p_provider_event_id TEXT,
  p_provider_subscription_id TEXT
)
RETURNS TABLE (
  ok BOOL,
  code TEXT,
  old_plan TEXT,
  new_plan TEXT,
  idempotent_replay BOOL
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_plan TEXT;
  v_new_plan TEXT := p_target_plan;
  v_now TIMESTAMPTZ := now();
  v_exists_event INT;
  v_tenant_ok INT;
  v_sub_ok INT;
BEGIN
  ok := FALSE;
  code := 'UNKNOWN';
  old_plan := NULL;
  new_plan := NULL;
  idempotent_replay := FALSE;

  -- Input validation
  IF p_tenant_id IS NULL THEN code := 'INVALID_TENANT'; RETURN NEXT; RETURN; END IF;
  IF p_target_plan IS NULL OR p_target_plan NOT IN ('base','pro') THEN
    code := 'INVALID_PLAN'; RETURN NEXT; RETURN;
  END IF;
  IF p_provider_event_id IS NULL OR length(p_provider_event_id) < 4 THEN
    code := 'INVALID_EVENT_ID'; RETURN NEXT; RETURN;
  END IF;
  IF p_provider_subscription_id IS NULL OR length(p_provider_subscription_id) < 4 THEN
    code := 'INVALID_SUBSCRIPTION_ID'; RETURN NEXT; RETURN;
  END IF;

  -- Tenant esistente
  SELECT 1 INTO v_tenant_ok FROM public.tenants WHERE id = p_tenant_id LIMIT 1;
  IF v_tenant_ok IS NULL THEN code := 'TENANT_NOT_FOUND'; RETURN NEXT; RETURN; END IF;

  -- Subscription esiste e appartiene a tenant
  SELECT 1 INTO v_sub_ok
    FROM public.billing_subscriptions
    WHERE provider = 'stripe'
      AND provider_subscription_id = p_provider_subscription_id
      AND tenant_id = p_tenant_id
    LIMIT 1;
  IF v_sub_ok IS NULL THEN code := 'SUBSCRIPTION_NOT_FOUND'; RETURN NEXT; RETURN; END IF;

  -- Idempotenza
  SELECT 1 INTO v_exists_event
    FROM public.billing_webhook_events
    WHERE provider = 'stripe' AND provider_event_id = p_provider_event_id
    LIMIT 1;
  IF v_exists_event IS NOT NULL THEN
    ok := TRUE;
    code := 'IDEMPOTENT_REPLAY';
    SELECT plan_id INTO v_old_plan FROM public.tenants WHERE id = p_tenant_id;
    old_plan := v_old_plan;
    new_plan := v_old_plan;
    idempotent_replay := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT plan_id INTO v_old_plan FROM public.tenants WHERE id = p_tenant_id;

  INSERT INTO public.billing_webhook_events(provider_event_id, provider, event_type, processed_at)
  VALUES (p_provider_event_id, 'stripe', 'billing_apply_subscription_plan', v_now)
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  IF v_old_plan = v_new_plan THEN
    ok := TRUE;
    code := 'NOOP_SAME_PLAN';
    old_plan := v_old_plan;
    new_plan := v_new_plan;
    idempotent_replay := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- (Trust boundary) session_user here = service_role/postgres (GRANT solo service_role).
  -- protect_tenant_plan_id consente passaggio per session_user != anon/authenticated.
  UPDATE public.tenants
    SET plan_id = v_new_plan, updated_at = v_now
    WHERE id = p_tenant_id;

  ok := TRUE;
  code := 'OK_TRANSITION';
  old_plan := v_old_plan;
  new_plan := v_new_plan;
  idempotent_replay := FALSE;

  BEGIN
    INSERT INTO public.audit_logs(tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_tenant_id,
      NULL,
      'tenant.plan_changed',
      'tenant',
      p_tenant_id::text,
      jsonb_build_object(
        'source', 'billing_subscription',
        'provider', 'stripe',
        'old_plan', v_old_plan,
        'new_plan', v_new_plan,
        'provider_event_id', left(p_provider_event_id, 16),
        'provider_subscription_id', left(p_provider_subscription_id, 16)
      )::json
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT) TO service_role;
