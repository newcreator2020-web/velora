-- FASE 22.1 READ BACK BOOKING LUCA BIANCHI SENZA GSET
\set ON_ERROR_STOP 0
\x auto

WITH tonino AS (
  SELECT t.id AS tenant_id, t.slug, t.name
  FROM public.tenants t
  WHERE t.slug = 'slugo_mtu30v76_1_fon'
     OR REPLACE(t.slug, '_', '-') = 'slugo-mtu30v76-1fon'
  LIMIT 1
)
SELECT '1. TENANT TONINO' AS step,
       tenant_id::text, slug, name
FROM tonino \gset

\echo ===== 1. TENANT ===== tenant_id=:tenant_id slug=:slug name=:name

\echo ===== 2. BOOKING LUCA BIANCHI (ultimo 1) =====
SELECT
  b.id::text AS booking_id,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  substr(b.customer_notes,1,80) AS note_trunc,
  s.name AS servizio,
  s.price_cents / 100.0 AS prezzo_euro,
  to_char(b.start_at AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') AS inizio_italia,
  to_char(b.end_at   AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') AS fine_italia,
  b.status,
  b.confirmed,
  b.deposit_paid,
  b.gdpr_consent,
  b.external_ref,
  b.created_at
FROM public.bookings b
LEFT JOIN public.services s ON s.id = b.service_id
WHERE b.tenant_id = (SELECT tenant_id FROM tonino)
  AND (b.customer_email = 'luca.bianchi@f2-secondo.velora.test'
       OR b.customer_name LIKE '%Luca Bianchi%')
ORDER BY b.created_at DESC
LIMIT 1;

\echo ===== 3. TUTTI BOOKINGS TONINO (ordinati data) =====
SELECT
  customer_name,
  customer_email,
  to_char(start_at AT TIME ZONE 'Europe/Rome', 'DD/MM HH24:MI') AS data_ora_it,
  status,
  confirmed AS conf,
  deposit_paid AS cap_pagata
FROM public.bookings
WHERE tenant_id = (SELECT tenant_id FROM tonino)
ORDER BY start_at ASC;

\echo ===== 4. CUSTOMER LUCA (upsert check) =====
SELECT
  id::text AS customer_id,
  full_name,
  email,
  phone,
  gdpr_consent,
  bookings_count,
  to_char(first_booking_at,'YYYY-MM-DD') AS first_bk,
  to_char(last_booking_at,'YYYY-MM-DD') AS last_bk
FROM public.customers
WHERE tenant_id = (SELECT tenant_id FROM tonino)
  AND email = 'luca.bianchi@f2-secondo.velora.test';

\echo ===== 5. SLOT 15 SETT. DOPO BOOKING: 10:00 IT DOVREBBE NON DISPONIBILE =====
SELECT
  to_char(slot_start AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora_it,
  is_available,
  reason
FROM public.public_slot_get_available_v3(
  (SELECT tenant_id FROM tonino),
  (SELECT id FROM public.services WHERE tenant_id = (SELECT tenant_id FROM tonino) AND name LIKE '%Massaggio rilassante corpo 60min%' LIMIT 1),
  NULL::uuid,
  '2026-09-15 00:00:00+02'::timestamptz,
  '2026-09-15 23:59:59+02'::timestamptz
)
WHERE to_char(slot_start AT TIME ZONE 'Europe/Rome','HH24:MI') IN ('09:45','10:00','10:15','11:00')
ORDER BY slot_start;

\echo ===== 6. CROSS-TENANT ISOLATION: luca.bianchi@ FUORI TONINO =====
SELECT count(*) AS luca_leak_count
FROM public.bookings
WHERE tenant_id <> (SELECT tenant_id FROM tonino)
  AND customer_email = 'luca.bianchi@f2-secondo.velora.test';

\echo ===== 7. CONTEGGIO BOOKINGS TONINO OGGI =====
SELECT count(*) AS bookings_tonino_totali
FROM public.bookings
WHERE tenant_id = (SELECT tenant_id FROM tonino);

\echo ===== FINE READ BACK FASE 22.1 =====
