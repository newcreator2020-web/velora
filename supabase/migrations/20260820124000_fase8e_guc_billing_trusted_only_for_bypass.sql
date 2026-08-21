-- FASE 8E: Billing trust boundary hardening.
-- Rimuove fiducia in app.billing_trusted custom GUC al di fuori
-- del contesto service/pg bypass (auth.uid() IS NULL).
-- Un utente end-user authenticated che cerca di forgiare SET LOCAL app.billing_trusted
-- non puo piu bypassare protect_tenant_plan_id.
-- Idempotente e preservazione di security, applica piu' volte.

SET search_path TO public;

CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_new_plan TEXT;
  v_old_plan TEXT;
  v_trusted BOOL;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  v_new_plan := NEW.plan_id;
  v_old_plan := OLD.plan_id;

  IF v_new_plan IS NOT DISTINCT FROM v_old_plan THEN
    RETURN NEW;
  END IF;

  -- 1) Trust bypass: nessun JWT claim sub valorizzato
  --    → esecuzione da service_role, pg raw bypass via service_role.
  --    In questo contesto GUC app.billing_trusted puo abilitare le RPC trusted.
  IF auth.uid() IS NULL THEN
    v_trusted := COALESCE(current_setting('app.billing_trusted', true)::bool, false);
    IF v_trusted THEN RETURN NEW; END IF;
    -- Caso legacy: service_role che imposta direttamente UPDATE senza GUC
    -- consapevole: permettiamo comunque per back-compat con amministratore.
    RETURN NEW;
  END IF;

  -- 2) Platform admin esplicitamente autorizzato (end-user)
  IF EXISTS (
    SELECT 1
      FROM public.platform_admins pa
     WHERE pa.status = 'active'
       AND pa.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'tenant.plan_id mutation denied: insufficient privileges; contact platform_admins.status=active or trusted billing path required'
    USING ERRCODE='insufficient_privilege';
END;
$$;

GRANT EXECUTE ON FUNCTION public.protect_tenant_plan_id() TO authenticated, service_role;
