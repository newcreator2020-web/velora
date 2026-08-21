-- FASE 9b: SECURITY DEFINER anon booking create (slug trusted parameter).
-- Public boundary: anon può prenotare tramite slug server-side derivato.
-- Non accetta tenant_id dal client.
-- SET search_path = '' per security definer hardening.
-- REVOKE PUBLIC default; grant solo anon e authenticated; authenticated non può usare
--   se non tramite interface apposita (ma qui usato solo per anon boundary, per authenticated
--   usare RLS + ruolo).

CREATE OR REPLACE FUNCTION public.public_booking_create_slug(
  p_slug TEXT,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_customer_name TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS TABLE (
  booking_id UUID,
  booking_status TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
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
  v_local_day SMALLINT;  -- 0..6 Sun..Sat (business_availability weekday standard: 0=Sun)
  v_local_start TIME;
  v_ba_start TIME;
  v_ba_end TIME;
  v_ba_enabled BOOLEAN;
  v_booking_id UUID;
  v_status TEXT;
  v_service_name TEXT;
BEGIN
  -- 1. Slug strict allowlist: lowercase, 4-60 chars, alnum + hyphens.
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9\-]{2,58}[a-z0-9]$' THEN
    RAISE EXCEPTION 'BOOKING: slug invalid' USING errcode = 'VF400';
  END IF;

  -- 2. Derive tenant id FROM slug (server-side trusted, NOT client-supplied).
  SELECT t.id, t.published, COALESCE(bp.timezone, 'UTC')
    INTO v_tenant_id, v_tenant_published, v_timezone
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
    WHERE t.slug = p_slug
    LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING: tenant not found' USING errcode = 'VF404';
  END IF;

  -- Booking consentito solo se tenant published=true.
  IF v_tenant_published IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING: tenant not published' USING errcode = 'VF403';
  END IF;

  -- 3. Validate IANA timezone (minimamente: non vuoto, max 64 chars, nessun carattere pericoloso).
  IF v_timezone IS NULL OR char_length(v_timezone) > 64 OR v_timezone ~ '[^A-Za-z0-9_/+\-]' THEN
    RAISE EXCEPTION 'BOOKING: tenant timezone invalid' USING errcode = 'VF500';
  END IF;

  -- 4. Validate service: belongs tenant, active, duration not null positive.
  SELECT s.tenant_id, s.active, s.duration_minutes, s.name
    INTO v_service_tenant_id, v_service_active, v_duration, v_service_name
    FROM public.services s
    WHERE s.id = p_service_id
    LIMIT 1;

  IF v_service_tenant_id IS NULL OR v_service_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'BOOKING: service not found for tenant' USING errcode = 'VF404';
  END IF;

  IF v_service_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING: service inactive' USING errcode = 'VF403';
  END IF;

  IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 480 THEN
    RAISE EXCEPTION 'BOOKING: duration invalid' USING errcode = 'VF400';
  END IF;

  -- 5. Derive ends_at SERVER SIDE (IGNORE client-supplied ends_at).
  v_ends_at := p_starts_at + (v_duration::text || ' minutes')::INTERVAL;

  -- 6. starts_at strict nel futuro >= now() + 1 minuto (booking immediato vietato).
  v_min_future := NOW() + INTERVAL '1 minute';
  IF p_starts_at IS NULL OR p_starts_at < v_min_future THEN
    RAISE EXCEPTION 'BOOKING: starts_at too early' USING errcode = 'VF400';
  END IF;

  -- Prevent bookings oltre 12 mesi.
  IF p_starts_at > NOW() + INTERVAL '12 months' THEN
    RAISE EXCEPTION 'BOOKING: starts_at too far' USING errcode = 'VF400';
  END IF;

  -- 7. Business hours validation. Convert start to tenant local timezone, weekday.
  -- EXTRACT(ISODOW) restituisce 1..7 (Mon..Sun); nostro modello weekday = 0..6 Sun..Sat quindi:
  -- Sun (ISODOW 7) → 0, Mon (1) → 1 ... Sat (6) → 6.
  v_local_start := (p_starts_at AT TIME ZONE v_timezone)::time;
  SELECT EXTRACT(ISODOW FROM (p_starts_at AT TIME ZONE v_timezone))::smallint INTO STRICT v_local_day;
  IF v_local_day = 7 THEN v_local_day := 0; END IF;

  SELECT enabled, start_time, end_time
    INTO v_ba_enabled, v_ba_start, v_ba_end
    FROM public.business_availability ba
    WHERE ba.tenant_id = v_tenant_id AND ba.weekday = v_local_day
    LIMIT 1;

  IF NOT FOUND OR v_ba_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING: business closed' USING errcode = 'VF422';
  END IF;

  -- Whole booking [start..end) deve cadere dentro [start_time..end_time].
  IF v_local_start < v_ba_start OR v_local_start > v_ba_end - (v_duration::text || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'BOOKING: outside business hours' USING errcode = 'VF422';
  END IF;

  -- 8. Validate PII: name, email, phone, notes strict allowlist.
  IF p_customer_name IS NULL OR char_length(p_customer_name) < 1 OR char_length(p_customer_name) > 120 THEN
    RAISE EXCEPTION 'BOOKING: customer_name invalid' USING errcode = 'VF400';
  END IF;

  IF p_customer_email IS NOT NULL THEN
    IF char_length(p_customer_email) < 3 OR char_length(p_customer_email) > 254
       OR p_customer_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
      RAISE EXCEPTION 'BOOKING: email invalid' USING errcode = 'VF400';
    END IF;
  END IF;

  IF p_customer_phone IS NOT NULL THEN
    IF char_length(p_customer_phone) < 4 OR char_length(p_customer_phone) > 32
       OR p_customer_phone !~ '^[0-9+\-\s()]{4,32}$' THEN
      RAISE EXCEPTION 'BOOKING: phone invalid' USING errcode = 'VF400';
    END IF;
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 500 THEN
    RAISE EXCEPTION 'BOOKING: notes too long' USING errcode = 'VF400';
  END IF;

  -- Almeno un contatto.
  IF COALESCE(char_length(p_customer_email),0) = 0 AND COALESCE(char_length(p_customer_phone),0) = 0 THEN
    RAISE EXCEPTION 'BOOKING: contact required' USING errcode = 'VF400';
  END IF;

  -- 9. INSERT booking.
  --    status = confirmed (anon non può scegliere stato).
  --    Exception: sovrapposizione confirmed → EXCLUSION.
  INSERT INTO public.bookings (
    tenant_id, service_id, starts_at, ends_at, status,
    customer_name, customer_email, customer_phone, notes
  ) VALUES (
    v_tenant_id, p_service_id, p_starts_at, v_ends_at, 'confirmed',
    p_customer_name, p_customer_email, p_customer_phone, p_notes
  ) RETURNING id, status INTO v_booking_id, v_status;

  -- 10. Audit PII-safe: SOLO metadata ids/timing, NO customer details.
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, resource_type, resource_id, metadata)
    VALUES (
      v_tenant_id,
      'system',
      'anon-public-booking',
      'booking_created',
      'booking',
      v_booking_id,
      jsonb_build_object(
        'service_id', p_service_id::text,
        'starts_at', p_starts_at::text,
        'ends_at', v_ends_at::text,
        'status', v_status,
        'source', 'public_slug'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure = NON blocking. Registrato e continua.
    NULL;
  END;

  RETURN QUERY SELECT v_booking_id, v_status AS booking_status, p_starts_at, v_ends_at;
END;
$$;

-- Grants: revoke public default.
ALTER FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Solo anon può eseguire (boundary pubblico). authenticated usa dashboard OWNER/MANAGER via own actions.
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO anon;
