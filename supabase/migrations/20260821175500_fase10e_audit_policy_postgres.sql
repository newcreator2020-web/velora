-- =========================================================================
-- FASE 10E — DEFECT CLOSURE 4: audit SEC DEFINER owner=postgres; la policy
--   audit_logs_service_only_insert matcha SOLO service_role.
--   Soluzione: amplia roles della policy.
--   Minima: postgres + service_role; authenticated/anon NON permesso INSERT
--   diretto (audit_logs write-only via trusted SEC DEFINER boundary).
--
-- APPEND ONLY.
-- =========================================================================

DROP POLICY IF EXISTS audit_logs_service_only_insert ON public.audit_logs;
CREATE POLICY audit_logs_service_only_insert ON public.audit_logs
  FOR INSERT TO service_role, postgres
  WITH CHECK (true);

-- Non indebolire SELECT: audit_logs read trusted service role o platform admin.
