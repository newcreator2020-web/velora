-- R18 PRECHECK: verifica SUPER_ADMIN e' platform_admin e verifica membership Tonino
-- SUPER_ADMIN user_id = 9df5232e-2303-4a6f-b643-f2386ac92ec1
-- Tonino tenant_id = d5a0538e-567e-45ee-b00e-61659ed50637

-- 1. Check platform_admins entry
SELECT
  'platform_admins_check' AS step,
  user_id,
  status,
  created_at
FROM public.platform_admins
WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid;

-- 2. Check tenant_memberships Tonino per SUPER_ADMIN
SELECT
  'membership_tonino_sa_check' AS step,
  user_id,
  tenant_id,
  role,
  status
FROM public.tenant_memberships
WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
  AND tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid;

-- 3. Tutte le membership di SUPER_ADMIN (per capire order by in auth.ts)
SELECT
  'all_sa_memberships' AS step,
  m.tenant_id,
  t.slug,
  t.display_name,
  m.role,
  m.status,
  m.created_at
FROM public.tenant_memberships m
JOIN public.tenants t ON t.id = m.tenant_id
WHERE m.user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid
ORDER BY m.role ASC, m.created_at DESC;
