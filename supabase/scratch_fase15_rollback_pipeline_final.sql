\set ON_ERROR_STOP on
\pset tuples_only on
\pset border 0

-- ============================================================
-- TEST FASE15 — TENANT PIPELINE f702efb6-549c-4f29-a84e-7d6e24b8159c
-- ACTOR: 9df5232e-2303-4a6f-b643-f2386ac92ec1 (SUPER_ADMIN owner)
-- ============================================================
\echo
\echo ============================================================
\echo  TEST ROLLBACK FASE15 — TENANT PIPELINE
\echo ============================================================
\echo

-- Step 0: Se non esiste editorial, inseriamo V0 default con 5 sezioni reali
\echo Step 0: INIT editorial (se non esiste)
INSERT INTO public.site_editorial_state (
  tenant_id, revision, status, theme_json, sections_json, services_json,
  published_at, created_at, updated_at
)
SELECT
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  1,                                 -- revision
  'draft',                           -- status
  jsonb_build_object(
    'colors', jsonb_build_object('primary','#4f46e5','secondary','#f59e0b'),
    'fonts',  jsonb_build_object('heading','Inter','body','Inter')
  ),
  jsonb_build_array(
    jsonb_build_object('type','navbar','order',1,'props',jsonb_build_object('title','Studio Prime Pipeline','links',jsonb_build_array('Home','Servizi','Chi Siamo','Contatti'),'logo','')),
    jsonb_build_object('type','hero','order',2,'props',jsonb_build_object('title','Titolo HERO ORIGINALE V1','subtitle','Sottotitolo originale v1','cta','Scopri i servizi')),
    jsonb_build_object('type','about','order',3,'props',jsonb_build_object('title','Chi siamo','body','Testo originale V1 about us')),
    jsonb_build_object('type','services','order',4,'props',jsonb_build_object('title','Listino prezzi')),
    jsonb_build_object('type','trust','order',5,'props',jsonb_build_object('title','Perché sceglierci','badges',jsonb_build_array('Qualità','Affidabilità','Professionalità')))
  ),
  '[]'::jsonb,
  NULL, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_editorial_state
  WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
);
\echo Insert init done (if needed). Row count: :ROW_COUNT

-- Step 0.1: Visualizza stato iniziale
\echo
\echo Step 0.1: Stato PRE test (editorial + versions)
SELECT
  'EDITORIAL_PRE' tag,
  revision,
  status,
  (sections_json->1->'props'->>'title')::varchar(80) hero_title,
  (published_at IS NOT NULL) published
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

SELECT 'VERSIONS_PRE' tag, count(*) n_versions
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

-- Step 1: PUBLISH create VERSIONE 1
\echo
\echo =========================================
\echo Step 1: PUBLISH_V1 crea prima versione
\echo =========================================
SELECT
  ok,
  message,
  new_revision,
  new_version_number,
  sections_snapshot_count sezioni,
  theme_snapshot_hash IS NOT NULL AS tema
FROM public.publish_site_draft(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  NULL::int,
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
);

-- Step 2: MODIFICA title hero a "TITOLO MODIFICATO V2"
\echo
\echo =========================================
\echo Step 2: MODIFICA title HERO (V1 -> V2)
\echo =========================================
UPDATE public.site_editorial_state
SET
  revision = revision + 5,
  status='draft',
  sections_json = jsonb_set(
    sections_json,
    '{1,props,title}',
    '"TITOLO MODIFICATO V2 [MOD F15 TEST]"',
    true
  ),
  updated_at = now()
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

SELECT 'POST MODIFICA' tag,
  revision,
  status,
  (sections_json->1->'props'->>'title') hero_title_dopo_mod
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

-- Step 3: PUBLISH create VERSIONE 2
\echo
\echo =========================================
\echo Step 3: PUBLISH_V2 (dopo modifica)
\echo =========================================
SELECT
  ok,
  new_version_number,
  sections_snapshot_count sezioni
FROM public.publish_site_draft(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  NULL::int,
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
);

-- Step 4: Visualizza versions list (2+)
\echo
\echo Step 4: Lista versioni DOPO V2 publish
SELECT
  version_number,
  status,
  left(note::text, 60) note,
  position('MOD F15 TEST' IN snapshot::text)>0 snapshot_has_mod
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY version_number DESC;

-- Step 5: ROLLBACK ATOMICO target V1
\echo
\echo =========================================
\echo Step 5: ROLLBACK → RIPRISTINA V1 ORIGINALE
\echo =========================================
SELECT
  ok,
  message,
  from_version_number,
  to_version_number,
  restored_status,
  new_version_number AS rollback_v,
  sections_applied sezioni,
  theme_applied tema
FROM public.site_publication_restore(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  1::int,
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
);

-- Step 6: READ BACK confronto
\echo
\echo =========================================
\echo Step 6: READ BACK editoriale DOPO ROLLBACK
\echo   hero_title deve tornare "Titolo HERO ORIGINALE V1"
\echo   revision tornata a V1, status published
\echo =========================================
SELECT
  'DOPO_ROLLBACK' tag,
  revision,
  status,
  (sections_json->1->'props'->>'title')::varchar(80) hero_title_restored,
  (sections_json->1->'props'->>'title') = 'Titolo HERO ORIGINALE V1' AS restore_title_SUCCESS,
  (published_at IS NOT NULL) published_attivo
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

-- Step 7: FINALE versions 3+
\echo
\echo Step 7: FINALE versions list (3+ righe)
SELECT
  version_number,
  status,
  left(note::text, 70) note,
  left(actor_id::text,10) actor
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY version_number DESC;

-- Step 8: AUDIT LOG publication.restore
\echo
\echo Step 8: ULTIMI 3 AUDIT LOG (cerca publication.restore)
SELECT
  to_char(created_at, 'HH24:MI:SS') cr,
  action,
  resource_type,
  left(metadata::text, 120)::varchar(140) meta
FROM public.audit_logs
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY created_at DESC
LIMIT 3;

-- Step 9: TENANT ISOLATION
\echo
\echo Step 9: ISOLAMENTO altri tenants (0 modifiche)
SELECT
  COUNT(*) versions_non_pipeline,
  BOOL_OR(position('MOD F15 TEST' IN snapshot::text)>0) any_snapshot_mod_leaked
FROM public.site_publication_versions
WHERE tenant_id<>'f702efb6-549c-4f29-a84e-7d6e24b8159c';

\echo
\echo ============================================================
\echo  FINE TEST FASE15 ROLLBACK — 9 step
\echo ============================================================
