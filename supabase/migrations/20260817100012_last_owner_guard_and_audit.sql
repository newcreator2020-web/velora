-- 012 — Invarianti e ulteriori security hardening:
--   1) LAST OWNER GUARD — impedisce declassa/rimozione ultimo owner attivo
--   2) EXPLICIT SERVICE-ONLY POLICIES per audit_logs (inserimento autorizzato)
--   3) EXPLICIT REJECT per client authenticated: platform_admins
-- -----------------------------------------------------------------------------
-- 12.1 Trigger function + trigger: guard_last_active_owner
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_last_active_owner()
RETURNS trigger LANGUAGE plpgsql
  SET search_path = '' AS $$
DECLARE
  _tid UUID;
  _remaining_owners INT;
BEGIN
  -- Only care about rows that had/will have role='owner' AND status='active'.
  IF (TG_OP = 'DELETE') THEN
    IF OLD.role <> 'owner' OR OLD.status <> 'active' THEN
      RETURN OLD;
    END IF;
    _tid := OLD.tenant_id;
  ELSE
    IF NEW.role <> 'owner' AND (TG_OP <> 'UPDATE' OR OLD.role <> 'owner') THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'active' AND TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    _tid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  END IF;

  SELECT COUNT(*) INTO STRICT _remaining_owners
    FROM public.tenant_memberships m
   WHERE m.tenant_id = _tid
     AND m.role      = 'owner'
     AND m.status    = 'active';

  IF _remaining_owners = 0 THEN
    RAISE EXCEPTION 'last_active_owner: cannot remove/declass the last active owner of tenant % (see public.guard_last_active_owner)', _tid;
  END IF;

  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

ALTER FUNCTION public.guard_last_active_owner() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_last_active_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS tg_guard_last_active_owner ON public.tenant_memberships;
CREATE CONSTRAINT TRIGGER tg_guard_last_active_owner
AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.guard_last_active_owner();

-- -----------------------------------------------------------------------------
-- 12.2 audit_logs: service_role ONLY insert (reject direct tenant inserts)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_service_only_insert ON public.audit_logs;
CREATE POLICY audit_logs_service_only_insert ON public.audit_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 12.3 platform_admins: nessuna policy per client authenticated
-- (già vero di default perché non avevamo creato policies; lo lasciamo
--  esplicito come promemoria e per audit.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS platform_admins_none_for_clients ON public.platform_admins;
-- (no policy created intentionally: client authenticated always sees 0 rows)
