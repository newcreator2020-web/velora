-- ============================================================================
-- FASE 13E1-B1 — FREEZE CONSISTENCY CLOSURE
--   Shared scheduling lock injection for booking write paths.
--
-- Contract frozen in 20260824180000_fase13e1_timeoff_operational_boundary.sql
-- lines 6-15 requires scheduling_lock_resource(tenant_id, resource_id) bucket 131
-- to be shared among:
--   • public_booking_create_v3
--   • dashboard_booking_manual_create  (13D1 wrote WITHOUT lock helper)
--   • dashboard_booking_reschedule    (13D1 wrote WITHOUT lock helper)
--   • dashboard_resource_time_off_create
--
-- Without the shared xact advisory lock, booking writers and time-off create
-- can both commit (because GiST EXCLUDE is only booking↔booking, not
-- booking↔timeoff) with time-off conflict_count=0 even though a confirmed
-- booking overlaps the time-off range.
--
-- This migration REPLACES (CREATE OR REPLACE) the two 13D1 functions with
-- identical bodies PLUS a single deterministic lock acquisition before the
-- availability/write loops run.
--
-- Append-only. NO edits previous migrations. NO schema table changes.
-- ============================================================================
SET search_path TO public;

-- ============================================================================
-- 1. dashboard_booking_manual_create — same body + lock all resource
--    candidates sorted (ANY = deadlock-free ordered locks).
-- ============================================================================
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

  -- ---- Actor + membership -------------------------------------------------
  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required';
    RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    code := 'AUTHZ_DENIED'; message := 'tenant membership not found';
    RETURN NEXT; RETURN;
  END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := NULL;
  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN v_actor_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN v_actor_role := 'manager';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['staff']) THEN v_actor_role := 'staff';
  END IF;
  IF v_actor_role IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'insufficient role';
    RETURN NEXT; RETURN;
  END IF;

  -- ---- Constants ----------------------------------------------------------
  SELECT s.lead_time_minutes, s.booking_horizon_days, s.slot_step_minutes
    INTO v_const_lead, v_const_horizon, v_const_step
  FROM public.scheduling_constants() s;

  -- ---- Walk-in policy / past ---------------------------------------------
  IF p_starts_at < v_now THEN
    IF v_actor_role IN ('owner','manager') THEN
      NULL;
    ELSE
      v_past_min := (180::TEXT || ' minutes')::INTERVAL;
      IF (v_now - p_starts_at) > v_past_min THEN
        code := 'PAST_LIMIT_EXCEEDED';
        message := 'staff walk-in oltre 180m vietato';
        RETURN;
      END IF;
    END IF;
  END IF;

  -- ---- Service + duration ------------------------------------------------
  SELECT s.duration_minutes
    INTO v_duration
  FROM public.services s
  WHERE s.id = p_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN
    code := 'SERVICE_NOT_FOUND'; message := 'service inesistente o inattivo';
    RETURN NEXT; RETURN;
  END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_starts_at > v_now THEN
    IF p_starts_at < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
      code := 'LEAD_TIME_MINIMUM'; message := 'tempo di preavviso non sufficiente';
      RETURN NEXT; RETURN;
    END IF;
    IF p_starts_at > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
      code := 'MAX_ADVANCE_EXCEEDED'; message := 'data troppo in avanti';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- ---- Resources candidates ANY o specific --------------------------------
  IF p_resource_slug IS NULL OR p_resource_slug = '' OR p_resource_slug = 'any' THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.active = TRUE AND sr.bookable = TRUE
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
        )
        OR EXISTS (
          SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id
            AND srs.resource_id = sr.id
            AND srs.service_id = p_service_id
            AND srs.active = TRUE
        )
      );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug]
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_resource_slug
      AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'operatore inesistente';
      RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id = v_resources[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id
           AND srs.resource_id = v_resources[1]
           AND srs.service_id = p_service_id
           AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'operatore non abilitato per servizio';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessun operatore disponibile';
    RETURN NEXT; RETURN;
  END IF;

  -- ==== FASE13E1-B1 INJECTION ==============================================
  -- Shared xact advisory lock bucket 131 sorted resource candidates.
  -- Serializes manual booking writes vs dashboard_resource_time_off_create
  -- AND vs concurrent dashboard_booking_manual_create (preventing customer
  -- upsert page-lock ↔ advisory-lock deadlock when 20x ANY race).
  --
  -- LOCK ORDERING GLOBAL (non negoziabile):
  --   1. xact advisory sorted resource locks (bucket 131)  -- DEADLOCK-FREE
  --   2. customer upsert / row locks / FOR UPDATE / GiST writes
  --
  -- Never hold any heavy page/row lock before step 1 completes.
  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, v_resources);
  -- ========================================================================

  -- ---- Customer authority  (runs AFTER advisory lock to avoid lock-invert)
  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.display_name, c.email, c.phone
      INTO v_cust_id, v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'cliente non appartiene al tenant';
      RETURN NEXT; RETURN;
    END IF;
  ELSE
    v_cust_name := BTRIM(COALESCE(p_customer_name, ''));
    IF length(v_cust_name) = 0 OR length(v_cust_name) > 120 THEN
      code := 'VALIDATION_ERROR'; message := 'nome cliente obbligatorio max 120';
      RETURN NEXT; RETURN;
    END IF;
    IF (p_customer_email IS NULL OR length(BTRIM(p_customer_email))=0)
       AND (p_customer_phone IS NULL OR length(BTRIM(p_customer_phone)) < 4) THEN
      code := 'VALIDATION_ERROR'; message := 'almeno email o telefono';
      RETURN NEXT; RETURN;
    END IF;
    SELECT r.customer_id INTO v_cust_id
      FROM public.customer_upsert_for_public_booking(
        v_tenant_id,
        v_cust_name,
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),'')
      ) r;
    IF v_cust_id IS NULL THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'upsert cliente fallita';
      RETURN NEXT; RETURN;
    END IF;
    SELECT c.display_name, c.email, c.phone
      INTO v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c WHERE c.id = v_cust_id;
  END IF;

  -- ---- Business closure / slot_block (nego globale per tutte le resource) -
  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id
      AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(p_starts_at, v_end_at, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'attività chiusa';
    RETURN NEXT; RETURN;
  END IF;

  -- ---- Per-candidate availability loop -----------------------------------
  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources, 1);
    v_picked := v_resources[v_i];
    v_picked_slug := v_slugs[v_i];

    -- Resource time-off → passa al prossimo.
    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
      WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
        AND tstzrange(rto.starts_at, rto.ends_at, '[)')
            && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT;
      v_in_range BOOL := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE
          AND ra.weekday = v_wd
          AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
            AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
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
          'service_id', p_service_id::text,
          'resource_id', v_picked::text,
          'starts_at', p_starts_at::text,
          'ends_at', v_end_at::text,
          'revision_before', NULL,
          'revision_after', 0,
          'source', 'dashboard_manual',
          'created_by_role', v_actor_role
        )
      );
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'tutti gli operatori occupati';
  RETURN NEXT;
  RETURN;
END; $$;

ALTER FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO service_role;


-- ============================================================================
-- 2. dashboard_booking_reschedule — same body + lock: old resource id + all
--    new resource candidates (sorted deadlock-free).
-- ============================================================================
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
  v_lock_ids   UUID[];
  v_i          INT;
  v_picked     UUID; v_picked_slug TEXT;
  v_changed    TEXT[] := ARRAY[]::TEXT[];
  v_audit_act  TEXT;
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id_out := NULL; revision_out := 0; resource_id_out := NULL; changed_keys := v_changed;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required';
    RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN code := 'AUTHZ_DENIED'; message := 'membership';
    RETURN NEXT; RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := public.member_role_for_tenant(v_tenant_id, v_actor_uid);
  IF v_actor_role NOT IN ('owner','manager') THEN
    code := 'AUTHZ_DENIED'; message := 'reschedule solo owner/manager';
    RETURN NEXT; RETURN;
  END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_const_lead, v_const_horizon
  FROM public.scheduling_constants() s;

  -- =========================================================================
  -- PHASE 1: PRE-FETCH booking data WITHOUT row lock.
  -- Lock ordering rule (GLOBAL): advisory locks FIRST, row locks AFTER.
  -- This prevents deadlocks vs dashboard_resource_time_off_create which
  -- takes advisory first, then SELECTS bookings.
  -- =========================================================================
  SELECT b.* INTO v_b FROM public.bookings b WHERE b.id = p_booking_id;
  IF NOT FOUND THEN
    code := 'BOOKING_NOT_FOUND'; message := 'inesistente';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.tenant_id <> v_tenant_id THEN
    code := 'CROSS_TENANT_DENIED'; message := 'cross-tenant';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.status <> 'confirmed' THEN
    code := 'BOOKING_TERMINAL'; message := 'appuntamento terminale';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.revision <> p_expected_revision THEN
    code := 'CONCURRENT_UPDATE'; message := 'revisione non corrisponde (pre-lock)';
    RETURN NEXT; RETURN;
  END IF;

  IF p_new_service_id IS NOT NULL AND p_new_service_id <> v_b.service_id THEN
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s
     WHERE s.id = p_new_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
    IF NOT FOUND OR v_duration IS NULL THEN
      code := 'SERVICE_INACTIVE'; message := 'servizio inattivo o inesistente';
      RETURN NEXT; RETURN;
    END IF;
    v_new_svc := p_new_service_id;
    v_changed := array_append(v_changed, 'service_id');
  ELSE
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s WHERE s.id = v_b.service_id;
    v_new_svc := v_b.service_id;
  END IF;

  IF p_new_starts_at IS NOT NULL AND p_new_starts_at <> v_b.starts_at THEN
    v_new_start := p_new_starts_at;
    IF v_new_start > v_now THEN
      IF v_new_start < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
        code := 'LEAD_TIME_MINIMUM'; message := 'lead';
        RETURN NEXT; RETURN;
      END IF;
      IF v_new_start > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
        code := 'MAX_ADVANCE_EXCEEDED'; message := 'horizon';
        RETURN NEXT; RETURN;
      END IF;
    END IF;
    v_changed := array_append(v_changed, 'starts_at');
    v_changed := array_append(v_changed, 'ends_at');
  ELSE
    v_new_start := v_b.starts_at;
  END IF;
  v_new_end := v_new_start + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_new_resource_slug IS NULL OR p_new_resource_slug = '' OR p_new_resource_slug = 'same' THEN
    v_candidates := ARRAY[v_b.resource_id];
    SELECT ARRAY[sr.slug] INTO v_cand_slugs
      FROM public.staff_resources sr WHERE sr.id = v_b.resource_id;
    IF v_cand_slugs IS NULL THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'stessa risorsa non esiste';
      RETURN NEXT; RETURN;
    END IF;
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
    SELECT ARRAY[sr.id], ARRAY[sr.slug]
      INTO v_candidates, v_cand_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_new_resource_slug
      AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'operatore specifico non trovato';
      RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=v_candidates[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = v_candidates[1]
           AND srs.service_id = v_new_svc AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'non eligibile';
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_candidates IS NULL OR array_length(v_candidates, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessuna risorsa';
    RETURN NEXT; RETURN;
  END IF;

  -- ==== FASE13E1-B1 INJECTION ==============================================
  -- advisory locks FIRST (before row-level FOR UPDATE).
  -- Lock original resource + all new candidates, sorted deadlock-free.
  SELECT ARRAY_AGG(DISTINCT rid ORDER BY rid ASC)
    INTO v_lock_ids
  FROM (
    SELECT v_b.resource_id AS rid
    UNION
    SELECT unnest(v_candidates) AS rid
  ) t;
  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, COALESCE(v_lock_ids, ARRAY[]::UUID[]));
  -- ========================================================================

  -- =========================================================================
  -- PHASE 2: RE-FETCH with FOR UPDATE now that advisory are held.
  -- Re-validate EVERYthing because booking state might have changed between
  -- the pre-fetch and the row lock acquisition.
  -- =========================================================================
  SELECT b.* INTO v_b FROM public.bookings b
  WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    code := 'BOOKING_NOT_FOUND'; message := 'inesistente dopo lock';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.tenant_id <> v_tenant_id THEN
    code := 'CROSS_TENANT_DENIED'; message := 'cross-tenant dopo lock';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.status <> 'confirmed' THEN
    code := 'BOOKING_TERMINAL'; message := 'appuntamento terminale dopo lock';
    RETURN NEXT; RETURN;
  END IF;

  IF v_b.revision <> p_expected_revision THEN
    code := 'CONCURRENT_UPDATE'; message := 'revisione non corrisponde';
    RETURN NEXT; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(v_new_start, v_new_end, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'chiusura';
    RETURN NEXT; RETURN;
  END IF;

  v_i := 1;
  <<try_resched_candidates>>
  LOOP
    EXIT try_resched_candidates WHEN v_i > array_length(v_candidates, 1);
    v_picked := v_candidates[v_i];
    v_picked_slug := v_cand_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
      WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
        AND tstzrange(rto.starts_at, rto.ends_at, '[)')
            && tstzrange(v_new_start, v_new_end, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_resched_candidates;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT;
      v_in_range BOOL := FALSE;
    BEGIN
      v_local_day := (v_new_start AT TIME ZONE v_tz)::DATE;
      v_local_st  := (v_new_start AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_new_end   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE
          AND ra.weekday = v_wd
          AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
            AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
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
                @> tstzrange(v_new_start, v_new_end, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_resched_candidates;
        END IF;
      END IF;
    END;

    IF v_picked <> v_b.resource_id THEN
      IF v_changed IS NULL OR NOT ('resource_id' = ANY(v_changed)) THEN
        v_changed := array_append(v_changed, 'resource_id');
      END IF;
    END IF;

    BEGIN
      PERFORM set_config('app.booking_write_trusted', 'true', true);

      UPDATE public.bookings SET
        starts_at = v_new_start,
        ends_at   = v_new_end,
        service_id = v_new_svc,
        resource_id = v_picked,
        revision  = revision + 1,
        updated_at = v_now
      WHERE id = p_booking_id
      RETURNING id, revision, resource_id INTO booking_id_out, revision_out, resource_id_out;

      code := 'OK'; message := 'appuntamento riprogrammato';
      resource_slug_out := v_picked_slug;
      starts_at_out := v_new_start;
      ends_at_out := v_new_end;
      service_id_out := v_new_svc;
      changed_keys := v_changed;
      v_audit_act := 'booking_rescheduled';

      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        v_audit_act,
        'booking',
        booking_id_out,
        jsonb_build_object(
          'service_id_before', v_b.service_id::text,
          'service_id_after',  v_new_svc::text,
          'resource_id_before', v_b.resource_id::text,
          'resource_id_after',  resource_id_out::text,
          'starts_at_before', v_b.starts_at::text,
          'starts_at_after',  v_new_start::text,
          'ends_at_before',   v_b.ends_at::text,
          'ends_at_after',    v_new_end::text,
          'revision_before',  p_expected_revision,
          'revision_after',   revision_out,
          'changed_keys',     to_jsonb(v_changed),
          'acted_by_role',    v_actor_role
        )
      );
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_resched_candidates;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'nessuna risorsa disponibile per nuovo orario';
  RETURN NEXT;
  RETURN;
END; $$;

ALTER FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO service_role;
