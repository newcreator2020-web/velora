-- 010 — DROP test-only RPC helpers (production cleanup + idempotente).
--
-- Queste funzioni sono state create nelle migration 009d/009e/009f
-- ESCLUSIVAMENTE per facilitare i test di RLS durante lo sviluppo iniziale.
-- NON devono MAI sopravvivere in STAGING/PRODUCTION.
--
-- LOCAL/TEST: le stesse funzioni verranno ricreate TRANSIENTAMENTE
-- (beforeAll/afterAll) dal driver Vitest tramite connessione pg diretta,
-- e non come migration permanente.

DROP FUNCTION IF EXISTS public.test_get_user_id(TEXT);
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.test_rls(UUID, TEXT, JSONB);
