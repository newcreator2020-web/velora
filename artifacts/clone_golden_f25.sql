SET ROLE postgres;

DO $$
DECLARE
  SA_USER_ID uuid := '9df5232e-2303-4a6f-b643-f2386ac92ec1';
  TONINO_TEMPLATE uuid := 'd5a0538e-567e-45ee-b00e-61659ed50637';
  clone_prospect_id uuid;
  clone_tenant_id uuid;
  clone_member_id uuid;
  clone_service_id uuid;
  clone_booking_id uuid;
  svc RECORD;
  slug_suffix text;
  new_slug text;
BEGIN
  slug_suffix := 'f25clone' || to_char(clock_timestamp(), 'HH24MISSMS');
  new_slug := 'parrucchiere-' || slug_suffix;

  INSERT INTO prospects (
    created_by, assigned_to, business_name, business_category,
    comune, telefono, email, sito_web, sito_quality_score,
    status, note
  ) VALUES (
    SA_USER_ID, SA_USER_ID,
    'Parrucchiere Gianni Clone F25', 'hair_salon',
    'Milano', '+393337777222', 'gianni.f25clone@velora.test',
    true, 8, 'interessato',
    'Prospect F25 Launch Gate Clone Template Tonino'
  ) RETURNING id INTO clone_prospect_id;

  INSERT INTO tenants (
    name, slug, status, published, temporary_domain,
    custom_domain, plan_id, custom_domain_status,
    custom_domain_routing_ready
  ) VALUES (
    'Parrucchiere Gianni Clone F25', new_slug, 'active',
    false, new_slug || '.velora.local', NULL, 'pro',
    'pending', false
  ) RETURNING id INTO clone_tenant_id;

  UPDATE prospects
  SET status = 'cliente', promoted_to_tenant_id = clone_tenant_id,
      updated_at = clock_timestamp()
  WHERE id = clone_prospect_id;

  INSERT INTO tenant_memberships (tenant_id, user_id, role, status)
  VALUES (clone_tenant_id, SA_USER_ID, 'owner', 'active')
  RETURNING id INTO clone_member_id;

  FOR svc IN SELECT * FROM services WHERE tenant_id = TONINO_TEMPLATE AND active = true LOOP
    INSERT INTO services (
      tenant_id, name, description, price_from, currency,
      duration_minutes, active, position, deposit_strategy,
      deposit_value, price
    ) VALUES (
      clone_tenant_id,
      svc.name,
      svc.description,
      svc.price_from,
      svc.currency,
      svc.duration_minutes,
      true,
      svc.position,
      COALESCE(svc.deposit_strategy, 'NONE'),
      COALESCE(svc.deposit_value, 0),
      svc.price
    );
  END LOOP;

  SELECT id INTO clone_service_id FROM services
  WHERE tenant_id = clone_tenant_id ORDER BY position ASC LIMIT 1;

  INSERT INTO site_publication_versions (
    tenant_id, version_number, status, snapshot,
    published_at, created_by, note
  ) VALUES (
    clone_tenant_id, 1, 'published',
    jsonb_build_object(
      'tenant_id', clone_tenant_id,
      'sections', jsonb_build_array(
        jsonb_build_object('id','hero','active',true),
        jsonb_build_object('id','services','active',true),
        jsonb_build_object('id','about','active',true),
        jsonb_build_object('id','staff','active',true),
        jsonb_build_object('id','contact','active',true)
      ),
      'sections_order', jsonb_build_array('hero','services','about','staff','contact'),
      'generated_at', to_jsonb(clock_timestamp())
    ),
    clock_timestamp(),
    SA_USER_ID,
    'v1 F25 Launch Gate automatica clone Tonino'
  );

  UPDATE tenants
  SET published = true, published_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = clone_tenant_id;

  INSERT INTO bookings (
    tenant_id, service_id, starts_at, ends_at, status,
    customer_name, customer_email, customer_phone, notes,
    revision, payment_status, deposit_amount,
    reminder_sent, deposit_payment_method,
    deposit_payment_ref, deposit_requested_at
  ) VALUES (
    clone_tenant_id,
    clone_service_id,
    (date_trunc('day', clock_timestamp()) + interval '2 day' + interval '10 hour')::timestamptz,
    (date_trunc('day', clock_timestamp()) + interval '2 day' + interval '11 hour')::timestamptz,
    'confirmed',
    'Sig. Mario Rossi (F25 Clone)',
    'rossi.f25clone@velora.test',
    '+393330001199',
    'Appuntamento prova Clone F25 Launch Gate',
    1,
    'unpaid',
    20.00,
    false,
    'bank_transfer',
    '20260911F25CLONE001',
    clock_timestamp()
  ) RETURNING id INTO clone_booking_id;

  PERFORM set_config('request.jwt.claim.sub', SA_USER_ID::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  UPDATE bookings
  SET payment_status = 'deposit_paid',
      deposit_paid_at = clock_timestamp(),
      deposit_confirmed_by = SA_USER_ID,
      deposit_payment_note = 'Confermata caparra F25 Clone backoffice manuale',
      updated_at = clock_timestamp()
  WHERE id = clone_booking_id;

  RAISE NOTICE 'CLONE F25 COMPLETATO. prospect=%, tenant=%, slug=%, booking=%', clone_prospect_id, clone_tenant_id, new_slug, clone_booking_id;
END $$;

RESET ROLE;

\echo === READ BACK F25 CLONE ===
SELECT
  t.id AS tenant_id,
  t.name,
  t.slug,
  t.status,
  t.published,
  t.plan_id,
  (SELECT count(*) FROM services s WHERE s.tenant_id=t.id AND s.active=true) AS servizi_attivi,
  (SELECT spv.version_number FROM site_publication_versions spv WHERE spv.tenant_id=t.id ORDER BY version_number DESC LIMIT 1) AS ultima_vn_pubblicata,
  (SELECT count(*) FROM site_publication_versions spv WHERE spv.tenant_id=t.id AND spv.status='published') AS pub_versions_attive,
  b.id AS booking_id,
  b.customer_name,
  b.payment_status,
  b.deposit_amount,
  b.deposit_payment_ref AS cro,
  CASE WHEN b.deposit_paid_at IS NOT NULL THEN true ELSE false END AS caparra_confermata,
  (b.deposit_confirmed_by IS NOT NULL) AS confermata_da_owner,
  p.id AS prospect_id,
  p.status AS prospect_status,
  (p.promoted_to_tenant_id IS NOT NULL) AS prospect_promosso
FROM tenants t
JOIN bookings b ON b.tenant_id = t.id
LEFT JOIN prospects p ON p.promoted_to_tenant_id = t.id
WHERE t.slug LIKE 'parrucchiere-f25clone%'
  AND b.deposit_payment_ref = '20260911F25CLONE001';
