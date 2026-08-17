-- 005: Business Profiles (1:1 with tenant). Idempotent.
CREATE TABLE IF NOT EXISTS public.business_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name TEXT,
  legal_name TEXT,
  category TEXT
    CHECK (category IS NULL OR category IN (
      'barbershop','beauty_salon','hair_salon','wellness','spa',
      'restaurant','hotel','fitness','other')),
  description TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  website_url TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country_code TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  locale TEXT NOT NULL DEFAULT 'it-IT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_profiles_coords_check
    CHECK (
      (latitude IS NULL AND longitude IS NULL) OR
      (latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_business_profiles_city_country
  ON public.business_profiles(city, country_code);
CREATE INDEX IF NOT EXISTS idx_business_profiles_category
  ON public.business_profiles(category);

DROP TRIGGER IF EXISTS set_public_business_profiles_updated_at ON public.business_profiles;
CREATE TRIGGER set_public_business_profiles_updated_at
BEFORE UPDATE ON public.business_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
