/* eslint-disable no-console */
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CFG = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: process.env.SUPABASE_LOCAL_PG_PASS ?? "postgres",
  database: "postgres",
  ssl: false,
};

const SA_USER_ID = "9df5232e-2303-4a6f-b643-f2386ac92ec1";
const TONINO_UUID = "d5a0538e-567e-45ee-b00e-61659ed50637";

const client = new pg.Client(CFG);
await client.connect();
console.log("✓ Connected to local supabase-db");

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = replica");

  // ---------------------------------------------------------------
  // 1. Ensure TONINO tenant exists (elegant preset)
  // ---------------------------------------------------------------
  const findTon = await client.query(
    "SELECT id::text, slug, name FROM tenants WHERE id = $1::uuid OR slug = $2 LIMIT 1",
    [TONINO_UUID, "slugo-mtu30v76-1fon"],
  );
  if (!findTon.rows.length) {
    console.log("→ Tonino NON esistente: INSERT new");
    await client.query(
      `INSERT INTO tenants (
        id, name, slug, status, published, temporary_domain,
        custom_domain, plan_id, custom_domain_status,
        custom_domain_routing_ready, design_preset_id,
        created_at, updated_at, published_at
      ) VALUES (
        $1::uuid, $2, $3, 'active', true, 'slugo-mtu30v76-1fon.velora.local',
        NULL, 'pro', 'pending', false, 'elegant',
        now(), now(), now()
      )`,
      [TONINO_UUID, "Estetista da Tonino", "slugo-mtu30v76-1fon"],
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'owner', 'active', now(), now())
       ON CONFLICT DO NOTHING`,
      [TONINO_UUID, SA_USER_ID],
    );
  } else {
    console.log("→ Tonino già presente:", findTon.rows[0].slug);
  }

  // ---------------------------------------------------------------
  // 2. TONINO: ensure business_profile slug + display
  // ---------------------------------------------------------------
  const getBp = await client.query(
    "SELECT 1 FROM business_profiles WHERE tenant_id = $1::uuid LIMIT 1",
    [TONINO_UUID],
  );
  if (!getBp.rows.length) {
    await client.query(
      `INSERT INTO business_profiles (tenant_id, display_name, category, city, address_line1, phone, email, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, now(), now())`,
      [
        TONINO_UUID,
        "Estetista da Tonino",
        "Centro estetico",
        "Crotone",
        "Via Roma, 12",
        "+39 0962 123456",
        "info@estetistadonino.it",
      ],
    );
  }

  // ---------------------------------------------------------------
  // 3. TONINO: CLEANUP existing services + site_sections
  // ---------------------------------------------------------------
  await client.query("DELETE FROM services WHERE tenant_id = $1::uuid", [TONINO_UUID]);
  await client.query("DELETE FROM site_sections WHERE tenant_id = $1::uuid", [TONINO_UUID]);

  // ---------------------------------------------------------------
  // 4. TONINO: 9 services (EUR)
  // ---------------------------------------------------------------
  const TONINO_SERVICES = [
    ["Pulizia viso profonda", 35, 45],
    ["Trattamento anti-età viso", 65, 60],
    ["Massaggio corpo rilassante 60min", 50, 60],
    ["Manicure tradizionale", 25, 30],
    ["Pedicure estetico", 30, 40],
    ["Depilazione ceretta gambe complete", 40, 45],
    ["Sopracciglia + laminazione", 28, 30],
    ["Crio lipolisi zona addome", 90, 60],
    ["Pacchetto Sposa (viso+corpo+mani)", 180, 150],
  ];
  const ts = new Date();
  for (let i = 0; i < TONINO_SERVICES.length; i++) {
    const [n, pr, dur] = TONINO_SERVICES[i];
    await client.query(
      `INSERT INTO services (
        tenant_id, name, description, price, currency,
        duration_minutes, active, position,
        deposit_strategy, deposit_value, created_at, updated_at, price_from
      ) VALUES ($1::uuid, $2, $3, $4, 'EUR', $5, true, $6, 'NONE', 0, $7, $7, $4)`,
      [TONINO_UUID, n, "Trattamento eseguito da personale qualificato.", pr, dur, i + 1, ts],
    );
  }
  console.log("→ Tonino services INSERTED:", TONINO_SERVICES.length);

  // ---------------------------------------------------------------
  // 5. TONINO: site_sections variants premium
  // ---------------------------------------------------------------
  const TONINO_SECTIONS = [
    [
      "navbar",
      0,
      "default",
      { showLogo: true, showBookingButton: true, showPhone: true, ctaLabel: "Prenota" },
    ],
    [
      "hero",
      1,
      "fullscreen",
      {
        headlineOverride: "Centro Estetico Premium dal 1998",
        subheadline:
          "Trattamenti viso corpo e bellezza a 360° nel cuore di Crotone. Personale qualificato, prodotti professionali, risultati veri.",
        eyebrow: "Estetista da Tonino · Dal 1998",
        ctaLabel: "Prenota trattamento",
        ctaTarget: "/s/slugo-mtu30v76-1fon/booking",
      },
    ],
    [
      "trust",
      3,
      "default",
      {
        title: "Perché sceglierci",
        badges: [
          "Qualità premium",
          "25 anni esperienza",
          "Personale qualificato",
          "Prezzi trasparenti",
        ],
      },
    ],
    [
      "about",
      2,
      "split",
      {
        eyebrow: "Chi siamo",
        title: "25 anni di passione per l'estetica",
        body: "Tonino e il suo team operano dal 1998 con la stessa passione. Ogni trattamento viene studiato sulla persona, non sul listino. Usiamo solo marchi professionali certificati: risultati visibili già dalle prime sedute.",
      },
    ],
    ["services", 4, "cards", { title: "I nostri trattamenti", eyebrow: "Listino servizi" }],
    [
      "gallery",
      5,
      "masonry",
      { title: "Galleria immagini", subtitle: "Alcuni momenti dei nostri trattamenti", columns: 4 },
    ],
    [
      "staff",
      6,
      "default",
      { title: "Il nostro team", subtitle: "Professionisti al tuo servizio" },
    ],
    ["reviews", 7, "default", { headline: "Cosa dicono i clienti", isFixtureDemo: true }],
    [
      "hours",
      8,
      "default",
      {
        title: "I nostri orari",
        weekdays: "Lun-Ven 9:00-19:00",
        sat: "Sabato 9:00-17:00",
        sun: "Domenica chiuso",
      },
    ],
    [
      "booking_widget",
      9,
      "default",
      {
        title: "Prenota il tuo appuntamento",
        subtitle: "Prenota in pochi clic o chiamaci",
        eyebrow: "Prenotazioni online 24/7",
      },
    ],
    [
      "features_cta",
      10,
      "split",
      { title: "Carta Fedeltà Premium", eyebrow: "Vantaggi esclusivi" },
    ],
    [
      "contact",
      11,
      "default",
      {
        title: "Vieni a trovarci",
        phone: "+39 0962 123456",
        email: "info@estetistadonino.it",
        city: "Crotone",
        address: "Via Roma, 12",
        gmaps_url: "https://maps.google.com",
      },
    ],
    ["footer", 99, "default", { tagline: "Estetista da Tonino — Qualità premium dal 1998" }],
  ];
  for (const [section_type, position, variant, settings] of TONINO_SECTIONS) {
    await client.query(
      `INSERT INTO site_sections (
        tenant_id, section_type, position, enabled, variant, settings, created_at, updated_at
      ) VALUES ($1::uuid, $2, $3, true, $4, $5::jsonb, $6, $6)`,
      [TONINO_UUID, section_type, position, variant, JSON.stringify(settings), ts],
    );
  }
  console.log("→ Tonino sections INSERTED:", TONINO_SECTIONS.length);

  // ---------------------------------------------------------------
  // 6. UPDATE LUCA VARIANTS if not matching spec
  // ---------------------------------------------------------------
  const getLuca = await client.query(
    "SELECT id::text as tid FROM tenants WHERE slug = 'barbieri-luca' LIMIT 1",
  );
  if (getLuca.rows.length) {
    const lucaId = getLuca.rows[0].tid;
    // cleanup old sections (session_replication_role replica bypasses audit)
    await client.query("DELETE FROM site_sections WHERE tenant_id = $1::uuid", [lucaId]);
    await client.query("DELETE FROM services WHERE tenant_id = $1::uuid", [lucaId]);

    // Re-insert LUCA exactly like seed phase3 (inline)
    await client.query(
      `UPDATE tenants SET name=$2, design_preset_id='barber_strong', updated_at=now(), published_at=now()
       WHERE id=$1::uuid`,
      [lucaId, "Barbieri Luca — Classic Barber Shop"],
    );
    const LUCA_SERVICES = [
      ["Taglio Uomo + Lavaggio", 18, 30],
      ["Taglio Ragazzo U14", 12, 25],
      ["Barba Tradizionale", 15, 25],
      ["Taglio + Barba Combo", 30, 50],
      ["Trattamento Barba Premium", 22, 40],
      ["Taglio + Shatush Uomo", 45, 75],
      ["Barba + Rasoio Tradizionale", 20, 35],
      ["Pacchetto VIP Mens", 60, 90],
    ];
    for (let i = 0; i < LUCA_SERVICES.length; i++) {
      const [n, pr, dur] = LUCA_SERVICES[i];
      await client.query(
        `INSERT INTO services (
          tenant_id, name, description, price, currency,
          duration_minutes, active, position,
          deposit_strategy, deposit_value, created_at, updated_at, price_from
        ) VALUES ($1::uuid, $2, $3, $4, 'EUR', $5, true, $6, 'NONE', 0, $7, $7, $4)`,
        [lucaId, n, "Servizio barbiere tradizionale.", pr, dur, i + 1, ts],
      );
    }
    const LUCA_SECTIONS = [
      [
        "navbar",
        0,
        "transparent",
        { showLogo: true, showBookingButton: true, showPhone: true, ctaLabel: "Prenota ora" },
      ],
      [
        "hero",
        1,
        "split_hero_left",
        {
          headlineOverride: "Barberia tradizionale dal 1987",
          subheadline: "Forbici, rasoio a mano libera e la vera esperienza da barbiere.",
          eyebrow: "Barbieri Luca · Roma Prati",
          ctaLabel: "Prenota taglio barba",
          ctaTarget: "/s/barbieri-luca/booking",
        },
      ],
      [
        "trust",
        2,
        "icons",
        {
          title: "Perché oltre 1200 clienti ci scelgono",
          badges: [
            "Rasoio tradizionale",
            "Prodotti Made in Italy",
            "38 anni di esperienza",
            "Barbieri certificati",
          ],
        },
      ],
      ["services", 3, "editorial_list", { title: "I nostri servizi", eyebrow: "Listino prezzi" }],
      [
        "gallery",
        4,
        "masonry",
        { title: "La nostra bottega", subtitle: "Ambiente classico, stile autentico", columns: 3 },
      ],
      ["staff", 5, "cards", { title: "I maestri barbieri", subtitle: "Luca, Marco e Andrea" }],
      ["reviews", 6, "cards", { headline: "Recensioni verificate", isFixtureDemo: true }],
      [
        "about",
        7,
        "split",
        {
          title: "La storia di una bottega dal 1987",
          eyebrow: "Chi siamo",
          body: "Fondata dal nonno di Luca nel 1987, la nostra barberia porta avanti le tecniche tradizionali con passione. Forbici affilate, rasoio a mano libera, prodotti di qualità. 4 sedie, nessuna fretta, solo risultati.",
        },
      ],
      [
        "hours",
        8,
        "default",
        {
          title: "Orari della bottega",
          weekdays: "Lun-Ven 8:30-19:30",
          sat: "Sab 8:00-18:30",
          sun: "Chiuso",
        },
      ],
      [
        "booking_widget",
        9,
        "compact",
        {
          title: "Prenota il tuo slot",
          eyebrow: "Tempo medio attesa 3 settimane",
          subtitle: "Prenota online 24/7, paghi direttamente in bottega.",
        },
      ],
      [
        "contact",
        10,
        "default",
        {
          title: "Vieni a trovarci",
          phone: "+3906456789",
          email: "luca@barberiluca.it",
          city: "Roma Prati",
          address: "Via Cola di Rienzo, 18",
          gmaps_url: "https://maps.google.com",
        },
      ],
      ["footer", 99, "default", { tagline: "Barbieri Luca · Traditional barbershop · Since 1987" }],
    ];
    for (const [section_type, position, variant, settings] of LUCA_SECTIONS) {
      await client.query(
        `INSERT INTO site_sections (
          tenant_id, section_type, position, enabled, variant, settings, created_at, updated_at
        ) VALUES ($1::uuid, $2, $3, true, $4, $5::jsonb, $6, $6)`,
        [lucaId, section_type, position, variant, JSON.stringify(settings), ts],
      );
    }
    console.log(
      "→ Luca UPDATED (clean + insert)",
      LUCA_SECTIONS.length,
      "sections",
      LUCA_SERVICES.length,
      "services",
    );
  }

  // ---------------------------------------------------------------
  // 7. UPDATE GIULIA VARIANTS if not matching spec
  // ---------------------------------------------------------------
  const getGiulia = await client.query(
    "SELECT id::text as tid FROM tenants WHERE slug = 'giulia-hair' LIMIT 1",
  );
  if (getGiulia.rows.length) {
    const giuId = getGiulia.rows[0].tid;
    await client.query("DELETE FROM site_sections WHERE tenant_id = $1::uuid", [giuId]);
    await client.query("DELETE FROM services WHERE tenant_id = $1::uuid", [giuId]);
    await client.query(
      `UPDATE tenants SET name=$2, design_preset_id='editorial', updated_at=now(), published_at=now()
       WHERE id=$1::uuid`,
      [giuId, "Giulia Hair Studio — Editorial Hair Salon"],
    );
    const GIULIA_SERVICES = [
      ["Taglio + Piega Donna", 45, 60],
      ["Shampoo + Piega", 25, 40],
      ["Colore Pieno", 65, 90],
      ["Mèches + Colpi di Sole", 95, 120],
      ["Permanente", 120, 150],
      ["Riflessante Vegetale", 40, 45],
      ["Trattamento Cheratina", 150, 180],
      ["Piega Veloce", 18, 30],
      ["Acconciatura Sposa", 220, 180],
      ["Taglio Bimba U12", 22, 30],
    ];
    for (let i = 0; i < GIULIA_SERVICES.length; i++) {
      const [n, pr, dur] = GIULIA_SERVICES[i];
      await client.query(
        `INSERT INTO services (
          tenant_id, name, description, price, currency,
          duration_minutes, active, position,
          deposit_strategy, deposit_value, created_at, updated_at, price_from
        ) VALUES ($1::uuid, $2, $3, $4, 'EUR', $5, true, $6, 'NONE', 0, $7, $7, $4)`,
        [giuId, n, "Servizio hair studio professionale.", pr, dur, i + 1, ts],
      );
    }
    const GIULIA_SECTIONS = [
      [
        "navbar",
        0,
        "default",
        { showLogo: true, showBookingButton: true, showPhone: true, ctaLabel: "Prenota" },
      ],
      [
        "hero",
        1,
        "editorial",
        {
          headlineOverride: "Arte capelli · Made in Italy",
          subheadline:
            "Studio indipendente nel cuore di Milano Brera. Tendenze, tecnologia, artigianato. Giulia, Sara e Chiara.",
          eyebrow: "Giulia Hair Studio · MMXXIV",
          ctaLabel: "Prenota consulenza",
          ctaTarget: "/s/giulia-hair/booking",
        },
      ],
      [
        "about",
        2,
        "split",
        {
          eyebrow: "La storia del salone",
          title: "Hair studio indipendente · fondato 2019",
          body: "Giulia apre nel 2019 dopo 10 anni a Londra tra Vidal Sassoon e session styling. 3 sedie, 4 stiliste, prodotti cruelty-free. Ogni cliente ha la sua sedia: non siamo un assembly-line, siamo artigiani.",
        },
      ],
      [
        "services",
        3,
        "category_tabs",
        { title: "Trattamenti e listino", eyebrow: "Servizi editoriali" },
      ],
      [
        "price_list",
        4,
        "table",
        {
          title: "Listino prezzi completo",
          eyebrow: "Prezzi trasparenti",
          subtitle:
            "Tutti i prezzi includono IVA, prodotti professionali e consulenza personalizzata.",
        },
      ],
      [
        "gallery",
        5,
        "grid",
        { title: "Lavori recenti", subtitle: "Editorial · fashion · commercial", columns: 3 },
      ],
      [
        "trust",
        6,
        "default",
        {
          title: "Perché oltre 900 donne si fidano di noi",
          badges: [
            "Cruelty-free",
            "Wella Master Stylist",
            "Londra corso Vidal",
            "Parrucchiere della donna 2023",
          ],
        },
      ],
      [
        "staff",
        7,
        "compact",
        { title: "Le stiliste", subtitle: "Giulia · Sara · Chiara · Martina" },
      ],
      ["reviews", 8, "carousel", { headline: "Dicono di noi", isFixtureDemo: true }],
      [
        "hours",
        9,
        "default",
        {
          title: "Orari salone",
          weekdays: "Mar-Ven 10:00-19:00",
          sat: "Sab 9:30-18:00",
          sun: "Lun-Dom chiuso",
        },
      ],
      [
        "booking_widget",
        10,
        "full",
        {
          title: "Prenota il tuo prossimo look",
          subtitle:
            "Scegli data, stilista e trattamento: conferma immediata. Nessun deposito richiesto.",
          eyebrow: "Prenotazioni",
        },
      ],
      [
        "contact",
        11,
        "default",
        {
          title: "Vieni in salone",
          phone: "+39021234567",
          email: "hello@giuliahair.it",
          city: "Milano Brera",
          address: "Via Brera, 14",
          gmaps_url: "https://maps.google.com",
        },
      ],
      [
        "footer",
        99,
        "default",
        { tagline: "Giulia Hair Studio · Milano · cruelty-free hair studio" },
      ],
    ];
    for (const [section_type, position, variant, settings] of GIULIA_SECTIONS) {
      await client.query(
        `INSERT INTO site_sections (
          tenant_id, section_type, position, enabled, variant, settings, created_at, updated_at
        ) VALUES ($1::uuid, $2, $3, true, $4, $5::jsonb, $6, $6)`,
        [giuId, section_type, position, variant, JSON.stringify(settings), ts],
      );
    }
    console.log(
      "→ Giulia UPDATED (clean + insert)",
      GIULIA_SECTIONS.length,
      "sections",
      GIULIA_SERVICES.length,
      "services",
    );
  }

  // ---------------------------------------------------------------
  // 8. Ensure workspace_routes (tabella potrebbe non esistere in locale)
  // ---------------------------------------------------------------
  const wrExists = await client.query(
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'workspace_routes') AS e",
  );
  if (wrExists.rows[0].e) {
    const threeSlugs = ["slugo-mtu30v76-1fon", "barbieri-luca", "giulia-hair"];
    for (const slug of threeSlugs) {
      const getT = await client.query("SELECT id::text as tid FROM tenants WHERE slug=$1", [slug]);
      if (getT.rows.length) {
        const tid = getT.rows[0].tid;
        const getWR = await client.query(
          "SELECT 1 FROM workspace_routes WHERE tenant_id=$1::uuid OR hostname ILIKE $2 LIMIT 1",
          [tid, `${slug}%`],
        );
        if (!getWR.rows.length) {
          try {
            await client.query(
              `INSERT INTO workspace_routes (tenant_id, hostname, created_at, updated_at)
               VALUES ($1::uuid, $2, now(), now()) ON CONFLICT DO NOTHING`,
              [tid, `${slug}.velora.local`],
            );
          } catch (_) {
            // ignore
          }
        }
      }
    }
  }

  await client.query("COMMIT");
  console.log("✓ Transaction COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("✗ ROLLBACK:", e.message);
  process.exit(1);
} finally {
  await client.query("RESET session_replication_role").catch(() => {});
}

// ---------------------------------------------------------------
// 9. READ BACK
// ---------------------------------------------------------------
const rbTenants = await client.query(`
  SELECT t.name, t.slug, t.status, t.published, t.design_preset_id,
    (SELECT COUNT(*) FROM services s WHERE s.tenant_id=t.id) n_services,
    (SELECT COUNT(*) FROM site_sections ss WHERE ss.tenant_id=t.id) n_sections,
    (SELECT STRING_AGG(ss.section_type||':'||COALESCE(ss.variant,'default'), ' · ' ORDER BY ss.position)
     FROM site_sections ss WHERE ss.tenant_id=t.id) summary
  FROM tenants t
  WHERE t.slug IN ('slugo-mtu30v76-1fon','barbieri-luca','giulia-hair')
  ORDER BY created_at;
`);
console.log("\n=== READ BACK 3 TENANTS (after ensure) ===");
console.table(rbTenants.rows);

const rbSvcs = await client.query(`
  SELECT t.slug, t.name tenant, s.name svc, s.price, s.currency, s.duration_minutes dur
  FROM services s JOIN tenants t ON s.tenant_id=t.id
  WHERE t.slug IN ('slugo-mtu30v76-1fon','barbieri-luca','giulia-hair')
  ORDER BY t.slug, s.position;
`);
console.log("\n=== READ BACK SERVICES (price check) ===");
console.table(rbSvcs.rows);

await client.end();
process.exit(0);
