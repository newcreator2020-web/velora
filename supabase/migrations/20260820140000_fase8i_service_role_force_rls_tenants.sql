-- FASE 8I: Service role RLS policy for tenants FORCE ROW LEVEL SECURITY.
-- tenants ha FORCE RLS abilitato (enforced anche per table owner / superusers
-- che non posseggono BYPASSRLS). Senza una policy esplicita per il ruolo
-- service_role il trusted server boundary (RPC, provisioning) non puo'
-- inserire/aggiornare tenants nonostante la JWT service_role, perche'
-- FORCE RLS vince anche su superuser.
-- Append-only, idempotente, security-preserving.

SET search_path TO public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tenants'
       AND policyname = 'tenants_service_role_all'
  ) THEN
    CREATE POLICY tenants_service_role_all
      ON public.tenants
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
