-- FASE 22.1 READ BACK DIRETTO SENZA CTE
\set ON_ERROR_STOP 1
\x auto

-- Tenant Tonino ID confermato da membership + summary
\set TENANT_ID_TONINO 'd5a0538e-567e-45ee-b00e-61659ed50637'

\echo ===== 0. CONFERMA TENANT, SERVIZIO MASSAGGIO E BOOKINGS MARIA PREESISTENTE =====
SELECT id::text, slug, name FROM public.tenants WHERE id = :'TENANT_ID_TONINO';
SELECT count(*) AS maria_rossi_count, customer_name, confirmed
  FROM public.bookings
 WHERE tenant_id = :'TENANT_ID_TONINO'
   AND customer_name LIKE '%Maria Rossi%'
 GROUP BY 2,3;
SELECT id::text AS massaggio_id, name, price_cents/100 AS prezzo_euro
  FROM public.services
 WHERE tenant_id = :'TENANT_ID_TONINO'
   AND name LIKE '%Massaggio%60min%';

\echo ===== 1. BOOKING LUCA BIANCHI — CERCA PER EMAIL O NOME =====
SELECT
  b.id::text AS booking_id,
  b.external_ref,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  substr(b.customer_notes,1,100) AS note,
  s.name AS servizio,
  round(s.price_cents/100.0,2) AS euro,
  to_char(b.start_at AT TIME ZONE 'Europe/Rome','DD/MM/YYYY HH24:MI') AS inizio_it,
  to_char(b.end_at   AT TIME ZONE 'Europe/Rome','HH24:MI') AS fine_it,
  b.status,
  b.confirmed,
  b.deposit_paid,
  b.gdpr_consent,
  b.created_at
FROM public.bookings b
LEFT JOIN public.services s ON s.id = b.service_id
WHERE b.tenant_id = :'TENANT_ID_TONINO'
  AND (
    b.customer_email = 'luca.bianchi@f2-secondo.velora.test'
    OR b.customer_name LIKE '%Luca Bianchi%'
    OR b.external_ref IS NOT NULL
  )
ORDER BY b.created_at DESC
LIMIT 3;

\echo ===== 2. TUTTI BOOKINGS TONINO ORDINE DATA =====
SELECT
  b.id::text AS id,
  substr(b.customer_name,1,25) AS nome,
  substr(coalesce(b.customer_email,''),1,30) AS email,
  to_char(b.start_at AT TIME ZONE 'Europe/Rome','DD/MM HH24:MI') AS dt,
  substr(s.name,1,20) AS svc,
  b.status,
  b.confirmed AS cnf,
  b.deposit_paid AS cap,
  b.external_ref
FROM public.bookings b
LEFT JOIN public.services s ON s.id = b.service_id
WHERE b.tenant_id = :'TENANT_ID_TONINO'
ORDER BY b.start_at ASC;

\echo ===== 3. CUSTOMER LUCA BIANCHI UPSERT =====
SELECT
  c.id::text AS customer_id,
  c.full_name,
  c.email,
  c.phone,
  c.gdpr_consent,
  c.bookings_count,
  to_char(c.first_booking_at,'YYYY-MM-DD') AS first_bk,
  to_char(c.last_booking_at,'YYYY-MM-DD') AS last_bk
FROM public.customers c
WHERE c.tenant_id = :'TENANT_ID_TONINO'
  AND c.email = 'luca.bianchi@f2-secondo.velora.test';

\echo ===== 4. CUSTOMERS TONINO TUTTI =====
SELECT count(*) AS customers_tonino_count FROM public.customers WHERE tenant_id = :'TENANT_ID_TONINO';
SELECT full_name, email, bookings_count FROM public.customers
 WHERE tenant_id = :'TENANT_ID_TONINO'
 ORDER BY bookings_count DESC NULLS LAST LIMIT 5;

\echo ===== 5. SLOT ENGINE: 15 set 2026 fascia 09:45-11:00 — 10:00 DOVREBBE ESSERE OCCUPATO =====
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
ORDER BY slot_start ASC;

\echo ===== 6. CROSS TENANT ISOL: luca.bianchi@ count IN ALTRI =====
SELECT count(*) AS luca_leak FROM public.bookings
 WHERE tenant_id <> :'TENANT_ID_TONINO' AND customer_email = 'luca.bianchi@f2-secondo.velora.test';
SELECT count(*) AS maria_leak FROM public.bookings
 WHERE tenant_id <> :'TENANT_ID_TONINO' AND customer_email = 'maria.rossi@f2-tonino.it';

\echo ===== FINE FASE22 READ BACK DIRETTO =====
