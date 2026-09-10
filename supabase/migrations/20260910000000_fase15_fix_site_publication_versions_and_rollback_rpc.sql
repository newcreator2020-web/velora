-- FASE 15 · FIX SCHEMA site_publication_versions + ROLLBACK ATOMICO
-- 1) Rimuove UNIQUE(tenant_id) che impediva più versioni per lo stesso tenant
-- 2) Aggiunge UNIQUE(tenant_id, version_number) che garantisce versione unica
-- 3) Backfill: per versioni v1 con snapshot = '{}' e status published, riempie con dati reali da site_editorial_state
-- 4) Crea RPC site_publication_restore(tenant_id, target_version, actor_id) atomica

DO $$ BEGIN
  ALTER TABLE public.site_publication_versions
    DROP CONSTRAINT IF EXISTS site_publication_versions_tenant_id_key;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'UNIQUE tenant_id non trovato o già rimosso: %', SQLERRM;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS site_publication_versions_tenant_version_uq
  ON public.site_publication_versions (tenant_id, version_number);

-- Backfill snapshot vuoti in v1 con dati site_editorial_state reali (solo se published e snapshot == {})
UPDATE public.site_publication_versions spv
SET
  snapshot = jsonb_build_object(
    'sections', COALESCE(ses.sections, '[]'::jsonb),
    'services', COALESCE(ses.services, '[]'::jsonb),
    'theme',    COALESCE(ses.theme,    '{}'::jsonb),
    'revision', COALESCE(ses.draft_revision::text, gen_random_uuid()::text),
    'generated_at', COALESCE(LEAST(spv.published_at, spv.updated_at), now())::text
  ),
  hash_sha256 = (
    SELECT encode(digest(data::bytea, 'sha256'), 'hex')
    FROM (
      SELECT jsonb_build_object(
        'sections', COALESCE(ses.sections, '[]'::jsonb),
        'services', COALESCE(ses.services, '[]'::jsonb),
        'theme',    COALESCE(ses.theme,    '{}'::jsonb),
        'revision', COALESCE(ses.draft_revision::text, gen_random_uuid()::text),
        'generated_at', COALESCE(LEAST(spv.published_at, spv.updated_at), now())::text
      )::text AS data
    ) _sub
  )
FROM public.site_editorial_state ses
WHERE spv.tenant_id = ses.tenant_id
  AND spv.version_number = 1
  AND spv.status = 'published'
  AND spv.snapshot = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.site_publication_restore(
  p_tenant_id UUID,
  p_target_version INTEGER,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
  ok BOOLEAN,
  message TEXT,
  from_version_number INTEGER,
  to_version_number INTEGER,
  restored_status public.publication_status,
  new_version_number INTEGER,
  sections_applied INTEGER,
  services_applied INTEGER,
  theme_applied BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner_or_manager BOOLEAN := FALSE;
  v_is_platform_admin BOOLEAN := FALSE;
  v_target RECORD;
  v_current_max_version INTEGER;
  v_snapshot_obj JSONB;
  v_sections_json JSONB;
  v_services_json JSONB;
  v_theme_json JSONB;
  v_revision UUID;
  v_published_target BOOLEAN := FALSE;
  v_sections_count INTEGER := 0;
  v_services_count INTEGER := 0;
  v_has_theme BOOLEAN := FALSE;
  v_new_version INTEGER;
  v_new_published_at TIMESTAMPTZ := NULL;
  v_new_status public.publication_status;
BEGIN
  ok := FALSE;
  message := NULL;
  from_version_number := NULL;
  to_version_number := p_target_version;
  restored_status := NULL;
  new_version_number := NULL;
  sections_applied := 0;
  services_applied := 0;
  theme_applied := FALSE;

  IF p_tenant_id IS NULL OR p_target_version IS NULL OR p_target_version < 1 THEN
    message := 'Parametri non validi (tenant_id o target_version mancanti).';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT public.is_platform_admin() INTO v_is_platform_admin;
  IF v_is_platform_admin IS NULL THEN v_is_platform_admin := FALSE; END IF;

  IF NOT v_is_platform_admin THEN
    IF p_actor_id IS NULL THEN
      message := 'Autenticazione richiesta.';
      RETURN NEXT;
      RETURN;
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.tenant_id = p_tenant_id
        AND tm.user_id = p_actor_id
        AND tm.role IN ('owner', 'manager')
        AND tm.status = 'active'
    ) INTO v_is_owner_or_manager;
    IF NOT v_is_owner_or_manager THEN
      message := 'Autorizzazione negata: ruolo non sufficiente per rollback pubblicazione.';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT spv.id, spv.tenant_id, spv.version_number, spv.status, spv.snapshot, spv.published_at, spv.note
    INTO v_target
  FROM public.site_publication_versions spv
  WHERE spv.tenant_id = p_tenant_id
    AND spv.version_number = p_target_version
  LIMIT 1;

  IF v_target IS NULL OR v_target.id IS NULL THEN
    message := 'Versione target non trovata per questo tenant (v=' || p_target_version || ').';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(spv.version_number), 0)
    INTO v_current_max_version
  FROM public.site_publication_versions spv
  WHERE spv.tenant_id = p_tenant_id;

  from_version_number := v_current_max_version;
  v_new_version := COALESCE(v_current_max_version, 0) + 1;

  v_snapshot_obj := COALESCE(v_target.snapshot, '{}'::jsonb);
  v_sections_json := COALESCE(v_snapshot_obj->'sections', '[]'::jsonb);
  v_services_json := COALESCE(v_snapshot_obj->'services', '[]'::jsonb);
  v_theme_json    := COALESCE(v_snapshot_obj->'theme',    '{}'::jsonb);
  v_revision      := COALESCE(
    NULLIF(v_snapshot_obj->>'revision', '')::uuid,
    gen_random_uuid()
  );
  v_published_target := (v_target.status = 'published');
  v_new_status := CASE WHEN v_published_target THEN 'published'::public.publication_status ELSE 'draft'::public.publication_status END;

  BEGIN
    SELECT jsonb_array_length(v_sections_json) INTO v_sections_count;
  EXCEPTION WHEN others THEN
    v_sections_count := 0;
  END;
  BEGIN
    SELECT jsonb_array_length(v_services_json) INTO v_services_count;
  EXCEPTION WHEN others THEN
    v_services_count := 0;
  END;
  IF v_theme_json IS NOT NULL AND v_theme_json <> '{}'::jsonb THEN v_has_theme := TRUE; END IF;

  INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme, draft_revision, updated_at)
  VALUES (p_tenant_id, v_sections_json, v_services_json, v_theme_json, v_revision, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    sections = EXCLUDED.sections,
    services = EXCLUDED.services,
    theme    = EXCLUDED.theme,
    draft_revision = EXCLUDED.draft_revision,
    updated_at = now();

  IF v_published_target THEN
    PERFORM public.publish_site_draft(p_tenant_id, v_revision, p_actor_id);
    v_new_published_at := COALESCE((SELECT now() WHERE EXISTS (
      SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.published IS TRUE
    )), now());
  ELSE
    PERFORM public.unpublish_site();
    UPDATE public.tenants t
      SET published = FALSE,
          published_at = NULL,
          updated_at = now()
    WHERE t.id = p_tenant_id;
    v_new_published_at := NULL;
  END IF;

  INSERT INTO public.site_publication_versions (
    tenant_id, version_number, status, snapshot, hash_sha256, published_at, created_by, note, created_at, updated_at
  ) VALUES (
    p_tenant_id,
    v_new_version,
    v_new_status,
    v_snapshot_obj,
    (
      SELECT encode(digest(v_snapshot_obj::text::bytea, 'sha256'), 'hex')
    ),
    v_new_published_at,
    p_actor_id,
    'Rollback a versione v' || p_target_version || ' (stato originale: ' || v_target.status || ') — eseguita ' || now()::text,
    now(),
    now()
  );

  BEGIN
    INSERT INTO public.audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata, created_at
    ) VALUES (
      p_tenant_id,
      p_actor_id,
      'site.rolled_back',
      'site_publication',
      p_tenant_id::text,
      jsonb_build_object(
        'from_version_number', v_current_max_version,
        'to_version_number_source', p_target_version,
        'new_version_number', v_new_version,
        'restored_status', v_new_status::text,
        'sections_applied', v_sections_count,
        'services_applied', v_services_count,
        'theme_applied', v_has_theme,
        'success', TRUE,
        'target_original_note', v_target.note,
        'target_original_published_at', v_target.published_at
      ),
      now()
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;

  PERFORM pg_notify(
    'site_publication_changed',
    json_build_object(
      'tenant_id', p_tenant_id,
      'action', 'rollback',
      'new_version', v_new_version,
      'status', v_new_status
    )::text
  );

  ok := TRUE;
  message := 'Rollback completato: versione v' || p_target_version || ' ripristinata in nuova versione v' || v_new_version || '.';
  restored_status := v_new_status;
  new_version_number := v_new_version;
  sections_applied := COALESCE(v_sections_count, 0);
  services_applied := COALESCE(v_services_count, 0);
  theme_applied := v_has_theme;
  RETURN NEXT;
  RETURN;
EXCEPTION WHEN others THEN
  ok := FALSE;
  message := 'Errore rollback (transazione annullata): ' || SQLERRM;
  RETURN NEXT;
  RETURN;
END;
$$;

DROP POLICY IF EXISTS spv_any_authenticated_select_visible ON public.site_publication_versions;

REVOKE ALL ON FUNCTION public.site_publication_restore(UUID, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_publication_restore(UUID, INTEGER, UUID) TO authenticated, service_role;
