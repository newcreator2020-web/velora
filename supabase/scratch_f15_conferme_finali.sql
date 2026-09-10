select 'FINAL VERSIONS TONINO' as info;
select version_number, status, left(note::text,75) note_descrizione, left(actor_id::text,11) actor_prefix
from public.site_publication_versions
where tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637'
order by version_number desc;

select 'COUNT VERSIONS TONINO' as info;
select count(*) total_versioni from public.site_publication_versions
where tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';

select 'EDITORIAL STATE DOPO ROLLBACK (hero title confirm):' as info;
select (sections->1->'props'->>'title')::varchar(80) hero_title,
       jsonb_array_length(services) quanti_servizi,
       (theme->'colors'->>'primary')::varchar(15) colore_primary
from public.site_editorial_state
where tenant_id='d5a0538e-567e-45ee-b00e-61659ed50637';
