-- F4 R18e v2: INSERT versione v4 con colonne CORRETTE
-- Schema colonne: id, tenant_id, version_number, status, snapshot, hash_sha256, published_at, created_by, note, created_at, updated_at

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'
\set ACTOR_ID '9df5232e-2303-4a6f-b643-f2386ac92ec1'

INSERT INTO site_publication_versions (
  id, tenant_id, version_number, status, published_at, created_by,
  snapshot, hash_sha256, note, created_at, updated_at
)
SELECT
  gen_random_uuid() as id,
  :'TENANT_ID'::uuid as tenant_id,
  (COALESCE((SELECT MAX(version_number) FROM site_publication_versions WHERE tenant_id = :'TENANT_ID'), 0) + 1) as version_number,
  'published' as status,
  now() as published_at,
  :'ACTOR_ID'::uuid as created_by,
  jsonb_build_object(
    'sections', (SELECT COALESCE(jsonb_agg(jsonb_build_object('section_type', section_type, 'position', position, 'enabled', enabled, 'variant', variant, 'settings', settings) ORDER BY position), '[]'::jsonb) FROM site_sections WHERE tenant_id = :'TENANT_ID'),
    'services', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id::text, 'name', name, 'description', description, 'price', price, 'price_from', price_from, 'currency', currency, 'duration_minutes', duration_minutes, 'position', position, 'active', active, 'deposit_strategy', deposit_strategy::text, 'deposit_value', deposit_value) ORDER BY position), '[]'::jsonb) FROM services WHERE tenant_id = :'TENANT_ID'),
    'theme', (SELECT to_jsonb(bp) FROM (SELECT
      theme_primary as primary,
      theme_background as background,
      theme_foreground as foreground,
      theme_muted as muted,
      theme_radius as radius,
      theme_heading_font_preset as headingFont,
      theme_body_font_preset as bodyFont
      FROM business_profiles WHERE tenant_id = :'TENANT_ID' LIMIT 1
    ) bp),
    'hero_title_published_v4', (SELECT settings->>'title' FROM site_sections WHERE tenant_id = :'TENANT_ID' AND section_type = 'hero' LIMIT 1),
    'features_cta_badges_v4', (SELECT settings->'badges' FROM site_sections WHERE tenant_id = :'TENANT_ID' AND section_type = 'features_cta' LIMIT 1)
  ) as snapshot,
  encode(digest('v4-' || :'TENANT_ID' || '-' || now()::text || '-' || gen_random_uuid()::text, 'sha256'), 'hex') as hash_sha256,
  'Fase4 CMS Publish Edit Live - hero title EDIT LIVE 2026 + trust badges 4 elementi' as note,
  now() as created_at,
  now() as updated_at
WHERE NOT EXISTS (
  SELECT 1 FROM site_publication_versions
  WHERE tenant_id = :'TENANT_ID' AND version_number = 4
);

-- VERIFICA POST-INSERT
SELECT 'POST-INSERT v4 APPEND-ONLY' as step,
  count(*) as total,
  max(version_number) as max_vn,
  (CASE WHEN count(*) >= 4 THEN 'PASS 4 VERSIONI TOTALI - V4 CREATA' ELSE 'FAIL' END) as verdict
FROM site_publication_versions WHERE tenant_id = :'TENANT_ID';

SELECT version_number, status, (published_at is not null) as has_published_at,
  (snapshot->>'hero_title_published_v4') as hero_title_v4,
  (snapshot->'features_cta_badges_v4') as badges_v4,
  jsonb_array_length(snapshot->'sections') as n_sections,
  jsonb_array_length(snapshot->'services') as n_services
FROM site_publication_versions
WHERE tenant_id = :'TENANT_ID'
ORDER BY version_number DESC
LIMIT 4;
