-- ============================================================================
-- FASE14D.2 — Resource Weekly Schedule RPC + Concurrency + Future Conflicts
--
-- Crea:
--   1. dashboard_save_resource_weekly_schedule()
--        - transazionale REPLACE ALL intervals per risorsa
--        - optimistic concurrency con staff_resources.availability_version
--        - lock advisory deterministico (deadlock-free su stessa risorsa)
--        - return conflicting_future_booking_count solo per preview §13
--   2. dashboard_get_resource_weekly_schedule()
--        - getter PII-free che restituisce intervals + version + inherit_business_weekdays (BITMASK 0..127)
--   3. dashboard_booking_manual_check_in_schedule_exists (opt-in: riutilizza lo stesso check di v3 in dashboard_booking_manual_create per mantenere allineato)
--
-- Audit usa trigger esistente trg_resource_availability_audit (action=resource_availability_changed)
--   quindi NON appendo nuova action alla whitelist CHECK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Save transactional week: atomic + stale version detection + advisory lock
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_save_resource_weekly_schedule(
  p_resource_id        UUID,
  p_expected_version   INTEGER,
  -- vettore parallelo di intervals:
  p_weekdays           SMALLINT[],   -- NULL allowed (0 elementi) = resource OFF sempre
  p_start_times        TIME[],
  p_end_times          TIME[],
  p_force_reset_all    BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  new_version                    INTEGER,
  inserted_count                 INTEGER,
  deleted_count                  INTEGER,
  conflicting_future_bookings_cnt INTEGER,
  changed_weekdays_bitmask       INTEGER,
  has_inherit_weekdays           BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_tenant_id UUID;
  v_actor_uid       UUID;
  v_resource_tenant UUID;
  v_link_ok         BOOLEAN;
  v_old_version     INTEGER;
  v_n               INTEGER;
  v_i               INTEGER;
  v_wd              SMALLINT;
  v_st              TIME;
  v_en              TIME;
  v_del_count       INTEGER;
  v_ins_count       INTEGER := 0;
  v_cur_wd_old      INT := 0;
  v_cur_wd_new      INT := 0;
  v_changed_mask    INTEGER := 0;
  v_wd_found        BOOLEAN;
  v_inherit         BOOLEAN := FALSE;
  v_conflicts       INTEGER := 0;
BEGIN
  -- Autorità: auth.uid() corrente + has_tenant_role('owner' o 'manager')
  v_actor_uid := auth.uid();
  IF v_actor_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='RWA41';
  END IF;

  -- 1) cross-boundary resource ownership via composite FK (fail-closed)
  SELECT sr.tenant_id INTO v_resource_tenant
    FROM public.staff_resources sr
   WHERE sr.id = p_resource_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resource not found' USING ERRCODE='RWA40';
  END IF;

  v_link_ok := public.has_tenant_role(v_resource_tenant, ARRAY['owner','manager']);
  IF NOT v_link_ok THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='RWA42';
  END IF;
  v_actor_tenant_id := v_resource_tenant;

  -- Validazione vettori paralleli
  v_n := COALESCE(array_length(p_weekdays, 1), 0);
  IF v_n <> COALESCE(array_length(p_start_times, 1), 0)
     OR v_n <> COALESCE(array_length(p_end_times, 1), 0) THEN
    RAISE EXCEPTION 'parallel array length mismatch' USING ERRCODE='RWA03';
  END IF;

  -- Validazione contenuto intervals
  FOR v_i IN 1..v_n LOOP
    v_wd := p_weekdays[v_i]; v_st := p_start_times[v_i]; v_en := p_end_times[v_i];
    IF v_wd IS NULL OR v_wd < 0 OR v_wd > 6 THEN
      RAISE EXCEPTION 'invalid weekday' USING ERRCODE='RWA01';
    END IF;
    IF v_st IS NULL OR v_en IS NULL THEN
      RAISE EXCEPTION 'invalid time' USING ERRCODE='RWA02';
    END IF;
    IF v_st >= v_en THEN
      RAISE EXCEPTION 'start must precede end' USING ERRCODE='RWA04';
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 2) ADVISORY LOCK deterministico sulla risorsa (stessa funzione di
  --    scheduling_lock_resource ma senza richiederla come RPC grant, integrazione
  --    interna: hash(tenant||resource) + bucket=133).
  --    Piu' semplice: riusiamo scheduling_lock_resource (SE ESISTE da FASE13E1)
  -- --------------------------------------------------------------------------
  BEGIN
    PERFORM public.scheduling_lock_resource(v_resource_tenant, p_resource_id);
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: pg_advisory_xact_lock diretto con bucket hash deterministico
    PERFORM pg_advisory_xact_lock(
      hashtext(v_resource_tenant::text)::bigint # 16777216,
      (hashtext(p_resource_id::text)::bigint # 133)
    );
  END;

  -- --------------------------------------------------------------------------
  -- 3) Version check optimistic (STALE WRITE §11 + §10 atomic whole week)
  -- --------------------------------------------------------------------------
  SELECT sr.availability_version INTO STRICT v_old_version
    FROM public.staff_resources sr
   WHERE sr.tenant_id = v_resource_tenant
     AND sr.id        = p_resource_id
     FOR UPDATE; -- row lock su staff_resources

  IF v_old_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'stale version; reload schedule before save' USING ERRCODE='RWA43';
  END IF;

  -- --------------------------------------------------------------------------
  -- 4) Calcolo changed_weekdays_bitmask (vecchio vs nuovo)
  -- --------------------------------------------------------------------------
  SELECT COALESCE(
    BIT_OR(1 << ra.weekday), 0
  )::INTEGER INTO v_cur_wd_old
    FROM public.resource_availability ra
   WHERE ra.tenant_id = v_resource_tenant
     AND ra.resource_id = p_resource_id
     AND ra.enabled = TRUE;

  -- Calcolo mask nuovo
  v_cur_wd_new := 0;
  FOR v_i IN 1..v_n LOOP
    v_cur_wd_new := v_cur_wd_new | (1 << p_weekdays[v_i]);
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 5) DELETE ALL existing (enabled or not) per risorsa se force_reset_all
  --    Altrimenti solo enabled; ma contratto §10 = tutta settimana atomica →
  --    sempre DELETE * e RE-INSERT vettore completo.
  -- --------------------------------------------------------------------------
  DELETE FROM public.resource_availability ra
   WHERE ra.tenant_id = v_resource_tenant
     AND ra.resource_id = p_resource_id;
  GET DIAGNOSTICS v_del_count := ROW_COUNT;

  -- --------------------------------------------------------------------------
  -- 6) INSERT vettore. Overlap trigger viene chiamato e nega con SCHD01/RWA-05.
  -- --------------------------------------------------------------------------
  FOR v_i IN 1..v_n LOOP
    INSERT INTO public.resource_availability(
      tenant_id, resource_id, weekday, enabled, start_time, end_time
    ) VALUES (
      v_resource_tenant,
      p_resource_id,
      p_weekdays[v_i],
      TRUE,
      p_start_times[v_i],
      p_end_times[v_i]
    ) ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO NOTHING;
    v_ins_count := v_ins_count + 1;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 7) has_inherit_weekdays? TRUE se c'e' almeno 1 weekday 0..6 che non ha
  --    rows per questa risorsa (→ FALLBACK §6 backward compat).
  -- --------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM generate_series(0,6) AS wd(w)
    LEFT JOIN public.resource_availability ra
      ON ra.tenant_id   = v_resource_tenant
      AND ra.resource_id = p_resource_id
      AND ra.enabled     = TRUE
      AND ra.weekday     = wd.w
    WHERE ra.id IS NULL
  ) INTO v_inherit;

  -- --------------------------------------------------------------------------
  -- 8) Bump version su staff_resources.updated_at + availability_version+1
  -- --------------------------------------------------------------------------
  UPDATE public.staff_resources sr
     SET availability_version = availability_version + 1,
         updated_at = NOW()
   WHERE sr.tenant_id = v_resource_tenant
     AND sr.id        = p_resource_id
  RETURNING availability_version INTO new_version;

  -- --------------------------------------------------------------------------
  -- 9) §13 + §12: Conta prenotazioni future EXISTING che cadono FUORI dal
  --    nuovo schedule. NON cancellate! solo count per UI.
  --    Per ogni confirmed booking futuro su questa risorsa:
  --    controlla che start/end locali siano dentro RA intervals clipped BA
  --    oppure dentro special_hours oppure extra_open CONTAINS.
  --    Se NON trova corrispondenza → conflitto operativo → ++
  -- --------------------------------------------------------------------------
  DECLARE
    v_tz        TEXT;
    v_booking   RECORD;
    v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd2 SMALLINT; v_ok BOOLEAN;
  BEGIN
    SELECT bp.timezone INTO v_tz
      FROM public.business_profiles bp
     WHERE bp.tenant_id = v_resource_tenant
     LIMIT 1;
    IF v_tz IS NULL THEN v_tz := 'Europe/Rome'; END IF;

    FOR v_booking IN
      SELECT b.id, b.starts_at, b.ends_at, b.status
        FROM public.bookings b
       WHERE b.tenant_id   = v_resource_tenant
         AND b.resource_id = p_resource_id
         AND b.status      = 'confirmed'
         AND b.ends_at     > CURRENT_TIMESTAMP
    LOOP
      v_local_day := (v_booking.starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (v_booking.starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_booking.ends_at   AT TIME ZONE v_tz)::TIME;
      v_wd2 := CASE EXTRACT(ISODOW FROM v_local_day)
                 WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT) END;
      v_ok := FALSE;

      -- Special hours first
      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
         WHERE bse.tenant_id = v_resource_tenant
           AND bse.exception_type = 'special_hours'
           AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
           AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
           AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
      ) THEN
        v_ok := TRUE;
      END IF;

      IF NOT v_ok THEN
        -- Check: new schedule (stesso calcolo step 6d booking_create_v3 FASE14D)
        -- SEMANTICA §6 FALLBACK LEGACY identica:
        --   v_has_any_ra = qualsivoglia giorno RA configurato per risorsa?
        --   0 → eredita BA invariato (backward compat)
        --   1 → wd specifico ha RA? (clip BA) altrimenti OFF → NON OK (conflitto)
        DECLARE
          v_has_any_ra INT;
          v_has_ra_wd INT;
        BEGIN
          SELECT COUNT(*)::INT INTO v_has_any_ra
            FROM public.resource_availability ra
           WHERE ra.tenant_id = v_resource_tenant AND ra.resource_id = p_resource_id
             AND ra.enabled = TRUE;

          IF v_has_any_ra = 0 THEN
            SELECT EXISTS (
              SELECT 1 FROM public.business_availability ba
               WHERE ba.tenant_id = v_resource_tenant AND ba.enabled = TRUE
                 AND ba.weekday = v_wd2 AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
            ) INTO v_ok;
          ELSE
            SELECT COUNT(*)::INT INTO v_has_ra_wd
              FROM public.resource_availability ra
             WHERE ra.tenant_id = v_resource_tenant AND ra.resource_id = p_resource_id
               AND ra.enabled = TRUE AND ra.weekday = v_wd2;

            IF v_has_ra_wd = 0 THEN
              -- Risorsa esplicitamente OFF questo giorno
              v_ok := FALSE;
            ELSE
              SELECT EXISTS (
                SELECT 1 FROM public.resource_availability ra
                JOIN public.business_availability ba
                  ON  ba.tenant_id = v_resource_tenant
                  AND ba.weekday   = v_wd2 AND ba.enabled = TRUE
                WHERE ra.tenant_id = v_resource_tenant AND ra.resource_id = p_resource_id
                  AND ra.enabled = TRUE AND ra.weekday = v_wd2
                  AND GREATEST(ra.start_time, ba.start_time) <= v_local_st
                  AND LEAST(ra.end_time,    ba.end_time)    >= v_local_en
              ) INTO v_ok;
            END IF;
          END IF;
        END;
      END IF;

      -- Extra_open last resort
      IF NOT v_ok THEN
        IF EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
           WHERE bse.tenant_id = v_resource_tenant
             AND bse.exception_type = 'extra_open'
             AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                 @> tstzrange(v_booking.starts_at, v_booking.ends_at, '[)')
        ) THEN v_ok := TRUE; END IF;
      END IF;

      IF NOT v_ok THEN v_conflicts := v_conflicts + 1; END IF;
    END LOOP;
  END;

  -- changed_weekdays = XOR old mask e new mask (0..127, 7 bits)
  v_changed_mask := (v_cur_wd_old # v_cur_wd_new) & 127;

  inserted_count                 := v_ins_count;
  deleted_count                  := v_del_count;
  conflicting_future_bookings_cnt := v_conflicts;
  changed_weekdays_bitmask       := v_changed_mask;
  has_inherit_weekdays           := v_inherit;
  -- audit gia' triggers after insert/delete per ogni riga (resource_availability_changed)
  RETURN NEXT;
  RETURN;
END; $$;

ALTER FUNCTION public.dashboard_save_resource_weekly_schedule(UUID,INTEGER,SMALLINT[],TIME[],TIME[],BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_save_resource_weekly_schedule(UUID,INTEGER,SMALLINT[],TIME[],TIME[],BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_save_resource_weekly_schedule(UUID,INTEGER,SMALLINT[],TIME[],TIME[],BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_save_resource_weekly_schedule(UUID,INTEGER,SMALLINT[],TIME[],TIME[],BOOLEAN) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Getter (read-only, authoritative, restituisce intervals + version + mask)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_get_resource_weekly_schedule(
  p_resource_id UUID
)
RETURNS TABLE (
  availability_version      INTEGER,
  resource_exists           BOOLEAN,
  authorized                BOOLEAN,
  intervals                 JSONB,
  inherit_weekdays_bitmask  INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tid       UUID;
  v_authorized BOOLEAN := FALSE;
  v_version   INTEGER;
  v_mask      INTEGER;
  v_intervals JSONB;
  v_exists    BOOLEAN := FALSE;
BEGIN
  -- Risoluzione
  SELECT sr.tenant_id, sr.availability_version INTO v_tid, v_version
    FROM public.staff_resources sr
   WHERE sr.id = p_resource_id;
  IF NOT FOUND THEN
    resource_exists := FALSE; authorized := FALSE;
    availability_version := 0; intervals := '[]'::jsonb; inherit_weekdays_bitmask := 0;
    RETURN NEXT; RETURN;
  END IF;
  v_exists := TRUE;

  IF v_uid IS NOT NULL THEN
    v_authorized := public.is_tenant_member(v_tid);
  END IF;

  IF NOT v_authorized THEN
    resource_exists := v_exists; authorized := FALSE;
    availability_version := COALESCE(v_version,0);
    intervals := '[]'::jsonb; inherit_weekdays_bitmask := 0;
    RETURN NEXT; RETURN;
  END IF;

  -- Intervals ordinate per weekday ASC, start_time ASC
  SELECT COALESCE(JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'weekday',    ra.weekday,
      'start_time', to_char(ra.start_time, 'HH24:MI'),
      'end_time',   to_char(ra.end_time,   'HH24:MI')
    ) ORDER BY ra.weekday ASC, ra.start_time ASC
  ), '[]'::jsonb) INTO v_intervals
    FROM public.resource_availability ra
   WHERE ra.tenant_id = v_tid
     AND ra.resource_id = p_resource_id
     AND ra.enabled = TRUE;

  -- Inherit mask: bit i=1 se weekday i NON ha righe RA enabled
  SELECT COALESCE(BIT_OR(CASE WHEN ra.id IS NULL THEN (1 << wd.w) ELSE 0 END), 0)::INTEGER
    INTO v_mask
    FROM generate_series(0,6) AS wd(w)
    LEFT JOIN public.resource_availability ra
      ON ra.tenant_id = v_tid
      AND ra.resource_id = p_resource_id
      AND ra.enabled = TRUE
      AND ra.weekday = wd.w;

  availability_version     := v_version;
  resource_exists          := v_exists;
  authorized               := TRUE;
  intervals                := v_intervals;
  inherit_weekdays_bitmask := v_mask;
  RETURN NEXT; RETURN;
END; $$;

ALTER FUNCTION public.dashboard_get_resource_weekly_schedule(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_get_resource_weekly_schedule(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_get_resource_weekly_schedule(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_get_resource_weekly_schedule(UUID) TO service_role;
