-- Fase14c: Fix operatore validazione plan_id in platform_provision_customer
--
-- Il codice precedente usava:
--   IF v_plan_id IS NULL OR v_plan_id <> ANY(v_valid_plans) THEN ...
--
-- In PostgreSQL "x <> ANY(arr)" restituisce TRUE quando x è diverso da ALMENO UN
-- elemento dell'array. Per array di cardinality >= 2 e x presente nell'array, questa condizione
-- è SEMPRE VERA (perché x è diverso dagli altri), causando VEL17 / INVALID_PLAN
-- anche per piani validi.
--
-- La condizione semanticamente corretta è "x <> ALL(arr)" oppure "NOT (x = ANY(arr))",
-- che restituisce TRUE solo se x NON è presente in nessun elemento.

CREATE OR REPLACE FUNCTION public.platform_provision_customer(
  p_slug text,
  p_business_name text,
  p_owner_user_id uuid,
  p_plan_id text DEFAULT 'base'::text,
  p_category text DEFAULT 'service_business'::text,
  p_city text DEFAULT 'Non specificata'::text,
  p_province text DEFAULT '--'::text,
  p_phone text DEFAULT NULL::text,
  p_business_email text DEFAULT NULL::text,
  p_timezone text DEFAULT 'Europe/Rome'::text,
  p_locale text DEFAULT 'it-IT'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id       UUID;
  v_slug            TEXT;
  v_base            TEXT;
  v_counter         INT;
  v_business_name   TEXT;
  v_category        TEXT;
  v_city            TEXT;
  v_province        TEXT;
  v_phone           TEXT;
  v_business_email  TEXT;
  v_timezone        TEXT;
  v_locale          TEXT;
  v_plan_id         TEXT;
  v_valid_plans     CONSTANT TEXT[] := ARRAY['base','pro','internal_test'];
  v_actor           UUID;
  v_now             TIMESTAMPTZ;
BEGIN
  v_actor := auth.uid();
  v_now   := NOW();

  IF v_actor IS NULL THEN
    RAISE EXCEPTION SQLSTATE 'VEL01' USING MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION SQLSTATE 'VEL02' USING MESSAGE = 'PLATFORM_ADMIN_REQUIRED';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION SQLSTATE 'VEL03' USING MESSAGE = 'OWNER_IDENTITY_ERROR';
  END IF;

  v_business_name  := NULLIF(BTRIM(p_business_name), '');
  v_category       := NULLIF(BTRIM(COALESCE(p_category, '')), '');
  v_city           := NULLIF(BTRIM(COALESCE(p_city, '')), '');
  v_province       := NULLIF(UPPER(BTRIM(COALESCE(p_province, ''))), '');
  v_phone          := NULLIF(BTRIM(COALESCE(p_phone, '')), '');
  v_business_email := NULLIF(BTRIM(COALESCE(p_business_email, '')), '');
  v_timezone       := COALESCE(NULLIF(BTRIM(COALESCE(p_timezone, '')), ''), 'Europe/Rome');
  v_locale         := COALESCE(NULLIF(BTRIM(COALESCE(p_locale, '')), ''), 'it-IT');
  v_plan_id        := NULLIF(BTRIM(COALESCE(p_plan_id, '')), '');

  IF v_business_name IS NULL OR char_length(v_business_name) < 2 OR char_length(v_business_name) > 120 THEN
    RAISE EXCEPTION SQLSTATE 'VEL10' USING MESSAGE = 'INVALID_BUSINESS_NAME';
  END IF;
  IF v_category IS NULL OR char_length(v_category) < 2 OR char_length(v_category) > 64 THEN
    RAISE EXCEPTION SQLSTATE 'VEL11' USING MESSAGE = 'INVALID_CATEGORY';
  END IF;
  IF v_city IS NULL OR char_length(v_city) > 80 THEN
    RAISE EXCEPTION SQLSTATE 'VEL12' USING MESSAGE = 'INVALID_CITY';
  END IF;
  IF v_province IS NULL OR char_length(v_province) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION SQLSTATE 'VEL13' USING MESSAGE = 'INVALID_PROVINCE';
  END IF;
  IF char_length(v_timezone) > 64 THEN
    RAISE EXCEPTION SQLSTATE 'VEL14' USING MESSAGE = 'INVALID_TIMEZONE';
  END IF;
  IF char_length(v_locale) NOT BETWEEN 2 AND 10 THEN
    RAISE EXCEPTION SQLSTATE 'VEL15' USING MESSAGE = 'INVALID_LOCALE';
  END IF;
  IF v_business_email IS NOT NULL AND v_business_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION SQLSTATE 'VEL16' USING MESSAGE = 'INVALID_BUSINESS_EMAIL';
  END IF;
  -- FIX: usare <> ALL oppure NOT = ANY. Qualsiasi piano NON presente nella lista => errore.
  IF v_plan_id IS NULL OR NOT (v_plan_id = ANY(v_valid_plans)) THEN
    RAISE EXCEPTION SQLSTATE 'VEL17' USING MESSAGE = 'INVALID_PLAN';
  END IF;

  v_slug := NULLIF(BTRIM(COALESCE(p_slug, '')), '');
  IF v_slug IS NULL THEN
    v_base := lower(v_business_name);
    v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
    v_base := regexp_replace(v_base, '^-+|-+$', '');
    v_base := substring(v_base FROM 1 FOR 40);
    IF v_base = '' OR v_base IS NULL THEN v_base := 'attivita'; END IF;
    v_slug := v_base;
  ELSE
    v_slug := lower(v_slug);
    v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '^-+|-+$', '');
    v_slug := substring(v_slug FROM 1 FOR 40);
    IF v_slug = '' OR v_slug IS NULL THEN
      RAISE EXCEPTION SQLSTATE 'VEL18' USING MESSAGE = 'INVALID_SLUG';
    END IF;
    v_base := v_slug;
  END IF;
  IF char_length(v_slug) < 3 THEN
    RAISE EXCEPTION SQLSTATE 'VEL18' USING MESSAGE = 'INVALID_SLUG';
  END IF;

  v_counter := 0;
  <<slug_loop>>
  LOOP
    BEGIN
      v_tenant_id := gen_random_uuid();
      INSERT INTO public.tenants(id, name, slug, status, plan_id, created_at, updated_at)
      VALUES (v_tenant_id, v_business_name, v_slug, 'active', v_plan_id, v_now, v_now);
      EXIT slug_loop;
    EXCEPTION WHEN unique_violation THEN
      v_counter := v_counter + 1;
      IF p_slug IS NOT NULL AND NULLIF(BTRIM(p_slug), '') IS NOT NULL THEN
        RAISE EXCEPTION SQLSTATE 'VEL19' USING MESSAGE = 'SLUG_ALREADY_EXISTS';
      END IF;
      v_slug := substring(v_base FROM 1 FOR 35) || '-' || v_counter;
      IF v_counter > 100 THEN
        RAISE EXCEPTION SQLSTATE 'VEL19' USING MESSAGE = 'SLUG_ALREADY_EXISTS';
      END IF;
    END;
  END LOOP slug_loop;

  INSERT INTO public.business_profiles(
    tenant_id, display_name, description, category, city, province,
    address_line1, phone, website_url, email, timezone, locale, created_at, updated_at
  ) VALUES (
    v_tenant_id, v_business_name, '', v_category, v_city, v_province,
    '', v_phone, '', v_business_email, v_timezone, v_locale, v_now, v_now
  );

  BEGIN
    INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, p_owner_user_id, 'owner', 'active', v_now, v_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION SQLSTATE 'VEL20' USING MESSAGE = 'PROVISIONING_CONFLICT';
  END;

  DECLARE
    v_meta_tenant JSONB; v_meta_owner JSONB; v_meta_plan JSONB;
  BEGIN
    v_meta_tenant := jsonb_build_object(
      'slug', v_slug, 'plan_id', v_plan_id, 'source', 'platform_admin_provision',
      'category', v_category, 'timezone', v_timezone, 'locale', v_locale
    );
    v_meta_owner  := jsonb_build_object(
      'role', 'owner', 'status', 'active',
      'owner_user_id_prefix', left(p_owner_user_id::text, 8)
    );
    v_meta_plan   := jsonb_build_object(
      'new_plan', v_plan_id, 'reason', 'initial_platform_assignment'
    );
    INSERT INTO public.audit_logs(id, action, actor_user_id, tenant_id, entity_type, entity_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'platform_customer_created', v_actor, v_tenant_id, 'tenant', v_tenant_id, v_meta_tenant, v_now);
    INSERT INTO public.audit_logs(id, action, actor_user_id, tenant_id, entity_type, entity_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'platform_owner_linked', v_actor, v_tenant_id, 'membership', p_owner_user_id, v_meta_owner, v_now);
    INSERT INTO public.audit_logs(id, action, actor_user_id, tenant_id, entity_type, entity_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'platform_plan_assigned', v_actor, v_tenant_id, 'tenant', v_tenant_id, v_meta_plan, v_now);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN to_jsonb(jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant_id,
    'tenant_name', v_business_name,
    'slug', v_slug,
    'status', 'active',
    'plan_id', v_plan_id,
    'owner_user_id', p_owner_user_id,
    'membership_role', 'owner',
    'membership_status', 'active',
    'timezone', v_timezone,
    'locale', v_locale,
    'created_at', v_now
  ));
END;
$function$;
