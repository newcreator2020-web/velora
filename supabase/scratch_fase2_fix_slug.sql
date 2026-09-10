\set ON_ERROR_STOP 1
BEGIN;

-- Verifica slug corrente
SELECT slug as old_slug FROM public.tenants WHERE slug='slugo_mtu30v76_1fon';

-- Update URL-safe slug (slug normalizza _ -> - in site-engine slugSchema)
UPDATE public.tenants SET
  slug = 'slugo-mtu30v76-1fon',
  updated_at = NOW()
WHERE slug = 'slugo_mtu30v76_1fon';

COMMIT;

SELECT 'VERIFY_SLUG' as step, slug, status, published, id
FROM public.tenants WHERE slug='slugo-mtu30v76-1fon';
