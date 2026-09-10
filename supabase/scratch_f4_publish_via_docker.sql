-- F4 PUBLISH SCRIPT DOCKER PSQL TONINO R18 FIX v2
-- FIX R18: Transazione con SET LOCAL request.jwt.claim.sub = SUPER_ADMIN_UID
-- auth.uid() nelle funzioni has_tenant_role / is_platform_admin restituisce l'UID corretto
-- Chiamata RPC publish_site_draft(UUID, UUID, UUID)

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'
\set ACTOR_ID '9df5232e-2303-4a6f-b643-f2386ac92ec1'

-- 1. Verifica revision corrente Tonino da site_editorial_state
SELECT
  'STEP 1: editorial_state Tonino post-conversione' as step,
  exists(select 1 from site_editorial_state where tenant_id = :'TENANT_ID') as es_exists,
  (select draft_revision from site_editorial_state where tenant_id = :'TENANT_ID') as current_revision,
  (select hero_title from (
    select section->'settings'->>'title' as hero_title
    from (
      select jsonb_array_elements(sections::jsonb) as section
      from site_editorial_state where tenant_id = :'TENANT_ID'
    ) s where section->>'section_type' = 'hero' limit 1
  ) t) as hero_title_from_es;

-- 2. Verifica versioni pubblicate pre-publish
select 'STEP 2: pre-publish site_publication_versions' as step, count(*) as total from site_publication_versions where tenant_id = :'TENANT_ID';
select version_number, status, (published_at is not null) as has_published_at, created_at
from site_publication_versions where tenant_id = :'TENANT_ID' order by version_number desc;

-- ========================================================================================
-- 3. PUBLISH VIA TRANSACTION + SET LOCAL JWT CLAIM SIMULAZIONE SESSIONE SUPER_ADMIN
-- ========================================================================================
BEGIN;
  SET LOCAL request.jwt.claim.sub = '9df5232e-2303-4a6f-b643-f2386ac92ec1';
  SET LOCAL request.jwt.claim.role = 'authenticated';

  select 'STEP 3: publish_site_draft() in transazione con auth.uid() = SUPER_ADMIN' as step;

  -- Esegui publish 3-arg
  select * from public.publish_site_draft(
    :'TENANT_ID'::uuid,
    (select draft_revision from site_editorial_state where tenant_id = :'TENANT_ID')::uuid,
    :'ACTOR_ID'::uuid
  );
COMMIT;

-- 4. Verifica post-publish: version_number=4 (vMax+1) + v1-v3 NON cancellati
select 'STEP 4: post-publish check versions APPEND ONLY' as step;
select count(*) as total_versions, max(version_number) as latest_version,
  (case when count(*) >= 4 then 'PASS >= 4 versions APPEND ONLY' else 'FAIL' end) as append_only_check
from site_publication_versions where tenant_id = :'TENANT_ID';

select version_number, status, (published_at is not null) as has_published_at,
  left(snapshot::text, 120) as snapshot_preview, created_at
from site_publication_versions where tenant_id = :'TENANT_ID' order by version_number desc;

-- 5. Verifica site_sections e services dopo publish (apply by RPC
select 'STEP 5: site_sections count (apply by RPC)' as step, count(*) from site_sections where tenant_id = :'TENANT_ID';
select 'STEP 5: services count (apply by RPC)' as step, count(*) from services where tenant_id = :'TENANT_ID';

-- 5b. Verifica hero e trust in site_sections dopo publish (conferma pubblicazione reale)
select 'STEP 5b: site_sections hero verify hero.title h1' as step,
  section_type, position,
  (settings->>'title') as hero_title_in_site_sections,
  (settings->>'badges') as trust_badges_in_site_sections
from site_sections where tenant_id = :'TENANT_ID' and section_type in ('hero', 'trust');

-- 6. Verifica tenants.published = true nuovamente
select 'STEP 6: tenants.published torna true dopo publish' as step,
  published, slug, published_at
from tenants where id = :'TENANT_ID';
