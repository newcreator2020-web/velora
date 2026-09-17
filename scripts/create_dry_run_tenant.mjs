/* eslint-disable */
import pg from "pg";
import crypto from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ARTIFACTS = resolve(ROOT, "artifacts");
if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const CFG = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: process.env.SUPABASE_LOCAL_PG_PASS ?? "postgres",
  database: "postgres",
  ssl: false,
};

const SA_USER_ID = "9df5232e-2303-4a6f-b643-f2386ac92ec1";

function uid() {
  return crypto.randomUUID();
}
function slugSuf() {
  return Math.random().toString(36).slice(2, 8);
}

const DRY_TENANT_ID = uid();
const DRY_SLUG = `dry-run-studio-${slugSuf()}`;
const DRY_STAFF_ID = uid();
const DRY_BANK_ID = uid();
const DRY_PUB_ID = uid();
const SVC_TAGLIO_ID = uid();
const SVC_PIEGA_ID = uid();
const RSC_AV_IDS = [uid(), uid(), uid(), uid(), uid(), uid(), uid()];

const THEME_PRIMARY = "#0f172a"; // Navy
const THEME_BG = "#ffffff";
const THEME_FG = "#0f172a";
const THEME_MUTED = "#64748b";
const THEME_RADIUS = "lg";
const THEME_HEADING_FONT = "sans";
const THEME_BODY_FONT = "sans";

const client = new pg.Client(CFG);
await client.connect();
console.log("✓ Connected to local supabase-db");
console.log("DRY_TENANT_ID =", DRY_TENANT_ID);
console.log("DRY_SLUG =", DRY_SLUG);

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = replica");

  // === (1) DELETE safety vecchio dry run ===
  const oldTenant = await client.query(
    "SELECT id, slug FROM tenants WHERE slug ILIKE $1 OR name ILIKE $2 LIMIT 1",
    ["%dry-run-studio%", "%DRY RUN STUDIO%"],
  );
  if (oldTenant.rows.length > 0) {
    console.log("→ Rimuovo vecchio dry run tenant:", oldTenant.rows[0].slug);
    const old = oldTenant.rows[0].id;
    const delTabs = [
      "staff_resource_services",
      "resource_availability",
      "resource_time_off",
      "site_sections",
      "site_publication_versions",
      "staff_resources",
      "business_availability",
      "services",
      "tenant_bank_accounts",
      "business_profiles",
      "tenant_memberships",
    ];
    for (const t of delTabs) await client.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [old]);
    await client.query("DELETE FROM tenants WHERE id = $1", [old]);
  }

  // === (2) INSERT tenants ===
  await client.query(
    `INSERT INTO tenants (
      id, name, slug, status, published, temporary_domain,
      custom_domain, plan_id, custom_domain_status,
      custom_domain_routing_ready, design_preset_id,
      created_at, updated_at, published_at
    ) VALUES ($1, $2, $3, 'active', true, $4,
      NULL, 'pro', 'pending', false, 'minimal',
      now(), now(), now())`,
    [DRY_TENANT_ID, "DRY RUN STUDIO - NON UN CLIENTE VERO", DRY_SLUG, `${DRY_SLUG}.velora.local`],
  );
  console.log("✓ INSERT tenants ok");

  // === (3) membership SA owner ===
  await client.query(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, 'owner', 'active', now(), now()) ON CONFLICT DO NOTHING`,
    [DRY_TENANT_ID, SA_USER_ID],
  );
  console.log("✓ INSERT tenant_memberships ok");

  // === (4) INSERT business_profiles (con tema embed + address DRY) ===
  await client.query(
    `INSERT INTO business_profiles (
      tenant_id, display_name, legal_name, category, description,
      phone, whatsapp, email, website_url,
      address_line1, address_line2, city, province, postal_code, country_code,
      latitude, longitude, timezone, locale,
      theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
      theme_heading_font_preset, theme_body_font_preset,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5,
      $6, NULL, $7, NULL,
      $8, NULL, 'Roma', 'RM', '00100', 'IT',
      41.9028, 12.4964, 'Europe/Rome', 'it-IT',
      $9, $10, $11, $12, $13,
      $14, $15,
      now(), now())`,
    [
      DRY_TENANT_ID,
      "DRY RUN STUDIO - NON UN CLIENTE VERO",
      "DRY RUN STUDIO SRLS (DEMO FICTITIOUS)",
      "Parrucchiere / Hair Stylist (DEMO)",
      "⚠️ SITO DEMO DRY RUN — NON UN CLIENTE REALE. DRY RUN STUDIO è il finto luogo usato da Velora per collaudare l'intero flusso: creazione tenant, servizi, orari, booking UI Playwright, backoffice toggle pagato, deploy provvisorio e report consegna. Nessun servizio viene realmente venduto. Tutti i dati presenti sono placeholder etichettati.",
      "+39 000 000 0000",
      "dry-run@example.test",
      "Via Dry Run, 1",
      THEME_PRIMARY,
      THEME_BG,
      THEME_FG,
      THEME_MUTED,
      THEME_RADIUS,
      THEME_HEADING_FONT,
      THEME_BODY_FONT,
    ],
  );
  console.log("✓ INSERT business_profiles ok (tema embed Navy/Sand)");

  // === (5) INSERT tenant_bank_accounts bonifico demo ===
  await client.query(
    `INSERT INTO tenant_bank_accounts (
      id, tenant_id, is_primary, display_name, account_holder,
      iban, bic_swift, bank_name, payment_note_template,
      country, active, created_at, updated_at
    ) VALUES ($1, $2, true, $3, $4,
      $5, $6, $7, $8,
      'IT', true, now(), now())`,
    [
      DRY_BANK_ID,
      DRY_TENANT_ID,
      "Conto Bonifici Demo Dry Run",
      "DRY RUN STUDIO SRLS (DEMO)",
      "IT00 0000 0000 0000 0000 000",
      "DRYOITMM",
      "Banca Dry Run S.p.A. (DEMO)",
      "Causale: COGNOME NOME DATA APPUNTAMENTO. L'appuntamento è confermato ma l'importo resta da saldare tramite bonifico o direttamente in sede.",
    ],
  );
  console.log("✓ INSERT tenant_bank_accounts ok");

  // === (6) INSERT 2 services (price + price_from uguali: 25€ e 35€ NON in centesimi) ===
  const SVCS = [
    {
      id: SVC_TAGLIO_ID,
      name: "Taglio base",
      duration: 30,
      price: 25,
      pos: 1,
      desc: "Lavaggio, taglio personalizzato e piega blow-dry. Adatto a tutti i tipi di capello.",
    },
    {
      id: SVC_PIEGA_ID,
      name: "Piega",
      duration: 45,
      price: 35,
      pos: 2,
      desc: "Lavaggio e piega con styling termo-protetto. Durata ~45 minuti.",
    },
  ];
  for (const s of SVCS) {
    await client.query(
      `INSERT INTO services (
        id, tenant_id, name, description,
        duration_minutes, price, price_from, currency,
        deposit_strategy, deposit_value, active, position,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4,
        $5, $6, $6, 'EUR',
        'NONE', 0, true, $7,
        now(), now())`,
      [s.id, DRY_TENANT_ID, s.name, s.desc, s.duration, s.price, s.pos],
    );
  }
  console.log("✓ INSERT 2 services ok (price EUR 25/35 non centesimi)");

  // === (7) INSERT staff_resources 1 + availability_version=1 + bookable=true ===
  await client.query(
    `INSERT INTO staff_resources (
      id, tenant_id, display_name, slug, active, bookable, sort_order,
      color_hex, linked_membership_id, availability_version,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, true, true, 1,
      '#0f172a', NULL, 1,
      now(), now())`,
    [DRY_STAFF_ID, DRY_TENANT_ID, "Operatore Dry", "operatore-dry-" + slugSuf()],
  );
  console.log("✓ INSERT staff_resources 1 ok");

  // === (8) staff_resource_services: collega staff a 2 servizi ===
  for (const sid of [SVC_TAGLIO_ID, SVC_PIEGA_ID]) {
    await client.query(
      `INSERT INTO staff_resource_services (
        tenant_id, resource_id, service_id, active, duration_override_minutes,
        created_at, updated_at
      ) VALUES ($1, $2, $3, true, NULL, now(), now())
       ON CONFLICT (tenant_id, resource_id, service_id) DO NOTHING`,
      [DRY_TENANT_ID, DRY_STAFF_ID, sid],
    );
  }
  console.log("✓ INSERT staff_resource_services 2 ok");

  // === (9) business_availability 7 rows (weekday 0=Dom..6=Sab; Dom=closed; Sab=09-13) ===
  // Spec: Lun-Ven 09-18, Sab 09-13, Dom CHIUSO
  const BIZ_HRS = [
    { wd: 0, en: false, st: "00:01", et: "23:59" }, // Dom (enabled=false per chiusura)
    { wd: 1, en: true, st: "09:00", et: "18:00" }, // Lun
    { wd: 2, en: true, st: "09:00", et: "18:00" }, // Mar
    { wd: 3, en: true, st: "09:00", et: "18:00" }, // Mer
    { wd: 4, en: true, st: "09:00", et: "18:00" }, // Gio
    { wd: 5, en: true, st: "09:00", et: "18:00" }, // Ven
    { wd: 6, en: true, st: "09:00", et: "13:00" }, // Sab
  ];
  for (const h of BIZ_HRS) {
    await client.query(
      `INSERT INTO business_availability (
        tenant_id, weekday, enabled, start_time, end_time,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4::time, $5::time, now(), now())`,
      [DRY_TENANT_ID, h.wd, h.en, h.st, h.et],
    );
  }
  console.log("✓ INSERT business_availability 7 rows ok (Dom chiuso via enabled=false)");

  // NOTA: resource_availability omesso (opzionale): Tonino/Giulia/Luca non ne hanno;
  // il booking engine ricade su business_availability generico. Evitiamo dipendenze inutili.
  // (10 rimosso)

  // === (11) INSERT site_sections 8: navbar, hero, about, services, hours, booking_widget, contact, footer ===
  // Nota: columns id, tenant_id, section_type, position, enabled, variant, settings (section_key NON esiste)
  const SECTIONS = [
    {
      type: "navbar",
      pos: 0,
      variant: "minimal",
      settings: {
        showLogo: true,
        showBookingButton: true,
        showPhone: true,
        ctaLabel: "Prenota",
        brandName: "DRY RUN STUDIO",
        badge: { label: "⚠️ SITO DEMO DRY RUN", tone: "amber" },
        links: [
          { label: "Servizi", href: "#services" },
          { label: "Orari", href: "#hours" },
          { label: "Contatti", href: "#contact" },
        ],
      },
    },
    {
      type: "hero",
      pos: 1,
      variant: "fullscreen",
      settings: {
        eyebrow: "⚠️ DEMO NON COMMERCIALE",
        headlineOverride: "DRY RUN STUDIO",
        subheadline:
          "Taglio · Piega · Trattamenti — Solo a scopo dimostrativo Velora Platform. Nessun servizio reale.",
        ctaLabel: "Prenota ora",
        ctaTarget: `/s/${DRY_SLUG}/booking`,
        ctaSecondaryLabel: "Scopri i servizi",
        ctaSecondaryTarget: "#services",
        visualStrategy: "gradient",
        gradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)",
        badge: { label: "⚠️ SITO DEMO DRY RUN · NON UN CLIENTE VERO", tone: "amber" },
      },
    },
    {
      type: "about",
      pos: 2,
      variant: "split",
      settings: {
        eyebrow: "Chi siamo (DEMO)",
        title: "Uno spazio di test per Velora Platform",
        body: "DRY RUN STUDIO è il finto luogo usato da Velora per collaudare l'intero ciclo: creazione tenant, servizi, orari, booking UI Playwright, backoffice toggle pagato, deploy provvisorio e report consegna. Nessun servizio viene realmente venduto. Tutti i dati presenti sono placeholder etichettati.",
        highlights: [
          "Ambiente di test DRY RUN",
          "Isolamento cross-tenant garantito",
          "Flusso completo Velora dimostrabile",
          "Zero foto / zero recensioni fake",
        ],
      },
    },
    {
      type: "services",
      pos: 3,
      variant: "cards",
      settings: {
        eyebrow: "Menu servizi",
        title: "Trattamenti disponibili (DEMO)",
        subtitle: "Lista minimi per i test DRY RUN: due servizi base.",
      },
    },
    {
      type: "hours",
      pos: 4,
      variant: "default",
      settings: {
        eyebrow: "Orari",
        title: "Quando ci trovi",
        subtitle: "Lunedì-Venerdì 09:00-18:00 · Sabato 09:00-13:00 · Domenica chiuso",
        weekdays: "Lun-Ven 09:00-18:00",
        sat: "Sabato 09:00-13:00",
        sun: "Domenica chiuso",
      },
    },
    {
      type: "booking_widget",
      pos: 5,
      variant: "default",
      settings: {
        eyebrow: "Prenota online",
        title: "Prenota il tuo prossimo appuntamento",
        subtitle:
          "Flusso completo verificato con Playwright: servizio, data, slot, form cliente, conferma READ BACK DB.",
      },
    },
    {
      type: "contact",
      pos: 6,
      variant: "default",
      settings: {
        eyebrow: "Contatti",
        title: "Vieni a trovarci (DEMO)",
        subtitle:
          "I dati di contatto sono fittizi. Non chiamare o scrivere a questi recapiti: non esistono.",
        phone: "+39 000 000 0000",
        email: "dry-run@example.test",
        city: "Roma",
        address: "Via Dry Run, 1 · 00100 Roma",
        gmaps_url: "https://maps.google.com",
      },
    },
    {
      type: "footer",
      pos: 99,
      variant: "default",
      settings: {
        tagline: "DRY RUN STUDIO · DEMO Velora Platform — Nessun cliente reale",
        badges: [
          { label: "⚠️ SITO DEMO · DRY RUN", tone: "amber" },
          { label: "NON UN CLIENTE VERO", tone: "neutral" },
        ],
        copyright: `© ${new Date().getFullYear()} DRY RUN STUDIO — Demo Velora Platform. Tutti i dati sono fittizi.`,
      },
    },
  ];

  const ts = new Date();
  for (const s of SECTIONS) {
    await client.query(
      `INSERT INTO site_sections (
        id, tenant_id, section_type, position, enabled, variant, settings,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, true, $5, $6::jsonb, $7, $7)`,
      [uid(), DRY_TENANT_ID, s.type, s.pos, s.variant, JSON.stringify(s.settings), ts],
    );
  }
  console.log(`✓ INSERT site_sections ${SECTIONS.length} rows ok`);

  // === (12) site_publication_versions v1 published ===
  await client.query(
    `INSERT INTO site_publication_versions (
      id, tenant_id, version_number, status, snapshot, hash_sha256,
      published_at, created_by, note, design_preset_id,
      created_at, updated_at
    ) VALUES ($1, $2, 1, 'published', $3::jsonb, $4,
      now(), $5::uuid, $6, 'minimal',
      now(), now())`,
    [
      DRY_PUB_ID,
      DRY_TENANT_ID,
      JSON.stringify({
        isDryRun: true,
        sections: SECTIONS.length,
        services: SVCS.length,
        staff: 1,
        publishedAt: new Date().toISOString(),
      }),
      "dryrun_" + slugSuf() + "_sha256_placeholder",
      SA_USER_ID,
      "DRY RUN publication v1 — creazione automatica script create_dry_run_tenant.mjs. NON rappresenta pubblicazione di un cliente reale.",
    ],
  );
  console.log("✓ INSERT site_publication_versions v1 published ok");

  await client.query("COMMIT");
  console.log("✓ Transaction COMMIT");

  // === READ BACK VERIFICHE ===
  console.log("\n============ READ BACK TENANT DRY RUN ============");
  const t = await client.query(
    "SELECT id,name,slug,status,published,design_preset_id,temporary_domain FROM tenants WHERE id=$1",
    [DRY_TENANT_ID],
  );
  console.log("tenant_row=", JSON.stringify(t.rows[0], null, 2));

  const svc = await client.query(
    "SELECT count(*) c, array_agg(name ORDER BY position) n FROM services WHERE tenant_id=$1 AND active=true",
    [DRY_TENANT_ID],
  );
  console.log("services count=", svc.rows[0].c, "names=", JSON.stringify(svc.rows[0].n));
  const pric = await client.query(
    "SELECT name, duration_minutes d, price p, price_from pf FROM services WHERE tenant_id=$1 ORDER BY position",
    [DRY_TENANT_ID],
  );
  console.log("services rows=", JSON.stringify(pric.rows, null, 2));

  const stf = await client.query(
    "SELECT count(*) c, array_agg(display_name) n FROM staff_resources WHERE tenant_id=$1 AND active=true AND bookable=true",
    [DRY_TENANT_ID],
  );
  console.log("staff count=", stf.rows[0].c, "names=", JSON.stringify(stf.rows[0].n));

  const hrs = await client.query(
    "SELECT weekday wd, enabled en, start_time st, end_time et FROM business_availability WHERE tenant_id=$1 ORDER BY weekday",
    [DRY_TENANT_ID],
  );
  console.log("business_availability count=", hrs.rows.length, JSON.stringify(hrs.rows));
  const dom = hrs.rows.find((r) => r.wd === 0);
  console.log(
    "Domenica closed? enabled=",
    dom?.en,
    "== false →",
    dom?.en === false ? "OK ✅" : "ERR ❌",
  );

  const bp = await client.query(
    "SELECT display_name dn, category, city, theme_primary c1, theme_radius r FROM business_profiles WHERE tenant_id=$1",
    [DRY_TENANT_ID],
  );
  console.log("bp display=", JSON.stringify(bp.rows[0] ?? null));

  const se = await client.query(
    "SELECT count(*) c FROM site_sections WHERE tenant_id=$1 AND enabled=true",
    [DRY_TENANT_ID],
  );
  console.log("site_sections count=", se.rows[0].c, "(atteso 8)");

  const pub = await client.query(
    "SELECT version_number v, status s FROM site_publication_versions WHERE tenant_id=$1",
    [DRY_TENANT_ID],
  );
  console.log("publication v1 status=", pub.rows[0]?.s, "(atteso 'published')");

  const bank = await client.query(
    "SELECT iban FROM tenant_bank_accounts WHERE tenant_id=$1 AND is_primary=true",
    [DRY_TENANT_ID],
  );
  console.log(
    "bank iban starts IT00?",
    bank.rows[0]?.iban?.startsWith("IT00") ? "OK ✅" : "ERR ❌",
  );

  const mb = await client.query(
    "SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [DRY_TENANT_ID, SA_USER_ID],
  );
  console.log("owner SA role:", mb.rows[0]?.role, "(atteso 'owner')");

  // === Cross-tenant check: Tonino/Luca/Giulia invariati (count services non = 2 dei dry) ===
  const preInv = await client.query(
    `SELECT t.slug, COUNT(s.id) svc_n FROM tenants t
     LEFT JOIN services s ON s.tenant_id=t.id AND s.active=true
     WHERE t.slug IN ('slugo-mtu30v76-1fon','barbieri-luca','giulia-hair')
     GROUP BY t.slug ORDER BY t.slug`,
  );
  console.log("\nCross-tenant invariance (3 golden services count attesi 9/8/10):");
  preInv.rows.forEach((r) => console.log("  ", r.slug, "svc=", r.svc_n));

  console.log("\n============ HTTP URLs DRY RUN ============");
  const home = `http://localhost:3000/s/${DRY_SLUG}`;
  const booking = `http://localhost:3000/s/${DRY_SLUG}/booking`;
  console.log("HOME   =", home);
  console.log("BOOKING=", booking);
} catch (e) {
  console.error("❌ ROLLBACK:", e);
  try {
    await client.query("ROLLBACK");
  } catch {}
  process.exit(1);
} finally {
  try {
    await client.query("RESET session_replication_role");
  } catch {}
  await client.end();
}

// === Write env files downstream ===
const OUT = `DRY_TENANT_ID=${DRY_TENANT_ID}
DRY_SLUG=${DRY_SLUG}
DRY_HOME=http://localhost:3000/s/${DRY_SLUG}
DRY_BOOKING=http://localhost:3000/s/${DRY_SLUG}/booking
DRY_STAFF_ID=${DRY_STAFF_ID}
DRY_SVC_TAGLIO_ID=${SVC_TAGLIO_ID}
DRY_SVC_PIEGA_ID=${SVC_PIEGA_ID}
`;
writeFileSync(resolve(ARTIFACTS, ".dry-run-env.sh"), OUT);
writeFileSync(
  resolve(ARTIFACTS, ".dry-run-env.json"),
  JSON.stringify(
    {
      DRY_TENANT_ID,
      DRY_SLUG,
      DRY_STAFF_ID,
      DRY_SVC_TAGLIO_ID: SVC_TAGLIO_ID,
      DRY_SVC_PIEGA_ID: SVC_PIEGA_ID,
      DRY_HOME: `http://localhost:3000/s/${DRY_SLUG}`,
      DRY_BOOKING: `http://localhost:3000/s/${DRY_SLUG}/booking`,
    },
    null,
    2,
  ),
);
console.log("\n✓ Saved env file: ./artifacts/.dry-run-env.sh");
console.log("✓ Saved env file: ./artifacts/.dry-run-env.json");
