-- ============================================================================
-- FASE 13E1 — Operator Time-Off Trusted Boundary + Scheduling Lock Contract
--
-- Append-only. NO edits FASE1..13D frozen.
--
-- Target:
--  1. Deterministico lock di granularità RISORSA (pg_advisory_xact_lock)
--     condiviso tra:
--       • public_booking_create_v3
--       • dashboard_booking_manual_create
--       • dashboard_booking_reschedule
--       • dashboard_resource_time_off_create
--     Stesso ordine di acquisizione: hash(tenant_id, resource_id).
--     Per ANY resource: lock deterministicamente in ordine sorted ASC su TUTTE
--     le candidate prima del try-loop cosi deadlock-free.
--  2. dashboard_resource_time_off_preview  — solo owner/manager, NO PII clienti
--  3. dashboard_resource_time_off_create   — recheck conflict + stale guard
--  4. dashboard_resource_time_off_delete   — cross-tenant deny + audit atomico
--  5. Audit resource_time_off_created/deleted (whitelist gia' FASE13D1 r82-84)
--  6. Preserve bookings SEMPRE, NO auto-cancel, conflict_count final source.
--
-- Failure codes stabili (via ERRCODE custom):
--   VE301 AUTHZ_DENIED        VE302 RESOURCE_NOT_FOUND
--   VE303 INVALID_INTERVAL    VE304 RANGE_TOO_LARGE
--   VE305 CONFLICT_PREVIEW_STALE VE306 TIME_OFF_NOT_FOUND
--   VE307 CROSS_TENANT_DENIED VE308 VALIDATION_ERROR
--   VE309 INTERNAL_ERROR      VE310 AUDIT_WRITE_FAILED
-- ============================================================================
SET search_path TO public;

-- ============================================================================
-- 0. Custom ERRCODE mapping via stable exception. Functions catch by SQLSTATE.
-- ============================================================================

-- ============================================================================
-- 1. SHARED LOCK HELPER — scheduling_lock_resource
--    NON grant a PUBLIC/authenticated. Eseguibile solo da SEC DEFINER
--    owner=postgres. Interno. Deterministico hash(tenant_id, resource_id).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.scheduling_lock_resource(
  p_tenant_id UUID,
  p_resource_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bucket CONSTANT INT := 131;
  v_key    BIGINT;
BEGIN
  IF p_tenant_id IS NULL OR p_resource_id IS NULL THEN
    RAISE EXCEPTION 'scheduling_lock_resource NULL args' USING errcode = 'VE309';
  END IF;
  -- 64-bit: mix hash(tenant) + hash(resource) + bucket, singola chiave BIGINT.
  -- Firma pg_advisory_xact_lock(bigint) — standard.
  v_key :=
      (BIGINT '1' << 31) * (ABS(HASHTEXT(p_tenant_id::TEXT)) % 2147483647)::BIGINT
    + ((ABS(HASHTEXT(p_resource_id::TEXT)) % 1073741823)::BIGINT * 1009)
    + v_bucket::BIGINT;
  PERFORM pg_advisory_xact_lock(v_key);
END;
$$;

ALTER FUNCTION public.scheduling_lock_resource(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_lock_resource(UUID, UUID) FROM PUBLIC;
-- NO grants authenticated/service_role. Solo funzioni SEC DEFINER postgres la chiamano.

-- Batch helper: lock lista resources in ordine deterministico (sort res ASC).
-- Per ANY resource loops public/manual create: lock prima TUTTE candidate sorted.
CREATE OR REPLACE FUNCTION public.scheduling_lock_resources_sorted(
  p_tenant_id UUID,
  p_resource_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN; END IF;
  IF p_resource_ids IS NULL OR array_length(p_resource_ids, 1) = 0 THEN RETURN; END IF;
  FOR v_id IN
    SELECT DISTINCT unnest(p_resource_ids) AS rid ORDER BY rid ASC
  LOOP
    PERFORM public.scheduling_lock_resource(p_tenant_id, v_id);
  END LOOP;
END;
$$;
ALTER FUNCTION public.scheduling_lock_resources_sorted(UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_lock_resources_sorted(UUID, UUID[]) FROM PUBLIC;

-- ============================================================================
-- 2. RPC: dashboard_resource_time_off_preview
--    Owner/Manager same tenant. Output PII-free (solo booking/service ids +
--    times, nomi servizi).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dashboard_resource_time_off_preview(
  p_resource_id UUID,
  p_starts_at   TIMESTAMPTZ,
  p_ends_at     TIMESTAMPTZ
)
RETURNS TABLE (
  code         TEXT,
  message      TEXT,
  booking_id   UUID,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  service_id   UUID,
  service_name TEXT,
  resource_id  UUID,
  status       TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_uid UUID := auth.uid();
  v_tenant_id UUID;
  v_role      TEXT;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id := NULL; starts_at := NULL; ends_at := NULL;
  service_id := NULL; service_name := NULL; resource_id := NULL; status := NULL;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'autenticazione richiesta';
    RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_memberships tm
   WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    code := 'AUTHZ_DENIED'; message := 'membership inesistente';
    RETURN NEXT; RETURN;
  END IF;

  IF NOT public.has_tenant_role(v_tenant_id, ARRAY['owner','manager']) THEN
    code := 'AUTHZ_DENIED'; message := 'ruolo insufficiente';
    RETURN NEXT; RETURN;
  END IF;

  -- Cross-tenant resource check
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_resources sr
     WHERE sr.id = p_resource_id AND sr.tenant_id = v_tenant_id
  ) THEN
    code := 'RESOURCE_NOT_FOUND'; message := 'operatore inesistente';
    RETURN NEXT; RETURN;
  END IF;

  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_starts_at >= p_ends_at THEN
    code := 'INVALID_INTERVAL'; message := 'intervallo non valido';
    RETURN NEXT; RETURN;
  END IF;

  IF (p_ends_at - p_starts_at) > INTERVAL '366 days' THEN
    code := 'RANGE_TOO_LARGE'; message := 'massimo 366 giorni';
    RETURN NEXT; RETURN;
  END IF;

  -- Preview (non lockiamo in preview, solo in create).
  code := 'OK'; message := 'ok';
  RETURN QUERY
  SELECT
    'OK'::TEXT,
    'ok'::TEXT,
    b.id,
    b.starts_at,
    b.ends_at,
    b.service_id,
    s.name,
    b.resource_id,
    b.status
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id AND s.tenant_id = v_tenant_id
  WHERE b.tenant_id = v_tenant_id
    AND b.resource_id = p_resource_id
    AND b.status = 'confirmed'
    AND tstzrange(b.starts_at, b.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ORDER BY b.starts_at ASC;

  -- Se 0 righe il RETURN QUERY sopra e' vuoto: aggiungi riga sentinella OK
  IF NOT FOUND THEN
    RETURN NEXT;
  END IF;
END;
$$;

ALTER FUNCTION public.dashboard_resource_time_off_preview(UUID,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_resource_time_off_preview(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_preview(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_preview(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_preview(UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO anon;

-- ============================================================================
-- 3. RPC: dashboard_resource_time_off_create
--    Lock scheduling_lock_resource, RI-VERIFICA conflitti dentro la xact dopo
--    lock. Se p_expected_conflict_count != NULL e differisce → VE305.
--    NO auto-cancel bookings. Conflict_count = source of truth.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dashboard_resource_time_off_create(
  p_resource_id             UUID,
  p_type                    TEXT,
  p_starts_at               TIMESTAMPTZ,
  p_ends_at                 TIMESTAMPTZ,
  p_title                   TEXT DEFAULT NULL,
  p_expected_conflict_count INTEGER DEFAULT NULL
)
RETURNS TABLE (
  code           TEXT,
  message        TEXT,
  time_off_id    UUID,
  conflict_count INTEGER,
  resource_id    UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_uid  CONSTANT UUID := auth.uid();
  v_tenant_id  UUID;
  v_tz         TEXT;
  v_actor_role TEXT;
  v_count      INT;
  v_new_id     UUID;
  v_allowed_types CONSTANT TEXT[] := ARRAY['vacation','sick','leave','training','custom_block'];
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_actor_uid IS NULL THEN
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'autenticazione richiesta'::TEXT, NULL::UUID, 0::INT, NULL::UUID;
    RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone INTO v_tenant_id, v_tz
    FROM public.tenant_memberships tm
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
   WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'membership inesistente'::TEXT, NULL::UUID, 0::INT, NULL::UUID;
    RETURN;
  END IF;

  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN
    v_actor_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN
    v_actor_role := 'manager';
  ELSE
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'ruolo insufficiente'::TEXT, NULL::UUID, 0::INT, NULL::UUID;
    RETURN;
  END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  IF p_resource_id IS NULL OR p_type IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL THEN
    RETURN QUERY SELECT 'VALIDATION_ERROR'::TEXT, 'dati obbligatori mancanti'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  IF NOT (p_type = ANY(v_allowed_types)) THEN
    RETURN QUERY SELECT 'VALIDATION_ERROR'::TEXT, 'tipo non valido'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  IF p_title IS NOT NULL AND (BTRIM(p_title) = '' OR CHAR_LENGTH(BTRIM(p_title)) > 160) THEN
    RETURN QUERY SELECT 'VALIDATION_ERROR'::TEXT, 'titolo 1-160'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  IF p_starts_at >= p_ends_at THEN
    RETURN QUERY SELECT 'INVALID_INTERVAL'::TEXT, 'intervallo non valido'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  IF (p_ends_at - p_starts_at) > INTERVAL '366 days' THEN
    RETURN QUERY SELECT 'RANGE_TOO_LARGE'::TEXT, 'massimo 366 giorni'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  -- Cross-tenant check risorsa.
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_resources sr
     WHERE sr.id = p_resource_id AND sr.tenant_id = v_tenant_id
  ) THEN
    RETURN QUERY SELECT 'RESOURCE_NOT_FOUND'::TEXT, 'operatore inesistente'::TEXT, NULL::UUID, 0::INT, p_resource_id;
    RETURN;
  END IF;

  -- =========================================================================
  -- LOCK RISORSA (stesso algoritmo dei booking RPC). Granularità resource.
  -- =========================================================================
  PERFORM public.scheduling_lock_resource(v_tenant_id, p_resource_id);

  -- RICALCOLA conflitti DOPO il lock (authority finale).
  SELECT COUNT(*) INTO STRICT v_count
    FROM public.bookings b
   WHERE b.tenant_id = v_tenant_id
     AND b.resource_id = p_resource_id
     AND b.status = 'confirmed'
     AND tstzrange(b.starts_at, b.ends_at, '[)')
         && tstzrange(p_starts_at, p_ends_at, '[)');

  -- Stale preview check
  IF p_expected_conflict_count IS NOT NULL AND p_expected_conflict_count <> v_count THEN
    RETURN QUERY SELECT 'CONFLICT_PREVIEW_STALE'::TEXT,
                        ('anteprima conflitti non piu attuale: trovati ' || v_count || ' attesi ' || p_expected_conflict_count)::TEXT,
                        NULL::UUID, v_count::INT, p_resource_id;
    RETURN;
  END IF;

  -- Insert time-off. Table CHECKs validano interval + window.
  INSERT INTO public.resource_time_off
    (tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
  VALUES (
    v_tenant_id, p_resource_id, p_type, NULLIF(BTRIM(p_title), ''), p_starts_at, p_ends_at
  ) RETURNING id INTO v_new_id;

  -- Audit: gestito da trigger AFTER INSERT FASE13B7 (resource_time_off_audit).
  -- Non duplicare qui: trigger = authority, PII scrub centralizzato.

  RETURN QUERY SELECT 'OK'::TEXT, 'inserito'::TEXT, v_new_id, v_count::INT, p_resource_id;
  RETURN;
END;
$$;

ALTER FUNCTION public.dashboard_resource_time_off_create(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_resource_time_off_create(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_create(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_create(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_create(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,INTEGER) TO anon;

-- ============================================================================
-- 4. RPC: dashboard_resource_time_off_delete
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dashboard_resource_time_off_delete(
  p_time_off_id UUID
)
RETURNS TABLE (
  code        TEXT,
  message     TEXT,
  time_off_id UUID,
  resource_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_uid CONSTANT UUID := auth.uid();
  v_tenant_id UUID;
  v_role      TEXT;
  v_row       public.resource_time_off%ROWTYPE;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_actor_uid IS NULL THEN
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'autenticazione richiesta'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_memberships tm
   WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'membership inesistente'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN
    v_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN
    v_role := 'manager';
  ELSE
    RETURN QUERY SELECT 'AUTHZ_DENIED'::TEXT, 'ruolo insufficiente'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  -- Lock resource per serializzare vs booking create concorrenti.
  BEGIN
    SELECT * INTO STRICT v_row
      FROM public.resource_time_off rto
     WHERE rto.id = p_time_off_id
       AND rto.tenant_id = v_tenant_id;
  EXCEPTION WHEN no_data_found THEN
    RETURN QUERY SELECT 'TIME_OFF_NOT_FOUND'::TEXT, 'time-off inesistente'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END;

  PERFORM public.scheduling_lock_resource(v_tenant_id, v_row.resource_id);

  DELETE FROM public.resource_time_off rto WHERE rto.id = v_row.id;

  -- Audit: gestito da trigger AFTER DELETE FASE13B7 (resource_time_off_audit).
  -- Non duplicare qui: trigger = authority, PII scrub centralizzato.

  RETURN QUERY SELECT 'OK'::TEXT, 'eliminato'::TEXT, v_row.id, v_row.resource_id;
  RETURN;
END;
$$;

ALTER FUNCTION public.dashboard_resource_time_off_delete(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_resource_time_off_delete(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_delete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_delete(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_resource_time_off_delete(UUID) TO anon;

-- ============================================================================
-- 5. PATCH booking RPCs con LOCK nello stesso ordine.
--    Firma invariata. Solo CREATE OR REPLACE append.
--
-- Ordine lock deterministico per ANY candidate resources:
--   1. Calcola array candidates UUID
--   2. scheduling_lock_resources_sorted(tenant, candidates)
--   3. Poi try loop + insert.
-- ============================================================================

-- 5A. dashboard_booking_manual_create — aggiungi lock dopo candidates NOT NULL check.
CREATE OR REPLACE FUNCTION public.dashboard_booking_manual_create(
  p_customer_id   UUID,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_service_id    UUID,
  p_starts_at     TIMESTAMPTZ,
  p_resource_slug TEXT DEFAULT 'any',
  p_notes         TEXT DEFAULT NULL
)
RETURNS TABLE (
  code          TEXT,
  message       TEXT,
  booking_id    UUID,
  revision      INTEGER,
  resource_id   UUID,
  resource_slug TEXT,
  starts_at_out TIMESTAMPTZ,
  ends_at_out   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_uid   UUID := auth.uid();
  v_actor_role  TEXT;
  v_tenant_id   UUID;
  v_tz          TEXT;
  v_const_lead  INT; v_const_horizon INT; v_const_step INT;
  v_duration    INT;
  v_end_at      TIMESTAMPTZ;
  v_cust_id     UUID;
  v_cust_name   TEXT;
  v_cust_email  TEXT;
  v_cust_phone  TEXT;
  v_resources   UUID[];
  v_slugs       TEXT[];
  v_i           INT;
  v_picked      UUID;
  v_picked_slug TEXT;
  v_new_id      UUID;
  v_rev         INTEGER := 0;
  v_past_min    INTERVAL;
  v_now         TIMESTAMPTZ := NOW();
BEGIN
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id := NULL; revision := 0; resource_id := NULL; resource_slug := NULL;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required'; RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone INTO v_tenant_id, v_tz
    FROM public.tenant_memberships tm
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
   WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN code := 'AUTHZ_DENIED'; message := 'tenant membership not found'; RETURN NEXT; RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := NULL;
  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN v_actor_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN v_actor_role := 'manager';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['staff']) THEN v_actor_role := 'staff';
  END IF;
  IF v_actor_role IS NULL THEN code := 'AUTHZ_DENIED'; message := 'insufficient role'; RETURN NEXT; RETURN; END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days, s.slot_step_minutes
    INTO v_const_lead, v_const_horizon, v_const_step FROM public.scheduling_constants() s;

  IF p_starts_at < v_now THEN
    IF v_actor_role IN ('owner','manager') THEN NULL;
    ELSE
      v_past_min := (180::TEXT || ' minutes')::INTERVAL;
      IF (v_now - p_starts_at) > v_past_min THEN
        code := 'PAST_LIMIT_EXCEEDED'; message := 'staff walk-in oltre 180m vietato'; RETURN;
      END IF;
    END IF;
  END IF;

  SELECT s.duration_minutes INTO v_duration
    FROM public.services s
   WHERE s.id = p_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN
    code := 'SERVICE_NOT_FOUND'; message := 'service inesistente o inattivo'; RETURN NEXT; RETURN;
  END IF;
  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_starts_at > v_now THEN
    IF p_starts_at < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
      code := 'LEAD_TIME_MINIMUM'; message := 'tempo di preavviso non sufficiente'; RETURN NEXT; RETURN;
    END IF;
    IF p_starts_at > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
      code := 'MAX_ADVANCE_EXCEEDED'; message := 'data troppo in avanti'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.display_name, c.email, c.phone INTO v_cust_id, v_cust_name, v_cust_email, v_cust_phone
      FROM public.customers c WHERE c.id = p_customer_id AND c.tenant_id = v_tenant_id;
    IF NOT FOUND THEN code := 'CUSTOMER_NOT_FOUND'; message := 'cliente non appartiene al tenant'; RETURN NEXT; RETURN; END IF;
  ELSE
    v_cust_name := BTRIM(COALESCE(p_customer_name, ''));
    IF length(v_cust_name) = 0 OR length(v_cust_name) > 120 THEN
      code := 'VALIDATION_ERROR'; message := 'nome cliente obbligatorio max 120'; RETURN NEXT; RETURN;
    END IF;
    IF (p_customer_email IS NULL OR length(BTRIM(p_customer_email))=0)
       AND (p_customer_phone IS NULL OR length(BTRIM(p_customer_phone)) < 4) THEN
      code := 'VALIDATION_ERROR'; message := 'almeno email o telefono'; RETURN NEXT; RETURN;
    END IF;
    SELECT r.customer_id INTO v_cust_id
      FROM public.customer_upsert_for_public_booking(
        v_tenant_id, v_cust_name, NULLIF(BTRIM(p_customer_email),''), NULLIF(BTRIM(p_customer_phone),'')
      ) r;
    IF v_cust_id IS NULL THEN code := 'CUSTOMER_NOT_FOUND'; message := 'upsert cliente fallita'; RETURN NEXT; RETURN; END IF;
    SELECT c.display_name, c.email, c.phone INTO v_cust_name, v_cust_email, v_cust_phone
      FROM public.customers c WHERE c.id = v_cust_id;
  END IF;

  IF p_resource_slug IS NULL OR p_resource_slug = '' OR p_resource_slug = 'any' THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.active = TRUE AND sr.bookable = TRUE
       AND (
         NOT EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id)
         OR EXISTS (
           SELECT 1 FROM public.staff_resource_services srs
            WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
              AND srs.service_id = p_service_id AND srs.active = TRUE
         )
       );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug] INTO v_resources, v_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_resource_slug
       AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN code := 'RESOURCE_NOT_FOUND'; message := 'operatore inesistente'; RETURN NEXT; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id = v_resources[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = v_resources[1]
            AND srs.service_id = p_service_id AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'operatore non abilitato per servizio'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessun operatore disponibile'; RETURN NEXT; RETURN;
  END IF;

  -- =========================================================================
  -- [FASE13E1] DETERMINISTIC LOCK resources sorted ASC — deadlock-free.
  -- =========================================================================
  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, v_resources);

  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id
      AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(p_starts_at, v_end_at, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'attività chiusa'; RETURN NEXT; RETURN;
  END IF;

  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources, 1);
    v_picked := v_resources[v_i]; v_picked_slug := v_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
       WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
         AND tstzrange(rto.starts_at, rto.ends_at, '[)')
             && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_range BOOL := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day) WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT) END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
           AND ra.weekday = v_wd AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
           WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
             AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_range;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
         WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
           AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
           AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_range := EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
             AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
             AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                  AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
             AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_range THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'extra_open'
             AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                 @> tstzrange(p_starts_at, v_end_at, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_candidates;
        END IF;
      END IF;
    END;

    BEGIN
      PERFORM set_config('app.booking_write_trusted', 'true', true);
      INSERT INTO public.bookings (
        tenant_id, customer_id, service_id, resource_id,
        starts_at, ends_at, status, revision,
        customer_name, customer_email, customer_phone, notes,
        created_at, updated_at
      ) VALUES (
        v_tenant_id, v_cust_id, p_service_id, v_picked,
        p_starts_at, v_end_at, 'confirmed', 0,
        v_cust_name, v_cust_email, v_cust_phone, NULLIF(LEFT(BTRIM(p_notes), 500), ''),
        v_now, v_now
      ) RETURNING id INTO v_new_id;

      code := 'OK'; message := 'appuntamento creato';
      booking_id := v_new_id; revision := 0;
      resource_id := v_picked; resource_slug := v_picked_slug;
      starts_at_out := p_starts_at; ends_at_out := v_end_at;

      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        'manual_booking_created',
        'booking',
        v_new_id,
        jsonb_build_object(
          'service_id',       p_service_id::text,
          'resource_id',      v_picked::text,
          'starts_at',        p_starts_at::text,
          'ends_at',          v_end_at::text,
          'revision_before',  NULL,
          'revision_after',   0,
          'source',           'dashboard_manual'
        )
      );
      RETURN NEXT; RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'tutti gli operatori occupati';
  RETURN NEXT; RETURN;
END; $$;

ALTER FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO service_role;

-- 5B. dashboard_booking_reschedule — aggiungi lock dopo candidates (prima del try loop candidates).
CREATE OR REPLACE FUNCTION public.dashboard_booking_reschedule(
  p_booking_id          UUID,
  p_expected_revision   INTEGER,
  p_new_starts_at       TIMESTAMPTZ DEFAULT NULL,
  p_new_resource_slug   TEXT DEFAULT NULL,
  p_new_service_id      UUID DEFAULT NULL
)
RETURNS TABLE (
  code           TEXT,
  message        TEXT,
  booking_id_out UUID,
  revision_out   INTEGER,
  resource_id_out UUID,
  resource_slug_out TEXT,
  starts_at_out  TIMESTAMPTZ,
  ends_at_out    TIMESTAMPTZ,
  service_id_out UUID,
  changed_keys   TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_uid  UUID := auth.uid();
  v_actor_role TEXT;
  v_tenant_id  UUID;
  v_tz         TEXT;
  v_const_lead INT; v_const_horizon INT;
  v_b          public.bookings%ROWTYPE;
  v_new_start  TIMESTAMPTZ;
  v_new_end    TIMESTAMPTZ;
  v_new_svc    UUID;
  v_duration   INT;
  v_candidates UUID[]; v_cand_slugs TEXT[];
  v_i          INT;
  v_picked     UUID; v_picked_slug TEXT;
  v_changed    TEXT[] := ARRAY[]::TEXT[];
  v_audit_act  TEXT;
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id_out := NULL; revision_out := 0; resource_id_out := NULL; changed_keys := v_changed;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required'; RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone INTO v_tenant_id, v_tz
    FROM public.tenant_memberships tm
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
   WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN code := 'AUTHZ_DENIED'; message := 'membership'; RETURN NEXT; RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := public.member_role_for_tenant(v_tenant_id, v_actor_uid);
  IF v_actor_role NOT IN ('owner','manager') THEN
    code := 'AUTHZ_DENIED'; message := 'reschedule solo owner/manager'; RETURN NEXT; RETURN;
  END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days INTO v_const_lead, v_const_horizon
    FROM public.scheduling_constants() s;

  SELECT b.* INTO v_b FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN code := 'BOOKING_NOT_FOUND'; message := 'inesistente'; RETURN NEXT; RETURN; END IF;
  IF v_b.tenant_id <> v_tenant_id THEN code := 'CROSS_TENANT_DENIED'; message := 'cross-tenant'; RETURN NEXT; RETURN; END IF;
  IF v_b.status <> 'confirmed' THEN code := 'BOOKING_TERMINAL'; message := 'appuntamento terminale'; RETURN NEXT; RETURN; END IF;
  IF v_b.revision <> p_expected_revision THEN code := 'CONCURRENT_UPDATE'; message := 'revisione non corrisponde'; RETURN NEXT; RETURN; END IF;

  IF p_new_service_id IS NOT NULL AND p_new_service_id <> v_b.service_id THEN
    SELECT s.duration_minutes INTO v_duration FROM public.services s
     WHERE s.id = p_new_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
    IF NOT FOUND OR v_duration IS NULL THEN code := 'SERVICE_INACTIVE'; message := 'servizio inattivo o inesistente'; RETURN NEXT; RETURN; END IF;
    v_new_svc := p_new_service_id; v_changed := array_append(v_changed, 'service_id');
  ELSE
    SELECT s.duration_minutes INTO v_duration FROM public.services s WHERE s.id = v_b.service_id;
    v_new_svc := v_b.service_id;
  END IF;

  IF p_new_starts_at IS NOT NULL AND p_new_starts_at <> v_b.starts_at THEN
    v_new_start := p_new_starts_at;
    IF v_new_start > v_now THEN
      IF v_new_start < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
        code := 'LEAD_TIME_MINIMUM'; message := 'lead'; RETURN NEXT; RETURN;
      END IF;
      IF v_new_start > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
        code := 'MAX_ADVANCE_EXCEEDED'; message := 'horizon'; RETURN NEXT; RETURN;
      END IF;
    END IF;
    v_changed := array_append(v_changed, 'starts_at'); v_changed := array_append(v_changed, 'ends_at');
  ELSE
    v_new_start := v_b.starts_at;
  END IF;
  v_new_end := v_new_start + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_new_resource_slug IS NULL OR p_new_resource_slug = '' OR p_new_resource_slug = 'same' THEN
    v_candidates := ARRAY[v_b.resource_id];
    SELECT ARRAY[sr.slug] INTO v_cand_slugs FROM public.staff_resources sr WHERE sr.id = v_b.resource_id;
    IF v_cand_slugs IS NULL THEN code := 'RESOURCE_NOT_FOUND'; message := 'stessa risorsa non esiste'; RETURN NEXT; RETURN; END IF;
  ELSIF p_new_resource_slug = 'any' THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_candidates, v_cand_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.active = TRUE AND sr.bookable = TRUE
       AND (
         NOT EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=sr.id)
         OR EXISTS (
           SELECT 1 FROM public.staff_resource_services srs
            WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
              AND srs.service_id = v_new_svc AND srs.active = TRUE
         )
       );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug] INTO v_candidates, v_cand_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_new_resource_slug
       AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN code := 'RESOURCE_NOT_FOUND'; message := 'operatore specifico non trovato'; RETURN NEXT; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=v_candidates[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = v_candidates[1]
            AND srs.service_id = v_new_svc AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'non eligibile'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_candidates IS NULL OR array_length(v_candidates, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessuna risorsa'; RETURN NEXT; RETURN;
  END IF;

  -- [FASE13E1] Lock risorse in ordine deterministico
  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, v_candidates);

  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(v_new_start, v_new_end, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'chiusura'; RETURN NEXT; RETURN;
  END IF;

  v_i := 1;
  <<try_res>>
  LOOP
    EXIT try_res WHEN v_i > array_length(v_candidates, 1);
    v_picked := v_candidates[v_i]; v_picked_slug := v_cand_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
       WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
         AND tstzrange(rto.starts_at, rto.ends_at, '[)')
             && tstzrange(v_new_start, v_new_end, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_res;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_r BOOL := FALSE;
    BEGIN
      v_local_day := (v_new_start AT TIME ZONE v_tz)::DATE;
      v_local_st  := (v_new_start AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_new_end   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day) WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT) END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
           AND ra.weekday = v_wd AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_r;

      IF NOT v_in_r AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
           WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
             AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_r;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
         WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
           AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
           AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_r := EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
             AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
             AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                  AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
             AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_r THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'extra_open'
             AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                 @> tstzrange(v_new_start, v_new_end, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_res;
        END IF;
      END IF;
    END;

    IF v_picked <> v_b.resource_id THEN
      IF NOT ('resource_id' = ANY(v_changed)) THEN v_changed := array_append(v_changed, 'resource_id'); END IF;
    END IF;

    BEGIN
      PERFORM set_config('app.booking_write_trusted', 'true', true);
      UPDATE public.bookings b SET
        starts_at   = v_new_start,
        ends_at     = v_new_end,
        service_id  = v_new_svc,
        resource_id = v_picked,
        revision    = v_b.revision + 1,
        updated_at  = v_now
      WHERE b.id = v_b.id;

      code := 'OK'; message := 'appuntamento aggiornato';
      booking_id_out := v_b.id; revision_out := v_b.revision + 1;
      resource_id_out := v_picked; resource_slug_out := v_picked_slug;
      starts_at_out := v_new_start; ends_at_out := v_new_end;
      service_id_out := v_new_svc; changed_keys := v_changed;

      IF array_length(v_changed, 1) = 1 AND v_changed[1] = 'resource_id' THEN
        v_audit_act := 'booking_resource_assigned';
      ELSE
        v_audit_act := 'booking_rescheduled';
      END IF;

      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        v_audit_act,
        'booking',
        v_b.id,
        jsonb_build_object(
          'from_service_id',  v_b.service_id::text,
          'to_service_id',    v_new_svc::text,
          'from_resource_id', v_b.resource_id::text,
          'to_resource_id',   v_picked::text,
          'from_starts_at',   v_b.starts_at::text,
          'to_starts_at',     v_new_start::text,
          'from_ends_at',     v_b.ends_at::text,
          'to_ends_at',       v_new_end::text,
          'revision_before',  v_b.revision,
          'revision_after',   v_b.revision + 1,
          'source',           'dashboard_manual',
          'changed_keys',     to_jsonb(v_changed)
        )
      );
      RETURN NEXT; RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_res;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'nuovo slot occupato';
  RETURN NEXT; RETURN;
END; $$;

ALTER FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO service_role;

-- ============================================================================
-- 5C. PUBLIC BOOKING CREATE V3 — lock deterministicamente resources sorted.
--     Firma invariata.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.public_booking_create_v3(
  p_tenant_slug   TEXT,
  p_service_id    UUID,
  p_starts_at     TIMESTAMPTZ,
  p_resource_slug TEXT,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_notes         TEXT
)
RETURNS TABLE (
  booking_id    UUID,
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  status        TEXT,
  resource_id   UUID,
  resource_slug TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id   UUID;
  v_tz          TEXT;
  v_duration    INT;
  v_lead_min    INT;
  v_horizon_d   INT;
  v_end_at      TIMESTAMPTZ;
  v_cust_id     UUID;
  v_resources   UUID[];
  v_slugs       TEXT[];
  v_i           INT;
  v_picked      UUID;
  v_picked_slug TEXT;
  v_new_id      UUID;
BEGIN
  -- Constants
  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_lead_min, v_horizon_d
  FROM public.scheduling_constants() s;

  -- 1. Tenant
  SELECT t.id, bp.timezone INTO v_tenant_id, v_tz
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
   WHERE t.slug = p_tenant_slug AND t.published = TRUE AND t.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE='VLTN1'; END IF;

  -- 2. Service
  SELECT s.duration_minutes INTO v_duration
    FROM public.services s
   WHERE s.tenant_id = v_tenant_id AND s.id = p_service_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN RAISE EXCEPTION 'service invalid' USING ERRCODE='VLTN2'; END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  -- 3. Lead + horizon
  IF p_starts_at < CURRENT_TIMESTAMP + (v_lead_min::TEXT || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'past slot / lead time' USING ERRCODE='VLTN3';
  END IF;
  IF p_starts_at > CURRENT_TIMESTAMP + (v_horizon_d::TEXT || ' days')::INTERVAL THEN
    RAISE EXCEPTION 'too far in advance' USING ERRCODE='VLTN4';
  END IF;

  -- 4. Customer upsert
  SELECT r.customer_id INTO v_cust_id
    FROM public.customer_upsert_for_public_booking(
      v_tenant_id,
      COALESCE(BTRIM(p_customer_name), 'Cliente'),
      NULLIF(BTRIM(p_customer_email),''),
      NULLIF(BTRIM(p_customer_phone),'')
    ) r;

  IF v_cust_id IS NULL AND NULLIF(BTRIM(p_customer_email),'') IS NOT NULL THEN
    SELECT c.id INTO v_cust_id FROM public.customers c
     WHERE c.tenant_id = v_tenant_id
       AND c.email_normalized = LOWER(BTRIM(p_customer_email))
     LIMIT 1;
  END IF;

  -- 5. Candidates deterministic
  IF p_resource_slug = 'any' OR p_resource_slug IS NULL OR char_length(p_resource_slug)=0 THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.active=TRUE AND sr.bookable=TRUE
       AND (
         NOT EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id)
         OR EXISTS (
           SELECT 1 FROM public.staff_resource_services srs
            WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id AND srs.service_id = p_service_id AND srs.active = TRUE
         )
       );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug] INTO v_resources, v_slugs
      FROM public.staff_resources sr
     WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_resource_slug AND sr.active=TRUE AND sr.bookable=TRUE;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources,1) = 0 THEN
    RAISE EXCEPTION 'resource not eligible' USING ERRCODE='VLTN5';
  END IF;

  -- [FASE13E1] DETERMINISTIC LOCK resources sorted ASC (deadlock-free).
  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, v_resources);

  -- 6. Proviamo ogni candidate finché EXCLUDE non fallisce.
  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources,1);
    v_picked := v_resources[v_i]; v_picked_slug := v_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.business_schedule_exceptions bse
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type IN ('closure','slot_block')
        AND tstzrange(bse.starts_at, bse.ends_at, '[)')
            && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      RAISE EXCEPTION 'business closed' USING ERRCODE='VLTN6';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
       WHERE rto.tenant_id = v_tenant_id
         AND rto.resource_id = v_picked
         AND tstzrange(rto.starts_at, rto.ends_at, '[)')
             && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_range BOOLEAN := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;
      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
           AND ra.weekday = v_wd AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
           WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
             AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_range;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
         WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
           AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
           AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_range := EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
             AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
             AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                  AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
             AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_range THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'extra_open'
             AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                 @> tstzrange(p_starts_at, v_end_at, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_candidates;
        END IF;
      END IF;
    END;

    BEGIN
      INSERT INTO public.bookings(
        tenant_id, service_id, resource_id, starts_at, ends_at,
        status, customer_name, customer_email, customer_phone, notes,
        created_at, updated_at, customer_id, revision
      ) VALUES (
        v_tenant_id, p_service_id, v_picked, p_starts_at, v_end_at,
        'confirmed',
        COALESCE(BTRIM(p_customer_name),'Cliente'),
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),''),
        NULLIF(LEFT(BTRIM(p_notes), 2000), ''),
        NOW(), NOW(),
        v_cust_id, 0
      ) RETURNING id INTO v_new_id;

      booking_id    := v_new_id;
      start_at      := p_starts_at;
      end_at        := v_end_at;
      status        := 'confirmed';
      resource_id   := v_picked;
      resource_slug := v_picked_slug;

      -- Audit PII-free same pattern originario FASE9 V3
      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        'booking_v3_created',
        'booking',
        v_new_id,
        jsonb_build_object(
          'service_id',  p_service_id::text,
          'resource_id', v_picked::text,
          'starts_at',   p_starts_at::text,
          'ends_at',     v_end_at::text,
          'source',      'public_v3',
          'from_slug',   p_tenant_slug
        )
      );

      RETURN NEXT; RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END;
  END LOOP;

  RAISE EXCEPTION 'slot taken or unavailable' USING ERRCODE='VLTN7';
END; $$;

ALTER FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon;
