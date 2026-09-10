select 'TENANTS WITH SLUGS' as q;
select tenant_id::varchar(45) as id, slug::varchar(60) slug, name::varchar(60) name
from public.tenants
where slug like 'velora-e2e%' or slug like '%mtu30v76%'
order by slug;

select 'TOTAL TENANTS' as q;
select count(*) from public.tenants;

select 'SERVICES TONINO' as q;
select
  left(service_id::text,12) as id,
  title::varchar(50) title,
  duration_minutes,
  price_cents,
  position
from public.services
where tenant_id=(select tenant_id from public.tenants where slug='slugo-mtu30v76-1fon')
order by position;
