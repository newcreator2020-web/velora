-- ============================================================
-- FASE 15 · TASK B3 — GDPR CONSENTS
-- ============================================================
-- Tabella consensi GDPR per siti pubblici e booking.
-- MULTI-TENANT ENFORCED: RLS + tenant_id WHERE check.
-- Storage IP e User-Agent per audit conformità Art.7 GDPR.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gdpr_consent_type') THEN
    CREATE TYPE public.gdpr_consent_type AS ENUM (
      'cookie_preferences_accepted',
      'privacy_policy_read',
      'marketing_consent_granted',
      'profiling_consent_granted'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gdpr_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  type public.gdpr_consent_type NOT NULL,
  ip_address inet NULL,
  user_agent text NULL,
  consent_url text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gdpr_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gdpr_consents_anon_insert ON public.gdpr_consents;
CREATE POLICY gdpr_consents_anon_insert ON public.gdpr_consents
  FOR INSERT TO anon
  WITH CHECK (
    type IN ('cookie_preferences_accepted', 'privacy_policy_read')
  );

DROP POLICY IF EXISTS gdpr_consents_authed_owner_select ON public.gdpr_consents;
CREATE POLICY gdpr_consents_authed_owner_select ON public.gdpr_consents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE
        tm.tenant_id = gdpr_consents.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('OWNER', 'MANAGER', 'SUPER_ADMIN')
    )
  );

DROP POLICY IF EXISTS gdpr_consents_service_role_all ON public.gdpr_consents;
CREATE POLICY gdpr_consents_service_role_all ON public.gdpr_consents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT INSERT ON public.gdpr_consents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gdpr_consents TO authenticated;
GRANT ALL ON public.gdpr_consents TO service_role;

CREATE INDEX IF NOT EXISTS idx_gdpr_consents_tenant_id_created_at
  ON public.gdpr_consents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gdpr_consents_booking_id
  ON public.gdpr_consents (booking_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_consents_type
  ON public.gdpr_consents (type);
