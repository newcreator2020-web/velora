-- ============================================================================
-- FASE 12C — Staff Resource Services (M2M eligibility)
--
-- Elenco servizi supportati da una risorsa (operatore/posto).
-- Semantica deterministica FASE12:
--   M2M EMPTY per la risorsa   → implicitamente ALL SERVICES (default resource)
--   M2M has ≥1 row             → solo services con M2M.active = TRUE
--     (se service specifico ha NO active row per resource = non erogabile)
--
-- Composite FK garantiscono:
--   · nessun cross-tenant resource (tenant_id,resource_id) padre
--   · nessun cross-tenant service  (tenant_id,service_id) padre
--   anche se RLS bypassato tramite service_role.
--
-- duration_override_minutes: NULLABLE schema-ready, MA in fase 12 il runtime
-- slot/booking usa SEMPRE services.duration_minutes come SoT (nessuna semantica
-- fantasma). L'override verrà abilitato in fase successiva se necessario.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.staff_resource_services (
  tenant_id UUID NOT NULL,
  resource_id UUID NOT NULL,
  service_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  duration_override_minutes INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, resource_id, service_id),
  -- Integrity cross-tenant COMPOSITE (UNIQUE prerequisiti creati in 12A)
  CONSTRAINT srs_resource_fk
    FOREIGN KEY (tenant_id, resource_id)
    REFERENCES public.staff_resources(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT srs_service_fk
    FOREIGN KEY (tenant_id, service_id)
    REFERENCES public.services(tenant_id, id) ON DELETE CASCADE,
  -- Duration override positivo (1..1440 min) — se NON NULL.
  CONSTRAINT srs_duration_positive
    CHECK (duration_override_minutes IS NULL
        OR duration_override_minutes BETWEEN 1 AND 1440)
);

-- Access pattern frequenti:
--   "quali servizi eroga X risorsa" → (tenant_id, resource_id)
--   "quali risorse erogano Y servizio" → (tenant_id, service_id)
CREATE INDEX IF NOT EXISTS srs_by_resource_idx
  ON public.staff_resource_services(tenant_id, resource_id, active);
CREATE INDEX IF NOT EXISTS srs_by_service_idx
  ON public.staff_resource_services(tenant_id, service_id, active);

-- Trigger updated_at
DO $$ BEGIN
  CREATE TRIGGER set_staff_resource_services_updated_at
  BEFORE UPDATE ON public.staff_resource_services
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS
ALTER TABLE public.staff_resource_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_resource_services FORCE ROW LEVEL SECURITY;

-- READ — tutti membri del tenant
DROP POLICY IF EXISTS srs_select_member ON public.staff_resource_services;
CREATE POLICY srs_select_member ON public.staff_resource_services
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- INSERT — owner/manager
DROP POLICY IF EXISTS srs_insert_owner_manager ON public.staff_resource_services;
CREATE POLICY srs_insert_owner_manager ON public.staff_resource_services
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- UPDATE — owner/manager (toggle active / duration override future)
DROP POLICY IF EXISTS srs_update_owner_manager ON public.staff_resource_services;
CREATE POLICY srs_update_owner_manager ON public.staff_resource_services
  FOR UPDATE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- DELETE — owner/manager (revoca eligibility)
DROP POLICY IF EXISTS srs_delete_owner_manager ON public.staff_resource_services;
CREATE POLICY srs_delete_owner_manager ON public.staff_resource_services
  FOR DELETE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- Anon: nessuna policy → deny diretto. Solo RPC pubblico filtrato espone
-- l'eligibility tramite slot V2 (12F).
