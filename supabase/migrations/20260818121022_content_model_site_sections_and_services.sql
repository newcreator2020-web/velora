-- 022: Site Sections Content Model, Services Minimal, Theme Tokens foundation.
-- Append-only. Idempotent. Does NOT modify any frozen column in 001..021.
-- Pattern RLS & FK follows 008/020/021 conventions (has_tenant_role / is_tenant_member / published + active).

-- ============================================================
-- A) SERVICES: minimale business-structured (GATE 16, 17 prices numeric)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description TEXT CHECK (char_length(description) <= 1000),
  price_from NUMERIC(10, 2) CHECK (price_from IS NULL OR price_from >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD','GBP','CHF')),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS services_tenant_position_key
  ON public.services(tenant_id, position);

CREATE INDEX IF NOT EXISTS services_tenant_active_idx
  ON public.services(tenant_id, active, position);

-- Trigger updated_at services
DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================
-- B) SITE_SECTIONS (GATE 7, 12 ordering, 13 singleton hero/about/contact)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL
    CHECK (section_type IN ('hero','about','services','gallery','staff','reviews','contact')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  variant TEXT NOT NULL DEFAULT 'default'
    CHECK (variant IN ('default','centered','split','minimal','cards','carousel')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deterministic ordering per-tenant: no two sections same position
CREATE UNIQUE INDEX IF NOT EXISTS site_sections_tenant_position_key
  ON public.site_sections(tenant_id, position);

-- Index per lookup anon: tenant + enabled + position (main SELECT)
CREATE INDEX IF NOT EXISTS site_sections_tenant_enabled_idx
  ON public.site_sections(tenant_id, enabled, position);

-- Singleton GATE 13: hero/about/contact UNIQUE per tenant
DROP INDEX IF EXISTS site_sections_singleton_hero_idx;
DROP INDEX IF EXISTS site_sections_singleton_about_idx;
DROP INDEX IF EXISTS site_sections_singleton_contact_idx;

CREATE UNIQUE INDEX IF NOT EXISTS site_sections_singleton_hero_idx
  ON public.site_sections(tenant_id)
  WHERE (section_type = 'hero');

CREATE UNIQUE INDEX IF NOT EXISTS site_sections_singleton_about_idx
  ON public.site_sections(tenant_id)
  WHERE (section_type = 'about');

CREATE UNIQUE INDEX IF NOT EXISTS site_sections_singleton_contact_idx
  ON public.site_sections(tenant_id)
  WHERE (section_type = 'contact');

DROP TRIGGER IF EXISTS trg_site_sections_updated_at ON public.site_sections;
CREATE TRIGGER trg_site_sections_updated_at
  BEFORE UPDATE ON public.site_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================
-- C) THEME TOKENS foundation (GATE 24/25 tokens, NO raw CSS)
--    Aggiunto a business_profiles perche singleton 1:1 col BP
--    Valori default deterministic (non salviamo rows duplicate)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_primary') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_primary TEXT
      CHECK (theme_primary IS NULL OR theme_primary ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_background') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_background TEXT
      CHECK (theme_background IS NULL OR theme_background ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_foreground') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_foreground TEXT
      CHECK (theme_foreground IS NULL OR theme_foreground ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_muted') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_muted TEXT
      CHECK (theme_muted IS NULL OR theme_muted ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_radius') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_radius TEXT
      CHECK (theme_radius IS NULL OR theme_radius IN ('none','sm','md','lg','xl','full'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_heading_font_preset') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_heading_font_preset TEXT
      CHECK (theme_heading_font_preset IS NULL OR theme_heading_font_preset IN ('sans','serif','mono','display'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='business_profiles' AND column_name='theme_body_font_preset') THEN
    ALTER TABLE public.business_profiles ADD COLUMN theme_body_font_preset TEXT
      CHECK (theme_body_font_preset IS NULL OR theme_body_font_preset IN ('sans','serif','mono'));
  END IF;
END $$;

-- ============================================================
-- D) RLS: ENABLE + FORCE
-- ============================================================

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_sections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- FORCE RLS se supportato da versione 15 (sempre su Supabase 15).
  EXECUTE 'ALTER TABLE public.services FORCE ROW LEVEL SECURITY';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'ALTER TABLE public.site_sections FORCE ROW LEVEL SECURITY';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- E) GRANTS minimi (GATE 36 minimali, congruenti 008)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.services TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_sections TO authenticated;
GRANT SELECT ON TABLE public.services TO anon;
GRANT SELECT ON TABLE public.site_sections TO anon;

-- ============================================================
-- F) AUTHENTICATED policies — services
-- ============================================================

DROP POLICY IF EXISTS services_select_member_or_platform ON public.services;
CREATE POLICY services_select_member_or_platform ON public.services
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS services_write_owner_manager_or_platform ON public.services;
CREATE POLICY services_write_owner_manager_or_platform ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS services_update_owner_manager_or_platform ON public.services;
CREATE POLICY services_update_owner_manager_or_platform ON public.services
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS services_delete_owner_manager_or_platform ON public.services;
CREATE POLICY services_delete_owner_manager_or_platform ON public.services
  FOR DELETE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

-- ============================================================
-- G) AUTHENTICATED policies — site_sections
-- ============================================================

DROP POLICY IF EXISTS sections_select_member_or_platform ON public.site_sections;
CREATE POLICY sections_select_member_or_platform ON public.site_sections
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS sections_insert_owner_manager_or_platform ON public.site_sections;
CREATE POLICY sections_insert_owner_manager_or_platform ON public.site_sections
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS sections_update_owner_manager_or_platform ON public.site_sections;
CREATE POLICY sections_update_owner_manager_or_platform ON public.site_sections
  FOR UPDATE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  )
  WITH CHECK (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS sections_delete_owner_manager_or_platform ON public.site_sections;
CREATE POLICY sections_delete_owner_manager_or_platform ON public.site_sections
  FOR DELETE TO authenticated
  USING (
    public.has_tenant_role(tenant_id, ARRAY['owner','manager'])
    OR public.is_platform_admin()
  );
