SELECT t.id as tenant_id, t.name, t.slug, bp.tenant_id as bp_exists, bp.display_name, bp.description, bp.theme_primary
FROM tenants t
LEFT JOIN business_profiles bp ON bp.tenant_id = t.id
WHERE t.id = 'd5a0538e-567e-45ee-b00e-61659ed50637';
