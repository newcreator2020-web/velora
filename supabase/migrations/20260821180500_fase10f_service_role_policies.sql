-- =========================================================================
-- FASE 10F — DEFECT CLOSURE 6: SERVICE-ROLE POLICIES (FORCE RLS).
--   Dopo security tightening, ALTER TABLE ... FORCE ROW LEVEL SECURITY si
--   applica anche al role service_role usato via PostgREST.
--   Senza policy matching service_role, fixture/setup/FASE8 falliscono con
--   "permission denied" oppure 0 rows (42501 o rows=0).
--
--   Soluzione: policy minime service_role ALLOW ALL per tables.
--   NON indebolisce sicurezza: solo service_role matcha.
--
-- APPEND ONLY. Non modifico migrations FASE1-9.
-- =========================================================================

SET search_path = '';

DO $$
DECLARE
  t TEXT;
  _tbls TEXT[] := ARRAY[
    'public.tenants',
    'public.services',
    'public.business_availability',
    'public.business_profiles',
    'public.tenant_memberships',
    'public.profiles',
    'public.platform_admins',
    'public.customers',
    'public.bookings',
    'public.audit_logs',
    'public.billing_customers',
    'public.billing_subscriptions',
    'public.billing_webhook_events',
    'public.site_sections',
    'public.site_editorial_state'
  ];
BEGIN
  FOREACH t IN ARRAY _tbls LOOP
    -- Usare dynamic SQL: DROP + CREATE policy service role.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s',
                   replace(t,'public.','') || '_service_role_all', t);
    EXECUTE format('CREATE POLICY %I ON %s
                    FOR ALL TO service_role
                    USING (true) WITH CHECK (true)',
                   replace(t,'public.','') || '_service_role_all', t);
  END LOOP;
END $$;
