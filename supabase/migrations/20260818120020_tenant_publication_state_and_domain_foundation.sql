-- 020: Tenant publication state + custom domain foundation.
-- Append-only. Idempotent. Does NOT modify any frozen column of migration 002.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'published'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN published BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'temporary_domain'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN temporary_domain TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'custom_domain'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN custom_domain TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'published_at'
  ) THEN
    ALTER TABLE public.tenants
      ADD COLUMN published_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = 'public' AND table_name = 'tenants' AND constraint_name = 'tenants_temporary_domain_key'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_temporary_domain_key UNIQUE (temporary_domain);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_schema = 'public' AND table_name = 'tenants' AND constraint_name = 'tenants_custom_domain_key'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_custom_domain_key UNIQUE (custom_domain);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_published_status
  ON public.tenants(published, status);

CREATE INDEX IF NOT EXISTS idx_tenants_temporary_domain
  ON public.tenants(temporary_domain)
  WHERE temporary_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain
  ON public.tenants(custom_domain)
  WHERE custom_domain IS NOT NULL;
