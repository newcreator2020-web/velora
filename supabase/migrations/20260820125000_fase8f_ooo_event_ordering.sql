-- FASE 8F: Out-of-order webhook event ordering authority.
-- Aggiunge provider_event_created_at a billing_webhook_events come
-- sorgente autorevole della data dell'evento lato provider.
-- Estende billing_apply_subscription_plan con p_provider_event_created_at
-- per rifiutare eventi out-of-order piu' vecchi dell'ultimo applicato.
-- Idempotente.

SET search_path TO public;

DROP FUNCTION IF EXISTS public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT);

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS provider_event_created_at TIMESTAMPTZ;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS billing_webhook_events_sub_ts_idx
  ON public.billing_webhook_events(provider_subscription_id, provider_event_created_at DESC)
  WHERE provider_subscription_id IS NOT NULL AND provider_event_created_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.billing_apply_subscription_plan(
  p_tenant_id UUID,
  p_target_plan TEXT,
  p_provider_event_id TEXT,
  p_provider_subscription_id TEXT,
  p_provider_event_created_at TIMESTAMPTZ DEFAULT NULL
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
  v_last_ts TIMESTAMPTZ;
BEGIN
  ok := FALSE;
  code := 'UNKNOWN';
  old_plan := NULL;
  new_plan := NULL;
  idempotent_replay := FALSE;

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

  SELECT 1 INTO v_tenant_ok FROM public.tenants WHERE id = p_tenant_id LIMIT 1;
  IF v_tenant_ok IS NULL THEN code := 'TENANT_NOT_FOUND'; RETURN NEXT; RETURN; END IF;

  SELECT 1 INTO v_sub_ok
    FROM public.billing_subscriptions
   WHERE provider = 'stripe'
     AND provider_subscription_id = p_provider_subscription_id
     AND tenant_id = p_tenant_id
   LIMIT 1;
  IF v_sub_ok IS NULL THEN code := 'SUBSCRIPTION_NOT_FOUND'; RETURN NEXT; RETURN; END IF;

  -- Idempotenza: evento gia' processato.
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

  -- Ordering authority: se p_provider_event_created_at fornito e'
  -- piu' vecchio dell'ultimo evento con data gia' persistito per la
  -- subscription → rifiuta out-of-order.
  IF p_provider_event_created_at IS NOT NULL THEN
    SELECT MAX(provider_event_created_at) INTO v_last_ts
      FROM public.billing_webhook_events
     WHERE provider = 'stripe'
       AND provider_subscription_id = p_provider_subscription_id
       AND provider_event_created_at IS NOT NULL;
    IF v_last_ts IS NOT NULL AND p_provider_event_created_at <= v_last_ts THEN
      code := 'OUT_OF_ORDER_STALE_EVENT';
      SELECT plan_id INTO v_old_plan FROM public.tenants WHERE id = p_tenant_id;
      old_plan := v_old_plan;
      new_plan := v_old_plan;
      -- Non registriamo evento per non inquinare history di replay.
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT plan_id INTO v_old_plan FROM public.tenants WHERE id = p_tenant_id;

  INSERT INTO public.billing_webhook_events(
    provider_event_id, provider, event_type, processed_at,
    provider_event_created_at, provider_subscription_id, tenant_id
  )
  VALUES (
    p_provider_event_id, 'stripe', 'billing_apply_subscription_plan', v_now,
    p_provider_event_created_at, p_provider_subscription_id, p_tenant_id
  )
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

  PERFORM set_config('app.billing_trusted', 'true', true);

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
      p_tenant_id,
      public.jsonb_build_object(
        'source', 'billing_subscription',
        'provider', 'stripe',
        'old_plan', v_old_plan,
        'new_plan', v_new_plan,
        'provider_event_id', public.left(p_provider_event_id, 16),
        'provider_subscription_id', public.left(p_provider_subscription_id, 16)
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
