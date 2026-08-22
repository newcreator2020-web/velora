-- ============================================================================
-- FASE 12A — Staff Resources (Hybrid Default-Resource Model)
-- APPEND-ONLY. Non modifica migration FASE1..FASE11B.
--
-- Requisiti:
--  1. UNIQUE(tenant_id,id) PRE-REQUISITO COMPOSITE FK per tutte le tabelle
--     che useranno (tenant_id,X) REFERENCES parent(tenant_id,id).
--     Necessario per linked_membership_id -> tenant_memberships e per
--     staff_resource_services -> services (12C) e bookings -> staff_resources (12D).
--  2. staff_resources: risorse operative (operatori/posti/attrezzature).
--     0 PII: nessuna email, telefono, indirizzo; solo nome/slug/stato/colore.
--  3. linked_membership_id composite integrity: MAI membership di tenant B
--     possa essere linkata a resource di tenant A.
--  4. ENABLE + FORCE RLS + policies scoped (member read, owner/manager write).
--  5. Triggers: updated_at + audit (audit completo in 12H).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PREREQUISITI COMPOSITE FK: UNIQUE(tenant_id,id) sulle tabelle padre
-- che NON sono nate già con questa constraint.
-- PK è (id), ma per composite FK serve UNIQUE(column_pair) esatto.
-- Fail-safe IF NOT EXISTS.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'services'
      AND c.conname = 'services_tenant_id_id_key'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'tenant_memberships'
      AND c.conname = 'tenant_memberships_tenant_id_id_key'
  ) THEN
    ALTER TABLE public.tenant_memberships
      ADD CONSTRAINT tenant_memberships_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- TABELLA staff_resources
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_resources (
  id UUID NOT NULL PRIMARY KEY DEFAULT public.gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  bookable BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color_hex TEXT NULL,
  linked_membership_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Length & domain constraints
  CONSTRAINT staff_resources_display_name_not_blank
    CHECK (char_length(BTRIM(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT staff_resources_slug_len
    CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$'),
  CONSTRAINT staff_resources_sort_order_nonneg CHECK (sort_order >= 0),
  CONSTRAINT staff_resources_color_hex_format
    CHECK (color_hex IS NULL OR color_hex ~* '^#[0-9A-F]{6}$')
);

-- Prerequisito composite FK per riferimenti futuri (bookings.resource_id 12D)
ALTER TABLE public.staff_resources
  ADD CONSTRAINT staff_resources_tenant_id_id_key UNIQUE (tenant_id, id);

-- Slug tenant-unique deterministico (per UI public e ANY selezione)
ALTER TABLE public.staff_resources
  ADD CONSTRAINT staff_resources_tenant_slug_key UNIQUE (tenant_id, slug);

-- Composite FK cross-tenant proof per linked_membership_id.
-- Se un client/service_role bypassa RLS e prova a linkare membership
-- di tenant B a resource di tenant A → FK constraint VIOLAZIONE DIRETTA.
ALTER TABLE public.staff_resources
  ADD CONSTRAINT staff_resources_linked_membership_tenant_fk
  FOREIGN KEY (tenant_id, linked_membership_id)
  REFERENCES public.tenant_memberships(tenant_id, id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_resources_tenant_idx
  ON public.staff_resources(tenant_id);
CREATE INDEX IF NOT EXISTS staff_resources_tenant_active_bookable_idx
  ON public.staff_resources(tenant_id, active, bookable);
CREATE INDEX IF NOT EXISTS staff_resources_sort_idx
  ON public.staff_resources(tenant_id, sort_order ASC, id ASC);
CREATE INDEX IF NOT EXISTS staff_resources_linked_membership_idx
  ON public.staff_resources(linked_membership_id);

-- ----------------------------------------------------------------------------
-- Trigger updated_at (set_current_timestamp_updated_at esiste già FASE9a)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER set_staff_resources_updated_at
  BEFORE UPDATE ON public.staff_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- RLS: ENABLE + FORCE
-- ----------------------------------------------------------------------------
ALTER TABLE public.staff_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_resources FORCE ROW LEVEL SECURITY;

-- READ — tutti i membri del tenant (owner/manager/staff) possono leggere.
DROP POLICY IF EXISTS staff_resources_select_member ON public.staff_resources;
CREATE POLICY staff_resources_select_member ON public.staff_resources
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- INSERT — owner e manager.
DROP POLICY IF EXISTS staff_resources_insert_owner_manager ON public.staff_resources;
CREATE POLICY staff_resources_insert_owner_manager ON public.staff_resources
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- UPDATE — owner e manager (non staff).
DROP POLICY IF EXISTS staff_resources_update_owner_manager ON public.staff_resources;
CREATE POLICY staff_resources_update_owner_manager ON public.staff_resources
  FOR UPDATE
  TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

-- DELETE — non previsto in FASE12. Fail-closed (nessuna policy = 0 rows delete).
-- Soft-deactivate tramite active=false. Hard delete solo service_role justified.

-- Service Role: grants minimi espliciti (già possiede tutto implicitamente;
-- questa policy esplicita è documentazione). Authenticated only access via RLS.
-- Anon: nessuna policy su anon → direct SELECT denied (solo RPC pubbliche
-- PII-free filtrate in 12F/12G espongono dati necessari).
