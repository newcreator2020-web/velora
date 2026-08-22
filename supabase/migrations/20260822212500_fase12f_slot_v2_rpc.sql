-- ============================================================================
-- FASE 12F — Public Slot Engine V2 (Resource-Aware)
--
-- Boundary ANON PII-FREE. NON restituisce:
--   booking_id / customer_name / email / phone / notes / actor / JWT / secret.
--
-- Input: p_resource_slug (optional)
--   · NULL / '' / 'any' → QUALSIASI operatore (ANY)
--   · 'maria-rossi' → solo risorsa con slug specifico per quel tenant.
--
-- Semantica Eligibility M2M (deterministica):
--   per resource R:
--     EXISTS M2M rows for R → allowed services = active M2M rows only
--     NO M2M rows for R     → allowed services = ALL (default resource behavior)
--
-- Slot granularity = 30 minuti. Step start_time = 00/30 min.
-- Duration = services.duration_minutes (Source of Truth; M2M override non
-- attivato in FASE12).
--
-- Returns:
--   starts_at, ends_at, resource_slug, resource_display_name.
--   Una riga per ogni combinazione (slot_start, eligible_available_resource).
--   Quindi se Maria + Luca entrambi disponibili 10:00 → 2 righe.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.public_slot_get_available_v2(
  p_slug TEXT,
  p_service_id UUID,
  p_window_start DATE,
  p_window_end DATE,
  p_resource_slug TEXT DEFAULT 'any'
) RETURNS TABLE (
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
  v_service_tenant_id UUID;
  v_service_active BOOLEAN;
  v_step INTERVAL;
BEGIN
  -- ---- 1. slug validation -------------------------------------------------
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9\-]{2,58}[a-z0-9]$' THEN
    RAISE EXCEPTION 'SLOT_V2: slug invalid' USING errcode = 'VF400';
  END IF;

  SELECT t.id, t.published, COALESCE(bp.timezone, 'UTC')
    INTO v_tenant_id, v_tenant_published, v_timezone
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
   WHERE t.slug = p_slug
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'SLOT_V2: tenant not found' USING errcode = 'VF404';
  END IF;
  IF v_tenant_published IS NOT TRUE THEN
    RAISE EXCEPTION 'SLOT_V2: tenant not published' USING errcode = 'VF403';
  END IF;
  IF v_timezone IS NULL OR char_length(v_timezone) > 64 OR v_timezone ~ '[^A-Za-z0-9_/+\-]' THEN
    RAISE EXCEPTION 'SLOT_V2: tenant timezone invalid' USING errcode = 'VF500';
  END IF;

  -- ---- 2. service validation (belongs tenant, active, duration) ---------
  SELECT s.tenant_id, s.active, s.duration_minutes
    INTO v_service_tenant_id, v_service_active, v_duration
    FROM public.services s
   WHERE s.id = p_service_id
   LIMIT 1;

  IF v_service_tenant_id IS NULL OR v_service_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'SLOT_V2: service not found for tenant' USING errcode = 'VF404';
  END IF;
  IF v_service_active IS NOT TRUE THEN
    RAISE EXCEPTION 'SLOT_V2: service inactive' USING errcode = 'VF403';
  END IF;
  IF v_duration IS NULL OR v_duration <= 0 OR v_duration > 480 THEN
    RAISE EXCEPTION 'SLOT_V2: duration invalid' USING errcode = 'VF400';
  END IF;

  -- ---- 3. window bounds ---------------------------------------------------
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start > p_window_end THEN
    RAISE EXCEPTION 'SLOT_V2: window invalid' USING errcode = 'VF400';
  END IF;
  IF p_window_end > p_window_start + 60 THEN
    RAISE EXCEPTION 'SLOT_V2: window too wide (max 60 days)' USING errcode = 'VF400';
  END IF;

  v_step := '30 minutes'::INTERVAL;

  -- ---- 4. GENERATE RETURNS via single query (CTE plan) -------------------
  RETURN QUERY
  WITH
  -- candidate resources: active & bookable, p_resource_slug filter if any
  resources AS (
    SELECT
      sr.id,
      sr.slug,
      sr.display_name,
      sr.sort_order
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id
      AND sr.active = TRUE
      AND sr.bookable = TRUE
      AND (
        p_resource_slug IS NULL
        OR p_resource_slug = ''
        OR p_resource_slug = 'any'
        OR sr.slug = p_resource_slug
      )
  ),
  -- M2M eligibility has_rows → fallback ALL per resource
  eligibility AS (
    SELECT
      r.id AS resource_id,
      (EXISTS (
        SELECT 1 FROM public.staff_resource_services m
         WHERE m.tenant_id = v_tenant_id AND m.resource_id = r.id
      )) AS has_any_m2m,
      (
        NOT EXISTS (
          SELECT 1 FROM public.staff_resource_services m
           WHERE m.tenant_id = v_tenant_id AND m.resource_id = r.id
        )
        OR EXISTS (
          SELECT 1 FROM public.staff_resource_services m
           WHERE m.tenant_id = v_tenant_id
             AND m.resource_id = r.id
             AND m.service_id = p_service_id
             AND m.active = TRUE
        )
      ) AS eligible_for_service
    FROM resources r
  ),
  eligible AS (
    SELECT r.id, r.slug, r.display_name, r.sort_order
    FROM resources r
    JOIN eligibility e ON e.resource_id = r.id
    WHERE e.eligible_for_service = TRUE
  ),
  -- generate local days inside window
  days AS (
    SELECT d::date AS local_date,
           CASE EXTRACT(ISODOW FROM d)::int
             WHEN 7 THEN 0 ELSE EXTRACT(ISODOW FROM d)::int END AS weekday
    FROM generate_series(p_window_start, p_window_end, '1 day') d
  ),
  -- join with business_availability → business open intervals (local)
  business_open AS (
    SELECT
      d.local_date,
      ba.start_time,
      ba.end_time
    FROM days d
    JOIN public.business_availability ba
      ON ba.tenant_id = v_tenant_id AND ba.weekday = d.weekday
    WHERE ba.enabled = TRUE
  ),
  -- generate 30-min candidate start_times inside each open interval
  slot_times AS (
    SELECT
      (bo.local_date::timestamp + (bo.start_time) + (n * v_step))::TIMESTAMP WITHOUT TIME ZONE
        AS local_start_ts,
      v_duration AS duration
    FROM business_open bo
    CROSS JOIN generate_series(
      0,
      floor(
        EXTRACT(EPOCH FROM (bo.end_time - bo.start_time)) /
        EXTRACT(EPOCH FROM v_step)
      )::int - 1
    ) n
    WHERE bo.start_time + (n * v_step) + (v_duration * interval '1 minute') <= bo.end_time
  ),
  -- convert to UTC tstzrange [start,start+duration)
  slot_ranges AS (
    SELECT
      (local_start_ts AT TIME ZONE v_timezone) AS utc_start,
      tstzrange(
        (local_start_ts AT TIME ZONE v_timezone),
        ((local_start_ts + (duration::text||' minutes')::interval) AT TIME ZONE v_timezone),
        '[)'
      ) AS booking_range
    FROM slot_times
  ),
  -- confirmed bookings con range [start,end) per tenant
  confirmed_bookings AS (
    SELECT
      b.resource_id,
      tstzrange(b.starts_at, b.ends_at, '[)') AS booking_range
    FROM public.bookings b
    WHERE b.tenant_id = v_tenant_id
      AND b.status = 'confirmed'
      AND b.resource_id IN (SELECT id FROM eligible)
      -- optimization: only overlaps window (±1 day buffer)
      AND b.starts_at >= (p_window_start::timestamp AT TIME ZONE v_timezone) - interval '1 day'
      AND b.ends_at   <= (p_window_end::timestamp   AT TIME ZONE v_timezone) + interval '1 day' + interval '24 hours'
  ),
  -- × join slots × eligible resources; anti-join confirmed
  free_slots AS (
    SELECT
      s.utc_start AS starts_at,
      upper(s.booking_range) AS ends_at,
      e.id AS resource_id,
      e.slug AS resource_slug,
      e.display_name AS resource_display_name,
      e.sort_order
    FROM slot_ranges s
    CROSS JOIN eligible e
    WHERE NOT EXISTS (
      SELECT 1 FROM confirmed_bookings c
       WHERE c.resource_id = e.id
         AND c.booking_range && s.booking_range
    )
  )
  SELECT f.starts_at, f.ends_at, f.resource_slug, f.resource_display_name
  FROM free_slots f
  ORDER BY f.starts_at ASC, f.sort_order ASC, f.resource_id ASC;
END;
$$;

ALTER FUNCTION public.public_slot_get_available_v2(TEXT,UUID,DATE,DATE,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_slot_get_available_v2(TEXT,UUID,DATE,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_slot_get_available_v2(TEXT,UUID,DATE,DATE,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.public_slot_get_available_v2(TEXT,UUID,DATE,DATE,TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- Resource public list PII-free per dropdown "Scegli professionista"
--     count eligible resources ≥2 → mostra dropdown ANY/selected.
--     count = 1 → nascondi dropdown (single-mode).
-- Restituisce: slug, display_name (nessun id interno se non necessario, ma
-- teniamo slug come public identifier sicuro).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_booking_resources_list(
  p_slug TEXT,
  p_service_id UUID
) RETURNS TABLE (
  resource_slug TEXT,
  resource_display_name TEXT,
  sort_order INTEGER
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_tenant_published BOOLEAN;
  v_service_tenant_id UUID;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9\-]{2,58}[a-z0-9]$' THEN
    RAISE EXCEPTION 'RES_LIST: slug invalid' USING errcode = 'VF400';
  END IF;

  SELECT t.id, t.published
    INTO v_tenant_id, v_tenant_published
    FROM public.tenants t
   WHERE t.slug = p_slug
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'RES_LIST: tenant not found' USING errcode = 'VF404';
  END IF;
  IF v_tenant_published IS NOT TRUE THEN
    RAISE EXCEPTION 'RES_LIST: tenant not published' USING errcode = 'VF403';
  END IF;

  SELECT s.tenant_id INTO v_service_tenant_id
    FROM public.services s WHERE s.id = p_service_id LIMIT 1;
  IF v_service_tenant_id IS NULL OR v_service_tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'RES_LIST: service not found for tenant' USING errcode = 'VF404';
  END IF;

  RETURN QUERY
  SELECT sr.slug, sr.display_name, sr.sort_order
  FROM public.staff_resources sr
  WHERE sr.tenant_id = v_tenant_id
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
  ORDER BY sr.sort_order ASC, sr.id ASC;
END;
$$;

ALTER FUNCTION public.public_booking_resources_list(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_resources_list(TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_resources_list(TEXT,UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.public_booking_resources_list(TEXT,UUID) TO authenticated;
