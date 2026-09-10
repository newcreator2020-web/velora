-- F4 FIX R18d v4: Mapping theme chiavi ai valori permessi da business_profiles constraints
-- heading_font_preset: sans | serif | mono | display
-- body_font_preset:    sans | serif | mono
-- radius:              none | sm | md | lg | xl | full
-- VALORI INIZIALI: headingFont=Poppins / bodyFont=Roboto / radius=rounded-lg
-- SOLUZIONE: Poppins -> display, Roboto -> sans, rounded-lg -> lg
-- Il pubblico usa direttamente fonts da theme vars, questi preset sono solo x business_profiles constraint.

\set TENANT_ID 'd5a0538e-567e-45ee-b00e-61659ed50637'

UPDATE site_editorial_state
SET
  theme = jsonb_set(
    jsonb_set(
      jsonb_set(
        theme,
        '{headingFont}',
        to_jsonb(CASE WHEN theme->>'headingFont' = 'Poppins' THEN 'display' ELSE COALESCE(theme->>'headingFont', 'display') END)::jsonb
      ),
      '{bodyFont}',
      to_jsonb(CASE WHEN theme->>'bodyFont' = 'Roboto' THEN 'sans' ELSE COALESCE(theme->>'bodyFont', 'sans') END)::jsonb
    ),
    '{radius}',
    to_jsonb(CASE
      WHEN theme->>'radius' IN ('rounded-none','none') THEN 'none'
      WHEN theme->>'radius' IN ('rounded-sm','sm') THEN 'sm'
      WHEN theme->>'radius' IN ('rounded','md','rounded-md') THEN 'md'
      WHEN theme->>'radius' IN ('rounded-lg','lg') THEN 'lg'
      WHEN theme->>'radius' IN ('rounded-xl','xl') THEN 'xl'
      WHEN theme->>'radius' IN ('rounded-full','full') THEN 'full'
      ELSE COALESCE(theme->>'radius', 'md')
    END)::jsonb
  ),
  draft_revision = gen_random_uuid(),
  updated_at = now()
WHERE tenant_id = :'TENANT_ID';

-- VERIFICA POST-MAPPING THEME
SELECT 'post_theme_mapping' as step,
  theme->>'headingFont' as heading_preset,
  theme->>'bodyFont' as body_preset,
  theme->>'radius' as radius_preset,
  theme->>'primary' as primary_color
FROM site_editorial_state WHERE tenant_id = :'TENANT_ID';

SELECT 'revision_before_publish_v4' as step, draft_revision FROM site_editorial_state WHERE tenant_id = :'TENANT_ID';
