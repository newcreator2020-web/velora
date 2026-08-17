-- 009d: Test helper RPC: resolve user_id from email (service_role only).
CREATE OR REPLACE FUNCTION public.test_get_user_id(p_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, auth AS $$
DECLARE
  v_out UUID;
BEGIN
  SELECT id INTO v_out FROM auth.users
   WHERE lower(email::text) = lower(trim(both from p_email))
   ORDER BY created_at ASC LIMIT 1;
  RETURN v_out;
END; $$;

REVOKE ALL ON FUNCTION public.test_get_user_id(TEXT)
  FROM PUBLIC, anon, authenticated;
