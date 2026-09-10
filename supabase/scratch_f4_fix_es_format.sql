-- F4 FIX R18b v2: Converte site_editorial_state Tonino nel formato DB NORMALIZZATO
-- Alias espliciti WITH ORDINALITY per evitare errore column "section" does not exist

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'

-- Verifica pre-conversione: count servizi Tonino nella tabella services
SELECT 'precheck_services_count' as step, count(*) as n_svc_in_services_table FROM public.services WHERE tenant_id = :'TENANT_ID';

-- ========================================================================================
-- STEP 1: Conversione SEZIONI
-- ========================================================================================
WITH current_es AS (
  SELECT sections, services, theme
  FROM site_editorial_state WHERE tenant_id = :'TENANT_ID' LIMIT 1
),
converted_sections AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'section_type', t.section->>'type',
      'enabled', true,
      'position', COALESCE((t.section->>'order')::INTEGER, t.row_number - 1),
      'variant', 'default',
      'settings', COALESCE(t.section->'props', '{}'::jsonb)
    )
    ORDER BY COALESCE((t.section->>'order')::INTEGER, t.row_number)
  ) AS new_sections
  FROM current_es,
       LATERAL jsonb_array_elements(current_es.sections::jsonb) WITH ORDINALITY AS t(section, row_number)
  WHERE t.section->>'type' IS NOT NULL
),
-- ========================================================================================
-- STEP 2: Conversione SERVICES (da tabella public.services Tonino)
-- ========================================================================================
converted_services AS (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id::text,
      'name', COALESCE(NULLIF(btrim(s.name),''),'Servizio'),
      'description', s.description,
      'price', s.price,
      'price_from', s.price_from,
      'currency', COALESCE(NULLIF(btrim(s.currency),''),'EUR'),
      'duration_minutes', s.duration_minutes,
      'position', COALESCE(s.position, t.row_number - 1),
      'active', COALESCE(s.active, true),
      'deposit_strategy', COALESCE(s.deposit_strategy::text, 'NONE'),
      'deposit_value', COALESCE(s.deposit_value, 0)
    )
    ORDER BY COALESCE(s.position, t.row_number)
  ), '[]'::jsonb) AS new_services
  FROM (
    SELECT s.*, row_number() OVER (ORDER BY COALESCE(s.position, 99999), s.id) AS row_number
    FROM public.services s
    WHERE s.tenant_id = :'TENANT_ID'
  ) s, LATERAL (SELECT s.row_number) AS t(row_number)
),
-- ========================================================================================
-- STEP 3: Conversione THEME (flat format)
-- ========================================================================================
converted_theme AS (
  SELECT jsonb_build_object(
    'primary',      COALESCE(theme->'colors'->>'primary', '#ec4899'),
    'background',   COALESCE(theme->'colors'->>'background', '#ffffff'),
    'foreground',   COALESCE(theme->'colors'->>'foreground', '#111827'),
    'muted',        COALESCE(theme->'colors'->>'secondary', theme->'colors'->>'muted', '#6b7280'),
    'radius',       COALESCE(theme->>'radius', 'rounded-lg'),
    'headingFont',  COALESCE(theme->'fonts'->>'heading', 'Poppins'),
    'bodyFont',     COALESCE(theme->'fonts'->>'body', 'Roboto')
  ) AS new_theme
  FROM current_es
)
UPDATE site_editorial_state
SET
  sections = (SELECT new_sections FROM converted_sections),
  services = (SELECT new_services FROM converted_services),
  theme    = (SELECT new_theme FROM converted_theme),
  draft_revision = gen_random_uuid(),
  updated_at = now()
WHERE tenant_id = :'TENANT_ID';

-- ========================================================================================
-- VERIFICA POST-CONVERSIONE
-- ========================================================================================
SELECT 'sections_check' as step,
  count(*) as n,
  count(*) filter (where s->>'section_type' is not null) as ok_section_type,
  count(*) filter (where (s->>'position')::int is not null) as ok_position,
  count(*) filter (where s->'settings' is not null) as ok_settings,
  max(CASE WHEN s->>'section_type' = 'hero' THEN s->'settings'->>'title' ELSE NULL END) as hero_title_confirm
FROM site_editorial_state, jsonb_array_elements(sections::jsonb) s
WHERE tenant_id = :'TENANT_ID';

SELECT 'services_check' as step,
  count(*) as n,
  count(*) filter (where svc->>'id' is not null) as ok_id,
  count(*) filter (where (svc->>'duration_minutes')::int is not null) as ok_duration,
  count(*) filter (where (svc->>'price')::numeric is not null) as ok_price,
  count(*) filter (where (svc->>'active')::boolean) as ok_active,
  count(*) filter (where svc->>'deposit_strategy' is not null) as ok_deposit,
  string_agg(svc->>'name', ' | ') as names
FROM site_editorial_state, jsonb_array_elements(services::jsonb) svc
WHERE tenant_id = :'TENANT_ID';

SELECT 'theme_check' as step,
  theme->>'primary' as primary_color,
  theme->>'headingFont' as heading_font,
  theme->>'bodyFont' as body_font,
  theme->>'radius' as radius,
  (theme->'colors' is null and theme->'fonts' is null) as nested_removed
FROM site_editorial_state WHERE tenant_id = :'TENANT_ID';

-- draft_revision attuale (per usare in publish)
SELECT 'revision_check' as step, draft_revision FROM site_editorial_state WHERE tenant_id = :'TENANT_ID';
