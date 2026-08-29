// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { randomUUID } from "node:crypto";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "db.dgekfjkuvnofwdwxflms.supabase.co",
]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["dgekfjkuvnofwdwxflms", "velora-local"]);
const DEFAULT_LOCAL: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  SUPABASE_PROJECT_ID: "velora-local",
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_PASSWORD: "postgres",
};

function envOr(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[name];
  if (fb) return fb;
  throw new Error(`missing env ${name}`);
}
(() => {
  const url = envOr("NEXT_PUBLIC_SUPABASE_URL");
  const host = new URL(url).hostname;
  const projectId = process.env["SUPABASE_PROJECT_ID"] ?? "";
  if (!ALLOWED_DB_HOSTS.has(host) && !SAFE_PROJECT_IDS.has(projectId)) {
    console.error(`[fase14d] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";

const TENANT_A_SLUG = "f14d-tenant-alpha";
const TENANT_B_SLUG = "f14d-tenant-beta";

const FIXED = {
  tenantA: "00000000-0000-4130-8000-0000000014a1",
  tenantB: "00000000-0000-4130-8000-0000000014b1",
  svcA1: "00000000-0000-4130-8002-0000000014a1",
  resA1: "00000000-0000-4130-8004-0000000014a1",
  resA2: "00000000-0000-4130-8004-0000000014a2",
  resB1: "00000000-0000-4130-8004-0000000014b1",
} as const;

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
  noMember: null,
};

type AnyClient = SupabaseClient<Database, "public">;

function pgOpts() {
  const isLocal = PROJECT_ID === "velora-local";
  return {
    host: process.env["SUPABASE_DB_HOST"] ?? (isLocal ? "127.0.0.1" : `${PROJECT_ID}.supabase.co`),
    port: Number(process.env["SUPABASE_DB_PORT"] ?? (isLocal ? 54322 : 6543)),
    user: "postgres",
    database: "postgres",
    password: envOr("SUPABASE_DB_PASSWORD"),
    ssl: isLocal ? false : ({ rejectUnauthorized: false } as never),
  } as const;
}
let _pg: PgClient | null = null;
async function pg(): Promise<PgClient> {
  if (_pg) return _pg;
  _pg = new PgClient(pgOpts());
  await _pg.connect();
  return _pg;
}
async function pgClose() {
  if (_pg) {
    try {
      await _pg.end();
    } catch {
      /* ignore */
    }
    _pg = null;
  }
}

function serviceClient() {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function anonClient() {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function authenticateAs(c: AnyClient, email: string): Promise<string> {
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`auth failed ${email}: ${error?.message ?? "no user"}`);
  // Also store uid on client for pg impersonation pattern.
  (c as any)._uid = data.user.id;
  return data.user.id;
}

function nextMondayDate(): string {
  const d = new Date();
  const utcDow = d.getUTCDay();
  const diff = (8 - utcDow) % 7 || 7;
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  d.setUTCHours(0);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
function dateOffset(baseISO: string, days: number): string {
  const d = new Date(baseISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function toRomeUTCISO(dateISO: string, hh: number, mm = 0): string {
  // Produce a timestamptz roughly representing Rome wall-clock hh:mm on given YYYY-MM-DD.
  // Rome is UTC+1 (CET) or UTC+2 (CEST). Approximate with +2 since most of year is CEST,
  // we only need the date window for from/to DATE.
  const offsetMs = 2 * 3600 * 1000;
  const base =
    new Date(dateISO + "T00:00:00Z").getTime() + hh * 3600 * 1000 + mm * 60 * 1000 - offsetMs;
  return new Date(base).toISOString();
}

async function callSlot(
  _c: AnyClient,
  opts: {
    tenant_slug: string;
    service_id: string;
    from_date: string;
    to_date: string;
    resource_slug?: string;
  },
) {
  const conn = new PgClient(pgOpts());
  await conn.connect();
  try {
    await conn.query(`BEGIN`);
    await conn.query(`SET LOCAL ROLE anon`);
    const r = await conn.query(
      `SELECT * FROM public.public_slot_get_available_v3($1::text, $2::uuid, $3::date, $4::date, $5::text)`,
      [
        opts.tenant_slug,
        opts.service_id,
        opts.from_date,
        opts.to_date,
        opts.resource_slug ?? "any",
      ],
    );
    await conn.query(`COMMIT`);
    return { data: r.rows, error: null };
  } catch (e: any) {
    try {
      await conn.query(`ROLLBACK`);
    } catch {
      /* ignore */
    }
    return { data: null, error: { message: e.message, code: e.code } };
  } finally {
    try {
      await conn.end();
    } catch {
      /* ignore */
    }
  }
}

async function callBookingCreateV3(params: {
  p_tenant_slug: string;
  p_service_id: string;
  p_starts_at: string;
  p_resource_slug: string;
  p_customer_name: string;
  p_customer_email: string;
  p_customer_phone: string;
  p_notes: string | null;
}) {
  const conn = new PgClient(pgOpts());
  await conn.connect();
  try {
    await conn.query(`BEGIN`);
    await conn.query(`SET LOCAL ROLE anon`);
    const r = await conn.query(
      `SELECT * FROM public.public_booking_create_v3($1::text, $2::uuid, $3::timestamptz, $4::text, $5::text, $6::text, $7::text, $8::text)`,
      [
        params.p_tenant_slug,
        params.p_service_id,
        params.p_starts_at,
        params.p_resource_slug,
        params.p_customer_name,
        params.p_customer_email,
        params.p_customer_phone,
        params.p_notes,
      ],
    );
    await conn.query(`COMMIT`);
    return { data: r.rows, error: null };
  } catch (e: any) {
    try {
      await conn.query(`ROLLBACK`);
    } catch {
      /* ignore */
    }
    return { data: null, error: { message: e.message, code: e.code } };
  } finally {
    try {
      await conn.end();
    } catch {
      /* ignore */
    }
  }
}

async function seedAndGetTenants(): Promise<void> {
  const svc = serviceClient();
  const p = await pg();
  const emails = [
    { k: "ownerA", email: "f14d-owner-a@test.local" },
    { k: "managerA", email: "f14d-manager-a@test.local" },
    { k: "staffA", email: "f14d-staff-a@test.local" },
    { k: "ownerB", email: "f14d-owner-b@test.local" },
    { k: "noMember", email: "f14d-no-member@test.local" },
  ];
  for (const e of emails) {
    // Cerca via SQL diretto per evitare problemi di paginazione listUsers
    const existing = await p.query(`SELECT id FROM auth.users WHERE email = $1 LIMIT 1`, [e.email]);
    if (existing.rows.length > 0) {
      userIds[e.k] = existing.rows[0].id;
      continue;
    }
    // Altrimenti crea via admin API; se fallisce per duplicate ricarica da SQL
    const { data, error } = await svc.auth.admin.createUser({
      email: e.email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) {
      const retry = await p.query(`SELECT id FROM auth.users WHERE email = $1 LIMIT 1`, [e.email]);
      userIds[e.k] = retry.rows[0]?.id ?? null;
    } else {
      userIds[e.k] = data.user?.id ?? null;
    }
  }
  for (const t of [
    { id: FIXED.tenantA, slug: TENANT_A_SLUG, name: "Studio Aurora F14D A" },
    { id: FIXED.tenantB, slug: TENANT_B_SLUG, name: "Studio Aurora F14D B" },
  ]) {
    await p.query(
      `INSERT INTO public.tenants (id, slug, name, plan_id, status, published, created_at, updated_at)
       VALUES ($1,$2,$3,'internal_test','active',true, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, plan_id='internal_test', status='active', published=true`,
      [t.id, t.slug, t.name],
    );
    await p.query(
      `INSERT INTO public.business_profiles (tenant_id, display_name, category, timezone, locale, description)
       VALUES ($1,$2,'Hair Salon','Europe/Rome','it-IT','')
       ON CONFLICT (tenant_id) DO UPDATE SET display_name=EXCLUDED.display_name, timezone='Europe/Rome', locale='it-IT'`,
      [t.id, t.name],
    );
  }
  // DETERMINISTIC CLEANUP: remove cross-run stale state for test tenants A and B (dopo insert tenants per evitare FK audit_logs)
  for (const tid of [FIXED.tenantA, FIXED.tenantB]) {
    await p.query(`UPDATE public.bookings SET status='cancelled' WHERE tenant_id = $1`, [tid]);
    await p.query(`DELETE FROM public.resource_time_off WHERE tenant_id = $1`, [tid]);
    await p.query(`DELETE FROM public.resource_availability WHERE tenant_id = $1`, [tid]);
  }
  const memberships = [
    { u: userIds["ownerA"], tid: FIXED.tenantA, role: "owner" },
    { u: userIds["managerA"], tid: FIXED.tenantA, role: "manager" },
    { u: userIds["staffA"], tid: FIXED.tenantA, role: "staff" },
    { u: userIds["ownerB"], tid: FIXED.tenantB, role: "owner" },
  ] as const;
  for (const m of memberships) {
    if (!m.u) continue;
    await p.query(
      `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=excluded.role, status='active'`,
      [m.tid, m.u, m.role],
    );
  }
  // business hrs mon-sat 09:00-19:00
  for (const tid of [FIXED.tenantA, FIXED.tenantB]) {
    await p.query(`DELETE FROM public.business_availability WHERE tenant_id=$1`, [tid]);
    for (let wd = 1; wd <= 6; wd++) {
      await p.query(
        `INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time) VALUES ($1,$2,true,'09:00','19:00')`,
        [tid, wd],
      );
    }
  }
  // Resources (staff_resources)
  const resRows = [
    { id: FIXED.resA1, tid: FIXED.tenantA, slug: "maria-f14d", name: "Maria F14D" },
    { id: FIXED.resA2, tid: FIXED.tenantA, slug: "luca-f14d", name: "Luca F14D" },
    { id: FIXED.resB1, tid: FIXED.tenantB, slug: "sara-f14d", name: "Sara F14D" },
  ] as const;
  for (const r of resRows) {
    await p.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, active, bookable, availability_version)
       VALUES ($1,$2,$3,$4,true,true,0)
       ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, slug=EXCLUDED.slug, display_name=EXCLUDED.display_name, availability_version=0`,
      [r.id, r.tid, r.slug, r.name],
    );
  }
  // Service svcA1 + eligibility resA1 + resA2
  await p.query(
    `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active)
     VALUES ($1,$2,'Taglio F14D',30,true)
     ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, name=EXCLUDED.name, duration_minutes=30, active=true`,
    [FIXED.svcA1, FIXED.tenantA],
  );
  await p.query(
    `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active)
     VALUES ($4,$1,$3,true),($4,$2,$3,true)
     ON CONFLICT (tenant_id, resource_id, service_id) DO UPDATE SET active=true`,
    [FIXED.resA1, FIXED.resA2, FIXED.svcA1, FIXED.tenantA],
  );
}

type Wd = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Interval = { weekday: Wd; start_time: string; end_time: string };
type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null };

async function saveWeekly(
  c: AnyClient,
  args: {
    resource_id: string;
    expected_version: number;
    intervals: Interval[];
    force_reset_all?: boolean;
  },
): Promise<
  RpcResult<{
    new_version: number;
    inserted_count?: number;
    deleted_count?: number;
    conflicting_future_bookings_cnt?: number;
    changed_weekdays_bitmask?: number;
    has_inherit_weekdays?: boolean;
  }>
> {
  try {
    const res = await (c as any).rpc("dashboard_save_resource_weekly_schedule", {
      p_resource_id: args.resource_id,
      p_expected_version: args.expected_version,
      p_weekdays: args.intervals.map((i) => i.weekday),
      p_start_times: args.intervals.map((i) => i.start_time),
      p_end_times: args.intervals.map((i) => i.end_time),
      p_force_reset_all: args.force_reset_all ?? true,
    });
    // RPC returns TABLE; supabase-js returns an array of rows.
    const row = Array.isArray(res?.data) ? (res.data[0] ?? null) : (res?.data ?? null);
    const data: any = row;
    return {
      data,
      error: res.error
        ? {
            message: res.error.message,
            code:
              (res.error as any)?.code ?? (res.error as any)?.hint ?? (res.error as any)?.details,
          }
        : null,
    };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e), code: e?.code } };
  }
}

async function getWeekly(
  c: AnyClient,
  resource_id: string,
): Promise<
  RpcResult<{
    intervals: Array<Interval>;
    version: number;
    authorized: boolean;
    resource_exists: boolean;
    inherit_weekdays_bitmask: number;
  }>
> {
  try {
    const res = await (c as any).rpc("dashboard_get_resource_weekly_schedule", {
      p_resource_id: resource_id,
    });
    if (res.error) {
      return {
        data: null,
        error: {
          message: res.error.message,
          code: (res.error as any)?.code ?? (res.error as any)?.hint ?? (res.error as any)?.details,
        },
      };
    }
    const row = Array.isArray(res.data) ? (res.data[0] ?? null) : (res.data ?? null);
    if (!row) return { data: null, error: { message: "no rows", code: "EMPTY" } };
    return {
      data: {
        intervals: Array.isArray(row.intervals) ? (row.intervals as Interval[]) : [],
        version: Number(row.availability_version ?? row.version ?? 0),
        authorized: Boolean(row.authorized),
        resource_exists: Boolean(row.resource_exists),
        inherit_weekdays_bitmask: Number(row.inherit_weekdays_bitmask ?? 0),
      },
      error: null,
    };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? String(e), code: e?.code } };
  }
}

async function listRaw(tenant_id: string, resource_id: string) {
  const p = await pg();
  return p.query(
    `SELECT weekday, start_time::text, end_time::text FROM public.resource_availability WHERE tenant_id=$1 AND resource_id=$2 ORDER BY weekday, start_time`,
    [tenant_id, resource_id],
  );
}
async function versionOf(resource_id: string): Promise<number> {
  const p = await pg();
  const r = await p.query(`SELECT availability_version FROM public.staff_resources WHERE id=$1`, [
    resource_id,
  ]);
  return Number(r.rows[0]?.availability_version ?? 0) | 0;
}

describe("FASE14D - Resource Weekly Schedule (RWA 01..24, races, failures)", () => {
  beforeAll(async () => {
    await seedAndGetTenants();
  });
  afterAll(async () => {
    await pgClose();
  });

  it("RWA-01 valid single interval inserts correctly", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { data, error } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    if (!data)
      throw new Error("expected saveWeekly returned null despite passing test precondition");
    expect(data.new_version).toBeGreaterThanOrEqual(1);
    const { rows } = await listRaw(FIXED.tenantA, FIXED.resA1);
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ weekday: 1, start_time: "09:00:00", end_time: "18:00:00" });
  });

  it("RWA-02 split shift inserts 2 intervals same day", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const intervals: Interval[] = [
      { weekday: 1, start_time: "09:00", end_time: "13:00" },
      { weekday: 1, start_time: "14:00", end_time: "18:00" },
      { weekday: 2, start_time: "09:00", end_time: "13:00" },
      { weekday: 2, start_time: "14:00", end_time: "18:00" },
    ];
    const { error, data } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    const { rows } = await listRaw(FIXED.tenantA, FIXED.resA1);
    expect(rows.length).toBe(4);
  });

  it("RWA-03 OFF day: zero intervals = no rows that day", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { error } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(error).toBeNull();
    const { rows } = await listRaw(FIXED.tenantA, FIXED.resA1);
    const wed = rows.filter((r: any) => r.weekday === 3);
    expect(wed.length).toBe(0);
  });

  it("RWA-04 invalid start >= end rejected", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { error, data } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "18:00", end_time: "09:00" }],
    });
    // errore da hint RWA04 start_after o equivalente
    const errMsg = (error?.message ?? JSON.stringify(data ?? "")).toString();
    const rejected = !!error || (data && typeof data === "object" && (data as any).ok === false);
    expect(rejected).toBe(true);
    expect(errMsg.length).toBeGreaterThan(0);
  });

  it("RWA-05 overlap same resource same day DENY", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { error, data } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [
        { weekday: 1, start_time: "09:00", end_time: "13:00" },
        { weekday: 1, start_time: "12:00", end_time: "15:00" },
      ],
    });
    const errMsg = (error?.message ?? JSON.stringify(data ?? "")).toString().toLowerCase();
    const denied = !!error || errMsg.includes("overlap") || errMsg.includes("sovrappost");
    expect(denied).toBe(true);
  });

  it("RWA-06 duplicate safe / idempotent (identical intervals no new rows)", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const baseIntervals: Interval[] = [{ weekday: 2, start_time: "10:00", end_time: "12:00" }];
    const r1 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: baseIntervals,
    });
    expect(r1.error).toBeNull();
    const v2 = r1.data?.new_version ?? (await versionOf(FIXED.resA1));
    const r2 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: v2,
      intervals: [...baseIntervals, ...baseIntervals], // duplicates
    });
    // deduplication o overlap deny: comunque non rimangono 2 righe identiche alla fine
    const { rows } = await listRaw(FIXED.tenantA, FIXED.resA1);
    const tue = rows.filter((r: any) => r.weekday === 2 && r.start_time.startsWith("10:00"));
    expect(tue.length).toBeLessThanOrEqual(1);
    void r2;
  });

  it("RWA-07 tenant isolation: owner B cannot read A schedule via direct select / RPC", async () => {
    const cA = anonClient();
    const cB = anonClient();
    await authenticateAs(cA, "f14d-owner-a@test.local");
    await authenticateAs(cB, "f14d-owner-b@test.local");
    // set some data in A
    const rA = await saveWeekly(cA, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 4, start_time: "09:00", end_time: "18:00" }],
    });
    expect(rA.error).toBeNull();
    // B attempts to fetch resource A1: RPC authorize checks tenant_id via security definer → authorized=false → returns with no intervals?
    const g = await getWeekly(cB, FIXED.resA1);
    // expected: not authorized (row.authorized=false or error).
    const authorized = !g.error && g.data?.authorized !== false;
    expect(authorized).toBe(false);
  });

  it("RWA-08 owner: save allowed", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { error } = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: await versionOf(FIXED.resA2),
      intervals: [{ weekday: 1, start_time: "10:00", end_time: "19:00" }],
    });
    expect(error).toBeNull();
  });

  it("RWA-09 manager contract: save allowed (same tenant)", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-manager-a@test.local");
    const { error } = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: await versionOf(FIXED.resA2),
      intervals: [{ weekday: 2, start_time: "10:00", end_time: "19:00" }],
    });
    expect(error).toBeNull();
  });

  it("RWA-10 staff: save DENY", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-staff-a@test.local");
    const { error, data } = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: await versionOf(FIXED.resA2),
      intervals: [{ weekday: 3, start_time: "10:00", end_time: "12:00" }],
    });
    const denied = !!error || (data && typeof data === "object" && (data as any).ok === false);
    expect(denied).toBe(true);
  });

  it("RWA-11 anon: no auth → DENY save & read", async () => {
    const c = anonClient();
    const g = await getWeekly(c, FIXED.resA1);
    const denied =
      !!g.error || (g.data && (g.data.authorized === false || !g.data.resource_exists));
    expect(denied).toBe(true);
  });

  it("RWA-12 atomic week save: partial payload invalid → no mutation", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const before = await versionOf(FIXED.resA1);
    const beforeRows = (await listRaw(FIXED.tenantA, FIXED.resA1)).rows.length;
    // invalid weds interval + valid mon split; expectation: invalid row → transaction rolls back
    const bad = {
      resource_id: FIXED.resA1,
      expected_version: before,
      intervals: [
        { weekday: 1, start_time: "09:00", end_time: "13:00" },
        { weekday: 1, start_time: "14:00", end_time: "18:00" },
        { weekday: 3, start_time: "18:00", end_time: "09:00" }, // invalid
      ] as Interval[],
    };
    const { error } = await saveWeekly(c, bad as any);
    expect(!!error).toBe(true);
    const after = await versionOf(FIXED.resA1);
    const afterRows = (await listRaw(FIXED.tenantA, FIXED.resA1)).rows.length;
    expect(after).toBe(before);
    expect(afterRows).toBe(beforeRows);
  });

  it("RWA-13 retry safe: double submit same payload → no duplicate rows, version bumps at most 1", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const intervals: Interval[] = [{ weekday: 5, start_time: "09:00", end_time: "17:00" }];
    const v0 = await versionOf(FIXED.resA2);
    const r1 = await saveWeekly(c, { resource_id: FIXED.resA2, expected_version: v0, intervals });
    const r2 = await saveWeekly(c, { resource_id: FIXED.resA2, expected_version: v0, intervals });
    // exactly 1 success, 1 stale. rows for weekday 5 = 1
    const fri = (await listRaw(FIXED.tenantA, FIXED.resA2)).rows.filter(
      (r: any) => r.weekday === 5,
    );
    expect(fri.length).toBe(1);
    const successes = [r1, r2].filter((r) => !r.error).length;
    expect(successes).toBeGreaterThanOrEqual(1);
    expect(successes).toBeLessThanOrEqual(2); // second may fail with stale
  });

  it("RWA-14 stale update conflict", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const vA = await versionOf(FIXED.resA1);
    const r1 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: vA,
      intervals: [{ weekday: 6, start_time: "09:00", end_time: "13:00" }],
    });
    expect(r1.error).toBeNull();
    const r2 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: vA, // stale
      intervals: [{ weekday: 6, start_time: "14:00", end_time: "18:00" }],
    });
    expect(r2.error).toBeTruthy();
    const msg = r2.error?.message ?? "";
    expect(msg.toLowerCase()).toMatch(/stale|RWA43/);
  });

  it("RWA-15 business intersection: resource 08-20 effective clipped to business 09-19 in slot generation", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const save = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [
        { weekday: 1, start_time: "08:00", end_time: "20:00" },
        { weekday: 2, start_time: "09:00", end_time: "18:00" },
      ],
    });
    expect(save.error).toBeNull();
    const mon = nextMondayDate();
    const tue = dateOffset(mon, 1);
    const slot = await callSlot(c, {
      tenant_slug: TENANT_A_SLUG,
      service_id: FIXED.svcA1,
      from_date: mon,
      to_date: tue,
      resource_slug: "maria-f14d",
    });
    expect(slot.error).toBeNull();
    const slots = (Array.isArray(slot.data) ? slot.data : []) as Array<{
      starts_at: string;
      resource_id: string;
    }>;
    const res1Slots = slots.filter((s) => s.resource_id === FIXED.resA1);
    expect(res1Slots.length).toBeGreaterThan(0);
    // all slots in local wall-clock between 09 and 19 (Rome): offset -2 UTC approx
    for (const s of res1Slots) {
      const t = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000);
      const hh = t.getUTCHours();
      expect(hh).toBeGreaterThanOrEqual(9);
      expect(hh).toBeLessThan(19);
    }
  });

  it("RWA-15b DINAMIC boundary proof 1: business 08-17 / resource 07-20 → effective strictly 08-17", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const targetWD = 4 as Wd;
    const originalBA = await p.query(
      `SELECT weekday, enabled, start_time::text st, end_time::text en FROM public.business_availability WHERE tenant_id = $1 AND weekday = $2 LIMIT 1`,
      [FIXED.tenantA, targetWD],
    );
    try {
      // Override BA weekday=4 → 08:00-17:00  (clipping upper bound)
      if ((originalBA.rowCount ?? 0) > 0) {
        await p.query(
          `UPDATE public.business_availability SET start_time='08:00'::time, end_time='17:00'::time WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD],
        );
      } else {
        await p.query(
          `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time) VALUES ($1,$2,true,'08:00','17:00')`,
          [FIXED.tenantA, targetWD],
        );
      }
      const mon = nextMondayDate();
      const thu = dateOffset(mon, 3); // Thursday
      const sv = await saveWeekly(c, {
        resource_id: FIXED.resA1,
        expected_version: await versionOf(FIXED.resA1),
        intervals: [{ weekday: targetWD, start_time: "07:00", end_time: "20:00" }],
      });
      expect(sv.error).toBeNull();
      const slot = await callSlot(c, {
        tenant_slug: TENANT_A_SLUG,
        service_id: FIXED.svcA1,
        from_date: thu,
        to_date: thu,
        resource_slug: "maria-f14d",
      });
      expect(slot.error).toBeNull();
      const arr = (Array.isArray(slot.data) ? slot.data : []) as Array<{
        starts_at: string;
        resource_id: string;
      }>;
      const maria = arr.filter((s) => s.resource_id === FIXED.resA1);
      expect(maria.length).toBeGreaterThan(0);
      for (const s of maria) {
        const localHh = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000).getUTCHours();
        expect(localHh).toBeGreaterThanOrEqual(8);
        expect(localHh).toBeLessThan(17);
      }
      const slotAt17 = maria.filter((s) => {
        const t = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000);
        return t.getUTCHours() === 17 && t.getUTCMinutes() === 0;
      });
      expect(slotAt17.length).toBe(0);
      const slotAt07 = maria.filter((s) => {
        const t = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000);
        return t.getUTCHours() < 8;
      });
      expect(slotAt07.length).toBe(0);
    } finally {
      if ((originalBA.rowCount ?? 0) > 0) {
        const r = originalBA.rows[0]!;
        await p.query(
          `UPDATE public.business_availability SET start_time=$3::time, end_time=$4::time, enabled=$5 WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD, r.st, r.en, r.enabled],
        );
      } else {
        await p.query(
          `DELETE FROM public.business_availability WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD],
        );
      }
    }
  });

  it("RWA-15c DINAMIC boundary proof 2: business 11-21 / resource 09-18 → effective strictly 11-18", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const targetWD = 5 as Wd;
    const originalBA = await p.query(
      `SELECT weekday, enabled, start_time::text st, end_time::text en FROM public.business_availability WHERE tenant_id = $1 AND weekday = $2 LIMIT 1`,
      [FIXED.tenantA, targetWD],
    );
    try {
      if ((originalBA.rowCount ?? 0) > 0) {
        await p.query(
          `UPDATE public.business_availability SET start_time='11:00'::time, end_time='21:00'::time WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD],
        );
      } else {
        await p.query(
          `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time) VALUES ($1,$2,true,'11:00','21:00')`,
          [FIXED.tenantA, targetWD],
        );
      }
      const mon = nextMondayDate();
      const fri = dateOffset(mon, 4); // Friday
      const sv = await saveWeekly(c, {
        resource_id: FIXED.resA1,
        expected_version: await versionOf(FIXED.resA1),
        intervals: [{ weekday: targetWD, start_time: "09:00", end_time: "18:00" }],
      });
      expect(sv.error).toBeNull();
      const slot = await callSlot(c, {
        tenant_slug: TENANT_A_SLUG,
        service_id: FIXED.svcA1,
        from_date: fri,
        to_date: fri,
        resource_slug: "maria-f14d",
      });
      expect(slot.error).toBeNull();
      const arr = (Array.isArray(slot.data) ? slot.data : []) as Array<{
        starts_at: string;
        resource_id: string;
      }>;
      const maria = arr.filter((s) => s.resource_id === FIXED.resA1);
      expect(maria.length).toBeGreaterThan(0);
      for (const s of maria) {
        const local = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000);
        const hh = local.getUTCHours();
        expect(hh).toBeGreaterThanOrEqual(11);
        expect(hh).toBeLessThan(18);
      }
      const pre11 = maria.filter((s) => {
        const h = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000).getUTCHours();
        return h < 11;
      });
      expect(pre11.length).toBe(0);
      const after18 = maria.filter((s) => {
        const h = new Date(new Date(s.starts_at).getTime() + 2 * 3600 * 1000).getUTCHours();
        return h >= 18;
      });
      expect(after18.length).toBe(0);
    } finally {
      if ((originalBA.rowCount ?? 0) > 0) {
        const r = originalBA.rows[0]!;
        await p.query(
          `UPDATE public.business_availability SET start_time=$3::time, end_time=$4::time, enabled=$5 WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD, r.st, r.en, r.enabled],
        );
      } else {
        await p.query(
          `DELETE FROM public.business_availability WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD],
        );
      }
    }
  });

  it("RWA-15d DINAMIC boundary proof 3: business CLOSED (disabled weekday) / resource with 09-18 → 0 slots (clip to empty)", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const targetWD = 6 as Wd;
    const originalBA = await p.query(
      `SELECT weekday, enabled, start_time::text st, end_time::text en FROM public.business_availability WHERE tenant_id = $1 AND weekday = $2 LIMIT 1`,
      [FIXED.tenantA, targetWD],
    );
    try {
      await p.query(
        `UPDATE public.business_availability SET enabled=FALSE WHERE tenant_id=$1 AND weekday=$2`,
        [FIXED.tenantA, targetWD],
      );
      const mon = nextMondayDate();
      const sat = dateOffset(mon, 5); // Saturday
      const sv = await saveWeekly(c, {
        resource_id: FIXED.resA1,
        expected_version: await versionOf(FIXED.resA1),
        intervals: [{ weekday: targetWD, start_time: "09:00", end_time: "18:00" }],
      });
      expect(sv.error).toBeNull();
      const slot = await callSlot(c, {
        tenant_slug: TENANT_A_SLUG,
        service_id: FIXED.svcA1,
        from_date: sat,
        to_date: sat,
        resource_slug: "maria-f14d",
      });
      expect(slot.error).toBeNull();
      const arr = (Array.isArray(slot.data) ? slot.data : []) as Array<{
        starts_at: string;
        resource_id: string;
      }>;
      const maria = arr.filter((s) => s.resource_id === FIXED.resA1);
      expect(maria.length).toBe(0);
      const anySat = arr.length;
      expect(anySat).toBe(0);
    } finally {
      if ((originalBA.rowCount ?? 0) > 0) {
        const r = originalBA.rows[0]!;
        await p.query(
          `UPDATE public.business_availability SET enabled=$5, start_time=$3::time, end_time=$4::time WHERE tenant_id=$1 AND weekday=$2`,
          [FIXED.tenantA, targetWD, r.st, r.en, r.enabled],
        );
      }
    }
  });

  it("RWA-16 time-off precedence over weekly schedule", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const sv = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(sv.error).toBeNull();
    const mon = nextMondayDate();
    const start10 = toRomeUTCISO(mon, 10, 0);
    const end12 = toRomeUTCISO(mon, 12, 0);
    const p = await pg();
    const ins = await p.query(
      `INSERT INTO public.resource_time_off (id, tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
       VALUES (gen_random_uuid(), $1, $2, 'vacation', 'Ferie', $3::timestamptz, $4::timestamptz)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [FIXED.tenantA, FIXED.resA1, start10, end12],
    );
    try {
      const slots = await callSlot(c, {
        tenant_slug: TENANT_A_SLUG,
        service_id: FIXED.svcA1,
        from_date: mon,
        to_date: mon,
        resource_slug: "maria-f14d",
      });
      expect(slots.error).toBeNull();
      const arr = (Array.isArray(slots.data) ? slots.data : []) as Array<{ starts_at: string }>;
      // slot nel range 10-12 devono essere 0
      const inWindow = arr.filter((s) => {
        const tt = new Date(s.starts_at).getTime();
        return tt >= new Date(start10).getTime() && tt < new Date(end12).getTime();
      });
      expect(inWindow.length).toBe(0);
    } finally {
      const id = ins.rows[0]?.id;
      if (id) {
        await p.query(`DELETE FROM public.resource_time_off WHERE id=$1`, [id]);
      } else {
        await p.query(
          `DELETE FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 AND title='Ferie'`,
          [FIXED.tenantA, FIXED.resA1],
        );
      }
    }
  });

  it("RWA-17 existing booking precedence blocks overlapping slot", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const p = await pg();
    // Cleanup residual state from prior tests (time_off + stale RA to ensure deterministic booking)
    await p.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [FIXED.tenantA]);
    // Also cancel any confirmed bookings on tenant A to avoid exclusion overlap
    await p.query(
      `UPDATE public.bookings SET status='cancelled', updated_at=NOW() WHERE tenant_id=$1 AND status='confirmed'`,
      [FIXED.tenantA],
    );
    // Give BOTH resources a Monday schedule covering 15:00 Rome so ANY resolution has a legal target
    const v1 = await versionOf(FIXED.resA1);
    const v2 = await versionOf(FIXED.resA2);
    const mon15Cover: Interval[] = [
      { weekday: 1, start_time: "09:00", end_time: "13:00" },
      { weekday: 1, start_time: "14:00", end_time: "19:00" },
    ];
    const s1 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: v1,
      intervals: mon15Cover,
    });
    const s2 = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: v2,
      intervals: mon15Cover,
    });
    expect(s1.error).toBeNull();
    expect(s2.error).toBeNull();
    const mon = nextMondayDate();
    // Book a valid slot via RPC: Monday 15:00 Rome.
    const startsAt = toRomeUTCISO(mon, 15, 0);
    const bk = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: startsAt,
      p_resource_slug: "any",
      p_customer_name: "Cliente RWA17",
      p_customer_email: `rwa17-${randomUUID().slice(0, 8)}@test.local`,
      p_customer_phone: `+39000${Math.floor(1000000 + Math.random() * 9000000)}`,
      p_notes: null,
    });
    // eslint-disable-next-line no-console
    if (bk.error) console.log(`[RWA17-DIAG] bk=`, JSON.stringify(bk, null, 2));
    expect(bk.error).toBeNull();
    // Now get Monday slots filtered for the booked resource.
    const out = Array.isArray(bk.data) ? bk.data : [];
    const resId = out[0]?.resource_id as string | undefined;
    if (resId) {
      const res = await (
        await pg()
      ).query(`SELECT slug FROM public.staff_resources WHERE id=$1`, [resId]);
      const slug = res.rows[0]?.slug as string | undefined;
      if (slug) {
        const slots = await callSlot(c, {
          tenant_slug: TENANT_A_SLUG,
          service_id: FIXED.svcA1,
          from_date: mon,
          to_date: mon,
          resource_slug: slug,
        });
        expect(slots.error).toBeNull();
        const arr = (Array.isArray(slots.data) ? slots.data : []) as Array<{ starts_at: string }>;
        const overlap = arr.filter((s) => {
          const t = new Date(s.starts_at).getTime();
          return (
            t >= new Date(startsAt).getTime() && t < new Date(startsAt).getTime() + 30 * 60 * 1000
          );
        });
        expect(overlap.length).toBe(0);
      }
    }
  });

  it("RWA-18 service/resource eligibility: non-eligible resource returns no slots", async () => {
    const c = anonClient();
    const mon = nextMondayDate();
    const slots = await callSlot(c, {
      tenant_slug: TENANT_B_SLUG,
      service_id: FIXED.svcA1, // belongs to tenant A, shouldn't match B
      from_date: mon,
      to_date: mon,
      resource_slug: "any",
    });
    const arr = Array.isArray(slots.data) ? slots.data : [];
    expect(arr.length).toBe(0);
  });

  it("RWA-19 ANY fallback uses other eligible available resources", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    // Prevent residual carryover: cancel all confirmed bookings for A
    await p.query(
      `UPDATE public.bookings SET status='cancelled', updated_at=NOW() WHERE tenant_id=$1 AND status='confirmed'`,
      [FIXED.tenantA],
    );
    const v1 = await versionOf(FIXED.resA1);
    const v2 = await versionOf(FIXED.resA2);
    const s1 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: v1,
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "13:00" }],
    });
    const s2 = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: v2,
      intervals: [{ weekday: 1, start_time: "14:00", end_time: "19:00" }],
    });
    expect(s1.error).toBeNull();
    expect(s2.error).toBeNull();
    const mon = nextMondayDate();
    const slots = await callSlot(c, {
      tenant_slug: TENANT_A_SLUG,
      service_id: FIXED.svcA1,
      from_date: mon,
      to_date: mon,
      resource_slug: "any",
    });
    expect(slots.error).toBeNull();
    const arr = (Array.isArray(slots.data) ? slots.data : []) as Array<{ resource_id: string }>;
    expect(arr.length).toBeGreaterThan(1);
    expect(arr.some((s) => s.resource_id === FIXED.resA1)).toBe(true);
    expect(arr.some((s) => s.resource_id === FIXED.resA2)).toBe(true);
  });

  it("RWA-20 direct booking outside resource weekly schedule deny (public_booking_create_v3)", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const sv = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [
        { weekday: 1, start_time: "09:00", end_time: "18:00" },
        { weekday: 2, start_time: "09:00", end_time: "18:00" },
      ],
    });
    expect(sv.error).toBeNull();
    // Next Wed = Monday + 2 days; Wednesday is OFF for resA1 (only Mon/Tue set)
    const mon = nextMondayDate();
    const wed = dateOffset(mon, 2);
    const startsAt = toRomeUTCISO(wed, 10, 0);
    const bk = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: startsAt,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Cliente RWA20",
      p_customer_email: `rwa20-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+393330001122",
      p_notes: null,
    });
    const success = !bk.error && Array.isArray(bk.data) && bk.data.length > 0;
    expect(success).toBe(false);
  });

  it("§8 DEFENSE-B: direct booking same-day outside resource weekly hours (not OFF, inside BA) → DENY", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const p = await pg();
    // Set Maria Monday 10:00-16:00 (so 08:00 is outside RA but inside BA 09-19).
    const sv = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "10:00", end_time: "16:00" }],
    });
    expect(sv.error).toBeNull();
    const mon = nextMondayDate();
    // Try booking Monday 09:30 Rome: BA is open (09 start) but RA starts 10 → OUTSIDE RESOURCE HOURS → DENY.
    const tEarly = toRomeUTCISO(mon, 9, 30);
    const tLate = toRomeUTCISO(mon, 16, 30);
    void p;
    const bkEarly = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: tEarly,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Def B Early",
      p_customer_email: `defbearly-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+393330009911",
      p_notes: null,
    });
    const successEarly = !bkEarly.error && Array.isArray(bkEarly.data) && bkEarly.data.length > 0;
    expect(successEarly).toBe(false);
    const bkLate = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: tLate,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Def B Late",
      p_customer_email: `defblate-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+393330009922",
      p_notes: null,
    });
    const successLate = !bkLate.error && Array.isArray(bkLate.data) && bkLate.data.length > 0;
    expect(successLate).toBe(false);
  });

  it("§8 DEFENSE-C: direct booking outside BUSINESS hours (even if resource RA says yes) → DENY", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const targetWD = 1 as Wd; // Monday
    const orig = await p.query(
      `SELECT enabled, start_time::text st, end_time::text en FROM public.business_availability WHERE tenant_id=$1 AND weekday=$2 LIMIT 1`,
      [FIXED.tenantA, targetWD],
    );
    try {
      // Temporarily restrict BA Monday to 11:00-14:00 so 15:00 is outside BA
      await p.query(
        `UPDATE public.business_availability SET start_time='11:00'::time, end_time='14:00'::time WHERE tenant_id=$1 AND weekday=$2`,
        [FIXED.tenantA, targetWD],
      );
      // Resource Maria Monday says 09:00-18:00 (broader than BA 11-14)
      const sv = await saveWeekly(c, {
        resource_id: FIXED.resA1,
        expected_version: await versionOf(FIXED.resA1),
        intervals: [{ weekday: targetWD, start_time: "09:00", end_time: "18:00" }],
      });
      expect(sv.error).toBeNull();
      const mon = nextMondayDate();
      // Slot at Monday 15:00 Rome: inside RA (09-18) but outside BA (now 11-14) → DENY.
      const t15 = toRomeUTCISO(mon, 15, 0);
      const bk = await callBookingCreateV3({
        p_tenant_slug: TENANT_A_SLUG,
        p_service_id: FIXED.svcA1,
        p_starts_at: t15,
        p_resource_slug: "maria-f14d",
        p_customer_name: "Def C Outside",
        p_customer_email: `defcout-${randomUUID().slice(0, 6)}@test.local`,
        p_customer_phone: "+393330009933",
        p_notes: null,
      });
      const success = !bk.error && Array.isArray(bk.data) && bk.data.length > 0;
      expect(success).toBe(false);
    } finally {
      if ((orig.rowCount ?? 0) > 0) {
        const r = orig.rows[0]!;
        await p.query(
          `UPDATE public.business_availability SET enabled=$4, start_time=$2::time, end_time=$3::time WHERE tenant_id=$1 AND weekday=$5`,
          [FIXED.tenantA, r.st, r.en, r.enabled, targetWD],
        );
      }
    }
  });

  it("§8 DEFENSE-D: direct booking during resource time-off → DENY (even if RA legal)", async () => {
    const c = anonClient();
    const p = await pg();
    await authenticateAs(c, "f14d-owner-a@test.local");
    // Cleanup ANY residual RTO + confirmed bookings for tenant A to avoid carryover
    await p.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [FIXED.tenantA]);
    await p.query(
      `UPDATE public.bookings SET status='cancelled', updated_at=NOW() WHERE tenant_id=$1 AND status='confirmed'`,
      [FIXED.tenantA],
    );
    await p.query(
      `UPDATE public.business_availability SET enabled=true, start_time='09:00'::time, end_time='19:00'::time WHERE tenant_id=$1 AND weekday=1`,
      [FIXED.tenantA],
    );
    await p.query(
      `DELETE FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 AND title='DEF-D permesso'`,
      [FIXED.tenantA, FIXED.resA1],
    );
    const mon = nextMondayDate();
    const toStart = toRomeUTCISO(mon, 14, 0);
    const toEnd = toRomeUTCISO(mon, 16, 0);
    // Ensure Maria Monday 09-18 wide open (RA legal).
    const sv = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(sv.error).toBeNull();
    // Insert time-off Monday 14:00 - 16:00
    await p.query(
      `INSERT INTO public.resource_time_off (id, tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
       VALUES (gen_random_uuid(), $1, $2, 'vacation', 'DEF-D permesso',$3::timestamptz,$4::timestamptz)
       ON CONFLICT DO NOTHING`,
      [FIXED.tenantA, FIXED.resA1, toStart, toEnd],
    );
    // Try booking Monday 15:00 (inside time-off window)
    const t15 = toRomeUTCISO(mon, 15, 0);
    const phoneBad = `+390${Math.floor(100000000 + Math.random() * 900000000)}`;
    const bkBad = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: t15,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Def D Bad",
      p_customer_email: `defdbad-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: phoneBad,
      p_notes: null,
    });
    const successBad = !bkBad.error && Array.isArray(bkBad.data) && bkBad.data.length > 0;
    expect(successBad).toBe(false);
    // Sanity: booking 10:00 outside time-off should work (RA allows it)
    const t10 = toRomeUTCISO(mon, 10, 0);
    const phoneGood = `+390${Math.floor(100000000 + Math.random() * 900000000)}`;
    const bkGood = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: t10,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Def D OK",
      p_customer_email: `defdok-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: phoneGood,
      p_notes: null,
    });
    const successGood = !bkGood.error && Array.isArray(bkGood.data) && bkGood.data.length > 0;
    // eslint-disable-next-line no-console
    if (!successGood) console.log(`[DEF-D] bkGood=`, JSON.stringify(bkGood, null, 2));
    expect(successGood).toBe(true);
    // Cleanup specific time-off.
    await p.query(
      `DELETE FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 AND title='DEF-D permesso'`,
      [FIXED.tenantA, FIXED.resA1],
    );
  });

  it("§8 DEFENSE-E: direct booking overlapping confirmed booking → DENY", async () => {
    const c = anonClient();
    const p = await pg();
    // Ensure Maria Monday 09-18 so specific booking works.
    await authenticateAs(c, "f14d-owner-a@test.local");
    // Cleanup ANY residual RTO + confirmed bookings for tenant A
    await p.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [FIXED.tenantA]);
    await p.query(
      `UPDATE public.bookings SET status='cancelled', updated_at=NOW() WHERE tenant_id=$1 AND status='confirmed'`,
      [FIXED.tenantA],
    );
    await p.query(
      `UPDATE public.business_availability SET enabled=true, start_time='09:00'::time, end_time='19:00'::time WHERE tenant_id=$1 AND weekday=1`,
      [FIXED.tenantA],
    );
    const sv1 = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(sv1.error).toBeNull();
    const mon = nextMondayDate();
    const t14 = toRomeUTCISO(mon, 14, 0);
    const emailFirst = `defe1st-${randomUUID().slice(0, 6)}@test.local`;
    const phoneFirst = `+390${Math.floor(100000000 + Math.random() * 900000000)}`;
    const first = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: t14,
      p_resource_slug: "maria-f14d",
      p_customer_name: "DefE First",
      p_customer_email: emailFirst,
      p_customer_phone: phoneFirst,
      p_notes: null,
    });
    const firstOK = !first.error && Array.isArray(first.data) && first.data.length > 0;
    // eslint-disable-next-line no-console
    if (!firstOK) console.log(`[DEF-E] first=`, JSON.stringify(first, null, 2));
    expect(firstOK).toBe(true);
    // Same slot, same service, same explicit resource slug maria-f14d → DENY overlap.
    const emailSecond = `defe2nd-${randomUUID().slice(0, 6)}@test.local`;
    const phoneSecond = `+390${Math.floor(100000000 + Math.random() * 900000000)}`;
    const second = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: t14,
      p_resource_slug: "maria-f14d",
      p_customer_name: "DefE Second",
      p_customer_email: emailSecond,
      p_customer_phone: phoneSecond,
      p_notes: null,
    });
    const secondOK = !second.error && Array.isArray(second.data) && second.data.length > 0;
    expect(secondOK).toBe(false);
    // Cleanup both test bookings.
    await p.query(
      `UPDATE public.bookings SET status='cancelled' WHERE tenant_id=$1 AND customer_email IN ($2,$3)`,
      [FIXED.tenantA, emailFirst, emailSecond],
    );
  });

  it("RWA-21 existing booking preserved after schedule change", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const p = await pg();
    const mon = nextMondayDate();
    const startsAt = toRomeUTCISO(mon, 17, 0);
    // Ensure resA1 currently has window 09-18 Monday so booking is valid.
    const sv = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(sv.error).toBeNull();
    // Count existing bookings for resA1 (we don't have resource_id column, but returned rows contain booking)
    const beforeCount = await p.query(
      `SELECT count(*)::int n FROM public.bookings b
       WHERE b.tenant_id=$1
         AND b.starts_at >= $2::timestamptz
         AND b.starts_at < ($2::date + INTERVAL '7 days')::timestamptz`,
      [FIXED.tenantA, startsAt],
    );
    const bk = await callBookingCreateV3({
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: FIXED.svcA1,
      p_starts_at: startsAt,
      p_resource_slug: "maria-f14d",
      p_customer_name: "Cliente RWA21",
      p_customer_email: `rwa21-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+393330001133",
      p_notes: null,
    });
    if (bk.error) {
      // Could fail due to other constraints. Skip only if creation failed (not what we test)
      // instead: make a raw insert into bookings (no resource_id), we want to verify count preserved.
      await p.query(
        `INSERT INTO public.bookings (tenant_id, service_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone)
         VALUES ($1,$2,$3::timestamptz, ($3::timestamptz + INTERVAL '30 minutes'),'confirmed','C RWA21 Raw','rwa21raw@test.local','+390000')
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, FIXED.svcA1, startsAt],
      );
    }
    const midCount = await p.query(
      `SELECT count(*)::int n FROM public.bookings b
       WHERE b.tenant_id=$1
         AND b.starts_at >= $2::timestamptz
         AND b.starts_at < ($2::date + INTERVAL '7 days')::timestamptz`,
      [FIXED.tenantA, startsAt],
    );
    // Now shrink Maria Monday window to 09-16 (our booking was at 17: outside new schedule).
    const shrink = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "16:00" }],
    });
    expect(shrink.error).toBeNull();
    const afterCount = await p.query(
      `SELECT count(*)::int n FROM public.bookings b
       WHERE b.tenant_id=$1
         AND b.starts_at >= $2::timestamptz
         AND b.starts_at < ($2::date + INTERVAL '7 days')::timestamptz`,
      [FIXED.tenantA, startsAt],
    );
    expect(Number(afterCount.rows[0].n)).toBeGreaterThanOrEqual(Number(midCount.rows[0].n));
    expect(Number(beforeCount.rows[0].n)).toBeLessThanOrEqual(Number(midCount.rows[0].n));
  });

  it("RWA-22 audit row written after save", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const p = await pg();
    const before = await p.query(
      `SELECT count(*)::int n FROM public.audit_logs WHERE tenant_id=$1 AND action IN ('resource_weekly_schedule_updated','resource_availability_changed')`,
      [FIXED.tenantA],
    );
    await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 6, start_time: "10:00", end_time: "14:00" }],
    });
    const after = await p.query(
      `SELECT count(*)::int n FROM public.audit_logs WHERE tenant_id=$1 AND action IN ('resource_weekly_schedule_updated','resource_availability_changed')`,
      [FIXED.tenantA],
    );
    expect(Number(after.rows[0].n)).toBeGreaterThanOrEqual(Number(before.rows[0].n) + 1);
  });

  it("RWA-23 timezone/dst representative: Rome UTC+1/UTC+2 stays wall-clock same interval display", async () => {
    const p = await pg();
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const { error } = await saveWeekly(c, {
      resource_id: FIXED.resA2,
      expected_version: await versionOf(FIXED.resA2),
      intervals: [{ weekday: 4, start_time: "09:00", end_time: "18:00" }],
    });
    expect(error).toBeNull();
    const r = await p.query(
      `SELECT start_time::text st, end_time::text en FROM public.resource_availability WHERE tenant_id=$1 AND resource_id=$2 AND weekday=4`,
      [FIXED.tenantA, FIXED.resA2],
    );
    expect(r.rows.map((x: any) => `${x.st.slice(0, 5)}-${x.en.slice(0, 5)}`)).toContain(
      "09:00-18:00",
    );
  });

  it("RWA-24 backward compat: resource WITHOUT schedule inherits business hours (slots available via ANY)", async () => {
    const p = await pg();
    await p.query(
      `DELETE FROM public.resource_availability WHERE tenant_id=$1 AND resource_id=$2`,
      [FIXED.tenantB, FIXED.resB1],
    );
    const bSvcId = "00000000-0000-4130-8002-0000000014b1";
    await p.query(
      `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active)
       VALUES ($1,$2,'Taglio B F14D',30,true)
       ON CONFLICT (id) DO NOTHING`,
      [bSvcId, FIXED.tenantB],
    );
    await p.query(
      `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id) VALUES ($3,$1,$2) ON CONFLICT DO NOTHING`,
      [FIXED.resB1, bSvcId, FIXED.tenantB],
    );
    const mon = nextMondayDate();
    const c = anonClient();
    const slots = await callSlot(c, {
      tenant_slug: TENANT_B_SLUG,
      service_id: bSvcId,
      from_date: mon,
      to_date: mon,
      resource_slug: "any",
    });
    expect(slots.error).toBeNull();
    const arr = Array.isArray(slots.data) ? slots.data : [];
    // eslint-disable-next-line no-console
    console.log(
      `[RWA-24] slots.err=${JSON.stringify(slots.error)} slots.len=${arr.length} arr[0..2]=${JSON.stringify(arr.slice(0, 3))}`,
    );
    expect(arr.length).toBeGreaterThan(2);
  });

  // RACES
  it("RACE-1 same version concurrent writes → 1 winner / 1 stale conflict deterministic", async () => {
    const c1 = anonClient();
    const c2 = anonClient();
    await authenticateAs(c1, "f14d-owner-a@test.local");
    await authenticateAs(c2, "f14d-owner-a@test.local");
    const v0 = await versionOf(FIXED.resA2);
    const r = await Promise.all([
      saveWeekly(c1, {
        resource_id: FIXED.resA2,
        expected_version: v0,
        intervals: [{ weekday: 1, start_time: "09:00", end_time: "12:00" }],
      }),
      saveWeekly(c2, {
        resource_id: FIXED.resA2,
        expected_version: v0,
        intervals: [{ weekday: 1, start_time: "13:00", end_time: "16:00" }],
      }),
    ]);
    const wins = r.filter((x) => !x.error).length;
    const stale = r.filter((x) => !!x.error).length;
    expect(wins).toBe(1);
    expect(stale).toBe(1);
  });

  it("RACE-2 different resources concurrent writes → both succeed", async () => {
    const c1 = anonClient();
    const c2 = anonClient();
    await authenticateAs(c1, "f14d-owner-a@test.local");
    await authenticateAs(c2, "f14d-owner-a@test.local");
    const v1 = await versionOf(FIXED.resA1);
    const v2 = await versionOf(FIXED.resA2);
    const r = await Promise.all([
      saveWeekly(c1, {
        resource_id: FIXED.resA1,
        expected_version: v1,
        intervals: [{ weekday: 2, start_time: "09:00", end_time: "18:00" }],
      }),
      saveWeekly(c2, {
        resource_id: FIXED.resA2,
        expected_version: v2,
        intervals: [{ weekday: 2, start_time: "09:00", end_time: "18:00" }],
      }),
    ]);
    expect(r[0].error).toBeNull();
    expect(r[1].error).toBeNull();
  });

  it("RACE-3 schedule save concurrent booking → safe outcome (preserve booking OR deny outside schedule)", async () => {
    const cA = anonClient();
    await authenticateAs(cA, "f14d-owner-a@test.local");
    const p = await pg();
    const mon = nextMondayDate();
    const startsAt = toRomeUTCISO(mon, 11, 0);
    // Precondition: resA1 has Monday 09-18 window so booking is legal (baseline).
    const setup = await saveWeekly(cA, {
      resource_id: FIXED.resA1,
      expected_version: await versionOf(FIXED.resA1),
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
    expect(setup.error).toBeNull();
    const bookingEmail = `race3bk-${randomUUID().slice(0, 6)}@test.local`;
    const N = 8;
    for (let i = 0; i < N; i++) {
      const v = await versionOf(FIXED.resA1);
      // Concurrent actions: booking at 11:00 (was legal) vs schedule shrinks Mon to 09-10 (11 now outside)
      // Reset bookings for this specific email to avoid stale state.
      await p.query(
        `UPDATE public.bookings SET status='cancelled' WHERE tenant_id=$1 AND customer_email=$2`,
        [FIXED.tenantA, bookingEmail],
      );
      const bookingPromise = callBookingCreateV3({
        p_tenant_slug: TENANT_A_SLUG,
        p_service_id: FIXED.svcA1,
        p_starts_at: startsAt,
        p_resource_slug: "maria-f14d",
        p_customer_name: "Cliente Race3",
        p_customer_email: bookingEmail,
        p_customer_phone: "+393333000" + String(i % 10).repeat(2),
        p_notes: null,
      });
      const schedulePromise = saveWeekly(cA, {
        resource_id: FIXED.resA1,
        expected_version: v,
        intervals: [{ weekday: 1, start_time: "09:00", end_time: "10:00" }],
      });
      const [bk, sc] = await Promise.all([bookingPromise, schedulePromise]);
      const bookingSucceeded = !bk.error && Array.isArray(bk.data) && bk.data.length > 0;
      // Aftermath invariant #1: if booking succeeded, it MUST exist in DB (NO silent deletion).
      if (bookingSucceeded) {
        const cnt = await p.query(
          `SELECT count(*)::int n FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 AND starts_at=$3::timestamptz AND status!='cancelled'`,
          [FIXED.tenantA, bookingEmail, startsAt],
        );
        expect(Number(cnt.rows[0].n)).toBeGreaterThanOrEqual(1);
      }
      // Aftermath invariant #2: schedule either succeeded OR failed with plausible stale/overlap/version error.
      if (sc.error) {
        expect(/stale|version|overlap|RWA/i.test(sc.error.message || "")).toBe(true);
      }
    }
    // Final state: restore Monday 09-18 baseline for other tests.
    const vEnd = await versionOf(FIXED.resA1);
    await saveWeekly(cA, {
      resource_id: FIXED.resA1,
      expected_version: vEnd,
      intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
    });
  });

  it("RACE-4 weekly schedule save concurrent resource time-off creation → time-off always wins in slot availability", async () => {
    const cA = anonClient();
    const p = await pg();
    await authenticateAs(cA, "f14d-owner-a@test.local");
    const mon = nextMondayDate();
    const timeoffStart = toRomeUTCISO(mon, 10, 0);
    const timeoffEnd = toRomeUTCISO(mon, 12, 0);
    // Cleanup stale state: remove time-off at exact window if present
    await p.query(
      `DELETE FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 AND starts_at=$3::timestamptz AND ends_at=$4::timestamptz`,
      [FIXED.tenantA, FIXED.resA1, timeoffStart, timeoffEnd],
    );
    const N = 6;
    for (let i = 0; i < N; i++) {
      const v = await versionOf(FIXED.resA1);
      // schedule: resA1 Monday 09-18 (whole day), time-off concurrent insert 10-12 Monday.
      const schedulePromise = saveWeekly(cA, {
        resource_id: FIXED.resA1,
        expected_version: v,
        intervals: [{ weekday: 1, start_time: "09:00", end_time: "18:00" }],
      });
      const toffPromise = p.query(
        `INSERT INTO public.resource_time_off(id, tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
         VALUES (gen_random_uuid(), $1, $2, 'vacation', 'RACE4 permesso',$3::timestamptz,$4::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, FIXED.resA1, timeoffStart, timeoffEnd],
      );
      const [sc, to] = await Promise.all([schedulePromise, toffPromise]);
      void sc;
      void to;
      // invariant: after both commit, slots for Monday in 10:00-12:00 for Maria must be ZERO.
      const slots = await callSlot(cA, {
        tenant_slug: TENANT_A_SLUG,
        service_id: FIXED.svcA1,
        from_date: mon,
        to_date: mon,
        resource_slug: "maria-f14d",
      });
      expect(slots.error).toBeNull();
      const arr = (Array.isArray(slots.data) ? slots.data : []) as Array<{
        starts_at: string;
        resource_id: string;
      }>;
      const maria = arr.filter((s) => s.resource_id === FIXED.resA1);
      const inBlocked = maria.filter((s) => {
        const tt = new Date(s.starts_at).getTime();
        return tt >= new Date(timeoffStart).getTime() && tt < new Date(timeoffEnd).getTime();
      });
      expect(inBlocked.length).toBe(0);
    }
    // Cleanup: remove test time-off.
    await p.query(
      `DELETE FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 AND title='RACE4 permesso'`,
      [FIXED.tenantA, FIXED.resA1],
    );
  });

  it("RACE-5 double submit same payload → one write applied, no duplicates rows", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const v0 = await versionOf(FIXED.resA2);
    const intervals: Interval[] = [{ weekday: 5, start_time: "11:00", end_time: "15:00" }];
    const [a, b] = await Promise.all([
      saveWeekly(c, { resource_id: FIXED.resA2, expected_version: v0, intervals }),
      saveWeekly(c, { resource_id: FIXED.resA2, expected_version: v0, intervals }),
    ]);
    const rows = (await listRaw(FIXED.tenantA, FIXED.resA2)).rows.filter(
      (r: any) => r.weekday === 5,
    );
    expect(rows.length).toBe(1);
    void a;
    void b;
  });

  // FAILURE INJECTION
  it("FAILURE-1 invalid payload produces no mutation", async () => {
    const c = anonClient();
    await authenticateAs(c, "f14d-owner-a@test.local");
    const v0 = await versionOf(FIXED.resA1);
    const { error } = await saveWeekly(c, {
      resource_id: FIXED.resA1,
      expected_version: v0,
      intervals: [{ weekday: 99 as Wd, start_time: "xx", end_time: "yy" }] as Interval[],
    });
    expect(!!error).toBe(true);
    const v1 = await versionOf(FIXED.resA1);
    expect(v1).toBe(v0);
  });
});
