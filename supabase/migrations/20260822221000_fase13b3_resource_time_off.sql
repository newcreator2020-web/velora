-- ============================================================================
-- FASE 13B3 — Resource Time Off
--
-- Tipi: vacation / sick / leave / training / custom_block.
--
-- Range semantica: [starts_at, ends_at) half-open TSTZ (UTC interno).
-- Comportamento slot engine: nasconde TUTTI gli slot della risorsa
-- overlapping, NON cancella prenotazioni esistenti (fail-soft per l'utente,
-- genera warning operativo nelle fasi successive).
--
-- In questa fase 13B nessun auto-cancel, nessuna notifica.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resource_time_off (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  time_off_type TEXT NOT NULL
    CHECK (time_off_type IN ('vacation','sick','leave','training','custom_block')),
  title TEXT NULL CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 160),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT resource_time_off_valid_range CHECK (starts_at < ends_at),

  CONSTRAINT resource_time_off_max_window
    CHECK ((ends_at - starts_at) <= INTERVAL '365 days'),

  -- Composite FK cross-tenant fail closed
  CONSTRAINT resource_time_off_resource_fk
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES public.staff_resources(tenant_id, id) ON DELETE CASCADE
);

-- GiST overlap per slot engine e calendar
CREATE INDEX IF NOT EXISTS resource_time_off_overlap_idx
  ON public.resource_time_off
  USING GIST (tenant_id, resource_id, tstzrange(starts_at, ends_at, '[)'));

CREATE INDEX IF NOT EXISTS resource_time_off_tenant_resource_idx
  ON public.resource_time_off(tenant_id, resource_id, starts_at);

DO $$ BEGIN
  CREATE TRIGGER set_resource_time_off_updated_at
  BEFORE UPDATE ON public.resource_time_off
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.resource_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_time_off FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rto_select_member ON public.resource_time_off;
CREATE POLICY rto_select_member ON public.resource_time_off
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS rto_insert_owner_manager ON public.resource_time_off;
CREATE POLICY rto_insert_owner_manager ON public.resource_time_off
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS rto_update_owner_manager ON public.resource_time_off;
CREATE POLICY rto_update_owner_manager ON public.resource_time_off
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS rto_delete_owner_manager ON public.resource_time_off;
CREATE POLICY rto_delete_owner_manager ON public.resource_time_off
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_time_off TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_time_off TO authenticated;
