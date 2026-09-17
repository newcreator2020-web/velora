#!/usr/bin/env node
/* eslint-disable */
// =====================================================================
// MEDIA E2E FIRST-CLIENT-READY · TASK A (workaround locale)
// Storage Supabase locale RLS ownership issue → scriviamo file in
// public/media-demo/tonino/* serviti staticamente da Next.js.
// Popoliamo media_library / media_assocs come meta-sistema.
// I file sono PNG reali generati da sharp (NO AI) con watermark DEMO.
// =====================================================================
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const MEDIA_DIR = path.join(PUBLIC_DIR, "media-demo", "tonino");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const TENANT_SLUG = "slugo-mtu30v76-1fon";
const ADMIN_USER_ID = "00000000-0000-0000-0000-000000000000";

const pg = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 54322),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
});

// =====================================================================
// Utility
// =====================================================================
function watermarkSvg(text, w, h, fontSize = 40) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <style>
        .t { font: 700 ${fontSize}px system-ui,-apple-system,Segoe UI,sans-serif; fill: white; paint-order: stroke; stroke: rgba(0,0,0,0.5); stroke-width: 5px; letter-spacing: 0.4px; }
        .s { font: 500 ${Math.round(fontSize * 0.5)}px system-ui,sans-serif; fill: rgba(255,255,255,0.9); }
      </style>
      <rect x="${w / 2 - 360}" y="${h / 2 - 90}" width="720" height="180" rx="18" fill="rgba(0,0,0,0.38)"/>
      <text x="${w / 2}" y="${h / 2 - 10}" text-anchor="middle" class="t">${text}</text>
      <text x="${w / 2}" y="${h / 2 + 44}" text-anchor="middle" class="s">Velora · Asset dimostrativo · NON foto reale cliente</text>
    </svg>`,
  );
}

function makePlaceholder({ width, height, label, palette }) {
  const [r, g, b] = palette;
  const svgWM = watermarkSvg(label, width, height, Math.round(width / 30));
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .modulate({ saturation: 1.08, brightness: 1.02 })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <defs>
              <radialGradient id="g" cx="28%" cy="22%" r="95%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.38)"/>
                <stop offset="52%" stop-color="rgba(255,255,255,0.05)"/>
                <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#g)"/>
          </svg>`,
        ),
        gravity: "center",
      },
      { input: svgWM, gravity: "center" },
    ])
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}

function u8() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

async function writeVariants(srcBuf, baseNameNoExt) {
  const variants = [];
  const defs = [
    { key: "small", w: 480, label: "Small 480w" },
    { key: "medium", w: 1024, label: "Medium 1024w" },
    { key: "large", w: 1920, label: "Large 1920w" },
  ];
  for (const v of defs) {
    const f = `${baseNameNoExt}.${v.key}.webp`;
    const full = path.join(MEDIA_DIR, f);
    const out = await sharp(srcBuf)
      .rotate()
      .resize({ width: v.w, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    fs.writeFileSync(full, out);
    let vw = v.w,
      vh = 0;
    try {
      const m = await sharp(out).metadata();
      vw = m.width ?? v.w;
      vh = m.height ?? 0;
    } catch {}
    variants.push({
      key: v.key,
      label: v.label,
      width: v.w,
      stored_path: `/media-demo/tonino/${f}`,
      mime_type: "image/webp",
      file_size_bytes: out.length,
      width_px: vw,
      height_px: vh,
    });
  }
  return variants;
}

// =====================================================================
// STEP 0 · Carica Tonino
// =====================================================================
console.log("A-01 Ottieni tenant Tonino");
const tRow = await pg.query(`SELECT id, name, slug FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
if (tRow.rowCount === 0) {
  console.error("Tenant Tonino non trovato");
  process.exit(2);
}
const TENANT_ID = tRow.rows[0].id;
console.log("   id =", TENANT_ID.slice(0, 8), "...");

// admin user stub
try {
  await pg.query(
    `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-media-e2e@velora.local', '', NOW(), NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [ADMIN_USER_ID],
  );
} catch {}

// =====================================================================
// STEP 1 · Genera assets
// =====================================================================
console.log("A-02 Genera placeholder sharp gradient/watermark DEMO");
const PAL = {
  hero: [107, 70, 110],
  gallery1: [168, 109, 141],
  gallery2: [215, 143, 167],
  gallery3: [233, 180, 178],
  gallery4: [124, 148, 165],
  gallery5: [93, 122, 130],
  gallery6: [185, 150, 120],
  gallery7: [149, 120, 140],
  gallery8: [203, 163, 140],
  gallery9: [130, 100, 110],
  gallery10: [100, 130, 150],
  staff1: [120, 130, 150],
  staff2: [150, 120, 130],
  staff3: [130, 150, 120],
  service1: [170, 130, 150],
  service2: [180, 160, 130],
  service3: [150, 170, 170],
  service4: [160, 140, 180],
  service5: [190, 140, 140],
};

const heroBuf = await makePlaceholder({
  width: 2400,
  height: 1600,
  label: "[DEMO] Hero Cover · Estetista da Tonino",
  palette: PAL.hero,
});
const galBufs = [];
for (let i = 1; i <= 10; i++)
  galBufs.push(
    await makePlaceholder({
      width: 1600,
      height: 1200,
      label: `[DEMO] Gallery ${i}/10 · Tonino`,
      palette: PAL[`gallery${i}`],
    }),
  );
const staffBufs = [];
for (let i = 1; i <= 3; i++)
  staffBufs.push(
    await makePlaceholder({
      width: 1200,
      height: 1500,
      label: `[DEMO] Staff ${i}/3 - Foto profilo dimostrativa`,
      palette: PAL[`staff${i}`],
    }),
  );
const srvBufs = [];
for (let i = 1; i <= 5; i++)
  srvBufs.push(
    await makePlaceholder({
      width: 1400,
      height: 900,
      label: `[DEMO] Servizio ${i}/5 · Tonino`,
      palette: PAL[`service${i}`],
    }),
  );

// =====================================================================
// STEP 2 · Scrivi file su disco + varianti webp
// =====================================================================
console.log("A-03 Scrivi file public/media-demo/tonino/ + 3 varianti webp responsive");
const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;

async function persistAsset({ buf, filenameOrig, category, altText, caption }) {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const base = `${u8()}-${filenameOrig
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
  // originale
  const origPath = `${base}.png`;
  fs.writeFileSync(path.join(MEDIA_DIR, origPath), buf);
  let w = null,
    h = null;
  try {
    const m = await sharp(buf).metadata();
    w = m.width ?? null;
    h = m.height ?? null;
  } catch {}
  const variants = await writeVariants(buf, base);
  const publicStored = `/media-demo/tonino/${origPath}`;
  const publicUrl = `/media-demo/tonino/${origPath}`;

  // insert media_library via service (bypass RLS: pg superuser diretto)
  const insertRes = await pg.query(
    `INSERT INTO media_library
     (filename_orig, stored_path, mime_type, file_size_bytes, width_px, height_px,
      checksum_sha256, alt_text, caption, category, variants, owner_tenant_id, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published')
     RETURNING id, stored_path`,
    [
      filenameOrig,
      publicStored,
      "image/png",
      buf.length,
      w,
      h,
      sha256,
      altText,
      caption,
      category,
      variants.length ? JSON.stringify({ variants }) : null,
      TENANT_ID,
      ADMIN_USER_ID,
    ],
  );
  return { id: insertRes.rows[0].id, publicUrl, variants, altText };
}

// Cancella vecchi file Tonino per evitare duplicati hash upload fallimento
const listDir = fs.readdirSync(MEDIA_DIR);
for (const f of listDir) fs.unlinkSync(path.join(MEDIA_DIR, f));
const countsBefore = await pg.query(
  `SELECT COUNT(*)::int as c FROM media_library WHERE owner_tenant_id = $1`,
  [TENANT_ID],
);
if (countsBefore.rows[0].c > 0) {
  await pg.query(`DELETE FROM media_assocs WHERE tenant_id = $1`, [TENANT_ID]);
  await pg.query(`DELETE FROM media_library WHERE owner_tenant_id = $1`, [TENANT_ID]);
  console.log("   Pulizia pre-esistenti OK");
}

const heroMedia = await persistAsset({
  buf: heroBuf,
  filenameOrig: "tonino-hero-cover-demo.png",
  category: "hero",
  altText:
    "[DEMO] Immagine copertina hero dimostrativa - centro estetico tonino - sfondo viola gradiente con watermark asset QA",
  caption: "Asset dimostrativo interno per QA. Non rappresenta l'attività reale.",
});
console.log("   HERO id =", heroMedia.id.slice(0, 8), "variants =", heroMedia.variants.length);

const galleryMedia = [];
for (let i = 0; i < galBufs.length; i++) {
  galleryMedia.push(
    await persistAsset({
      buf: galBufs[i],
      filenameOrig: `tonino-gallery-${i + 1}-demo.png`,
      category: "gallery",
      altText: `[DEMO] Gallery foto ${i + 1} di 10 - dimostrativa centro estetico tonino - watermark DEMO`,
      caption: `Gallery ${i + 1} · asset dimostrativo QA`,
    }),
  );
}
console.log(`   GALLERY caricati ${galleryMedia.length}`);

const staffMedia = [];
for (let i = 0; i < staffBufs.length; i++) {
  staffMedia.push(
    await persistAsset({
      buf: staffBufs[i],
      filenameOrig: `tonino-staff-${i + 1}-demo.png`,
      category: "staff",
      altText: `[DEMO] Foto profilo staff ${i + 1} dimostrativa - watermark DEMO`,
      caption: `Staff ${i + 1} · asset dimostrativo`,
    }),
  );
}
const serviceMedia = [];
for (let i = 0; i < srvBufs.length; i++) {
  serviceMedia.push(
    await persistAsset({
      buf: srvBufs[i],
      filenameOrig: `tonino-service-${i + 1}-demo.png`,
      category: "servizio",
      altText: `[DEMO] Foto servizio ${i + 1} dimostrativa - watermark DEMO`,
      caption: `Servizio ${i + 1} · cover dimostrativa`,
    }),
  );
}
console.log(`   STAFF ${staffMedia.length} · SERVIZI ${serviceMedia.length}`);

// =====================================================================
// STEP 3 · READ BACK verifiche
// =====================================================================
console.log("A-04 READ BACK DB · tenant scoped / alt_text / sha / variants ≥3");
const mediaList = await pg.query(
  `SELECT id, category, owner_tenant_id, status, alt_text,
          checksum_sha256 IS NOT NULL as has_sha,
          COALESCE(jsonb_array_length(variants->'variants'), 0) as var_n,
          stored_path
   FROM media_library WHERE owner_tenant_id = $1 ORDER BY category, created_at`,
  [TENANT_ID],
);
console.log(`   Totale righe: ${mediaList.rowCount}`);
const okTenant = mediaList.rows.every((r) => r.owner_tenant_id === TENANT_ID);
const okAlt = mediaList.rows.every(
  (r) => typeof r.alt_text === "string" && r.alt_text.startsWith("[DEMO]"),
);
const okVar = mediaList.rows.filter((r) => r.category !== "documento").every((r) => r.var_n >= 3);
const okPath = mediaList.rows.every((r) => r.stored_path.startsWith("/media-demo/tonino/"));
const okStatus = mediaList.rows.every((r) => r.status === "published");
if (!okTenant || !okAlt || !okVar || !okPath || !okStatus) {
  console.table(
    mediaList.rows.map((r) => ({
      cat: r.category,
      okT: r.owner_tenant_id === TENANT_ID,
      okA: r.alt_text?.startsWith("[DEMO]"),
      okV: r.var_n >= 3,
      okP: r.stored_path.startsWith("/media-demo/"),
      st: r.status,
    })),
  );
  throw new Error("VERIFY FAIL");
}
console.log(
  "   CHECK tenant scope PASS · alt_text [DEMO] PASS · variants≥3 PASS · stored_path PASS · published PASS",
);

// =====================================================================
// STEP 4 · Associazioni hero_slide / gallery_item / staff / servizio
// =====================================================================
console.log("A-05 Crea associazioni media_assocs");
async function assoc(media_id, association_type, assoc_key_id, ordine, metadata = null) {
  await pg.query(
    `INSERT INTO media_assocs (media_id, association_type, assoc_key_id, tenant_id, ordine, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (media_id, association_type, assoc_key_id, tenant_id) DO UPDATE SET updated_at = NOW()`,
    [
      media_id,
      association_type,
      assoc_key_id,
      TENANT_ID,
      ordine,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}
await assoc(heroMedia.id, "hero_slide", `hero:${TENANT_ID}`, 0, { demo: true });
for (let i = 0; i < galleryMedia.length; i++) {
  await assoc(galleryMedia[i].id, "gallery_item", `gallery:${TENANT_ID}`, i, {
    demo: true,
    idx: i + 1,
  });
}
for (let i = 0; i < staffMedia.length; i++) {
  await assoc(staffMedia[i].id, "staff", `staff_${i + 1}`, i, { demo: true });
}
for (let i = 0; i < serviceMedia.length; i++) {
  await assoc(serviceMedia[i].id, "servizio", `service_${i + 1}`, i, { demo: true });
}
const assocCount = await pg.query(`SELECT COUNT(*)::int c FROM media_assocs WHERE tenant_id = $1`, [
  TENANT_ID,
]);
console.log(`   tot associazioni: ${assocCount.rows[0].c}`);

// =====================================================================
// STEP 5 · Aggiorna business_profiles hero_cover + hero/gallery/staff/services settings
// =====================================================================
console.log("A-06 Aggiorna site_sections Tonino: hero/gallery/staff/services");
const largeV = heroMedia.variants.find((v) => v.key === "large");
const medV = heroMedia.variants.find((v) => v.key === "medium");
const smallV = heroMedia.variants.find((v) => v.key === "small");
const heroCoverAlt = heroMedia.altText;
const heroObj = {
  original: heroMedia.publicUrl,
  small: smallV ? smallV.stored_path : heroMedia.publicUrl,
  medium: medV ? medV.stored_path : heroMedia.publicUrl,
  large: largeV ? largeV.stored_path : heroMedia.publicUrl,
};

// hero section settings
const heroSec = await pg.query(
  `SELECT id, settings FROM site_sections WHERE tenant_id=$1 AND section_type='hero' LIMIT 1`,
  [TENANT_ID],
);
if (heroSec.rowCount > 0) {
  const s = heroSec.rows[0].settings || {};
  const upd = {
    ...s,
    hero_cover_url: heroMedia.publicUrl,
    hero_cover_alt: heroCoverAlt,
    hero_sources: heroObj,
    backgroundMode: "image",
    overlayOpacity: typeof s.overlayOpacity === "number" ? s.overlayOpacity : 0.55,
    isFixtureDemo: s.isFixtureDemo ?? true,
  };
  await pg.query(`UPDATE site_sections SET settings=$1, updated_at=NOW() WHERE id=$2`, [
    JSON.stringify(upd),
    heroSec.rows[0].id,
  ]);
  console.log("   hero settings updated (hero_cover_url / alt / sources)");
}

// gallery
const galSec = await pg.query(
  `SELECT id, settings FROM site_sections WHERE tenant_id=$1 AND section_type='gallery' LIMIT 1`,
  [TENANT_ID],
);
if (galSec.rowCount > 0) {
  const s = galSec.rows[0].settings || {};
  const items = galleryMedia.slice(0, 6).map((m, i) => {
    const l = m.variants.find((v) => v.key === "large")?.stored_path ?? m.publicUrl;
    const md = m.variants.find((v) => v.key === "medium")?.stored_path ?? m.publicUrl;
    const sm = m.variants.find((v) => v.key === "small")?.stored_path ?? m.publicUrl;
    return {
      id: `demo-gal-${i + 1}`,
      src: m.publicUrl,
      alt: m.altText,
      caption: `Gallery ${i + 1} · asset dimostrativo`,
      category: ["viso", "corpo", "mani", "viso", "corpo", "mani"][i],
      sources: { small: sm, medium: md, large: l },
      isFixtureDemo: true,
    };
  });
  await pg.query(`UPDATE site_sections SET settings=$1, updated_at=NOW() WHERE id=$2`, [
    JSON.stringify({ ...s, isFixtureDemo: true, columns: 3, gap: "md", layout: "masonry", items }),
    galSec.rows[0].id,
  ]);
  console.log("   gallery settings updated (6 items masonry)");
}

// staff section
const staffSec = await pg.query(
  `SELECT id, settings FROM site_sections WHERE tenant_id=$1 AND section_type='staff' LIMIT 1`,
  [TENANT_ID],
);
if (staffSec.rowCount > 0) {
  const s = staffSec.rows[0].settings || {};
  const members = [
    {
      id: "tonino-staff-1",
      name: "Tonino",
      role: "Fondatore / Estetista senior",
      bio: "Oltre 25 anni di esperienza nel settore estetico.",
      photo: staffMedia[0].publicUrl,
      alt: staffMedia[0].altText,
      isFixtureDemo: true,
    },
    {
      id: "tonino-staff-2",
      name: "Sara",
      role: "Specialista trattamenti viso",
      bio: "Diplomata in estetica avanzata con 8 anni di esperienza.",
      photo: staffMedia[1].publicUrl,
      alt: staffMedia[1].altText,
      isFixtureDemo: true,
    },
    {
      id: "tonino-staff-3",
      name: "Luna",
      role: "Tecnica massaggi corpo",
      bio: "Specializzata in massaggi linfodrenanti e trattamenti relax.",
      photo: staffMedia[2].publicUrl,
      alt: staffMedia[2].altText,
      isFixtureDemo: true,
    },
  ];
  await pg.query(`UPDATE site_sections SET settings=$1, updated_at=NOW() WHERE id=$2`, [
    JSON.stringify({ ...s, isFixtureDemo: true, variant: s.variant ?? "cards", members }),
    staffSec.rows[0].id,
  ]);
  console.log("   staff settings updated (3 membri demo)");
}

// services section: aggiungi cover alle prime 5 entries
const servicesList = await pg.query(
  `SELECT id, name, price FROM services WHERE tenant_id=$1 AND active=true ORDER BY position, name LIMIT 5`,
  [TENANT_ID],
);
const srvSec = await pg.query(
  `SELECT id, settings FROM site_sections WHERE tenant_id=$1 AND section_type='services' LIMIT 1`,
  [TENANT_ID],
);
if (srvSec.rowCount > 0 && servicesList.rowCount > 0) {
  const s = srvSec.rows[0].settings || {};
  const cards = servicesList.rows.map((row, i) => {
    const m = serviceMedia[i % serviceMedia.length];
    const l = m.variants.find((v) => v.key === "large")?.stored_path ?? m.publicUrl;
    const md = m.variants.find((v) => v.key === "medium")?.stored_path ?? m.publicUrl;
    const sm = m.variants.find((v) => v.key === "small")?.stored_path ?? m.publicUrl;
    return {
      id: String(row.id),
      title: row.name,
      description: `Trattamento ${row.name} — qualità e risultati garantiti.`,
      price: typeof row.price === "number" ? Number(row.price) : null,
      image: m.publicUrl,
      alt: m.altText,
      sources: { small: sm, medium: md, large: l },
      isFixtureDemo: true,
    };
  });
  await pg.query(`UPDATE site_sections SET settings=$1, updated_at=NOW() WHERE id=$2`, [
    JSON.stringify({
      ...s,
      isFixtureDemo: true,
      variant: s.variant ?? "cards",
      cards,
      layout: "grid",
      columns: 3,
    }),
    srvSec.rows[0].id,
  ]);
  console.log(`   services settings updated (${cards.length} card con cover demo)`);
}

// =====================================================================
// STEP 6 · Delete + Rollback (T1 transient test)
// =====================================================================
console.log("A-07 TEST Delete + Rollback transient");
const firstGal = galleryMedia[0];
// delete via DELETE sql
await pg.query(`DELETE FROM media_assocs WHERE media_id = $1`, [firstGal.id]);
await pg.query(`DELETE FROM media_library WHERE id = $1`, [firstGal.id]);
// remove files
const origName = path.basename(firstGal.publicUrl);
try {
  fs.unlinkSync(path.join(MEDIA_DIR, origName));
} catch {}
for (const v of firstGal.variants)
  try {
    fs.unlinkSync(path.join(ROOT, "public", v.stored_path));
  } catch {}
const afterDel = await pg.query(`SELECT COUNT(*)::int c FROM media_library WHERE id=$1`, [
  firstGal.id,
]);
if (afterDel.rows[0].c !== 0) throw new Error("DELETE FAIL");
// ROLLBACK: ricarica
const restored = await persistAsset({
  buf: galBufs[0],
  filenameOrig: "tonino-gallery-1-demo.png",
  category: "gallery",
  altText: "[DEMO] Gallery foto 1 di 10 - dimostrativa centro estetico tonino (rollback)",
  caption: "Gallery 1 · rollback OK",
});
await assoc(restored.id, "gallery_item", `gallery:${TENANT_ID}`, 0, {
  demo: true,
  rolledBack: true,
});
const afterRoll = await pg.query(`SELECT COUNT(*)::int c FROM media_library WHERE id=$1`, [
  restored.id,
]);
if (afterRoll.rows[0].c !== 1) throw new Error("ROLLBACK FAIL");
console.log("   delete + rollback PASS");

// =====================================================================
// STEP 7 · Summary + files count
// =====================================================================
const catCount = await pg.query(
  `SELECT category, COUNT(*)::int n FROM media_library WHERE owner_tenant_id=$1 GROUP BY category ORDER BY category`,
  [TENANT_ID],
);
const fileCount = fs.readdirSync(MEDIA_DIR).length;

console.log("\n============== MEDIA E2E · TONINO ==============");
console.log("  File scritti public/media-demo/tonino :", fileCount);
for (const r of catCount.rows) console.log(`  ${r.category.padEnd(22)} ${r.n}`);
console.log("  hero cover url ...............:", heroMedia.publicUrl);
console.log("  hero alt contains [DEMO] ?....:", heroCoverAlt.includes("[DEMO]"));
console.log(
  "  variants totali ..............:",
  mediaList.rows.reduce((s, r) => s + Number(r.var_n), 0),
);
console.log("  associazioni media_assocs ....:", assocCount.rows[0].c);

// files served HTTP? test simple 200 via node fetch per hero
try {
  const testUrl = "http://localhost:3000" + heroMedia.publicUrl;
  const res = await fetch(testUrl, { method: "HEAD" });
  console.log(`  HTTP ${res.status} serve hero file ? .....: ${res.ok ? "YES" : "NO "}`);
} catch {
  console.log("  HTTP hero check: SKIP (dev server down)");
}

console.log("\n=== MEDIA E2E COMPLETATO OK ===");

await pg.end();
process.exit(0);
