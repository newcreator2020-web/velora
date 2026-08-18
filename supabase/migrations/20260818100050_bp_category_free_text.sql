-- ====================================================================
-- FASE 2 — business_profiles.category: FREE TEXT
--
-- Motivo:
--   Il CHECK constraint legacy della FASE 1 limitava category a 9 valori
--   fissi. Il prodotto permette categorie custom per ogni tenant
--   (es. "Estetica", "Servizi", "Altro") → DROP constraint.
--
-- Append-only. Non tocca le migration FASE 1 congelate.
-- ====================================================================

ALTER TABLE IF EXISTS public.business_profiles
  DROP CONSTRAINT IF EXISTS business_profiles_category_check;
