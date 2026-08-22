-- ============================================================================
-- FASE 13B2 — Business Schedule Exceptions (closure / special / extra_open / slot_block)
--
-- Quattro tipi distinti, quattro livelli di precedenza DETERMINISTICA:
--
--   1 slot_block     — nega sempre un range specifico, vince su TUTTO.
--   2 closure        — chiusura totale attività nel range.
--   3 special_hours  — sostituisce il business weekly hours nel range.
--   4 extra_open     — aggiunge disponibilità dove chiusura o weekly hours
--                      non consentono slot.
--
-- Precedenza implementata in scheduling_business_ranges (13B4) non con
-- "più specifico vince", perché ambiguo.
--
-- Range semantica: [starts_at, ends_at) half-open TIMESTAMPTZ (UTC interno).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.business_schedule_exceptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL
    CHECK (exception_type IN ('closure','special_hours','extra_open','slot_block')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  -- Campi opzionali usati solo da special_hours / extra_open / slot_block:
  start_time TIME NULL,
  end_time TIME NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT business_schedule_exceptions_valid_range CHECK (starts_at < ends_at),

  -- Se type usa lo start_time/end_time locale, range deve essere < 28 giorni
  -- (si tratta di eccezioni specifiche, non regole ricorrenti).
  CONSTRAINT business_schedule_exceptions_reasonable_window
    CHECK ((ends_at - starts_at) <= INTERVAL '90 days')
);

-- GiST per overlap lookup: slot engine e calendar ne hanno bisogno spesso.
CREATE INDEX IF NOT EXISTS business_schedule_exceptions_overlap_idx
  ON public.business_schedule_exceptions
  USING GIST (tenant_id, tstzrange(starts_at, ends_at, '[)'));

CREATE INDEX IF NOT EXISTS business_schedule_exceptions_tenant_type_idx
  ON public.business_schedule_exceptions(tenant_id, exception_type, starts_at);

DO $$ BEGIN
  CREATE TRIGGER set_business_schedule_exceptions_updated_at
  BEFORE UPDATE ON public.business_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.business_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_schedule_exceptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bse_select_member ON public.business_schedule_exceptions;
CREATE POLICY bse_select_member ON public.business_schedule_exceptions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS bse_insert_owner_manager ON public.business_schedule_exceptions;
CREATE POLICY bse_insert_owner_manager ON public.business_schedule_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS bse_update_owner_manager ON public.business_schedule_exceptions;
CREATE POLICY bse_update_owner_manager ON public.business_schedule_exceptions
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

DROP POLICY IF EXISTS bse_delete_owner_manager ON public.business_schedule_exceptions;
CREATE POLICY bse_delete_owner_manager ON public.business_schedule_exceptions
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, ARRAY['owner','manager']));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_schedule_exceptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_schedule_exceptions TO authenticated;
