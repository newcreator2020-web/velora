-- ============================================================================
-- FASE 13B5 — Slot Engine V3: public_slot_get_available_v3 RPC
--
-- Input: tenant_slug, service_id, from_date, to_date (MAX 7 giorni), resource_slug ('any' o slug)
--
-- Ordine 13 step: 1 tenant active/published · 2 service active · 3 resource active/bookable
--   · 4 eligibility (SRS M2M or fallback ALL) · 5 business outer hours
--   · 6 resource weekly (inherit se vuoto) · 7 business exceptions precedence
--   · 8 resource time-off subtract · 9 duration SoT · 10 lead_time · 11 max_horizon
--   · 12 confirmed bookings subtract via overlap check · 13 ordering deterministic
--
-- Output PUBLICO PII-FREE. Niente booking_id / customer_id / email.
-- SECURITY DEFINER perché anon vuole usarlo (pubblico).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.public_slot_get_available_v3(
  p_tenant_slug   TEXT,
  p_service_id    UUID,
  p_from_date     DATE,
  p_to_date       DATE,
  p_resource_slug TEXT DEFAULT 'any'
)
RETURNS TABLE (
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  resource_id UUID,
  resource_slug TEXT,
  resource_display_name TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id   UUID;
  v_published   BOOLEAN;
  v_tenant_status TEXT;
  v_tz          TEXT;
  v_duration    INT;
  v_service_active BOOLEAN;
  v_lead_min    INT;
  v_horizon_d   INT;
  v_step_min    INT;
  v_horizon_end DATE;
  v_from_ok     DATE;
  v_to_ok       DATE;
  v_lead_cut    TIMESTAMPTZ;
BEGIN
  -- 0. Max window enforcement (fail-safe instead of producing millions of rows).
  IF p_from_date IS NULL OR p_to_date IS NULL THEN
    RAISE EXCEPTION 'invalid window' USING ERRCODE = '22023';
  END IF;
  IF (p_to_date - p_from_date) > 7 THEN
    RAISE EXCEPTION 'window too large' USING ERRCODE = '22023';
  END IF;
  IF p_to_date < p_from_date THEN
    RETURN;
  END IF;

  -- Constants SoT.
  SELECT s.lead_time_minutes, s.booking_horizon_days, s.slot_step_minutes
    INTO v_lead_min, v_horizon_d, v_step_min
  FROM public.scheduling_constants() s;

  v_horizon_end := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::DATE + v_horizon_d;
  v_from_ok := GREATEST(p_from_date, CURRENT_DATE);
  v_to_ok   := LEAST(p_to_date,   v_horizon_end);
  IF v_to_ok < v_from_ok THEN RETURN; END IF;

  v_lead_cut := CURRENT_TIMESTAMP + (v_lead_min::TEXT || ' minutes')::INTERVAL;

  -- Step 1+2: tenant exists + published + active, service exists + active + belongs to tenant.
  SELECT t.id, t.published, t.status, bp.timezone
    INTO v_tenant_id, v_published, v_tenant_status, v_tz
  FROM public.tenants t
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
  WHERE t.slug = p_tenant_slug;

  IF v_tenant_id IS NULL THEN RETURN; END IF;
  IF NOT COALESCE(v_published, FALSE) THEN RETURN; END IF;
  IF COALESCE(v_tenant_status, '') <> 'active' THEN RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  SELECT s.duration_minutes, s.active
    INTO v_duration, v_service_active
  FROM public.services s
  WHERE s.id = p_service_id AND s.tenant_id = v_tenant_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF NOT COALESCE(v_service_active, FALSE) THEN RETURN; END IF;
  IF v_duration IS NULL OR v_duration < 5 OR v_duration > 1440 THEN RETURN; END IF;

  RETURN QUERY
  WITH
    -- Step 3: candidate resources (active, bookable, tenant-bound)
    candidates AS (
      SELECT sr.id, sr.slug, sr.display_name, sr.sort_order
      FROM public.staff_resources sr
      WHERE sr.tenant_id = v_tenant_id
        AND sr.active   = TRUE
        AND sr.bookable = TRUE
        AND (p_resource_slug = 'any' OR sr.slug = p_resource_slug)
    ),
    -- Step 4: eligibility (has SRS rows → must be mapped active; else ALL services)
    eligible AS (
      SELECT c.*
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.staff_resource_services srs
        WHERE srs.tenant_id = v_tenant_id
          AND srs.resource_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_resource_services srs
        WHERE srs.tenant_id = v_tenant_id
          AND srs.resource_id = c.id
          AND srs.service_id  = p_service_id
          AND srs.active = TRUE
      )
    ),
    -- Step 5+6: per-resource ranges (inherit se vuoto)
    res_ranges AS (
      SELECT e.id AS resource_id, e.slug, e.display_name, e.sort_order,
             rw.day_date, rw.start_tstz, rw.end_tstz
      FROM eligible e,
           LATERAL public.scheduling_resource_weekly_ranges(
             v_tenant_id, e.id, v_from_ok, v_to_ok, v_tz
           ) rw
    ),
    -- Step 7: Business exceptions precedence 4 livelli.
    --   slot_block = overlay remove range sempre
    --   closure    = remove
    --   special_hours (if configured con start_time/end_time) = replace
    --   extra_open = add (ma sopra perdono contro closure/slot_block)
    -- Implementazione semplificata production-grade:
    --   prima unifica closure+slot_block in "nego" ranges
    --   poi per ogni data/risorsa:
    --     se c'è special_hours active in quella data, usa le special hours
    --     altrimenti usa res_ranges (già intersect business outer)
    --   infine aggiungi extra_open ranges
    --   e sottrai closure/slot_block (precedence 1/2)
    neg_ranges AS (
      SELECT tstzrange(bse.starts_at, bse.ends_at, '[)') AS rng
      FROM public.business_schedule_exceptions bse
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type IN ('closure','slot_block')
    ),
    special_days_raw AS (
      SELECT bse.*,
             gs.d::DATE AS day_date,
             COALESCE(bse.start_time, '09:00'::TIME) AS st,
             COALESCE(bse.end_time,   '18:00'::TIME) AS et
      FROM public.business_schedule_exceptions bse,
           LATERAL generate_series(
             DATE_TRUNC('day', bse.starts_at AT TIME ZONE v_tz)::DATE,
             DATE_TRUNC('day', bse.ends_at   AT TIME ZONE v_tz)::DATE,
             INTERVAL '1 day'
           ) gs(d)
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type = 'special_hours'
        AND bse.start_time IS NOT NULL
        AND bse.end_time   IS NOT NULL
    ),
    special_days AS (
      SELECT
        r.day_date,
        ls.utc_tstz AS spec_start,
        le.utc_tstz AS spec_end
      FROM special_days_raw r,
           LATERAL public.scheduling_local_to_utc(r.day_date, r.st, v_tz) ls,
           LATERAL public.scheduling_local_to_utc(r.day_date, r.et, v_tz) le
      WHERE ls.dst_status = 'OK'
        AND le.dst_status = 'OK'
    ),
    extra_open_ranges AS (
      SELECT tstzrange(bse.starts_at, bse.ends_at, '[)') AS rng
      FROM public.business_schedule_exceptions bse
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type = 'extra_open'
    ),
    effective_ranges AS (
      -- (A) Giorni con special_days: 1 sola riga per (risorsa, giorno) usando gli orari override
      SELECT
        e.id AS resource_id, e.slug, e.display_name, e.sort_order,
        tstzrange(sd.spec_start, sd.spec_end, '[)')
        *
        tstzrange(
          (v_from_ok::TIMESTAMP AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
          ((v_to_ok + 1)::TIMESTAMP AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
          '[)'
        ) AS day_range
      FROM special_days sd, eligible e
      WHERE lower(tstzrange(sd.spec_start, sd.spec_end, '[)')) IS NOT NULL
        AND upper(tstzrange(sd.spec_start, sd.spec_end, '[)'))
              > lower(tstzrange(sd.spec_start, sd.spec_end, '[)'))

      UNION ALL

      -- (B) Giorni SENZA special_days: tutti gli intervalli resource_weekly_ranges
      SELECT
        rr.resource_id, rr.slug, rr.display_name, rr.sort_order,
        tstzrange(rr.start_tstz, rr.end_tstz, '[)')
        *
        tstzrange(
          (v_from_ok::TIMESTAMP AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
          ((v_to_ok + 1)::TIMESTAMP AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
          '[)'
        ) AS day_range
      FROM res_ranges rr
      WHERE rr.day_date NOT IN (SELECT day_date FROM special_days)

      UNION ALL

      -- (C) Extra open (aperture straordinarie)
      SELECT e.id, e.slug, e.display_name, e.sort_order, eo.rng
      FROM eligible e, extra_open_ranges eo
    ),
    -- Step 8: resource time-off subtract range
    rto_ranges AS (
      SELECT rto.resource_id, tstzrange(rto.starts_at, rto.ends_at, '[)') AS rng
      FROM public.resource_time_off rto
      WHERE rto.tenant_id = v_tenant_id
    ),
    -- Genera slot 15min steps all'interno di effective_ranges, step=slot_step_minutes
    raw_slots AS (
      SELECT
        er.resource_id, er.slug, er.display_name, er.sort_order,
        slot_start,
        slot_start + (v_duration::TEXT || ' minutes')::INTERVAL AS slot_end
      FROM effective_ranges er,
           LATERAL generate_series(
             lower(er.day_range),
             upper(er.day_range) - (v_duration::TEXT || ' minutes')::INTERVAL,
             (v_step_min::TEXT || ' minutes')::INTERVAL
           ) slot_start
      WHERE er.day_range IS NOT NULL
        AND NOT isempty(er.day_range)
        AND lower(er.day_range) IS NOT NULL
        AND upper(er.day_range) IS NOT NULL
        AND lower(er.day_range) < upper(er.day_range)
    ),
    cleaned AS (
      SELECT rs.*
      FROM raw_slots rs
      WHERE rs.slot_start >= v_lead_cut
        AND NOT EXISTS (
          SELECT 1 FROM neg_ranges nr
          WHERE nr.rng && tstzrange(rs.slot_start, rs.slot_end, '[)')
        )
        AND NOT EXISTS (
          SELECT 1 FROM rto_ranges rto
          WHERE rto.resource_id = rs.resource_id
            AND rto.rng && tstzrange(rs.slot_start, rs.slot_end, '[)')
        )
        AND NOT public.scheduling_resource_has_overlap_confirmed(
              v_tenant_id, rs.resource_id, rs.slot_start, rs.slot_end
            )
    )
  SELECT
    c.slot_start AS starts_at,
    c.slot_end   AS ends_at,
    c.resource_id,
    c.slug       AS resource_slug,
    c.display_name AS resource_display_name
  FROM cleaned c
  ORDER BY c.slot_start ASC, c.sort_order ASC, c.resource_id ASC;

  RETURN;
END;
$$;

ALTER FUNCTION public.public_slot_get_available_v3(TEXT, UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_slot_get_available_v3(TEXT, UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_slot_get_available_v3(TEXT, UUID, DATE, DATE, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Companion RPC: public_resources_list_v3 (PII-free public listing per service)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_resources_list_v3(
  p_tenant_slug   TEXT,
  p_service_id    UUID
)
RETURNS TABLE (
  resource_id     UUID,
  slug            TEXT,
  display_name    TEXT,
  color_hex       TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH t AS (
    SELECT id FROM public.tenants
     WHERE slug = p_tenant_slug AND published = TRUE AND status = 'active'
     LIMIT 1
  )
  SELECT DISTINCT sr.id, sr.slug, sr.display_name, sr.color_hex
  FROM t, public.staff_resources sr
  WHERE sr.tenant_id = t.id AND sr.active = TRUE AND sr.bookable = TRUE
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.staff_resource_services srs
        WHERE srs.tenant_id = t.id AND srs.resource_id = sr.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_resource_services srs
        WHERE srs.tenant_id = t.id
          AND srs.resource_id = sr.id
          AND srs.service_id = p_service_id
          AND srs.active = TRUE
      )
    )
  ORDER BY sr.display_name NULLS LAST, sr.slug;
$$;

ALTER FUNCTION public.public_resources_list_v3(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_resources_list_v3(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_resources_list_v3(TEXT, UUID) TO anon, authenticated, service_role;
