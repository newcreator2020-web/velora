-- ============================================================================
-- FASE 12E — Concorrenza: transition EXCLUDE (tenant,svc,time) → (tenant,resource,time)
--
-- SEQUENZA CRITICA OBBLIGATORIA §11 mandato FASE12:
--   A. staff_resources esistono (12A)
--   B. default resources esistono per tutti i tenant (12B)
--   C. bookings.resource_id aggiunto (12D)
--   D. tutti i confirmed booking backfillati (12D DO block)
--   E. CHECK confirmed.resource_id IS NOT NULL (12D constraints)
--   F. ← QUESTO FILE → aggiungi nuovo EXCLUDE (tenant,resource,time) confirmed
--   G. prova runtime
--   H. ← QUESTO FILE stesso → DROP CONSTRAINT bookings_no_overlap_confirmed
--              (vecchio (tenant,service,time) CHE IMPEDIVA multi-resource!)
--
-- SEMANTICA FINALE OBBLIGATORIA dopo 12E:
--   Maria Taglio 10:00 confirmed
--   Luca  Taglio 10:00 confirmed        → ENTRAMBI PERMESSI (2 diverse resource)
--   Maria Taglio 10:00 seconda volta     → NEGATO (stessa resource overlap)
--
-- Zero momenti senza protezione overlap: entrambi i constraint convivono
-- tra le istruzioni F e H del file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ASSERT DI PRE-CONDIZIONE (sicurezza fail-closed):
--   se ALMENO un confirmed booking ha resource_id NULL → RAISE EXCEPTION.
--   La nuova EXCLUDE non può essere creata in modo semantico corretto se non
--   tutti i confirmed hanno risorsa assegnata.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_null_confirmed BIGINT;
BEGIN
  SELECT count(*) INTO v_null_confirmed
    FROM public.bookings
   WHERE status = 'confirmed'
     AND resource_id IS NULL;
  IF v_null_confirmed > 0 THEN
    RAISE EXCEPTION 'fase12e_precondition_failed: confirmed bookings null resource = %', v_null_confirmed
      USING HINT = 'Esegui backfill 12D o cancella i confirmed orphan prima di 12E.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- F. NUOVO EXCLUDE CONSTRAINT con granularità RISORSA (non servizio)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_no_resource_overlap_confirmed'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_no_resource_overlap_confirmed
      EXCLUDE USING gist (
        tenant_id WITH =,
        resource_id WITH =,
        TSTZRANGE(starts_at, ends_at, '[)') WITH &&
      ) WITH (FILLFACTOR = 90) WHERE (public.bookings.status = 'confirmed');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- H. DROP del vecchio EXCLUDE (tenant,service,time) CHE IMPEDIVA
--    a due operatori DIVERSI di prendere lo stesso slot sullo stesso servizio.
--    Eseguito SOLO DOPO che il nuovo è stato creato con successo (stessa transazione).
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'bookings_no_overlap_confirmed'
  ) THEN
    ALTER TABLE public.bookings
      DROP CONSTRAINT bookings_no_overlap_confirmed;
  END IF;
END $$;
