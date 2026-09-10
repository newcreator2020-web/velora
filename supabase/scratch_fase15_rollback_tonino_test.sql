\set ON_ERROR_STOP on
\echo
\echo ======================================================================
\echo  TEST REALE FASE 15 — ROLLBACK PUBBLICAZIONE VERSIONATO ATOMICO
\echo  TENANT: TONINO (d5a0538e-567e-45ee-b00e-61659ed50637)
\echo  FLOW:
\echo    1. READ PRE (editorial + versions)
\echo    2. MODIFICA SIMULATA: title hero "[MOD F15 TEST]" , revision +7
\echo    3. PUBLISH_V2 tramite RPC publish_site_draft
\echo    4. READ versions V1+V2
\echo    5. ROLLBACK: site_publication_restore(tonino, 1, owner) → V1 target
\echo    6. READ editorial POST ROLLBACK (verifica titolo originale tornato)
\echo    7. READ versions FINALE: V1 + V2 + V3_Rollback
\echo    8. AUDIT_LOGS: confirm event publication.restore
\echo    9. TENANT ISOLATION: altri tenant intonsi
\echo ======================================================================
\echo

-- ====================================================================
-- STEP 1: STATO PRE
-- ====================================================================
\echo =========================================
\echo  [1/9] PRE — site_editorial_state Tonino
\echo =========================================
SELECT
  revision,
  status,
  (sections_json->0->'props'->>'title')::varchar(80) AS hero_title,
  (published_at IS NOT NULL) AS published_active,
  left(sections_json::text, 120)::varchar(150) sections_preview
FROM public.site_editorial_state
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';

\echo
\echo =========================================
\echo  [1b/9] PRE — Lista versioni Tonino
\echo =========================================
SELECT
  version_number,
  status,
  left(note::text, 70) note,
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') created_at,
  left(actor_id::text, 10) actor
FROM public.site_publication_versions
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY version_number ASC;

-- ====================================================================
-- STEP 2: MODIFICA SIMULATA
-- ====================================================================
\echo
\echo =========================================
\echo  [2/9] MODIFICA: revision+7, title+" [MOD F15 TEST]"
\echo =========================================
UPDATE public.site_editorial_state
SET
  revision = revision + 7,
  status = 'draft',
  sections_json = jsonb_set(
    COALESCE(sections_json, '[]'::jsonb),
    '{0,props,title}',
    to_jsonb(COALESCE(sections_json->0->'props'->>'title','Hero') || ' [MOD F15 TEST]'),
    true
  ),
  published_at = NULL,
  updated_at = now()
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';

\echo Aggiornate righe editorial: 1 (expected)

SELECT
  revision,
  status,
  (sections_json->0->'props'->>'title')::varchar(100) hero_title_dopo_mod
FROM public.site_editorial_state
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';

-- ====================================================================
-- STEP 3: PUBLISH V2
-- ====================================================================
\echo
\echo =========================================
\echo  [3/9] PUBLISH_V2 RPC publish_site_draft(Tonino, NULL, Owner)
\echo =========================================
SELECT
  ok,
  message,
  new_revision,
  new_version_number,
  sections_snapshot_count,
  services_snapshot_count,
  theme_snapshot_hash IS NOT NULL AS theme_in_snapshot
FROM public.publish_site_draft(
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  NULL::integer,
  'a8398d34-c1dd-4e44-800c-1439a4aac20b'::uuid
);

-- ====================================================================
-- STEP 4: READ versions DOPO V2
-- ====================================================================
\echo
\echo =========================================
\echo  [4/9] POST V2 — lista versioni (almeno 2 righe)
\echo =========================================
SELECT
  version_number,
  status,
  left(note::text, 80) note,
  to_char(created_at, 'HH24:MI:SS') created_at,
  position('[MOD F15 TEST]' IN snapshot::text) > 0 AS snapshot_contiene_mod
FROM public.site_publication_versions
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY version_number DESC;

-- ====================================================================
-- STEP 5: ROLLBACK ATOMICO verso V1
-- ====================================================================
\echo
\echo =========================================
\echo  [5/9] ROLLBACK RPC site_publication_restore → TARGET=1
\echo =========================================
SELECT
  ok,
  message,
  from_version_number,
  to_version_number,
  restored_status,
  new_version_number AS rollback_version,
  sections_applied,
  services_applied,
  theme_applied
FROM public.site_publication_restore(
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  1::integer,
  'a8398d34-c1dd-4e44-800c-1439a4aac20b'::uuid
);

-- ====================================================================
-- STEP 6: READ editorial POST ROLLBACK — Verifica ripristino
-- ====================================================================
\echo
\echo =========================================
\echo  [6/9] POST ROLLBACK — site_editorial_state
\echo         Verifica: NO "[MOD F15 TEST]" nel title,
\echo         revision tornata al valore pre, status=published
\echo =========================================
SELECT
  revision,
  status,
  (sections_json->0->'props'->>'title')::varchar(100) hero_title_DOPO_ROLLBACK,
  position('[MOD F15 TEST]' IN (sections_json::text)) = 0 AS ripristino_title_OK,
  (published_at IS NOT NULL) AS published_attivo
FROM public.site_editorial_state
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';

-- ====================================================================
-- STEP 7: READ versions FINALE
-- ====================================================================
\echo
\echo =========================================
\echo  [7/9] FINALE — Lista versioni (3+ righe: V1 + V2 + V3_rollback)
\echo =========================================
SELECT
  version_number,
  status,
  left(note::text, 90) note,
  to_char(created_at, 'HH24:MI:SS') created_at
FROM public.site_publication_versions
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY version_number DESC;

-- ====================================================================
-- STEP 8: AUDIT LOG publication.restore
-- ====================================================================
\echo
\echo =========================================
\echo  [8/9] AUDIT LOGS ultimi 3 Tonino
\echo         cerca action=publication.restore
\echo =========================================
SELECT
  to_char(created_at, 'HH24:MI:SS') cr,
  action,
  resource_type,
  left(metadata::text, 150)::varchar(170) meta
FROM public.audit_logs
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY created_at DESC
LIMIT 3;

-- ====================================================================
-- STEP 9: TENANT ISOLATION
-- ====================================================================
\echo
\echo =========================================
\echo  [9/9] TENANT ISOLATION — altri tenants
\echo         verifica: 0 righe modificate per altri
\echo =========================================
SELECT tenant_id, COUNT(*) versions_count_other
FROM public.site_publication_versions
WHERE tenant_id <> 'd5a0538e-567e-45ee-b00e-61659ed50637'
GROUP BY tenant_id
ORDER BY tenant_id
LIMIT 10;

\echo
\echo ======================================================================
\echo  FINE TEST REALE FASE15 — ROLLBACK
\echo ======================================================================
