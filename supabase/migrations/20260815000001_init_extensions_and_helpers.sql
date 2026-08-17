-- 001: Extensions + shared helpers. Idempotent & cloud-safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Make absolutely sure extensions exist and are public; if previously installed
-- under a different schema, drop + recreate pinned under public to keep SQL
-- references (`public.crypt`, `public.gen_salt`) stable.
DO $$
DECLARE
  _schema NAME;
BEGIN
  SELECT extnamespace::regnamespace::name INTO _schema
    FROM pg_extension WHERE extname = 'pgcrypto';
  IF _schema IS NOT NULL AND _schema <> 'public' THEN
    EXECUTE 'DROP EXTENSION pgcrypto';
    CREATE EXTENSION pgcrypto WITH SCHEMA public;
  END IF;

  _schema := NULL;
  SELECT extnamespace::regnamespace::name INTO _schema
    FROM pg_extension WHERE extname = 'uuid-ossp';
  IF _schema IS NOT NULL AND _schema <> 'public' THEN
    EXECUTE 'DROP EXTENSION "uuid-ossp"';
    CREATE EXTENSION "uuid-ossp" WITH SCHEMA public;
  END IF;
END $$;

-- Trigger helper: set updated_at = now()
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END; $$;

-- Trigger helper: prevent UPDATE/DELETE on audit_logs
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (no UPDATE/DELETE)';
END; $$;

-- Trigger helper: async LISTEN 'audit_notify' (placeholder)
CREATE OR REPLACE FUNCTION public.audit_notify()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE _payload TEXT;
BEGIN
  _payload := json_build_object(
     't', TG_TABLE_NAME,
     'op', TG_OP,
     'id', (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
  )::text;
  PERFORM pg_notify('audit_notify', _payload);
  RETURN NULL;
END; $$;

-- Profile trigger handler: keep public.profiles in sync with auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, auth AS $$
DECLARE
  _raw JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _dname TEXT := CASE WHEN jsonb_typeof(_raw->'display_name')='string'
                      THEN (_raw->>'display_name') ELSE NULL END;
  _aurl  TEXT := CASE WHEN jsonb_typeof(_raw->'avatar_url')='string'
                      THEN (_raw->>'avatar_url') ELSE NULL END;
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, _dname, _aurl)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;
