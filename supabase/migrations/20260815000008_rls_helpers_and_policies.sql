-- 008: SECURITY DEFINER helpers + RLS policies.
-- All helpers are STABLE, qualified to public.*, with search_path pinned.
--
-- NOTE: is_platform_admin() / is_tenant_member() / has_tenant_role()
-- are intentionally GRANTed to anon & authenticated (they read from
-- public.* which is already filtered by RLS; helpers exist to keep
-- policies short and readable).

CREATE OR REPLACE FUNCTION public.is_tenant_member(target_tenant_id UUID)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships m
     WHERE m.tenant_id = target_tenant_id
       AND m.user_id = _uid
       AND m.status = 'active'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(
  target_tenant_id UUID, allowed_roles TEXT[]
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships m
     WHERE m.tenant_id = target_tenant_id
       AND m.user_id = _uid
       AND m.status = 'active'
       AND m.role = ANY(allowed_roles)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.platform_admins pa
     WHERE pa.user_id = _uid
       AND pa.status = 'active'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.is_tenant_member(UUID)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(UUID, TEXT[])
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin()
  TO anon, authenticated, service_role;

--------------------------------------------------------------------------------
-- Policies: tenants
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenants_select_self_members ON public.tenants;
CREATE POLICY tenants_select_self_members ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(id)
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS tenants_insert_platform_admin ON public.tenants;
CREATE POLICY tenants_insert_platform_admin ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS tenants_update_owner_or_platform ON public.tenants;
CREATE POLICY tenants_update_owner_or_platform ON public.tenants
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(id, ARRAY['owner'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(id, ARRAY['owner'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS tenants_delete_platform_admin ON public.tenants;
CREATE POLICY tenants_delete_platform_admin ON public.tenants
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

--------------------------------------------------------------------------------
-- Policies: profiles
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own_or_member ON public.profiles;
CREATE POLICY profiles_select_own_or_member ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships m1
       WHERE m1.user_id = auth.uid() AND m1.status = 'active'
         AND EXISTS (
           SELECT 1 FROM public.tenant_memberships m2
            WHERE m2.tenant_id = m1.tenant_id
              AND m2.user_id = public.profiles.id
              AND m2.status = 'active'
         )
    )
  );

DROP POLICY IF EXISTS profiles_insert_service_role ON public.profiles;
CREATE POLICY profiles_insert_service_role ON public.profiles
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS profiles_update_own_or_platform ON public.profiles;
CREATE POLICY profiles_update_own_or_platform ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin())
  WITH CHECK (id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS profiles_delete_platform_admin ON public.profiles;
CREATE POLICY profiles_delete_platform_admin ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

--------------------------------------------------------------------------------
-- Policies: tenant_memberships
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS memberships_select_self ON public.tenant_memberships;
CREATE POLICY memberships_select_self ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_tenant_member(tenant_id)
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS memberships_insert_owner_or_platform ON public.tenant_memberships;
CREATE POLICY memberships_insert_owner_or_platform ON public.tenant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS memberships_update_owner_or_platform ON public.tenant_memberships;
CREATE POLICY memberships_update_owner_or_platform ON public.tenant_memberships
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS memberships_delete_owner_or_platform ON public.tenant_memberships;
CREATE POLICY memberships_delete_owner_or_platform ON public.tenant_memberships
  FOR DELETE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner'])
    OR public.is_platform_admin()
  );

--------------------------------------------------------------------------------
-- Policies: business_profiles
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS bp_select_member_or_platform ON public.business_profiles;
CREATE POLICY bp_select_member_or_platform ON public.business_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(tenant_id)
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS bp_insert_service_role ON public.business_profiles;
CREATE POLICY bp_insert_service_role ON public.business_profiles
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS bp_update_manager_owner_or_platform ON public.business_profiles;
CREATE POLICY bp_update_manager_owner_or_platform ON public.business_profiles
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS bp_delete_platform_admin ON public.business_profiles;
CREATE POLICY bp_delete_platform_admin ON public.business_profiles
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());
