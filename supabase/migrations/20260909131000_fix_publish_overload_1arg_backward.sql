-- T21 fix: ripristina overload publish_site_draft(p_tenant_id UUID) per backward compatibility
-- (la 3-arg DEFAULT NULL non genera automaticamente un 1-arg match nei call storici site-editorial-fase6.test.ts)
CREATE OR REPLACE FUNCTION public.publish_site_draft(
  p_tenant_id UUID
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
BEGIN
  RETURN QUERY SELECT * FROM public.publish_site_draft(p_tenant_id, NULL::uuid, auth.uid());
END $$;
