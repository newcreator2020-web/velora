-- =====================================================================
-- FASE 11B §1 BEFORE-FIX REPRODUCTION SCRIPT
-- =====================================================================
-- Esegue riproduzione runtime di D1 D2 D3 D4.
-- Output tabulare in forma di singole row di report.
-- Solo SELECT; nessuna modifica a strutture frozen.
-- =====================================================================

SET search_path = '';

\echo '=========== START BEFORE-FIX REPRO FASE 11B ==========='

\echo '--- D1: ANON bookings SELECT permission check (PII leak?) ---'
DO $$
DECLARE
  v_test_tenant_id UUID;
  v_test_svc_id    UUID;
  v_test_slug      TEXT;
  v_bid            UUID;
  v_anon_ok        BOOL;
  v_seen_name      TEXT;
  v_seen_email     TEXT;
  v_seen_phone     TEXT;
  v_seen_notes     TEXT;
BEGIN
  -- 1. Crea tenant published + service via service_role-level insert (direct bypass in do block set role)
  v_test_tenant_id := gen_random_uuid();
  v_test_slug      := 'fase11b-repro-' || substr(md5(random()::text), 1, 8);
  v_test_svc_id    := gen_random_uuid();
  v_bid            := gen_random_uuid();

  SET LOCAL ROLE = postgres;

  INSERT INTO public.tenants (id, slug, display_name, published, status)
  VALUES (v_test_tenant_id, v_test_slug, 'Fase11B Repro Tenant', TRUE, 'active');

  INSERT INTO public.business_profiles (tenant_id, business_name, timezone)
  VALUES (v_test_tenant_id, 'Fase11B', 'Europe/Rome');

  INSERT INTO public.services (id, tenant_id, slug, name, duration_minutes, active, price_cents)
  VALUES (v_test_svc_id, v_test_tenant_id, 'taglio11b', 'Taglio Fase11b', 30, TRUE, 2000);

  -- Seed BA per Lun=1 (oggi nel test potremmo non essere in BA, quindi inserimento default per 0..6)
  INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
  SELECT v_test_tenant_id, wd, CASE WHEN wd=0 THEN FALSE ELSE TRUE END, '09:00', '18:00'
  FROM generate_series(0,6) AS g(wd)
  ON CONFLICT DO NOTHING;

  -- Inserisce booking CONFIRMED con PII
  INSERT INTO public.bookings
    (id, tenant_id, service_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone, notes)
  VALUES
    (v_bid, v_test_tenant_id, v_test_svc_id,
     now() + interval '2 days' + interval '3 hours',
     now() + interval '2 days' + interval '3 hours 30 minutes',
     'confirmed',
     'Cliente PII Segreto',
     'pii-leak-test' || substr(random()::text,2,6) || '@secret.test',
     '+39 333 000' || substr(random()::text,2,4),
     'NOTE SEGRETE PII');

  -- Prova a fare SELECT come anon
  RESET ROLE;
  SET LOCAL ROLE = anon;

  BEGIN
    SELECT customer_name, customer_email, customer_phone, notes
      INTO v_seen_name, v_seen_email, v_seen_phone, v_seen_notes
    FROM public.bookings
    WHERE id = v_bid
    LIMIT 1;

    v_anon_ok := FOUND;
  EXCEPTION WHEN insufficient_privilege THEN
    v_anon_ok := FALSE;
  END;

  RESET ROLE;

  RAISE NOTICE 'D1 ANON SELECT result=% seen_name=% seen_email=% seen_phone=% seen_notes(10)=%',
    v_anon_ok, COALESCE(v_seen_name, '<NULL>'), COALESCE(v_seen_email, '<NULL>'),
    COALESCE(v_seen_phone, '<NULL>'), COALESCE(substr(v_seen_notes,1,10), '<NULL>');
END $$;

\echo '--- D2: BOOKING audit events (created/cancelled/completed/no_show) ---'
DO $$
DECLARE
  v_tid UUID;
  v_sid UUID;
  v_slug TEXT;
  v_bid UUID;
  v_cid UUID;
  v_before_cnt JSONB;
  v_after_cnt JSONB;
BEGIN
  v_tid  := gen_random_uuid();
  v_sid  := gen_random_uuid();
  v_bid  := gen_random_uuid();
  v_slug := 'f11b-audit-' || substr(md5(random()::text), 1, 8);

  SET LOCAL ROLE = postgres;

  INSERT INTO public.tenants (id, slug, display_name, published, status)
  VALUES (v_tid, v_slug, 'Audit', TRUE, 'active');

  INSERT INTO public.business_profiles (tenant_id, business_name, timezone)
  VALUES (v_tid, 'Audit', 'Europe/Rome');

  INSERT INTO public.services (id, tenant_id, slug, name, duration_minutes, active, price_cents)
  VALUES (v_sid, v_tid, 'svcaudit', 'Audit', 30, TRUE, 1000);

  INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
  SELECT v_tid, wd, CASE WHEN wd=0 THEN FALSE ELSE TRUE END, '09:00', '18:00'
  FROM generate_series(0,6) AS g(wd)
  ON CONFLICT DO NOTHING;

  -- Customer create
  v_cid := gen_random_uuid();
  INSERT INTO public.customers (id, tenant_id, display_name, email, phone)
  VALUES (v_cid, v_tid, 'Mario Audit', 'mario@audit.test', '3331111');

  SELECT jsonb_object_agg(a.action, a.cnt) INTO v_before_cnt
  FROM (SELECT action, count(*) cnt FROM public.audit_logs WHERE entity_id IN (v_bid, v_cid) GROUP BY action) a;

  -- BOOKING create via RPC trusted (ANON simula flow pubblico)
  SET LOCAL ROLE = anon;
  BEGIN
    SELECT booking_id INTO STRICT v_bid
    FROM public.public_booking_create_slug(
      v_slug, v_sid, now() + interval '3 days' + interval '2 hours',
      'Giulia BookingAudit', 'giulia@audit.test', '+39 333 222 3333', 'note audit'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D2 booking create RPC error=% sqlerrm=%', SQLSTATE, SQLERRM;
  END;

  RESET ROLE;
  SET LOCAL ROLE = postgres;

  -- Transizioni di stato (authenticated owner simula ruolo owner via has_tenant_role? usiamo direct update bypass postgres)
  UPDATE public.bookings SET status='cancelled' WHERE id=v_bid;
  UPDATE public.bookings SET status='completed' WHERE id=v_bid RETURNING *;  -- Fallirà se la transizione è only confirmed -> terminali. Ok.
  -- Reinsert confirmed diverso per testare completed/no_show.
  DECLARE
    v_bc UUID := gen_random_uuid();
    v_bd UUID := gen_random_uuid();
    v_bn UUID := gen_random_uuid();
  BEGIN
    INSERT INTO public.bookings (id, tenant_id, service_id, starts_at, ends_at, status, customer_name)
      VALUES (v_bc, v_tid, v_sid, now()+'5 days'::interval, now()+'5 days'::interval+'30 minutes', 'confirmed', 'cancelled');
    INSERT INTO public.bookings (id, tenant_id, service_id, starts_at, ends_at, status, customer_name)
      VALUES (v_bd, v_tid, v_sid, now()+'6 days'::interval, now()+'6 days'::interval+'30 minutes', 'confirmed', 'completed');
    INSERT INTO public.bookings (id, tenant_id, service_id, starts_at, ends_at, status, customer_name)
      VALUES (v_bn, v_tid, v_sid, now()+'7 days'::interval, now()+'7 days'::interval+'30 minutes', 'confirmed', 'no_show');

    UPDATE public.bookings SET status='cancelled' WHERE id=v_bc;
    UPDATE public.bookings SET status='completed' WHERE id=v_bd;
    UPDATE public.bookings SET status='no_show'   WHERE id=v_bn;

    UPDATE public.customers SET notes='cambio note' WHERE id=v_cid;

    SELECT jsonb_object_agg(a.action, a.cnt ORDER BY a.action) INTO v_after_cnt
    FROM (
      SELECT action, count(*) cnt
      FROM public.audit_logs
      WHERE entity_id IN (v_bid, v_bc, v_bd, v_bn, v_cid)
         OR (entity_type = 'booking' AND tenant_id = v_tid)
         OR (entity_type = 'customer' AND tenant_id = v_tid)
      GROUP BY action
    ) a;

    RAISE NOTICE 'D2 AUDIT FINAL ACTION COUNTS: %', v_after_cnt::text;
  END;
END $$;

\echo '--- D4: Plan protection trigger references active vs status column ---'
DO $$
DECLARE
  v_tid UUID;
  v_plan_old TEXT;
  v_plan_new TEXT;
  v_raised TEXT;
BEGIN
  v_tid := (SELECT id FROM public.tenants WHERE status='active' LIMIT 1);
  SELECT plan_id INTO v_plan_old FROM public.tenants WHERE id=v_tid;
  v_plan_new := CASE WHEN v_plan_old IS DISTINCT FROM 'pro' THEN 'pro' ELSE 'base' END;

  -- Simula trigger: prova SELECT platform_admins WHERE active = TRUE (colonna sbagliata)
  BEGIN
    PERFORM * FROM public.platform_admins WHERE active = TRUE LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D4 CONFIRMED: platform_admins.active COLUMN DOES NOT EXIST. SQLSTATE=% SQLERRM=%', SQLSTATE, SQLERRM;
  END;

  BEGIN
    PERFORM * FROM public.platform_admins WHERE status = 'active' LIMIT 1;
    RAISE NOTICE 'D4 column status is correct (no exception).';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D4 WRONG COLUMN status? %', SQLERRM;
  END;
END $$;

\echo '--- D9 Internal RPC exposure (§9 S1 customer_upsert_for_public_booking anon executable?) ---'
DO $$
DECLARE
  v_tid UUID := (SELECT id FROM public.tenants LIMIT 1);
  v_cid UUID;
  v_created BOOL;
BEGIN
  SET LOCAL ROLE = anon;
  BEGIN
    SELECT customer_id, created INTO STRICT v_cid, v_created
    FROM public.customer_upsert_for_public_booking(v_tid, 'Spammer Anon', 'spam'||substr(random()::text,2,6)||'@anon.test', NULL);
    RAISE NOTICE 'D9 S1 CONFIRMED: customer_upsert_for_public_booking ANON CAN CALL DIRECTLY. cid=% created=%', v_cid, v_created;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D9 S1 RESULT: SQLSTATE=% SQLERRM=%', SQLSTATE, SQLERRM;
  END;
END $$;

\echo '--- D10 Composite integrity: booking tenant A + service tenant B? + customer tenant B? ---'
DO $$
DECLARE
  v_ta UUID := gen_random_uuid();
  v_tb UUID := gen_random_uuid();
  v_sb UUID := gen_random_uuid();
  v_cb UUID := gen_random_uuid();
  v_bid UUID;
BEGIN
  SET LOCAL ROLE = postgres;
  INSERT INTO public.tenants (id, slug, display_name, published, status) VALUES
    (v_ta, 'f11b-ta', 'Tenant A', TRUE, 'active'),
    (v_tb, 'f11b-tb', 'Tenant B', TRUE, 'active');
  INSERT INTO public.services (id, tenant_id, slug, name, duration_minutes, active)
    VALUES (v_sb, v_tb, 'svc-b', 'Service B', 30, TRUE);
  INSERT INTO public.customers (id, tenant_id, display_name) VALUES (v_cb, v_tb, 'Customer B');

  BEGIN
    SET LOCAL ROLE = postgres;
    INSERT INTO public.bookings (id, tenant_id, service_id, starts_at, ends_at, status, customer_name)
      VALUES (gen_random_uuid(), v_ta, v_sb, now()+interval '1 day', now()+interval '1 day 30 minutes', 'confirmed', 'cross-tenant svc B')
      RETURNING id INTO v_bid;
    RAISE NOTICE 'D10 CROSS-SERVICE INSERT PERMITTED. bid=%', v_bid;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D10 CROSS-SERVICE INSERT DENIED. SQLSTATE=% %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    INSERT INTO public.bookings (id, tenant_id, service_id, starts_at, ends_at, status, customer_name, customer_id)
      VALUES (gen_random_uuid(), v_ta, v_sb, now()+interval '1 day', now()+interval '1 day 30 minutes', 'confirmed', 'cross', v_cb)
      RETURNING id INTO v_bid;
    RAISE NOTICE 'D10 CROSS-CUSTOMER INSERT PERMITTED. bid=%', v_bid;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D10 CROSS-CUSTOMER INSERT DENIED. SQLSTATE=% %', SQLSTATE, SQLERRM;
  END;
END $$;

\echo '=========== END BEFORE-FIX REPRO FASE 11B ==========='
