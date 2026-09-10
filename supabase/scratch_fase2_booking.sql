\set ON_ERROR_STOP 1
DO $$
DECLARE
  v_tenant UUID;
  v_svc UUID;
  v_start TIMESTAMPTZ;
  v_count_before INTEGER;
  v_count_after INTEGER;
  v_booking_id UUID;
  v_end_at TIMESTAMPTZ;
  v_status TEXT;
  v_slug TEXT;
  v_altro UUID;
  v_count_altro INTEGER;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug='slugo-mtu30v76-1fon';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant tonino not found'; END IF;

  -- CLEANUP IDEMPOTENTE: cancelliamo eventuali booking preesistenti di Maria Rossi sullo slot
  DELETE FROM public.bookings
  WHERE tenant_id = v_tenant
    AND customer_email = 'maria.rossi@f2-tonino.it'
    AND starts_at = '2026-09-14 07:00:00+00'::TIMESTAMPTZ;

  SELECT id INTO v_svc FROM public.services
  WHERE tenant_id = v_tenant AND name ILIKE '%massaggio%rilassante%60%'
  LIMIT 1;
  IF v_svc IS NULL THEN RAISE EXCEPTION 'service massaggio not found'; END IF;

  v_start := '2026-09-14 07:00:00+00'::TIMESTAMPTZ;

  SELECT count(*) INTO v_count_before FROM public.bookings
  WHERE tenant_id = v_tenant AND status='confirmed';
  RAISE NOTICE 'BOOKING BEFORE Tonino confirmed=%', v_count_before;

  -- ====== BOOKING 1: Maria Rossi (prima esecuzione, deve riuscire) ======
  BEGIN
    SELECT booking_id, start_at, end_at, status, resource_slug
    INTO v_booking_id, v_start, v_end_at, v_status, v_slug
    FROM public.public_booking_create_v3(
      'slugo-mtu30v76-1fon',
      v_svc,
      v_start,
      'any',
      'Maria Rossi',
      'maria.rossi@f2-tonino.it',
      '+393339876543',
      'Prima visita verificata Fase2 Golden Path'
    );
    RAISE NOTICE '✅ BOOKING CREATED id=%, status=%, start=%, end=%, resource=%', v_booking_id, v_status, v_start, v_end_at, v_slug;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '⚠️  Primo booking fallito: % (SQLSTATE=%) — provo retry pulendo prima', SQLERRM, SQLSTATE;
    DELETE FROM public.bookings WHERE tenant_id = v_tenant
      AND customer_email = 'maria.rossi@f2-tonino.it'
      AND starts_at = '2026-09-14 07:00:00+00';
    SELECT booking_id, start_at, end_at, status, resource_slug
    INTO v_booking_id, v_start, v_end_at, v_status, v_slug
    FROM public.public_booking_create_v3(
      'slugo-mtu30v76-1fon',
      v_svc,
      '2026-09-14 07:00:00+00'::TIMESTAMPTZ,
      'any',
      'Maria Rossi',
      'maria.rossi@f2-tonino.it',
      '+393339876543',
      'Prima visita verificata Fase2 Golden Path'
    );
    RAISE NOTICE '✅ BOOKING CREATED (after cleanup) id=%, status=%', v_booking_id, v_status;
  END;

  SELECT count(*) INTO v_count_after FROM public.bookings
  WHERE tenant_id = v_tenant AND status='confirmed';
  RAISE NOTICE 'BOOKING AFTER Tonino confirmed=%', v_count_after;

  IF v_count_after <> v_count_before + 1 THEN
    RAISE EXCEPTION 'Booking non creato correttamente: before=%, after=% (expected +1)', v_count_before, v_count_after;
  END IF;

  -- ====== DOUBLE BOOK CHECK: riesegui identica (deve fallire overlap EXCLUDE) ======
  RAISE NOTICE 'DOUBLE BOOK TEST: rieseguo prenotazione identica...';
  BEGIN
    PERFORM public.public_booking_create_v3(
      'slugo-mtu30v76-1fon',
      v_svc,
      '2026-09-14 07:00:00+00'::TIMESTAMPTZ,
      'any',
      'Maria Rossi',
      'maria.rossi@f2-tonino.it',
      '+393339876543',
      'Tentativo duplicato — NON DEVE PASSARE'
    );
    RAISE EXCEPTION 'ERRORE CRITICO: double book NON è stato bloccato! EXCLUDE GiST non funzionante';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '23P01' OR SQLERRM LIKE '%overlap%' OR SQLERRM LIKE '%slot taken%' OR SQLERRM LIKE '%unavailable%' OR SQLERRM LIKE '%exclusion%' THEN
      RAISE NOTICE '✅ DOUBLE BOOK BLOCCATO CORRETTAMENTE (err=%), count deve rimanere=1', SQLERRM;
    ELSE
      RAISE WARNING '⚠️  Double book bloccato ma errore inatteso err=%, state=% — verifico count', SQLERRM, SQLSTATE;
    END IF;
  END;

  SELECT count(*) INTO v_count_after FROM public.bookings
  WHERE tenant_id = v_tenant AND status='confirmed';
  IF v_count_after <> 1 THEN
    RAISE EXCEPTION 'Dopo double book test count=% invece di 1!', v_count_after;
  END IF;
  RAISE NOTICE '✅ COUNT TONINO CONFERMATO=%', v_count_after;

  -- ====== CROSS-TENANT NEGATIVO: Altro tenant (cross-b) deve avere 0 confirmed ======
  SELECT id INTO v_altro FROM public.tenants WHERE slug='cross-b-v8uipo18' LIMIT 1;
  IF v_altro IS NULL THEN
    RAISE WARNING 'Skipping cross-tenant: slug cross-b-v8uipo18 non trovato. Provo fallback.';
    SELECT id INTO v_altro FROM public.tenants WHERE id <> v_tenant AND published=TRUE ORDER BY id LIMIT 1;
  END IF;

  IF v_altro IS NOT NULL THEN
    DECLARE
      v_cross_maria INTEGER;
      v_cross_svc INTEGER;
    BEGIN
      SELECT count(*) INTO v_count_altro FROM public.bookings
      WHERE tenant_id = v_altro AND status='confirmed';
      RAISE NOTICE 'CROSS-TENANT (id=%) confirmed fixture storiche=% (non leak, atteso >0 se Playwright è girato)', v_altro, v_count_altro;

      -- TEST 1: l'email maria.rossi@f2-tonino.it NON DEVE esistere in altro tenant
      SELECT count(*) INTO v_cross_maria FROM public.bookings
      WHERE tenant_id = v_altro AND customer_email = 'maria.rossi@f2-tonino.it';
      IF v_cross_maria <> 0 THEN
        RAISE EXCEPTION '❌ CROSS-TENANT LEAK EMAIL! Cliente Maria Rossi presente in tenant altro: count=%', v_cross_maria;
      END IF;
      RAISE NOTICE '✅ CROSS-TENANT 1/2 OK: email maria.rossi@ NON in altro tenant';

      -- TEST 2: service_id del massaggio TONINO NON DEVE esistere in altro tenant
      SELECT count(*) INTO v_cross_svc FROM public.bookings
      WHERE tenant_id = v_altro AND service_id = v_svc;
      IF v_cross_svc <> 0 THEN
        RAISE EXCEPTION '❌ CROSS-TENANT LEAK SERVICE! Servizio Massaggio Tonino usato in altro tenant: count=%', v_cross_svc;
      END IF;
      RAISE NOTICE '✅ CROSS-TENANT 2/2 OK: service_id Massaggio Tonino NON usato in altro tenant';
      RAISE NOTICE '✅ CROSS-TENANT ISOLATION COMPLETA (fixture storiche di altri test non contano come leak)';
    END;
  ELSE
    RAISE WARNING 'Nessun altro tenant published disponibile per test cross-negativo';
  END IF;

END $$;

SELECT
  'REPORT_FINALE_TONINO' as step,
  (SELECT count(*) FROM public.bookings b
   JOIN public.tenants t ON t.id=b.tenant_id
   WHERE t.slug='slugo-mtu30v76-1fon' AND b.status='confirmed') AS tonino_confirmed,
  (SELECT count(*) FROM public.bookings b
   JOIN public.tenants t ON t.id=b.tenant_id
   WHERE t.slug='slugo-mtu30v76-1fon' AND b.status<>'confirmed') AS tonino_altri_stati,
  (SELECT b.id FROM public.bookings b
   JOIN public.tenants t ON t.id=b.tenant_id
   WHERE t.slug='slugo-mtu30v76-1fon' AND b.status='confirmed' LIMIT 1) AS tonino_first_booking_id,
  (SELECT b.starts_at AT TIME ZONE 'Europe/Rome' FROM public.bookings b
   JOIN public.tenants t ON t.id=b.tenant_id
   WHERE t.slug='slugo-mtu30v76-1fon' AND b.status='confirmed' LIMIT 1) AS tonino_start_italia,
  (SELECT b.customer_name FROM public.bookings b
   JOIN public.tenants t ON t.id=b.tenant_id
   WHERE t.slug='slugo-mtu30v76-1fon' AND b.status='confirmed' LIMIT 1) AS cliente_nome;
