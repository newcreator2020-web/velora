-- ============================================================
-- TEST FINALE ROLLBACK FASE 15 (9 passaggi REALI)
-- TENANT:  Tonino  d5a0538e-567e-45ee-b00e-61659ed50637
-- ACTOR:   Tonino Owner  a8398d34-c1dd-4e44-800c-1439a4aac20b
-- ============================================================
\pset tuples_only off
\pset border 2

\echo
\echo ============================================================
\echo  TEST ROLLBACK FASE15 — TONINO (9 PASSAGGI)
\echo ============================================================
\echo

-- ----------------------------------------------------------------
-- 1. INIT site_editorial_state Tonino (se non esiste)
-- ----------------------------------------------------------------
\echo --- STEP 1: INIT Tonino site_editorial_state V1 ORIGINALE
INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme, draft_revision, updated_at)
SELECT
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  '[
    {"type":"navbar","order":1,"props":{"title":"Estetista Tonino","links":["Home","Servizi","Listino","Contatti"]}},
    {"type":"hero","order":2,"props":{"title":"ESTETISTA TONINO ORIGINALE V1","subtitle":"Centro estetico dal 1998","cta":"Prenota ora"}},
    {"type":"about","order":3,"props":{"title":"Chi siamo","body":"Testo originale V1: 25 anni di esperienza"}},
    {"type":"services","order":4,"props":{"title":"Listino prezzi"}},
    {"type":"trust","order":5,"props":{"title":"Perche sceglierci","badges":["Qualita","Esperienza","Professionalita"]}},
    {"type":"contacts","order":6,"props":{"title":"Contatti","phone":"+393331234567","email":"tonino@velora.test","city":"Roma"}}
  ]'::jsonb,
  '[
    {"sid":"svc1-skin","name":"Depilazione gambe 30min","price_cents":2500,"duration":30,"position":1},
    {"sid":"svc2-massage","name":"Massaggio 60min","price_cents":5000,"duration":60,"position":2},
    {"sid":"svc3-face","name":"Pulizia viso 45min","price_cents":4000,"duration":45,"position":3}
  ]'::jsonb,
  '{"colors":{"primary":"#ec4899","secondary":"#f59e0b"},"fonts":{"heading":"Poppins","body":"Roboto"},"radius":"rounded-lg"}'::jsonb,
  '00000000-0000-0000-0000-000000000001'::uuid,
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_editorial_state
  WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
);

SELECT jsonb_array_length(sections) n_sections,
       jsonb_array_length(services) n_services,
       jsonb_typeof(theme) theme_t
FROM public.site_editorial_state
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

-- ----------------------------------------------------------------
-- 2. INSERT VERSIONE 1 PUBLISHED (snapshot = V1 completo originale)
-- ----------------------------------------------------------------
\echo
\echo --- STEP 2: INSERT site_publication_versions V1 published = V1 ORIGINALE
INSERT INTO public.site_publication_versions (
  tenant_id, version_number, status, snapshot, hash_sha256,
  published_at, created_by, note, created_at, updated_at
)
SELECT
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  1,
  'published'::public.publication_status,
  jsonb_build_object(
    'sections', sections,
    'services', services,
    'theme',    theme,
    'revision', draft_revision::text,
    'generated_at', now()::text
  ),
  encode(digest(jsonb_build_object(
    'sections', sections,
    'services', services,
    'theme',    theme,
    'revision', draft_revision::text,
    'generated_at', now()::text
  )::text::bytea, 'sha256'), 'hex'),
  now(),
  'a8398d34-c1dd-4e44-800c-1439a4aac20b'::uuid,
  'Versione 1 — Stato pubblicazione originale Tonino (V1) creato test FASE15',
  now(), now()
FROM public.site_editorial_state
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
ON CONFLICT (tenant_id, version_number) DO NOTHING;

-- ----------------------------------------------------------------
-- 3. UPDATE site_editorial_state: MODIFICA title (V1 → V2)
-- ----------------------------------------------------------------
\echo
\echo --- STEP 3: MODIFICA Tonino HERO title → "ESTETISTA TONINO — MODIFICATA V2 [F15]"
UPDATE public.site_editorial_state
SET
  sections = jsonb_set(
    sections, '{1,props,title}',
    '"ESTETISTA TONINO — MODIFICATA V2 [CAMBIO F15]"',
    true
  ),
  services = services || '[{"sid":"svc9-nail","name":"Smalto semipermanente","price_cents":3000,"duration":35,"position":9}]'::jsonb,
  theme = jsonb_set(theme, '{colors,primary}', '"#9333ea"', true),
  draft_revision = '00000000-0000-0000-0000-000000000002'::uuid,
  updated_at = now()
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

SELECT 'POST MODIFICA V2' as step,
  (sections->1->'props'->>'title')::varchar(90) hero_title,
  jsonb_array_length(services) n_services,
  (theme->'colors'->>'primary')::varchar(15) color_primary
FROM public.site_editorial_state
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

-- ----------------------------------------------------------------
-- 4. INSERT VERSIONE 2 PUBLISHED (snapshot = CONTENUTO MODIFICATO)
-- ----------------------------------------------------------------
\echo
\echo --- STEP 4: INSERT site_publication_versions V2 published = CONTENUTO MODIFICATO
INSERT INTO public.site_publication_versions (
  tenant_id, version_number, status, snapshot, hash_sha256,
  published_at, created_by, note, created_at, updated_at
)
SELECT
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  2,
  'published'::public.publication_status,
  jsonb_build_object(
    'sections', sections,
    'services', services,
    'theme',    theme,
    'revision', draft_revision::text,
    'generated_at', now()::text
  ),
  encode(digest(jsonb_build_object(
    'sections', sections,
    'services', services,
    'theme',    theme,
    'revision', draft_revision::text,
    'generated_at', now()::text
  )::text::bytea, 'sha256'), 'hex'),
  now(),
  'a8398d34-c1dd-4e44-800c-1439a4aac20b'::uuid,
  'Versione 2 — Modifica titolo + aggiunta servizio unghie + tema viola (cambio FASE15)',
  now(), now()
FROM public.site_editorial_state
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

SELECT 'VERSIONI DOPO V1+V2 INSERT' step, version_number, status,
  position('ORIGINALE V1' IN snapshot::text)>0 has_ORIGINALE,
  position('CAMBIO F15' IN snapshot::text)>0 has_CAMBIO,
  left(note, 55) note
FROM public.site_publication_versions
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY version_number DESC;

-- ----------------------------------------------------------------
-- 5. ROLLBACK! site_publication_restore(Tonino, target=1, owner)
-- ----------------------------------------------------------------
\echo
\echo ============================================================
\echo  STEP 5 — ROLLBACK ATOMICO site_publication_restore()
\echo ============================================================
SELECT
  ok,
  message,
  from_version_number v_from,
  to_version_number v_to,
  restored_status,
  new_version_number AS rollback_version,
  sections_applied n_sezioni_applicate,
  services_applied n_servizi_applicati,
  theme_applied tema_applicato
FROM public.site_publication_restore(
  'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
  1::integer,
  'a8398d34-c1dd-4e44-800c-1439a4aac20b'::uuid
);

-- ----------------------------------------------------------------
-- 6. READ BACK site_editorial_state (VERIFICA RIPRISTINO V1!)
-- ----------------------------------------------------------------
\echo
\echo ============================================================
\echo  STEP 6 — READ BACK: stato editorial DOPO ROLLBACK
\echo  Dovrebbe esserci tornato l'ORIGINALE V1!
\echo ============================================================
SELECT
  'READ BACK POST ROLLBACK' AS step,
  (sections->1->'props'->>'title')::varchar(90) hero_title_RIPRISTINATO,
  (sections->1->'props'->>'title') = 'ESTETISTA TONINO ORIGINALE V1' AS hero_match_SUCCESSO,
  jsonb_array_length(services) n_services_RIPRISTINATO,
  jsonb_array_length(services) = 3 AS services_match_SUCCESSO,
  (theme->'colors'->>'primary')::varchar(15) color_primary_RIPRISTINATO,
  (theme->'colors'->>'primary') = '#ec4899' AS theme_match_SUCCESSO,
  left(draft_revision::text,14) revision_prefix
FROM public.site_editorial_state
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

-- ----------------------------------------------------------------
-- 7. FINALE versions list = V1+V2+V3 (nuova versione per rollback!)
-- ----------------------------------------------------------------
\echo
\echo ============================================================
\echo  STEP 7 — VERSIONI FINALI (atteso: 3 righe)
\echo  V3 = nuova versione di ROLLBACK APPEND-ONLY!
\echo ============================================================
SELECT
  version_number,
  status,
  left(note, 80) note_descrizione,
  left(actor_id::text, 10) actor,
  position('ORIGINALE V1' IN snapshot::text)>0 snap_has_ORIGINALE
FROM public.site_publication_versions
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY version_number DESC;

-- ----------------------------------------------------------------
-- 8. AUDIT LOGS site.rolled_back
-- ----------------------------------------------------------------
\echo
\echo ============================================================
\echo  STEP 8 — AUDIT LOGS ultimi 2 Tonino
\echo ============================================================
SELECT
  to_char(created_at, 'HH24:MI:SS') cr,
  action,
  entity_type,
  left(metadata::text, 160)::varchar(180) meta
FROM public.audit_logs
WHERE tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
ORDER BY created_at DESC
LIMIT 2;

-- ----------------------------------------------------------------
-- 9. TENANT ISOLATION — TUTTI gli altri tenant NON hanno modifiche
-- ----------------------------------------------------------------
\echo
\echo ============================================================
\echo  STEP 9 — ISOLAMENTO ALTRI TENANTS (0 modifiche = SUCCESSO)
\echo ============================================================
SELECT
  COUNT(*) AS total_versions_ALTRI,
  BOOL_OR(position('CAMBIO F15' IN snapshot::text)>0) AS any_leak_CAMBIO,
  BOOL_OR(position('ORIGINALE V1' IN snapshot::text)>0
          AND tenant_id <> 'd5a0538e-567e-45ee-b00e-61659ed50637') AS any_leak_ORIGINALE_altri,
  (SELECT COUNT(*) FROM public.audit_logs
    WHERE tenant_id<>'d5a0538e-567e-45ee-b00e-61659ed50637'
      AND action = 'site.rolled_back') AS audit_rollback_ALTRI
FROM public.site_publication_versions
WHERE tenant_id <> 'd5a0538e-567e-45ee-b00e-61659ed50637';

\echo
\echo ============================================================
\echo  TEST FASE15 ROLLBACK COMPLETATO
\echo ============================================================
