-- =====================================================================
-- FASE14B — Migrazione #72: helper function public.member_role_for_tenant
--
-- Prodotto bug FASE13D/13E: la funzione veniva usata in 3 RPC (dashboard_booking_reschedule
-- e analoghi) ma non era mai stata CREATE in una migration di prodotto.
-- Questa migration è append-only e non tocca le migrazioni 1..71.
-- =====================================================================

BEGIN;

-- 1. Idempotenza: elimina eventuale versione precedente con stessa firma
DROP FUNCTION IF EXISTS public.member_role_for_tenant(UUID, UUID) CASCADE;

-- 2. Creazione helper hardened
CREATE OR REPLACE FUNCTION public.member_role_for_tenant(
  p_tid UUID,
  p_uid UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT tm.role::TEXT
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = p_tid
    AND tm.user_id   = p_uid
    AND tm.status    = 'active'
  LIMIT 1;
$$;

-- 3. Proprietà
ALTER FUNCTION public.member_role_for_tenant(UUID, UUID) OWNER TO postgres;

-- 4. Permessi: esecuzione solo a ruoli attesi
REVOKE ALL ON FUNCTION public.member_role_for_tenant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_role_for_tenant(UUID, UUID)
  TO postgres, anon, authenticated, service_role;

COMMIT;
