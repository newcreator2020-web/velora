-- Setup fixture Fase2 Golden Path: reset pw admin, membership owner, publish tenant A
\set ON_ERROR_STOP 1
BEGIN;

-- 1) Admin ID deterministicamente
DO $$
DECLARE
  v_admin UUID;
  v_tenantA UUID;
  v_role TEXT;
BEGIN
  SELECT id INTO v_admin FROM auth.users WHERE email = 'e2e-pipeline-superadmin-mtu3i23jud8j6w@velora.test';
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'admin not found';
  END IF;

  -- Reset password
  UPDATE auth.users SET
    encrypted_password = public.crypt('VeloraTest12345!', public.gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    banned_until = NULL,
    deleted_at = NULL,
    updated_at = NOW()
  WHERE id = v_admin;

  -- Tenant A (slugo_mtu30v76_1fon)
  SELECT id INTO v_tenantA FROM public.tenants WHERE slug = 'slugo_mtu30v76_1fon' LIMIT 1;
  IF v_tenantA IS NULL THEN RAISE EXCEPTION 'tenant A not found'; END IF;

  -- Insert membership owner (check schema colonne prima)
  BEGIN
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
    VALUES (v_tenantA, v_admin, 'owner')
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'membership insert fallito per colonne non trovate; skip';
  END;

  -- Aggiorna business_profile minimo se vuoto
  INSERT INTO public.business_profiles(tenant_id, display_name, category, description, phone, email, city, timezone, locale, created_at, updated_at)
  VALUES (
    v_tenantA,
    'Estetista da Tonino (Test)',
    'estetista',
    'Centro estetico specializzato in trattamenti corpo e viso a Roma. Qualita premium dal 1998.',
    '+393331234567',
    'tonino@estetistadatono.it',
    'Roma',
    'Europe/Rome',
    'it-IT',
    NOW(),
    NOW()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    display_name = COALESCE(EXCLUDED.display_name, public.business_profiles.display_name),
    phone = COALESCE(EXCLUDED.phone, public.business_profiles.phone),
    email = COALESCE(EXCLUDED.email, public.business_profiles.email),
    city = COALESCE(EXCLUDED.city, public.business_profiles.city),
    timezone = COALESCE(EXCLUDED.timezone, public.business_profiles.timezone),
    locale = COALESCE(EXCLUDED.locale, public.business_profiles.locale),
    description = COALESCE(EXCLUDED.description, public.business_profiles.description),
    updated_at = NOW();

  -- Seed servizi estetista 9 se non gia presenti
  IF (SELECT count(*) FROM public.services WHERE tenant_id = v_tenantA) = 0 THEN
    INSERT INTO public.services(tenant_id, name, description, price_from, price, currency, duration_minutes, active, position, deposit_strategy, deposit_value, created_at, updated_at)
    VALUES
      (v_tenantA, 'Depilazione gambe complete 30min', 'Depilazione classica gambe complete con cera calda, 30 minuti circa.', 2500, 2500, 'EUR', 30, true, 0, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Massaggio rilassante corpo 60min', 'Massaggio corpo completo rilassante ad olio essenziale, 60 minuti. Ideale per stress e stanchezza.', 5000, 5000, 'EUR', 60, true, 1, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Pulizia viso professionale 45min', 'Pulizia viso con detersione, scrub, vaporizzazione e maschera idratante finale; 45 minuti.', 4000, 4000, 'EUR', 45, true, 2, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Trattamento anti-eta viso 75min', 'Trattamento anti-eta premium con prodotti professionali, sieri e massaggio lifting; 75 minuti.', 8000, 8000, 'EUR', 75, true, 3, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Manicure classica 30min', 'Manicure classica: limatura, cuticole, smalto classico; 30 minuti.', 2000, 2000, 'EUR', 30, true, 4, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Pedicure estetico 45min', 'Pedicure estetico completo: ammollo, limatura, cuticole, smalto; 45 minuti.', 3000, 3000, 'EUR', 45, true, 5, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Extension ciglia 1D 90min', 'Extension ciglia metodo 1D classico, effetto naturale; 90 minuti.', 7000, 7000, 'EUR', 90, true, 6, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Laminazione sopracciglia 30min', 'Laminazione e tintura sopracciglia con design personalizzato; 30 minuti.', 2500, 2500, 'EUR', 30, true, 7, 'NONE', 0, NOW(), NOW()),
      (v_tenantA, 'Ceretta viso sopracciglia/labbra 15min', 'Ceretta viso mirata per sopracciglia e labbra, rifinitura perfetta; 15 minuti.', 1500, 1500, 'EUR', 15, true, 8, 'NONE', 0, NOW(), NOW());
  END IF;

  -- Weekly availability
  DELETE FROM public.business_availability WHERE tenant_id = v_tenantA;
  INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time) VALUES
    (v_tenantA, 1, true, '09:00', '18:00'),
    (v_tenantA, 2, true, '09:00', '18:00'),
    (v_tenantA, 3, true, '09:00', '18:00'),
    (v_tenantA, 4, true, '09:00', '18:00'),
    (v_tenantA, 5, true, '09:00', '18:00'),
    (v_tenantA, 6, true, '09:00', '13:00'),
    (v_tenantA, 0, false, '00:01', '23:59');

  -- Publish via RPC (3 arg)
  PERFORM public.publish_site_draft(v_tenantA, NULL::uuid, v_admin);

  RAISE NOTICE 'Fixture: admin pw reset; tenant A servizi 9 + availability; publish RPC OK';
END $$;

COMMIT;

-- Report finale
SELECT 'TENANT_PUBLISHED' as step, t.slug, t.status, t.published, t.published_at, bp.display_name
FROM public.tenants t LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
WHERE t.slug = 'slugo_mtu30v76_1fon';

SELECT 'SERVICES_COUNT' as step, count(*)::int as n_services
FROM public.services WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='slugo_mtu30v76_1fon');

SELECT 'SITE_SECTIONS_COUNT' as step, count(*)::int as n_sections, count(*) FILTER (WHERE enabled)::int as n_enabled
FROM public.site_sections WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='slugo_mtu30v76_1fon');
