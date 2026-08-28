-- ============================================================================
-- FASE 14D — Resource Weekly Schedule Operational Boundary
--
-- Obiettivi:
--   1. OPTIMISTIC CONCURRENCY: staff_resources.availability_version
--   2. OVERLAP DENY: resource_availability stessa weekday/resource no 09-13 + 12-15
--   3. PRECEDENZA ESATTA §5: effective = (RA OR BA) ∩ BA
--      → resource schedule NON PUO' estendere business oltre gli orari di
--        apertura; se RA 08-20 e BA 09-19 → effettiva 09-19
--   4. BACKWARD COMPAT §6: 0 righe RA per (R, WD) → FALLBACK BA invariato
--   5. BOOKING V3 step 6d stesso clipping (stessa semantica slot_ui == create_defense)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- T1. Colonna versione schedule per optimistic concurrency (§11)
-- ----------------------------------------------------------------------------
ALTER TABLE public.staff_resources
  ADD COLUMN IF NOT EXISTS availability_version INTEGER NOT NULL DEFAULT 0;

-- Indice utile per il controllo versione sulle scritture transazionali
CREATE INDEX IF NOT EXISTS staff_resources_av_version_idx
  ON public.staff_resources(tenant_id, availability_version);

-- ----------------------------------------------------------------------------
-- T2. Overlap DENY a livello DB: intervals stessa risorsa/weekday NON possono
--     avere intersezione. Usiamo BEFORE trigger insert/update cosi' supporta
--     RLS (EXCLUDE con GIST su timerange richiedeva btree_gist e piu'
--     complesso con tenant_id/resource_id/weekday + enabled=TRUE).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_resource_availability_overlap_deny()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.enabled = FALSE THEN
    RETURN NEW; -- righe disabilitate non concorrono a overlap calcolo
  END IF;

  SELECT COUNT(*)::INT INTO v_count
    FROM public.resource_availability ra
   WHERE ra.tenant_id   = NEW.tenant_id
     AND ra.resource_id = NEW.resource_id
     AND ra.weekday     = NEW.weekday
     AND ra.enabled     = TRUE
     AND ra.id          <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
     AND (
       -- Overlap half-open: [start_a,end_a) ∩ [start_b,end_b) <> 0
       NEW.start_time < ra.end_time AND NEW.end_time > ra.start_time
     );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Overlapping resource availability intervals for same resource/weekday'
      USING ERRCODE = 'SCHD01',
            HINT    = 'RWA-05 OVERLAPPING_INTERVAL';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS resource_availability_overlap_deny ON public.resource_availability;
CREATE TRIGGER resource_availability_overlap_deny
  BEFORE INSERT OR UPDATE OF start_time, end_time, enabled, weekday, resource_id, tenant_id
  ON public.resource_availability
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_resource_availability_overlap_deny();

-- ----------------------------------------------------------------------------
-- T3. Helper scheduling_resource_weekly_ranges
--     Regola esatta (§5 + §6 backward compat):
--       per ogni giorno:
--         has_ra_enabled(R, WD) = exists (1+ righe enabled RA per R/WD)
--         raw_candidate =
--           has_ra_enabled ? union(RA intervals)
--                           : union(BA intervals)
--         effective = raw_candidate ∩ union(BA intervals)   ← clipping §5
--       → se raw_candidate usa BA: effective = BA (nessun cambiamento)
--       → se raw_candidate usa RA: vengono tagliati fuori tutti i punti
--         che cadono fuori da BA (resource NON PUO' estendere business)
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
  v_has_any_ra INT;     -- 1 se la risorsa ha ALMENO 1 riga RA enabled in qualsiasi giorno (settimana "configurata esplicitamente")
  v_has_ra INT;        -- 1 se la risorsa ha righe RA enabled per QUESTO giorno specifico
  v_ra RECORD;
  v_ba RECORD;
  v_start_stat RECORD;
  v_end_stat RECORD;
BEGIN
  IF p_from_date > p_to_date THEN RETURN; END IF;

  -- --------------------------------------------------------------------------
  -- SEMANTICA §6 FALLBACK LEGACY (corretta per V1 BackwardCompat):
  --
  --   v_has_any_ra = EXISTS(1+ RA enabled su qualsivoglia giorno per R)
  --
  --   caso 1: v_has_any_ra = 0
  --           → MAI configurata.
  --           → eredita BA invariato (tutti i giorni in BA sono disponibili)
  --
  --   caso 2: v_has_any_ra = 1
  --           → L'operatore ha CONFIGURATO ESPLICITAMENTE qualche giorno.
  --           → Giorni CON RA → clip con BA.
  --           → Giorni SENZA RA → GIORNO OFF per questa risorsa.
  --           → Questo realizza la semantica "Mer OFF" di §1 (Maria OFF)
  -- --------------------------------------------------------------------------
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
    FROM generate_series(p_from_date, p_to_date, INTERVAL '1 day') g(d)
  LOOP
    IF v_has_any_ra = 0 THEN
      -- CASO 1: MAI configurata → FALLBACK BA invariato (backward compat)
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
      CONTINUE;
    END IF;

    -- CASO 2: risorsa esplicitamente gestita (v_has_any_ra > 0)
    -- Verifica: questo giorno specifico HA righe RA?
    SELECT COUNT(*)::INT INTO v_has_ra
      FROM public.resource_availability ra
     WHERE ra.tenant_id   = p_tenant_id
       AND ra.resource_id = p_resource_id
       AND ra.enabled     = TRUE
       AND ra.weekday     = v_day.weekday;

    IF v_has_ra = 0 THEN
      -- GIORNO OFF esplicito per la risorsa. Nessuno slot.
      CONTINUE;
    END IF;

    -- Esistono righe RA per il giorno → clip con BA
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
  END LOOP;

  RETURN;
END; $$;

ALTER FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduling_resource_weekly_ranges(UUID, UUID, DATE, DATE, TEXT)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- T4. Stesso clipping BA ∩ RA dentro public_booking_create_v3 (step 6d)
--     per GARANTIRE la stessa semantica quando un malintenzionato bypassa la
--     UI slot e chiama direttamente booking RPC (§16 defense).
--
-- Ridefiniamo public_booking_create_v3 IN TOTO riprendendo esattamente la
-- FASE13E1 definition, cambiando SOLO il blocco DECLARE step 6d come indicato.
-- ----------------------------------------------------------------------------
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

    -- 6d FASE14D: SAME PRECEDENCE as scheduling_resource_weekly_ranges.
    --    SEMANTICA §6 FALLBACK LEGACY (identica all'helper per slot engine):
    --      v_has_any_ra = EXISTS(1+ RA enabled qualsiasi giorno per R)
    --      if v_has_any_ra = 0 → eredita BA invariato (backward compat)
    --      if v_has_any_ra = 1 →
    --         giorno specifico ha RA? → in_ra_clipped_within_ba
    --         giorno specifico NO RA? → GIORNO OFF per questa risorsa
    --    (bookings bypass slot UI: stessa identica semantica)
    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_range BOOLEAN := FALSE;
      v_has_any_ra INT;
      v_has_ra_wd INT;
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

      IF v_has_any_ra = 0 THEN
        -- MAI configurata → eredita BA invariato
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
           WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
             AND ba.weekday = v_wd AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_range;
      ELSE
        -- Risorsa esplicitamente configurata. Questo giorno specifico ha RA?
        SELECT COUNT(*)::INT INTO v_has_ra_wd
          FROM public.resource_availability ra
         WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
           AND ra.weekday = v_wd;

        IF v_has_ra_wd = 0 THEN
          -- GIORNO OFF esplicito → NON in range per questa risorsa.
          v_in_range := FALSE;
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

-- ----------------------------------------------------------------------------
-- T5. Apply migration also for dashboard manual create + reschedule schedule
--     check? Teniamo per ora solo slot+booking create (coperti dal 13D1).
--     Sezione lasciata vuota per future estensioni.
-- ----------------------------------------------------------------------------
