-- FASE14C - HOTFIX #77 - FINAL audit columns.
-- SCHEMA frozen usa audit_logs: entity_type TEXT + entity_id UUID (non target_type/target_id).
-- actor_kind deve essere 'user' non 'system' quando actor_user_id è valorizzato.

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
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_actor_user_id UUID;
    v_tenant_id UUID := gen_random_uuid();
    v_slug TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_result JSONB;
    v_temp_domain TEXT;
BEGIN
    v_actor_user_id := auth.uid();

    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'VEL01';
    END IF;

    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE = 'VEL02';
    END IF;

    IF p_owner_user_id IS NULL OR NOT EXISTS(
        SELECT 1 FROM auth.users u WHERE u.id = p_owner_user_id
    ) THEN
        RAISE EXCEPTION 'OWNER_IDENTITY_ERROR' USING ERRCODE = 'VEL03';
    END IF;

    v_slug := NULLIF(TRIM(COALESCE(p_slug, '')), '');
    v_temp_domain := v_slug || '.velora.local';

    IF NULLIF(TRIM(COALESCE(p_business_name, '')), '') IS NULL
       OR char_length(p_business_name) < 2 OR char_length(p_business_name) > 120 THEN
        RAISE EXCEPTION 'INVALID_BUSINESS_NAME' USING ERRCODE = 'VEL04';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_category, '')), '') IS NULL
       OR char_length(p_category) > 60 THEN
        RAISE EXCEPTION 'INVALID_CATEGORY' USING ERRCODE = 'VEL05';
    END IF;

    IF char_length(COALESCE(p_city, '')) > 80 THEN
        RAISE EXCEPTION 'INVALID_CITY' USING ERRCODE = 'VEL06';
    END IF;

    IF char_length(COALESCE(p_province, '')) > 8 THEN
        RAISE EXCEPTION 'INVALID_PROVINCE' USING ERRCODE = 'VEL07';
    END IF;

    IF char_length(COALESCE(p_timezone, '')) = 0 OR char_length(p_timezone) > 64 THEN
        RAISE EXCEPTION 'INVALID_TIMEZONE' USING ERRCODE = 'VEL08';
    END IF;

    IF char_length(COALESCE(p_locale, '')) < 2 OR char_length(p_locale) > 8 THEN
        RAISE EXCEPTION 'INVALID_LOCALE' USING ERRCODE = 'VEL09';
    END IF;

    IF p_business_email IS NOT NULL AND NULLIF(TRIM(p_business_email), '') IS NOT NULL
       AND p_business_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'INVALID_BUSINESS_EMAIL' USING ERRCODE = 'VEL10';
    END IF;

    IF NULLIF(TRIM(COALESCE(p_plan_id, '')), '') IS NULL
       OR NOT (p_plan_id IN ('base', 'pro', 'internal_test')) THEN
        RAISE EXCEPTION 'INVALID_PLAN' USING ERRCODE = 'VEL17';
    END IF;

    IF v_slug IS NULL OR char_length(v_slug) < 3 OR char_length(v_slug) > 40
       OR v_slug !~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$' THEN
        RAISE EXCEPTION 'INVALID_SLUG' USING ERRCODE = 'VEL11';
    END IF;

    IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.slug = v_slug) THEN
        RAISE EXCEPTION 'SLUG_ALREADY_EXISTS' USING ERRCODE = 'VEL12';
    END IF;

    IF EXISTS(
        SELECT 1 FROM public.platform_provisioning_requests r
        WHERE r.actor_user_id = v_actor_user_id
          AND r.slug = v_slug
          AND r.owner_user_id = p_owner_user_id
          AND r.plan_id = p_plan_id
          AND r.created_at > (v_now - INTERVAL '10 minutes')
          AND (r.result_snapshot->>'ok')::boolean = true
          AND r.result_snapshot->'data'->>'tenant_slug' = v_slug
    ) THEN
        RAISE EXCEPTION 'PROVISIONING_CONFLICT' USING ERRCODE = 'VEL18';
    END IF;

    -- 1. Tenants insert
    INSERT INTO public.tenants (
        id, name, slug, status, plan_id, temporary_domain, published,
        created_at, updated_at
    ) VALUES (
        v_tenant_id, TRIM(p_business_name), v_slug, 'active', p_plan_id,
        v_temp_domain, false, v_now, v_now
    );

    -- 2. OWNER membership
    IF NOT EXISTS(
        SELECT 1 FROM public.tenant_memberships m
        WHERE m.tenant_id = v_tenant_id AND m.user_id = p_owner_user_id
    ) THEN
        INSERT INTO public.tenant_memberships (
            id, tenant_id, user_id, role, status, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), v_tenant_id, p_owner_user_id, 'owner', 'active',
            v_now, v_now
        );
    END IF;

    -- 3. Business profile
    UPDATE public.business_profiles bp
       SET display_name  = TRIM(p_business_name),
           legal_name    = TRIM(p_business_name),
           category      = TRIM(COALESCE(p_category, 'service_business')),
           phone         = NULLIF(TRIM(p_phone), ''),
           email         = NULLIF(TRIM(p_business_email), ''),
           city          = TRIM(COALESCE(p_city, 'Non specificata')),
           province      = TRIM(COALESCE(p_province, '--')),
           timezone      = TRIM(COALESCE(p_timezone, 'Europe/Rome')),
           locale        = TRIM(COALESCE(p_locale, 'it-IT')),
           updated_at    = v_now
     WHERE bp.tenant_id = v_tenant_id;

    -- 4. Audit 3 eventi (COLONNE CORRETTE: entity_type / entity_id / actor_kind='user')
    INSERT INTO public.audit_logs (
        id, tenant_id, actor_user_id, action, entity_type, entity_id,
        metadata, created_at, actor_kind
    ) VALUES (
        gen_random_uuid(), v_tenant_id, v_actor_user_id,
        'platform_customer_created', 'tenant', v_tenant_id,
        jsonb_build_object(
            'slug', v_slug, 'name', TRIM(p_business_name),
            'temporary_domain', v_temp_domain,
            'category', TRIM(COALESCE(p_category, 'service_business')),
            'city', TRIM(COALESCE(p_city, 'Non specificata')),
            'province', TRIM(COALESCE(p_province, '--')),
            'plan_id', p_plan_id,
            'timezone', TRIM(COALESCE(p_timezone, 'Europe/Rome')),
            'locale', TRIM(COALESCE(p_locale, 'it-IT')),
            'actor_user_id', v_actor_user_id
        ),
        v_now, 'user'
    );

    INSERT INTO public.audit_logs (
        id, tenant_id, actor_user_id, action, entity_type, entity_id,
        metadata, created_at, actor_kind
    ) VALUES (
        gen_random_uuid(), v_tenant_id, v_actor_user_id,
        'platform_owner_linked', 'membership', v_tenant_id,
        jsonb_build_object('owner_user_id', p_owner_user_id, 'role', 'owner'),
        v_now, 'user'
    );

    INSERT INTO public.audit_logs (
        id, tenant_id, actor_user_id, action, entity_type, entity_id,
        metadata, created_at, actor_kind
    ) VALUES (
        gen_random_uuid(), v_tenant_id, v_actor_user_id,
        'platform_plan_assigned', 'tenant', v_tenant_id,
        jsonb_build_object('new_plan_id', p_plan_id, 'prev_plan_id', NULL),
        v_now, 'user'
    );

    -- 5. Idempotency marker
    INSERT INTO public.platform_provisioning_requests (
        idempotency_key, actor_user_id, owner_user_id, tenant_id, slug, plan_id,
        result_snapshot, created_at
    ) VALUES (
        'auto-' || v_tenant_id::text, v_actor_user_id, p_owner_user_id, v_tenant_id,
        v_slug, p_plan_id,
        jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object(
                'tenant_id', v_tenant_id, 'tenant_slug', v_slug,
                'owner_user_id', p_owner_user_id, 'plan_id', p_plan_id,
                'role', 'owner', 'created_at', v_now
            )
        ),
        v_now
    );

    v_result := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'tenant_id', v_tenant_id, 'tenant_slug', v_slug,
            'owner_user_id', p_owner_user_id, 'plan_id', p_plan_id,
            'role', 'owner', 'created_at', v_now
        )
    );
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    DECLARE
        v_sqlstate TEXT := SQLSTATE;
        v_msg      TEXT := SQLERRM;
        v_code     TEXT := CASE LOWER(v_sqlstate)
            WHEN 'vel01' THEN 'AUTH_REQUIRED'
            WHEN 'vel02' THEN 'PLATFORM_ADMIN_REQUIRED'
            WHEN 'vel03' THEN 'OWNER_IDENTITY_ERROR'
            WHEN 'vel04' THEN 'INVALID_BUSINESS_NAME'
            WHEN 'vel05' THEN 'INVALID_CATEGORY'
            WHEN 'vel06' THEN 'INVALID_CITY'
            WHEN 'vel07' THEN 'INVALID_PROVINCE'
            WHEN 'vel08' THEN 'INVALID_TIMEZONE'
            WHEN 'vel09' THEN 'INVALID_LOCALE'
            WHEN 'vel10' THEN 'INVALID_BUSINESS_EMAIL'
            WHEN 'vel11' THEN 'INVALID_SLUG'
            WHEN 'vel12' THEN 'SLUG_ALREADY_EXISTS'
            WHEN 'vel17' THEN 'INVALID_PLAN'
            WHEN 'vel18' THEN 'PROVISIONING_CONFLICT'
            ELSE v_msg
        END;
        v_payload JSONB := jsonb_build_object('sqlstate', v_sqlstate, 'message', v_msg);
    BEGIN
        BEGIN
            INSERT INTO public.audit_logs (
                id, tenant_id, actor_user_id, action, entity_type, entity_id,
                metadata, created_at, actor_kind
            ) VALUES (
                gen_random_uuid(),
                v_tenant_id,
                COALESCE(v_actor_user_id, '00000000-0000-0000-0000-000000000000'),
                'platform_provision_failed', 'tenant',
                COALESCE(v_tenant_id, '00000000-0000-0000-0000-000000000000'),
                jsonb_build_object('code', v_code, 'payload', v_payload),
                clock_timestamp(),
                CASE WHEN v_actor_user_id IS NOT NULL THEN 'user' ELSE 'system' END
            );
        EXCEPTION WHEN OTHERS THEN NULL; END;
        RAISE EXCEPTION '%', v_code USING ERRCODE = 'VEL99';
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_provision_customer(text, text, uuid, text, text, text, text, text, text, text, text) TO service_role;
