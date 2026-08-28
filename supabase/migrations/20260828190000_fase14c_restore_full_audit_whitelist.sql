-- FASE 14C — Ripristina whitelist audit_logs_action_check COMPLETA
-- (append-only). La migration #73 #20260828160000 aveva ricreato la CHECK
-- con solo le azioni dot-form + 4 platform_*, perdendo ~60 azioni legacy
-- underscore-form (tenant_created / onboarding_completed / booking_created /
-- customer_created / subscription_active / resource_created / domain_* ecc.).
-- Questa migration ripristina l'UNIONE della whitelist FASE14B frozen
-- (#20260826160000) + le 4 nuove azioni platform_*.

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
    'site_editorial_draft_saved','site_published','site_unpublished',
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
