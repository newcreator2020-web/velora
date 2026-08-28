-- FASE 14C — Audit whitelist FINALE corretta: FASE14B frozen esatta + 4 platform_* actions.
-- (append-only, #81).
--
-- Root cause: migration #79/#20260828190000 aveva incluso 3 azioni site_editorial_draft_saved /
-- site_published / site_unpublished NON presenti nella baseline FASE14B
-- (#20260826160000_fase14b_domain_verification_lifecycle.sql). Queste rompono l'assertion
-- site-editorial-fase6: "Publish RPC NON scrive audit log (cntAfter === cntBefore)" perché
-- aumentano la whitelist senza modificare il contract.
--
-- Questa migration ricostruisce la whitelist riproducendo ESATTAMENTE il contenuto della
-- FASE14B (commenti compresi, nella stessa identica sequenza) ed aggiunge in CODA
-- SOLAMENTE le 4 nuove azioni platform_* di FASE14C.
--
-- Ordine rigoroso:
-- 1) FASE6 dot-form (15 entries)
-- 2) Dot billing/booking/customer legacy (16 entries)
-- 3) Underscore FASE8-12 (30 entries)
-- 4) FASE12 RESOURCE events (6 entries)
-- 5) FASE13B SCHEDULING FOUNDATION events (8 entries)
-- 6) FASE13D operational writes (3 entries)
-- 7) FASE14B CUSTOM DOMAIN LIFECYCLE events (3 entries)
-- 8) FASE14C PLATFORM PROVISIONING events (4 entries) ← solo aggiunta nuova.

DO $$ BEGIN
  ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
EXCEPTION WHEN undefined_table THEN NULL;
WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (action IN (
    -- FASE6 frozen dot-form
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'system.seed','system.migration',
    -- Dot billing / booking / customer legacy
    'subscription.active','subscription.past_due','subscription.canceled','subscription.updated',
    'billing.receipt','billing.failed',
    'booking.created','booking.cancelled','booking.completed','booking.no_show','booking.status_changed',
    'customer.created','customer.updated',
    -- Underscore form (FASE 8-12)
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
    -- FASE13B SCHEDULING FOUNDATION events
    'resource_availability_changed',
    'business_schedule_exception_created',
    'business_schedule_exception_updated',
    'business_schedule_exception_deleted',
    'resource_time_off_created',
    'resource_time_off_updated',
    'resource_time_off_deleted',
    'booking_v3_created',
    -- FASE13D operational writes
    'manual_booking_created','booking_rescheduled','booking_resource_assigned',
    -- FASE14B CUSTOM DOMAIN LIFECYCLE events
    'domain_added','domain_removed','domain_verified',
    -- FASE14C PLATFORM PROVISIONING events
    'platform_customer_created','platform_owner_linked','platform_plan_assigned',
    'platform_provision_failed'
  ));
