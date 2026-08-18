-- 021: Public anonymous RLS policies for multi-tenant Site Engine.
-- Append-only. Idempotent.
-- Note: policies are role-scoped and additive with existing authenticated/member policies.
--       Anon can ONLY SELECT rows whose tenant is published AND active.
--       Anon CANNOT INSERT/UPDATE/DELETE anything on tenants/bp/memberships/profiles/audit/platform_admins.

GRANT SELECT ON public.tenants TO anon;
GRANT SELECT ON public.business_profiles TO anon;

-- ---------------------------------------------------------------------------
-- tenants: anonymous users may ONLY look up published + active tenants.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenants_anon_select_published ON public.tenants;
CREATE POLICY tenants_anon_select_published ON public.tenants
  FOR SELECT TO anon
  USING (
    published = TRUE
    AND status = 'active'
  );

-- ---------------------------------------------------------------------------
-- business_profiles: anonymous users may ONLY read a business_profile if the
--                  linked tenant is published AND active.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS bp_anon_select_published ON public.business_profiles;
CREATE POLICY bp_anon_select_published ON public.business_profiles
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
        FROM public.tenants t
       WHERE t.id = business_profiles.tenant_id
         AND t.published = TRUE
         AND t.status = 'active'
    )
  );
