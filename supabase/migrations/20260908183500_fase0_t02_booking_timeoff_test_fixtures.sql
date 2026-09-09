-- FASE 0 TASK 0.2 DEFECT BOOKING TIMEOFF TEST FIXTURES
-- Insert timeoff fixtures per test VLTO1 (N3 full day) e VLTO2 (N4 partial)
-- Tenant: VELORA PROD ACCEPTANCE STUDIO (vecchio) UUID 57ba7988
-- Risorsa: Lucia Bianchi slug=lucia-bianchi

BEGIN;

-- N3: FULL DAY TIMEOFF 16 SETTEMBRE 2026 Lucia (VLTO1 → timeoff_conflict)
INSERT INTO public.resource_time_off
  (tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
SELECT
  t.id,
  sr.id,
  'vacation',
  'Test DEFECT N3 - Ferie FULL Lucia 16/09',
  '2026-09-16 00:00:00+02'::TIMESTAMPTZ,
  '2026-09-17 00:00:00+02'::TIMESTAMPTZ
FROM public.tenants t
JOIN public.staff_resources sr ON sr.tenant_id = t.id
WHERE t.id = '57ba7988-e8e6-46d4-b4ea-3192420d6ab0'
  AND sr.slug = 'lucia-bianchi'
  AND sr.active = TRUE
ON CONFLICT DO NOTHING;

-- N4: PARTIAL TIMEOFF 22 SETTEMBRE 14:00-19:00 Lucia (VLTO2 pomeriggio)
INSERT INTO public.resource_time_off
  (tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
SELECT
  t.id,
  sr.id,
  'custom_block',
  'Test DEFECT N4 - Blocco pomeridiano Lucia 22/09 14-19',
  '2026-09-22 14:00:00+02'::TIMESTAMPTZ,
  '2026-09-22 19:00:00+02'::TIMESTAMPTZ
FROM public.tenants t
JOIN public.staff_resources sr ON sr.tenant_id = t.id
WHERE t.id = '57ba7988-e8e6-46d4-b4ea-3192420d6ab0'
  AND sr.slug = 'lucia-bianchi'
  AND sr.active = TRUE
ON CONFLICT DO NOTHING;

COMMIT;
