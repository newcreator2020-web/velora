-- ============================================================
-- FASE 15 · TASK B4 — PAGAMENTI E CAPARRE STRIPE
-- ============================================================
-- - deposit_strategy_enum + colonne services (deposit_strategy / deposit_value)
-- - Tabella public.payments (Stripe checkout session + payment intent)
-- - booking_payment_status_enum + bookings.payment_status + bookings.deposit_amount
-- - Trigger updated_at payments
-- - RLS + Grants + Indici
-- ============================================================

-- 1) Enum strategia caparra
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deposit_strategy_enum') THEN
    CREATE TYPE public.deposit_strategy_enum AS ENUM (
      'NONE',
      'PERCENT',
      'FIXED'
    );
  END IF;
END $$;

-- 2) Enum stato pagamento singolo
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
    CREATE TYPE public.payment_status_enum AS ENUM (
      'pending',
      'paid',
      'failed',
      'refunded',
      'partially_refunded',
      'disputed'
    );
  END IF;
END $$;

-- 3) Enum stato pagamento booking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_payment_status_enum') THEN
    CREATE TYPE public.booking_payment_status_enum AS ENUM (
      'unpaid',
      'deposit_paid',
      'paid'
    );
  END IF;
END $$;

-- 4) Colonne services: strategia + valore caparra
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS deposit_strategy public.deposit_strategy_enum NOT NULL DEFAULT 'NONE';

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS deposit_value numeric(10,2) NOT NULL DEFAULT 0;

-- 5) Tabella payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  stripe_session_id text NULL,
  stripe_payment_intent_id text NULL,
  stripe_customer_id text NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  status public.payment_status_enum NOT NULL DEFAULT 'pending',
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6) Colonne bookings: payment_status e deposit_amount
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status public.booking_payment_status_enum NOT NULL DEFAULT 'unpaid';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2) NULL;

-- 7) Unique constraints (nessun doppio session / pi / idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_session_id_unique
  ON public.payments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_id_unique
  ON public.payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_unique
  ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 8) Trigger updated_at payments
DROP TRIGGER IF EXISTS set_public_payments_updated_at ON public.payments;
CREATE TRIGGER set_public_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- 9) RLS payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_anon_insert ON public.payments;
CREATE POLICY payments_anon_insert ON public.payments
  FOR INSERT TO anon
  WITH CHECK (
    status = 'pending'::public.payment_status_enum
  );

DROP POLICY IF EXISTS payments_authenticated_select ON public.payments;
CREATE POLICY payments_authenticated_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner', 'manager'])
    OR public.is_tenant_member(tenant_id)
  );

DROP POLICY IF EXISTS payments_service_role_all ON public.payments;
CREATE POLICY payments_service_role_all ON public.payments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 10) Grants
GRANT INSERT ON public.payments TO anon;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

-- 11) Indici prestazioni
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id_created_at
  ON public.payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id
  ON public.payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session_id_idx
  ON public.payments (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency_key_idx
  ON public.payments (idempotency_key);
