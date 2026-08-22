-- ============================================================================
-- FASE 12I — Audit: extend audit_logs.action whitelist + hardening.
--
-- I nuovi eventi FASE12 (resource_created ecc.) devono essere validi per la
-- CHECK constraint audit_logs_action_check. DROP + recreate della whitelist.
-- ============================================================================

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    -- dot notation legacy
    'tenant.created','tenant.updated','tenant.status_changed','tenant.plan_changed',
    'membership.created','membership.updated','membership.revoked',
    'profile.updated','business_profile.updated',
    'platform_admin.granted','platform_admin.revoked',
    'subscription.active','subscription.past_due','subscription.canceled','subscription.updated',
    'billing.receipt','billing.failed',
    'booking.created','booking.cancelled','booking.completed','booking.no_show','booking.status_changed',
    'customer.created','customer.updated',
    'system.seed','system.migration',
    -- underscore notation
    'tenant_created','tenant_updated','tenant_status_changed','tenant_plan_changed',
    'membership_created','membership_updated','membership_revoked',
    'profile_updated','business_profile_updated','onboarding_completed',
    'platform_admin_granted','platform_admin_revoked',
    'subscription_active','subscription_past_due','subscription_canceled','subscription_updated',
    'billing_receipt','billing_failed',
    'booking_created','booking_cancelled','booking_completed','booking_no_show','booking_status_changed',
    'customer_created','customer_updated',
    -- NUOVE FASE12 RESOURCE events
    'resource_created','resource_updated','resource_deactivated',
    'resource_service_added','resource_service_changed','resource_service_removed'
  ]::text[]));

-- ----------------------------------------------------------------------------
-- Trigger `trg_bookings_set_resource_if_null` BEFORE INSERT valorizza
-- resource_id per V1 RPC. Alcuni harness di test usano session_replication_role
-- = replica (per clean bulk insert) che DISABILITA user-created triggers di
-- default. ENABLE ALWAYS garantisce l'esecuzione anche in replica per mantenere
-- l'invariant confirmed NOT NULL.
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ENABLE ALWAYS TRIGGER trg_bookings_set_resource_if_null;
