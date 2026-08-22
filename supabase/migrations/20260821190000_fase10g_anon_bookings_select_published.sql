-- FASE 10G: anon SELECT access for booking public engine (slot conflict detection)
-- Required: public booking page calls getConfirmedBookingsRangesForService as anon user
-- to show available/unavailable slots. Without SELECT anon permission, slot engine HTTP 500.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bookings'
      AND policyname = 'bookings_anon_select_published'
  ) THEN
    CREATE POLICY bookings_anon_select_published ON public.bookings
      FOR SELECT
      TO anon
      USING (
        EXISTS (
          SELECT 1
          FROM public.tenants t
          WHERE t.id = bookings.tenant_id
            AND t.published = true
            AND t.status = 'active'::text
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.bookings TO anon;
