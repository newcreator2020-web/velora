-- ============================================================================
-- TASK 1 FASE 1.1 FIX — SID SERVICE IDENTITY STABILITY (UUID preservation)
-- COMPATIBILE FASE 16 (colonna price, deposit, 2 audit_logs INSERT, 3-arg signature DEFAULT NULL)
-- Append-only. Idempotent. NON tocca il wrapper 1-arg 20260909131000.
-- ============================================================================
-- Root cause precedente (regressione): publish_site_draft faceva DELETE TUTTI i
-- services tenant + INSERT nuovi UUID → 14 fail fase_p01_service_id_stability.
-- Soluzione: ripristina algoritmo di 20260829120000_p01_service_id_stability.sql
--   ma con integrazione delle colonne nuove Fase 16:
--     · public.services.price (NUMERIC)
--     · public.services.deposit_strategy, deposit_value
--     · 2 audit INSERT (site.published + service.price_changed)
--     · firma 3-param (p_expected_revision DEFAULT NULL, p_actor_id DEFAULT NULL)
-- ============================================================================
-- Security default per deposit_strategy: se un servizio non specifica strategia caparra → NONE
ALTER TABLE IF EXISTS public.services
  ALTER COLUMN deposit_strategy SET DEFAULT 'NONE'::public.deposit_strategy_enum,
  ALTER COLUMN deposit_strategy SET NOT NULL;

DROP FUNCTION IF EXISTS public.publish_site_draft(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.publish_site_draft(
  p_tenant_id UUID,
  p_expected_revision UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
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
  v_old_state JSONB;

  -- SID service identity locals
  v_draft_ids UUID[];
  v_draft_svc JSONB;
  v_sid UUID;
  v_svc_raw_id TEXT;
  v_existing_tenant UUID;
  v_name TEXT;
  v_description TEXT;
  v_price NUMERIC(10,2);          -- NEW FASE16 audit column
  v_price_from NUMERIC(10,2);
  v_currency TEXT;
  v_duration INTEGER;
  v_position INTEGER;
  v_active BOOLEAN;
  v_deposit_strategy TEXT;        -- column exists in services
  v_deposit_value NUMERIC(10,2);
  v_merged_svc INTEGER := 0;
  v_deleted_stale INTEGER := 0;
  v_deactivated_stale INTEGER := 0;
  v_stale RECORD;
  v_bk_count BIGINT;
BEGIN
  v_actor_uid := COALESCE(p_actor_id, auth.uid());

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

  -- Step 1: Sections (same as FASE16, DELETE tenant-scoped + INSERT ON CONFLICT DO NOTHING)
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

  -- ==========================================================================
  -- Step 2: SID-preserving Services (UUID STABILITY + cross-tenant safety)
  -- Ripristina algoritmo P0-1 frozen 2026-08-30 + colonne nuove FASE16.
  -- ==========================================================================
  v_draft_ids := ARRAY[]::UUID[];

  IF jsonb_typeof(v_svc) = 'array' THEN
    v_services_len := jsonb_array_length(v_svc);
  ELSE
    v_services_len := 0;
  END IF;

  IF v_services_len > 0 THEN
    FOR v_draft_svc IN SELECT * FROM jsonb_array_elements(v_svc) LOOP
      -- 2a) UUID resolve + cross-tenant injection guard
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

      -- 2b) Normalized values — mantieni contract FASE16 (price + price_from)
      v_name := COALESCE(NULLIF(btrim(v_draft_svc->>'name'),''),'Servizio');
      v_description := NULLIF(btrim(v_draft_svc->>'description'),'');

      v_price := NULL;
      IF (v_draft_svc->>'price') IS NOT NULL AND btrim(v_draft_svc->>'price') <> '' THEN
        v_price := (v_draft_svc->>'price')::NUMERIC(10,2);
      END IF;

      v_price_from := NULL;
      IF (v_draft_svc->>'price_from') IS NOT NULL AND btrim(v_draft_svc->>'price_from') <> '' THEN
        v_price_from := (v_draft_svc->>'price_from')::NUMERIC(10,2);
      END IF;

      v_currency := COALESCE(NULLIF(btrim(v_draft_svc->>'currency'),''),'EUR');

      v_duration := NULL;
      IF (v_draft_svc->>'duration_minutes') IS NOT NULL AND btrim(v_draft_svc->>'duration_minutes') <> '' THEN
        v_duration := (v_draft_svc->>'duration_minutes')::INTEGER;
      END IF;

      v_position := COALESCE((v_draft_svc->>'position')::INTEGER,0);
      v_active   := COALESCE((v_draft_svc->>'active')::BOOLEAN,TRUE);

      v_deposit_strategy := COALESCE(NULLIF(btrim(v_draft_svc->>'deposit_strategy'),''), 'NONE');
      v_deposit_value := 0;
      IF (v_draft_svc->>'deposit_value') IS NOT NULL AND btrim(v_draft_svc->>'deposit_value') <> '' AND v_deposit_strategy <> 'NONE' THEN
        v_deposit_value := (v_draft_svc->>'deposit_value')::NUMERIC(10,2);
      END IF;
      IF v_deposit_value IS NULL THEN
        v_deposit_value := 0;
      END IF;

      -- Safe position tenant-scoped: fall back MAX+1 when collision
      IF EXISTS (
        SELECT 1 FROM public.services
         WHERE tenant_id = p_tenant_id AND position = v_position AND id <> v_sid
      ) THEN
        v_position := COALESCE((
          SELECT MAX(position)+1 FROM public.services
           WHERE tenant_id = p_tenant_id
        ), v_position);
      END IF;

      -- 2c) Upsert deterministico (UPDATE se esiste, INSERT se nuovo, UUID preservato)
      IF EXISTS (
        SELECT 1 FROM public.services
         WHERE id = v_sid AND tenant_id = p_tenant_id
      ) THEN
        UPDATE public.services
           SET name              = v_name,
               description       = v_description,
               price             = v_price,
               price_from        = v_price_from,
               currency          = v_currency,
               duration_minutes  = v_duration,
               position          = v_position,
               active            = v_active,
               deposit_strategy  = v_deposit_strategy::public.deposit_strategy_enum,
               deposit_value     = v_deposit_value,
               updated_at        = v_now
         WHERE id = v_sid AND tenant_id = p_tenant_id;
      ELSE
        INSERT INTO public.services (
          id, tenant_id, name, description, price, price_from,
          currency, duration_minutes, position, active,
          deposit_strategy, deposit_value
        ) VALUES (
          v_sid, p_tenant_id, v_name, v_description, v_price, v_price_from,
          v_currency, v_duration, v_position, v_active,
          v_deposit_strategy::public.deposit_strategy_enum, v_deposit_value
        );
      END IF;

      v_merged_svc := v_merged_svc + 1;
    END LOOP;
  END IF;

  -- 2d) Stale services: DELETE se 0 bookings, SET active=FALSE se referenziati da bookings (preserva storico)
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

  -- Step 3: Theme (FASE16 — unchanged)
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

  -- Step 4: Segna published + AUDIT INSERT FASE16 (site.published + service.price_changed)
  SELECT to_jsonb(site_editorial_state) INTO v_old_state
    FROM public.site_editorial_state WHERE tenant_id = p_tenant_id;

  UPDATE public.tenants
     SET published    = TRUE,
         published_at = v_now,
         updated_at   = v_now
   WHERE id = p_tenant_id;

  -- Audit #1: site.published (FASE16 original)
  INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_uid,
    p_tenant_id,
    'site.published',
    'site_publication',
    p_tenant_id,
    jsonb_build_object(
      'old_value', COALESCE(v_old_state, '{}'::jsonb),
      'new_value', jsonb_build_object(
        'published_at', v_now,
        'new_revision', COALESCE(p_expected_revision, v_draft_rev),
        'sid_merged', v_merged_svc,
        'sid_deleted_stale', v_deleted_stale,
        'sid_deactivated_stale', v_deactivated_stale
      )
    )
  );

  -- Audit #2: service.price_changed (FASE16 original)
  INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
  SELECT
    v_actor_uid,
    p_tenant_id,
    'service.price_changed',
    'service',
    s.id,
    jsonb_build_object(
      'old_value', jsonb_build_object('price', NULL, 'price_from', NULL),
      'new_value', jsonb_build_object('price', s.price, 'price_from', s.price_from)
    )
  FROM public.services s
  WHERE s.tenant_id = p_tenant_id;

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

REVOKE ALL ON FUNCTION public.publish_site_draft(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_site_draft(UUID, UUID, UUID) TO authenticated;

-- ============================================================================
-- 1-ARG BACKWARD COMPAT WRAPPER (idem 20260909131000):
-- garantisce che le chiamate publish_site_draft(tenant_id) a 1 arg continuino
-- a funzionare anche dopo il drop/recreate della 3-arg.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.publish_site_draft(
  p_tenant_id UUID
)
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
BEGIN
  RETURN QUERY SELECT * FROM public.publish_site_draft(p_tenant_id, NULL::uuid, auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.publish_site_draft(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_site_draft(UUID) TO authenticated;

-- ============================================================================
-- POST-CHECK: 2 overload expected: 1-arg wrapper + 3-arg real.
-- ============================================================================
