-- FASE 16 Q3 AUDIT + PRICE + NUOVE SEZIONI (migration #91)
-- Append-only. Idempotent.
-- 1) Estende whitelist azioni audit_logs
-- 2) Aggiunge colonna price (opzionale) a public.services per audit completo
-- 3) Aggiorna RPC publish_site_draft (firma 3 param + 2 audit INSERT DOPO update state)
-- 4) Crea trigger FUNCTION + TRIGGER audit_service_price() su public.services
-- 5) Estende CHECK constraint site_sections (section_type + variant)

-- ============================================================
-- 1) ESTENSIONE AUDIT LOGS WHITELIST (ripete FASE14C finale + nuove Q3)
-- ============================================================
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
    'platform_provision_failed',
    -- SITE EDITORIAL (site-studio.ts insertAudit)
    'site_editorial_draft_saved','site_published','site_unpublished',
    -- Q3 AUDIT NUOVE
    'site.published','site.publish_attempt','service.price_changed'
  ));

-- ============================================================
-- 2) COLONNA price (NUMERIC) a public.services (se mancante)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='services' AND column_name='price'
  ) THEN
    ALTER TABLE public.services ADD COLUMN price NUMERIC(10,2)
      CHECK (price IS NULL OR price >= 0);
  END IF;
END $$;

-- ============================================================
-- 3) RPC publish_site_draft: firma (p_tenant_id, p_expected_revision, p_actor_id)
--    + 2 INSERT audit_logs DOPO l'update di tenants.state (Step 4)
-- ============================================================
CREATE OR REPLACE FUNCTION public.publish_site_draft(
  p_tenant_id UUID,
  p_expected_revision UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  ok BOOLEAN,
  code TEXT,
  message TEXT,
  new_published_at TIMESTAMPTZ,
  sections_applied INTEGER,
  services_applied INTEGER,
  theme_applied BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor_uid UUID;
  v_row RECORD;
  v_draft_rev UUID;
  v_now TIMESTAMPTZ := NOW();
  v_sec JSONB;
  v_svc JSONB;
  v_theme JSONB;
  v_s JSONB;
  v_sections_len INTEGER := 0;
  v_services_len INTEGER := 0;
  v_theme_done BOOLEAN := FALSE;
  v_primary TEXT;
  v_background TEXT;
  v_foreground TEXT;
  v_muted TEXT;
  v_radius TEXT;
  v_head TEXT;
  v_body TEXT;
  v_old_state JSONB;
BEGIN
  v_actor_uid := COALESCE(p_actor_id, auth.uid());

  IF v_actor_uid IS NULL THEN
    ok := FALSE;
    code := 'AUTH';
    message := 'Non autenticato.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT (
    public.has_tenant_role(p_tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  ) THEN
    ok := FALSE;
    code := 'AUTHZ';
    message := 'Non sei autorizzato a pubblicare questo sito.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT INTO v_row sections, services, theme, draft_revision
    FROM public.site_editorial_state
   WHERE tenant_id = p_tenant_id
   LIMIT 1;

  IF v_row IS NULL THEN
    ok := FALSE;
    code := 'NO_DRAFT';
    message := 'Nessuna bozza disponibile per questo tenant.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  v_sec := v_row.sections;
  v_svc := v_row.services;
  v_theme := v_row.theme;
  v_draft_rev := v_row.draft_revision;

  IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_draft_rev THEN
    ok := FALSE;
    code := 'CONCURRENT';
    message := 'Bozza modificata in un''altra sessione. Ricarica e riprova.';
    new_published_at := NULL;
    sections_applied := 0;
    services_applied := 0;
    theme_applied := FALSE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Step 1: Published sections
  DELETE FROM public.site_sections WHERE tenant_id = p_tenant_id;
  v_sections_len := jsonb_array_length(v_sec);
  IF v_sections_len > 0 THEN
    FOR v_s IN SELECT * FROM jsonb_array_elements(v_sec) LOOP
      INSERT INTO public.site_sections (tenant_id, section_type, position, enabled, variant, settings)
      VALUES (
        p_tenant_id,
        COALESCE(NULLIF((v_s->>'section_type')::TEXT,''),'hero'),
        COALESCE((v_s->>'position')::INTEGER,0),
        COALESCE((v_s->>'enabled')::BOOLEAN,TRUE),
        COALESCE(NULLIF((v_s->>'variant')::TEXT,''),'default'),
        COALESCE(v_s->'settings','{}'::jsonb)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Step 2: Published services
  DELETE FROM public.services WHERE tenant_id = p_tenant_id;
  v_services_len := jsonb_array_length(v_svc);
  IF v_services_len > 0 THEN
    FOR v_s IN SELECT * FROM jsonb_array_elements(v_svc) LOOP
      INSERT INTO public.services (tenant_id, name, description, price, price_from, currency, duration_minutes, position, active)
      VALUES (
        p_tenant_id,
        COALESCE(NULLIF((v_s->>'name')::TEXT,''),'Servizio'),
        NULLIF((v_s->>'description')::TEXT,''),
        CASE WHEN (v_s->>'price')::TEXT <> '' THEN (v_s->>'price')::NUMERIC(10,2) ELSE NULL END,
        CASE WHEN (v_s->>'price_from')::TEXT <> '' THEN (v_s->>'price_from')::NUMERIC(10,2) ELSE NULL END,
        COALESCE(NULLIF((v_s->>'currency')::TEXT,''),'EUR'),
        CASE WHEN (v_s->>'duration_minutes')::TEXT <> '' THEN (v_s->>'duration_minutes')::INTEGER ELSE NULL END,
        COALESCE((v_s->>'position')::INTEGER,0),
        COALESCE((v_s->>'active')::BOOLEAN,TRUE)
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Step 3: Theme published to business_profiles.theme_* structured columns
  v_primary    := NULLIF((v_theme->>'primary')::TEXT,'');
  v_background := NULLIF((v_theme->>'background')::TEXT,'');
  v_foreground := NULLIF((v_theme->>'foreground')::TEXT,'');
  v_muted      := NULLIF((v_theme->>'muted')::TEXT,'');
  v_radius     := NULLIF((v_theme->>'radius')::TEXT,'');
  v_head       := NULLIF((v_theme->>'headingFont')::TEXT,'');
  v_body       := NULLIF((v_theme->>'bodyFont')::TEXT,'');

  UPDATE public.business_profiles
     SET theme_primary            = v_primary,
         theme_background         = v_background,
         theme_foreground         = v_foreground,
         theme_muted              = v_muted,
         theme_radius             = v_radius,
         theme_heading_font_preset = v_head,
         theme_body_font_preset   = v_body,
         updated_at               = v_now
   WHERE tenant_id = p_tenant_id;
  v_theme_done := TRUE;

  -- Step 4: Segna published (UPDATE state tenants)
  SELECT to_jsonb(site_editorial_state) INTO v_old_state
    FROM public.site_editorial_state WHERE tenant_id = p_tenant_id;

  UPDATE public.tenants
     SET published    = TRUE,
         published_at = v_now,
         updated_at   = v_now
   WHERE id = p_tenant_id;

  -- ===== AUDIT INSERT #1: site.published DOPO update state =====
  INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_uid,
    p_tenant_id,
    'site.published',
    'site_publication',
    p_tenant_id,
    jsonb_build_object(
      'old_value', COALESCE(v_old_state, '{}'::jsonb),
      'new_value', jsonb_build_object(
        'published_at', v_now,
        'new_revision', COALESCE(p_expected_revision, v_draft_rev)
      )
    )
  );

  -- ===== AUDIT INSERT #2: service.price_changed placeholder (RPC-level) =====
  -- Il trigger AFTER UPDATE/INSERT/DELETE su services gestisce per-row i prezzi.
  -- Qui teniamo traccia della pubblicazione come "bulk sync" (non bloccante se
  -- non ci sono servizi): usiamo un metadata con conteggi per audit prezzo Q3.
  INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
  SELECT
    v_actor_uid,
    p_tenant_id,
    'service.price_changed',
    'service',
    s.id,
    jsonb_build_object(
      'old_value', jsonb_build_object('price', NULL, 'price_from', NULL),
      'new_value', jsonb_build_object('price', s.price, 'price_from', s.price_from)
    )
  FROM public.services s
  WHERE s.tenant_id = p_tenant_id;

  ok := TRUE;
  code := 'OK';
  message := 'Pubblicazione completata.';
  new_published_at := v_now;
  sections_applied := v_sections_len;
  services_applied := v_services_len;
  theme_applied := v_theme_done;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_site_draft(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_site_draft(UUID, UUID, UUID) TO authenticated;

-- ============================================================
-- 4) TRIGGER FUNCTION + TRIGGER: audit_service_price()
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_service_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor UUID;
  v_tid UUID;
BEGIN
  v_actor := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_tid := NEW.tenant_id;
    IF NEW.price IS NOT NULL OR NEW.price_from IS NOT NULL THEN
      INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_actor,
        v_tid,
        'service.price_changed',
        'service',
        NEW.id,
        jsonb_build_object(
          'old_value', jsonb_build_object('price', NULL, 'price_from', NULL),
          'new_value', jsonb_build_object('price', NEW.price, 'price_from', NEW.price_from)
        )
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_tid := NEW.tenant_id;
    IF (NEW.price IS DISTINCT FROM OLD.price) OR (NEW.price_from IS DISTINCT FROM OLD.price_from) THEN
      INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_actor,
        v_tid,
        'service.price_changed',
        'service',
        NEW.id,
        jsonb_build_object(
          'old_value', jsonb_build_object('price', OLD.price, 'price_from', OLD.price_from),
          'new_value', jsonb_build_object('price', NEW.price, 'price_from', NEW.price_from)
        )
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_tid := OLD.tenant_id;
    IF OLD.price IS NOT NULL OR OLD.price_from IS NOT NULL THEN
      INSERT INTO public.audit_logs (actor_user_id, tenant_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_actor,
        v_tid,
        'service.price_changed',
        'service',
        OLD.id,
        jsonb_build_object(
          'old_value', jsonb_build_object('price', OLD.price, 'price_from', OLD.price_from),
          'new_value', jsonb_build_object('price', NULL, 'price_from', NULL)
        )
      );
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_service_price() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_service_price ON public.services;
CREATE TRIGGER trg_audit_service_price
AFTER INSERT OR UPDATE OR DELETE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.audit_service_price();

-- ============================================================
-- 5) ESTENSIONE CHECK constraint site_sections:
--    section_type (price_list, features_cta, booking_widget)
--    variant (table, premium, compact)
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.site_sections DROP CONSTRAINT IF EXISTS site_sections_section_type_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.site_sections
  ADD CONSTRAINT site_sections_section_type_check CHECK (
    section_type IN (
      'hero','about','services','gallery','staff','reviews','contact',
      'price_list','features_cta','booking_widget'
    )
  );

DO $$ BEGIN
  ALTER TABLE public.site_sections DROP CONSTRAINT IF EXISTS site_sections_variant_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.site_sections
  ADD CONSTRAINT site_sections_variant_check CHECK (
    variant IN (
      'default','centered','split','minimal','cards','carousel',
      'table','premium','compact','full'
    )
  );
