-- FASE 12.1: Imposta caparra default 20% PERCENT per tutti i servizi Tonino
UPDATE public.services
   SET deposit_strategy = 'PERCENT'::public.deposit_strategy_enum,
       deposit_value    = 20.00
 WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
   AND active = TRUE;

-- Imposta default a livello di colonna
ALTER TABLE public.services ALTER COLUMN deposit_strategy SET DEFAULT 'PERCENT'::public.deposit_strategy_enum;
ALTER TABLE public.services ALTER COLUMN deposit_value SET DEFAULT 20.00;

-- READ BACK
SELECT id,
       name,
       COALESCE(price_from, price, 0) AS price,
       deposit_strategy::text,
       deposit_value,
       CASE deposit_strategy::text
         WHEN 'PERCENT' THEN ROUND(((COALESCE(price_from, price, 0) * deposit_value) / 100.0) * 100) / 100
         WHEN 'FIXED'   THEN deposit_value
         ELSE NULL
       END AS calc_deposit_amount
  FROM public.services
 WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
 ORDER BY name;
