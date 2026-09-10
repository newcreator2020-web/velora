\pset tuples_only on

select '--- TONINO OWNER membership (REAL tenant_id) ---' as note;
select tenant_id::text as real_tonino_tenant_id, role
from public.tenant_memberships
where user_id = 'a8398d34-c1dd-4e44-800c-1439a4aac20b';

select '--- SUPER_ADMIN membership (tenant Pipeline) ---' as note;
select tenant_id::text as superadmin_tenant_id, role
from public.tenant_memberships
where user_id = '9df5232e-2303-4a6f-b643-f2386ac92ec1';

select '--- TONINO slug e nome dal reale tenant_id ---' as note;
select slug, name::varchar(80) business_name
from public.tenants
where tenant_id = (
  select tenant_id from public.tenant_memberships
  where user_id = 'a8398d34-c1dd-4e44-800c-1439a4aac20b'
  and role='owner'
  limit 1
);

select '--- TONINO REAL services (9 booking services) ---' as note;
select
  position,
  left(service_id::text,14) as id,
  title::varchar(55),
  duration_minutes,
  price_cents
from public.services
where tenant_id = (
  select tenant_id from public.tenant_memberships
  where user_id = 'a8398d34-c1dd-4e44-800c-1439a4aac20b'
  and role='owner'
  limit 1
)
order by position;
