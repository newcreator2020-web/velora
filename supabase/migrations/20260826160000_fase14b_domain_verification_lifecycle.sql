-- 071: FASE14B Custom Domain Verification Lifecycle + Route Readiness.
-- Append-only. Idempotent. Nessuna modifica a colonne/migrazioni FASE0→70 FROZEN.
-- Unico scopo: aggiungere lifecycle VERIFICATION/ROUTING + immutable audit per custom_domain, senza sostituire la unique UNIQUE custom_domain esistente.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'domain_verification_status') THEN
    CREATE TYPE public.domain_verification_status AS ENUM ('pending', 'verified', 'failed_disabled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_status') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_status public.domain_verification_status NOT NULL DEFAULT 'pending';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_verification_token') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_verification_token TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_verified_at') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_verified_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_routing_ready') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_routing_ready BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_ownership_verified_at') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_ownership_verified_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_routing_checked_at') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_routing_checked_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='custom_domain_routing_verified_at') THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain_routing_verified_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_name='tenants_custom_domain_verification_token_key') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_custom_domain_verification_token_key UNIQUE (custom_domain_verification_token);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain_status_lookup
  ON public.tenants(custom_domain, custom_domain_status, custom_domain_routing_ready)
  WHERE custom_domain IS NOT NULL;

-- Audit immutable guard per domain_lifecycle_update mutations audit_logs immutable, regola FASE10/11B già esistente.
-- Regola safety: custom_domain può servire il tenant SOLO dopo (status='verified' AND routing_ready=TRUE AND published=TRUE AND status='active').
-- Nessun GRANT aggiuntivo se le policy RLS esistenti coprono tenants update owner-only (già esistenti migration 008 tenants_update_owner_or_platform).

-- ============================================================================
-- 2. AUDIT LOG ACTION WHITELIST UPDATE (FASE14B domain events)
--    Riproduce whitelist FASE13D1 + domain lifecycle events per CHECK constraint.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE public.audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
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
    'domain_added','domain_removed','domain_verified'
  ));
