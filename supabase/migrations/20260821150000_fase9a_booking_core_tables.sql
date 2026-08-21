-- FASE 9a: Booking Core Tables — business_availability + bookings.
-- APPEND-ONLY. No alterazioni a migration frozen FASE1..FASE8.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- ----------------------------------------------------------------------------
-- business_availability: orari settimanali dell'attività.
-- 1 riga per tenant + weekday (0=Sun, 1=Mon ... 6=Sat).
-- enabled=true indica intervallo attivo; start_time/end_time locale.
-- Source of truth for "business è aperto?"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_availability (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TIME NOT NULL DEFAULT '09:00'::time,
  end_time   TIME NOT NULL DEFAULT '18:00'::time,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, weekday),
  CONSTRAINT business_availability_hours_order CHECK (start_time < end_time)
);

-- Indice per velocizzare select tenant_id (già coperto da PK, ma esplicito per query range)
CREATE INDEX IF NOT EXISTS business_availability_tenant_idx ON public.business_availability (tenant_id);

-- ----------------------------------------------------------------------------
-- bookings: appuntamenti confermati o cancellati.
-- Source of Truth per appointment.
-- Concurrency: EXCLUSION CONSTRAINT con gist tstzrange per garantire
--   STESSO TENANT, STESSO SERVICE, (tenant_id, service_id, booking_range)
--   no overlap confirmed bookings.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID NOT NULL PRIMARY KEY DEFAULT public.gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  status    TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  customer_name  TEXT NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  customer_email TEXT NULL CHECK (customer_email IS NULL OR (char_length(customer_email) BETWEEN 3 AND 254 AND customer_email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')),
  customer_phone TEXT NULL CHECK (customer_phone IS NULL OR (char_length(customer_phone) BETWEEN 4 AND 32 AND customer_phone ~ '^[0-9+\-\s()]{4,32}$')),
  notes          TEXT NULL CHECK (notes IS NULL OR char_length(notes) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bookings_order_check CHECK (starts_at < ends_at),
  CONSTRAINT bookings_at_least_one_contact CHECK (
    char_length(customer_email) > 0 OR char_length(customer_phone) > 0
  )
);

-- Exclusion constraint anti double booking confirmed.
-- Due prenotazioni confirmed con stesso service e stesso tenant con range temporale
-- in sovrapposizione = RIFIUTO DB LEVEL.
-- Cancellate non bloccano (con predicate WHERE status='confirmed').
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_overlap_confirmed;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlap_confirmed
  EXCLUDE USING gist (
    tenant_id WITH =,
    service_id WITH =,
    TSTZRANGE(starts_at, ends_at, '[)') WITH &&
  ) WITH (FILLFACTOR = 90) WHERE (public.bookings.status = 'confirmed');

CREATE INDEX IF NOT EXISTS bookings_tenant_idx ON public.bookings (tenant_id);
CREATE INDEX IF NOT EXISTS bookings_tenant_service_idx ON public.bookings (tenant_id, service_id);
CREATE INDEX IF NOT EXISTS bookings_tenant_status_starts_idx ON public.bookings (tenant_id, status, starts_at);
CREATE INDEX IF NOT EXISTS bookings_tenant_starts_idx ON public.bookings (tenant_id, starts_at);

-- Trigger updated_at
DO $$ BEGIN
  CREATE TRIGGER set_business_availability_updated_at
  BEFORE UPDATE ON public.business_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY (come FASE8i standard per tutte le tenant-sensitive).
-- ----------------------------------------------------------------------------
ALTER TABLE public.business_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_availability FORCE ROW LEVEL SECURITY;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings FORCE ROW LEVEL SECURITY;
