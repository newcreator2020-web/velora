-- ============================================================
-- FASE 2 · MILESTONE M2 · TASK T5 — PROSPECTS CRM INIT
-- ============================================================
-- Prospect CRM interno Velora (globale alla piattaforma, NON tenant).
-- SUPER_ADMIN ONLY: le tabelle non sono multi-tenant; possono
-- leggerle/scriverle solo gli operatori interni Velora.
-- Dedup: UNIQUE NULLS NOT DISTINCT (business_name, telefono)
--   + fallback index COALESCE per pre-PG15 anche se Supabase usa 16.
-- Prospect activities: append-only immutabile (audit storico).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prospect_status') THEN
    CREATE TYPE public.prospect_status AS ENUM (
      'mai_contattato',
      'da_chiamare',
      'chiamato',
      'richiamare',
      'interessato',
      'cliente',
      'non_interessato',
      'non_contattare'
    );
  END IF;
END $$;

-- ============================================================
-- 1. TABELLA PROSPECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  business_name text NOT NULL,
  business_category text NULL,
  comune text NOT NULL,
  telefono text NULL,
  email text NULL,
  sito_web boolean NOT NULL DEFAULT FALSE,
  sito_quality_score smallint NULL CHECK (
    sito_quality_score IS NULL
    OR sito_quality_score BETWEEN 0 AND 10
  ),
  gmb_url text NULL,
  status public.prospect_status NOT NULL DEFAULT 'mai_contattato',
  note text NULL,
  ultimo_contatto_at timestamptz NULL,
  prossimo_contatto_at timestamptz NULL,
  promoted_to_tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: nome attività + telefono sono la chiave naturale.
-- Gestisce i casi telefono = NULL tramite COALESCE per non perdere
-- record con telefono assente (PostgreSQL UNIQUE su colonna nullable
-- tratta NULL come valori distinti l'uno dall'altro).
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_unique_business_phone
  ON public.prospects (business_name, COALESCE(telefono, ''));

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospects_platform_admin_all ON public.prospects;
CREATE POLICY prospects_platform_admin_all ON public.prospects
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS prospects_service_role_all ON public.prospects;
CREATE POLICY prospects_service_role_all ON public.prospects
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO authenticated;
GRANT ALL ON public.prospects TO service_role;

-- Indici prestazionali
CREATE INDEX IF NOT EXISTS idx_prospects_status_prossimo
  ON public.prospects (status, prossimo_contatto_at ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_prospects_assigned_to
  ON public.prospects (assigned_to);
CREATE INDEX IF NOT EXISTS idx_prospects_category_comune
  ON public.prospects (business_category, comune);
CREATE INDEX IF NOT EXISTS idx_prospects_created_at
  ON public.prospects (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_promoted_tenant
  ON public.prospects (promoted_to_tenant_id)
  WHERE promoted_to_tenant_id IS NOT NULL;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_prospects_set_updated_at ON public.prospects;
CREATE TRIGGER trg_prospects_set_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================
-- 2. TABELLA PROSPECT_ACTIVITIES (append-only / storico)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prospect_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id),
  activity_kind text NOT NULL CHECK (
    activity_kind IN (
      'chiamata',
      'sms',
      'email',
      'appuntamento',
      'nota_interna',
      'cambio_stato',
      'cambio_assegnazione',
      'promosso_tenant'
    )
  ),
  summary text NOT NULL,
  outcome text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prospect_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospect_activities_platform_admin_select ON public.prospect_activities;
CREATE POLICY prospect_activities_platform_admin_select ON public.prospect_activities
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS prospect_activities_platform_admin_insert ON public.prospect_activities;
CREATE POLICY prospect_activities_platform_admin_insert ON public.prospect_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    AND author_user_id = auth.uid()
  );

DROP POLICY IF EXISTS prospect_activities_service_role_all ON public.prospect_activities;
CREATE POLICY prospect_activities_service_role_all ON public.prospect_activities
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.prospect_activities TO authenticated;
GRANT ALL ON public.prospect_activities TO service_role;

-- Indici prestazionali
CREATE INDEX IF NOT EXISTS idx_prospect_activities_prospect_created
  ON public.prospect_activities (prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_activities_author_created
  ON public.prospect_activities (author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_activities_kind
  ON public.prospect_activities (activity_kind);

-- ============================================================
-- 3. IMMUTABILITÀ: no UPDATE/DELETE su prospect_activities
-- ============================================================
CREATE OR REPLACE FUNCTION public.prospect_activities_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prospect_activities è append-only (vietato UPDATE/DELETE)';
END; $$;

DROP TRIGGER IF EXISTS trg_prospect_activities_immutable ON public.prospect_activities;
CREATE TRIGGER trg_prospect_activities_immutable
  BEFORE UPDATE OR DELETE ON public.prospect_activities
  FOR EACH ROW EXECUTE FUNCTION public.prospect_activities_immutable();
