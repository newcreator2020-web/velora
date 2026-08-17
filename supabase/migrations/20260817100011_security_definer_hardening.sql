-- 011 — SECURITY DEFINER hardening per tutte le helpers di autorizzazione.
--
-- Cambiamenti:
--   * search_path = '' (vuoto) — impedisce search-path hijacking
--   * tutti i riferimenti a funzioni / tabelle sono FULLY QUALIFIED
--     public.xxx / auth.xxx
--   * STABLE, no volatile side-effects
--   * EXECUTE rimane GRANT-only a ruoli previsti (NON PUBLIC)
--
-- La semantica è IDENTICA alla 008; stiamo solo irrobustendo.
-- -----------------------------------------------------------------------------
-- 11.1 is_tenant_member(target_tenant_id)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tenant_member(target_tenant_id UUID)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR target_tenant_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.tenant_memberships m
    WHERE m.tenant_id = target_tenant_id
      AND m.user_id    = _uid
      AND m.status     = 'active'
  );
END; $$;

ALTER FUNCTION public.is_tenant_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_tenant_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(UUID) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11.2 has_tenant_role(target_tenant_id, allowed_roles[])
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tenant_role(
  target_tenant_id UUID,
  allowed_roles     TEXT[]
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL OR target_tenant_id IS NULL OR allowed_roles IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.tenant_memberships m
    WHERE m.tenant_id = target_tenant_id
      AND m.user_id    = _uid
      AND m.status     = 'active'
      AND m.role       = ANY(allowed_roles)
  );
END; $$;

ALTER FUNCTION public.has_tenant_role(UUID, TEXT[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_tenant_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(UUID, TEXT[]) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11.3 is_platform_admin()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = _uid
      AND pa.status  = 'active'
  );
END; $$;

ALTER FUNCTION public.is_platform_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated, service_role;
