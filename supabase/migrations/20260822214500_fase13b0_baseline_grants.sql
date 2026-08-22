-- ============================================================================
-- FASE 13B0 — Baseline privilege grants fix for staff_resources + SRS tables.
--
-- ROOT CAUSE FASE12:
--   FASE12 creava staff_resources (12A) e staff_resource_services (12C)
--   con ENABLE + FORCE RLS e definiva policies per authenticated ma NON
--   rilasciava GRANT SELECT/INSERT/UPDATE/DELETE TABLE-level a authenticated.
--   Le policies con TO authenticated non hanno effetto se manca il GRANT.
--   Con FORCE RLS e GRANT service_role SOLO, i test che usano client
--   autenticato ricevono 42501 insufficient_privilege.
--
-- CORREZIONE (append-only, non modifica migration FASE1-12):
--   Grants minimi, espliciti, in linea con tutte le altre tabelle applicative.
--   Anon: nessun direct access (le public RPC sono SECURITY DEFINER e gestite).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_resource_services TO authenticated;
