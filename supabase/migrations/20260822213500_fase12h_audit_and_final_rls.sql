-- ============================================================================
-- FASE 12H — Audit Hardening + final RLS grant verification
--
-- Audit eventi minimi:
--   resource_created
--   resource_updated
--   resource_deactivated
--   resource_service_changed
--   resource_linked_membership_changed
--
-- Implementazione: tramite _audit_insert_trusted(tenant_id,action,entity_type,entity_id,metadata)
-- Nessun PII nei metadata: NO email / phone / notes / JWT / cookie / auth / secret.
-- Solo id, slug, active flags, sort order, color.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Audit Trigger staff_resources (INSERT/UPDATE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_resources_audit_changed()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'resource_created';
    v_meta := jsonb_build_object(
      'slug', NEW.slug,
      'display_name_len', char_length(NEW.display_name),
      'active', NEW.active,
      'bookable', NEW.bookable,
      'sort_order', NEW.sort_order,
      'has_color', (NEW.color_hex IS NOT NULL),
      'has_linked_membership', (NEW.linked_membership_id IS NOT NULL)
    );
    PERFORM public._audit_insert_trusted(
      NEW.tenant_id, v_action, 'staff_resource', NEW.id, v_meta
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- deactivated transition?
    IF OLD.active = TRUE AND NEW.active = FALSE THEN
      v_action := 'resource_deactivated';
      v_meta := jsonb_build_object('slug', NEW.slug);
      PERFORM public._audit_insert_trusted(
        NEW.tenant_id, v_action, 'staff_resource', NEW.id, v_meta
      );
    END IF;
    -- always emit resource_updated con fields changed solo se diversi
    IF NOT (NEW IS NOT DISTINCT FROM OLD) THEN
      v_action := 'resource_updated';
      v_meta := jsonb_build_object(
        'slug', NEW.slug,
        'active_changed', (OLD.active IS DISTINCT FROM NEW.active),
        'bookable_changed', (OLD.bookable IS DISTINCT FROM NEW.bookable),
        'sort_order_changed', (OLD.sort_order IS DISTINCT FROM NEW.sort_order),
        'display_name_changed', (OLD.display_name IS DISTINCT FROM NEW.display_name),
        'color_changed', (OLD.color_hex IS DISTINCT FROM NEW.color_hex),
        'linked_membership_changed', (OLD.linked_membership_id IS DISTINCT FROM NEW.linked_membership_id)
      );
      PERFORM public._audit_insert_trusted(
        NEW.tenant_id, v_action, 'staff_resource', NEW.id, v_meta
      );
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Audit fallisce in modo strutturale (vedi _audit_insert_trusted: non ignora).
  RAISE;
END;
$$;

ALTER FUNCTION public.staff_resources_audit_changed() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_staff_resources_audit
  AFTER INSERT OR UPDATE ON public.staff_resources
  FOR EACH ROW EXECUTE FUNCTION public.staff_resources_audit_changed();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. Audit Trigger staff_resource_services (resource_service_changed)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_resource_services_audit_changed()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_action TEXT;
  v_meta JSONB;
  v_tenant_id UUID;
  v_resource_id UUID;
  v_service_id UUID;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    v_tenant_id := NEW.tenant_id; v_resource_id := NEW.resource_id; v_service_id := NEW.service_id;
  ELSE
    v_tenant_id := OLD.tenant_id; v_resource_id := OLD.resource_id; v_service_id := OLD.service_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'resource_service_added';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'resource_service_changed';
  ELSE
    v_action := 'resource_service_removed';
  END IF;

  v_meta := jsonb_build_object(
    'service_id', v_service_id::text,
    'resource_id', v_resource_id::text,
    'active', (CASE WHEN TG_OP='DELETE' THEN FALSE ELSE NEW.active END)
  );
  PERFORM public._audit_insert_trusted(
    v_tenant_id, v_action, 'staff_resource_service', v_resource_id, v_meta
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

ALTER FUNCTION public.staff_resource_services_audit_changed() OWNER TO postgres;

DO $$ BEGIN
  CREATE TRIGGER trg_staff_resource_services_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_resource_services
  FOR EACH ROW EXECUTE FUNCTION public.staff_resource_services_audit_changed();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 3. Service role explicit grants minimi e giustificati:
--    - anon/public RLS bypass: SOLO tramite SECURITY DEFINER RPC (già sopra).
--    - authenticated: già coperto da RLS.
--    - service_role: implicito supabase, documentiamo grant esplicito
--      su nuove tabelle per chiarezza (usato dal test harness).
-- ----------------------------------------------------------------------------
GRANT ALL ON TABLE public.staff_resources TO service_role;
GRANT ALL ON TABLE public.staff_resource_services TO service_role;
