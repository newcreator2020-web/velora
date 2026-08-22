-- ============================================================================
-- FASE 12B — Default Resource Provisioning (Hybrid)
--
-- 1. BACKFILL: per OGNI tenant esistente SENZA risorse, crea ESATTAMENTE 1
--    default resource idempotente (se EXISTS → 0 righe).
-- 2. ESTENDI RPC create_tenant_with_owner: inserisci default resource
--    contestualmente a onboarding. Preserva firma, return shape,
--    SECURITY DEFINER, search_path, grants, ownership, error behavior.
-- 3. La default resource è implicitamente "ALL SERVICES" in M2M vuoto.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BACKFILL idempotente default resources per tenant esistenti.
--    DO block: per ogni tenant senza staff_resources → INSERT 1 riga.
--    Nome: business_profiles.display_name se disponibile (non vuoto),
--    fallback 'Principale'.
--    Slug: sempre 'principale' (deterministico; UNIQUE(tenant_id,slug) = unique).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_display TEXT;
  v_slug    TEXT;
BEGIN
  v_slug := 'principale';
  FOR r IN
    SELECT t.id AS tenant_id,
           COALESCE(NULLIF(BTRIM(bp.display_name), ''), 'Principale') AS pref_name
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_resources sr WHERE sr.tenant_id = t.id
    )
    ORDER BY t.created_at ASC
  LOOP
    INSERT INTO public.staff_resources(
      tenant_id, display_name, slug, active, bookable, sort_order, color_hex
    ) VALUES (
      r.tenant_id,
      SUBSTRING(BTRIM(r.pref_name) FROM 1 FOR 80),
      v_slug,
      TRUE,
      TRUE,
      0,
      NULL
    )
    ON CONFLICT (tenant_id, slug) DO NOTHING;
  END LOOP;
END $$;

-- Verifica strutturale: 0 righe se backfill eseguito due volte.
-- Riapplicazione idempotente: INSERT 0.

-- ----------------------------------------------------------------------------
-- 2. CREATE OR REPLACE create_tenant_with_owner:
--    Aggiunge default resource insert dopo business profile + audit;
--    MANTIENE TUTTO IL RESTO identico.
--    Firma, return JSONB shape, SEC DEFINER, search_path = invariati.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_business_name TEXT,
  p_category      TEXT,
  p_city          TEXT,
  p_province      TEXT,
  p_phone         TEXT DEFAULT NULL,
  p_business_email TEXT DEFAULT NULL,
  p_timezone      TEXT DEFAULT 'Europe/Rome',
  p_locale        TEXT DEFAULT 'it-IT'
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
  v_bp_id            UUID;
  v_membership_id    UUID;
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
  -- ------------------------------------------------------------------
  -- 1. Identità utente presa SOLAMENTE da auth.uid() — MAI da parametro.
  -- ------------------------------------------------------------------
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- ------------------------------------------------------------------
  -- 2. Sanitizzazione e validazione input (non ci fidiamo del client).
  -- ------------------------------------------------------------------
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

  -- ------------------------------------------------------------------
  -- 3. Idempotenza double-submit / retry: se auth.uid() ha GIÀ una
  --    membership owner ATTIVA → return esistente (0 duplicati creati).
  -- ------------------------------------------------------------------
  SELECT to_jsonb(t) INTO v_existing FROM (
    SELECT
      t.id           AS tenant_id,
      t.name         AS tenant_name,
      t.slug         AS tenant_slug,
      t.status       AS tenant_status,
      m.id           AS membership_id,
      m.role         AS membership_role,
      m.status       AS membership_status,
      bp.tenant_id   AS business_profile_id,
      bp.category    AS category,
      bp.city        AS city,
      bp.province    AS province,
      bp.phone       AS phone,
      bp.email       AS business_email,
      bp.timezone    AS timezone,
      bp.locale      AS locale,
      TRUE           AS is_existing
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

  -- ------------------------------------------------------------------
  -- 4. Slug normalization — tentativo locale. UNIQUE DB = autorità.
  -- ------------------------------------------------------------------
  v_base := regexp_replace(
              lower(v_business_name),
              '[^a-z0-9]+', '-', 'g');
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

  -- ------------------------------------------------------------------
  -- 5. Membership OWNER — salviamo v_membership_id per linkare default resource.
  -- ------------------------------------------------------------------
  v_membership_id := gen_random_uuid();
  INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
  VALUES (v_membership_id, v_tenant_id, v_uid, 'owner', 'active');

  -- ------------------------------------------------------------------
  -- 6. Business profile — FK(tenant_id) constraint garantisce coerenza.
  -- ------------------------------------------------------------------
  v_bp_id := v_tenant_id;
  INSERT INTO public.business_profiles(
    tenant_id, display_name, description, category, city, province,
    address_line1, phone, website_url, email, timezone, locale
  )
  VALUES (
    v_tenant_id, v_business_name, '', v_category, v_city, v_province,
    '', v_phone, '', v_business_email, v_timezone, v_locale
  );

  -- ------------------------------------------------------------------
  -- 12B.1 DEFAULT RESOURCE — inserita contestualmente all'onboarding.
  --       linked_membership_id = owner stesso (v_membership_id).
  -- ------------------------------------------------------------------
  INSERT INTO public.staff_resources(
    tenant_id, display_name, slug, active, bookable, sort_order, color_hex,
    linked_membership_id
  ) VALUES (
    v_tenant_id,
    SUBSTRING(v_business_name FROM 1 FOR 80),
    'principale',
    TRUE,
    TRUE,
    0,
    NULL,
    v_membership_id
  )
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  -- ------------------------------------------------------------------
  -- 7. Audit log — eventi importanti; nessun secret.
  -- ------------------------------------------------------------------
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
        'business_profile_id', v_bp_id,
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

  -- ------------------------------------------------------------------
  -- 8. Return coerente con v_existing — stesso shape.
  -- ------------------------------------------------------------------
  RETURN to_jsonb(
    jsonb_build_object(
      'tenant_id', v_tenant_id,
      'tenant_name', v_business_name,
      'tenant_slug', v_slug,
      'tenant_status', 'onboarding',
      'membership_id', v_membership_id,
      'membership_role', 'owner',
      'membership_status', 'active',
      'business_profile_id', v_bp_id,
      'category', v_category,
      'city', v_city,
      'province', v_province,
      'phone', v_phone,
      'business_email', v_business_email,
      'timezone', v_timezone,
      'locale', v_locale,
      'is_existing', FALSE
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Preservazione grants & ownership espliciti (replichiamo regole originali
--    dopo CREATE OR REPLACE che resetta implicitamente alcuni attributi).
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.create_tenant_with_owner(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
