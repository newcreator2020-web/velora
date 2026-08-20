-- FASE 8C: SECURITY FIX protect_tenant_plan_id trigger.
-- BUG PRECEDENTE (GUC, session_user, current_user):
--   1) GUC custom 'app.billing_trusted' era user-settable da authenticated (non safe).
--   2) session_user = 'authenticator' in PostgREST (pool connection, immutable for user JWT) → check fallace.
--   3) current_user = 'postgres' perche' function e' SECURITY DEFINER (owner function) → sempre trusted erroneamente.
-- SOLUZIONE CORRETTA E PROOF:
--   Un utente end-user ha SEMPRE auth.uid() valorizzato (JWT claim sub).
--   Un trusted service-role / superuser / backend path ha SEMPRE auth.uid() = NULL.
--   Dunque: se auth.uid() IS NOT NULL → end user → blocca (tranne platform admin FASE7).
--           se auth.uid() IS NULL     → trusted backend  → consenti.
-- Questa regola e' immune a: SET ROLE / SECURITY DEFINER / session_user.

CREATE OR REPLACE FUNCTION public.protect_tenant_plan_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_uid UUID;
  v_platform_admin UUID;
BEGIN
  -- (A) same plan -> noop
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  -- Recupera auth.uid() affidabile (da JWT PostgREST).
  BEGIN
    v_auth_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_auth_uid := NULL;
  END;

  -- (B) TRUSTED path: backend/service_role/superuser → auth.uid() = NULL.
  IF v_auth_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- (C) Platform admin logged-in user bypass (FASE7 existing).
  BEGIN
    SELECT id INTO v_platform_admin
      FROM public.platform_admins
      WHERE active = TRUE AND user_id = v_auth_uid
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_platform_admin := NULL; END;
  IF v_platform_admin IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- (D) Altrimenti: end-user NON trusted. DENY.
  RAISE EXCEPTION 'direct plan_id update not allowed for end-users'
    USING ERRCODE='insufficient_privilege';
END;
$$;

GRANT EXECUTE ON FUNCTION public.protect_tenant_plan_id() TO authenticated, service_role;
