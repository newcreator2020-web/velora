-- F4 FIX R18c v3: Aggiunge mapping section_type NON validi → section_type permessi dal check constraint
-- VALIDI: hero,about,services,gallery,staff,reviews,contact,price_list,features_cta,booking_widget
-- NOSTRI: navbar(❌), trust(❌), contacts(❌ plurale)
-- SOLUZIONE: navbar→RIMUOVI (pubblico ha gia nav inline riga 100), trust→features_cta, contacts→contact

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'

WITH current_es AS (
  SELECT sections FROM site_editorial_state WHERE tenant_id = :'TENANT_ID' LIMIT 1
),
remapped_sections AS (
  SELECT jsonb_agg(
    jsonb_set(
      jsonb_set(section, '{section_type}', to_jsonb(new_section_type)::jsonb),
      '{position}', to_jsonb(new_position)::jsonb
    )
    ORDER BY new_position
  ) AS new_sections
  FROM (
    SELECT
      section,
      CASE
        WHEN section->>'section_type' = 'navbar'     THEN NULL -- rimossa
        WHEN section->>'section_type' = 'trust'      THEN 'features_cta'
        WHEN section->>'section_type' = 'contacts'   THEN 'contact'
        ELSE section->>'section_type'
      END AS new_section_type,
      row_number() OVER (
        ORDER BY CASE
          WHEN section->>'section_type' = 'navbar' THEN 999 -- alla fine per filtrare
          ELSE COALESCE((section->>'position')::int, 9999)
        END
      ) - 1 AS new_position
    FROM current_es,
         LATERAL jsonb_array_elements(current_es.sections::jsonb) AS section
  ) t
  WHERE new_section_type IS NOT NULL -- esclude navbar
)
UPDATE site_editorial_state
SET
  sections = (SELECT new_sections FROM remapped_sections),
  draft_revision = gen_random_uuid(), -- nuova revision per il mapping
  updated_at = now()
WHERE tenant_id = :'TENANT_ID';

-- VERIFICA POST-MAPPING
SELECT
  'post_mapping_check' as step,
  count(*) as n_sections,
  string_agg(s->>'section_type', ', ' ORDER BY (s->>'position')::int) as section_types,
  max(CASE WHEN s->>'section_type' = 'hero' THEN s->'settings'->>'title' ELSE NULL END) as hero_title_ok,
  max(CASE WHEN s->>'section_type' = 'features_cta' THEN jsonb_array_length(s->'settings'->'badges') ELSE NULL END) as trust_badges_count_in_features_cta
FROM site_editorial_state, jsonb_array_elements(sections::jsonb) s
WHERE tenant_id = :'TENANT_ID';

-- Revision check finale per publish
SELECT 'final_revision_before_publish' as step, draft_revision FROM site_editorial_state WHERE tenant_id = :'TENANT_ID';
