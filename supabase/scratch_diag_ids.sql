\pset format aligned
\pset border 2

select 'SLUGS LIST (first 25 by created desc)' as q;
select
  row_number() over () as n,
  left(tenant_id::text, 12) as id_prefix,
  slug::varchar(70)
from public.tenants
order by created_at desc
limit 25;

select 'USERS E2E (email contains velora.test)' as q;
select
  left(id::text, 12) as user_id12,
  email::varchar(70) email,
  created_at::timestamp(0)
from auth.users
where email like '%velora.test%'
order by created_at desc
limit 12;

select 'MEMBERSHIPS for tonino-like users' as q;
select
  left(tm.user_id::text, 12) uid,
  left(tm.tenant_id::text, 12) tid,
  tm.role,
  (select slug from public.tenants t where t.tenant_id=tm.tenant_id)::varchar(60) tenant_slug
from public.tenant_memberships tm
where tm.role in ('owner','super_admin')
order by tm.created_at desc
limit 10;
