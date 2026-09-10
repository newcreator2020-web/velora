\set ON_ERROR_STOP 1
DO $$
DECLARE
  v_tenant UUID;
  v_owner_email TEXT := 'tonino-owner@velora.test';
  v_owner_pw TEXT := 'VeloraTest12345!';
  v_uid UUID;
  v_display TEXT := 'Proprietario Tonino';
  v_existing UUID;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug='slugo-mtu30v76-1fon';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant tonino not found'; END IF;

  -- 1) Upsert auth.user (email_confirmed_at = now()) — colonne esatte pattern progetto
  SELECT id INTO v_existing FROM auth.users WHERE email = v_owner_email;
  IF v_existing IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, raw_user_meta_data, aud, is_super_admin, created_at, updated_at)
    VALUES (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      v_owner_email,
      crypt(v_owner_pw, gen_salt('bf')),
      NOW(),
      'authenticated',
      '{}',
      'authenticated',
      FALSE,
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Creato auth.user nuovo id=%', v_uid;
  ELSE
    v_uid := v_existing;
    UPDATE auth.users SET
      encrypted_password = crypt(v_owner_pw, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      deleted_at = NULL,
      updated_at = NOW()
    WHERE id = v_uid;
    RAISE NOTICE 'Aggiornato auth.user esistente id=%', v_uid;
  END IF;

  -- 2) Upsert profiles row (display_name)
  INSERT INTO public.profiles (id, display_name, avatar_url, created_at, updated_at)
  VALUES (v_uid, v_display, NULL, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET display_name = v_display, updated_at = NOW();

  -- 3) Upsert identity (auth.identities per poter login via email provider)
  -- NOTA: colonna email è GENERATED ALWAYS — NON specificare in INSERT
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_owner_email, 'email_verified', true), 'email', NOW(), NOW(), NOW())
  ON CONFLICT (provider, provider_id) DO UPDATE SET
    identity_data = jsonb_build_object('sub', v_uid::text, 'email', v_owner_email, 'email_verified', true),
    updated_at = NOW(),
    last_sign_in_at = NOW();

  -- 4) ASSICURA: membership OWNER Tonino di questo account SOLAMENTE
  --    (NON aggiungere membership Studio Prime!)
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status)
  VALUES (v_tenant, v_uid, 'owner', 'active')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = NOW();

  -- 5) RIMUOVI membership di altri tenant (se presenti su questo account) per garantire SINGOLO TENANT
  DELETE FROM public.tenant_memberships
  WHERE user_id = v_uid AND tenant_id <> v_tenant;

  -- 6) REPORT
  RAISE NOTICE '===== TONINO OWNER =====';
  RAISE NOTICE 'email=% / password=%', v_owner_email, v_owner_pw;
  RAISE NOTICE 'user_id=%', v_uid;
  RAISE NOTICE 'tenant_id=% slug=slugo-mtu30v76-1fon', v_tenant;
  RAISE NOTICE 'memberships count per questo utente (deve essere 1)=%',
    (SELECT count(*) FROM public.tenant_memberships WHERE user_id = v_uid);
END $$;
COMMIT;
SELECT
  'TONINO_OWNER_SETUP' as step,
  (SELECT count(*) FROM public.tenant_memberships tm
   JOIN auth.users u ON u.id=tm.user_id
   WHERE u.email='tonino-owner@velora.test' AND tm.role='owner') AS membership_owner_ok,
  (SELECT count(*) FROM auth.users WHERE email='tonino-owner@velora.test' AND deleted_at IS NULL) AS auth_user_ok,
  (SELECT t.slug FROM public.tenants t
   JOIN public.tenant_memberships tm ON tm.tenant_id=t.id
   JOIN auth.users u ON u.id=tm.user_id
   WHERE u.email='tonino-owner@velora.test'
   LIMIT 1) AS solo_tenant_slug;
