-- ============================================================================
-- FASE 14D.1 — Resource Availability overlap trigger: fix invalid SQLSTATE
--
-- Root cause (Classificazione A production defect):
--   migration #82 20260829000000_fase14d_resource_schedule_boundary.sql
--   usa ERRCODE = 'SCHD01' (6 caratteri). PostgreSQL ERRCODE / SQLSTATE
--   richiede 5 caratteri esatti. Risultato: codice 42704
--   "unrecognized exception condition SCHD01" invece di overlap deny.
--
-- Fix minimo append-only:
--   ERRCODE 'SCHD01'  ->  'SCHD1'
--   Semantica identica. Messaggio / HINT invariati.
--   Overlap RA stesso WD/resource/tenant rimane deterministic DENY.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_resource_availability_overlap_deny()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.enabled = FALSE THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
    FROM public.resource_availability ra
   WHERE ra.tenant_id   = NEW.tenant_id
     AND ra.resource_id = NEW.resource_id
     AND ra.weekday     = NEW.weekday
     AND ra.enabled     = TRUE
     AND ra.id          <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
     AND (
       NEW.start_time < ra.end_time AND NEW.end_time > ra.start_time
     )
     --
     -- Idempotenza ON CONFLICT DO NOTHING / DO UPDATE gestita dal
     -- constraint unique_row (tenant, resource, weekday, start_time, end_time).
     -- NON alziamo eccezione per righe ESATTAMENTE identiche (non overlap reale).
     AND NOT (ra.start_time = NEW.start_time AND ra.end_time = NEW.end_time);

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Overlapping resource availability intervals for same resource/weekday'
      USING ERRCODE = 'SCHD1',
            HINT    = 'RWA-05 OVERLAPPING_INTERVAL';
  END IF;

  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.trg_resource_availability_overlap_deny() IS
  'Append-only fix 84: SQLSTATE 5 chars (SCHD1) instead of invalid 6-char SCHD01, AND skip identical-ranges (ON CONFLICT idempotency preserved). Overlap DENY semantic preserved.';

-- ============================================================================
-- T3B (append-only 84): scheduling_resource_weekly_ranges discriminates
-- explicit-config (FASE14D saveWeekly bump version >0 = missing WD OFF)
-- vs legacy-partial (FASE13 manual insert = missing WD inherit BA).
--
-- Rule: IF availability_version > 0 AND ANY RA enabled exists
--         → FULL explicit mode: missing WD = OFF per resource
--       ELSE
--         → backward compat BA for all weekdays (backward compat FASE13)
-- ============================================================================

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
  v_resource_explicit  BOOL;  -- TRUE  = saveWeekly già usata (version > 0) → WD MANCANTE = OFF
                             -- FALSE = legacy (version 0)             → WD MANCANTE = BA
  v_has_any_ra BOOL;          -- TRUE se ANY WD ha righe RA enabled
  v_has_ra INT;               -- righe RA enabled per WD specifico
  v_ra RECORD;
  v_ba RECORD;
  v_start_stat RECORD;
  v_end_stat RECORD;
BEGIN
  IF p_from_date > p_to_date THEN RETURN; END IF;

  SELECT
    EXISTS(
      SELECT 1 FROM public.resource_availability ra
       WHERE ra.tenant_id   = p_tenant_id
         AND ra.resource_id = p_resource_id
         AND ra.enabled     = TRUE
    )
  INTO v_has_any_ra;

  SELECT COALESCE(
    (SELECT sr.availability_version
       FROM public.staff_resources sr
      WHERE sr.tenant_id = p_tenant_id AND sr.id = p_resource_id),
    0
  ) > 0
  INTO v_resource_explicit;

  FOR v_day IN
    SELECT d::DATE AS day_date,
           CASE WHEN EXTRACT(ISODOW FROM d) = 7 THEN 0
                ELSE CAST(EXTRACT(ISODOW FROM d) AS SMALLINT)
           END AS weekday
    FROM generate_series(p_from_date, p_to_date, INTERVAL '1 day') g(d)
  LOOP
    -- Per ogni giorno:
    --   has_ra_specifico  → clip RA ∩ BA (sempre, sia legacy che explicit)
    --   no has_ra_specifico AND has_any_ra:
    --       resource_explicit → GIORNO OFF
    --       else (legacy)    → eredita BA
    --   no has_ra_specifico AND no has_any_ra:
    --       eredita BA (backward compat risorsa MAI toccata)

    SELECT COUNT(*)::INT INTO v_has_ra
      FROM public.resource_availability ra
     WHERE ra.tenant_id   = p_tenant_id
       AND ra.resource_id = p_resource_id
       AND ra.enabled     = TRUE
       AND ra.weekday     = v_day.weekday;

    IF v_has_ra > 0 THEN
      -- RA rows esistono per WD: clip RA ∩ BA
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
          FROM public.scheduling_local_to_utc(v_day.day_date, v_ra.eff_end, p_tz);
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

    -- Nessun RA specifico per WD:
    IF v_has_any_ra AND v_resource_explicit THEN
      -- GIORNO OFF esplicito FASE14D saveWeekly (version bump)
      CONTINUE;
    END IF;

    -- Fallback BA (legacy OR risorsa MAI configurata)
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
        FROM public.scheduling_local_to_utc(v_day.day_date, v_ba.end_time, p_tz);
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

COMMENT ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) IS
  'Append-only #84: discriminates explicit-config (saveWeekly bump version >0 → missing WD OFF) vs legacy-partial (version 0 → missing WD inherit BA). Fixes backward compat with FASE13 manual RA inserts while preserving FASE14D Mer-OFF semantics.';

-- ============================================================================
-- T3C (append-only 84): public_booking_create_v3 inline scheduling logic
--     MUST mirror scheduling_resource_weekly_ranges discriminator.
--     Root cause: booking_v3 had its OWN COPY of the V1 broken logic
--     (has_any_ra>0 → missing WD OFF always) with NO availability_version
--     discriminator. Scheduling helper was fixed in T3B but booking_v3
--     copy/paste was stale → S13-28..30 legacy FASE13 Wednesday DENY.
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
  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_lead_min, v_horizon_d
  FROM public.scheduling_constants() s;

  SELECT t.id, bp.timezone INTO v_tenant_id, v_tz
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
   WHERE t.slug = p_tenant_slug AND t.published = TRUE AND t.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE='VLTN1'; END IF;

  SELECT s.duration_minutes INTO v_duration
    FROM public.services s
   WHERE s.tenant_id = v_tenant_id AND s.id = p_service_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN RAISE EXCEPTION 'service invalid' USING ERRCODE='VLTN2'; END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_starts_at < CURRENT_TIMESTAMP + (v_lead_min::TEXT || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'past slot / lead time' USING ERRCODE='VLTN3';
  END IF;
  IF p_starts_at > CURRENT_TIMESTAMP + (v_horizon_d::TEXT || ' days')::INTERVAL THEN
    RAISE EXCEPTION 'too far in advance' USING ERRCODE='VLTN4';
  END IF;

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

  PERFORM public.scheduling_lock_resources_sorted(v_tenant_id, v_resources);

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

    -- 6d FASE14D: SAME PRECEDENCE as scheduling_resource_weekly_ranges (T3B).
    --    Append-only fix 84: adds explicit vs legacy discriminator.
    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_range BOOLEAN := FALSE;
      v_has_any_ra INT;
      v_has_ra_wd INT;
      v_resource_explicit BOOL;  -- TRUE  = saveWeekly bumped version → missing WD OFF
                                 -- FALSE = legacy (version 0)    → missing WD BA fallback
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;

      SELECT COUNT(*)::INT INTO v_has_any_ra
        FROM public.resource_availability ra
       WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE;

      SELECT COALESCE(
        (SELECT sr.availability_version
           FROM public.staff_resources sr
          WHERE sr.tenant_id = v_tenant_id AND sr.id = v_picked),
        0
      ) > 0
      INTO v_resource_explicit;

      IF v_has_any_ra = 0 THEN
        -- MAI configurata → eredita BA invariato (backward compat)
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
           WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
             AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_range;
      ELSE
        -- Risorsa ha ALMENO 1 riga RA in qualsiasi WD.
        -- Modo scelto da discriminator: explicit (version>0) OR legacy partial (version=0)
        SELECT COUNT(*)::INT INTO v_has_ra_wd
          FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
           AND ra.weekday = v_wd;

        IF v_has_ra_wd = 0 THEN
          -- NESSUNA riga RA per questo WD specifico:
          IF v_resource_explicit THEN
            -- GIORNO OFF esplicito FASE14D
            v_in_range := FALSE;
          ELSE
            -- LEGACY FASE13: manca il WD ma è un inserimento parziale, NON OFF → eredita BA
            SELECT EXISTS (
              SELECT 1 FROM public.business_availability ba
               WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
                 AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
            ) INTO v_in_range;
          END IF;
        ELSE
          -- §5 CLIP: RA start/end deve essere CONTENUTO in qualche BA
          SELECT EXISTS (
            SELECT 1
            FROM public.resource_availability ra
            JOIN public.business_availability ba
              ON  ba.tenant_id = v_tenant_id
              AND ba.weekday   = v_wd
              AND ba.enabled   = TRUE
            WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
              AND ra.weekday = v_wd
              AND GREATEST(ra.start_time, ba.start_time) <= v_local_st
              AND LEAST(ra.end_time,    ba.end_time)    >= v_local_en
          ) INTO v_in_range;
        END IF;
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

COMMENT ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) IS
  'Append-only 84: inline scheduling range check now mirrors scheduling_resource_weekly_ranges discriminator (availability_version > 0 → explicit missing-WD OFF; version=0 → legacy BA fallback). Fixes FASE13 S13-28..30 Wednesday legacy bookings DENY false-positive.';
