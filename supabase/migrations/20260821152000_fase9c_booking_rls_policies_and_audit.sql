-- FASE 9c: RLS policies + audit immutability + grants per bookings/business_availability.
-- Allinea pattern FASE1..FASE8: FORCE RLS abilitati in 9a, qui solo policy e audit.

-- =========================================================================
-- 1. business_availability POLICIES
--    - ANON: SELECT solo per tenant PUBBLICATO.
--    - OWNER/MANAGER (authenticated member): ALL own tenant.
--    - STAFF (authenticated member): SELECT own tenant only.
--    - SERVICE_ROLE: ALL (force rls bypass, justificato per provisioning).
-- =========================================================================
DROP POLICY IF EXISTS business_availability_anon_select_public ON public.business_availability;
CREATE POLICY business_availability_anon_select_public ON public.business_availability
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = business_availability.tenant_id AND t.published = TRUE
    )
  );

DROP POLICY IF EXISTS business_availability_owner_manager_all ON public.business_availability;
CREATE POLICY business_availability_owner_manager_all ON public.business_availability
  FOR ALL TO authenticated
  USING (
    public.has_tenant_role(business_availability.tenant_id, ARRAY['owner','manager'])
  ) WITH CHECK (
    public.has_tenant_role(business_availability.tenant_id, ARRAY['owner','manager'])
  );

DROP POLICY IF EXISTS business_availability_staff_select ON public.business_availability;
CREATE POLICY business_availability_staff_select ON public.business_availability
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(business_availability.tenant_id, ARRAY['staff','owner','manager'])
  );

DROP POLICY IF EXISTS business_availability_service_role_all ON public.business_availability;
CREATE POLICY business_availability_service_role_all ON public.business_availability
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- =========================================================================
-- 2. bookings POLICIES
--    - ANON: NO DIRECT SELECT/UPDATE/DELETE. L'anon scrive SOLO tramite
--      RPC trusted public_booking_create_slug (SECURITY DEFINER con audit).
--    - OWNER/MANAGER: SELECT + UPDATE status cancellazione own tenant.
--    - STAFF: solo SELECT own tenant (read only).
--    - SERVICE_ROLE: ALL (force rls bypass).
-- =========================================================================
-- Anon: NIENTE diretto diretto, tutto via RPC.
DROP POLICY IF EXISTS bookings_owner_manager_read ON public.bookings;
CREATE POLICY bookings_owner_manager_read ON public.bookings
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(bookings.tenant_id, ARRAY['owner','manager'])
  );

DROP POLICY IF EXISTS bookings_owner_manager_cancel ON public.bookings;
CREATE POLICY bookings_owner_manager_cancel ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(bookings.tenant_id, ARRAY['owner','manager'])
  ) WITH CHECK (
    public.has_tenant_role(bookings.tenant_id, ARRAY['owner','manager'])
    AND bookings.status = 'cancelled'
  );

DROP POLICY IF EXISTS bookings_staff_readonly ON public.bookings;
CREATE POLICY bookings_staff_readonly ON public.bookings
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(bookings.tenant_id, ARRAY['staff','owner','manager'])
  );

DROP POLICY IF EXISTS bookings_service_role_all ON public.bookings;
CREATE POLICY bookings_service_role_all ON public.bookings
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- =========================================================================
-- 3. BOOKING immutability guard: UPDATE su colonne sensibili VIETATO.
--    Solo transition status: confirmed -> cancelled permessa.
--    Vietato cambiare tenant, service, starts_at, ends_at, customer fields.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bookings_update_restricted()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Tenant immutabile.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'bookings.tenant_id immutable' USING errcode = 'VF403';
  END IF;

  -- Service immutabile.
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    RAISE EXCEPTION 'bookings.service_id immutable' USING errcode = 'VF403';
  END IF;

  -- Times immutabili.
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    RAISE EXCEPTION 'bookings time fields immutable' USING errcode = 'VF403';
  END IF;

  -- Customer fields immutabili per RLS diretto update (sono PII).
  IF NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
     OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'bookings customer fields immutable' USING errcode = 'VF403';
  END IF;

  -- Status transition solo confirmed -> cancelled.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'confirmed' AND NEW.status = 'cancelled' THEN
      -- Consentita.
    ELSE
      RAISE EXCEPTION 'bookings invalid status transition' USING errcode = 'VF400';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DO $$ BEGIN
  CREATE TRIGGER bookings_restrict_updates
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_update_restricted();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 4. AUDIT immutability: DELETE bookings = VIETATO (soft cancel only).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bookings_delete_denied()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'bookings: DELETE denied. Soft cancel using status=cancelled.' USING errcode = 'VF403';
END; $$;

DO $$ BEGIN
  CREATE TRIGGER bookings_no_delete
  BEFORE DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_delete_denied();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 5. Audit trigger: booking status_changed PII-safe.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.bookings_audit_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    v_action := 'booking_cancelled';
    BEGIN
      INSERT INTO public.audit_logs (tenant_id, actor_kind, actor_id, action, resource_type, resource_id, metadata)
      VALUES (
        NEW.tenant_id,
        CASE WHEN current_user = 'service_role' THEN 'system' ELSE 'member' END,
        COALESCE(auth.uid()::text, current_user),
        v_action,
        'booking',
        NEW.id,
        jsonb_build_object(
          'service_id', NEW.service_id::text,
          'starts_at', NEW.starts_at::text,
          'from_status', OLD.status,
          'to_status', NEW.status,
          'source', 'dashboard'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- Audit failure NON blocking.
    END;
  END IF;
  RETURN NEW;
END; $$;

DO $$ BEGIN
  CREATE TRIGGER bookings_audit_status_change
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_audit_status();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 6. DEFAULT SEED availability DEFAULT 9-18 LUN-SAB CLOSED SUN per nuovi tenants
--    (triggers when tenant created). Existing tenants: seed se vuoto.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.seed_default_availability_for_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  wd SMALLINT;
BEGIN
  FOR wd IN 1..5 LOOP -- Lun=1..Ven=5 (1 ISODOW, noi weekday Sun=0 quindi 1..5 = LUN-VEN)
    INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
    VALUES (NEW.id, wd, TRUE, '09:00', '18:00')
    ON CONFLICT (tenant_id, weekday) DO NOTHING;
  END LOOP;
  -- Sabato (ISODOW 6 → weekday 6) enabled 9-13
  INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
  VALUES (NEW.id, 6, TRUE, '09:00', '13:00')
  ON CONFLICT (tenant_id, weekday) DO NOTHING;
  -- Domenica (ISODOW 7 → weekday 0) disabled
  INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
  VALUES (NEW.id, 0, FALSE, '09:00', '18:00')
  ON CONFLICT (tenant_id, weekday) DO NOTHING;
  RETURN NEW;
END; $$;

DO $$ BEGIN
  CREATE TRIGGER on_tenant_created_seed_availability
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_availability_for_tenant();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed EXISTING tenants (solo se mancano righe). Mantiene existing se presenti.
INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
SELECT t.id, w.weekday, w.enabled::boolean, w.start_time::time, w.end_time::time
FROM public.tenants t
CROSS JOIN (
  SELECT 1 AS weekday, TRUE AS enabled, '09:00' AS start_time, '18:00' AS end_time UNION ALL
  SELECT 2, TRUE, '09:00', '18:00' UNION ALL SELECT 3, TRUE, '09:00', '18:00' UNION ALL
  SELECT 4, TRUE, '09:00', '18:00' UNION ALL SELECT 5, TRUE, '09:00', '18:00' UNION ALL
  SELECT 6, TRUE, '09:00', '13:00' UNION ALL SELECT 0, FALSE, '09:00', '18:00'
) w
WHERE NOT EXISTS (
  SELECT 1 FROM public.business_availability ba
  WHERE ba.tenant_id = t.id AND ba.weekday = w.weekday
);

-- =========================================================================
-- 7. GRANTS finali.
-- =========================================================================
GRANT SELECT ON public.business_availability TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_availability TO authenticated;
GRANT ALL ON public.business_availability TO service_role;

GRANT SELECT ON public.bookings TO authenticated;
-- Anon NESSUN accesso diretto (bookings PII). Scrittura anon SOLO via RPC trusted.
GRANT ALL ON public.bookings TO service_role;
