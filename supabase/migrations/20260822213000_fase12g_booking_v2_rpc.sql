-- ============================================================================
-- FASE 12G — Public Booking V2 Resource-Aware
--
-- Firma NUOVA p_resource_slug. Backward compat: default = 'any' → server ANY
-- deterministic selection (sort_order ASC, id ASC tiebreak).
--
-- Autorità server:
--   · tenant_id      ← slug
--   · service_id     ← validated belongs tenant + active
--   · duration       ← services.duration_minutes (M2M override NON attivo in FASE12)
--   · ends_at        ← starts_at + duration
--   · status         ← 'confirmed' (anon non sceglie)
--   · resource_id    ← server resolve ANY oppure server validated SELECTED
--
-- Return includes resource_slug / resource_display_name PII-free.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.public_booking_create_v2(
  p_slug TEXT,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_customer_name TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_resource_slug TEXT DEFAULT 'any'
) RETURNS TABLE (
  booking_id UUID,
  booking_status TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  resource_slug TEXT,
  resource_display_name TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_tenant_published BOOLEAN;
  v_timezone TEXT;
  v_duration INT;
  v_service_active BOOLEAN;
  v_service_tenant_id UUID;
  v_ends_at TIMESTAMPTZ;
  v_min_future TIMESTAMPTZ;
  v_local_day SMALLINT;
  v_local_start TIME;
  v_ba_start TIME;
  v_ba_end TIME;
  v_ba_enabled BOOLEAN;
  v_booking_id UUID;
  v_status TEXT;
  v_resource_id UUID;
  v_resource_slug_out TEXT;
  v_resource_display TEXT;
  v_booking_range TSTZRANGE;
BEGIN
  -- 1. slug strict allowlist
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9\-]{2,58}[a-z0-9]$' THEN
    RAISE EXCEPTION 'BOOKING_V2: slug invalid' USING errcode = 'VF400';
  END IF;

  SELECT t.id, t.published, COALESCE(bp.timezone, 'UTC')
    INTO v_tenant_id, v_tenant_published, v_timezone
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
   WHERE t.slug = p_slug
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_V2: tenant not found' USING errcode = 'VF404';
  END IF;
  IF v_tenant_published IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_V2: tenant not published' USING errcode = 'VF403';
  END IF;
  IF v_timezone IS NULL OR char_length(v_timezone) > 64 OR v_timezone ~ '[^A-Za-z0-9_/+\-]' THEN
    RAISE EXCEPTION 'BOOKING_V2: tenant timezone invalid' USING errcode = 'VF500';
  END IF;

  -- 2. service validate
  SELECT s.tenant_id, s.active, s.duration_minutes
    INTO v_service_tenant_id, v_service_active, v_duration
    FROM public.services s
   WHERE s.id = p_service_id
   LIMIT 1;

  IF v_service_tenant_id IS NULL OR v_service_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'BOOKING_V2: service not found for tenant' USING errcode = 'VF404';
  END IF;
  IF v_service_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_V2: service inactive' USING errcode = 'VF403';
  END IF;
  IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 480 THEN
    RAISE EXCEPTION 'BOOKING_V2: duration invalid' USING errcode = 'VF400';
  END IF;

  -- 3. ends_at server-side
  v_ends_at := p_starts_at + (v_duration::text || ' minutes')::INTERVAL;

  -- 4. start future min 1 min
  v_min_future := NOW() + INTERVAL '1 minute';
  IF p_starts_at IS NULL OR p_starts_at < v_min_future THEN
    RAISE EXCEPTION 'BOOKING_V2: starts_at too early' USING errcode = 'VF400';
  END IF;
  IF p_starts_at > NOW() + INTERVAL '12 months' THEN
    RAISE EXCEPTION 'BOOKING_V2: starts_at too far' USING errcode = 'VF400';
  END IF;

  -- 5. business hours
  v_local_start := (p_starts_at AT TIME ZONE v_timezone)::time;
  SELECT EXTRACT(ISODOW FROM (p_starts_at AT TIME ZONE v_timezone))::smallint INTO STRICT v_local_day;
  IF v_local_day = 7 THEN v_local_day := 0; END IF;

  SELECT enabled, start_time, end_time
    INTO v_ba_enabled, v_ba_start, v_ba_end
    FROM public.business_availability ba
   WHERE ba.tenant_id = v_tenant_id AND ba.weekday = v_local_day
   LIMIT 1;

  IF NOT FOUND OR v_ba_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_V2: business closed' USING errcode = 'VF422';
  END IF;

  IF v_local_start < v_ba_start
     OR v_local_start > v_ba_end - (v_duration::text || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'BOOKING_V2: outside business hours' USING errcode = 'VF422';
  END IF;

  -- 6. customer PII validate
  IF p_customer_name IS NULL OR char_length(p_customer_name) < 1 OR char_length(p_customer_name) > 120 THEN
    RAISE EXCEPTION 'BOOKING_V2: customer_name invalid' USING errcode = 'VF400';
  END IF;
  IF p_customer_email IS NOT NULL THEN
    IF char_length(p_customer_email) < 3 OR char_length(p_customer_email) > 254
       OR p_customer_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
      RAISE EXCEPTION 'BOOKING_V2: email invalid' USING errcode = 'VF400';
    END IF;
  END IF;
  IF p_customer_phone IS NOT NULL THEN
    IF char_length(p_customer_phone) < 4 OR char_length(p_customer_phone) > 32
       OR p_customer_phone !~ '^[0-9+\-\s()]{4,32}$' THEN
      RAISE EXCEPTION 'BOOKING_V2: phone invalid' USING errcode = 'VF400';
    END IF;
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 500 THEN
    RAISE EXCEPTION 'BOOKING_V2: notes too long' USING errcode = 'VF400';
  END IF;
  IF COALESCE(char_length(p_customer_email),0) = 0 AND COALESCE(char_length(p_customer_phone),0) = 0 THEN
    RAISE EXCEPTION 'BOOKING_V2: contact required' USING errcode = 'VF400';
  END IF;

  -- 7. RISORSA SERVER-AUTHORITATIVE.
  --    p_resource_slug = '' | 'any' | NULL → ANY deterministic.
  --    altrimenti → use that slug (validate active, bookable, eligible, tenant, free).
  v_booking_range := tstzrange(p_starts_at, v_ends_at, '[)');

  IF p_resource_slug IS NULL OR p_resource_slug = '' OR p_resource_slug = 'any' THEN
    -- ANY deterministico:
    --  candidate resources = active + bookable + tenant + service eligible + free in range
    --  ORDER BY sort_order ASC, id ASC; pick first
    SELECT sr.id, sr.slug, sr.display_name
      INTO v_resource_id, v_resource_slug_out, v_resource_display
      FROM public.staff_resources sr
      WHERE sr.tenant_id = v_tenant_id
        AND sr.active = TRUE
        AND sr.bookable = TRUE
        -- service eligibility (M2M empty = ALL)
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.staff_resource_services m
             WHERE m.tenant_id = v_tenant_id AND m.resource_id = sr.id
          )
          OR EXISTS (
            SELECT 1 FROM public.staff_resource_services m
             WHERE m.tenant_id = v_tenant_id
               AND m.resource_id = sr.id
               AND m.service_id = p_service_id
               AND m.active = TRUE
          )
        )
        -- free (no confirmed overlap ON THIS resource)
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings b
           WHERE b.tenant_id = v_tenant_id
             AND b.resource_id = sr.id
             AND b.status = 'confirmed'
             AND tstzrange(b.starts_at, b.ends_at, '[)') && v_booking_range
        )
      ORDER BY sr.sort_order ASC, sr.id ASC
      LIMIT 1;

    IF v_resource_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_V2: no resource available' USING errcode = 'VF409';
    END IF;
  ELSE
    -- SELECTED: use specific slug (client selected). Server re-validate tutto.
    SELECT sr.id, sr.slug, sr.display_name
      INTO v_resource_id, v_resource_slug_out, v_resource_display
      FROM public.staff_resources sr
      WHERE sr.tenant_id = v_tenant_id
        AND sr.slug = p_resource_slug
        AND sr.active = TRUE
        AND sr.bookable = TRUE
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.staff_resource_services m
             WHERE m.tenant_id = v_tenant_id AND m.resource_id = sr.id
          )
          OR EXISTS (
            SELECT 1 FROM public.staff_resource_services m
             WHERE m.tenant_id = v_tenant_id
               AND m.resource_id = sr.id
               AND m.service_id = p_service_id
               AND m.active = TRUE
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings b
           WHERE b.tenant_id = v_tenant_id
             AND b.resource_id = sr.id
             AND b.status = 'confirmed'
             AND tstzrange(b.starts_at, b.ends_at, '[)') && v_booking_range
        )
      LIMIT 1;

    IF v_resource_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_V2: resource unavailable or ineligible' USING errcode = 'VF409';
    END IF;
  END IF;

  -- 8. INSERT booking (resource_id assegnato).
  --    EXCLUDE constraint (tenant,resource,time) = GUARDIANO ATOMICO FINALE sulle race.
  INSERT INTO public.bookings (
    tenant_id, service_id, resource_id, starts_at, ends_at, status,
    customer_name, customer_email, customer_phone, notes
  ) VALUES (
    v_tenant_id, p_service_id, v_resource_id, p_starts_at, v_ends_at, 'confirmed',
    p_customer_name, p_customer_email, p_customer_phone, p_notes
  ) RETURNING id, status INTO v_booking_id, v_status;

  -- 9. Audit (PII-free tramite trusted boundary).
  BEGIN
    PERFORM public._audit_insert_trusted(
      v_tenant_id,
      'booking_created',
      'booking',
      v_booking_id,
      jsonb_build_object(
        'service_id', p_service_id::text,
        'resource_id', v_resource_id::text,
        'resource_slug', v_resource_slug_out,
        'starts_at', p_starts_at::text,
        'ends_at', v_ends_at::text,
        'status', v_status,
        'source', 'public_slug_v2',
        'selection_mode', (CASE WHEN p_resource_slug IS NULL OR p_resource_slug = '' OR p_resource_slug = 'any' THEN 'any' ELSE 'selected' END)
      )::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY SELECT
    v_booking_id,
    v_status AS booking_status,
    p_starts_at,
    v_ends_at,
    v_resource_slug_out,
    v_resource_display;
END;
$$;

ALTER FUNCTION public.public_booking_create_v2(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_v2(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v2(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon;

-- ----------------------------------------------------------------------------
-- KEEP backward compatible p_resource_slug omission:
-- public_booking_create_v2 with 7 params (default p_resource_slug = 'any').
-- La RPC originale V1 public_booking_create_slug resta invariata frozen e
-- continua a usare ... il trigger insert setta resource_id NULL ma CHECK
-- confirmed NOT NULL rompe! Quindi aggiornamento: per compatibilità,
-- dobbiamo garantire che insert tramite V1 (che NON passa resource_id)
-- usi default resource del tenant.
-- Soluzione TRIGGER BEFORE INSERT bookings (se resource_id null confirmed)
--   → default resource deterministica (slug='principale').
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookings_set_resource_if_null()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_def UUID;
BEGIN
  IF NEW.resource_id IS NULL AND NEW.status = 'confirmed' THEN
    SELECT sr.id INTO v_def
      FROM public.staff_resources sr
     WHERE sr.tenant_id = NEW.tenant_id
       AND sr.active = TRUE
     ORDER BY
       CASE WHEN sr.slug = 'principale' THEN 0 ELSE 1 END,
       sr.sort_order ASC,
       sr.id ASC
     LIMIT 1;

    -- Safety-net: tenant senza risorse (fixture bypassano onboarding RPC).
    -- Idempotentemente creiamo risorsa 'principale' default e la usiamo.
    IF v_def IS NULL THEN
      INSERT INTO public.staff_resources(
        tenant_id, display_name, slug, active, bookable, sort_order
      ) VALUES (
        NEW.tenant_id, 'Principale', 'principale', TRUE, TRUE, 0
      )
      ON CONFLICT (tenant_id, slug) DO UPDATE SET active = TRUE
      RETURNING id INTO v_def;

      -- audit trusted per safety create
      PERFORM public._audit_insert_trusted(
        NEW.tenant_id,
        'resource_created',
        'staff_resource',
        v_def,
        jsonb_build_object('slug', 'principale', 'source', 'booking_fallback_autocreate')
      );
    END IF;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'bookings_set_resource_if_null: no default resource for tenant %', NEW.tenant_id
        USING errcode = 'VF500';
    END IF;
    NEW.resource_id := v_def;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_bookings_set_resource_if_null
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_set_resource_if_null();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER FUNCTION public.bookings_set_resource_if_null() OWNER TO postgres;
