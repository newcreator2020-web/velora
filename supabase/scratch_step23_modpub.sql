-- ============================================================
-- STEP 2: MODIFICA site_editorial_state hero title
-- ============================================================
UPDATE public.site_editorial_state
SET
  sections = jsonb_set(
    sections,
    '{1,props,title}',
    '"TITOLO MODIFICATO V2 [F15 TEST]"',
    true
  ),
  draft_revision = gen_random_uuid(),
  updated_at = now()
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

SELECT 'POST MODIFICA V2' step,
  (sections->1->'props'->>'title')::varchar(80) hero_title
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

-- ============================================================
-- STEP 3: PUBLISH crea versione 2
-- ============================================================
SELECT
  ok, message, new_version_number v_num, sections_snapshot_count sec_num
FROM public.publish_site_draft(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  (SELECT draft_revision FROM public.site_editorial_state WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'),
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
);

SELECT 'POST PUBLISH V2' step, version_number, status,
  position('TITOLO MODIFICATO V2' IN snapshot::text)>0 has_v2_title_in_snapshot,
  position('ORIGINALE HERO V1' IN snapshot::text)>0 has_v1_title_in_snapshot,
  left(note,40) note
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY version_number DESC;
