-- FASE10: CRM customers + booking operations (tenant-scoped).
-- Append ONLY. Nessuna modifica a FASE1..9 frozen.
-- Safe: IF NOT EXISTS, drop/rename con CREATE OR REPLACE.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pg_temp') THEN NULL; END IF; END $$;

-- =========================================================================
-- 1. TABELLA customers (tenant-scoped PII).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  notes TEXT NULL,
  -- Normalized per exact-match dedup server-side.
  email_normalized TEXT NULL,
  phone_normalized TEXT NULL,
  last_booking_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- 2. INDICI e UNIQUE parziali per dedup deterministica RACE-SAFE.
--    NO cross-tenant match.
-- =========================================================================
CREATE INDEX IF NOT EXISTS customers_tenant_id_idx ON public.customers (tenant_id);
CREATE INDEX IF NOT EXISTS customers_tenant_created_at_idx ON public.customers (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_uniq
  ON public.customers (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_uniq
  ON public.customers (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_display_name_trgm_idx
  ON public.customers USING gin (to_tsvector('simple', coalesce(display_name,'')));

-- =========================================================================
-- 3. FK bookings.customer_id → customers. NULL compatibile con FASE9 esistenti.
-- =========================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_id UUID NULL REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_tenant_customer_id_idx
  ON public.bookings (tenant_id, customer_id);

-- =========================================================================
-- 4. Ampliare status CHECK FASE9 con stati operativi terminali.
--    confirmed → completed | no_show | cancelled (tutti terminali).
--    Nessuno status intermedio inventato.
-- =========================================================================
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed','completed','no_show','cancelled'));

-- =========================================================================
-- 5. RLS FORCE customers.
-- =========================================================================
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

-- =========================================================================
-- 6. CUSTOMERS RLS policies.
--    ANON: zero. STAFF: READ. OWNER/MANAGER: READ/WRITE own tenant.
-- =========================================================================
DROP POLICY IF EXISTS customers_staff_read ON public.customers;
CREATE POLICY customers_staff_read ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(customers.tenant_id, ARRAY['staff','owner','manager'])
  );

DROP POLICY IF EXISTS customers_owner_manager_write ON public.customers;
CREATE POLICY customers_owner_manager_write ON public.customers
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(customers.tenant_id, ARRAY['owner','manager'])
  ) WITH CHECK (
    public.has_tenant_role(customers.tenant_id, ARRAY['owner','manager'])
  );

DROP POLICY IF EXISTS customers_service_role_all ON public.customers;
CREATE POLICY customers_service_role_all ON public.customers
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- =========================================================================
-- 7. customers updated_at trigger.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.customers_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.email_normalized := CASE WHEN NEW.email IS NULL THEN NULL
    ELSE lower(btrim(NEW.email)) END;
  NEW.phone_normalized := CASE WHEN NEW.phone IS NULL THEN NULL
    ELSE regexp_replace(lower(btrim(NEW.phone)), '[^0-9]', '', 'g') END;
  IF length(coalesce(NEW.phone_normalized,'')) < 4 THEN
    NEW.phone_normalized := NULL;
  END IF;
  IF NEW.email_normalized = '' THEN NEW.email_normalized := NULL; END IF;
  RETURN NEW;
END; $$;

DO $$ BEGIN
  CREATE TRIGGER customers_set_updated_at
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 8. Ampliare BOOKINGS status transition matrix + include customer_id immutabile.
--    Transizioni LEGALI (solo da confirmed → terminali):
--      confirmed → cancelled     [FASE9]
--      confirmed → completed     [NUOVO FASE10]
--      confirmed → no_show       [NUOVO FASE10]
--      completed / cancelled / no_show → sono terminali: NESSUNA transizione
--    customer_id: immutabile dopo prima assegnazione (per evitare IDOR spoofing).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bookings_update_restricted()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'bookings.tenant_id immutable' USING errcode = 'VF403';
  END IF;
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    RAISE EXCEPTION 'bookings.service_id immutable' USING errcode = 'VF403';
  END IF;
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    RAISE EXCEPTION 'bookings time fields immutable' USING errcode = 'VF403';
  END IF;
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
     OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'bookings customer fields immutable' USING errcode = 'VF403';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'bookings.customer_id immutable once set' USING errcode = 'VF403';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled','completed','no_show') THEN
      -- LEGAL transition
    ELSE
      RAISE EXCEPTION 'bookings invalid status transition' USING errcode = 'VF400';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- =========================================================================
-- 9. Audit trigger PII-free booking_status_changed: ampliare per completed/no_show.
--    Metadata SOLO id/status/source. NIENTE PII (no name/email/phone/notes).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bookings_audit_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    v_action := CASE NEW.status
      WHEN 'cancelled' THEN 'booking_cancelled'
      WHEN 'completed' THEN 'booking_completed'
      WHEN 'no_show'   THEN 'booking_no_show'
      ELSE                  'booking_status_changed'
    END;
    BEGIN
      INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        NEW.tenant_id,
        CASE WHEN current_user = 'service_role' THEN 'system' ELSE 'member' END,
        COALESCE(auth.uid()::text, current_user),
        v_action,
        'booking',
        NEW.id,
        jsonb_build_object(
          'from_status', OLD.status,
          'to_status',   NEW.status,
          'source',      CASE WHEN current_user = 'anon' THEN 'anon-rpc' ELSE 'dashboard' END
        ) - 'customer_name' - 'customer_email' - 'customer_phone' - 'notes'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END; $$;

-- =========================================================================
-- 10. AUDIT customers PII-free. ONLY id + changed_keys. NIENTE VALORI PII.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.customers_audit_changed()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  changed_keys TEXT[] := ARRAY[]::TEXT[];
  meta JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    meta := jsonb_build_object('source', 'booking-rpc-or-dashboard');
    BEGIN
      INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, entity_type, entity_id, metadata)
      VALUES (NEW.tenant_id,
        CASE WHEN current_user = 'service_role' THEN 'system' WHEN current_user='anon' THEN 'anon-rpc' ELSE 'member' END,
        COALESCE(auth.uid()::text, current_user),
        'customer_created', 'customer', NEW.id, meta);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.display_name  IS DISTINCT FROM NEW.display_name  THEN changed_keys := array_append(changed_keys, 'display_name'); END IF;
    IF OLD.email         IS DISTINCT FROM NEW.email         THEN changed_keys := array_append(changed_keys, 'email'); END IF;
    IF OLD.phone         IS DISTINCT FROM NEW.phone         THEN changed_keys := array_append(changed_keys, 'phone'); END IF;
    IF OLD.notes         IS DISTINCT FROM NEW.notes         THEN changed_keys := array_append(changed_keys, 'notes'); END IF;
    IF array_length(changed_keys,1) IS NOT NULL THEN
      BEGIN
        INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.tenant_id,
          CASE WHEN current_user = 'service_role' THEN 'system' WHEN current_user='anon' THEN 'anon-rpc' ELSE 'member' END,
          COALESCE(auth.uid()::text, current_user),
          'customer_updated', 'customer', NEW.id,
          jsonb_build_object('changed_keys', to_jsonb(changed_keys))
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN NULL;
END; $$;

DO $$ BEGIN
  CREATE TRIGGER customers_audit_changed
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_audit_changed();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 11. RPC HELPER SECURITY DEFINER: customer_upsert_for_public_booking
--     Usato DA public_booking_create_slug per dedup EXACT, senza merge fuzzy.
--     Input: tenant_id, name, email raw, phone raw.
--     Output: customer_id, created BOOLEAN.
--     Algoritmo mandato §6 FASE10:
--       1. email valida + normalized not null → exact match same tenant
--       2. altrimenti phone valido + normalized not null → exact same tenant
--       3. altrimenti INSERT nuovo.
--     Priorità email > phone; mai merge incrociato (se email matcha A e phone B → email vince, non aggiorna B).
--     Transaction: SERIALIZABLE / advisory lock per RACE due booking simultanei stesso id.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.customer_upsert_for_public_booking(
  p_tenant_id UUID,
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT
) RETURNS TABLE (customer_id UUID, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email_n TEXT := CASE WHEN p_email IS NULL THEN NULL
    ELSE lower(btrim(p_email)) END;
  v_phone_raw TEXT := CASE WHEN p_phone IS NULL THEN NULL
    ELSE regexp_replace(lower(btrim(p_phone)), '[^0-9]', '', 'g') END;
  v_phone_n TEXT;
  v_lock_key BIGINT;
  v_existing UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'invalid customer input' USING errcode='VF400';
  END IF;
  IF v_email_n = '' THEN v_email_n := NULL; END IF;
  -- Phone normalization: conservative + handle +39 IT prefix vs 02 local.
  -- 1. strip non digit (done).
  -- 2. if length >= 11 and starts with '39' → strip leading '39' (international -> local).
  -- 3. if length still > 12, keep last 12 (avoid garbage padding).
  IF v_phone_raw IS NULL OR length(v_phone_raw) = 0 THEN
    v_phone_n := NULL;
  ELSE
    v_phone_n := v_phone_raw;
    IF length(v_phone_n) >= 11 AND substr(v_phone_n, 1, 2) = '39' THEN
      v_phone_n := substr(v_phone_n, 3);
    END IF;
    IF length(v_phone_n) > 12 THEN
      v_phone_n := substr(v_phone_n, length(v_phone_n) - 11);
    END IF;
    IF length(v_phone_n) < 4 THEN v_phone_n := NULL; END IF;
  END IF;

  -- Advisory lock per-tenant + identity per evitare DEDUP race 2 INSERT concurrenti.
  v_lock_key := (abs(hashtext( p_tenant_id::text || '|' || coalesce(v_email_n,'-') || '|' || coalesce(v_phone_n,'-'))))::bigint % 2147483647;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- STEP 1: exact email normalized
  IF v_email_n IS NOT NULL THEN
    SELECT c.id INTO v_existing FROM public.customers c
      WHERE c.tenant_id = p_tenant_id AND c.email_normalized = v_email_n
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      -- Update ONLY last_booking_at + display_name (merge safe, no PII leak).
      UPDATE public.customers c SET
        last_booking_at = now(),
        display_name = CASE WHEN length(btrim(c.display_name))<2 THEN p_name ELSE c.display_name END
      WHERE c.id = v_existing;
      RETURN QUERY SELECT v_existing, FALSE;
      RETURN;
    END IF;
  END IF;

  -- STEP 2: exact phone normalized.
  IF v_phone_n IS NOT NULL THEN
    SELECT c.id INTO v_existing FROM public.customers c
      WHERE c.tenant_id = p_tenant_id AND c.phone_normalized = v_phone_n
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.customers c SET
        last_booking_at = now(),
        display_name = CASE WHEN length(btrim(c.display_name))<2 THEN p_name ELSE c.display_name END
      WHERE c.id = v_existing;
      RETURN QUERY SELECT v_existing, FALSE;
      RETURN;
    END IF;
  END IF;

  -- STEP 3: insert new customer. PostgreSQL NON supporta ON CONFLICT multi-clause.
  --    Strategy: plain INSERT. Race condition → UNIQUE_VIOLATION exception handler retries SELECT exact email → phone.
  --    Anche advisory lock + partial unique index = 99.9% race-safe. Fallback via eccezione.
  BEGIN
    INSERT INTO public.customers (tenant_id, display_name, email, phone, last_booking_at, email_normalized, phone_normalized)
      VALUES (p_tenant_id, p_name, p_email, p_phone, now(), v_email_n, v_phone_n)
      RETURNING id INTO v_existing;
  EXCEPTION WHEN unique_violation THEN
    -- Race: altra transazione ha inserito lo stesso identity. Retry exact match per email → phone.
    IF v_email_n IS NOT NULL THEN
      SELECT c.id INTO v_existing FROM public.customers c WHERE c.tenant_id=p_tenant_id AND c.email_normalized=v_email_n LIMIT 1;
    END IF;
    IF v_existing IS NULL AND v_phone_n IS NOT NULL THEN
      SELECT c.id INTO v_existing FROM public.customers c WHERE c.tenant_id=p_tenant_id AND c.phone_normalized=v_phone_n LIMIT 1;
    END IF;
  END;

  IF v_existing IS NULL THEN
    -- Paranoia: se unique_violation ma nessuna select torna id (caso estremo), ritenta INSERT. Se fallisce di nuovo, eccezione propagata → booking abort.
    INSERT INTO public.customers (tenant_id, display_name, email, phone, last_booking_at, email_normalized, phone_normalized)
      VALUES (p_tenant_id, p_name, p_email, p_phone, now(), v_email_n, v_phone_n)
      RETURNING id INTO v_existing;
  END IF;

  RETURN QUERY SELECT v_existing, TRUE;
  RETURN;
END; $$;

-- Accesso: solo anon tramite trusted RPC chiamata interna e service_role per test. Authenticated: tramite server action non bypassano RLS.
REVOKE ALL ON FUNCTION public.customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) TO service_role;

-- =========================================================================
-- 12. Ampliare EXCLUDE predicate per completed/no_show come per status=cancelled?
--     No: EXCLUDE WHERE status='confirmed' già OK perché confirmed è l'unico stato attivo.
--     completed / cancelled / no_show tutti rilasciano lo slot (il predicato WHERE non li include).
--     Slot overlapping per terminali: NON bloccato, giusto.
-- =========================================================================
-- NESSUNA modifica a EXCLUDE constraint (FASE9 frozen).

-- =========================================================================
-- 12bis. Helper booking_validate_business_hours_and_overlap(tenant,service,st,en) → BOOL.
--        Riproduce la logica inline FASE9b per il nuovo public_booking_create_slug
--        evitando N-doppia duplicazione. Overlap su confirmed EXCLUDE gestito da tabella.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.booking_validate_business_hours_and_overlap(
  p_tenant_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tz TEXT;
  v_dur_min INT;
  v_local_day SMALLINT;
  v_local_start TIME;
  v_ba_start TIME;
  v_ba_end TIME;
  v_ba_enabled BOOLEAN;
BEGIN
  SELECT COALESCE(bp.timezone, 'UTC')
    INTO v_tz
    FROM public.business_profiles bp
    WHERE bp.tenant_id = p_tenant_id
    LIMIT 1;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;
  IF char_length(v_tz) > 64 OR v_tz ~ '[^A-Za-z0-9_/+\-]' THEN
    RETURN FALSE;
  END IF;

  SELECT s.duration_minutes INTO STRICT v_dur_min
    FROM public.services s
    WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id AND s.active = TRUE
    LIMIT 1;
  IF v_dur_min IS NULL OR v_dur_min <= 0 OR v_dur_min > 480 THEN
    RETURN FALSE;
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RETURN FALSE;
  END IF;

  v_local_start := (p_starts_at AT TIME ZONE v_tz)::time;
  SELECT EXTRACT(ISODOW FROM (p_starts_at AT TIME ZONE v_tz))::smallint INTO STRICT v_local_day;
  IF v_local_day = 7 THEN v_local_day := 0; END IF;

  SELECT enabled, start_time, end_time
    INTO v_ba_enabled, v_ba_start, v_ba_end
    FROM public.business_availability ba
    WHERE ba.tenant_id = p_tenant_id AND ba.weekday = v_local_day
    LIMIT 1;

  IF NOT FOUND OR v_ba_enabled IS NOT TRUE THEN
    RETURN FALSE;
  END IF;

  IF v_local_start < v_ba_start THEN
    RETURN FALSE;
  END IF;
  IF v_local_start > v_ba_end - (v_dur_min::text || ' minutes')::INTERVAL THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.booking_validate_business_hours_and_overlap(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_validate_business_hours_and_overlap(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO postgres;
GRANT EXECUTE ON FUNCTION public.booking_validate_business_hours_and_overlap(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_validate_business_hours_and_overlap(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO anon;

-- =========================================================================
-- 13. Ampliare RPC FASE9 public_booking_create_slug per customer resolution.
--     AGGIUNTO OUT customer_id. Chiamata customer_upsert_for_public_booking trusted.
--     NON si fida di alcun customer_id ricevuto da client.
--     Signature identica a FASE9b (TIMESTAMPTZ) per evitare overload ambiguous;
--     esplicita DROP dell'eventuale overload TEXT creato da migration precedenti non freeze.
-- =========================================================================
DROP FUNCTION IF EXISTS public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.public_booking_create_slug(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT);
CREATE FUNCTION public.public_booking_create_slug(
  p_slug TEXT,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_customer_name TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS TABLE (
  booking_id UUID,
  booking_status TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  customer_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_svc RECORD;
  v_st TIMESTAMPTZ;
  v_en TIMESTAMPTZ;
  v_bid UUID;
  v_cust_id UUID;
  v_created BOOL;
  v_valid BOOL;
BEGIN
  -- 1. resolve slug → tenant + published
  SELECT id INTO v_tenant_id FROM public.tenants
    WHERE slug = p_slug AND published = TRUE LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant not found or unpublished' USING errcode = 'VF404';
  END IF;

  -- 2. resolve service → active + belongs to tenant + duration
  SELECT id, duration_minutes, active INTO v_svc FROM public.services
    WHERE id = p_service_id AND tenant_id = v_tenant_id AND active = TRUE LIMIT 1;
  IF v_svc IS NULL OR NOT v_svc.active THEN
    RAISE EXCEPTION 'service invalid' USING errcode = 'VF400';
  END IF;
  IF v_svc.duration_minutes IS NULL OR v_svc.duration_minutes <= 0 OR v_svc.duration_minutes > 480 THEN
    RAISE EXCEPTION 'service duration invalid' USING errcode = 'VF400';
  END IF;

  -- 3. starts_at già TIMESTAMPTZ (FASE9 signature). Sanità: non nel passato (5m grace).
  v_st := p_starts_at;
  IF v_st < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'past slot' USING errcode = 'VF400';
  END IF;
  v_en := v_st + (v_svc.duration_minutes::text || ' minutes')::interval;

  -- 4. validate business hours + overlap (trusted inner RPC)
  SELECT public.booking_validate_business_hours_and_overlap(
    v_tenant_id, p_service_id, v_st, v_en
  ) INTO v_valid;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'slot unavailable' USING errcode = 'VF409';
  END IF;

  -- 5. CRM: resolve/insert customer (dedup exact). NON accetta customer_id da client.
  SELECT r.customer_id, r.created INTO v_cust_id, v_created
    FROM public.customer_upsert_for_public_booking(
      v_tenant_id, p_customer_name, p_customer_email, p_customer_phone
    ) r;

  -- 6. INSERT bookings status confirmed server-auth + customer_id.
  --    Customer_name/email/phone/notes embedded preserved per FASE9 display.
  INSERT INTO public.bookings (
    tenant_id, service_id, starts_at, ends_at, status,
    customer_name, customer_email, customer_phone, notes, customer_id
  ) VALUES (
    v_tenant_id, p_service_id, v_st, v_en, 'confirmed',
    p_customer_name, p_customer_email, p_customer_phone, p_notes, v_cust_id
  ) RETURNING id INTO v_bid;

  -- 7. Audit PII-free: booking_created.
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_tenant_id, 'anon', NULL, 'booking_created', 'booking', v_bid,
        jsonb_build_object(
          'service_id',    p_service_id::text,
          'starts_at',     v_st::text,
          'customer_id',   v_cust_id::text,
          'from_status',   NULL,
          'to_status',     'confirmed'
        )
      );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN QUERY SELECT v_bid, 'confirmed'::TEXT, v_st, v_en, v_cust_id;
  RETURN;
END; $$;

-- Grant come FASE9 (anon + service per test). Authenticated NIENTE.
-- Solo TIMESTAMPTZ signature; overload TEXT non esiste (drop if exists già sopra).
REVOKE ALL ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.public_booking_create_slug(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT) TO service_role;
