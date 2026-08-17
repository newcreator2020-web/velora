-- 009f - Test-only RLS-impersonation wrapper (service-role only).
--
-- NOTE: This is intentionally SECURITY INVOKER (not SECURITY DEFINER).
-- We rely on the CALLER being the `service_role` (or a superuser) because:
--   (a) only elevated roles are allowed to `SET LOCAL ROLE authenticated`;
--   (b) SECURITY DEFINER functions forbid SET ROLE in PG 14+.
--
-- Access is still restricted: EXECUTE privilege is REVOKEd from anon/authenticated
-- so only service_role (which is the only caller in tests) can run this.

CREATE OR REPLACE FUNCTION public.test_rls(
  p_user_id UUID,
  p_action  TEXT,
  p_args    JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB LANGUAGE plpgsql
  SET search_path = public, auth AS $$
DECLARE
  _claims JSONB;
  _tid UUID;
  _out JSONB;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'test_rls: p_user_id required'; END IF;
  _claims := jsonb_build_object(
    'sub',  p_user_id::text,
    'role', 'authenticated',
    'email', ''
  );
  PERFORM set_config('request.jwt.claims', _claims::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  CASE p_action
    WHEN 'select:tenants.by_id' THEN
      _tid := (p_args->>'tenant_id')::uuid;
      SELECT to_jsonb(t) INTO _out FROM public.tenants t WHERE t.id = _tid;
    WHEN 'select:bp.by_tenant' THEN
      _tid := (p_args->>'tenant_id')::uuid;
      SELECT jsonb_agg(jsonb_build_object('display_name',display_name,'category',category))
        INTO _out FROM public.business_profiles WHERE tenant_id = _tid;
    WHEN 'select:members.by_tenant' THEN
      _tid := (p_args->>'tenant_id')::uuid;
      SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'role',role,'status',status))
        INTO _out FROM public.tenant_memberships WHERE tenant_id = _tid;
    WHEN 'update:tenants.name' THEN
      _tid := (p_args->>'tenant_id')::uuid;
      WITH u AS (UPDATE public.tenants SET name=(p_args->>'new_name')::text WHERE id=_tid RETURNING *)
      SELECT to_jsonb(u) INTO _out FROM u;
    WHEN 'update:bp.description' THEN
      _tid := (p_args->>'tenant_id')::uuid;
      WITH u AS (UPDATE public.business_profiles SET description=(p_args->>'new_description')::text WHERE tenant_id=_tid RETURNING *)
      SELECT to_jsonb(u) INTO _out FROM u;
    WHEN 'insert:membership' THEN
      INSERT INTO public.tenant_memberships (tenant_id,user_id,role,status)
      VALUES (
        (p_args->>'tenant_id')::uuid,
        (p_args->>'user_id')::uuid,
        (p_args->>'role')::text,
        COALESCE((p_args->>'status')::text,'active')
      ) RETURNING to_jsonb(tenant_memberships.*) INTO _out;
    ELSE RAISE EXCEPTION 'test_rls: unknown action %', p_action;
  END CASE;

  RETURN _out;
END; $$;

REVOKE ALL ON FUNCTION public.test_rls(UUID,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
