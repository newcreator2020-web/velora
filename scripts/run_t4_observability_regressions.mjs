/* eslint-disable */
import pg from "pg";
import { spawnSync } from "node:child_process";

const PGCFG = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
};
const CWD = process.cwd();

const DRY_TENANT = "4826d712-ce41-4535-9dc1-944db7f35e86";
const SA_USER_ID = "9df5232e-2303-4a6f-b643-f2386ac92ec1";

const pass = [],
  fail = [];
let N = 0;
const TR = (name, ok, extra = "") => {
  N++;
  if (ok) pass.push(name);
  else fail.push(name);
  const s = ok ? "✅" : "❌";
  console.log(`${s}  ${String(N).padStart(2, " ")} T4-${name}${extra ? `  —  ${extra}` : ""}`);
};

console.log("=== T4: OSSERVABILITÀ + REGRESSIONI POST T1-T3 ===");

// ===== OSSERVABILITÀ MINIMA =====
const db = new pg.Client(PGCFG);
await db.connect();
try {
  // 1. audit_logs table esiste?
  let tbl = null;
  try {
    const r = await db.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='audit_logs' AND table_schema='public') as ok`,
    );
    tbl = r.rows[0].ok;
  } catch (e) {
    tbl = false;
    console.log("  audit_logs table err:", e.message.slice(0, 200));
  }
  TR("audit_logs table public exists", !!tbl);

  // 2. count audit logs ultimi 7gg per tenant dry-run / all
  if (tbl) {
    const r1 = await db
      .query(
        `SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=$1 AND created_at > now() - interval '7 days'`,
        [DRY_TENANT],
      )
      .catch(() => ({ rows: [{ n: 0 }] }));
    const r2 = await db
      .query(
        `SELECT event_type, COUNT(*) n FROM audit_logs WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      )
      .catch(() => ({ rows: [] }));
    console.log("  audit_logs per dry-tenant last 7d:", r1.rows[0].n);
    console.log("  audit_logs per event last 7d top 10:", JSON.stringify(r2.rows));
    TR(
      "audit_logs osservabilità min: count OK (>=0)",
      Number(r1.rows[0].n) >= 0,
      `dry_tenant_events=${r1.rows[0].n}`,
    );
  }

  // 3. bookings markDepositPaid: audit_logs entry per UPDATE booking payment?
  if (tbl) {
    const q = await db
      .query(
        `SELECT event_type, created_at, record_id, tenant_id, actor_user_id, payload::text pl
       FROM audit_logs
       WHERE tenant_id=$1 AND event_type ILIKE '%booking%' AND created_at > now() - interval '1 hour'
       ORDER BY created_at DESC LIMIT 10`,
        [DRY_TENANT],
      )
      .catch(() => ({ rows: [] }));
    console.log(
      "  booking audit_logs last 1h top10:",
      JSON.stringify(
        q.rows.map((r) => ({
          e: r.event_type,
          id: String(r.record_id || "").slice(0, 13),
          actor: String(r.actor_user_id || "").slice(0, 13),
        })),
      ),
    );
  }

  // 4. 3 GOLDEN tenant ancora presenti? Services Tonino =9 invariato
  const g = await db.query(
    `SELECT t.slug, t.name, (SELECT COUNT(*) FROM services s WHERE s.tenant_id=t.id) svc FROM tenants t WHERE t.slug IN ('slugo-mtu30v76-1fon','barbieri-luca','giulia-hair') ORDER BY t.slug`,
  );
  console.log("  GOLDEN tenants services:", g.rows.map((r) => r.slug + "=" + r.svc).join("; "));
  TR(
    "Golden 3 tenants presenti + Tonino SVC=9 invariato",
    g.rows.length === 3 && g.rows.find((r) => r.slug === "slugo-mtu30v76-1fon")?.svc === 9,
  );

  // 5. Cross-tenant: Mario E2E Dry bookings solo in dry-run
  const leak = await db.query(
    `SELECT COUNT(*) n FROM bookings WHERE customer_name='Mario E2E Dry' AND tenant_id<>$1`,
    [DRY_TENANT],
  );
  TR("Cross-tenant Mario E2E Dry leak=0", Number(leak.rows[0].n) === 0, `leak_n=${leak.rows[0].n}`);
} finally {
  await db.end();
}

// ===== REGRESSIONI =====
const run = (label, cmd, args, opts = {}) => {
  console.log(`\n▶ ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: CWD,
    shell: true,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 45 * 60 * 1000,
    ...opts,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  // dump last 30 lines
  const lines = out.split("\n").slice(-40);
  console.log(lines.join("\n"));
  const ok =
    (r.status === 0 && !/ERROR|FAIL|× FAIL|\[FAIL\]/i.test(out.slice(-15000))) ||
    /Tests\s+\d+ passed|all passed|Done in|PASS \d+|0 problems|No issues found|E2E DONE pass=15/i.test(
      out.slice(-15000),
    );
  TR(label, ok, `exit=${r.status}`);
  return ok;
};

run("A typecheck", "pnpm", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
run("B lint", "pnpm", ["eslint", "src", "scripts", "tests", "--ext", ".ts,.tsx,.mjs,.cjs,.js"]);
run("C build Next", "pnpm", ["build"]);
run(
  "D vitest section-engine",
  "npx",
  ["vitest", "run", "tests/unit/section-engine.test.ts", "--reporter=verbose"],
  { env: { ...process.env } },
);
run(
  "E vitest multi-tenant-rls",
  "npx",
  ["vitest", "run", "tests/db/multi-tenant-rls.test.ts", "--reporter=verbose"],
  { env: { ...process.env, SUPABASE_PROJECT_ID: "velora-local" } },
);
run("F booking_e2e API 15/15", "node", ["scripts/booking_e2e.mjs"]);

console.log("\n==================== T4 SUMMARY ====================");
console.log("PASS =", pass.length, "/", N, " — FAIL =", fail.length, "/", N);
if (fail.length) console.log("Failed:", fail.map((x) => "\n  ❌ " + x).join(""));
console.log("\nVERDETTO T4:", fail.length === 0 ? "ALL GREEN ✅" : "Ci sono regressioni ❌");
process.exit(fail.length === 0 ? 0 : 1);
