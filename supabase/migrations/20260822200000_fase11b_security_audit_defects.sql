-- =====================================================================
-- FASE 11B — SECURITY + AUDIT DEFECT CLOSURE (APPEND-ONLY HARDENING)
-- =====================================================================
-- Nessuna modifica alle migrazioni FASE1..FASE10 frozen.
-- Solo fix additivi, correzioni di trigger/grant/policy/FK.
-- =====================================================================

SET search_path = '';

-- =====================================================================
-- 1. FIX §2 D1 ANON BOOKINGS PII EXPOSURE
--    Perimetro: anon NON deve poter leggere colonne PII da public.bookings
--    Soluzione: dedicated RPC PII-free get_confirmed_booking_ranges
--    poi REVOKE SELECT (colonne intere) su tabella bookings da anon + drop policy.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.public_booking_get_confirmed_ranges(
  p_tenant_id  UUID,
  p_service_id UUID,
  p_from       TIMESTAMPTZ,
  p_to         TIMESTAMPTZ
) RETURNS TABLE (
  starts_at TIMESTAMPTZ,
  ends_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_published BOOLEAN;
  v_active    TEXT;
  v_svc_active BOOLEAN;
BEGIN
  -- Boundary: tenant published + status active
  SELECT published, status INTO v_published, v_active
  FROM public.tenants WHERE id = p_tenant_id LIMIT 1;
  IF NOT FOUND OR v_published IS NOT TRUE OR v_active <> 'active' THEN
    RETURN;
  END IF;

  -- Boundary: service belongs to tenant AND active
  SELECT s.active INTO v_svc_active
    FROM public.services s
   WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id LIMIT 1;
  IF NOT FOUND OR v_svc_active IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Safe: solo range temporali. ZERO PII.
  RETURN QUERY
  SELECT b.starts_at, b.ends_at
    FROM public.bookings b
   WHERE b.tenant_id  = p_tenant_id
     AND b.service_id = p_service_id
     AND b.status      = 'confirmed'
     AND b.starts_at  >= p_from
     AND b.starts_at  <  p_to;
END; $$;

ALTER FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO postgres;
GRANT EXECUTE ON FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.public_booking_get_confirmed_ranges(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;

-- Ora revochiamo l'unsafe grant TABLE-level anon SELECT (fase10g)
REVOKE SELECT ON public.bookings FROM anon;

-- E cancelliamo la policy unsafe per anon
DROP POLICY IF EXISTS bookings_anon_select_published ON public.bookings;

-- =====================================================================
-- 2. FIX §9 S1 — customer_upsert_for_public_booking ANON EXECUTE revoca.
--    Solo RPC trusted internamente (SECURITY DEFINER = invoca come postgres).
--    Anon non ha bisogno di EXECUTE diretto → SPAM surface chiusa.
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) TO postgres;
-- (service_role grant già presente frozen; mantenuto per test)

-- =====================================================================
-- 3. FIX §9 S3 — business_availability anon policy include status='active'
--    Oggi controlla published = TRUE. Ora aggiungiamo AND status = 'active'.
-- =====================================================================
DROP POLICY IF EXISTS business_availability_anon_select_public ON public.business_availability;
CREATE POLICY business_availability_anon_select_public ON public.business_availability
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = business_availability.tenant_id
        AND t.published = TRUE
        AND t.status    = 'active'
    )
  );

-- =====================================================================
-- 4. FIX §8 D4 protect_tenant_plan_id() usava platform_admins.active
--    (colonna INESISTENTE). Corretto → WHERE status = 'active'.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_uid UUID;
  v_platform_admin UUID;
BEGIN
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_auth_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_auth_uid := NULL;
  END;

  -- Trusted backend/service_role/superuser: auth.uid() = NULL.
  IF v_auth_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Platform admin (logged-in) bypass: usa status column REALE.
  BEGIN
    SELECT user_id INTO v_platform_admin
      FROM public.platform_admins
      WHERE status = 'active' AND user_id = v_auth_uid
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_platform_admin := NULL;
  END;
  IF v_platform_admin IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'plan_id mutation denied for end-users — direct update not allowed'
    USING ERRCODE='insufficient_privilege';
END;
$$;

GRANT EXECUTE ON FUNCTION public.protect_tenant_plan_id() TO authenticated, service_role;

-- =====================================================================
-- 5. FIX §5 / §4 AUDIT REQUIRED SEMANTICS + no EXCEPTION SWALLOW critico.
--    Eventi contrattuali booking_created / cancelled / completed / no_show
--    e customer_created / customer_updated: FALLIMENTO AUDIT → ROLLBACK
--    mutation (nessun EXCEPTION WHEN OTHERS THEN NULL).
--    _audit_insert_trusted mantiene PII-strip ma PROPAGA eccezioni strutturali.
-- =====================================================================

CREATE OR REPLACE FUNCTION public._audit_insert_trusted(
  p_tenant_id   UUID,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_metadata    JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_kind  TEXT;
  v_actor_id    UUID;
  v_cur         TEXT := current_user;
BEGIN
  IF p_tenant_id IS NULL OR p_action IS NULL OR p_entity_type IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'audit insert called with null required args' USING errcode='VF500';
  END IF;

  IF v_cur = 'service_role' THEN
    v_actor_kind := 'system';
  ELSIF v_cur = 'anon' THEN
    v_actor_kind := 'anon-rpc';
  ELSE
    v_actor_kind := 'member';
  END IF;

  v_actor_id := auth.uid();

  -- HARDENED PII-STRIP (estensione safe).
  p_metadata := p_metadata
    - 'customer_name' - 'customer_email' - 'customer_phone' - 'notes'
    - 'name' - 'email' - 'phone' - 'address' - 'display_name_value'
    - 'notes_value' - 'jwt' - 'cookie' - 'token' - 'bearer' - 'password'
    - 'stripe' - 'card' - 'secret' - 'sk_live' - 'pk_live' - 'whsec_';

  -- REQUIRED audit: NESSUN SILENT SWALLOW. Qualsiasi errore → propagato → rollback.
  INSERT INTO public.audit_logs
    (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES
    (p_tenant_id, v_actor_id, p_action, p_entity_type, p_entity_id, p_metadata);
END; $$;

ALTER FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO anon;

-- bookings_audit_status: REQUIRED. NO exception swallow.
CREATE OR REPLACE FUNCTION public.bookings_audit_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_action TEXT;
  v_meta   JSONB;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_action := CASE NEW.status
      WHEN 'cancelled' THEN 'booking_cancelled'
      WHEN 'completed' THEN 'booking_completed'
      WHEN 'no_show'   THEN 'booking_no_show'
      ELSE                  'booking_status_changed'
    END;
    v_meta := jsonb_build_object(
      'from_status', OLD.status,
      'to_status',   NEW.status,
      'source',      CASE WHEN current_user = 'anon' THEN 'anon-rpc' ELSE 'dashboard' END
    );
    PERFORM public._audit_insert_trusted(NEW.tenant_id, v_action, 'booking', NEW.id, v_meta);
  END IF;
  RETURN NEW;
END; $$;

ALTER FUNCTION public.bookings_audit_status() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_audit_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookings_audit_status() TO postgres;
GRANT EXECUTE ON FUNCTION public.bookings_audit_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.bookings_audit_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_audit_status() TO anon;

-- customers_audit_changed: REQUIRED. NO exception swallow.
CREATE OR REPLACE FUNCTION public.customers_audit_changed()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  changed_keys TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit_insert_trusted(
      NEW.tenant_id, 'customer_created', 'customer', NEW.id,
      jsonb_build_object('source', CASE WHEN current_user='anon' THEN 'anon-rpc' ELSE 'dashboard-or-rpc' END)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.display_name  IS DISTINCT FROM NEW.display_name  THEN changed_keys := array_append(changed_keys, 'display_name'); END IF;
    IF OLD.email         IS DISTINCT FROM NEW.email         THEN changed_keys := array_append(changed_keys, 'email'); END IF;
    IF OLD.phone         IS DISTINCT FROM NEW.phone         THEN changed_keys := array_append(changed_keys, 'phone'); END IF;
    IF OLD.notes         IS DISTINCT FROM NEW.notes         THEN changed_keys := array_append(changed_keys, 'notes'); END IF;
    IF array_length(changed_keys,1) IS NOT NULL THEN
      PERFORM public._audit_insert_trusted(
        NEW.tenant_id, 'customer_updated', 'customer', NEW.id,
        jsonb_build_object('changed_keys', to_jsonb(changed_keys))
      );
    END IF;
  END IF;
  RETURN NULL;
END; $$;

ALTER FUNCTION public.customers_audit_changed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.customers_audit_changed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customers_audit_changed() TO postgres;
GRANT EXECUTE ON FUNCTION public.customers_audit_changed() TO service_role;
GRANT EXECUTE ON FUNCTION public.customers_audit_changed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.customers_audit_changed() TO anon;

-- bookings_audit_created_trusted: REQUIRED. NO exception swallow.
CREATE OR REPLACE FUNCTION public.bookings_audit_created_trusted()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_meta JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_meta := jsonb_build_object(
      'source', CASE WHEN current_user='anon' THEN 'anon-rpc' ELSE 'trusted-rpc' END,
      'status', NEW.status
    );
    PERFORM public._audit_insert_trusted(NEW.tenant_id, 'booking_created', 'booking', NEW.id, v_meta);
  END IF;
  RETURN NEW;
END; $$;

ALTER FUNCTION public.bookings_audit_created_trusted() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bookings_audit_created_trusted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookings_audit_created_trusted() TO postgres;
GRANT EXECUTE ON FUNCTION public.bookings_audit_created_trusted() TO service_role;
GRANT EXECUTE ON FUNCTION public.bookings_audit_created_trusted() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_audit_created_trusted() TO anon;

-- =====================================================================
-- 6. FIX §10 COMPOSITE TENANT INTEGRITY per cross-tenant injection.
--    UNIQUE composite required per FK composite poi:
--      services(tenant_id, id) UNIQUE
--      customers(tenant_id, id) UNIQUE
--    poi FK composites (tenant_id, service_id) → services
--        FK composites (tenant_id, customer_id) → customers
--    Precondizione: NON devono esistere righe cross-tenant (non ci devono essere).
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS services_tenant_id_id_unique
  ON public.services (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_id_id_unique
  ON public.customers (tenant_id, id);

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_tenant_service_fk
      FOREIGN KEY (tenant_id, service_id)
      REFERENCES public.services (tenant_id, id)
      ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_tenant_customer_fk
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES public.customers (tenant_id, id)
      ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================
-- 7. §7 IMMUTABILITY: assicuriamo trigger audit_logs_immutable_trigger
--    (esiste già frozen 007). Ma per sicurezza su nuove colonne actor_kind:
-- =====================================================================
-- (nessuna modifica necessaria; trigger già BEFORE UPDATE OR DELETE = throw. OK)

-- =====================================================================
-- 8. §9 S2 — booking_validate_business_hours_and_overlap già include
--    AND s.active = TRUE (FASE10 line 393). Nessuna modifica.
-- =====================================================================
-- (no-op)

-- =====================================================================
-- FINE FASE 11B: record di migration.
-- =====================================================================
INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata, actor_user_id)
VALUES ('system.migration', 'migration', '00000000-0000-4000-8000-000000000011'::uuid,
        jsonb_build_object('migration','FASE11B_SECURITY_AUDIT_DEFECT'), NULL);
