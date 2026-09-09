-- FASE 4 · M4 · T15 — WORKFLOW EDITORIALE E VERSIONAMENTO PUBBLICAZIONI
-- Stati: draft → ready_for_qa → validated → published (con rollback published→draft)
-- ENUM, tabella, RLS FORCE, indici, grants, trigger updated_at, backfill tenant esistenti.

DO $$ BEGIN
  CREATE TYPE publication_status AS ENUM (
    'draft',
    'ready_for_qa',
    'validated',
    'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.site_publication_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  status publication_status NOT NULL DEFAULT 'draft',
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  hash_sha256 TEXT NULL,
  published_at TIMESTAMPTZ NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_publication_versions FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS spv_tenant_version_idx
  ON public.site_publication_versions (tenant_id, version_number DESC);
CREATE INDEX IF NOT EXISTS spv_tenant_status_idx
  ON public.site_publication_versions (tenant_id, status);

DROP POLICY IF EXISTS spv_select_owner_or_admin ON public.site_publication_versions;
CREATE POLICY spv_select_owner_or_admin ON public.site_publication_versions
  FOR SELECT USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = site_publication_versions.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
        AND tm.status = 'active'
    )
  );

DROP POLICY IF EXISTS spv_insert_admin_or_manager ON public.site_publication_versions;
CREATE POLICY spv_insert_admin_or_manager ON public.site_publication_versions
  FOR INSERT WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = site_publication_versions.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
        AND tm.status = 'active'
    )
  );

DROP POLICY IF EXISTS spv_update_admin_or_manager ON public.site_publication_versions;
CREATE POLICY spv_update_admin_or_manager ON public.site_publication_versions
  FOR UPDATE USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = site_publication_versions.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
        AND tm.status = 'active'
    )
  ) WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = site_publication_versions.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'manager')
        AND tm.status = 'active'
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.site_publication_versions
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS spv_set_updated_at ON public.site_publication_versions;
CREATE TRIGGER spv_set_updated_at
  BEFORE UPDATE ON public.site_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- BACKFILL: per ogni tenant esistente crea 1 riga iniziale
INSERT INTO public.site_publication_versions (tenant_id, version_number, status, snapshot, published_at, note)
SELECT
  t.id,
  1 AS version_number,
  CASE WHEN t.published IS TRUE THEN 'published'::publication_status ELSE 'draft'::publication_status END AS status,
  '{}'::jsonb AS snapshot,
  CASE WHEN t.published IS TRUE THEN COALESCE(t.published_at, now()) ELSE NULL END AS published_at,
  'Backfill migrazione T15 — stato derivato da tenants.published' AS note
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;
