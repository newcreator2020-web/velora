import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client as PgClient } from "pg";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const ART = resolve(ROOT, "artifacts");
mkdirSync(ART, { recursive: true });

const LOCAL_DEFAULTS = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};
const env = (n) => process.env[n] ?? LOCAL_DEFAULTS[n] ?? "";
const buildPgOpts = () => ({
  host: env("SUPABASE_DB_HOST"),
  port: Number(env("SUPABASE_DB_PORT") || 54322),
  database: env("SUPABASE_DB_NAME"),
  user: env("SUPABASE_DB_USER"),
  password: env("SUPABASE_DB_PASSWORD"),
});

const MINUTES = Number(
  process.argv.find((a, i, arr) => arr[i - 1] === "--duration") ?? process.env.DURATION_MIN ?? 10,
);
const INTERVAL_SEC = Number(process.env.SAMPLE_INTERVAL_SEC ?? 20);
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const CSV_PATH = resolve(ART, `db-sampler-${TS}.csv`);
const HEADER = [
  "ts_iso",
  "sample_idx",
  "pid",
  "pg_container_id",
  "pg_uptime_sec",
  "migration_count",
  "tenants_active_count",
  "dry_services_count",
  "tonino_services_count",
  "bookings_last_30m_count",
];
writeFileSync(CSV_PATH, HEADER.join(",") + "\n", { encoding: "utf8" });

function shell(cmd) {
  try {
    return String(
      execSync(cmd, { timeout: 8000, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }),
    ).trim();
  } catch {
    return "";
  }
}

function pgContainerShortId() {
  const raw = shell(`docker ps --format "{{.ID}} {{.Image}}"`);
  const line = raw.split(/\r?\n/).find((l) => /supabase[-_]db|postgres/i.test(l));
  return line ? line.split(/\s+/)[0].slice(0, 12) : "";
}

const TOTAL_SEC = Math.max(30, Math.round(MINUTES * 60));
const TOTAL_SAMPLES = Math.max(2, Math.round(TOTAL_SEC / INTERVAL_SEC));
const PID = process.pid;
console.warn(
  `[DB-SAMPLER] START duration=${MINUTES}m interval=${INTERVAL_SEC}s samples=${TOTAL_SAMPLES} csv=${CSV_PATH}`,
);

const pg = new PgClient(buildPgOpts());
await pg.connect();

for (let idx = 0; idx < TOTAL_SAMPLES; idx++) {
  const tsIso = new Date().toISOString();
  try {
    const [{ rows: r1 }, { rows: r2 }, { rows: r3 }, { rows: r4 }, { rows: r5 }, { rows: r6 }] =
      await Promise.all([
        pg.query(
          "SELECT extract(epoch from (now() - pg_postmaster_start_time()))::bigint AS uptime_sec",
        ),
        pg.query("SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations"),
        pg.query("SELECT count(*)::int AS n FROM public.tenants WHERE status='active'"),
        pg.query(
          "SELECT count(*)::int AS n FROM public.services WHERE tenant_id = (SELECT id::uuid FROM public.tenants WHERE slug LIKE 'dry-run%' ORDER BY created_at DESC LIMIT 1)",
        ),
        pg.query(
          "SELECT count(*)::int AS n FROM public.services WHERE tenant_id = (SELECT id::uuid FROM public.tenants WHERE slug LIKE 'slugo%' OR slug LIKE 'barbieri-ton%' OR slug LIKE 'tonino%' ORDER BY created_at DESC LIMIT 1)",
        ),
        pg.query(
          "SELECT count(*)::int AS n FROM public.bookings WHERE created_at > now() - interval '30 minutes'",
        ),
      ]);
    const row = [
      tsIso,
      String(idx),
      String(PID),
      `"${pgContainerShortId()}"`,
      String(r1[0]?.uptime_sec ?? ""),
      String(r2[0]?.n ?? 0),
      String(r3[0]?.n ?? 0),
      String(r4[0]?.n ?? 0),
      String(r5[0]?.n ?? 0),
      String(r6[0]?.n ?? 0),
    ];
    writeFileSync(CSV_PATH, row.join(",") + "\n", { encoding: "utf8", flag: "a" });
    process.stdout.write(
      `\r[SAMPLER ${idx + 1}/${TOTAL_SAMPLES}] ts=${tsIso.slice(11, 19)} tenants=${r3[0]?.n ?? 0} drySvc=${r4[0]?.n ?? 0} toninoSvc=${r5[0]?.n ?? 0} pgUp=${r1[0]?.uptime_sec ?? 0}s bookings30m=${r6[0]?.n ?? 0}`,
    );
  } catch (err) {
    const row = [tsIso, String(idx), String(PID), "", "", "", "", "", "", ""];
    writeFileSync(CSV_PATH, row.join(",") + "\n", { encoding: "utf8", flag: "a" });
    process.stdout.write(
      `\r[SAMPLER ${idx + 1}/${TOTAL_SAMPLES}] ERR: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`,
    );
  }
  if (idx + 1 < TOTAL_SAMPLES) {
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}
process.stdout.write("\n");
await pg.end();
console.warn(`[DB-SAMPLER] END. CSV=${CSV_PATH}`);
