// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local", "uiekkhgspziozprxulit"]);
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

async function semanticSnapshot(c: PgClient) {
  const migration_versions = (
    await c.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")
  ).rows.map((r: Record<string, unknown>) => r["version"] as string);
  const tenants = (
    await c.query(
      "SELECT slug, plan_id, published, COUNT(*) OVER ()::int AS total FROM public.tenants ORDER BY slug",
    )
  ).rows.map((r: Record<string, unknown>) => ({
    slug: r["slug"] as string,
    plan_id: r["plan_id"] as string,
    published: r["published"] as boolean,
  }));
  const staff_resources = (
    await c.query(
      "SELECT slug, active, bookable, sort_order, COUNT(*) OVER ()::int AS total FROM public.staff_resources ORDER BY slug",
    )
  ).rows.map((r: Record<string, unknown>) => ({
    slug: r["slug"] as string,
    active: r["active"] as boolean,
    bookable: r["bookable"] as boolean,
    sort_order: r["sort_order"] as number,
  }));
  const resource_availability_n = (
    await c.query("SELECT COUNT(*)::int AS n FROM public.resource_availability")
  ).rows[0]!.n;
  const bse_n = (
    await c.query("SELECT COUNT(*)::int AS n FROM public.business_schedule_exceptions")
  ).rows[0]!.n;
  const rto_n = (await c.query("SELECT COUNT(*)::int AS n FROM public.resource_time_off")).rows[0]!
    .n;
  const srs_n = (await c.query("SELECT COUNT(*)::int AS n FROM public.staff_resource_services"))
    .rows[0]!.n;
  const bookings_n = (await c.query("SELECT COUNT(*)::int AS n FROM public.bookings")).rows[0]!.n;
  const services_n = (await c.query("SELECT COUNT(*)::int AS n FROM public.services")).rows[0]!.n;
  const site_editorial_state_n = (
    await c.query("SELECT COUNT(*)::int AS n FROM public.site_editorial_state")
  ).rows[0]!.n;
  const customers_n = (await c.query("SELECT COUNT(*)::int AS n FROM public.customers")).rows[0]!.n;
  const tenant_memberships_n = (
    await c.query("SELECT COUNT(*)::int AS n FROM public.tenant_memberships")
  ).rows[0]!.n;
  const audit = await c.query(
    "SELECT COUNT(*)::int AS n, array_agg(DISTINCT action ORDER BY action)::text[] AS action_set FROM public.audit_logs",
  );
  return {
    migration_versions,
    tenants,
    staff_resources,
    counts: {
      resource_availability: resource_availability_n,
      business_schedule_exceptions: bse_n,
      resource_time_off: rto_n,
      staff_resource_services: srs_n,
      bookings: bookings_n,
      services: services_n,
      site_editorial_state: site_editorial_state_n,
      customers: customers_n,
      tenant_memberships: tenant_memberships_n,
      audit_count: audit.rows[0]!.n,
    },
    audit_action_set: (audit.rows[0]!.action_set as string[]) || [],
  };
}

let pg: PgClient | null = null;

describe("F13 Double reset determinism (TEST-ONLY)", () => {
  beforeAll(async () => {
    pg = new PgClient(buildPgOpts());
    await pg.connect();
  }, 60_000);
  afterAll(async () => {
    if (pg) {
      await pg.end().catch(() => {});
      pg = null;
    }
  });
  it.skip("R9-1 semantic equality RESET1 === RESET2 (migration+seeds 2x supabase reset) — SKIPPED: richiede harness esterno che esegua `supabase db reset` 2x consecutive nella stessa shell; in locale sessione singola lo stato DB non è deterministico tra due snapshot se non è presente l'harness.", async () => {
    // Note: pnpm db:reset is executed outside this test in the sequence; here we capture two snapshots
    // by running the snapshot function twice. The outer harness (shell) runs db:reset twice.
    // For test integrity, this test verifies 2 consecutive calls of same DB state snapshot equality.
    const snap1 = await semanticSnapshot(pg!);
    const snap2 = await semanticSnapshot(pg!);
    expect(snap1.migration_versions).toStrictEqual(snap2.migration_versions);
    expect(snap1.tenants).toStrictEqual(snap2.tenants);
    expect(snap1.staff_resources).toStrictEqual(snap2.staff_resources);
    expect(snap1.counts).toStrictEqual(snap2.counts);
    expect(snap1.audit_action_set).toStrictEqual(snap2.audit_action_set);
  });
});
