-- ============================================================================
-- FASE 13B4 — Scheduling Helpers + Timezone/DST deterministic resolution
--
-- Helper piccoli e componibili. Tutti SET search_path = '' hardened.
-- Volatility: IMMUTABLE se non leggono tabelle, STABLE altrimenti.
--
-- DST RULES DETERMINISTICHE:
--   DST_FWD  local non-existent  → return status 'DST_NONEXISTENT'
--   DST_BACK local duplicated    → return status 'DST_AMBIGUOUS'
--                                  (se caller ha esplicitamente richiesto
--                                  resolved, usa FIRST occurrence)
--   default OK                   → 'OK'
--
-- Round-trip detect: local→UTC→local != originale inesistente o ambiguous.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper 1. timezone resolve: local date+time + IANA tz → UTC tstz + status
--
-- ALGORITHM DETERMINISTICO (Europe/Rome verificato):
--   1. Converti local → utc (v_utc_a)
--   2. Round trip utc → local_rt1
--   3. Calcola "altra interpretazione": se spostiamo indietro di 1h l'UTC
--      e ri-convertiamo in locale → local_rt2.
--   4. Distinzione:
--      a) IF local_rt1 <> local_input AND local_rt1 = local_input + 1h
--         → DST_NONEXISTENT (fwd jump Marzo, orario saltato)
--      b) IF local_rt1 = local_input
--           AND local_rt2 = local_input
--           AND (v_utc_a - INTERVAL '1h') <> v_utc_a  (cioè non è collisione per altro)
--         → DST_AMBIGUOUS (backward jump Ottobre, orario ripetuto)
--      c) ELSE → OK.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduling_local_to_utc(
  p_local_date   DATE,
  p_local_time   TIME,
  p_tz_name      TEXT
)
RETURNS TABLE (
  utc_tstz      TIMESTAMPTZ,
  dst_status    TEXT,
  local_normal  TIMESTAMP
)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_local    TIMESTAMP;
  v_utc_a    TIMESTAMPTZ;
  v_utc_b    TIMESTAMPTZ;
  v_rt_a     TIMESTAMP;
  v_rt_b     TIMESTAMP;
BEGIN
  IF p_tz_name IS NULL OR char_length(p_tz_name) < 3 THEN
    RAISE EXCEPTION 'invalid timezone' USING ERRCODE = '22023';
  END IF;

  v_local := p_local_date::timestamp + p_local_time::time;

  BEGIN
    v_utc_a := v_local AT TIME ZONE p_tz_name;
  EXCEPTION WHEN OTHERS THEN
    dst_status   := 'DST_NONEXISTENT';
    utc_tstz     := NULL;
    local_normal := NULL;
    RETURN NEXT;
    RETURN;
  END;

  v_rt_a := v_utc_a AT TIME ZONE p_tz_name;

  -- Ipotesi seconda interpretazione ora indietro di 1h (backward jump scenario)
  v_utc_b := v_utc_a - INTERVAL '1 hour';
  BEGIN
    v_rt_b := v_utc_b AT TIME ZONE p_tz_name;
  EXCEPTION WHEN OTHERS THEN
    v_rt_b := NULL;
  END;

  IF (v_rt_a <> v_local) AND (v_rt_a = v_local + INTERVAL '1 hour') THEN
    -- DST FORWARD NONEXISTENT: saltato un'ora avanti in Marzo
    dst_status   := 'DST_NONEXISTENT';
    utc_tstz     := NULL;
    local_normal := v_rt_a;
    RETURN NEXT;
    RETURN;
  ELSIF (v_rt_a = v_local)
        AND (v_rt_b IS NOT NULL)
        AND (v_rt_b = v_local)
        AND (v_utc_a <> v_utc_b) THEN
    -- DST BACKWARD AMBIGUOUS: 2 UTC distinte 1h producono stessa locale
    dst_status   := 'DST_AMBIGUOUS';
    utc_tstz     := v_utc_a;
    local_normal := v_local;
    RETURN NEXT;
    RETURN;
  ELSE
    dst_status   := 'OK';
    utc_tstz     := v_utc_a;
    local_normal := v_rt_a;
    RETURN NEXT;
    RETURN;
  END IF;
END;
$$;

ALTER FUNCTION public.scheduling_local_to_utc(DATE, TIME, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_local_to_utc(DATE, TIME, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_local_to_utc(DATE, TIME, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Helper 2. business_weekly_ranges(tenant, from_date, to_date)
--   Espande business_availability in set di (start_tstz,end_tstz) TSTZ.
--   Inheritance per risorsa: se resource_availability è vuoto per weekday
--   → fallback a questi outer hours.
-- NOTA: plpgsql invece che SQL perché LANG sql non permette set-returning
--   functions nested nel WHERE (SQLSTATE 0A000) durante la build.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduling_business_weekly_ranges(
  p_tenant_id   UUID,
  p_from_date   DATE,
  p_to_date     DATE,
  p_tz          TEXT
)
RETURNS TABLE (
  day_date        DATE,
  weekday         SMALLINT,
  start_tstz      TIMESTAMPTZ,
  end_tstz        TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  rec RECORD;
  v_start_stat RECORD;
  v_end_stat RECORD;
BEGIN
  IF p_from_date > p_to_date THEN RETURN; END IF;
  FOR rec IN
    WITH days AS (
      SELECT d::DATE AS day_date, CAST(EXTRACT(ISODOW FROM d) AS SMALLINT) AS wd_raw
      FROM generate_series(p_from_date, p_to_date, INTERVAL '1 day') g(d)
    ),
    mapped AS (
      SELECT d.day_date,
             CASE WHEN d.wd_raw = 7 THEN 0 ELSE d.wd_raw END AS weekday
      FROM days d
    )
    SELECT m.day_date, m.weekday, ba.start_time, ba.end_time
    FROM mapped m
    JOIN public.business_availability ba
      ON ba.tenant_id = p_tenant_id
     AND ba.weekday   = m.weekday
     AND ba.enabled   = TRUE
  LOOP
    SELECT * INTO v_start_stat
      FROM public.scheduling_local_to_utc(rec.day_date, rec.start_time, p_tz);
    SELECT * INTO v_end_stat
      FROM public.scheduling_local_to_utc(rec.day_date, rec.end_time,   p_tz);
    IF COALESCE(v_start_stat.dst_status, 'X') = 'OK'
       AND COALESCE(v_end_stat.dst_status, 'X') = 'OK' THEN
      day_date   := rec.day_date;
      weekday    := rec.weekday;
      start_tstz := v_start_stat.utc_tstz;
      end_tstz   := v_end_stat.utc_tstz;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

ALTER FUNCTION public.scheduling_business_weekly_ranges(UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_business_weekly_ranges(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_business_weekly_ranges(UUID, DATE, DATE, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Helper 3. resource_weekly_ranges
--   Per-GIORNO resolution (non globale "tutto o niente"):
--     • SE esiste almeno 1 row resource_availability per (risorsa, weekday, enabled)
--       → usa TUTTE le row RA di quel giorno (multi-intervallo supportato)
--     • ALTRIMENTI → INHERIT from business_availability per quel weekday
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduling_resource_weekly_ranges(
  p_tenant_id   UUID,
  p_resource_id UUID,
  p_from_date   DATE,
  p_to_date     DATE,
  p_tz          TEXT
)
RETURNS TABLE (
  day_date        DATE,
  start_tstz      TIMESTAMPTZ,
  end_tstz        TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_day RECORD;
  v_has_ra INT;
  v_ra RECORD;
  v_ba RECORD;
  v_start_stat RECORD;
  v_end_stat RECORD;
BEGIN
  IF p_from_date > p_to_date THEN RETURN; END IF;

  FOR v_day IN
    SELECT d::DATE AS day_date,
           CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0
                ELSE CAST(EXTRACT(ISODOW FROM d) AS SMALLINT)
           END AS weekday
    FROM generate_series(p_from_date, p_to_date, INTERVAL '1 day') g(d)
  LOOP
    SELECT COUNT(*)::INT INTO v_has_ra
      FROM public.resource_availability ra
     WHERE ra.tenant_id   = p_tenant_id
       AND ra.resource_id = p_resource_id
       AND ra.enabled     = TRUE
       AND ra.weekday     = v_day.weekday;

    IF v_has_ra > 0 THEN
      FOR v_ra IN
        SELECT ra.start_time, ra.end_time
          FROM public.resource_availability ra
         WHERE ra.tenant_id   = p_tenant_id
           AND ra.resource_id = p_resource_id
           AND ra.enabled     = TRUE
           AND ra.weekday     = v_day.weekday
      LOOP
        SELECT * INTO v_start_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ra.start_time, p_tz);
        SELECT * INTO v_end_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ra.end_time, p_tz);
        IF COALESCE(v_start_stat.dst_status, 'X') = 'OK'
           AND COALESCE(v_end_stat.dst_status, 'X') = 'OK' THEN
          day_date   := v_day.day_date;
          start_tstz := v_start_stat.utc_tstz;
          end_tstz   := v_end_stat.utc_tstz;
          RETURN NEXT;
        END IF;
      END LOOP;
    ELSE
      SELECT ba.start_time, ba.end_time INTO v_ba
        FROM public.business_availability ba
       WHERE ba.tenant_id = p_tenant_id
         AND ba.weekday   = v_day.weekday
         AND ba.enabled   = TRUE
       LIMIT 1;
      IF FOUND THEN
        SELECT * INTO v_start_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ba.start_time, p_tz);
        SELECT * INTO v_end_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ba.end_time, p_tz);
        IF COALESCE(v_start_stat.dst_status, 'X') = 'OK'
           AND COALESCE(v_end_stat.dst_status, 'X') = 'OK' THEN
          day_date   := v_day.day_date;
          start_tstz := v_start_stat.utc_tstz;
          end_tstz   := v_end_stat.utc_tstz;
          RETURN NEXT;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN;
END;
$$;

ALTER FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Helper 4. scheduling_resource_has_overlap_confirmed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduling_resource_has_overlap_confirmed(
  p_tenant_id   UUID,
  p_resource_id UUID,
  p_start       TIMESTAMPTZ,
  p_end         TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.tenant_id = p_tenant_id
      AND b.resource_id = p_resource_id
      AND b.status = 'confirmed'
      AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
  );
$$;

ALTER FUNCTION public.scheduling_resource_has_overlap_confirmed(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_resource_has_overlap_confirmed(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_resource_has_overlap_confirmed(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Constants: lead time + horizon (singola authority FASE13B)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scheduling_constants()
RETURNS TABLE (
  lead_time_minutes  INT,
  booking_horizon_days INT,
  slot_step_minutes  INT
)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 60, 45, 15;
$$;

ALTER FUNCTION public.scheduling_constants() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_constants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_constants() TO anon, authenticated, service_role;
