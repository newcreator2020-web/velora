-- --------------------------------------------------------------------------
-- FASE14D2 — FIX STABLE function result caching
-- Append-only migration #85. DO NOT EDIT 82/83 (frozen).
--
-- ROOT CAUSE:
--   PostgreSQL STABLE functions can return plan-cached results within the
--   same backend session when called via SELECT * FROM fn(params) with
--   identical arguments and transaction-scoped snapshot. When an RPC on a
--   different connection commits new resource_availability rows AFTER a
--   prior session-scoped call returned 0 rows with the same UUIDs/date
--   range, a subsequent SELECT * FROM scheduling_resource_weekly_ranges()
--   in the reused pg() backend still returned 0 rows (helper_n=0) even
--   though the raw JOIN on public.resource_availability / business_availability
--   produced exactly one clipped interval. This broke 7/37 DB tests.
--
-- FIX:
--   1. change STABLE -> VOLATILE so PostgreSQL never short-circuits calls
--   2. fully qualify pg_catalog.generate_series to remove any ambiguity
--      even with search_path = '' hardened (pg_catalog is implicitly first
--      anyway, but this keeps parity with hardening standards).
--
-- Semantics §6 fallback preserved exactly.
-- --------------------------------------------------------------------------

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
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  v_day RECORD;
  v_has_any_ra INT;
  v_has_ra INT;
  v_ra RECORD;
  v_ba RECORD;
  v_start_stat RECORD;
  v_end_stat RECORD;
BEGIN
  IF p_from_date > p_to_date THEN RETURN; END IF;

  SELECT COUNT(*)::INT INTO v_has_any_ra
    FROM public.resource_availability ra
   WHERE ra.tenant_id   = p_tenant_id
     AND ra.resource_id = p_resource_id
     AND ra.enabled     = TRUE;

  FOR v_day IN
    SELECT d::DATE AS day_date,
           CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0
                ELSE CAST(EXTRACT(ISODOW FROM d) AS SMALLINT)
           END AS weekday
    FROM pg_catalog.generate_series(p_from_date, p_to_date, INTERVAL '1 day') g(d)
  LOOP
    IF v_has_any_ra = 0 THEN
      FOR v_ba IN
        SELECT ba.start_time, ba.end_time
          FROM public.business_availability ba
         WHERE ba.tenant_id = p_tenant_id
           AND ba.weekday   = v_day.weekday
           AND ba.enabled   = TRUE
      LOOP
        SELECT * INTO v_start_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ba.start_time, p_tz);
        SELECT * INTO v_end_stat
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ba.end_time,   p_tz);
        IF COALESCE(v_start_stat.dst_status, 'X') = 'OK'
           AND COALESCE(v_end_stat.dst_status, 'X') = 'OK' THEN
          day_date   := v_day.day_date;
          start_tstz := v_start_stat.utc_tstz;
          end_tstz   := v_end_stat.utc_tstz;
          RETURN NEXT;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    SELECT COUNT(*)::INT INTO v_has_ra
      FROM public.resource_availability ra
     WHERE ra.tenant_id   = p_tenant_id
       AND ra.resource_id = p_resource_id
       AND ra.enabled     = TRUE
       AND ra.weekday     = v_day.weekday;

    IF v_has_ra = 0 THEN
      CONTINUE;
    END IF;

    FOR v_ra IN
      SELECT
        GREATEST(ra.start_time, ba.start_time) AS eff_start,
        LEAST(ra.end_time,    ba.end_time)    AS eff_end
      FROM public.resource_availability ra
      JOIN public.business_availability ba
        ON  ba.tenant_id = p_tenant_id
        AND ba.weekday   = v_day.weekday
        AND ba.enabled   = TRUE
      WHERE ra.tenant_id   = p_tenant_id
        AND ra.resource_id = p_resource_id
        AND ra.enabled     = TRUE
        AND ra.weekday     = v_day.weekday
        AND ra.start_time < ba.end_time
        AND ra.end_time   > ba.start_time
    LOOP
      IF v_ra.eff_start >= v_ra.eff_end THEN CONTINUE; END IF;
      SELECT * INTO v_start_stat
        FROM public.scheduling_local_to_utc(v_day.day_date, v_ra.eff_start, p_tz);
      SELECT * INTO v_end_stat
        FROM public.scheduling_local_to_utc(v_day.day_date, v_ra.eff_end,   p_tz);
      IF COALESCE(v_start_stat.dst_status, 'X') = 'OK'
         AND COALESCE(v_end_stat.dst_status, 'X') = 'OK' THEN
        day_date   := v_day.day_date;
        start_tstz := v_start_stat.utc_tstz;
        end_tstz   := v_end_stat.utc_tstz;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;

  RETURN;
END; $$;

ALTER FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT)
  TO anon, authenticated, service_role;
