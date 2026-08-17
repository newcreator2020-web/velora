-- 004: Tenant Memberships (user ↔ tenant ↔ role). Idempotent.
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff'
    CHECK (role IN ('owner','manager','staff')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','invited','suspended','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_memberships_tenant_user_key UNIQUE (tenant_id, user_id)
);

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id
  ON public.tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_role
  ON public.tenant_memberships(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_status
  ON public.tenant_memberships(status);

DROP TRIGGER IF EXISTS set_public_tenant_memberships_updated_at ON public.tenant_memberships;
CREATE TRIGGER set_public_tenant_memberships_updated_at
BEFORE UPDATE ON public.tenant_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
