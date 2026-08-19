-- FASE 7: Tenant Plan + Entitlements Foundation.
-- Append-only. Idempotent. NO rewrite delle migration congelate.
-- Safety: self-escalation plan_id DENIED via trigger; solo RPC trusted admin.

-- ============================================================
-- 1) Column: tenants.plan_id + CHECK allowed
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tenants' AND column_name='plan_id'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'base';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='tenants' AND c.conname='tenants_plan_id_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_plan_id_check
      CHECK (plan_id IN ('base','pro','internal_test'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_plan_id
  ON public.tenants(plan_id);

-- ============================================================
-- 2) Trigger: protect tenant.plan_id from non-admin writes
--    Owner/manager CANNOT self-escalate BASE->PRO
--    ONLY platform_admin (via RPC or direct) can change.
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
BEGIN
  IF OLD.plan_id IS DISTINCT FROM NEW.plan_id THEN
    IF NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'PLAN_CHANGE_DENIED'
        USING DETAIL = 'only platform_admin can change plan_id';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tenants_protect_plan_id ON public.tenants;
CREATE TRIGGER trg_tenants_protect_plan_id
BEFORE UPDATE OF plan_id ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_plan_id();

GRANT EXECUTE ON FUNCTION public.protect_tenant_plan_id() TO authenticated, service_role;

-- ============================================================
-- 3) Trusted RPC: admin_set_tenant_plan
--    Only platform_admin caller.
--    SECURITY DEFINER per bypassare RLS/trigger caller check
--    (ma ricontrolliamo is_platform_admin() comunque fail-closed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
  p_tenant_id UUID,
  p_new_plan TEXT
) RETURNS TABLE (
  ok BOOLEAN,
  code TEXT,
  old_plan TEXT,
  new_plan TEXT
) LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  _old TEXT;
  _valid_plans CONSTANT TEXT[] := ARRAY['base','pro','internal_test'];
BEGIN
  ok := false;
  code := 'UNKNOWN';
  old_plan := NULL;
  new_plan := NULL;

  IF NOT public.is_platform_admin() THEN
    code := 'NOT_PLATFORM_ADMIN';
    RETURN NEXT; RETURN;
  END IF;

  IF p_tenant_id IS NULL OR p_new_plan IS NULL THEN
    code := 'NULL_INPUT';
    RETURN NEXT; RETURN;
  END IF;

  IF p_new_plan <> ANY(_valid_plans) THEN
    code := 'INVALID_PLAN';
    RETURN NEXT; RETURN;
  END IF;

  SELECT t.plan_id INTO _old FROM public.tenants t WHERE t.id = p_tenant_id;
  IF NOT FOUND THEN
    code := 'TENANT_NOT_FOUND';
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.tenants t
     SET plan_id = p_new_plan, updated_at = NOW()
   WHERE t.id = p_tenant_id;

  ok := true;
  code := 'OK';
  old_plan := _old;
  new_plan := p_new_plan;
  RETURN NEXT; RETURN;
END; $$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_plan(UUID, TEXT)
  TO authenticated, service_role;

-- ============================================================
-- 4) Audit action: add tenant.plan_changed to audit_logs CHECK
--    (append-only, non distruttivo).
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'site_editorial_draft_saved','site_published','site_unpublished',
    'platform_admin.granted','platform_admin.revoked',
    'system.seed','system.migration'
  ));
