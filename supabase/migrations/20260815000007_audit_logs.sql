-- 007: Audit Logs (append-only). Idempotent.
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL
    CHECK (action IN (
      'tenant.created','tenant.updated','tenant.status_changed',
      'membership.created','membership.updated','membership.revoked',
      'profile.updated','business_profile.updated',
      'platform_admin.granted','platform_admin.revoked',
      'system.seed','system.migration'
    )),
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
-- Intentionally NO policies: only service_role bypass can read/write.

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs(action, created_at DESC);

DROP TRIGGER IF EXISTS audit_logs_immutable_trigger ON public.audit_logs;
CREATE TRIGGER audit_logs_immutable_trigger
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

DROP TRIGGER IF EXISTS audit_logs_notify_trigger ON public.audit_logs;
CREATE TRIGGER audit_logs_notify_trigger
AFTER INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.audit_notify();
