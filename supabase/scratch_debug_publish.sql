\pset tuples_only off

\echo ============== DESCRIBE publish_site_draft ==============
\df+ public.publish_site_draft

\echo
\echo ============== DIRECT CALL (no Select-Object trimming!) ==============
SELECT
  'RESULT ROW:' as marker,
  t.*
FROM public.publish_site_draft(
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  (SELECT draft_revision FROM public.site_editorial_state WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'),
  '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
) t;

\echo
\echo ============== VERSIONS LIST POST CALL ==============
SELECT
  id::varchar(15) id_prefix,
  version_number,
  status,
  left(created_by::text,12) actor,
  left(note,70) note,
  left(snapshot::text,220)::varchar(240) snap150
FROM public.site_publication_versions
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
ORDER BY version_number DESC;
