import "dotenv/config";
import { Client as PgClient } from "pg";
import { createHmac, randomUUID } from "node:crypto";

const buildPgOpts = () => ({
  host: process.env.SUPABASE_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? "postgres",
  user: process.env.SUPABASE_DB_USER ?? "postgres",
  password: process.env.SUPABASE_DB_PASSWORD ?? "postgres",
});

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const PLATFORM_ADMIN_ID = "11111111-1111-1111-1111-000000000006";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PROFILE_ID = PLATFORM_ADMIN_ID;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const urlB64 = Buffer.from(SUPABASE_URL).toString("base64url").replace(/=/g, "");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
function genUserJwt(sub, email) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    email: email ?? `admin-${sub.substring(0, 8)}@velora.example`,
    role: "authenticated",
    aal: "aal1",
    session_id: randomUUID(),
    amr: [{ method: "password", timestamp: now }],
    is_anonymous: false,
    phone: "",
    phone_confirmed_at: null,
    email_confirmed_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    iss: "supabase",
  };
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  const signing = `${head}.${body}`;
  const sig = createHmac("sha256", JWT_SECRET)
    .update(signing)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${signing}.${sig}`;
}

function buildCookieJar() {
  const AT = genUserJwt(PLATFORM_ADMIN_ID);
  const RT = randomUUID().replace(/-/g, "");
  const EXPIRES_AT = String(Math.floor(Date.now() / 1000) + 3600);
  const EXPIRES_IN = "3600";
  const TOK_TYPE = "bearer";
  const authJson = encodeURIComponent(
    JSON.stringify({
      access_token: AT,
      refresh_token: RT,
      expires_at: Number(EXPIRES_AT),
      expires_in: Number(EXPIRES_IN),
      token_type: TOK_TYPE,
      user: {
        id: PLATFORM_ADMIN_ID,
        email: `platformadmin@velora.example`,
        phone: "",
        role: "authenticated",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [{ id: PROFILE_ID, user_id: PLATFORM_ADMIN_ID, identity_data: {}, provider: "email", last_sign_in_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        email_confirmed_at: new Date().toISOString(),
      },
    })
  );
  return [
    `sb-${urlB64}-auth-token=${authJson}`,
    `sb-access-token=${encodeURIComponent(AT)}`,
    `sb-refresh-token=${encodeURIComponent(RT)}`,
    `sb-token-type=${encodeURIComponent(TOK_TYPE)}`,
    `sb-expires-at=${EXPIRES_AT}`,
    `sb-expires-in=${EXPIRES_IN}`,
  ].join("; ");
}

function p95(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * s.length) - 1;
  return s[Math.max(0, Math.min(s.length - 1, idx))];
}
function p50(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function min(arr) { return arr.length ? Math.min(...arr) : 0; }
function max(arr) { return arr.length ? Math.max(...arr) : 0; }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function report(label, arr) {
  console.log(`  ${label}: n=${arr.length} p50=${p50(arr).toFixed(1)}ms p95=${p95(arr).toFixed(1)}ms min=${min(arr).toFixed(1)}ms max=${max(arr).toFixed(1)}ms avg=${avg(arr).toFixed(1)}ms`);
}

async function section12Explain() {
  console.log("\n=== §12 EXPLAIN ANALYZE BUFFERS (3 query) ===");
  const pg = new PgClient(buildPgOpts());
  await pg.connect();
  const queries = [
    {
      name: "Q1 slug lookup tenants (detailed view)",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM public.tenants WHERE slug = 'velora-e2e-pub-barber-a'`,
    },
    {
      name: "Q2 admin list clients (100 rows, newest first)",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT t.id, t.name, t.slug, t.status, t.plan_id, t.created_at
            FROM public.tenants t ORDER BY t.created_at DESC LIMIT 100`,
    },
    {
      name: "Q3 search endpoint ILIKE name/slug",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT t.id, t.name, t.slug, t.status, t.plan_id, t.created_at
            FROM public.tenants t
            WHERE t.name ILIKE '%studio%' OR t.slug ILIKE '%aurora%'
            ORDER BY t.created_at DESC LIMIT 100`,
    },
  ];
  for (const q of queries) {
    console.log(`\n--- ${q.name} ---`);
    const r = await pg.query(q.sql);
    for (const row of r.rows) {
      const line = Object.values(row)[0];
      console.log("    " + line);
    }
  }
  await pg.end();
}

async function section10HttpBench(baseUrl) {
  console.log(`\n=== §10 List/Search HTTP ${baseUrl} (50 warm calls each) ==="`);
  const cookie = buildCookieJar();
  // warmup 5
  for (let i = 0; i < 5; i++) {
    await fetch(`${baseUrl}/app/admin/clients/search`, { headers: { cookie } }).then(r => r.text().catch(() => ""));
    await fetch(`${baseUrl}/app/admin/clients/search?q=studio`, { headers: { cookie } }).then(r => r.text().catch(() => ""));
  }
  const listTimes = [];
  const searchTimes = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    const r1 = await fetch(`${baseUrl}/app/admin/clients/search`, { headers: { cookie } });
    await r1.arrayBuffer();
    listTimes.push(performance.now() - t0);

    const t1 = performance.now();
    const r2 = await fetch(`${baseUrl}/app/admin/clients/search?q=studio`, { headers: { cookie } });
    await r2.arrayBuffer();
    searchTimes.push(performance.now() - t1);
  }
  report("LIST no-search", listTimes);
  report("SEARCH q=studio ", searchTimes);
  const p95list = p95(listTimes);
  const p95search = p95(searchTimes);
  console.log(`  >>> TARGET LIST p95<=100ms? ${p95list <= 100 ? "PASS" : "FAIL (" + p95list.toFixed(1) + "ms)"}`);
  console.log(`  >>> TARGET SEARCH p95<=100ms? ${p95search <= 100 ? "PASS" : "FAIL (" + p95search.toFixed(1) + "ms)"}`);
}

async function section11ProvisioningBench() {
  console.log("\n=== §11 Provisioning DB performance (20 calls) ===");
  const pg = new PgClient(buildPgOpts());
  await pg.connect();
  const times = [];
  const slugs = [];
  for (let i = 0; i < 20; i++) {
    const slug = `bench-p14c-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;
    slugs.push(slug);
    const t0 = performance.now();
    await pg.query("BEGIN");
    await pg.query("SET LOCAL ROLE authenticated");
    await pg.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [PLATFORM_ADMIN_ID]);
    await pg.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    try {
      await pg.query(
        `SELECT * FROM public.platform_provision_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          slug,
          `Bench Attivita ${i}`,
          `bench${i}@velora-bench.example`,
          `Bench Owner ${i}`,
          "+39 02000000" + String(i).padStart(2, "0"),
          `Bench Citta ${i}`,
          `Bench Indirizzo ${i}`,
          `RM`,
          "00100",
          "IT",
          "pro",
        ]
      );
      await pg.query("COMMIT");
    } catch (e) {
      try { await pg.query("ROLLBACK"); } catch {}
    }
    times.push(performance.now() - t0);
  }
  report("PROVISION (20 calls)", times);
  // cleanup
  for (const slug of slugs) {
    await pg.query(`DELETE FROM public.business_profiles WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug=$1)`, [slug]).catch(() => {});
    await pg.query(`DELETE FROM public.tenant_memberships WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug=$1)`, [slug]).catch(() => {});
    await pg.query(`DELETE FROM public.audit_logs WHERE entity_type='tenant' AND metadata::text ILIKE '%' || $1 || '%'`, [slug]).catch(() => {});
    await pg.query(`DELETE FROM public.tenants WHERE slug=$1`, [slug]).catch(() => {});
  }
  await pg.end();
}

async function main() {
  const args = process.argv.slice(2);
  const only = new Set(args.length ? args : ["12", "11"]);
  if (only.has("12")) await section12Explain();
  if (only.has("10") || only.has("http")) {
    const port = Number(process.env.PORT ?? 3200);
    const baseUrl = `http://127.0.0.1:${port}`;
    await section10HttpBench(baseUrl);
  }
  if (only.has("11")) await section11ProvisioningBench();
}
main().catch(err => { console.error("BENCH FAIL", err); process.exit(1); });
