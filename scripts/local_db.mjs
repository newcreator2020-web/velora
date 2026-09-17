/* eslint-disable no-console */
/* SQL DIRECT RUNNER locale Supabase Docker */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CFG = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: process.env.SUPABASE_LOCAL_PG_PASS ?? "postgres",
  database: "postgres",
  ssl: false,
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  allowExitOnIdle: true,
};

const client = new pg.Client(CFG);
await client.connect();
console.log("✓ Connected to local supabase-db", CFG.host + ":" + CFG.port);

const mode = process.argv[2] ?? "seed";

if (mode === "check") {
  const res = await client.query(`
    SELECT
      t.id::text,
      t.slug,
      t.name,
      t.status,
      t.published,
      t.design_preset_id,
      (SELECT COUNT(*) FROM public.services s WHERE s.tenant_id = t.id) as n_services,
      (SELECT COUNT(*) FROM public.site_sections ss WHERE ss.tenant_id = t.id) as n_sections
    FROM public.tenants t
    ORDER BY t.created_at DESC
    LIMIT 12;
  `);
  console.log("\n=== TENANTS CHECK ===");
  console.table(res.rows);
  await client.end();
  process.exit(0);
}

if (mode === "seed") {
  const sqlPath = path.resolve(ROOT, "artifacts", "phase3_seed_three_sites.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  console.log("Executing SQL seed:", sqlPath, "(" + sql.length + " bytes)");
  try {
    await client.query(sql);
    console.log("✓ phase3_seed_three_sites.sql executed");
  } catch (err) {
    console.error("✗ Seed failed:", err.message);
    await client.end();
    process.exit(1);
  }

  const rbTenants = await client.query(`
    SELECT
      t.name,
      t.slug,
      t.status,
      t.published,
      t.design_preset_id,
      (SELECT COUNT(*) FROM public.services s WHERE s.tenant_id = t.id) AS n_services,
      (SELECT COUNT(*) FROM public.site_sections ss WHERE ss.tenant_id = t.id) AS n_sections,
      (SELECT STRING_AGG(ss.section_type || ':' || COALESCE(ss.variant,'default'), ' · ' ORDER BY ss.position)
        FROM public.site_sections ss WHERE ss.tenant_id = t.id) AS sections_summary
    FROM public.tenants t
    WHERE t.id IN (
      'd5a0538e-567e-45ee-b00e-61659ed50637'::uuid,
      (SELECT id FROM public.tenants WHERE slug='barbieri-luca'),
      (SELECT id FROM public.tenants WHERE slug='giulia-hair')
    )
    ORDER BY t.created_at;
  `);
  console.log("\n=== READ BACK 3 TENANTS SUMMARY ===");
  console.table(rbTenants.rows);

  const rbSvcs = await client.query(`
    SELECT
      t.slug,
      t.name as tenant_name,
      s.name as service_name,
      s.price, s.currency, s.duration_minutes
    FROM public.services s
    JOIN public.tenants t ON s.tenant_id = t.id
    WHERE t.slug IN ('barbieri-luca','giulia-hair','slugo-mtu30v76-1fon')
    ORDER BY t.slug, s.position
    LIMIT 40;
  `);
  console.log("\n=== READ BACK SERVICES ===");
  console.table(rbSvcs.rows);

  await client.end();
  process.exit(0);
}

console.error("Usage: node scripts/local_db.mjs [check|seed]");
await client.end();
process.exit(1);
