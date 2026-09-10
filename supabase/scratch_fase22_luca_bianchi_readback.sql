-- FASE 22.1 READ BACK BOOKING LUCA BIANCHI + CUSTOMER + SLOT OCCUPATO
-- exit psql con ON_ERROR_STOP=1

\set ON_ERROR_STOP 1
\x auto

-- 1. Conosciamo tenant_id Tonino
SELECT tenant_id, slug, name FROM public.tenants WHERE slug = 'slugo-mtu30v76-1fon' \gset tonino_

\echo ===== 1. TENANT TONINO =====
\echo tenant_id=:tonino_tenant_id slug=:tonino_slug name=:tonino_name

-- 2. Ultimo booking Tonino per cliente Luca Bianchi Cliente Due / email luca.bianchi@f2-secondo.velora.test
\echo ===== 2. READ BACK BOOKING LUCA BIANCHI =====
SELECT
  b.id::text AS booking_id,
  b.tenant_id::text,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  b.customer_notes,
  b.service_id::text,
  s.name AS service_name,
  s.price_cents,
  b.resource_id::text,
  r.display_name AS staff_name,
  b.start_at AT TIME ZONE 'UTC' AS start_utc,
  b.start_at AT TIME ZONE 'Europe/Rome' AS start_italy,
  b.end_at AT TIME ZONE 'Europe/Rome' AS end_italy,
  b.status,
  b.confirmed,
  b.deposit_strategy,
  b.deposit_value_cents,
  b.deposit_paid,
  b.created_at,
  b.gdpr_consent,
  b.external_ref
FROM public.bookings b
LEFT JOIN public.services s ON s.id = b.service_id
LEFT JOIN public.staff_resources r ON r.id = b.resource_id
WHERE b.tenant_id = :'tonino_tenant_id'
  AND (b.customer_email = 'luca.bianchi@f2-secondo.velora.test' OR b.customer_name LIKE '%Luca Bianchi%')
ORDER BY b.created_at DESC
LIMIT 1;

-- 3. Tutti bookings Tonino (include Maria Rossi 14/09 e Luca 15/09)
\echo ===== 3. TUTTI BOOKINGS TONINO =====
SELECT
  customer_name,
  customer_email,
  to_char(start_at AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') AS start_it,
  status,
  confirmed,
  deposit_paid
FROM public.bookings
WHERE tenant_id = :'tonino_tenant_id'
ORDER BY start_at ASC;

-- 4. Customer upsert email luca.bianchi@
\echo ===== 4. CUSTOMER UPSERT LUCA@ =====
SELECT
  id::text,
  tenant_id::text,
  full_name,
  email,
  phone,
  gdpr_consent,
  bookings_count,
  first_booking_at,
  last_booking_at,
  created_at,
  updated_at
FROM public.customers
WHERE tenant_id = :'tonino_tenant_id'
  AND email = 'luca.bianchi@f2-secondo.velora.test';

-- 5. Slot 15/09 10:00 IT ORA DOVREBBE ESSERE OCCUPATO (non più disponibile)
\echo ===== 5. SLOT ENGINE: slot disponibili 15 set 2026 Massaggio 60min dopo booking Luca =====
SELECT
  to_char(slot_start AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS time_it,
  is_available,
  reason,
  booking_id::text
FROM public.public_slot_get_available_v3(
  :'tonino_tenant_id',
  (SELECT id FROM public.services WHERE tenant_id = :'tonino_tenant_id' AND name LIKE '%Massaggio rilassante corpo 60min%' LIMIT 1),
  NULL::uuid,
  '2026-09-15 00:00:00+02'::timestamptz,
  '2026-09-15 23:59:59+02'::timestamptz
)
WHERE is_available = FALSE OR to_char(slot_start AT TIME ZONE 'Europe/Rome', 'HH24:MI') = '10:00'
ORDER BY slot_start ASC;

-- 6. Totale bookings cross-tenant leak (count Luca Bianchi in tenant diversi da Tonino)
\echo ===== 6. TENANT ISOLATION: count luca.bianchi@ IN ALTRI TENANT =====
SELECT count(*) AS luca_altri_tenant_leak_count
FROM public.bookings
WHERE tenant_id <> :'tonino_tenant_id'
  AND customer_email = 'luca.bianchi@f2-secondo.velora.test';

\echo ===== FINE FASE22.1 READ BACK =====
