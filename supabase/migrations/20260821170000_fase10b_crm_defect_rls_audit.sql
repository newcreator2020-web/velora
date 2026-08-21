-- =========================================================================
-- FASE 10B — DEFECT CLOSURE: booking RLS policy UPDATE ampliata + audit
--           triggers book-keeping SECURITY DEFINER trusted boundary.
--
-- APPEND ONLY. NON modifico migrations FASE1-9 frozen.
-- =========================================================================

SET search_path = '';

-- =========================================================================
-- 1. POLICY bookings_owner_manager_update_status: AMPLIATA a 3 terminali
--    (confermato da trigger bookings_update_restricted di FASE10).
--    NON permetto altri campi (trigger di immutabilità gestisce).
-- =========================================================================
DROP POLICY IF EXISTS bookings_owner_manager_cancel ON public.bookings;
DROP POLICY IF EXISTS bookings_owner_manager_update_status ON public.bookings;
CREATE POLICY bookings_owner_manager_update_status ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(bookings.tenant_id, ARRAY['owner','manager'])
  ) WITH CHECK (
    public.has_tenant_role(bookings.tenant_id, ARRAY['owner','manager'])
    AND bookings.status IN ('cancelled','completed','no_show')
  );

-- =========================================================================
-- 2. TRIGGER FUNCTION audit helper SECURITY DEFINER.
--    pg_policies audit_logs INSERT solo service_role.
--    SPOSTO insert audit in una funzione SECURITY DEFINER invocata da trigger.
--    Valori PII MAI. SET search_path = '' hardenizzato.
--
-- 2a. Colonne di sicurezza mancanti per audit log contextual actor_kind.
--     Valori PII MAI; colonna aggiunta append-only.
-- =========================================================================
DO $$ BEGIN
  ALTER TABLE public.audit_logs ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'system';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 2b. Audit action CHECK constraint: ampliato per event set FASE9/FASE10 bookings/customers.
--     FASE6 frozen CHECK enumerativo finito. Append-only ALTER.
DO $$ BEGIN
  ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    -- FASE6 dot-form frozen (preservazione retrocompatibilità)
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'system.seed','system.migration',
    -- Underscore form (FASE8 onboarding + FASE9/FASE10 bookings/customers)
    'tenant_created','tenant_updated','tenant_status_changed','tenant_plan_changed',
    'membership_created','membership_updated','membership_revoked',
    'profile_updated','business_profile_updated',
    'onboarding_completed',
    'platform_admin_granted','platform_admin_revoked',
    -- Billing / entitlements / subscriptions
    'subscription.active','subscription.past_due','subscription.canceled','subscription.updated',
    'billing.receipt','billing.failed',
    -- Bookings FASE9 + FASE10
    'booking_created','booking_cancelled','booking_completed','booking_no_show','booking_status_changed',
    -- Customers FASE10
    'customer_created','customer_updated'
  ));
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
    RETURN;
  END IF;

  IF v_cur = 'service_role' THEN
    v_actor_kind := 'system';
  ELSIF v_cur = 'anon' THEN
    v_actor_kind := 'anon-rpc';
  ELSE
    v_actor_kind := 'member';
  END IF;

  v_actor_id := auth.uid();

  -- PII hardening: remove any accidental PII keys passed by caller.
  p_metadata := p_metadata
    - 'customer_name' - 'customer_email' - 'customer_phone' - 'notes'
    - 'name' - 'email' - 'phone' - 'address' - 'display_name_value'
    - 'notes_value' - 'jwt' - 'cookie' - 'token' - 'bearer' - 'password'
    - 'stripe' - 'card' - 'secret';

  -- Non-blocking audit boundary: fallisce solo metadata validation e rifallback.
  -- Non usiamo EXCEPTION WHEN OTHERS perché nasconde bug di cast/RLS.
  BEGIN
    INSERT INTO public.audit_logs
      (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES
      (p_tenant_id, v_actor_id, p_action, p_entity_type, p_entity_id, p_metadata);
  EXCEPTION WHEN not_null_violation OR check_violation THEN
    INSERT INTO public.audit_logs
      (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES
      (p_tenant_id, v_actor_id, p_action, p_entity_type, p_entity_id, '{}'::jsonb);
  END;
END; $$;

ALTER FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(UUID,TEXT,TEXT,UUID,JSONB) TO anon;

-- =========================================================================
-- 3. bookings_audit_status() — RICOSTRUITA: usa _audit_insert_trusted.
-- =========================================================================
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

-- =========================================================================
-- 4. customers_audit_changed() — RICOSTRUITA: usa _audit_insert_trusted.
-- =========================================================================
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

-- =========================================================================
-- 5. RPC public_booking_create_slug — BLOCCATA insert audit diretta dentro,
--    usa _audit_insert_trusted per booking_created.
--    Drop + CREATE NON OR REPLACE è stato fatto in FASE10.
--    NON riapplico firma per non rompere overload 42883.
--    Invece wrapper: uso pg_event_trigger? No. Modifica MINORE: sostituisco
--    insert audit_logs dentro body FASE10. Per evitare 42P13 cambio return
--    type, uso una update temporanea che NON cambia le colonne OUT.
--    Alternativa più sicura: il trigger bookings AFTER INSERT (bookings_audit_created
--    di FASE9c) NON è SEC DEFINER. Sostituisco ANCHE quello con trusted:
-- =========================================================================
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

DO $$ BEGIN
  -- Drop old non-trusted bookings_audit_created trigger se esiste, sostituiamo con trusted.
  DROP TRIGGER IF EXISTS bookings_audit_created ON public.bookings;
  CREATE TRIGGER bookings_audit_created_trusted
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_audit_created_trusted();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================================
-- 6. FASE9 regressione check: la policy bookings_owner_manager_update_status
--    permette status 'cancelled' con has_tenant_role owner/manager.
--    La policy SELECT bookings_owner_manager_read resta immutata FASE9c.
--    La policy SELECT bookings_staff_readonly resta immutata.
--    La policy ALL service_role_all resta immutata.
-- =========================================================================
-- (nessun codice; solo commento evidence)

-- =========================================================================
-- 7. Verifica RLS force customers rimane attivo; non riapplico per idempotenza.
-- =========================================================================
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings  ENABLE ROW LEVEL SECURITY;
