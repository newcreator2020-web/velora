-- ============================================================
--  MIGRAZIONE FASE VISUAL QUALITY 1
--  Estende CHECK constraint variant site_sections
--  + colonne design_preset_id su editorial_state / publication_versions / tenants
--  Ogni step IDEMPOTENTE con DO $$ IF NOT EXISTS.
-- ============================================================

-- 1. ALLARGA CHECK constraint site_sections_variant_check a TUTTE le varianti
DO $$ BEGIN
  ALTER TABLE public.site_sections
    DROP CONSTRAINT IF EXISTS site_sections_variant_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.site_sections
  ADD CONSTRAINT site_sections_variant_check CHECK (
    variant IN (
      -- classiche
      'default','centered','split','split_hero_left','fullscreen','minimal',
      'cards','carousel','table','list','masonry','grid','compact','full',
      'premium','transparent','expanded','inline','floating','icons',
      -- nuove visual quality (P4 Hero + P6 Services)
      'editorial','asymmetric','image_cards',
      'editorial_list','category_tabs','image_services','compact_list'
    )
  );

-- ====== 2. site_editorial_state.design_preset_id ======
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='site_editorial_state'
       AND column_name='design_preset_id'
  ) THEN
    ALTER TABLE public.site_editorial_state
      ADD COLUMN design_preset_id text NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.site_editorial_state.design_preset_id IS
  'Sovrascrive il preset di design del tenant per questo draft (opzionale).';

DO $$ BEGIN
  ALTER TABLE public.site_editorial_state
    DROP CONSTRAINT IF EXISTS site_editorial_state_design_preset_id_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.site_editorial_state
  ADD CONSTRAINT site_editorial_state_design_preset_id_check CHECK (
    design_preset_id IS NULL OR design_preset_id IN (
      'elegant','soft_beauty','barber_strong','minimal',
      'editorial','warm_natural','luxury'
    )
  );

-- ====== 3. site_publication_versions.design_preset_id ======
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='site_publication_versions'
       AND column_name='design_preset_id'
  ) THEN
    ALTER TABLE public.site_publication_versions
      ADD COLUMN design_preset_id text NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.site_publication_versions.design_preset_id IS
  'Design preset congelato alla pubblicazione (eredita tenant o override editorial_state).';

DO $$ BEGIN
  ALTER TABLE public.site_publication_versions
    DROP CONSTRAINT IF EXISTS site_publication_versions_design_preset_id_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.site_publication_versions
  ADD CONSTRAINT site_publication_versions_design_preset_id_check CHECK (
    design_preset_id IS NULL OR design_preset_id IN (
      'elegant','soft_beauty','barber_strong','minimal',
      'editorial','warm_natural','luxury'
    )
  );

-- ====== 4. tenants.design_preset_id ======
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tenants'
       AND column_name='design_preset_id'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN design_preset_id text NOT NULL DEFAULT 'elegant';
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.tenants
    DROP CONSTRAINT IF EXISTS tenants_design_preset_id_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_design_preset_id_check CHECK (
    design_preset_id IN (
      'elegant','soft_beauty','barber_strong','minimal',
      'editorial','warm_natural','luxury'
    )
  );
