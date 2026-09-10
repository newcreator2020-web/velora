-- ============================================================
-- STEP 1: PUBLISH create versione 1 published
-- ============================================================
SELECT
  ok,
  message,
  new_revision::varchar(15) rev_prefix,
  new_version_number v_num,
  sections_snapshot_count n_sec,
  services_snapshot_count n_svc,
  theme_snapshot_hash IS NOT NULL theme_in
FROM public.publish_site_draft(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  (SELECT draft_revision FROM public.site_editorial_state WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'),
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
);

SELECT 'VERSIONI DOPO PUBLISH V1' step,
  version_number,
  status,
  jsonb_array_length(snapshot->'sections') snap_sec,
  position('ORIGINALE HERO V1' IN snapshot::text)>0 has_original_title,
  left(note, 40) note
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY version_number DESC;
