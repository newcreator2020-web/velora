-- ============================================================================
-- FASE 13C1 — Dashboard Calendar Read Model RPC
--
-- Produzione: dashboard operativo /app/calendar.
-- READ-ONLY boundary. Nessun write. Nessun scheduling nuovo stato.
-- Source of truth: bookings, closures, exceptions, time-off.
--
-- Minimo ruolo: staff.
-- SECURITY DEFINER SET search_path = '' hardening per evitare RLS multipli join
--  ma tenant_id ricavato SOLAMENTE da auth.uid() → active membership.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dashboard_calendar_get_range(
  p_range_start  TIMESTAMPTZ,
  p_range_end    TIMESTAMPTZ,
  p_resource_ids UUID[] DEFAULT NULL,
  p_statuses     TEXT[] DEFAULT ARRAY['confirmed','completed','no_show']::TEXT[]
)
RETURNS TABLE (
  row_type                 TEXT,
  booking_id               UUID,
  starts_at                TIMESTAMPTZ,
  ends_at                  TIMESTAMPTZ,
  status                   TEXT,
  service_id               UUID,
  service_name             TEXT,
  service_duration_minutes INTEGER,
  resource_id              UUID,
  resource_display_name    TEXT,
  resource_color_hex       TEXT,
  customer_display_name    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid         UUID;
  v_tenant_id   UUID;
  v_role        TEXT;
  v_count       INTEGER;
  v_row_limit   CONSTANT INTEGER := 1500;
  v_status_whitelist CONSTANT TEXT[] := ARRAY['confirmed','completed','no_show','cancelled']::TEXT[];
BEGIN
  -- ==========================================================
  -- 1) Autenticazione + membership derivazione (NO client-tenant)
  -- ==========================================================
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHZ_DENIED' USING ERRCODE = '28000';
  END IF;

  SELECT m.tenant_id, m.role
    INTO STRICT v_tenant_id, v_role
  FROM public.tenant_memberships m
  WHERE m.user_id = v_uid
    AND m.status  = 'active'
  ORDER BY (CASE m.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'staff' THEN 3 ELSE 9 END)
  LIMIT 1;

  IF NOT FOUND OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AUTHZ_DENIED' USING ERRCODE = '28000';
  END IF;

  IF v_role NOT IN ('owner','manager','staff') THEN
    RAISE EXCEPTION 'AUTHZ_DENIED' USING ERRCODE = '28000';
  END IF;

  -- ==========================================================
  -- 2) Validazione range + window
  -- ==========================================================
  IF p_range_start IS NULL OR p_range_end IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE' USING ERRCODE = '22023';
  END IF;
  IF p_range_start >= p_range_end THEN
    RAISE EXCEPTION 'INVALID_DATE' USING ERRCODE = '22023';
  END IF;
  IF EXTRACT(EPOCH FROM (p_range_end - p_range_start)) > 14*86400 THEN
    RAISE EXCEPTION 'WINDOW_TOO_LARGE' USING ERRCODE = '22023';
  END IF;

  -- ==========================================================
  -- 3) Validazione statuses whitelist
  -- ==========================================================
  IF p_statuses IS NOT NULL AND array_length(p_statuses, 1) > 0 THEN
    IF NOT (p_statuses <@ v_status_whitelist) THEN
      RAISE EXCEPTION 'CALENDAR_QUERY_FAILED' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ==========================================================
  -- 4) Validazione resource_ids = TUTTI same tenant (eventuale)
  -- ==========================================================
  IF p_resource_ids IS NOT NULL AND array_length(p_resource_ids, 1) > 0 THEN
    SELECT COUNT(*) INTO STRICT v_count FROM unnest(p_resource_ids) id;
    PERFORM 1
    FROM public.staff_resources r
    WHERE r.tenant_id = v_tenant_id
      AND r.id = ANY (p_resource_ids);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = '02000';
    END IF;
    -- Conta: ogni resource_id fornito deve esistere nel tenant
    SELECT COUNT(DISTINCT r.id) INTO v_count
    FROM public.staff_resources r
    WHERE r.tenant_id = v_tenant_id
      AND r.id = ANY (p_resource_ids);
    IF v_count < (SELECT COUNT(DISTINCT id) FROM unnest(p_resource_ids) id) THEN
      RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = '02000';
    END IF;
  END IF;

  -- ==========================================================
  -- 5) Risultato composito 1: BOOKINGS
  --     Risultato aggregato insieme; verifica hard limit 1500.
  -- ==========================================================
  RETURN QUERY
  SELECT sub.row_type, sub.booking_id, sub.starts_at, sub.ends_at,
         sub.status, sub.service_id, sub.service_name,
         sub.service_duration_minutes, sub.resource_id,
         sub.resource_display_name, sub.resource_color_hex,
         sub.customer_display_name
  FROM (
    -- 5a) BOOKINGS
    SELECT
      'booking'::TEXT                                        AS row_type,
      b.id                                                    AS booking_id,
      b.starts_at,
      b.ends_at,
      b.status,
      s.id                                                    AS service_id,
      s.name                                                  AS service_name,
      s.duration_minutes                                      AS service_duration_minutes,
      r.id                                                    AS resource_id,
      r.display_name                                          AS resource_display_name,
      r.color_hex                                             AS resource_color_hex,
      b.customer_name                                         AS customer_display_name
    FROM public.bookings b
    LEFT JOIN public.services s
           ON s.tenant_id = b.tenant_id AND s.id = b.service_id
    LEFT JOIN public.staff_resources r
           ON r.tenant_id = b.tenant_id AND r.id = b.resource_id
    WHERE b.tenant_id = v_tenant_id
      AND tstzrange(b.starts_at, b.ends_at, '[)') &&
          tstzrange(p_range_start, p_range_end, '[)')
      AND (p_statuses IS NULL OR b.status = ANY (p_statuses))
      AND (p_resource_ids IS NULL OR array_length(p_resource_ids, 1) IS NULL OR b.resource_id = ANY (p_resource_ids))

    UNION ALL

    -- 5b) BUSINESS CLOSURE (type=closure)
    SELECT
      'business_closure'::TEXT AS row_type,
      NULL::UUID,
      e.starts_at               AS starts_at,
      e.ends_at                 AS ends_at,
      NULL::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::INTEGER,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT
    FROM public.business_schedule_exceptions e
    WHERE e.tenant_id = v_tenant_id
      AND e.exception_type = 'closure'
      AND tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_range_start, p_range_end, '[)')

    UNION ALL

    -- 5c) EXTRA_OPEN
    SELECT
      'extra_open'::TEXT       AS row_type,
      NULL::UUID,
      e.starts_at               AS starts_at,
      e.ends_at                 AS ends_at,
      NULL::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::INTEGER,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT
    FROM public.business_schedule_exceptions e
    WHERE e.tenant_id = v_tenant_id
      AND e.exception_type = 'extra_open'
      AND tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_range_start, p_range_end, '[)')

    UNION ALL

    -- 5d) REDUCED HOURS (mapped to exception_type='special_hours' — reduced_hours non esisteva nel dominio F13B)
    SELECT
      'reduced_hours'::TEXT    AS row_type,
      NULL::UUID,
      e.starts_at               AS starts_at,
      e.ends_at                 AS ends_at,
      NULL::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::INTEGER,
      NULL::UUID,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT
    FROM public.business_schedule_exceptions e
    WHERE e.tenant_id = v_tenant_id
      AND e.exception_type = 'special_hours'
      AND tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_range_start, p_range_end, '[)')

    UNION ALL

    -- 5e) RESOURCE TIME OFF (per-risorsa; filtrato se p_resource_ids filter)
    SELECT
      'resource_time_off'::TEXT AS row_type,
      NULL::UUID,
      t.starts_at                AS starts_at,
      t.ends_at                  AS ends_at,
      NULL::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::INTEGER,
      r.id                       AS resource_id,
      r.display_name             AS resource_display_name,
      r.color_hex                AS resource_color_hex,
      NULL::TEXT
    FROM public.resource_time_off t
    INNER JOIN public.staff_resources r
            ON r.tenant_id = t.tenant_id AND r.id = t.resource_id
    WHERE t.tenant_id = v_tenant_id
      AND tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_range_start, p_range_end, '[)')
      AND (p_resource_ids IS NULL OR array_length(p_resource_ids, 1) IS NULL OR t.resource_id = ANY (p_resource_ids))
  ) sub
  ORDER BY sub.starts_at, sub.resource_id NULLS LAST, sub.row_type;

  -- ==========================================================
  -- 6) Hard limit: mai oltre 1500 righe. Alza RESULT_TOO_LARGE.
  -- ==========================================================
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > v_row_limit THEN
    RAISE EXCEPTION 'RESULT_TOO_LARGE' USING ERRCODE = '54000';
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Rilancia codici stabili come eccezioni applicative.
  -- Il chiamante (route handler) mappa SQLSTATE → HTTP/JSON code.
  RAISE;
END;
$$;

-- ============================================================================
-- GRANTS — hardened
-- ============================================================================
REVOKE ALL ON FUNCTION public.dashboard_calendar_get_range(TIMESTAMPTZ,TIMESTAMPTZ,UUID[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_calendar_get_range(TIMESTAMPTZ,TIMESTAMPTZ,UUID[],TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_calendar_get_range(TIMESTAMPTZ,TIMESTAMPTZ,UUID[],TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_calendar_get_range(TIMESTAMPTZ,TIMESTAMPTZ,UUID[],TEXT[]) TO service_role;
-- service_role concesso SOLAMENTE per trusted test harness.
