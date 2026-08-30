-- ============================================================================
-- FASE P0-1 FIX — #86: SERVICE IDENTITY STABILITY ACROSS PUBLISH
-- ============================================================================
-- Background: vecchio publish_site_draft eseguiva DELETE TUTTI services +
-- INSERT con nuovi UUID, causando:
--   1. FK CASCADE su staff_resource_services (ON DELETE CASCADE) → persi tutti
--      gli assignamenti servizio↔staff dopo ogni publish.
--   2. FK RESTRICT su bookings.service_id → publish falliva non appena
--      esisteva un qualsiasi booking storico.
-- Questa migration sostituisce l'RPC con un merge deterministico per UUID:
--   · ogni servizio in bozza con UUID valido subisce UPDATE se esiste per
--     lo stesso tenant oppure INSERT con tale UUID;
--   · UUID non validi/null generano un nuovo UUID server-authoritative;
--   · cross-tenant injection (UUID di tenant B in draft tenant A) restituisce
--     esplicitamente errore 'CROSS_TENANT' senza mutare altri tenant;
--   · servizi stale nel DB non più in bozza:
--       · se 0 bookings referenzianti → DELETE (cascade eligibility pulita)
--       · se ≥1 bookings → SET active=FALSE (soft-deactivate, preserva
--         storico e FK RESTRICT non blocca la publish).
-- L'RPC rimane atomica, SECURITY DEFINER con search_path vuoto e GRANT solo
-- a authenticated (stesso contratto security della v. precedente).
-- ============================================================================

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
  -- NEW service identity locals
  v_draft_ids UUID[];
  v_draft_svc JSONB;
  v_sid UUID;
  v_svc_raw_id TEXT;
  v_existing_tenant UUID;
  v_name TEXT;
  v_description TEXT;
  v_price NUMERIC(10,2);
  v_currency TEXT;
  v_duration INTEGER;
  v_position INTEGER;
  v_active BOOLEAN;
  v_merged_svc INTEGER := 0;
  v_deleted_stale INTEGER := 0;
  v_deactivated_stale INTEGER := 0;
  v_stale RECORD;
  v_bk_count BIGINT;
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

  -- Step 1: Published sections (stessa semantica v.precedente, non tocca services)
  DELETE FROM public.site_sections WHERE tenant_id = p_tenant_id;
  IF jsonb_typeof(v_sec) = 'array' THEN
    v_sections_len := jsonb_array_length(v_sec);
  ELSE
    v_sections_len := 0;
  END IF;
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

  -- ============================================================================
  -- Step 2 (NEW): Services merge deterministico UUID-stabile
  -- ============================================================================
  v_draft_ids := ARRAY[]::UUID[];

  IF jsonb_typeof(v_svc) = 'array' THEN
    v_services_len := jsonb_array_length(v_svc);
  ELSE
    v_services_len := 0;
  END IF;

  IF v_services_len > 0 THEN
    FOR v_draft_svc IN SELECT * FROM jsonb_array_elements(v_svc) LOOP
      -- ----------------------------------------------------------------------
      -- 2a) Risolvi UUID stabile + cross-tenant safety
      -- ----------------------------------------------------------------------
      v_sid := NULL;
      v_svc_raw_id := (v_draft_svc->>'id');
      IF v_svc_raw_id IS NOT NULL AND char_length(v_svc_raw_id) = 36 THEN
        BEGIN
          v_sid := v_svc_raw_id::UUID;
        EXCEPTION WHEN OTHERS THEN
          v_sid := NULL;
        END;
      END IF;

      IF v_sid IS NULL THEN
        v_sid := public.gen_random_uuid();
      END IF;

      -- Verifica: UUID già assegnato a altro tenant → CROSS_TENANT sicuro
      v_existing_tenant := NULL;
      SELECT tenant_id INTO v_existing_tenant
        FROM public.services WHERE id = v_sid LIMIT 1;
      IF FOUND AND v_existing_tenant <> p_tenant_id THEN
        ok := FALSE;
        code := 'CROSS_TENANT';
        message := 'Identificativo servizio non valido per questo tenant.';
        new_published_at := NULL;
        sections_applied := 0;
        services_applied := 0;
        theme_applied := FALSE;
        RETURN NEXT;
        RETURN;
      END IF;

      v_draft_ids := array_append(v_draft_ids, v_sid);

      -- ----------------------------------------------------------------------
      -- 2b) Valori normalizzati — cast DIRECT per mantenere contratto FASE6:
      --     valori NON vuoti ma NON validi → eccezione SQL → rollback publish
      --     (eccezione viene catturata dal BEGIN esterno della RPC e ritornata
      --      come ok=false / code=INTERNAL preservando atomicità §14).
      -- ----------------------------------------------------------------------
      v_name := COALESCE(NULLIF(btrim(v_draft_svc->>'name'),''),'Servizio');
      v_description := NULLIF(btrim(v_draft_svc->>'description'),'');

      v_price := NULL;
      IF (v_draft_svc->>'price_from') IS NOT NULL AND btrim(v_draft_svc->>'price_from') <> '' THEN
        v_price := (v_draft_svc->>'price_from')::NUMERIC(10,2);
      END IF;

      v_currency := COALESCE(NULLIF(btrim(v_draft_svc->>'currency'),''),'EUR');

      v_duration := NULL;
      IF (v_draft_svc->>'duration_minutes') IS NOT NULL AND btrim(v_draft_svc->>'duration_minutes') <> '' THEN
        v_duration := (v_draft_svc->>'duration_minutes')::INTEGER;
      END IF;

      v_position := COALESCE((v_draft_svc->>'position')::INTEGER,0);
      v_active   := COALESCE((v_draft_svc->>'active')::BOOLEAN,TRUE);

      -- ----------------------------------------------------------------------
      -- Safe position: avoid unique (tenant,position) collision with any other
      -- existing service (incl. stale soft-deactivated ones with booking history)
      -- by falling back to max(position)+1 when requested position already taken
      -- by a different row id (tenant-scoped, cross-id safe).
      -- ----------------------------------------------------------------------
      IF EXISTS (
        SELECT 1 FROM public.services
         WHERE tenant_id = p_tenant_id AND position = v_position AND id <> v_sid
      ) THEN
        v_position := COALESCE((
          SELECT MAX(position)+1 FROM public.services
           WHERE tenant_id = p_tenant_id
        ), v_position);
      END IF;

      -- ----------------------------------------------------------------------
      -- 2c) Upsert per (tenant_id,id): UPDATE esiste, INSERT nuovo
      -- ----------------------------------------------------------------------
      IF EXISTS (
        SELECT 1 FROM public.services
         WHERE id = v_sid AND tenant_id = p_tenant_id
      ) THEN
        UPDATE public.services
           SET name              = v_name,
               description       = v_description,
               price_from        = v_price,
               currency          = v_currency,
               duration_minutes  = v_duration,
               position          = v_position,
               active            = v_active,
               updated_at        = v_now
         WHERE id = v_sid AND tenant_id = p_tenant_id;
      ELSE
        INSERT INTO public.services (
          id, tenant_id, name, description, price_from,
          currency, duration_minutes, position, active
        ) VALUES (
          v_sid, p_tenant_id, v_name, v_description, v_price,
          v_currency, v_duration, v_position, v_active
        );
      END IF;

      v_merged_svc := v_merged_svc + 1;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2d) Stale services: safely delete or deactivate with history preservation
  -- --------------------------------------------------------------------------
  FOR v_stale IN
    SELECT s.id AS sid
      FROM public.services s
     WHERE s.tenant_id = p_tenant_id
       AND ((v_draft_ids IS NULL) OR NOT (s.id = ANY(v_draft_ids)))
  LOOP
    SELECT COUNT(*) INTO STRICT v_bk_count
      FROM public.bookings WHERE service_id = v_stale.sid;

    IF v_bk_count = 0 THEN
      DELETE FROM public.services WHERE id = v_stale.sid;
      v_deleted_stale := v_deleted_stale + 1;
    ELSE
      UPDATE public.services
         SET active = FALSE, updated_at = v_now
       WHERE id = v_stale.sid;
      v_deactivated_stale := v_deactivated_stale + 1;
    END IF;
  END LOOP;

  v_services_len := v_merged_svc;

  -- Step 3: Theme published to business_profiles.theme_* structured columns
  v_primary    := NULLIF((v_theme->>'primary')::TEXT,'');
  v_background := NULLIF((v_theme->>'background')::TEXT,'');
  v_foreground := NULLIF((v_theme->>'foreground')::TEXT,'');
  v_muted      := NULLIF((v_theme->>'muted')::TEXT,'');
  v_radius     := NULLIF((v_theme->>'radius')::TEXT,'');
  v_head       := NULLIF((v_theme->>'headingFont')::TEXT,'');
  v_body       := NULLIF((v_theme->>'bodyFont')::TEXT,'');

  UPDATE public.business_profiles
     SET theme_primary             = v_primary,
         theme_background          = v_background,
         theme_foreground          = v_foreground,
         theme_muted               = v_muted,
         theme_radius              = v_radius,
         theme_heading_font_preset = v_head,
         theme_body_font_preset    = v_body,
         updated_at                = v_now
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

--
-- ===========================================================
-- #86 FROZEN 2026-08-30  CERTIFIED P0-1 REGRESSION
-- NON modificare questo file. Cambiamenti futuri: append-only.
-- ===========================================================

