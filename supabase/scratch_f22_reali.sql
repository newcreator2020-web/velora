-- FASE 22.1 READ BACK NOMI COLONNE REALI (dopo \d bookings)
\set TENANT 'd5a0538e-567e-45ee-b00e-61659ed50637'
\x auto

\echo ===== 1. DETTAGLIO 2 BOOKINGS TONINO (starts_at / notes / status REALI) =====
SELECT
  b.id::text AS booking_id,
  b.customer_name,
  b.customer_email,
  b.customer_phone,
  substr(b.notes,1,100) AS note_booking,
  to_char(b.starts_at AT TIME ZONE 'Europe/Rome','DD/MM/YYYY HH24:MI') AS start_italia,
  to_char(b.ends_at   AT TIME ZONE 'Europe/Rome','HH24:MI') AS end_italia,
  b.status,
  b.payment_status,
  b.deposit_amount,
  b.resource_id::text,
  s.name AS servizio,
  (s.price_cents / 100.0)::numeric(10,2) AS prezzo_euro,
  b.created_at
FROM public.bookings b
LEFT JOIN public.services s ON s.id = b.service_id
WHERE b.tenant_id = :'TENANT'
ORDER BY b.starts_at ASC;

\echo ===== 2. CUSTOMERS TONINO 2 RIGHE =====
SELECT
  c.id::text AS customer_id,
  c.full_name,
  c.email,
  c.phone,
  c.gdpr_consent,
  c.bookings_count,
  to_char(c.first_booking_at AT TIME ZONE 'Europe/Rome','DD/MM HH24:MI') AS first_bk_it,
  to_char(c.last_booking_at  AT TIME ZONE 'Europe/Rome','DD/MM HH24:MI') AS last_bk_it
FROM public.customers c
WHERE c.tenant_id = :'TENANT'
ORDER BY c.last_booking_at DESC NULLS LAST;

\echo ===== 3. SERVICES TONINO LISTA BREVE =====
SELECT s.id::text, s.name, s.price_cents/100 AS euro
FROM public.services s
WHERE s.tenant_id = :'TENANT'
ORDER BY euro DESC
LIMIT 5;

\echo ===== 4. SLOT 15/09 10:00 IT STATO =====
SELECT
  to_char(slot_start AT TIME ZONE 'Europe/Rome','HH24:MI') AS ora,
  is_available,
  reason
FROM public.public_slot_get_available_v3(
  :'TENANT'::uuid,
  (SELECT id FROM public.services WHERE tenant_id=:'TENANT' LIMIT 1 OFFSET 1),
  NULL::uuid,
  '2026-09-15 00:00+02'::timestamptz,
  '2026-09-15 23:59+02'::timestamptz
)
WHERE to_char(slot_start AT TIME ZONE 'Europe/Rome','HH24:MI') IN ('09:45','10:00','10:15')
ORDER BY slot_start;

\echo ===== FINE =====
