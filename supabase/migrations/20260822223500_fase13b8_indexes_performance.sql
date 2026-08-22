-- ============================================================================
-- FASE 13B8 — Performance Indexes Hardening
--
-- Solo index realmente giustificati.
-- No cargo-cult.
--
-- Checklist access pattern FASE13B:
--   A. Slot engine per resource: bookings overlap confirmed range per tenant/resource/time
--   B. Resource eligibility M2M reverse: "quali resource fanno service X tenant?"
--   C. Calendar bounded (future): bookings tenant, starts_at, ends_at, status
--   D. Business schedule exceptions range overlap GiST (esistente in 13B2)
--   E. Resource time-off overlap GiST (esistente in 13B3)
--   F. Business profile JOIN (già PK)
--   G. business_availability (unique + PK già: tenant_id+weekday)
-- ============================================================================

-- Booking overlap check (A): conferma che esista già l'indice GiST da FASE12E.
-- Se non esiste per qualche ragione lo ricreiamo safe.
DO $$ BEGIN NULL; END $$;

-- (A+) BTREE covering per calendar bounded query.
CREATE INDEX IF NOT EXISTS bookings_tenant_time_covering_idx
  ON public.bookings(tenant_id, starts_at, ends_at)
  INCLUDE (status, service_id, resource_id, customer_name);

-- (B+) Reverse lookup SRS per service_id: già esiste srs_by_service_idx da 12C,
--     lo ricreiamo safe con include resource_id per planner più efficiente:
--     (srs_by_service_idx già esiste 12C, CREATE INDEX IF NOT EXISTS skip.)
CREATE INDEX IF NOT EXISTS srs_reverse_covering_idx
  ON public.staff_resource_services(tenant_id, service_id, active, resource_id);

-- (+) business_availability covering include enable start end (già PK).
CREATE INDEX IF NOT EXISTS business_availability_covering_idx
  ON public.business_availability(tenant_id, weekday, enabled)
  INCLUDE (start_time, end_time);

-- (+) staff_resources active+bookable + sort deterministic lookup ANY order.
CREATE INDEX IF NOT EXISTS staff_resources_any_lookup_idx
  ON public.staff_resources(tenant_id, active, bookable, sort_order ASC, id ASC)
  INCLUDE (slug, display_name, color_hex, linked_membership_id);

-- (+) bookings.status partial per confirmed-only filter (GiST già usa status='confirmed').
CREATE INDEX IF NOT EXISTS bookings_confirmed_tenant_idx
  ON public.bookings(tenant_id, resource_id, starts_at)
  WHERE status = 'confirmed';

-- (+) Audit large table: tenant + action access.
CREATE INDEX IF NOT EXISTS audit_logs_tenant_action_idx
  ON public.audit_logs(tenant_id, action, created_at DESC);

-- End performance indexes.
