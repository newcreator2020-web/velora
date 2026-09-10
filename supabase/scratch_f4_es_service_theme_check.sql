-- F4 CHECK: formato services e theme dentro site_editorial_state
-- Verifico corrispondenza con le chiavi che RPC publish si aspetta

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'

-- 1. Conta servizi e chiavi per ogni servizio (primi 2)
SELECT
  'svc_keys' AS step,
  row_number,
  jsonb_object_keys(svc) as svc_key,
  left(svc::text, 120) as preview
FROM (
  SELECT jsonb_array_elements(services::jsonb) as svc,
         ordinality as row_number
  FROM site_editorial_state,
       jsonb_array_elements(services::jsonb) WITH ORDINALITY
  WHERE tenant_id = :'TENANT_ID'
) s
LIMIT 20;

-- 2. Theme keys (primi 10)
SELECT
  'theme_keys' AS step,
  jsonb_object_keys(theme::jsonb) as theme_key,
  left(jsonb_each_text(theme::jsonb)::text, 80) as kv
FROM site_editorial_state
WHERE tenant_id = :'TENANT_ID'
LIMIT 10;
