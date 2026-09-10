-- ============================================================
-- STEP 0 REALE: INSERT site_editorial_state PIPELINE
--             colonne vere: sections, services, theme, draft_revision, updated_at
-- ============================================================
INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme, draft_revision, updated_at)
SELECT
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  '[
    {"type":"navbar","order":1,"props":{"title":"Studio Prime Pipeline","links":["Home","Servizi","Chi Siamo","Contatti"],"logo":""}},
    {"type":"hero","order":2,"props":{"title":"ORIGINALE HERO V1","subtitle":"Sottotitolo V1","cta":"Prenota ora"}},
    {"type":"about","order":3,"props":{"title":"Chi siamo","body":"Testo originale v1"}},
    {"type":"services","order":4,"props":{"title":"Servizi"}},
    {"type":"trust","order":5,"props":{"title":"Perche sceglierci","items":["A","B","C"]}}
  ]'::jsonb,
  '[]'::jsonb,
  '{"colors":{"primary":"#4f46e5"},"fonts":{"heading":"Inter"}}'::jsonb,
  gen_random_uuid(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_editorial_state WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
);

SELECT 'POST INSERT INIT' step,
  left(draft_revision::text,10) revision_prefix,
  jsonb_array_length(sections) n_sections,
  jsonb_array_length(services) n_services,
  jsonb_typeof(theme) theme_type
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';
