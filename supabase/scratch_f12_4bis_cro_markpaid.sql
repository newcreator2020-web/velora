-- ============================================================
-- F12.4 BIS: 1) Salva CRO Simone Verdi direttamente via RPC
--            2) Segna caparra pagata tramite UPDATE diretto
--            3) READ BACK FINALE
-- ============================================================

-- 1. Chiama RPC anon booking_public_declare_bank_transfer per salvare il CRO
--    (Simone Verdi booking 6a7b0a84-b696-40ee-aad4-17631863d32f)
SELECT public.booking_public_declare_bank_transfer(
  '6a7b0a84-b696-40ee-aad4-17631863d32f'::uuid,
  'simone.verdi.f12@velora.test',
  '202609101234567',
  'Bonifico Banca Popolare eseguito oggi 10/09/2026 - test F12 automatico'
);

-- 2. Segna la caparra PAGATA direttamente (per test backoffice mark, bypass authz psql superuser)
--    Poi la RPC di backoffice la richiamiamo nel browser; prima verifichiamo DB.
UPDATE public.bookings b
SET
  payment_status = 'deposit_paid'::booking_payment_status_enum,
  deposit_paid_at = NOW(),
  deposit_confirmed_by = '9df5232e-2303-4a6f-b643-f2386ac92ec1'::uuid,
  deposit_payment_method = COALESCE(NULLIF(b.deposit_payment_method, ''), 'bank_transfer'),
  updated_at = NOW()
WHERE b.id = '6a7b0a84-b696-40ee-aad4-17631863d32f';

-- 3. READ BACK FINALE dettaglio Simone Verdi
SELECT
  left(b.id::text, 8) as booking_code_ui,
  b.customer_name,
  b.customer_email,
  b.starts_at at time zone 'Europe/Rome' as data_italia,
  b.status,
  b.payment_status,
  to_char((b.deposit_amount / 100.0), 'FM999G999D00') as caparra_euro,
  b.deposit_payment_method,
  b.deposit_payment_ref as CRO,
  b.deposit_payment_note,
  to_char(b.deposit_requested_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI') as dichiarato_italia,
  to_char(b.deposit_paid_at at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI') as pagato_italia,
  left(b.deposit_confirmed_by::text, 8) as pagato_da_user_id
FROM public.bookings b
WHERE b.tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
  AND b.customer_name LIKE 'Simone Verdi%'
ORDER BY b.created_at DESC
LIMIT 1;

-- 4. Stato pagamenti Tonino 3 prenotazioni
SELECT
  count(*) as bookings_totali,
  count(*) filter (where payment_status = 'deposit_pending_bank') as bonifico_in_attesa,
  count(*) filter (where payment_status = 'deposit_paid') as caparra_pagata,
  count(*) filter (where payment_status = 'paid') as saldo_pagato,
  count(*) filter (where payment_status = 'unpaid') as non_pagato
FROM public.bookings
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637';
