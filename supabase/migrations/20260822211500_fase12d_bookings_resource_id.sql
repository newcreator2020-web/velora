-- ============================================================================
-- FASE 12D — Bookings resource_id nullable + composite FK + backfill.
--
-- Sequenza safe:
--  (a) ADD resource_id UUID NULL
--  (b) ADD FK composite RESTRICT (preserva identità risorsa nello storico)
--  (c) BACKFILL tutti i booking senza risorsa con default resource del tenant
--  (d) ADD CHECK CONSTRAINT: confirmed bookings MAI possono avere resource_id NULL
--      (fail-safe: i cancelled possono restare NULL per migrazioni future, ma se
--       confirmed devono SEMPRE risolversi a una risorsa reale — garantisce 12E).
-- ============================================================================

-- (a) ADD COLUMN nullable
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS resource_id UUID NULL;

-- (b) Composite FK RESTRICT — nessun hard delete di resource con storico bookings.
--     Prerequisito UNIQUE(tenant_id,id) creato in 12A per staff_resources.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_resource_composite_fk'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_resource_composite_fk
      FOREIGN KEY (tenant_id, resource_id)
      REFERENCES public.staff_resources(tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Indice per overlap query (slot engine V2, bookings lookup per resource
CREATE INDEX IF NOT EXISTS bookings_tenant_resource_status_starts_idx
  ON public.bookings(tenant_id, resource_id, status, starts_at);

-- (c) BACKFILL idempotente: ogni booking NULL → default resource del tenant.
--     "Default resource" = staff_resources con slug='principale' per quel tenant
--     se esiste; altrimenti prima resource sort_order ASC, id ASC.
DO $$
DECLARE
  v_count_backfilled BIGINT;
BEGIN
  WITH candidate AS (
    SELECT
      b.bt AS tenant_id,
      (
        SELECT sr.id
        FROM public.staff_resources sr
        WHERE sr.tenant_id = b.bt
          AND sr.active = TRUE
        ORDER BY
          CASE WHEN sr.slug = 'principale' THEN 0 ELSE 1 END,
          sr.sort_order ASC,
          sr.id ASC
        LIMIT 1
      ) AS rid
    FROM (
      SELECT DISTINCT tenant_id AS bt
      FROM public.bookings bb
      WHERE bb.resource_id IS NULL
    ) b(bt)
  )
  UPDATE public.bookings bk
  SET resource_id = c.rid
  FROM candidate c
  WHERE bk.tenant_id = c.tenant_id
    AND bk.resource_id IS NULL
    AND c.rid IS NOT NULL;

  GET DIAGNOSTICS v_count_backfilled = ROW_COUNT;
  -- RAISE NOTICE 'backfilled bookings resource_id: %', v_count_backfilled;
END $$;

-- (d) CHECK invariant confirmed bookings MUST have resource_id NOT NULL.
--     I cancelled possono stare NULL (caso estremo migrazione dati storici; tuttavia
--     nella pratica 12D backfill tutti, ma non blocchiamo l'intera migrazione per
--     booking cancellati antecedenti FASE12.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_confirmed_resource_not_null'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_confirmed_resource_not_null
      CHECK (status <> 'confirmed' OR resource_id IS NOT NULL);
  END IF;
END $$;

-- Verifica: dopo backfill, 0 confirmed NULL confirmed a resource_id IS NULL
-- (non esegue solo controllo strutturale: se violato → CHECK fallisce in 12E new exclude non può procedere)
