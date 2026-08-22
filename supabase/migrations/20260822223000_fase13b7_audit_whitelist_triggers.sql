-- ============================================================================
-- FASE 13B7 — Audit events whitelist estesa + CHECK constraint PII-free triggers
--
-- Eventi FASE13 aggiunti alla CHECK constraint hard (audit_logs_action_check):
--   resource_availability_changed
--   business_schedule_exception_created / updated / deleted
--   resource_time_off_created / updated / deleted
--   booking_v3_created
--
-- PII forbidden in audit metadata: scrubber PII BEFORE INSERT
-- ============================================================================

-- 0. Aggiorna CHECK constraint audit_logs.action con eventi FASE13.
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    -- dot notation legacy (FASE 1-12)
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'subscription.active','subscription.past_due','subscription.canceled','subscription.updated',
    'billing.receipt','billing.failed',
    'booking.created','booking.cancelled','booking.completed','booking.no_show','booking.status_changed',
    'customer.created','customer.updated',
    'system.seed','system.migration',
    -- underscore notation (FASE 8-12)
    'tenant_created','tenant_updated','tenant_status_changed','tenant_plan_changed',
    'membership_created','membership_updated','membership_revoked',
    'profile_updated','business_profile_updated','onboarding_completed',
    'platform_admin_granted','platform_admin_revoked',
    'subscription_active','subscription_past_due','subscription_canceled','subscription_updated',
    'billing_receipt','billing_failed',
    'booking_created','booking_cancelled','booking_completed','booking_no_show','booking_status_changed',
    'customer_created','customer_updated',
    -- FASE12 RESOURCE events
    'resource_created','resource_updated','resource_deactivated',
    'resource_service_added','resource_service_changed','resource_service_removed',
    -- NUOVI FASE13B SCHEDULING FOUNDATION events
    'resource_availability_changed',
    'business_schedule_exception_created',
    'business_schedule_exception_updated',
    'business_schedule_exception_deleted',
    'resource_time_off_created',
    'resource_time_off_updated',
    'resource_time_off_deleted',
    'booking_v3_created'
  ]::text[]));

-- 1. Aggiorna tabella audit_action_whitelist entries (soft, se la tab esiste).
DO $$
DECLARE
  v_exists BOOL;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='audit_action_whitelist'
  ) INTO v_exists;

  IF v_exists THEN
    INSERT INTO public.audit_action_whitelist(action, entity_type, scope)
    VALUES
      ('resource_availability_changed',   'resource_availability',         'tenant'),
      ('business_schedule_exception_created','business_schedule_exception','tenant'),
      ('business_schedule_exception_updated','business_schedule_exception','tenant'),
      ('business_schedule_exception_deleted','business_schedule_exception','tenant'),
      ('resource_time_off_created',       'resource_time_off',             'tenant'),
      ('resource_time_off_updated',       'resource_time_off',             'tenant'),
      ('resource_time_off_deleted',       'resource_time_off',             'tenant'),
      ('booking_v3_created',              'booking',                       'tenant')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. resource_availability audit trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resource_availability_audit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB;
  v_tid UUID;
  v_eid UUID;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_tid := NEW.tenant_id;
    v_eid := NEW.id;
  ELSE
    v_tid := OLD.tenant_id;
    v_eid := OLD.id;
  END IF;
  v_action := 'resource_availability_changed';
  v_meta := jsonb_build_object(
    'resource_id', (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).resource_id::text,
    'weekday',     (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).weekday,
    'enabled',     (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).enabled,
    'start_time_len', char_length((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).start_time::text),
    'end_time_len',   char_length((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).end_time::text),
    'op', TG_OP
  );
  PERFORM public._audit_insert_trusted(v_tid, v_action, 'resource_availability', v_eid, v_meta);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.resource_availability_audit() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_resource_availability_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resource_availability
  FOR EACH ROW EXECUTE FUNCTION public.resource_availability_audit();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. business_schedule_exceptions audit triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bse_audit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB;
  v_tid UUID;
  v_eid UUID;
  v_title_len INT;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_tid := NEW.tenant_id; v_eid := NEW.id;
    v_title_len := char_length(COALESCE(NEW.title,''));
    IF TG_OP='INSERT' THEN v_action := 'business_schedule_exception_created';
                      ELSE v_action := 'business_schedule_exception_updated'; END IF;
  ELSE
    v_tid := OLD.tenant_id; v_eid := OLD.id;
    v_title_len := char_length(COALESCE(OLD.title,''));
    v_action := 'business_schedule_exception_deleted';
  END IF;
  v_meta := jsonb_build_object(
    'exception_type', COALESCE((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).exception_type,'?'),
    'title_len', v_title_len,
    'range_seconds', EXTRACT(EPOCH FROM (
      (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).ends_at
      - (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).starts_at
    ))::bigint,
    'has_start_time', ((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).start_time IS NOT NULL),
    'has_end_time',   ((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).end_time   IS NOT NULL)
  );
  PERFORM public._audit_insert_trusted(v_tid, v_action, 'business_schedule_exception', v_eid, v_meta);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.bse_audit() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_bse_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.business_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.bse_audit();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 3. resource_time_off audit triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rto_audit()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB;
  v_tid UUID;
  v_eid UUID;
BEGIN
  IF TG_OP='INSERT' THEN v_action := 'resource_time_off_created';
  ELSIF TG_OP='UPDATE' THEN v_action := 'resource_time_off_updated';
  ELSE v_action := 'resource_time_off_deleted';
  END IF;
  IF TG_OP='DELETE' THEN v_tid := OLD.tenant_id; v_eid := OLD.id;
                    ELSE v_tid := NEW.tenant_id; v_eid := NEW.id; END IF;
  v_meta := jsonb_build_object(
    'resource_id',    (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).resource_id::text,
    'time_off_type',  (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).time_off_type,
    'title_len',      char_length(COALESCE((CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).title,'')),
    'range_seconds',  EXTRACT(EPOCH FROM (
      (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).ends_at
      - (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END).starts_at
    ))::bigint
  );
  PERFORM public._audit_insert_trusted(v_tid, v_action, 'resource_time_off', v_eid, v_meta);
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.rto_audit() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_rto_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.resource_time_off
  FOR EACH ROW EXECUTE FUNCTION public.rto_audit();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 4. booking_v3_created via audit trigger se status=confirmed INSERT
--    Il trigger FASE12 esistente (trg_bookings_audit ?) se presente viene
--    conservato; qui aggiungiamo hook booking_v3_created se nuovo booking
--    da V3 (identifichiamo per created_at recente? No: per INSERT dopo
--    la migration useremo booking_v3_created metadata version.)
-- ----------------------------------------------------------------------------
-- V3 marker via jsonb 'engine=v3' passato dal RPC.
-- L'Mark viene inserito dall'RPC nella variabile GUC locale, audit lo legge.

-- ----------------------------------------------------------------------------
-- 5. Scrubber PII BEFORE INSERT su audit_logs
--    (In FASE11B audit_logs già era UPDATE/DELETE DENY.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_logs_scrub_pii_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_key TEXT;
  v_sensitive_keys CONSTANT TEXT[] := ARRAY[
    'customer_email','customer_phone','customer_notes','email','phone','telefono',
    'cell','indirizzo','address','notes','note','cookie','bearer','authorization',
    'token','secret','jwt','password','codice_fiscale','fiscal_code','stripe',
    'sk_live','pk_live','service_role_key','api_key','card_number','credit_card',
    'cvv','ssn','iban','auth'
  ];
  v_touched BOOLEAN := FALSE;
BEGIN
  IF NEW.metadata IS NULL THEN RETURN NEW; END IF;

  FOREACH v_key IN ARRAY v_sensitive_keys LOOP
    IF NEW.metadata ? v_key THEN
      NEW.metadata := NEW.metadata #- ('{' || v_key || '}')::TEXT[];
      v_touched := TRUE;
    END IF;
  END LOOP;

  IF v_touched THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{pii_scrubbed}', 'true'::jsonb, TRUE);
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.audit_logs_scrub_pii_before_insert() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_logs_scrub_pii
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_scrub_pii_before_insert();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants sulle funzioni audit solo a service_role e proprietario.
REVOKE ALL ON FUNCTION public.resource_availability_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resource_availability_audit() TO service_role;
REVOKE ALL ON FUNCTION public.bse_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bse_audit() TO service_role;
REVOKE ALL ON FUNCTION public.rto_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rto_audit() TO service_role;
REVOKE ALL ON FUNCTION public.audit_logs_scrub_pii_before_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_logs_scrub_pii_before_insert() TO service_role;
