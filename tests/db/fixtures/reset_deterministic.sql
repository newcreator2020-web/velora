-- ============================================================
-- RESET DETERMINISTICO FASE 6 — COMPRENSIVO:
--   * VELORA-RESET-A / VELORA-RESET-B (FASE 6 Studio)
--   * TENANT A FASE2-3 MULTI-TENANT-RLS:
--       00000000-0000-4000-8000-0000000000a1 / b1
-- Due esecuzioni consecutive DEVONO essere IDENTICHE.
-- ============================================================

BEGIN;

SET LOCAL search_path TO public;

-- ============================================================
-- 1) FK-safe wipe (memberships → sections → services → editorial → business → tenants → audit
-- ============================================================
ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner;
TRUNCATE TABLE public.audit_logs RESTART IDENTITY CASCADE;
DELETE FROM public.site_sections;
DELETE FROM public.services;
DELETE FROM public.site_editorial_state;
DELETE FROM public.tenant_memberships;
DELETE FROM public.platform_admins;
DELETE FROM public.business_profiles;
DELETE FROM public.tenants;

-- Cleanup profiles/users FASE 6
DELETE FROM public.profiles WHERE id IN (
  '00000000-0000-0000-0000-0000000000A1'::uuid,
  '00000000-0000-0000-0000-0000000000B1'::uuid,
  '11111111-1111-1111-1111-000000000001'::uuid,
  '11111111-1111-1111-1111-000000000002'::uuid,
  '11111111-1111-1111-1111-000000000003'::uuid,
  '11111111-1111-1111-1111-000000000004'::uuid,
  '11111111-1111-1111-1111-000000000005'::uuid,
  '11111111-1111-1111-1111-000000000006'::uuid,
  '11111111-1111-1111-1111-000000000007'::uuid
);
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-0000000000A1'::uuid,
  '00000000-0000-0000-0000-0000000000B1'::uuid,
  '11111111-1111-1111-1111-000000000001'::uuid,
  '11111111-1111-1111-1111-000000000002'::uuid,
  '11111111-1111-1111-1111-000000000003'::uuid,
  '11111111-1111-1111-1111-000000000004'::uuid,
  '11111111-1111-1111-1111-000000000005'::uuid,
  '11111111-1111-1111-1111-000000000006'::uuid,
  '11111111-1111-1111-1111-000000000007'::uuid
);

-- ============================================================
-- 2) TENANT FASE6 — velora-reset-a / -b
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  banned_until, deleted_at, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change_token, phone_change, reauthentication_token)
VALUES (
  '00000000-0000-0000-0000-0000000000A1'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated',
  'owner-a@velora.test', public.crypt('VeloraStudioE2E!Pass123', public.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Owner A"}'::jsonb,
  NULL, NOW(), NOW(), NULL, NULL, false, false,
  '','','','','','',''
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = NOW(),
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', phone_change_token = '', phone_change = '', reauthentication_token = '',
  updated_at = NOW();

INSERT INTO public.profiles (id, display_name, avatar_url)
VALUES ('00000000-0000-0000-0000-0000000000A1'::uuid, 'Owner A', NULL)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();

INSERT INTO public.tenants (id, slug, name, status, published)
VALUES ('00000000-0000-0000-0000-00000000000A'::uuid, 'velora-reset-a', 'Studio Reset A', 'active', false)
ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, status=EXCLUDED.status, published=EXCLUDED.published;

INSERT INTO public.business_profiles(
  tenant_id, display_name, category, description, city, timezone, locale,
  theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
  theme_heading_font_preset, theme_body_font_preset
) VALUES (
  '00000000-0000-0000-0000-00000000000A'::uuid,
  'Studio Reset A','Barbiere','Descrizione Reset A Studio E2E',
  'Roma','Europe/Rome','it',
  '#111827','#FFFFFF','#0f172a','#6b7280','md','sans','sans'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  display_name=EXCLUDED.display_name, category=EXCLUDED.category, description=EXCLUDED.description,
  city=EXCLUDED.city, timezone=EXCLUDED.timezone, locale=EXCLUDED.locale,
  theme_primary=EXCLUDED.theme_primary, theme_background=EXCLUDED.theme_background,
  theme_foreground=EXCLUDED.theme_foreground, theme_muted=EXCLUDED.theme_muted,
  theme_radius=EXCLUDED.theme_radius, theme_heading_font_preset=EXCLUDED.theme_heading_font_preset,
  theme_body_font_preset=EXCLUDED.theme_body_font_preset;

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
VALUES ('00000000-0000-0000-0000-0000000000AA'::uuid,
        '00000000-0000-0000-0000-00000000000A'::uuid,
        '00000000-0000-0000-0000-0000000000A1'::uuid,
        'owner','active')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  banned_until, deleted_at, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change_token, phone_change, reauthentication_token)
VALUES (
  '00000000-0000-0000-0000-0000000000B1'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated',
  'owner-b@velora.test',
  public.crypt('VeloraStudioE2E!Pass123', public.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Owner B"}'::jsonb,
  NULL, NOW(), NOW(), NULL, NULL, false, false,
  '','','','','','',''
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = NOW(),
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', phone_change_token = '', phone_change = '', reauthentication_token = '',
  updated_at = NOW();

-- Manager A
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  banned_until, deleted_at, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change_token, phone_change, reauthentication_token)
VALUES (
  '00000000-0000-0000-0000-0000000000A2'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated',
  'manager-a@velora.test',
  public.crypt('VeloraStudioE2E!Pass123', public.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Manager A"}'::jsonb,
  NULL, NOW(), NOW(), NULL, NULL, false, false,
  '','','','','','',''
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = NOW(),
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', phone_change_token = '', phone_change = '', reauthentication_token = '',
  updated_at = NOW();

INSERT INTO public.profiles (id, display_name, avatar_url)
VALUES ('00000000-0000-0000-0000-0000000000A2'::uuid, 'Manager A', NULL)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
VALUES ('00000000-0000-0000-0000-0000000000A4'::uuid,
        '00000000-0000-0000-0000-00000000000A'::uuid,
        '00000000-0000-0000-0000-0000000000A2'::uuid,
        'manager','active')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status;

-- Staff A (read-only FASE6)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  banned_until, deleted_at, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change_token, phone_change, reauthentication_token)
VALUES (
  '00000000-0000-0000-0000-0000000000A3'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated',
  'staff-a@velora.test',
  public.crypt('VeloraStudioE2E!Pass123', public.gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Staff A"}'::jsonb,
  NULL, NOW(), NOW(), NULL, NULL, false, false,
  '','','','','','',''
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = NOW(),
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', phone_change_token = '', phone_change = '', reauthentication_token = '',
  updated_at = NOW();

INSERT INTO public.profiles (id, display_name, avatar_url)
VALUES ('00000000-0000-0000-0000-0000000000A3'::uuid, 'Staff A', NULL)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
VALUES ('00000000-0000-0000-0000-0000000000A5'::uuid,
        '00000000-0000-0000-0000-00000000000A'::uuid,
        '00000000-0000-0000-0000-0000000000A3'::uuid,
        'staff','active')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status;

INSERT INTO public.profiles (id, display_name, avatar_url)
VALUES ('00000000-0000-0000-0000-0000000000B1'::uuid, 'Owner B', NULL)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();

INSERT INTO public.tenants (id, slug, name, status, published)
VALUES ('00000000-0000-0000-0000-00000000000B'::uuid, 'velora-reset-b', 'Studio Reset B', 'active', false)
ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, status=EXCLUDED.status, published=EXCLUDED.published;

INSERT INTO public.business_profiles(
  tenant_id, display_name, category, description, city, timezone, locale,
  theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
  theme_heading_font_preset, theme_body_font_preset
) VALUES (
  '00000000-0000-0000-0000-00000000000B'::uuid,
  'Studio Reset B','Barbiere','Descrizione Reset B Studio E2E',
  'Milano','Europe/Rome','it',
  '#7c2d12','#FFFFFF','#111827','#6b7280','lg','sans','sans'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  display_name=EXCLUDED.display_name, category=EXCLUDED.category, description=EXCLUDED.description,
  city=EXCLUDED.city, timezone=EXCLUDED.timezone, locale=EXCLUDED.locale,
  theme_primary=EXCLUDED.theme_primary, theme_background=EXCLUDED.theme_background,
  theme_foreground=EXCLUDED.theme_foreground, theme_muted=EXCLUDED.theme_muted,
  theme_radius=EXCLUDED.theme_radius, theme_heading_font_preset=EXCLUDED.theme_heading_font_preset,
  theme_body_font_preset=EXCLUDED.theme_body_font_preset;

INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
VALUES ('00000000-0000-0000-0000-0000000000BB'::uuid,
        '00000000-0000-0000-0000-00000000000B'::uuid,
        '00000000-0000-0000-0000-0000000000B1'::uuid,
        'owner','active')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status;

-- ============================================================
-- 3) TENANT FASE2-3 — multi-tenant-rls.test.ts
--    FIXTURE.tenants.A = 00000000-0000-4000-8000-0000000000a1
--    FIXTURE.tenants.B = 00000000-0000-4000-8000-0000000000b1
--    (prima di memberships, i tenants DEVONO esistere!)
-- ============================================================
INSERT INTO public.tenants (id, slug, name, status, published)
VALUES ('00000000-0000-4000-8000-0000000000a1'::uuid, 'tenant-alpha', 'Alpha Barbershop', 'active', false)
ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, status=EXCLUDED.status, published=EXCLUDED.published;

INSERT INTO public.tenants (id, slug, name, status, published)
VALUES ('00000000-0000-4000-8000-0000000000b1'::uuid, 'tenant-beta', 'Tenant Beta', 'active', false)
ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, status=EXCLUDED.status, published=EXCLUDED.published;

INSERT INTO public.business_profiles(
  tenant_id, display_name, category, description, city, timezone, locale,
  theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
  theme_heading_font_preset, theme_body_font_preset
) VALUES (
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'Alpha Barbershop','Barbiere','Alpha Barbershop — Descrizione',
  'Roma','Europe/Rome','it',
  '#0f172a','#FFFFFF','#0f172a','#64748b','md','sans','sans'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  display_name=EXCLUDED.display_name, category=EXCLUDED.category, description=EXCLUDED.description,
  city=EXCLUDED.city, timezone=EXCLUDED.timezone, locale=EXCLUDED.locale,
  theme_primary=EXCLUDED.theme_primary, theme_background=EXCLUDED.theme_background,
  theme_foreground=EXCLUDED.theme_foreground, theme_muted=EXCLUDED.theme_muted,
  theme_radius=EXCLUDED.theme_radius, theme_heading_font_preset=EXCLUDED.theme_heading_font_preset,
  theme_body_font_preset=EXCLUDED.theme_body_font_preset;

INSERT INTO public.business_profiles(
  tenant_id, display_name, category, description, city, timezone, locale,
  theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
  theme_heading_font_preset, theme_body_font_preset
) VALUES (
  '00000000-0000-4000-8000-0000000000b1'::uuid,
  'Tenant Beta','Servizi','Tenant Beta — Descrizione',
  'Milano','Europe/Rome','it',
  '#334155','#FFFFFF','#0f172a','#64748b','md','sans','sans'
)
ON CONFLICT (tenant_id) DO UPDATE SET
  display_name=EXCLUDED.display_name, category=EXCLUDED.category, description=EXCLUDED.description,
  city=EXCLUDED.city, timezone=EXCLUDED.timezone, locale=EXCLUDED.locale,
  theme_primary=EXCLUDED.theme_primary, theme_background=EXCLUDED.theme_background,
  theme_foreground=EXCLUDED.theme_foreground, theme_muted=EXCLUDED.theme_muted,
  theme_radius=EXCLUDED.theme_radius, theme_heading_font_preset=EXCLUDED.theme_heading_font_preset,
  theme_body_font_preset=EXCLUDED.theme_body_font_preset;

ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner;

-- ============================================================
-- SAFETY NET — GoTrue richiede text non NULL per questi campi.
-- Normalizza a '' qualunque INSERT precedente avesse lasciato NULL.
-- ============================================================
UPDATE auth.users SET
  confirmation_token     = '',
  recovery_token         = '',
  email_change_token_new = '',
  email_change           = '',
  phone_change_token     = '',
  phone_change           = '',
  reauthentication_token = '',
  updated_at             = NOW()
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR phone_change_token IS NULL
   OR phone_change IS NULL
   OR reauthentication_token IS NULL;

COMMIT;
