-- ============================================================
-- FASE 2 · TASK 2.1 — ESTENSIONE ENUM STATI + COLONNE FAILURE
-- ============================================================
-- Estende booking_payment_status_enum con 'failed' e 'refunded'
-- Aggiunge colonne failure_reason e failure_code a payments
-- Idempotente: safe da rieseguire
-- ============================================================

-- 1) Estendi enum booking_payment_status_enum: aggiungi 'failed'
DO $$
DECLARE
  enum_type oid;
  val_exists boolean;
BEGIN
  SELECT oid INTO enum_type FROM pg_type WHERE typname = 'booking_payment_status_enum';
  
  IF enum_type IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumtypid = enum_type 
      AND enumlabel = 'failed'
    ) INTO val_exists;
    
    IF NOT val_exists THEN
      EXECUTE 'ALTER TYPE public.booking_payment_status_enum ADD VALUE ''failed''';
    END IF;
  END IF;
END $$;

-- 2) Estendi enum booking_payment_status_enum: aggiungi 'refunded'
DO $$
DECLARE
  enum_type oid;
  val_exists boolean;
BEGIN
  SELECT oid INTO enum_type FROM pg_type WHERE typname = 'booking_payment_status_enum';
  
  IF enum_type IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumtypid = enum_type 
      AND enumlabel = 'refunded'
    ) INTO val_exists;
    
    IF NOT val_exists THEN
      EXECUTE 'ALTER TYPE public.booking_payment_status_enum ADD VALUE ''refunded''';
    END IF;
  END IF;
END $$;

-- 3) Aggiungi colonna failure_reason a payments (messaggio errore esteso)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS failure_reason text NULL;

-- 4) Aggiungi colonna failure_code a payments (codice errore Stripe)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS failure_code text NULL;

-- 5) Commento per audit
COMMENT ON COLUMN public.payments.failure_reason IS 'Messaggio di errore esteso da Stripe last_payment_error.message in caso di pagamento fallito';
COMMENT ON COLUMN public.payments.failure_code IS 'Codice di errore Stripe (es. card_declined, insufficient_funds) in caso di pagamento fallito';
