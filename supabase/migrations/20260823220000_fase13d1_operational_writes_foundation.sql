-- ============================================================================
-- FASE 13D1 — Operational Booking Writes Foundation
-- APPEND-ONLY. Nessuna modifica a FASE1..FASE13C.
--
-- Trust boundaries:
--   • dashboard_booking_manual_create (SEC DEFINER search_path='')
--   • dashboard_booking_reschedule (SEC DEFINER search_path='')
--   • Nessun service_role generico nel normale percorso app.
--
-- Immutabilità forte:
--   • Trigger bookings_update_restricted con GUC bypass SOLO per
--     current_user = postgres (SEC DEFINER owner) / service_role / platform_admins.
--   • Authenticated che forgi SET LOCAL app.booking_write_trusted=true → DENY.
--
-- Concurrency:
--   • bookings.revision INTEGER + FOR UPDATE + expected_revision match.
--   • GiST bookings_no_resource_overlap_confirmed = FINAL AUTHORITY.
--
-- Audit PII-free via _audit_insert_trusted (scrubber integrato).
-- ============================================================================

SET search_path TO public;

-- ============================================================================
-- 1. OPTIMISTIC / PESSIMISTIC CONCURRENCY: bookings.revision
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_revision_nonneg;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_revision_nonneg CHECK (revision >= 0);

CREATE INDEX IF NOT EXISTS bookings_tenant_revision_idx
  ON public.bookings (tenant_id, revision);

-- ============================================================================
-- 2. AUDIT ACTION WHITELIST: extend CHECK con 3 nuove azioni FASE13D
--    Include TUTTE le action di FASE1..FASE13B7 (sostituisce 13B7 whitelist)
--    aggiungendo le 3 nuove action FASE13D:
--      manual_booking_created | booking_rescheduled | booking_resource_assigned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE public.audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    -- FASE6 frozen dot-form
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'system.seed','system.migration',
    -- Dot billing / booking / customer legacy
    'subscription.active','subscription.past_due','subscription.canceled','subscription.updated',
    'billing.receipt','billing.failed',
    'booking.created','booking.cancelled','booking.completed','booking.no_show','booking.status_changed',
    'customer.created','customer.updated',
    -- Underscore form (FASE 8-12)
    'tenant_created','tenant_updated','tenant_status_changed','tenant_plan_changed',
    'membership_created','membership_updated','membership_revoked',
    'profile_updated','business_profile_updated','onboarding_completed',
    'platform_admin_granted','platform_admin_revoked',
    'subscription_active','subscription_past_due','subscription_canceled','subscription_updated',
    'billing_receipt','billing_failed',
    'booking_created','booking_cancelled','booking_completed','booking_no_show','booking_status_changed',
    'customer_created','customer_updated',
    -- FASE12 RESOURCE events
    'resource_created','resource_updated','resource_deactivated',
    'resource_service_added','resource_service_changed','resource_service_removed',
    -- FASE13B SCHEDULING FOUNDATION events
    'resource_availability_changed',
    'business_schedule_exception_created',
    'business_schedule_exception_updated',
    'business_schedule_exception_deleted',
    'resource_time_off_created',
    'resource_time_off_updated',
    'resource_time_off_deleted',
    'booking_v3_created',
    -- FASE13D operational writes (nuove)
    'manual_booking_created','booking_rescheduled','booking_resource_assigned'
  ));

-- ============================================================================
-- 3. TRIGGER bookings_update_restricted: IMMUTABILITY + GUC BYPASS TRUSTED-ONLY
--    Pattern FASE8e protect_tenant_plan_id adattato.
--
--    BYPASS regole:
--    A. auth.uid() IS NULL (service_role raw DB authority) → bypass sempre
--       (permette migration, seeding, backfill FASE12 frozen che non usano GUC).
--    B. altrimenti (authenticated / SEC DEFINER) è NECESSARIO entrambi:
--       (i)  SET LOCAL app.booking_write_trusted=true  (GUC)
--       AND
--       (ii) current_user = 'postgres' (SEC DEFINER owner)
--            OR EXISTS platform_admin attivo.
--
--    Un authenticated normale che setta GUC ma non ha (ii) → VIENE NEGATO.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bookings_update_restricted()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_trusted_guc BOOL;
  v_allowed BOOL := FALSE;
  v_immutable_changed BOOL := FALSE;
  v_changed_keys TEXT[] := ARRAY[]::TEXT[];
  v_is_service_role BOOL;
BEGIN
  -- Tenant immutabile.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'tenant_id');
  END IF;

  -- Service immutabile.
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'service_id');
  END IF;

  -- Times immutabili.
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'starts_at');
    v_changed_keys := array_append(v_changed_keys, 'ends_at');
  END IF;

  -- Customer PII immutabile.
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
     OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'customer_pii');
  END IF;

  -- customer_id immutabile dopo assegnazione.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'customer_id');
  END IF;

  -- resource_id immutabile.
  IF NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
    v_immutable_changed := TRUE;
    v_changed_keys := array_append(v_changed_keys, 'resource_id');
  END IF;

  -- Revision monotonic: revision = OLD.revision + 1 esattamente 1 step (non per service role migration backfill che setta anche revision a 0).
  IF NEW.revision <> OLD.revision AND NEW.revision <> OLD.revision + 1 THEN
    v_is_service_role := (auth.uid() IS NULL);
    IF NOT v_is_service_role THEN
      RAISE EXCEPTION 'bookings.revision must increment exactly 1' USING errcode = 'VF400';
    END IF;
  END IF;

  -- =====================================================================
  -- BRANCH A: NESSUNO campo immutabile cambiato (solo status / revision bump).
  --           Transizione status regolata dopo (solo confirmed → terminali).
  -- =====================================================================
  IF NOT v_immutable_changed THEN
    -- Status transition solo confirmed → cancelled/completed/no_show.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled','completed','no_show') THEN
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'bookings invalid status transition' USING errcode = 'VF400';
      END IF;
    END IF;
    -- Solo revision bump + invariato resto.
    RETURN NEW;
  END IF;

  -- =====================================================================
  -- BRANCH B: CAMPO IMMUTABILE CAMBIATO. VALIDAZIONE TRUSTED BYPASS.
  -- =====================================================================
  v_is_service_role := (auth.uid() IS NULL);

  IF v_is_service_role THEN
    -- Service role: autorità DB massima (migration/backfill/seeding).
    v_allowed := TRUE;
  ELSE
    -- Authenticated / SEC DEFINER. Occorre GUC + autorità nominale.
    DECLARE
      v_guc_raw TEXT;
    BEGIN
      v_guc_raw := COALESCE(LOWER(TRIM(BOTH FROM current_setting('app.booking_write_trusted', true))), '');
      v_trusted_guc := (v_guc_raw = 'true' OR v_guc_raw = 'on' OR v_guc_raw = '1' OR v_guc_raw = 'yes');
    END;
    IF v_trusted_guc THEN
      IF current_user = 'postgres' THEN
        v_allowed := TRUE;
      ELSIF EXISTS (
        SELECT 1 FROM public.platform_admins pa
        WHERE pa.status = 'active' AND pa.user_id = auth.uid()
      ) THEN
        v_allowed := TRUE;
      END IF;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'bookings immutable columns denied. Trusted GUC bypass reserved.'
      USING errcode = 'VF403';
  END IF;

  -- Status transition allowed anche in reschedule: confirmed → confirmed (no change).
  -- Se lo status cambia in reschedule: nega (non usiamo reschedule come soft-cancel).
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> OLD.status THEN
    IF OLD.status <> 'confirmed' OR NEW.status <> 'confirmed' THEN
      RAISE EXCEPTION 'reschedule cannot change booking terminal status' USING errcode = 'VF400';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

ALTER FUNCTION public.bookings_update_restricted() OWNER TO postgres;

-- ============================================================================
-- 4. FAILURE CODES — Helpers minimi (return text; UI legge codice non messaggio).
--    Usiamo direttamente ERRCODE e un wrapper RAISE.
-- ============================================================================

-- ============================================================================
-- 5. SHARED HELPERS interno (NON grant) per validare disponibilità ANY/single
--    durante write (riusa semantica V3: eligibility, hours, closure, time-off,
--    lead, horizon, special_hours, extra_open).
--    A differenza di public V3, dashboard consente WALK-IN <= 180m per staff
--    e passato arbitrario recent per owner/manager.
-- ============================================================================

-- (implementiamo inline dentro ogni RPC per evitare duplicazioni; manteniamo
--  la singola authority semantica V3 ripetuta per massima locality di audit)

-- ============================================================================
-- 6. RPC dashboard_booking_manual_create
--    Authority: tenant da auth.uid + membership.
--    Input max: p_customer_id | (name,email,phone) · service_id · resource_slug
--                · starts_at · notes
--    Output: code/message/booking_id/revision/resource_id
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
  RETURN NEXT;
  RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    code := 'AUTHZ_DENIED'; message := 'tenant membership not found';
  RETURN NEXT;
  RETURN;
  END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := NULL;
  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN v_actor_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN v_actor_role := 'manager';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['staff']) THEN v_actor_role := 'staff';
  END IF;
  IF v_actor_role IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'insufficient role';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Constants ----------------------------------------------------------
  SELECT s.lead_time_minutes, s.booking_horizon_days, s.slot_step_minutes
    INTO v_const_lead, v_const_horizon, v_const_step
  FROM public.scheduling_constants() s;

  -- ---- Walk-in policy / past ---------------------------------------------
  IF p_starts_at < v_now THEN
    IF v_actor_role IN ('owner','manager') THEN
      -- recent past allow (§6 walk-in policy owner/manager any recent)
      NULL;
    ELSE
      -- STAFF: max 180 minuti.
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
  RETURN NEXT;
  RETURN;
  END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  -- Lead & horizon solo se starts_at è FUTURO (non walk-in passato).
  IF p_starts_at > v_now THEN
    IF p_starts_at < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
      code := 'LEAD_TIME_MINIMUM'; message := 'tempo di preavviso non sufficiente';
  RETURN NEXT;
  RETURN;
    END IF;
    IF p_starts_at > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
      code := 'MAX_ADVANCE_EXCEEDED'; message := 'data troppo in avanti';
  RETURN NEXT;
  RETURN;
    END IF;
  END IF;

  -- ---- Customer authority ------------------------------------------------
  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.display_name, c.email, c.phone
      INTO v_cust_id, v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'cliente non appartiene al tenant';
  RETURN NEXT;
  RETURN;
    END IF;
  ELSE
    -- Nuovo cliente → trusted upsert (stesso algoritmo dedup email>phone lock).
    v_cust_name := BTRIM(COALESCE(p_customer_name, ''));
    IF length(v_cust_name) = 0 OR length(v_cust_name) > 120 THEN
      code := 'VALIDATION_ERROR'; message := 'nome cliente obbligatorio max 120';
  RETURN NEXT;
  RETURN;
    END IF;
    -- Contatto minimo: email OPPURE phone (stesso invariant bookings_at_least_one_contact).
    IF (p_customer_email IS NULL OR length(BTRIM(p_customer_email))=0)
       AND (p_customer_phone IS NULL OR length(BTRIM(p_customer_phone)) < 4) THEN
      code := 'VALIDATION_ERROR'; message := 'almeno email o telefono';
  RETURN NEXT;
  RETURN;
    END IF;
    -- Chiamata trusted customer_upsert (SEC DEFINER; postgres owner può eseguire senza grant).
    SELECT r.customer_id INTO v_cust_id
      FROM public.customer_upsert_for_public_booking(
        v_tenant_id,
        v_cust_name,
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),'')
      ) r;
    IF v_cust_id IS NULL THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'upsert cliente fallita';
  RETURN NEXT;
  RETURN;
    END IF;
    SELECT c.display_name, c.email, c.phone
      INTO v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c WHERE c.id = v_cust_id;
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
  RETURN NEXT;
  RETURN;
    END IF;
    -- Eligibility check specific.
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id = v_resources[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id
           AND srs.resource_id = v_resources[1]
           AND srs.service_id = p_service_id
           AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'operatore non abilitato per servizio';
  RETURN NEXT;
  RETURN;
    END IF;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessun operatore disponibile';
  RETURN NEXT;
  RETURN;
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
  RETURN NEXT;
  RETURN;
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

    -- Weekly hours (inherit se vuoto).
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

      -- Special hours override.
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

    -- ---- WRITE: SET LOCAL GUC + INSERT, GiST final authority. -------------
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

      -- Audit PII-free via trusted helper.
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
-- 7. RPC dashboard_booking_reschedule
--    Owner/Manager allow · Staff deny.
--    FOR UPDATE + expected_revision check.
--    Permette di cambiare starts_at · resource_slug (same|any|slug) · service_id.
--    Revision bump atomico.
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
  RETURN NEXT;
  RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN code := 'AUTHZ_DENIED'; message := 'membership';
  RETURN NEXT;
  RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := public.member_role_for_tenant(v_tenant_id, v_actor_uid);
  IF v_actor_role NOT IN ('owner','manager') THEN
    code := 'AUTHZ_DENIED'; message := 'reschedule solo owner/manager';
  RETURN NEXT;
  RETURN;
  END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_const_lead, v_const_horizon
  FROM public.scheduling_constants() s;

  -- ---- Lock pessimistico row ---------------------------------------------
  SELECT b.* INTO v_b FROM public.bookings b
  WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    code := 'BOOKING_NOT_FOUND'; message := 'inesistente';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Cross-tenant ownership.
  IF v_b.tenant_id <> v_tenant_id THEN
    code := 'CROSS_TENANT_DENIED'; message := 'cross-tenant';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Terminal status deny.
  IF v_b.status <> 'confirmed' THEN
    code := 'BOOKING_TERMINAL'; message := 'appuntamento terminale';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Stale revision.
  IF v_b.revision <> p_expected_revision THEN
    code := 'CONCURRENT_UPDATE'; message := 'revisione non corrisponde';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Service change → duration recalc.
  IF p_new_service_id IS NOT NULL AND p_new_service_id <> v_b.service_id THEN
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s
     WHERE s.id = p_new_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
    IF NOT FOUND OR v_duration IS NULL THEN
      code := 'SERVICE_INACTIVE'; message := 'servizio inattivo o inesistente';
  RETURN NEXT;
  RETURN;
    END IF;
    v_new_svc := p_new_service_id;
    v_changed := array_append(v_changed, 'service_id');
  ELSE
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s WHERE s.id = v_b.service_id;
    v_new_svc := v_b.service_id;
  END IF;

  -- ---- Start time change → ends_at server-side.
  IF p_new_starts_at IS NOT NULL AND p_new_starts_at <> v_b.starts_at THEN
    -- Future: lead / horizon. Past: owner/manager allow; staff deny per role check sopra owner/manager solo.
    v_new_start := p_new_starts_at;
    IF v_new_start > v_now THEN
      IF v_new_start < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
        code := 'LEAD_TIME_MINIMUM'; message := 'lead';
  RETURN NEXT;
  RETURN;
      END IF;
      IF v_new_start > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
        code := 'MAX_ADVANCE_EXCEEDED'; message := 'horizon';
  RETURN NEXT;
  RETURN;
      END IF;
    END IF;
    v_changed := array_append(v_changed, 'starts_at');
    v_changed := array_append(v_changed, 'ends_at');
  ELSE
    v_new_start := v_b.starts_at;
  END IF;
  v_new_end := v_new_start + (v_duration::TEXT || ' minutes')::INTERVAL;

  -- ---- Resource strategy: NULL|''|'same' keep, 'any' reselect deterministic, slug specific.
  IF p_new_resource_slug IS NULL OR p_new_resource_slug = '' OR p_new_resource_slug = 'same' THEN
    v_candidates := ARRAY[v_b.resource_id];
    SELECT ARRAY[sr.slug] INTO v_cand_slugs
      FROM public.staff_resources sr WHERE sr.id = v_b.resource_id;
    IF v_cand_slugs IS NULL THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'stessa risorsa non esiste';
  RETURN NEXT;
  RETURN;
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
  RETURN NEXT;
  RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=v_candidates[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = v_candidates[1]
           AND srs.service_id = v_new_svc AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'non eligibile';
  RETURN NEXT;
  RETURN;
    END IF;
  END IF;

  IF v_candidates IS NULL OR array_length(v_candidates, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessuna risorsa';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Business closure / slot_block globale.
  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(v_new_start, v_new_end, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'chiusura';
  RETURN NEXT;
  RETURN;
  END IF;

  -- ---- Try candidate loop (ANY, single, same).
  v_i := 1;
  <<try_res>>
  LOOP
    EXIT try_res WHEN v_i > array_length(v_candidates, 1);
    v_picked := v_candidates[v_i];
    v_picked_slug := v_cand_slugs[v_i];

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
          WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
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

    -- Resource unchanged? segnalo per chiarezza changed_keys.
    IF v_picked <> v_b.resource_id THEN
      IF NOT ('resource_id' = ANY(v_changed)) THEN
        v_changed := array_append(v_changed, 'resource_id');
      END IF;
    END IF;

    -- ---- WRITE UPDATE. ------------------------------------------------------
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

      -- Audit deterministic: event unificato booking_rescheduled se ANY changed_keys,
      -- ma se solo resource changed usiamo booking_resource_assigned.
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
          'from_service_id', v_b.service_id::text,
          'to_service_id', v_new_svc::text,
          'from_resource_id', v_b.resource_id::text,
          'to_resource_id', v_picked::text,
          'from_starts_at', v_b.starts_at::text,
          'to_starts_at', v_new_start::text,
          'from_ends_at', v_b.ends_at::text,
          'to_ends_at', v_new_end::text,
          'revision_before', v_b.revision,
          'revision_after', v_b.revision + 1,
          'source', 'dashboard_manual',
          'created_by_role', v_actor_role,
          'changed_keys', to_jsonb(v_changed)
        )
      );
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_res;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'nuovo slot occupato';
  RETURN NEXT;
  RETURN;
END; $$;

ALTER FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO service_role;

-- ============================================================================
-- 8. Aggiungere grants di SELECT su colonne PII di bookings per authenticated.
--    (Già esistente SELECT all per authenticated; i campi PII sono usati solo
--     dalle SEC DEFINER. Nessun cambiamento RLS.)
-- ============================================================================

-- ============================================================================
-- 9. system.migration audit entry (soft, best effort via service_role grant).
-- ============================================================================
DO $$ BEGIN NULL; END $$;

-- ============================================================================
-- 10. ATTACH TRIGGER bookings_update_restricted to public.bookings
--     BEFORE UPDATE, per ogni riga.
--     Ordine: DOPO audit_* triggers immutabili di FASE13B7 (esegue prima audit_immutabili, poi
--     bookings_update_restricted valida GUC / revision monotonic;
--     se nega VF403/VF400 prima che audit scriva).
-- ============================================================================
DROP TRIGGER IF EXISTS bookings_update_restricted ON public.bookings;

CREATE TRIGGER bookings_update_restricted
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_update_restricted();
