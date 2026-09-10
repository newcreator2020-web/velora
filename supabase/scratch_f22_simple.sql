-- FASE 22.1 READ BACK BOOKING LUCA BIANCHI - SENZA ON_ERROR_STOP, SENZA GROUP BY PROBLEMATICI
\set TENANT_ID_TONINO 'd5a0538e-567e-45ee-b00e-61659ed50637'
\x auto

-- 0. Tabella bookings esiste? E struttura?
\echo ===== 0. STRUTTURA bookings =====
\d public.bookings

\echo ===== 0a. QUANTI BOOKINGS IN TOTALE TONINO =====
SELECT count(*) AS bookings_tonino_total FROM public.bookings WHERE tenant_id = :'TENANT_ID_TONINO';

\echo ===== 0b. MARIA ROSSI (DOVREBBE ESSERCI 1) =====
SELECT
  id::text,
  customer_name,
  customer_email,
  confirmed,
  start_at AT TIME ZONE 'Europe/Rome' AS start_it
FROM public.bookings
WHERE tenant_id = :'TENANT_ID_TONINO'
  AND customer_name LIKE '%Maria Rossi%'
LIMIT 2;

\echo ===== 1. BOOKING LUCA BIANCHI =====
SELECT
  id::text,
  external_ref,
  customer_name,
  customer_email,
  customer_phone,
  customer_notes,
  service_id::text,
  resource_id::text,
  start_at AT TIME ZONE 'Europe/Rome' AS inizio_it,
  end_at AT TIME ZONE 'Europe/Rome' AS fine_it,
  status,
  confirmed,
  deposit_paid,
  gdpr_consent,
  created_at
FROM public.bookings
WHERE tenant_id = :'TENANT_ID_TONINO'
ORDER BY created_at DESC
LIMIT 5;

\echo ===== 2. TUTTI I CUSTOMERS DI TONINO =====
SELECT count(*) AS customers_count FROM public.customers WHERE tenant_id = :'TENANT_ID_TONINO';
SELECT
  id::text,
  full_name,
  email,
  phone,
  gdpr_consent,
  bookings_count,
  first_booking_at,
  last_booking_at
FROM public.customers
WHERE tenant_id = :'TENANT_ID_TONINO'
ORDER BY last_booking_at DESC NULLS LAST
LIMIT 5;

\echo ===== 3. SERVICES MASSAGGIO 60MIN =====
SELECT id::text, name, price_cents FROM public.services
WHERE tenant_id = :'TENANT_ID_TONINO' AND name LIKE '%Massaggio%60min%';

\echo ===== 4. SLOT 15 SET FASCIA 09:30-11:00 =====
SELECT
  to_char(slot_start AT TIME ZONE 'Europe/Rome','HH24:MI') AS ora_it,
  is_available,
  reason
FROM public.public_slot_get_available_v3(
  :'TENANT_ID_TONINO'::uuid,
  (SELECT id FROM public.services WHERE tenant_id = :'TENANT_ID_TONINO' AND name LIKE '%Massaggio rilassante corpo 60min%' LIMIT 1),
  NULL::uuid,
  '2026-09-15 00:00:00+02'::timestamptz,
  '2026-09-15 23:59:59+02'::timestamptz
)
WHERE to_char(slot_start AT TIME ZONE 'Europe/Rome','HH24:MI') IN ('09:30','09:45','10:00','10:15','10:30','11:00')
ORDER BY slot_start;

\echo ===== 5. CROSS TENANT =====
SELECT count(*) AS luca_altri_tenant FROM public.bookings
WHERE tenant_id <> :'TENANT_ID_TONINO' AND customer_email = 'luca.bianchi@f2-secondo.velora.test';

\echo ===== FINE =====
