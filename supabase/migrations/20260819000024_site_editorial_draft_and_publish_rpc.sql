-- 024: Site Editorial (Draft/Preview/Publish) per Site Management Studio.
-- Append-only. Idempotent. Does NOT modify rows / policies / structures in 001..023.
-- ADR FASE 6 MODELLO: Draft isolato in tabella 1:1. Published = row esistenti (FASE5 SoT).
--   Draft non esce mai nell'anon. Publish = transazione atomica copia draft->published.

-- ============================================================
-- A) SITE_EDITORIAL_STATE (Draft singleton 1:1 con tenant)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_editorial_state (
  tenant_id UUID NOT NULL PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sections) = 'array'),
  services JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(services) = 'array'),
  theme JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(theme) = 'object'),
  draft_revision UUID NOT NULL DEFAULT gen_random_uuid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_site_editorial_state_updated_at ON public.site_editorial_state;
CREATE TRIGGER trg_site_editorial_state_updated_at
  BEFORE UPDATE ON public.site_editorial_state
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

ALTER TABLE public.site_editorial_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE 'ALTER TABLE public.site_editorial_state FORCE ROW LEVEL SECURITY';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_editorial_state TO authenticated;

DROP POLICY IF EXISTS editorial_select_member_or_platform ON public.site_editorial_state;
CREATE POLICY editorial_select_member_or_platform ON public.site_editorial_state
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS editorial_write_owner_manager_or_platform ON public.site_editorial_state;
CREATE POLICY editorial_write_owner_manager_or_platform ON public.site_editorial_state
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS editorial_update_owner_manager_or_platform ON public.site_editorial_state;
CREATE POLICY editorial_update_owner_manager_or_platform ON public.site_editorial_state
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS editorial_delete_owner_manager_or_platform ON public.site_editorial_state;
CREATE POLICY editorial_delete_owner_manager_or_platform ON public.site_editorial_state
  FOR DELETE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

-- ============================================================
-- B) SECURITY DEFINER: PUBLISH ATOMICO
--    Copia site_editorial_state → tabelle published (site_sections, services, business_profiles.theme_*)
--    e setta tenants.published=true + published_at.
--    Transazione implicita (è una singola RPC). RLS verificata via has_tenant_role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_site_draft(p_tenant_id UUID, p_expected_revision UUID DEFAULT NULL)
RETURNS TABLE (
  ok BOOLEAN,
  code TEXT,
  message TEXT,
  new_published_at TIMESTAMPTZ,
  sections_applied INTEGER,
  services_applied INTEGER,
  theme_applied BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_uid UUID;
  v_row RECORD;
  v_draft_rev UUID;
  v_now TIMESTAMPTZ := NOW();
  v_sec JSONB;
  v_svc JSONB;
  v_theme JSONB;
  v_s JSONB;
  v_sections_len INTEGER := 0;
  v_services_len INTEGER := 0;
  v_theme_done BOOLEAN := FALSE;
  v_primary TEXT;
  v_background TEXT;
  v_foreground TEXT;
  v_muted TEXT;
  v_radius TEXT;
  v_head TEXT;
  v_body TEXT;
BEGIN
  v_actor_uid := auth.uid();

  IF v_actor_uid IS NULL THEN
    ok := FALSE;
    code := 'AUTH';
    message := 'Non autenticato.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT (
    public.has_tenant_role(p_tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  ) THEN
    ok := FALSE;
    code := 'AUTHZ';
    message := 'Non sei autorizzato a pubblicare questo sito.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT INTO v_row sections, services, theme, draft_revision
    FROM public.site_editorial_state
   WHERE tenant_id = p_tenant_id
   LIMIT 1;

  IF v_row IS NULL THEN
    ok := FALSE;
    code := 'NO_DRAFT';
    message := 'Nessuna bozza disponibile per questo tenant.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  v_sec := v_row.sections;
  v_svc := v_row.services;
  v_theme := v_row.theme;
  v_draft_rev := v_row.draft_revision;

  IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_draft_rev THEN
    ok := FALSE;
    code := 'CONCURRENT';
    message := 'Bozza modificata in un''altra sessione. Ricarica e riprova.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Step 1: Published sections
  DELETE FROM public.site_sections WHERE tenant_id = p_tenant_id;
  v_sections_len := jsonb_array_length(v_sec);
  IF v_sections_len > 0 THEN
    FOR v_s IN SELECT * FROM jsonb_array_elements(v_sec) LOOP
      INSERT INTO public.site_sections (tenant_id, section_type, position, enabled, variant, settings)
      VALUES (
        p_tenant_id,
        COALESCE(NULLIF((v_s->>'section_type')::TEXT,''),'hero'),
        COALESCE((v_s->>'position')::INTEGER,0),
        COALESCE((v_s->>'enabled')::BOOLEAN,TRUE),
        COALESCE(NULLIF((v_s->>'variant')::TEXT,''),'default'),
        COALESCE(v_s->'settings','{}'::jsonb)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Step 2: Published services
  DELETE FROM public.services WHERE tenant_id = p_tenant_id;
  v_services_len := jsonb_array_length(v_svc);
  IF v_services_len > 0 THEN
    FOR v_s IN SELECT * FROM jsonb_array_elements(v_svc) LOOP
      INSERT INTO public.services (tenant_id, name, description, price_from, currency, duration_minutes, position, active)
      VALUES (
        p_tenant_id,
        COALESCE(NULLIF((v_s->>'name')::TEXT,''),'Servizio'),
        NULLIF((v_s->>'description')::TEXT,''),
        CASE WHEN (v_s->>'price_from')::TEXT <> '' THEN (v_s->>'price_from')::NUMERIC(10,2) ELSE NULL END,
        COALESCE(NULLIF((v_s->>'currency')::TEXT,''),'EUR'),
        CASE WHEN (v_s->>'duration_minutes')::TEXT <> '' THEN (v_s->>'duration_minutes')::INTEGER ELSE NULL END,
        COALESCE((v_s->>'position')::INTEGER,0),
        COALESCE((v_s->>'active')::BOOLEAN,TRUE)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Step 3: Theme published to business_profiles.theme_* structured columns
  v_primary    := NULLIF((v_theme->>'primary')::TEXT,'');
  v_background := NULLIF((v_theme->>'background')::TEXT,'');
  v_foreground := NULLIF((v_theme->>'foreground')::TEXT,'');
  v_muted      := NULLIF((v_theme->>'muted')::TEXT,'');
  v_radius     := NULLIF((v_theme->>'radius')::TEXT,'');
  v_head       := NULLIF((v_theme->>'headingFont')::TEXT,'');
  v_body       := NULLIF((v_theme->>'bodyFont')::TEXT,'');

  UPDATE public.business_profiles
     SET theme_primary            = v_primary,
         theme_background         = v_background,
         theme_foreground         = v_foreground,
         theme_muted              = v_muted,
         theme_radius             = v_radius,
         theme_heading_font_preset = v_head,
         theme_body_font_preset   = v_body,
         updated_at               = v_now
   WHERE tenant_id = p_tenant_id;
  v_theme_done := TRUE;

  -- Step 4: Segna published
  UPDATE public.tenants
     SET published    = TRUE,
         published_at = v_now,
         updated_at   = v_now
   WHERE id = p_tenant_id;

  ok := TRUE;
  code := 'OK';
  message := 'Pubblicazione completata.';
  new_published_at := v_now;
  sections_applied := v_sections_len;
  services_applied := v_services_len;
  theme_applied := v_theme_done;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_site_draft(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_site_draft(UUID, UUID) TO authenticated;

-- ============================================================
-- C) INDEX aggiuntivi per le policies esistenti (non alterano 022/023)
-- ============================================================
CREATE INDEX IF NOT EXISTS editorial_tenant_idx
  ON public.site_editorial_state(tenant_id);
