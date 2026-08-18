-- 019: Grant service_role INSERT + SELECT on audit_logs (append-only, idempotent).
-- Pre-conditions bug fixed:
--   (a) service_role was missing INSERT/SELECT on public.audit_logs, causing
--       silent audit insert failures via the service_role Supabase client.
--   (b) authenticated role retains DML (already granted earlier) for completeness.
-- Re-running this migration many times is safe (GRANT is idempotent in Postgres).

GRANT SELECT, INSERT ON public.audit_logs TO service_role;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
