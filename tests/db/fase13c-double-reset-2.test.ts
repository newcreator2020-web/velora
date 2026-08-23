// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local"]);
const DEFAULT_LOCAL: Readonly<Record<string, string>> = {
  SUPABASE_PROJECT_ID: "velora-local",
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};
function envOr(n: string): string {
  const v = process.env[n];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[n];
  return typeof fb === "string" ? fb : "";
}
function failIfUnsafe() {
  const host = envOr("SUPABASE_DB_HOST");
  const project = envOr("SUPABASE_PROJECT_ID");
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && (project.length === 0 || SAFE_PROJECT_IDS.has(project))) ||
    SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error("[double-reset] unsafe DB env abort");
    process.exit(1);
  }
}
failIfUnsafe();

function buildPgOpts() {
  return {
    host: envOr("SUPABASE_DB_HOST"),
    port: Number(envOr("SUPABASE_DB_PORT") || "54322"),
    database: envOr("SUPABASE_DB_NAME"),
    user: envOr("SUPABASE_DB_USER"),
    password: envOr("SUPABASE_DB_PASSWORD"),
  };
}

const SNAP_DIR = path.resolve(__dirname, "..", "..", ".temp-snap-f13c");
const SNAP_FILE = (i: number) => path.join(SNAP_DIR, `snap-reset-${i}.json`);

async function semanticSnapshot(c: PgClient) {
  const migration_versions = (
    await c.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")
  ).rows.map((r: Record<string, unknown>) => r["version"] as string);
  const tenants = (
    await c.query("SELECT slug, plan_id, published FROM public.tenants ORDER BY slug")
  ).rows.map((r: Record<string, unknown>) => ({
    slug: r["slug"] as string,
    plan_id: r["plan_id"] as string,
    published: r["published"] as boolean,
  }));
  const staff_resources = (
    await c.query(
      "SELECT slug, active, bookable, sort_order FROM public.staff_resources ORDER BY slug",
    )
  ).rows.map((r: Record<string, unknown>) => ({
    slug: r["slug"] as string,
    active: r["active"] as boolean,
    bookable: r["bookable"] as boolean,
    sort_order: r["sort_order"] as number,
  }));
  const qcount = async (t: string) =>
    (await c.query(`SELECT COUNT(*)::int AS n FROM public.${t}`)).rows[0]!.n as number;
  const audits = await c.query(
    "SELECT COUNT(*)::int AS n, array_agg(DISTINCT action ORDER BY action)::text[] AS action_set FROM public.audit_logs",
  );
  return {
    migration_versions,
    tenants,
    staff_resources,
    counts: {
      resource_availability: await qcount("resource_availability"),
      business_schedule_exceptions: await qcount("business_schedule_exceptions"),
      resource_time_off: await qcount("resource_time_off"),
      staff_resource_services: await qcount("staff_resource_services"),
      bookings: await qcount("bookings"),
      services: await qcount("services"),
      site_editorial_state: await qcount("site_editorial_state"),
      customers: await qcount("customers"),
      tenant_memberships: await qcount("tenant_memberships"),
      audit: audits.rows[0]!.n as number,
    },
    audit_action_set: (audits.rows[0]!.action_set as string[]) || [],
  };
}

let pg: PgClient | null = null;
const snapNum = Number(process.env["F13C_SNAP_NUM"] || "0") || 0;

describe("F13 Double reset determinism persistence (TEST-ONLY)", () => {
  beforeAll(async () => {
    if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
    pg = new PgClient(buildPgOpts());
    await pg.connect();
  }, 60_000);
  afterAll(async () => {
    if (pg) {
      await pg.end().catch(() => {});
      pg = null;
    }
  });
  it(`R9-2 capture/compare snap based on env F13C_SNAP_NUM=${snapNum}`, async () => {
    const snap = await semanticSnapshot(pg!);
    if (snapNum === 1) {
      writeFileSync(SNAP_FILE(1), JSON.stringify(snap, null, 2), "utf8");
      console.warn(
        `  [snap1-saved] migrations=${snap.migration_versions.length} tenants=${snap.tenants.length} audit=${snap.counts.audit}`,
      );
      return;
    }
    if (snapNum === 2) {
      if (!existsSync(SNAP_FILE(1))) {
        writeFileSync(SNAP_FILE(2), JSON.stringify(snap, null, 2), "utf8");
        console.warn("  [snap2-only] snap1 missing, saved snap2 for manual compare");
        return;
      }
      writeFileSync(SNAP_FILE(2), JSON.stringify(snap, null, 2), "utf8");
      const s1 = JSON.parse(readFileSync(SNAP_FILE(1), "utf8"));
      expect(s1.migration_versions).toStrictEqual(snap.migration_versions);
      expect(s1.tenants).toStrictEqual(snap.tenants);
      expect(s1.staff_resources).toStrictEqual(snap.staff_resources);
      expect(s1.counts).toStrictEqual(snap.counts);
      expect(s1.audit_action_set).toStrictEqual(snap.audit_action_set);
      console.warn(
        `  [snap1===snap2] OK migrations=${snap.migration_versions.length} reset1.counts=${JSON.stringify(s1.counts)} reset2.counts=${JSON.stringify(snap.counts)}`,
      );
      try {
        unlinkSync(SNAP_FILE(1));
        unlinkSync(SNAP_FILE(2));
      } catch (_e) {
        // ignored
      }
    } else {
      console.warn(`  [snap-fallback] F13C_SNAP_NUM unset, verify self-equality only`);
      const snapB = await semanticSnapshot(pg!);
      expect(snap).toStrictEqual(snapB);
    }
  });
});
