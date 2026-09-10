-- ============================================================================
--  FASE 12 · TASK B4 BIS — PAGAMENTI CON BONIFICO BANCARIO MANUALE
--  (decisione utente: sostituisce Stripe. Nessun dato sensibile, tutto placeholder.)
-- ============================================================================
--  1) Estendi enum booking_payment_status_enum con stati intermedi bonifico
--  2) Tabella tenant_bank_accounts (coordinate bancarie per tenant, 1 default)
--  3) Colonne extra bookings: deposit_paid_at / deposit_requested_at /
--     deposit_payment_method / deposit_payment_ref (CRO) / deposit_payment_note /
--     deposit_confirmed_by
--  4) Modifica public_booking_create_v3: calcola deposit_amount dal service
--     (NONE → null, PERCENT → price*value/100, FIXED → value) e setta
--     payment_status='deposit_pending_bank' quando caparra > 0
--  5) RLS + grants + indices
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Estendi enum booking_payment_status_enum in modo idempotente
--    Valori esistenti: unpaid | deposit_paid | paid
--    Aggiungiamo: deposit_pending_bank
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_payment_status_enum' AND e.enumlabel = 'deposit_pending_bank'
  ) THEN
    ALTER TYPE public.booking_payment_status_enum ADD VALUE 'deposit_pending_bank';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_payment_status_enum' AND e.enumlabel = 'refunded'
  ) THEN
    ALTER TYPE public.booking_payment_status_enum ADD VALUE 'refunded';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Tabella tenant_bank_accounts (coordinate bancarie placeholder per ora)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT FALSE,
  display_name text NULL,
  account_holder text NULL,
  iban text NULL,
  bic_swift text NULL,
  bank_name text NULL,
  payment_note_template text NULL,
  sort_code text NULL,
  country text NULL,
  active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_bank_accounts_primary_uniq
  ON public.tenant_bank_accounts (tenant_id) WHERE is_primary = TRUE AND active = TRUE;

CREATE INDEX IF NOT EXISTS idx_tenant_bank_accounts_tenant
  ON public.tenant_bank_accounts (tenant_id, active DESC, is_primary DESC);

ALTER TABLE public.tenant_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_bank_accounts_authenticated_select ON public.tenant_bank_accounts;
CREATE POLICY tenant_bank_accounts_authenticated_select ON public.tenant_bank_accounts
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner', 'manager', 'platform_admin'])
    OR public.is_tenant_member(tenant_id)
  );

DROP POLICY IF EXISTS tenant_bank_accounts_owner_write ON public.tenant_bank_accounts;
CREATE POLICY tenant_bank_accounts_owner_write ON public.tenant_bank_accounts
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner', 'platform_admin'])
  ) WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner', 'platform_admin'])
  );

DROP POLICY IF EXISTS tenant_bank_accounts_service_role_all ON public.tenant_bank_accounts;
CREATE POLICY tenant_bank_accounts_service_role_all ON public.tenant_bank_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tenant_bank_accounts_anon_view ON public.tenant_bank_accounts;
CREATE POLICY tenant_bank_accounts_anon_view ON public.tenant_bank_accounts
  FOR SELECT TO anon
  USING (active = TRUE AND is_primary = TRUE);

GRANT SELECT ON public.tenant_bank_accounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_bank_accounts TO authenticated;
GRANT ALL ON public.tenant_bank_accounts TO service_role;

DROP TRIGGER IF EXISTS set_tenant_bank_accounts_updated_at ON public.tenant_bank_accounts;
CREATE TRIGGER set_tenant_bank_accounts_updated_at
  BEFORE UPDATE ON public.tenant_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- Inserisci coordinate BANCARIE DI ESEMPIO/placeholder per TENANT TONINO
-- (l'utente sostituirà con dati reali quando pronto)
INSERT INTO public.tenant_bank_accounts (
  tenant_id, is_primary, display_name, account_holder,
  iban, bic_swift, bank_name, payment_note_template, country, active
) VALUES (
  'd5a0538e-567e-45ee-b00e-61659ed50637',
  TRUE,
  'Conto Principale Tonino',
  'Tonino & C. S.r.l. (DA SOSTITUIRE CON NOME REALE)',
  'IT00X0000000000000000000000',
  'UNCRITMMXXX',
  'Banca Placeholder (DA SOSTITUIRE)',
  'Bonifico Caparra Prenotazione {{booking_code}}',
  'IT',
  TRUE
) ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) Colonne extra bookings per tracciare bonifico caparra
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_requested_at timestamptz NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_payment_method text NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_payment_ref text NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_payment_note text NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_confirmed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_payment_status
  ON public.bookings (tenant_id, payment_status);

CREATE INDEX IF NOT EXISTS idx_bookings_deposit_paid_at
  ON public.bookings (tenant_id, deposit_paid_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 4) Aggiorna public_booking_create_v3 per calcolare deposit_amount
--    e inizializzare payment_status='deposit_pending_bank' quando caparra>0
--    Nuovo valore restituito: total_price, deposit_amount
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION public.public_booking_create_v3(
  p_tenant_slug   TEXT,
  p_service_id    UUID,
  p_starts_at     TIMESTAMPTZ,
  p_resource_slug TEXT,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_notes         TEXT
)
RETURNS TABLE (
  booking_id    UUID,
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  status        TEXT,
  resource_id   UUID,
  resource_slug TEXT,
  total_price   NUMERIC,
  deposit_amount NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id   UUID;
  v_tz          TEXT;
  v_duration    INT;
  v_lead_min    INT;
  v_horizon_d   INT;
  v_end_at      TIMESTAMPTZ;
  v_cust_id     UUID;
  v_resources   UUID[];
  v_slugs       TEXT[];
  v_i           INT;
  v_picked      UUID;
  v_picked_slug TEXT;
  v_new_id      UUID;
  v_canonical   JSONB;
  v_service_price NUMERIC;
  v_service_dep_strat TEXT;
  v_service_dep_val   NUMERIC;
  v_dep_amount  NUMERIC;
  v_payment_status public.booking_payment_status_enum;
BEGIN
  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_lead_min, v_horizon_d
  FROM public.scheduling_constants() s;

  SELECT t.id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenants t
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
  WHERE t.slug = p_tenant_slug AND t.published = TRUE AND t.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE='VLTN1';
  END IF;

  SELECT s.duration_minutes,
         COALESCE(s.price_from, s.price, 0) AS price,
         COALESCE(s.deposit_strategy::TEXT, 'NONE') AS dep_strat,
         COALESCE(s.deposit_value, 0)       AS dep_val
    INTO v_duration, v_service_price, v_service_dep_strat, v_service_dep_val
  FROM public.services s
  WHERE s.tenant_id = v_tenant_id AND s.id = p_service_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN
    RAISE EXCEPTION 'service invalid' USING ERRCODE='VLTN2';
  END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF v_service_dep_strat = 'PERCENT' AND v_service_dep_val > 0 THEN
    v_dep_amount := ROUND(((COALESCE(v_service_price,0) * v_service_dep_val) / 100.0) * 100) / 100;
  ELSIF v_service_dep_strat = 'FIXED' AND v_service_dep_val > 0 THEN
    v_dep_amount := ROUND(v_service_dep_val * 100) / 100;
  ELSE
    v_dep_amount := NULL;
  END IF;

  IF v_dep_amount IS NOT NULL AND v_dep_amount > 0 THEN
    v_payment_status := 'deposit_pending_bank';
  ELSE
    v_payment_status := 'unpaid';
  END IF;

  IF p_starts_at < CURRENT_TIMESTAMP + (v_lead_min::TEXT || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'past slot / lead time' USING ERRCODE='VLTN3';
  END IF;
  IF p_starts_at > CURRENT_TIMESTAMP + (v_horizon_d::TEXT || ' days')::INTERVAL THEN
    RAISE EXCEPTION 'too far in advance' USING ERRCODE='VLTN4';
  END IF;

  SELECT r.customer_id INTO v_cust_id
    FROM public.customer_upsert_for_public_booking(
      v_tenant_id,
      COALESCE(BTRIM(p_customer_name), 'Cliente'),
      NULLIF(BTRIM(p_customer_email),''),
      NULLIF(BTRIM(p_customer_phone),'')
    ) r;

  IF v_cust_id IS NULL AND NULLIF(BTRIM(p_customer_email),'') IS NOT NULL THEN
    SELECT c.id INTO v_cust_id FROM public.customers c
     WHERE c.tenant_id = v_tenant_id
       AND c.email_normalized = LOWER(BTRIM(p_customer_email))
     LIMIT 1;
  END IF;

  IF p_resource_slug = 'any' OR p_resource_slug IS NULL OR char_length(p_resource_slug)=0 THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.active=TRUE AND sr.bookable=TRUE
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id
            AND srs.resource_id = sr.id
            AND srs.service_id  = p_service_id
            AND srs.active = TRUE
        )
      );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug]
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_resource_slug
      AND sr.active=TRUE AND sr.bookable=TRUE;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources,1) = 0 THEN
    RAISE EXCEPTION 'resource not eligible' USING ERRCODE='VLTN5';
  END IF;

  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources,1);
    v_picked := v_resources[v_i];
    v_picked_slug := v_slugs[v_i];

    IF EXISTS (
      SELECT 1
      FROM public.business_schedule_exceptions bse
      WHERE bse.tenant_id = v_tenant_id
        AND bse.exception_type IN ('closure','slot_block')
        AND tstzrange(bse.starts_at, bse.ends_at, '[)')
            && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      RAISE EXCEPTION 'business closed' USING ERRCODE='VLTN6';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
       WHERE rto.tenant_id = v_tenant_id
         AND rto.resource_id = v_picked
         AND tstzrange(rto.starts_at, rto.ends_at, '[)')
             && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1;
      CONTINUE try_candidates;
    END IF;

    DECLARE
      v_local_day DATE;
      v_local_st TIME;
      v_local_en TIME;
      v_wd SMALLINT;
      v_in_range BOOLEAN := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;
      SELECT EXISTS (
        SELECT 1
        FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked
          AND ra.enabled = TRUE
          AND ra.weekday = v_wd
          AND ra.start_time <= v_local_st
          AND ra.end_time   >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1
        FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked
          AND ra.enabled = TRUE
          AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id
            AND ba.enabled = TRUE
            AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st
            AND ba.end_time   >= v_local_en
        ) INTO v_in_range;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.business_schedule_exceptions bse
        WHERE bse.tenant_id = v_tenant_id
          AND bse.exception_type = 'special_hours'
          AND bse.start_time IS NOT NULL
          AND bse.end_time IS NOT NULL
          AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                               AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_range := EXISTS (
          SELECT 1
          FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id
            AND bse.exception_type = 'special_hours'
            AND bse.start_time IS NOT NULL
            AND bse.end_time IS NOT NULL
            AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                 AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
            AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_range THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id
            AND bse.exception_type = 'extra_open'
            AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                @> tstzrange(p_starts_at, v_end_at, '[)')
        ) THEN
          v_i := v_i + 1;
          CONTINUE try_candidates;
        END IF;
      END IF;
    END;

    BEGIN
      INSERT INTO public.bookings(
        tenant_id, service_id, resource_id, starts_at, ends_at,
        status, customer_name, customer_email, customer_phone, notes,
        payment_status, deposit_amount,
        created_at, updated_at
      ) VALUES (
        v_tenant_id, p_service_id, v_picked, p_starts_at, v_end_at,
        'confirmed',
        COALESCE(BTRIM(p_customer_name),'Cliente'),
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),''),
        NULLIF(LEFT(BTRIM(p_notes), 2000), ''),
        v_payment_status,
        v_dep_amount,
        NOW(), NOW()
      ) RETURNING id INTO v_new_id;

      booking_id    := v_new_id;
      start_at      := p_starts_at;
      end_at        := v_end_at;
      status        := 'confirmed';
      resource_id   := v_picked;
      resource_slug := v_picked_slug;
      total_price   := COALESCE(v_service_price, 0);
      deposit_amount:= v_dep_amount;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1;
      CONTINUE try_candidates;
    END;
  END LOOP;

  RAISE EXCEPTION 'slot taken or unavailable' USING ERRCODE='VLTN7';
END;
$$;

ALTER FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_create_v3(TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Funzione helper anon: client "ho effettuato il bonifico" (deposit decl)
--    Accessibile da anon perché è l'azione del cliente sul sito pubblico.
--    Controlla che la booking esista e sia dello status giusto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_public_declare_bank_transfer(
  p_booking_id  UUID,
  p_customer_email TEXT,
  p_cro_ref     TEXT,
  p_note        TEXT
)
RETURNS TABLE (
  ok BOOLEAN,
  deposit_payment_ref TEXT,
  deposit_payment_method TEXT,
  deposit_requested_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_email_stored TEXT;
BEGIN
  SELECT b.tenant_id, b.customer_email
    INTO v_tenant_id, v_email_stored
  FROM public.bookings b
  WHERE b.id = p_booking_id AND b.status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking non trovata' USING ERRCODE='VLB1';
  END IF;

  IF v_email_stored IS NOT NULL AND NULLIF(BTRIM(p_customer_email),'') IS NOT NULL
     AND LOWER(BTRIM(p_customer_email)) <> LOWER(v_email_stored) THEN
    RAISE EXCEPTION 'email non corrisponde' USING ERRCODE='VLB2';
  END IF;

  UPDATE public.bookings b
     SET deposit_payment_method = 'bank_transfer',
         deposit_payment_ref    = NULLIF(LEFT(BTRIM(p_cro_ref),64),''),
         deposit_payment_note   = NULLIF(LEFT(BTRIM(p_note),1000),''),
         deposit_requested_at   = NOW(),
         updated_at             = NOW()
   WHERE b.id = p_booking_id
     AND b.payment_status IN ('deposit_pending_bank'::public.booking_payment_status_enum,
                              'unpaid'::public.booking_payment_status_enum);

  RETURN QUERY
    SELECT TRUE AS ok,
           b.deposit_payment_ref,
           b.deposit_payment_method,
           b.deposit_requested_at
      FROM public.bookings b
     WHERE b.id = p_booking_id;
END;
$$;

ALTER FUNCTION public.booking_public_declare_bank_transfer(UUID,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.booking_public_declare_bank_transfer(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_public_declare_bank_transfer(UUID,TEXT,TEXT,TEXT) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Helper backoffice: segna caparra pagata / reimposta
--    Solo owner/manager/platform_admin
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_backoffice_set_deposit_paid(
  p_booking_id  UUID,
  p_paid        BOOLEAN,
  p_note        TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant_id UUID;
  v_actor     UUID := auth.uid();
BEGIN
  SELECT b.tenant_id INTO v_tenant_id FROM public.bookings b WHERE b.id = p_booking_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF NOT (
    public.has_tenant_role(v_tenant_id, ARRAY['owner','manager','platform_admin'])
    OR public.is_super_admin_internal_p(v_actor)
  ) THEN
    RAISE EXCEPTION 'non autorizzato' USING ERRCODE='VLB3';
  END IF;

  IF p_paid THEN
    UPDATE public.bookings b
       SET payment_status       = 'deposit_paid'::public.booking_payment_status_enum,
           deposit_paid_at      = NOW(),
           deposit_confirmed_by = v_actor,
           deposit_payment_method = COALESCE(NULLIF(deposit_payment_method,''), 'bank_transfer'),
           updated_at           = NOW()
     WHERE b.id = p_booking_id;
  ELSE
    UPDATE public.bookings b
       SET payment_status       = CASE WHEN deposit_amount > 0
                                        THEN 'deposit_pending_bank'::public.booking_payment_status_enum
                                        ELSE 'unpaid'::public.booking_payment_status_enum END,
           deposit_paid_at      = NULL,
           deposit_confirmed_by = NULL,
           updated_at           = NOW()
     WHERE b.id = p_booking_id;
  END IF;

  RETURN TRUE;
END;
$$;

ALTER FUNCTION public.booking_backoffice_set_deposit_paid(UUID,BOOLEAN,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.booking_backoffice_set_deposit_paid(UUID,BOOLEAN,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_backoffice_set_deposit_paid(UUID,BOOLEAN,TEXT) TO authenticated, service_role;
