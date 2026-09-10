-- ============================================================
-- Step 0: INSERT INIT editorial state PIPELINE se non esiste
-- ============================================================
INSERT INTO public.site_editorial_state (
  tenant_id, revision, status, theme_json, sections_json, services_json,
  published_at, created_at, updated_at
)
SELECT
  'f702efb6-549c-4f29-a84e-7d6e24b8159c'::uuid,
  1,
  'draft',
  '{"colors":{"primary":"#4f46e5","secondary":"#f59e0b"},"fonts":{"heading":"Inter","body":"Inter"}}'::jsonb,
  '[
    {"type":"navbar","order":1,"props":{"title":"Studio Prime Pipeline","links":["Home","Servizi","Chi Siamo","Contatti"],"logo":""}},
    {"type":"hero","order":2,"props":{"title":"Titolo HERO ORIGINALE V1","subtitle":"Sottotitolo originale v1","cta":"Scopri i servizi"}},
    {"type":"about","order":3,"props":{"title":"Chi siamo","body":"Testo originale V1 about us"}},
    {"type":"services","order":4,"props":{"title":"Listino prezzi"}},
    {"type":"trust","order":5,"props":{"title":"Perche sceglierci","badges":["Qualita","Affidabilita","Professionalita"]}}
  ]'::jsonb,
  '[]'::jsonb,
  NULL, now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_editorial_state
  WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c'
);

SELECT 'INSERT RESULT' as step, COUNT(*) editorial_exists_now
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';

SELECT revision, status, left(sections_json::text,120) sections
FROM public.site_editorial_state
WHERE tenant_id='f702efb6-549c-4f29-a84e-7d6e24b8159c';
