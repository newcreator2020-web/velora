\set ON_ERROR_STOP 1
DO $$
DECLARE
  v_tenant UUID;
  v_svc UUID;
  v_next_mon DATE;
  v_from TEXT;
  v_to TEXT;
  v_n INTEGER;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug='slugo-mtu30v76-1fon';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;

  -- 1) service_id del servizio Massaggio 60min
  SELECT id INTO v_svc FROM public.services
  WHERE tenant_id = v_tenant AND name ILIKE '%massaggio%rilassante%60%'
  LIMIT 1;
  IF v_svc IS NULL THEN
    SELECT id INTO v_svc FROM public.services WHERE tenant_id = v_tenant AND name ILIKE '%massaggio%' LIMIT 1;
  END IF;
  RAISE NOTICE 'service_id Massaggio=%, tenant=%', v_svc, v_tenant;

  -- 1.5) CREAZIONE IDEMPOTENTE RISORSA OPERATORE (passa CTE candidates slot engine)
  IF NOT EXISTS (SELECT 1 FROM public.staff_resources WHERE tenant_id = v_tenant AND slug = 'tonino') THEN
    INSERT INTO public.staff_resources(tenant_id, slug, display_name, active, bookable, sort_order, created_at, updated_at)
    VALUES (v_tenant, 'tonino', 'Operatore Principale', TRUE, TRUE, 0, NOW(), NOW());
  ELSE
    UPDATE public.staff_resources SET active = TRUE, bookable = TRUE, updated_at = NOW() WHERE tenant_id = v_tenant AND slug = 'tonino';
  END IF;
  RAISE NOTICE 'staff_resources OK (slug=tonino)';

  -- 2) next_monday (prossimo lun non passato)
  SELECT current_date + ((8 - CAST(EXTRACT(DOW FROM current_date) AS INTEGER)) % 7)::INTEGER
  INTO v_next_mon;
  RAISE NOTICE 'next_monday=%, +3=%', v_next_mon, v_next_mon + 3;
  v_from := v_next_mon::TEXT;
  v_to := (v_next_mon + 3)::TEXT;

  -- 3) salva in tab temp per SELECT REPORT
  CREATE TEMP TABLE IF NOT EXISTS fase2_slots AS
  SELECT slot::TEXT as slot_time
  FROM public.public_slot_get_available_v3(
    'slugo-mtu30v76-1fon'::TEXT,
    v_svc::UUID,
    v_from::DATE,
    v_to::DATE,
    'any'::TEXT
  ) slot;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'slot disponibili=%', v_n;
  IF v_n = 0 THEN RAISE EXCEPTION 'Nessuno slot disponibile'; END IF;
END $$;

SELECT 'SERVICE_ID' as step, s.id, s.name, s.price, s.duration_minutes
FROM public.services s
WHERE tenant_id=(SELECT id FROM public.tenants WHERE slug='slugo-mtu30v76-1fon')
  AND name ILIKE '%massaggio%';

SELECT 'SLOT_FIRST_10' as step, slot_time FROM fase2_slots ORDER BY slot_time LIMIT 10;

SELECT 'SLOT_TOTAL' as step, count(*) as n FROM fase2_slots;
