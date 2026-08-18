-- 023: ANON RLS for services & site_sections. ADDITIVE. Does NOT modify 021 or prior.
-- Follows same pattern as 021 (tenant published=true + status='active').

DROP POLICY IF EXISTS services_anon_select_published ON public.services;
CREATE POLICY services_anon_select_published ON public.services
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenants t
       WHERE t.id = tenant_id
         AND t.published = TRUE
         AND t.status = 'active'
    )
    AND active = TRUE
  );

DROP POLICY IF EXISTS site_sections_anon_select_published ON public.site_sections;
CREATE POLICY site_sections_anon_select_published ON public.site_sections
  FOR SELECT TO anon
  USING (
    enabled = TRUE
    AND EXISTS (
      SELECT 1 FROM public.tenants t
       WHERE t.id = tenant_id
         AND t.published = TRUE
         AND t.status = 'active'
    )
  );
