-- =============================================================================
-- supabase/seed.sql — TEST DATA ONLY (non versionato come migration DDL)
-- =============================================================================
-- Applicato AUTOMATICAMENTE dal CLI Supabase DOPO tutte le migration, solo
-- locale/test (config.toml db.seed.enabled = true).
--
-- NON DIPENDE da auth.users reali: le fixture di utenti e memberships verranno
-- sostituite o aggiornate dalla suite di test nel beforeAll.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tenants base + onboarding fixture.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'Tenant Alpha', 'tenant-alpha', 'active'),
  ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Tenant Beta',  'tenant-beta',  'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, name, slug, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a2'::uuid, 'Tenant Alpha Onboarding', 'tenant-alpha-onboarding', 'onboarding')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Business profiles deterministici.
-- ---------------------------------------------------------------------------
INSERT INTO public.business_profiles (tenant_id, display_name, category, timezone, locale, description)
VALUES
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'Alpha Barbershop', 'barbershop', 'Europe/Rome', 'it-IT', 'Taglio uomo, barba e trattamenti professionali a Roma.'),
  ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Beta Beauty Studio', 'beauty_salon', 'Europe/Rome', 'it-IT', 'Centro estetico integrato: trattamenti viso, corpo e bellezza.')
ON CONFLICT (tenant_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Audit seed marker (idempotente).
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_logs (id, actor_user_id, tenant_id, action, subject_type, subject_id, metadata)
VALUES (
  '00000000-0000-4000-8000-000000000099'::uuid,
  NULL,
  NULL,
  'seed.applied',
  'database',
  'seed.sql',
  '{"applied_by":"supabase-db-seed"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
