import "dotenv/config";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const buildPgOpts = () => ({
  host: process.env.SUPABASE_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? "postgres",
  user: process.env.SUPABASE_DB_USER ?? "postgres",
  password: process.env.SUPABASE_DB_PASSWORD ?? "postgres",
});

const A = {
  slug: "velora-e2e-pub-barber-a",
  name: "E2E Tenant A Srl",
  displayName: "Barbiere E2E — TENANT A FASE4",
  category: "Barbiere",
  description:
    "Sito pubblico E2E Fase 4. Contenuti esclusivi Tenant A. Taglio, rasatura, cura barba.",
  phone: "+39 06 11111111",
  email: "e2e-pub-a@velora-public.example",
  website: "https://pub-a.velora-test.example",
  address: "Via dei Condotti 1",
  city: "Roma",
  province: "RM",
  postal: "00187",
  country: "IT",
  themePrimary: "#0f766e",
  themeBackground: "#fafafa",
  themeRadius: "lg",
  sections: [
    {
      type: "hero",
      position: 0,
      enabled: true,
      variant: "centered",
      settings: {
        eyebrow: "Benvenuti nel nostro salone",
        ctaLabel: "Prenota ora",
        ctaTarget: "/contatti",
      },
    },
    {
      type: "about",
      position: 1,
      enabled: true,
      variant: "default",
      settings: { eyebrow: "Chi siamo" },
    },
    {
      type: "services",
      position: 2,
      enabled: true,
      variant: "cards",
      settings: { eyebrow: "Listino prezzi" },
    },
    { type: "gallery", position: 3, enabled: true, variant: "default", settings: {} },
    { type: "staff", position: 4, enabled: true, variant: "default", settings: {} },
    { type: "reviews", position: 5, enabled: true, variant: "default", settings: {} },
    {
      type: "contact",
      position: 6,
      enabled: true,
      variant: "default",
      settings: { eyebrow: "Dove siamo" },
    },
  ],
  services: [
    {
      name: "Taglio uomo",
      description: "Taglio classico lavaggio asciugatura",
      priceFrom: "22.50",
      currency: "EUR",
      durationMinutes: 30,
      active: true,
      position: 0,
    },
    {
      name: "Rasatura",
      description: "Rasatura tradizionale con panno caldo",
      priceFrom: "18.00",
      currency: "EUR",
      durationMinutes: 30,
      active: true,
      position: 1,
    },
    {
      name: "Trattamento barba",
      description: "Cura e rifinitura barba completa",
      priceFrom: "12.00",
      currency: "EUR",
      durationMinutes: 20,
      active: true,
      position: 2,
    },
    {
      name: "Pacchetto spa uomo",
      description: "Pacchetto relax (inattivo demo)",
      priceFrom: "55.00",
      currency: "EUR",
      durationMinutes: 90,
      active: false,
      position: 3,
    },
  ],
};
const B = {
  slug: "velora-e2e-pub-beauty-b",
  name: "E2E Tenant B Sas",
  displayName: "Centro Bellezza E2E — TENANT B FASE4",
  category: "Estetica",
  description:
    "Sito pubblico E2E Fase 4. Contenuti esclusivi Tenant B. Trattamenti viso, corpo, solarium.",
  phone: "+39 02 22222222",
  email: "e2e-pub-b@velora-public.example",
  website: "https://pub-b.velora-test.example",
  address: "Via Montenapoleone 22",
  city: "Milano",
  province: "MI",
  postal: "20121",
  country: "IT",
  themePrimary: "#be185d",
  themeBackground: "#ffffff",
  themeRadius: "md",
  themeHeading: "display",
  sections: [
    {
      type: "hero",
      position: 0,
      enabled: true,
      variant: "split",
      settings: {
        eyebrow:
          'Beauté<img src=x onerror="alert(\'xss-b\')">Milano<script>alert("xssb2")</script>',
        ctaLabel: "Chiama",
        ctaTarget: "tel:+390222222222",
      },
    },
    { type: "contact", position: 1, enabled: true, variant: "default", settings: {} },
    { type: "about", position: 2, enabled: true, variant: "minimal", settings: {} },
    { type: "gallery", position: 3, enabled: true, variant: "carousel", settings: {} },
    { type: "services", position: 4, enabled: true, variant: "cards", settings: {} },
    { type: "reviews", position: 5, enabled: true, variant: "default", settings: {} },
  ],
  services: [],
};
const UNPUB = {
  slug: "velora-e2e-unpublished-c",
  name: "E2E Unpublished Snc",
  displayName: "NON VISIBILE",
  category: "Prova",
  description: "NON PUBBLICATO - NON VISIBILE",
  phone: "+39 033 000000",
  email: "unpub-c@velora-public.example",
  city: "Napoli",
  province: "NA",
  postal: "80100",
  country: "IT",
  sections: [
    { type: "hero", position: 0, enabled: true, variant: "centered", settings: {} },
    { type: "contact", position: 1, enabled: true, variant: "default", settings: {} },
  ],
};

async function cleanupAndInsert(pg, spec, opts) {
  const now = new Date();
  const publishedAt = opts.published ? now : null;
  const tenantId = randomUUID();
  await pg.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  try {
    await pg.query(`DELETE FROM public.business_profiles WHERE tenant_id = $1`, [tenantId]);
    await pg.query(
      `DELETE FROM public.site_sections WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug = $1)`,
      [spec.slug],
    );
    await pg.query(
      `DELETE FROM public.services WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug = $1)`,
      [spec.slug],
    );
    await pg.query(
      `DELETE FROM public.business_availability WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug = $1)`,
      [spec.slug],
    );
    await pg.query(
      `DELETE FROM public.tenants WHERE id IN (SELECT id FROM public.tenants WHERE slug = $1) OR slug = $1`,
      [spec.slug],
    );
    await pg.query(
      `INSERT INTO public.tenants(id, name, slug, status, published, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, spec.name, spec.slug, opts.status, opts.published, publishedAt, now, now],
    );
    await pg.query(
      `INSERT INTO public.business_profiles(
          tenant_id, display_name, category, description, phone, email, website_url,
          address_line1, address_line2, city, province, postal_code, country_code,
          latitude, longitude, locale, timezone, created_at, updated_at,
          theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
          theme_heading_font_preset, theme_body_font_preset
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        tenantId,
        spec.displayName,
        spec.category,
        spec.description,
        spec.phone ?? null,
        spec.email ?? null,
        spec.website ?? null,
        spec.address ?? null,
        null,
        spec.city,
        spec.province,
        spec.postal,
        spec.country,
        null,
        null,
        "it",
        "Europe/Rome",
        now,
        now,
        spec.themePrimary ?? "#111827",
        spec.themeBackground ?? "#fafafa",
        spec.themeForeground ?? "#0f172a",
        spec.themeMuted ?? "#6b7280",
        spec.themeRadius ?? "lg",
        spec.themeHeading ?? "sans",
        spec.themeBody ?? "sans",
      ],
    );
    if (Array.isArray(spec.sections) && spec.sections.length) {
      for (const s of spec.sections) {
        await pg.query(
          `INSERT INTO public.site_sections(id, tenant_id, section_type, position, enabled, variant, settings)
           VALUES ($1::uuid, $2::uuid, $3, $4::int, $5::boolean, $6, $7::jsonb)`,
          [
            randomUUID(),
            tenantId,
            s.type,
            s.position,
            Boolean(s.enabled),
            s.variant ?? "default",
            JSON.stringify(s.settings ?? {}),
          ],
        );
      }
    }
    if (Array.isArray(spec.services) && spec.services.length) {
      for (const s of spec.services) {
        await pg.query(
          `INSERT INTO public.services(tenant_id, name, description, price_from, currency, duration_minutes, active, position)
           VALUES ($1::uuid,$2::text,$3::text,$4::numeric(10,2),$5,$6::int,$7::boolean,$8::int)`,
          [
            tenantId,
            s.name,
            s.description ?? null,
            s.priceFrom,
            s.currency ?? "EUR",
            s.durationMinutes ?? 30,
            s.active ?? true,
            s.position,
          ],
        );
      }
    }
    const defaultAvailability = [
      [0, false, "09:00", "18:00"],
      [1, true, "09:00", "18:00"],
      [2, true, "09:00", "18:00"],
      [3, true, "09:00", "18:00"],
      [4, true, "09:00", "18:00"],
      [5, true, "09:00", "18:00"],
      [6, true, "09:00", "13:00"],
    ];
    for (const [wd, en, s, e] of defaultAvailability) {
      await pg.query(
        `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time, created_at, updated_at)
         VALUES ($1::uuid,$2::int,$3::boolean,$4::time,$5::time,$6::timestamptz,$7::timestamptz)
         ON CONFLICT (tenant_id, weekday) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           updated_at = EXCLUDED.updated_at`,
        [tenantId, wd, en, s, e, now, now],
      );
    }
    await pg.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  } catch (err) {
    try {
      await pg.query(`SET LOCAL session_replication_role = DEFAULT; ROLLBACK;`);
    } catch (_) {
      /* swallow */
    }
    throw err;
  }
  await pg.query(
    `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
     VALUES ($1::uuid, $2, 'principale', TRUE, TRUE, 0)
     ON CONFLICT (tenant_id, slug) DO NOTHING`,
    [tenantId, (spec.displayName || "Principale").substring(0, 80)],
  );
  return tenantId;
}

async function main() {
  const pg = new PgClient(buildPgOpts());
  try {
    await pg.connect();
    await cleanupAndInsert(pg, A, { status: "active", published: true });
    await cleanupAndInsert(pg, B, { status: "active", published: true });
    await cleanupAndInsert(pg, UNPUB, { status: "active", published: false });
    console.warn(`[E2E PUBLIC SETUP] OK`);
    console.warn(`  A /s/${A.slug}  (published active)`);
    console.warn(`  B /s/${B.slug}  (published active)`);
    console.warn(`  C /s/${UNPUB.slug}  (unpublished)`);
  } catch (err) {
    console.error("[E2E PUBLIC SETUP] FAIL", err);
    throw err;
  } finally {
    await pg.end();
  }
}

export default main;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
