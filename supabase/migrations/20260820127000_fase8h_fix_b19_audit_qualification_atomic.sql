-- FASE8h: Fix B19 audit tenant.plan_changed SECURITY DEFINER qualification failures.
-- Append-only. Nessuna modifica a FASE8a..FASE8g.
-- Root cause: SECURITY DEFINER search_path='' rendeva irrisolvibili:
--   (a) default colonna audit_logs.id = gen_random_uuid() (estensione pgcrypto in public, senza prefisso)
--   (b) chiamate public.jsonb_build_object / public.left / public.set_config (funzioni in pg_catalog, non public)
--   (c) tutto il blocco audit era wrappato in EXCEPTION WHEN OTHERS THEN NULL (audit silenziosamente perso, NON-ATOMIC).
-- Behavior finale:
--   - transition + audit COMMITTATI insieme (ATOMIC);
--   - qualsivoglia fallimento strutturale di audit solleva eccezione (fail-fast, non mascherato);
--   - qualifiche funzioni robuste per search_path vuoto.

-- 1. Default colonna id: qualifica esplicitamente public.gen_random_uuid() affinché risolva anche con search_path=''.
ALTER TABLE public.audit_logs
  ALTER COLUMN id SET DEFAULT public.gen_random_uuid();

-- 2. Rimuovi la vecchia funzione e ricrea con qualifiche corrette e comportamento ATOMIC.
DROP FUNCTION IF EXISTS public.billing_apply_subscription_plan(
  p_tenant_id uuid, p_target_plan text, p_provider_event_id text,
  p_provider_subscription_id text, p_provider_event_created_at timestamptz
);
CREATE OR REPLACE FUNCTION public.billing_apply_subscription_plan(
  p_tenant_id uuid,
  p_target_plan text,
  p_provider_event_id text,
  p_provider_subscription_id text,
  p_provider_event_created_at timestamptz DEFAULT NULL::timestamptz
)
RETURNS TABLE(ok boolean, code text, old_plan text, new_plan text, idempotent_replay boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  IF p_tenant_id IS NULL THEN
    code := 'INVALID_TENANT';
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_target_plan IS NULL OR p_target_plan NOT IN ('base','pro') THEN
    code := 'INVALID_PLAN';
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_provider_event_id IS NULL OR length(p_provider_event_id) < 4 THEN
    code := 'INVALID_EVENT_ID';
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_provider_subscription_id IS NULL OR length(p_provider_subscription_id) < 4 THEN
    code := 'INVALID_SUBSCRIPTION_ID';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT 1 INTO v_tenant_ok FROM public.tenants WHERE id = p_tenant_id LIMIT 1;
  IF v_tenant_ok IS NULL THEN
    code := 'TENANT_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT 1 INTO v_sub_ok
    FROM public.billing_subscriptions
   WHERE provider = 'stripe'
     AND provider_subscription_id = p_provider_subscription_id
     AND tenant_id = p_tenant_id
   LIMIT 1;
  IF v_sub_ok IS NULL THEN
    code := 'SUBSCRIPTION_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Idempotenza replay (B10 / E8-12): stesso evento già processato.
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

  -- Ordering authority (B16 out-of-order): rifiuta eventi vecchi rispetto a last persisted timestamp.
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

  -- Audit commerciale transition plan (B19). ATOMIC con transition:
  -- un qualunque fallimento strutturale solleva eccezione e rollback entrambi.
  -- Id campi esplicito public.gen_random_uuid() e funzioni built-in in pg_catalog
  -- (non qualificate con public.) necessari perché search_path=''.
  INSERT INTO public.audit_logs(
    id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    public.gen_random_uuid(),
    p_tenant_id,
    NULL,
    'tenant.plan_changed',
    'tenant',
    p_tenant_id,
    jsonb_build_object(
      'source', 'billing_subscription',
      'provider', 'stripe',
      'old_plan', v_old_plan,
      'new_plan', v_new_plan,
      'provider_event_id', left(p_provider_event_id, 16),
      'provider_subscription_id', left(p_provider_subscription_id, 16)
    )
  );

  ok := TRUE;
  code := 'OK_TRANSITION';
  old_plan := v_old_plan;
  new_plan := v_new_plan;
  idempotent_replay := FALSE;

  RETURN NEXT;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.billing_apply_subscription_plan(
  uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription_plan(
  uuid, text, text, text, timestamptz
) TO postgres, service_role;

-- 3. Stesso qualifica fix per admin_set_tenant_plan per coerenza.
DROP FUNCTION IF EXISTS public.admin_set_tenant_plan(
  p_target_tenant uuid, p_new_plan text, p_admin_id uuid, p_reason text
);
CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
  p_target_tenant uuid,
  p_new_plan text,
  p_admin_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS TABLE(ok boolean, code text, old_plan text, new_plan text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  PERFORM set_config('app.billing_trusted', 'true', true);
  UPDATE public.tenants
     SET plan_id = v_new, updated_at = now()
   WHERE id = p_target_tenant;

  -- Audit amministrativo: ATOMIC con transition per lo stesso motivo di billing.
  INSERT INTO public.audit_logs(
    id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
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

  ok := TRUE;
  code := 'OK';
  old_plan := v_old;
  new_plan := v_new;
  RETURN NEXT;
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_plan(
  uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_plan(
  uuid, text, uuid, text
) TO postgres, service_role;
