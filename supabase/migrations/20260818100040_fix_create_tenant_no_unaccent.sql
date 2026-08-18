-- ====================================================================
-- FASE 2 — FIX RPC create_tenant_with_owner: NO unaccent()
--
-- Motivo:
--   Estensione "unaccent" non è garantita abilitata in ogni ambiente.
--   Evitiamo dipendenze non essenziali; rimozione caratteri extra
--   ASCII-safe.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_business_name  TEXT,
  p_category       TEXT,
  p_city           TEXT,
  p_province       TEXT,
  p_phone          TEXT DEFAULT NULL,
  p_business_email TEXT DEFAULT NULL,
  p_timezone       TEXT DEFAULT 'Europe/Rome',
  p_locale         TEXT DEFAULT 'it-IT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid              UUID;
  v_tenant_id        UUID;
  v_slug             TEXT;
  v_existing         JSONB;
  v_business_name    TEXT;
  v_category         TEXT;
  v_city             TEXT;
  v_province         TEXT;
  v_phone            TEXT;
  v_business_email   TEXT;
  v_timezone         TEXT;
  v_locale           TEXT;
  v_base             TEXT;
  v_counter          INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  v_business_name  := NULLIF(BTRIM(p_business_name), '');
  v_category       := NULLIF(BTRIM(p_category), '');
  v_city           := NULLIF(BTRIM(p_city), '');
  v_province       := NULLIF(UPPER(BTRIM(p_province)), '');
  v_phone          := NULLIF(BTRIM(COALESCE(p_phone, '')), '');
  v_business_email := NULLIF(BTRIM(COALESCE(p_business_email, '')), '');
  v_timezone       := COALESCE(NULLIF(BTRIM(p_timezone), ''), 'Europe/Rome');
  v_locale         := COALESCE(NULLIF(BTRIM(p_locale), ''), 'it-IT');

  IF v_business_name IS NULL OR char_length(v_business_name) < 2 THEN
    RAISE EXCEPTION 'business_name_invalid';
  END IF;
  IF v_category IS NULL OR char_length(v_category) < 2 THEN
    RAISE EXCEPTION 'category_invalid';
  END IF;
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'city_invalid';
  END IF;
  IF v_province IS NULL OR char_length(v_province) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'province_invalid';
  END IF;
  IF char_length(v_timezone) > 64 THEN
    RAISE EXCEPTION 'timezone_invalid';
  END IF;
  IF char_length(v_locale) NOT BETWEEN 2 AND 10 THEN
    RAISE EXCEPTION 'locale_invalid';
  END IF;
  IF v_business_email IS NOT NULL AND v_business_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'business_email_invalid';
  END IF;

  SELECT to_jsonb(t) INTO v_existing FROM (
    SELECT
      t.id              AS tenant_id,
      t.name            AS tenant_name,
      t.slug            AS tenant_slug,
      t.status          AS tenant_status,
      m.id              AS membership_id,
      m.role            AS membership_role,
      m.status          AS membership_status,
      bp.tenant_id      AS business_profile_id,
      bp.category       AS category,
      bp.city           AS city,
      bp.province       AS province,
      bp.phone          AS phone,
      bp.email          AS business_email,
      bp.timezone       AS timezone,
      bp.locale         AS locale,
      TRUE              AS is_existing
    FROM public.tenant_memberships m
    JOIN public.tenants t ON t.id = m.tenant_id
    JOIN public.business_profiles bp ON bp.tenant_id = t.id
    WHERE m.user_id = v_uid
      AND m.role = 'owner'
      AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1
  ) t;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_base := lower(v_business_name);
  -- ASCII-safe slug replacement: maps every non alphanumeric sequence to dash
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '^-+|-+$', '');
  v_base := substring(v_base FROM 1 FOR 40);
  IF v_base = '' OR v_base IS NULL THEN v_base := 'attivita'; END IF;

  v_slug    := v_base;
  v_counter := 1;

  <<slug_loop>>
  LOOP
    BEGIN
      v_tenant_id := gen_random_uuid();
      INSERT INTO public.tenants(id, name, slug, status)
      VALUES (v_tenant_id, v_business_name, v_slug, 'onboarding');
      EXIT slug_loop;
    EXCEPTION WHEN unique_violation THEN
      v_counter := v_counter + 1;
      v_slug    := substring(v_base FROM 1 FOR 40) || '-' || v_counter;
      IF v_counter > 1000 THEN
        RAISE EXCEPTION 'slug_conflict_too_many_retries';
      END IF;
    END;
  END LOOP slug_loop;

  INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
  VALUES (gen_random_uuid(), v_tenant_id, v_uid, 'owner', 'active');

  INSERT INTO public.business_profiles(
    tenant_id, display_name, description, category, city, province,
    address_line1, phone, website_url, email, timezone, locale
  )
  VALUES (
    v_tenant_id, v_business_name, '', v_category, v_city, v_province,
    '', v_phone, '', v_business_email, v_timezone, v_locale
  );

  BEGIN
    INSERT INTO public.audit_logs(id, action, actor_user_id, tenant_id, entity_type, entity_id, metadata, created_at)
    VALUES (
      gen_random_uuid(),
      'tenant_created',
      v_uid,
      v_tenant_id,
      'tenant',
      v_tenant_id,
      jsonb_build_object('slug', v_slug, 'source', 'onboarding_rpc'),
      NOW()
    );
    INSERT INTO public.audit_logs(id, action, actor_user_id, tenant_id, entity_type, entity_id, metadata, created_at)
    VALUES (
      gen_random_uuid(),
      'onboarding_completed',
      v_uid,
      v_tenant_id,
      'user',
      v_uid,
      jsonb_build_object(
        'category', v_category,
        'city', v_city,
        'province', v_province,
        'timezone', v_timezone,
        'locale', v_locale
      ),
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(jsonb_build_object(
    'tenant_id', v_tenant_id,
    'tenant_name', v_business_name,
    'tenant_slug', v_slug,
    'tenant_status', 'onboarding',
    'membership_role', 'owner',
    'membership_status', 'active',
    'business_profile_id', v_tenant_id,
    'category', v_category,
    'city', v_city,
    'province', v_province,
    'phone', v_phone,
    'business_email', v_business_email,
    'timezone', v_timezone,
    'locale', v_locale,
    'is_existing', FALSE
  ));
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_with_owner FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner TO authenticated;
