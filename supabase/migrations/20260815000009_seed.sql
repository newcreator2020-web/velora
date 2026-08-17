-- 009: Deterministic seed (tenants + business_profiles + placeholder memberships).
-- NOTE: memberships.user_id here are placeholder UUIDs only; the real
-- provisioning of auth.users + profiles + correct memberships.user_id is
-- performed by tests using public.test_provision_user() RPC (see 009e).

INSERT INTO public.tenants (id, name, slug, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'Tenant Alpha', 'tenant-alpha', 'active'),
  ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Tenant Beta',  'tenant-beta',  'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id, name, slug, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a2'::uuid, 'Tenant Alpha Onboarding', 'tenant-alpha-onboarding', 'onboarding')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_profiles (tenant_id, display_name, category, timezone, locale, description)
VALUES
  ('00000000-0000-4000-8000-0000000000a1'::uuid, 'Alpha Barbershop', 'barbershop', 'Europe/Rome', 'it-IT', 'Taglio uomo, barba e trattamenti professionali a Roma.'),
  ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Beta Beauty Studio', 'beauty_salon', 'Europe/Rome', 'it-IT', 'Centro estetico integrato: trattamenti viso, corpo e bellezza.')
ON CONFLICT (tenant_id) DO NOTHING;

-- Placeholder memberships: only insert if the referenced user_id already exists
-- in public.profiles (avoids FK violation on clean cloud instances).
DO $$
DECLARE
  _rows RECORD;
BEGIN
  FOR _rows IN (
    SELECT * FROM (VALUES
      ('00000000-0000-4000-8000-000000000101'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, '11111111-1111-1111-1111-000000000001'::uuid, 'owner',   'active'),
      ('00000000-0000-4000-8000-000000000102'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, '11111111-1111-1111-1111-000000000002'::uuid, 'manager', 'active'),
      ('00000000-0000-4000-8000-000000000103'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid, '11111111-1111-1111-1111-000000000003'::uuid, 'staff',   'active'),
      ('00000000-0000-4000-8000-000000000104'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid, '11111111-1111-1111-1111-000000000004'::uuid, 'owner',   'active'),
      ('00000000-0000-4000-8000-000000000105'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid, '11111111-1111-1111-1111-000000000005'::uuid, 'staff',   'active')
    ) AS t(id, tid, uid, role, st)
  ) LOOP
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _rows.uid)
       AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = _rows.tid AND user_id = _rows.uid) THEN
      INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, status)
      VALUES (_rows.id, _rows.tid, _rows.uid, _rows.role, _rows.st);
    END IF;
  END LOOP;
END $$;

-- Placeholder platform_admin: only insert if user exists in profiles.
DO $$
DECLARE
  _uid UUID := '11111111-1111-1111-1111-000000000006'::uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid)
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _uid) THEN
    INSERT INTO public.platform_admins (user_id, status, grant_reason)
    VALUES (_uid, 'active', 'seed platform admin');
  END IF;
END $$;

-- Audit seed marker (append-only, so only insert if absent by id).
INSERT INTO public.audit_logs (id, action, entity_type, entity_id, metadata)
VALUES
  ('00000000-0000-4000-8000-0000000000fe'::uuid, 'system.seed', NULL, NULL, '{"seed_version":"009","source":"deterministic_migration"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
