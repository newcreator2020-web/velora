-- ============================================================
-- F12.4 READ BACK BOOKING SIMONE VERDI + PAGAMENTO BONIFICO
-- ============================================================
-- 1. Verifica prenotazione Simone Verdi del 16/09/2026 11:00 IT
-- 2. Verifica stato pagamento deposit_pending_bank e CRO salvato
-- 3. Conta totale bookings Tonino (dovrebbe essere 3 adesso)
-- ============================================================

-- 1. Trova la prenotazione per cliente Simone Verdi F12
SELECT 
  id as booking_id,
  external_ref,
  customer_name,
  customer_email,
  starts_at at time zone 'Europe/Rome' as starts_at_italy,
  ends_at at time zone 'Europe/Rome' as ends_at_italy,
  status,
  payment_status,
  to_char((deposit_amount / 100.0), 'FM999G999D00') as deposit_amount_euro,
  deposit_paid_at,
  deposit_requested_at,
  deposit_payment_method,
  deposit_payment_ref as cro_riferimento,
  deposit_payment_note
FROM public.bookings
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
  AND customer_name LIKE 'Simone Verdi%'
ORDER BY created_at DESC
LIMIT 1;

-- 2. Totale bookings Tonino per conferma count 3
SELECT 
  count(*) as bookings_tonino_totali,
  count(*) filter (where payment_status = 'deposit_pending_bank') as bookings_bonifico_in_attesa,
  count(*) filter (where payment_status = 'deposit_paid') as bookings_caparra_pagata
FROM public.bookings
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';
