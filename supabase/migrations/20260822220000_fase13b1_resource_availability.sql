-- ============================================================================
-- FASE 13B1 — Resource Availability (multi-interval per weekday)
--
-- Semantica:
--   0 rows ENABLED = per (resource, weekday) → INHERIT business_availability
--   ≥1 rows ENABLED = usa ESCLUSIVAMENTE i range definiti in questa tabella
--
-- Multi-interval:
--   consente pattern 09:00-13:00 + 14:00-18:00 sullo stesso weekday.
--   NON usare PK(tenant_id,resource_id,weekday) per questo motivo.
--
-- Tenant-bound composite FK verso staff_resources per garantire che
-- resource_id appartenga davvero al tenant, anche se RLS bypassato.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.resource_availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No zero-length intervals
  CONSTRAINT resource_availability_valid_range CHECK (start_time < end_time),

  -- Composite FK: cross-tenant fail-closed, anche con service_role bypass.
  CONSTRAINT resource_availability_resource_fk
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES public.staff_resources(tenant_id, id) ON DELETE CASCADE,

  -- Uniqueness utile solo per evitare duplicati identici inseriti due volte.
  -- NON limita il multi-interval (start_time differenzia).
  CONSTRAINT resource_availability_unique_row
    UNIQUE (tenant_id, resource_id, weekday, start_time, end_time)
);

-- Access pattern: per weekday/resource/tenant in slot engine
CREATE INDEX IF NOT EXISTS resource_availability_lookup_idx
  ON public.resource_availability(tenant_id, resource_id, weekday, enabled)
  INCLUDE (start_time, end_time);

CREATE INDEX IF NOT EXISTS resource_availability_tenant_idx
  ON public.resource_availability(tenant_id);

-- Trigger updated_at
DO $$ BEGIN
  CREATE TRIGGER set_resource_availability_updated_at
  BEFORE UPDATE ON public.resource_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS
ALTER TABLE public.resource_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_availability FORCE ROW LEVEL SECURITY;

-- READ: all tenant members
DROP POLICY IF EXISTS resource_availability_select_member ON public.resource_availability;
CREATE POLICY resource_availability_select_member ON public.resource_availability
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- INSERT: owner / manager
DROP POLICY IF EXISTS resource_availability_insert_owner_manager ON public.resource_availability;
CREATE POLICY resource_availability_insert_owner_manager ON public.resource_availability
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- UPDATE: owner / manager
DROP POLICY IF EXISTS resource_availability_update_owner_manager ON public.resource_availability;
CREATE POLICY resource_availability_update_owner_manager ON public.resource_availability
  FOR UPDATE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- DELETE: owner / manager (rimozione intervallo inutile / fine settimana).
DROP POLICY IF EXISTS resource_availability_delete_owner_manager ON public.resource_availability;
CREATE POLICY resource_availability_delete_owner_manager ON public.resource_availability
  FOR DELETE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- Anon: nessuna policy direct.
-- Service role: esplicito grant justified per test harness + helper trusted.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_availability TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resource_availability TO authenticated;
