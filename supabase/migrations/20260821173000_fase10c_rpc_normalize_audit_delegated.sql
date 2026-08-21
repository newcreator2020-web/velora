-- =========================================================================
-- FASE 10C — DEFECT CLOSURE 2:
--   - Normalize p_customer_email/phone/name BEFORE raw insert into bookings
--     per compatibilità con CHECK constraint FASE9a (non modificabile frozen).
--   - Rimuovo insert audit_logs DIRETTO dentro RPC (RLS 42501):
--     il trusted AFTER INSERT trigger bookings_audit_created_trusted (FASE10b)
--     gestisce booking_created.
--   - BONUS: bookings customer fields normalizzati coerenti con CRM customer.
--
-- APPEND ONLY. Non modifico migration FASE1-9 frozen. Firma REMAINS
--   (TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) — STESSA DI FASE9b/FASE10.
--   evito overload 42883 (drop+create, no OR REPLACE).
-- =========================================================================

SET search_path = '';

DROP FUNCTION IF EXISTS public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.public_booking_create_slug(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION public.public_booking_create_slug(
  p_slug          TEXT,
  p_service_id    UUID,
  p_starts_at     TIMESTAMPTZ,
  p_customer_name TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
) RETURNS TABLE (
  booking_id     UUID,
  booking_status TEXT,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  customer_id    UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_svc RECORD;
  v_st TIMESTAMPTZ;
  v_en TIMESTAMPTZ;
  v_bid UUID;
  v_cust_id UUID;
  v_valid BOOL;
  v_cname TEXT;
  v_cemail TEXT;
  v_cphone TEXT;
  v_notes TEXT;
BEGIN
  -- 0. normalize + strict length bookings fields BEFORE constraint check.
  v_cname  := NULLIF(BTRIM(p_customer_name), '');
  v_cemail := CASE WHEN p_customer_email IS NULL THEN NULL
                   WHEN BTRIM(p_customer_email) = '' THEN NULL
                   ELSE LOWER(BTRIM(p_customer_email)) END;
  v_cphone := CASE WHEN p_customer_phone IS NULL THEN NULL
                   WHEN REGEXP_REPLACE(p_customer_phone, '[^0-9]', '', 'g') = '' THEN NULL
                   ELSE BTRIM(p_customer_phone) END;
  IF v_cname IS NULL THEN RAISE EXCEPTION 'customer_name required' USING errcode = 'VF400'; END IF;
  IF char_length(v_cname)  > 160 THEN RAISE EXCEPTION 'customer_name too long'   USING errcode = 'VF400'; END IF;
  IF v_cemail IS NOT NULL AND char_length(v_cemail) > 254 THEN
    RAISE EXCEPTION 'customer_email too long' USING errcode = 'VF400';
  END IF;
  IF v_cphone IS NOT NULL AND char_length(v_cphone) > 32 THEN
    RAISE EXCEPTION 'customer_phone too long' USING errcode = 'VF400';
  END IF;
  v_notes := LEFT(NULLIF(BTRIM(COALESCE(p_notes,'')),''), 2000);

  -- 1. resolve slug → tenant published
  SELECT id INTO v_tenant_id FROM public.tenants
    WHERE slug = p_slug AND published = TRUE LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant not found or unpublished' USING errcode = 'VF404';
  END IF;

  -- 2. resolve service active + duration
  SELECT id, duration_minutes, active INTO v_svc FROM public.services
    WHERE id = p_service_id AND tenant_id = v_tenant_id AND active = TRUE LIMIT 1;
  IF v_svc IS NULL OR NOT v_svc.active THEN
    RAISE EXCEPTION 'service invalid' USING errcode = 'VF400';
  END IF;
  IF v_svc.duration_minutes IS NULL OR v_svc.duration_minutes <= 0 OR v_svc.duration_minutes > 480 THEN
    RAISE EXCEPTION 'service duration invalid' USING errcode = 'VF400';
  END IF;

  -- 3. slot not past + end calc
  v_st := p_starts_at;
  IF v_st < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'past slot' USING errcode = 'VF400';
  END IF;
  v_en := v_st + (v_svc.duration_minutes::text || ' minutes')::interval;

  -- 4. business hours + GIST overlap
  SELECT public.booking_validate_business_hours_and_overlap(
    v_tenant_id, p_service_id, v_st, v_en
  ) INTO v_valid;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'slot unavailable' USING errcode = 'VF409';
  END IF;

  -- 5. CRM customer dedup trusted. passa (name, NORMALIZED email/phone)
  SELECT r.customer_id INTO v_cust_id
    FROM public.customer_upsert_for_public_booking(
      v_tenant_id, v_cname, v_cemail, v_cphone
    ) r;

  -- 6. INSERT bookings. Normalized values CHECK FASE9.
  INSERT INTO public.bookings (
    tenant_id, service_id, starts_at, ends_at, status,
    customer_name, customer_email, customer_phone, notes, customer_id
  ) VALUES (
    v_tenant_id, p_service_id, v_st, v_en, 'confirmed',
    v_cname, v_cemail, v_cphone, v_notes, v_cust_id
  ) RETURNING id INTO v_bid;

  -- 7. Audit booking_created — DELEGATED TO trusted AFTER INSERT trigger
  --    (bookings_audit_created_trusted — SEC DEFINER; FASE10b).
  --    Nessun insert diretto qui (avoid 42501 RLS audit_logs).

  RETURN QUERY SELECT v_bid, 'confirmed'::TEXT, v_st, v_en, v_cust_id;
  RETURN;
END; $$;

ALTER FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO postgres;

-- =========================================================================
-- FINE FASE 10C
-- =========================================================================
