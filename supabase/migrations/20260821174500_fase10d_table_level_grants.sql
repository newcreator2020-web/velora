-- =========================================================================
-- FASE 10D — DEFECT CLOSURE 3: TABLE-LEVEL GRANTS (RLS = secondo strato;
--   i table-level grants PostgreSQL sono il PRIMO strato, SENZA grants
--   anche policy TRUE restituisce 42501 permission denied).
--
--   Appartengono al layer security: RLS(9) + GRANT(10).
--   Customers/Bookings: grants appropriati per ruolo coerenti con policies.
--   Audit: solo service_role INSERT; public.read per dashboard NON permesso.
--
-- APPEND ONLY. Non tocco migrations FASE1-9.
-- =========================================================================

SET search_path = '';

-- =========================================================================
-- 1. public.customers
-- =========================================================================
--   anon:            REFERENCES TRIGGER TRUNCATE (no SELECT/INSERT/UPDATE/DELETE — gestito dal trusted RPC)
--   authenticated:   SELECT (policy staff/owner), INSERT/UPDATE (owner/manager) — policy decide
--   service_role:    ALL (test + trusted helpers)
--   postgres:        ALL
-- =========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;
GRANT ALL ON TABLE public.customers TO postgres;
GRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE public.customers TO anon;

-- =========================================================================
-- 2. public.bookings — rinforzo grant (FASE9 potrebbe già averli ma per
--    sicurezza dato regression FASE9 cancellation 42501, re-apply esplicito
--    selettivo coerente con policies).
-- =========================================================================
GRANT SELECT, UPDATE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.bookings TO authenticated;
GRANT ALL ON TABLE public.bookings TO service_role;
GRANT ALL ON TABLE public.bookings TO postgres;
-- Anon NIENTE SELECT/INSERT/UPDATE su bookings — tutto via trusted RPC
GRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE public.bookings TO anon;

-- =========================================================================
-- 3. public.audit_logs — INSERT solo service_role (policy + grants);
--    authenticated NON scrive direttamente.
-- =========================================================================
GRANT ALL ON TABLE public.audit_logs TO service_role;
GRANT ALL ON TABLE public.audit_logs TO postgres;
-- Authenticated/anon: NIENTE INSERT. Solo select se policy service_role permette,
-- ma in generale audit è privato e solo service può scrivere.

-- =========================================================================
-- 3bis. RESTO DELLE TABELLE core: service_role DEVE avere GRANT pieno
--    (fixture/test/freshUser/FRESHTENANT creation non possono altrimenti
--    creare tenant, services, memberships).
--    FASE8 frozen / FASE7 frozen hanno assunto grants impliciti; dopo le
--    FASE6/8 security tightening i grants si sono persi.
--    Re-apply minimo, coerente, non tocca RLS (policies rimangono enforcement).
--    USO solo tables realmente esistenti: vedere information_schema.tables.
-- =========================================================================
GRANT ALL ON TABLE public.tenants TO service_role;
-- FASE1 frozen: authenticated NON deve avere grants diretti SELECT/INSERT/UPDATE/DELETE tenants.
-- 42501 permission denied è l'enforcement corretto design FASE1.
-- Uso: authenticated accede info tenant via trusted RPC o tramite service_role server-side.
GRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE public.tenants TO authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.tenants TO anon;

GRANT ALL ON TABLE public.services TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.services TO authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.services TO anon;

GRANT ALL ON TABLE public.business_availability TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.business_availability TO authenticated;

GRANT ALL ON TABLE public.business_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.business_profiles TO authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.business_profiles TO anon;

GRANT ALL ON TABLE public.tenant_memberships TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.tenant_memberships TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.profiles TO anon;

GRANT ALL ON TABLE public.platform_admins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.platform_admins TO authenticated;

-- Billing + subscriptions tables
GRANT ALL ON TABLE public.billing_customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.billing_customers TO authenticated;

GRANT ALL ON TABLE public.billing_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.billing_subscriptions TO authenticated;

GRANT ALL ON TABLE public.billing_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.billing_webhook_events TO authenticated;

GRANT ALL ON TABLE public.site_sections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.site_sections TO authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.site_sections TO anon;

GRANT ALL ON TABLE public.site_editorial_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE public.site_editorial_state TO authenticated;
GRANT SELECT ON TABLE public.site_editorial_state TO anon;

-- =========================================================================
-- 4. Sequences customers_id_seq bookings_id_seq se presenti (serial/identity)
--    In FASE9/10 usiamo UUID quindi probabilmente non serve.
--    Forziamo GRANT usage sequences per sicurezza su supabase default.
-- =========================================================================
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
