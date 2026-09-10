-- F4: Aggiungi SUPER_ADMIN uid9df5232e come OWNER di Tonino, disattiva Studio Prime TEMP
-- REVERT dopo F4 completata (script in fondo)

BEGIN;

-- STEP 1: INSERT SUPER_ADMIN -> Tonino OWNER se non esiste già
INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
SELECT
  gen_random_uuid() AS id,
  'd5a0538e-567e-45ee-b00e-61659ed50637' AS tenant_id,  -- Tonino
  '9df5232e-2303-4a6f-b643-f2386ac92ec1' AS user_id,    -- SUPER_ADMIN
  'owner' AS role,
  'active' AS status,
  NOW() AS created_at,
  NOW() AS updated_at
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_memberships
  WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
    AND user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'
    AND status = 'active'
);

-- STEP 2: Backup tabella per revert (salva membership SUPER_ADMIN attive non Tonino)
CREATE TEMP TABLE f4_sa_memberships_backup AS
SELECT id, tenant_id, user_id, role, status, created_at, updated_at
FROM public.tenant_memberships
WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'
  AND status = 'active'
  AND tenant_id <> 'd5a0538e-567e-45ee-b00e-61659ed50637';

-- STEP 3: Disattiva TUTTE le membership SUPER_ADMIN ATTIVE tranne Tonino
UPDATE public.tenant_memberships
SET status = 'suspended', updated_at = NOW()
WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'
  AND status = 'active'
  AND tenant_id <> 'd5a0538e-567e-45ee-b00e-61659ed50637';

-- VERIFICA: membership SUPER_ADMIN attive = [Tonino]
SELECT tenant_id, role, status, created_at
FROM public.tenant_memberships
WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'
ORDER BY status, created_at DESC;

COMMIT;

-- ========================================================
-- REVERT DA ESEGUIRE DOPO FASE 4 COMPLETATA (F4.6):
-- ========================================================
-- BEGIN;
--   -- 1. Elimina membership SUPER_ADMIN Tonino aggiunta
--   DELETE FROM public.tenant_memberships
--   WHERE user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1'
--     AND tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
--     AND role = 'owner';
--
--   -- 2. Riattiva membership backup (Studio Prime)
--   UPDATE public.tenant_memberships tm
--   SET status = 'active', updated_at = NOW()
--   FROM f4_sa_memberships_backup bk
--   WHERE tm.id = bk.id;
--
--   DROP TABLE IF EXISTS f4_sa_memberships_backup;
-- COMMIT;
