-- ============================================================
-- FASE 6 · MILESTONE M6 · TASK T18 — INTERACTION EVENTS ANALYTICS INIT
-- ============================================================
-- Tabella eventi di interazione anonimi sul sito pubblico e funnel
-- prenotazioni. RLS multi-tenant FORCE + policy solo tenant corrente.
-- Audit log tabella audit_logs già esistente (migrazione 007).
-- ============================================================

-- 1. ENUM interaction_action idempotente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interaction_action') THEN
    CREATE TYPE public.interaction_action AS ENUM (
      'click_book',
      'click_call',
      'click_whatsapp',
      'click_maps',
      'booking_started',
      'booking_confirmed',
      'booking_completed',
      'booking_cancelled',
      'page_view'
    );
  END IF;
END $$;

-- 2. Tabella interaction_events
CREATE TABLE IF NOT EXISTS public.interaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  action public.interaction_action NOT NULL,
  label TEXT NULL,
  page_slug TEXT NULL,
  referer TEXT NULL,
  user_anon_id UUID NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET NULL,
  user_agent TEXT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID NULL
);

-- 3. RLS + FORCE
ALTER TABLE public.interaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interaction_events FORCE ROW LEVEL SECURITY;

-- 4. Policies

-- 4a. SELECT: autenticati = membri del tenant o platform_admin; anon = accesso negato (RLS forza nessuna riga)
DROP POLICY IF EXISTS interaction_events_select_tenant ON public.interaction_events;
CREATE POLICY interaction_events_select_tenant ON public.interaction_events
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(tenant_id)
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS interaction_events_select_anon_forbidden ON public.interaction_events;
CREATE POLICY interaction_events_select_anon_forbidden ON public.interaction_events
  FOR SELECT TO anon
  USING (false);

-- 4b. INSERT: autenticati = membro del tenant che scrive sul suo tenant; anon = inserimento bloccato via RLS (la API usa service_role bypass)
DROP POLICY IF EXISTS interaction_events_insert_tenant ON public.interaction_events;
CREATE POLICY interaction_events_insert_tenant ON public.interaction_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS interaction_events_insert_anon_forbidden ON public.interaction_events;
CREATE POLICY interaction_events_insert_anon_forbidden ON public.interaction_events
  FOR INSERT TO anon
  WITH CHECK (false);

-- 4c. service_role: tutto permesso
DROP POLICY IF EXISTS interaction_events_service_role_all ON public.interaction_events;
CREATE POLICY interaction_events_service_role_all ON public.interaction_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Indici prestazionali
CREATE INDEX IF NOT EXISTS idx_interaction_events_tenant_occurred
  ON public.interaction_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_interaction_events_tenant_action
  ON public.interaction_events (tenant_id, action);

CREATE INDEX IF NOT EXISTS idx_interaction_events_user_anon_occurred
  ON public.interaction_events (user_anon_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_interaction_events_correlation
  ON public.interaction_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- 6. Grants
GRANT SELECT, INSERT ON public.interaction_events TO anon;
GRANT SELECT, INSERT ON public.interaction_events TO authenticated;
GRANT ALL ON public.interaction_events TO service_role;
