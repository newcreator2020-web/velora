-- ============================================================
-- FASE 3 · MILESTONE M3 · TASK T9 — MEDIA MANAGER INIT
-- ============================================================
-- Media Manager Velora: catalogo centrale immagini/file con
-- metadata, associazioni M:N a contenuti sito, deduplicazione
-- SHA-256, RLS SUPER_ADMIN only per scritture admin.
-- Storage bucket privato 'velora-media' (500MB cap).
-- ============================================================

-- 0. Estensione pg_trgm per similarity search su nomi file
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. STORAGE BUCKET 'velora-media'
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'velora-media',
  'velora-media',
  false,
  524288000,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/avif',
    'application/pdf',
    'image/heic',
    'image/heif'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. ENUM TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_category') THEN
    CREATE TYPE public.media_category AS ENUM (
      'immagine_generica',
      'servizio',
      'staff',
      'gallery',
      'hero',
      'logo',
      'sfondo',
      'documento'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_status') THEN
    CREATE TYPE public.media_status AS ENUM (
      'draft',
      'published',
      'archived'
    );
  END IF;
END $$;

-- ============================================================
-- 3. TABELLA MEDIA_LIBRARY (catalogo metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename_orig text NOT NULL,
  stored_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 8388608),
  width_px integer NULL,
  height_px integer NULL,
  checksum_sha256 text NULL,
  alt_text text NULL,
  caption text NULL,
  category public.media_category NOT NULL DEFAULT 'immagine_generica',
  variants jsonb NULL,
  owner_tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status public.media_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplicazione SHA-256: due file con stesso checksum sono lo stesso binary
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_checksum
  ON public.media_library (checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;

-- ============================================================
-- 4. TABELLA MEDIA_ASSOCS (associazione M:N cross-contenuti)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.media_assocs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.media_library(id) ON DELETE CASCADE,
  association_type text NOT NULL CHECK (
    association_type IN (
      'servizio',
      'staff',
      'gallery_item',
      'hero_slide',
      'sezione_sito',
      'business_logo',
      'business_sfondo',
      'prospetto_foto'
    )
  ),
  assoc_key_id text NOT NULL,
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ordine integer NOT NULL DEFAULT 0,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, association_type, assoc_key_id, tenant_id)
);

-- ============================================================
-- 5. RLS — SUPER_ADMIN FORCE + service_role bypass
-- ============================================================
ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_library FORCE ROW LEVEL SECURITY;

ALTER TABLE public.media_assocs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assocs FORCE ROW LEVEL SECURITY;

-- media_library policies
DROP POLICY IF EXISTS media_library_platform_admin_all ON public.media_library;
CREATE POLICY media_library_platform_admin_all ON public.media_library
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS media_library_service_role_all ON public.media_library;
CREATE POLICY media_library_service_role_all ON public.media_library
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- media_assocs policies
DROP POLICY IF EXISTS media_assocs_platform_admin_all ON public.media_assocs;
CREATE POLICY media_assocs_platform_admin_all ON public.media_assocs
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS media_assocs_service_role_all ON public.media_assocs;
CREATE POLICY media_assocs_service_role_all ON public.media_assocs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 6. GRANTS
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_library TO authenticated;
GRANT ALL ON public.media_library TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assocs TO authenticated;
GRANT ALL ON public.media_assocs TO service_role;

-- ============================================================
-- 7. INDIICI PRESTAZIONALI
-- ============================================================
-- media_library
CREATE INDEX IF NOT EXISTS idx_media_owner_tenant
  ON public.media_library (owner_tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_category
  ON public.media_library (category);
CREATE INDEX IF NOT EXISTS idx_media_mime
  ON public.media_library (mime_type);
CREATE INDEX IF NOT EXISTS idx_media_created
  ON public.media_library (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_filename_trgm
  ON public.media_library USING GIN (filename_orig gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_media_status
  ON public.media_library (status);

-- media_assocs (ricerca inversa: "tutti i media associati a X")
CREATE INDEX IF NOT EXISTS idx_media_assocs_reverse
  ON public.media_assocs (association_type, assoc_key_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assocs_media
  ON public.media_assocs (media_id);
CREATE INDEX IF NOT EXISTS idx_media_assocs_tenant
  ON public.media_assocs (tenant_id);

-- ============================================================
-- 8. TRIGGER updated_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_media_library_set_updated_at ON public.media_library;
CREATE TRIGGER trg_media_library_set_updated_at
  BEFORE UPDATE ON public.media_library
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_media_assocs_set_updated_at ON public.media_assocs;
CREATE TRIGGER trg_media_assocs_set_updated_at
  BEFORE UPDATE ON public.media_assocs
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
