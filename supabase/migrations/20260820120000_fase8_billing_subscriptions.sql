-- FASE 8: Billing subscriptions (Stripe TEST MODE)
-- Append-only. DO NOT EDIT PREVIOUS MIGRATIONS.

-- =========================================================
-- 1) billing_customers — 1 per tenant, 1 provider_customer_id univoco
-- =========================================================
CREATE TABLE IF NOT EXISTS public.billing_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_customers_tenant_provider_unique UNIQUE (tenant_id, provider),
  CONSTRAINT billing_customers_provider_customer_unique UNIQUE (provider, provider_customer_id)
);

CREATE INDEX IF NOT EXISTS billing_customers_tenant_id_idx ON public.billing_customers(tenant_id);
CREATE INDEX IF NOT EXISTS billing_customers_provider_customer_idx ON public.billing_customers(provider, provider_customer_id);

-- =========================================================
-- 2) billing_subscriptions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  provider_customer_id TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  provider_price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NULL,
  current_period_end TIMESTAMPTZ NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ended_at TIMESTAMPTZ NULL,
  provider_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_provider_subscription_unique UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_id_idx ON public.billing_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_status_idx ON public.billing_subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_subscription_idx ON public.billing_subscriptions(provider, provider_subscription_id);

-- =========================================================
-- 3) billing_webhook_events — idempotenza
-- =========================================================
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  provider_event_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  event_type TEXT NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_event_id)
);

-- =========================================================
-- 4) RLS
-- =========================================================
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

-- billing_customers: authenticated = tenant-bound select own
DROP POLICY IF EXISTS billing_customers_tenant_select ON public.billing_customers;
CREATE POLICY billing_customers_tenant_select ON public.billing_customers
  FOR SELECT USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS billing_customers_owner_insert ON public.billing_customers;
CREATE POLICY billing_customers_owner_insert ON public.billing_customers
  FOR INSERT WITH CHECK (FALSE);
DROP POLICY IF EXISTS billing_customers_owner_update ON public.billing_customers;
CREATE POLICY billing_customers_owner_update ON public.billing_customers
  FOR UPDATE USING (FALSE) WITH CHECK (FALSE);
DROP POLICY IF EXISTS billing_customers_owner_delete ON public.billing_customers;
CREATE POLICY billing_customers_owner_delete ON public.billing_customers
  FOR DELETE USING (FALSE);

-- billing_subscriptions: authenticated = tenant-bound select own
DROP POLICY IF EXISTS billing_subscriptions_tenant_select ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_tenant_select ON public.billing_subscriptions
  FOR SELECT USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS billing_subscriptions_tenant_insert ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_tenant_insert ON public.billing_subscriptions
  FOR INSERT WITH CHECK (FALSE);
DROP POLICY IF EXISTS billing_subscriptions_tenant_update ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_tenant_update ON public.billing_subscriptions
  FOR UPDATE USING (FALSE) WITH CHECK (FALSE);
DROP POLICY IF EXISTS billing_subscriptions_tenant_delete ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_tenant_delete ON public.billing_subscriptions
  FOR DELETE USING (FALSE);

-- billing_webhook_events: nessun authenticated select/write (solo service_role via bypass RLS)
DROP POLICY IF EXISTS billing_webhook_events_none ON public.billing_webhook_events;
CREATE POLICY billing_webhook_events_none ON public.billing_webhook_events
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

-- =========================================================
-- 5) Grants minimi
-- =========================================================
REVOKE ALL ON TABLE public.billing_customers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.billing_subscriptions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.billing_webhook_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.billing_customers TO authenticated;
GRANT SELECT ON TABLE public.billing_subscriptions TO authenticated;

-- =========================================================
-- 6) trigger updated_at per customers / subscriptions
-- =========================================================
DROP TRIGGER IF EXISTS trg_billing_customers_updated_at ON public.billing_customers;
CREATE TRIGGER trg_billing_customers_updated_at
  BEFORE UPDATE ON public.billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_billing_subscriptions_updated_at ON public.billing_subscriptions;
CREATE TRIGGER trg_billing_subscriptions_updated_at
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- =========================================================
-- 7) Estensione trust boundary protect_tenant_plan_id
--    Consenti UPDATE plan_id se SESSION setta app.billing_trusted = true
--    (solo SECURITY DEFINER billing può settarlo con SET LOCAL)
-- =========================================================
CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_membership_id UUID;
  v_user_role TEXT;
  v_platform_admin UUID;
  v_trusted BOOLEAN;
BEGIN
  -- (A) Billing trusted bypass: RPC billing dedicata
  BEGIN
    v_trusted := current_setting('app.billing_trusted', true)::bool;
  EXCEPTION WHEN OTHERS THEN
    v_trusted := FALSE;
  END;
  IF v_trusted IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id = OLD.plan_id THEN
    RETURN NEW;
  END IF;

  -- (B) Platform admin bypass: esistente
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

  -- (C) Owner/Member check: blocco tutti
  RAISE EXCEPTION 'direct plan_id update not allowed for this role'
    USING ERRCODE='insufficient_privilege';
END;
$$;

-- =========================================================
-- 8) RPC TRUSTED billing_apply_subscription_plan
--    Sola invocazione da server-side webhook path via service_role.
-- =========================================================
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
  v_idempotent BOOLEAN := FALSE;
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

  -- Input sanitization
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

  -- Tenant esistente
  SELECT 1 INTO v_tenant_ok FROM public.tenants WHERE id = p_tenant_id LIMIT 1;
  IF v_tenant_ok IS NULL THEN
    code := 'TENANT_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Subscription esiste (garantisce che evento sia per subscription già persistita)
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

  -- Idempotenza: già processato?
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

  -- Read plan corrente
  SELECT plan_id INTO v_old_plan FROM public.tenants WHERE id = p_tenant_id;

  -- Mark event processed (write first per idempotenza)
  INSERT INTO public.billing_webhook_events(provider_event_id, provider, event_type, processed_at)
  VALUES (p_provider_event_id, 'stripe', 'billing_apply_subscription_plan', v_now)
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  -- Same plan -> noop
  IF v_old_plan = v_new_plan THEN
    ok := TRUE;
    code := 'NOOP_SAME_PLAN';
    old_plan := v_old_plan;
    new_plan := v_new_plan;
    idempotent_replay := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Trusted transition: set local billing_trusted e UPDATE plan_id
  PERFORM set_config('app.billing_trusted', 'true', true);

  UPDATE public.tenants
    SET plan_id = v_new_plan, updated_at = v_now
    WHERE id = p_tenant_id;

  ok := TRUE;
  code := 'OK_TRANSITION';
  old_plan := v_old_plan;
  new_plan := v_new_plan;
  idempotent_replay := FALSE;

  -- Audit (PII-free): tenant.plan_changed
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
-- Service role only (grant esplicito). Anche platform_admin NON può invocarla via JWT:
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription_plan(UUID, TEXT, TEXT, TEXT) TO service_role;
