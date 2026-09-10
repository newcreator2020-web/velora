\set ON_ERROR_STOP 1
DO $$
DECLARE
  v_tenant UUID;
  v_bp JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug='slugo-mtu30v76-1fon';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant tonino not found'; END IF;

  SELECT jsonb_build_object(
    'display_name', display_name,
    'category', category,
    'city', city,
    'timezone', timezone,
    'locale', locale
  ) INTO v_bp FROM public.business_profiles WHERE tenant_id = v_tenant;

  RAISE NOTICE '======= BACKOFFICE TONINO REPORT =======';
  RAISE NOTICE 'Tenant: %', v_bp;
  RAISE NOTICE 'Bookings confirmed=% (should be 1 Maria Rossi)',
    (SELECT count(*) FROM public.bookings WHERE tenant_id=v_tenant AND status='confirmed');
  RAISE NOTICE 'Services active=% (should be 9)',
    (SELECT count(*) FROM public.services WHERE tenant_id=v_tenant AND active=TRUE);
  RAISE NOTICE 'Business availability rows=% (should be 7)',
    (SELECT count(*) FROM public.business_availability WHERE tenant_id=v_tenant);
  RAISE NOTICE 'Staff resources active bookable=% (should be 1 tonino)',
    (SELECT count(*) FROM public.staff_resources WHERE tenant_id=v_tenant AND active=TRUE AND bookable=TRUE);
END $$;

SELECT
  'BOOKING_MARIA_ROSSI_READBACK' as step,
  b.id AS booking_id,
  b.status,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  b.notes,
  (b.starts_at AT TIME ZONE 'Europe/Rome')::TEXT AS start_italia,
  (b.ends_at AT TIME ZONE 'Europe/Rome')::TEXT AS end_italia,
  s.duration_minutes,
  s.name AS servizio,
  sr.slug AS operatore_slug,
  sr.display_name AS operatore_nome
FROM public.bookings b
JOIN public.tenants t ON t.id=b.tenant_id
LEFT JOIN public.services s ON s.id=b.service_id
LEFT JOIN public.staff_resources sr ON sr.id=b.resource_id
WHERE t.slug='slugo-mtu30v76-1fon'
  AND b.customer_email='maria.rossi@f2-tonino.it'
  AND b.status='confirmed'
ORDER BY b.starts_at
LIMIT 1;

SELECT
  'SERVICES_LIST' as step,
  s.name, s.duration_minutes, s.price_from, s.deposit_strategy, s.deposit_value, s.active, s.position
FROM public.services s
JOIN public.tenants t ON t.id=s.tenant_id
WHERE t.slug='slugo-mtu30v76-1fon'
ORDER BY s.position, s.name;

SELECT
  'AVAILABILITY_WEEKLY' as step,
  CASE weekday
    WHEN 0 THEN 'Domenica' WHEN 1 THEN 'Lunedì' WHEN 2 THEN 'Martedì'
    WHEN 3 THEN 'Mercoledì' WHEN 4 THEN 'Giovedì' WHEN 5 THEN 'Venerdì'
    WHEN 6 THEN 'Sabato' END AS giorno,
  enabled, start_time, end_time
FROM public.business_availability ba
JOIN public.tenants t ON t.id=ba.tenant_id
WHERE t.slug='slugo-mtu30v76-1fon'
ORDER BY (CASE weekday WHEN 0 THEN 7 ELSE weekday END);
