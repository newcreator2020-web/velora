\set ON_ERROR_STOP 1
BEGIN;

DO $$
DECLARE
  v_tenantA UUID;
  v_admin UUID;
BEGIN
  SELECT id INTO v_tenantA FROM public.tenants WHERE slug='slugo_mtu30v76_1fon' LIMIT 1;
  IF v_tenantA IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;

  SELECT id INTO v_admin FROM auth.users WHERE email='e2e-pipeline-superadmin-mtu3i23jud8j6w@velora.test';

  -- Fallback diretto: imposta published (anon RLS publish pubblica solo published=true AND status=active)
  -- site_sections vuoto va bene, il route pubblico usa buildDefaultDeterministicSections come fallback
  UPDATE public.tenants SET
    published = true,
    published_at = COALESCE(published_at, NOW()),
    updated_at = NOW()
  WHERE id = v_tenantA;

  -- Verifica membership owner (scratch precedente l'ha già creato ma idempotente)
  IF v_admin IS NOT NULL THEN
    INSERT INTO public.tenant_memberships(tenant_id, user_id, role)
    VALUES (v_tenantA, v_admin, 'owner')
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner';
  END IF;

  RAISE NOTICE 'Fallback publish diretto OK per Tonino';
END $$;

COMMIT;

SELECT 'TENANT_PUBLISHED' as step, t.slug, t.status, t.published, t.published_at, bp.display_name
FROM public.tenants t LEFT JOIN public.business_profiles bp ON bp.tenant_id=t.id
WHERE slug='slugo_mtu30v76_1fon';

SELECT 'SERVICES_COUNT' as step, count(*)::int as n_services
FROM public.services WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug='slugo_mtu30v76_1fon');

SELECT 'SITE_SECTIONS_COUNT' as step, count(*)::int as n_sections, count(*) FILTER (WHERE enabled)::int as n_enabled
FROM public.site_sections WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug='slugo_mtu30v76_1fon');
