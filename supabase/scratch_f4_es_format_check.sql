-- F4 CHECK: formato sections dentro site_editorial_state prima di publish
-- Confronto con il formato atteso dalla RPC (section_type/position/settings vs type/order/props)

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'

-- 1. Dump RAW sections JSONB primi 3 elementi per vedere le chiavi
SELECT
  'raw_section_keys_check' as step,
  (section->>'type') as type_key,
  (section->>'section_type') as section_type_key,
  (section->>'order') as order_key,
  (section->>'position') as position_key,
  (section->'props' is not null) as has_props,
  (section->'settings' is not null) as has_settings,
  jsonb_object_keys(section) as actual_key,
  left(section::text, 100) as preview
FROM (
  SELECT jsonb_array_elements(sections::jsonb) as section,
         ordinality
  FROM site_editorial_state,
       jsonb_array_elements(sections::jsonb) WITH ORDINALITY
  WHERE tenant_id = :'TENANT_ID'
) s
ORDER BY ordinality
LIMIT 6;

-- 2. Count quanti hanno type vs section_type
SELECT
  'format_stats' as step,
  count(*) filter (where section->>'type' is not null) as using_type,
  count(*) filter (where section->>'section_type' is not null) as using_section_type,
  count(*) filter (where section->'props' is not null) as using_props,
  count(*) filter (where section->'settings' is not null) as using_settings
FROM (
  SELECT jsonb_array_elements(sections::jsonb) as section
  FROM site_editorial_state
  WHERE tenant_id = :'TENANT_ID'
) s;
