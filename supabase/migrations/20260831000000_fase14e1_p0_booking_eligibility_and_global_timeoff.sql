-- ============================================================================
-- MIGRATION #87 (APPEND-ONLY) — FASE 14E1
-- DEFECT P0-001 + P0-002 permanent fix
-- ============================================================================
-- DEFECT P0-001 (slug-specific branch missing eligibility check):
--   When p_resource_slug is NOT 'any' (single specific operator slug), the
--   booking RPC returned the resource by slug WITHOUT verifying that the
--   resource is actually eligible to deliver the requested service via
--   staff_resource_services. An attacker who guessed a valid slug could
--   bypass service→resource eligibility and book any operator with any
--   service (security P0 IDOR-style privilege escalation on scheduling).
--
-- DEFECT P0-002 (resource time_off only checks the candidate resource):
--   Tenants can set global day-off on the non-bookable PRIMARY resource
--   (slug='principale' / bookable=FALSE). The previous loop only excluded
--   time_off rows where rto.resource_id = v_picked (the candidate human
--   resource). Global closure time-off was therefore ignored for ANY
--   candidate resource, allowing bookings on tenant-level closure days.
--
-- BOTH fixes are applied by REPLACING the PL/pgSQL body of
-- public_booking_create_v3 with a corrected deterministic body.
-- No schema changes to tables, no new FK constraints, no row drops →
-- purely behavioral change with full backward compatibility.
-- ============================================================================
-- #87 is CROSS-TENANT SAFE: all WHERE clauses always filter on
-- tenant_id. No operation ever touches rows from other tenants.
-- ============================================================================
-- Concurrency: the existing EXCLUDE GiST constraint on bookings still acts
-- as final authority; this patch only TIGHTENS the filters applied BEFORE
-- the insert attempt (fewer wasted loops, stronger invariants).
-- ============================================================================
-- SECURITY: SECURITY DEFINER with SET search_path = '' (unchanged contract).
-- GRANT: anon, authenticated, service_role (unchanged — matches #86).
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
  SELECT t.id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenants t
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
  WHERE t.slug = p_tenant_slug AND t.published = TRUE AND t.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE='VLTN1';
  END IF;

  -- 2. Service (must be active for the same tenant)
  SELECT s.duration_minutes
    INTO v_duration
  FROM public.services s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_service_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN
    RAISE EXCEPTION 'service invalid' USING ERRCODE='VLTN2';
  END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  -- 3. Lead + horizon
  IF p_starts_at < CURRENT_TIMESTAMP + (v_lead_min::TEXT || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'past slot / lead time' USING ERRCODE='VLTN3';
  END IF;
  IF p_starts_at > CURRENT_TIMESTAMP + (v_horizon_d::TEXT || ' days')::INTERVAL THEN
    RAISE EXCEPTION 'too far in advance' USING ERRCODE='VLTN4';
  END IF;

  -- 4. Customer upsert (idempotent, race-safe helper from FASE10)
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

  -- ==========================================================================
  -- 5. Candidates — P0-001 FIX (BOTH BRANCHES NOW VERIFY SRS ELIGIBILITY)
  -- ==========================================================================
  -- Invariante uniforme applicato a TUTTI i branch:
  --   una risorsa è candidata SOLAMENTE se
  --     (non esistono srs rows per essa → wildcard eligibility)
  --     OR
  --     (esiste una srs attiva per la coppia (risorsa, servizio)).
  --
  -- Questo elimina la divergenza di sicurezza tra branch 'any' e
  -- branch slug-specifico che permetteva bypass elegibilità.
  -- ==========================================================================
  IF p_resource_slug = 'any' OR p_resource_slug IS NULL OR char_length(p_resource_slug)=0 THEN
    -- BRANCH A — ANY resource (same semantic as #86, already correct)
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.active=TRUE AND sr.bookable=TRUE
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id
            AND srs.resource_id = sr.id
            AND srs.service_id  = p_service_id
            AND srs.active = TRUE
        )
      );
  ELSE
    -- BRANCH B — SINGLE SLUG SPECIFIC (P0-001 FIX: aggiunti srs check)
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id
      AND sr.slug = p_resource_slug
      AND sr.active=TRUE
      AND sr.bookable=TRUE
      AND (
        -- P0-001 FIX: same eligibility invariant as ANY branch
        NOT EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id
            AND srs.resource_id = sr.id
            AND srs.service_id  = p_service_id
            AND srs.active = TRUE
        )
      );
  END IF;

  IF v_resources IS NULL OR array_length(v_resources,1) = 0 THEN
    RAISE EXCEPTION 'resource not eligible' USING ERRCODE='VLTN5';
  END IF;

  -- 6. Proviamo ogni candidate finché EXCLUDE non fallisce.
  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources,1);
    v_picked := v_resources[v_i];
    v_picked_slug := v_slugs[v_i];

    -- 6b. Closure/slot_block negato (business-level)
    IF EXISTS (
      SELECT 1
      FROM public.business_schedule_exceptions bse
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type IN ('closure','slot_block')
        AND tstzrange(bse.starts_at, bse.ends_at, '[)')
            && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      RAISE EXCEPTION 'business closed' USING ERRCODE='VLTN6';
    END IF;

    -- ========================================================================
    -- 6c. Resource time_off — P0-002 FIX
    -- ========================================================================
    -- PRIMA: controllavamo solo rto.resource_id = v_picked (la singola
    --        risorsa umana), perdendo i "day off globali" inseriti sulla
    --        risorsa bookable=false slug='principale'.
    -- DOPO:  escludiamo il candidate se esiste time_off su
    --        (a) la risorsa candidata v_picked (come prima)
    --        - OPPURE -
    --        (b) QUALSIASI altra risorsa NON bookable dello stesso tenant
    --            (cioè le risorse "principale/closure" che rappresentano
    --             chiusure globali; bookable=FALSE è l'invariante semantico).
    -- ========================================================================
    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
       WHERE rto.tenant_id = v_tenant_id
         AND (
           -- Case (a): time-off esplicito della risorsa candidata
           rto.resource_id = v_picked
           -- Case (b): time-off GLOBALE ereditato da risorsa non-bookable
           -- (es. "principale" / day-off di chiusura tenant-wide)
           OR EXISTS (
             SELECT 1 FROM public.staff_resources sr_g
              WHERE sr_g.tenant_id = v_tenant_id
                AND sr_g.id = rto.resource_id
                AND sr_g.bookable = FALSE
                AND sr_g.active = TRUE
           )
         )
         AND tstzrange(rto.starts_at, rto.ends_at, '[)')
             && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1;
      CONTINUE try_candidates;
    END IF;

    -- 6d. Resource weekly hours (inherit semantics preserved from #86)
    DECLARE
      v_local_day DATE;
      v_local_st TIME;
      v_local_en TIME;
      v_wd SMALLINT;
      v_in_range BOOLEAN := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;

      SELECT EXISTS (
        SELECT 1
        FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked
          AND ra.enabled = TRUE
          AND ra.weekday = v_wd
          AND ra.start_time <= v_local_st
          AND ra.end_time   >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1
        FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked
          AND ra.enabled = TRUE
          AND ra.weekday = v_wd
      ) THEN
        -- Nessuna RA per questo specifico weekday → fallback business_availability
        SELECT EXISTS (
          SELECT 1
          FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id
            AND ba.enabled = TRUE
            AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st
            AND ba.end_time   >= v_local_en
        ) INTO v_in_range;
      END IF;

      -- Special hours? sovrascrive
      IF EXISTS (
        SELECT 1
        FROM public.business_schedule_exceptions bse
        WHERE bse.tenant_id = v_tenant_id
          AND bse.exception_type = 'special_hours'
          AND bse.start_time IS NOT NULL
          AND bse.end_time IS NOT NULL
          AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                               AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_range := EXISTS (
          SELECT 1
          FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id
            AND bse.exception_type = 'special_hours'
            AND bse.start_time IS NOT NULL
            AND bse.end_time IS NOT NULL
            AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                 AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
            AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_range THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id
            AND bse.exception_type = 'extra_open'
            AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                @> tstzrange(p_starts_at, v_end_at, '[)')
        ) THEN
          v_i := v_i + 1;
          CONTINUE try_candidates;
        END IF;
      END IF;
    END;

    -- 6e. Tentativo INSERT (EXCLUDE GiST è la autorità finale).
    BEGIN
      INSERT INTO public.bookings(
        tenant_id, service_id, resource_id, starts_at, ends_at,
        status, customer_name, customer_email, customer_phone, notes,
        customer_id, created_at, updated_at
      ) VALUES (
        v_tenant_id, p_service_id, v_picked, p_starts_at, v_end_at,
        'confirmed',
        COALESCE(BTRIM(p_customer_name),'Cliente'),
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),''),
        NULLIF(LEFT(BTRIM(p_notes), 2000), ''),
        v_cust_id,
        NOW(), NOW()
      ) RETURNING id INTO v_new_id;

      booking_id    := v_new_id;
      start_at      := p_starts_at;
      end_at        := v_end_at;
      status        := 'confirmed';
      resource_id   := v_picked;
      resource_slug := v_picked_slug;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1;
      CONTINUE try_candidates;
    END;
  END LOOP;

  RAISE EXCEPTION 'slot taken or unavailable' USING ERRCODE='VLTN7';
END;
$$;

ALTER FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- REGRESSION CONTRACT EVIDENCE (#87 append-only frozen)
--
-- Regole P0 fissate permanentemente da questa migration:
--   P0-001 (§5): Nessun branch ANY o SINGLE-SLUG accetta resource candidate
--               senza EXISTS check srs per (resource,service) quando la
--               tabella srs contiene almeno 1 riga per quella risorsa.
--   P0-002 (§6c): time-off su risorse bookable=false (slug='principale' o
--                 closure globale) blocca TUTTE le risorse bookable=true
--                 candidate, con medesimo comportamento di una closure
--                 business_schedule_exception.
--
-- NON modificare questo file. Future behavioral fixes: append-only #88+.
-- ============================================================================
