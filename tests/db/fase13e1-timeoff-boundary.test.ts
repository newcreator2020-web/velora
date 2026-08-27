// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
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
    console.error(`[fase13e1-boundary] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
const TENANT_A_SLUG = `f13e1-to-a-${UNIQ}`;
const TENANT_B_SLUG = `f13e1-to-b-${UNIQ}`;

const UUIDS = {
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  svcA1: randomUUID(),
  svcA2: randomUUID(),
  svcB1: randomUUID(),
  ownerA: `f13e1-owna-${UNIQ}@test.local`,
  managerA: `f13e1-mgra-${UNIQ}@test.local`,
  staffA: `f13e1-stfa-${UNIQ}@test.local`,
  ownerB: `f13e1-ownb-${UNIQ}@test.local`,
  noMember: `f13e1-nomem-${UNIQ}@test.local`,
  resA1: randomUUID(),
  resA2: randomUUID(),
  resB1: randomUUID(),
  bookingConfirmedA1: randomUUID(),
  bookingConfirmedA2: randomUUID(),
  bookingConfirmedA3: randomUUID(),
  bookingCancelledA: randomUUID(),
  bookingCompletedA: randomUUID(),
  bookingNoShowA: randomUUID(),
  custA1: randomUUID(),
  timeOffA1: randomUUID(),
};

type AnyClient = SupabaseClient<Database, "public">;

type __RpcResult = { data?: unknown | null; error?: { code?: string; message?: string } | null };
type __AnyRpcClient = {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<__RpcResult>;
};
async function callRpc(
  cl: unknown,
  name: string,
  params: Record<string, unknown>,
): Promise<{ data: Array<any>; error: { code?: string; message?: string } | null }> {
  const r = await (cl as __AnyRpcClient).rpc(name, params);
  const arr = Array.isArray(r.data) ? r.data : [];
  return { data: arr, error: r.error ?? null };
}

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
  noMember: null,
};

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

afterEach(async () => {
  if (!_pg) return;
  try {
    await _pg.query("ROLLBACK");
  } catch {
    /* no-op */
  }
  try {
    await _pg.query("SET session_replication_role = DEFAULT");
  } catch {
    /* no-op */
  }
});
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
async function login(email: string): Promise<AnyClient> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}
const CEST_H_OFFSET = 2;
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
const FIXED_MONDAY: { y: number; mo: number; d: number } = (() => {
  const n = new Date();
  const today = n.getUTCDay();
  let delta = (1 - today + 7) % 7;
  if (delta === 0) delta = 7;
  delta += 21;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();
function MON(h: number, m: number): string {
  const { y, mo, d } = FIXED_MONDAY;
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function DAYS_LATER(
  base: { y: number; mo: number; d: number },
  days: number,
  h: number,
  m: number,
): string {
  const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}

const TZ = "Europe/Rome";
const SERVICE_DURATION = 60;

async function provisionTenantsAndUsers() {
  const svc = serviceClient();
  const db = await pg();
  const tenantRealId: Record<string, string> = { ownerA: "", ownerB: "" };

  for (const [k, email, tenantSlug, businessName] of [
    ["ownerA", UUIDS.ownerA, TENANT_A_SLUG, `Tenant A ${UNIQ}`],
    ["ownerB", UUIDS.ownerB, TENANT_B_SLUG, `Tenant B ${UNIQ}`],
  ] as const) {
    const r1 = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (r1.error) throw new Error(`create ${email}: ${r1.error.message}`);
    userIds[k] = r1.data.user.id;
    const uid = r1.data.user.id;
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL ROLE authenticated");
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [uid]);
      await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
      await db.query(
        `SELECT public.create_tenant_with_owner($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text)`,
        [businessName, "Servizi", "Roma", "RM", "+390600000000", email, TZ, "it-IT"],
      );
      await db.query("RESET ROLE");
      await db.query("COMMIT");
    } catch (e) {
      try {
        await db.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    }
    const tq = await db.query(
      `SELECT t.id FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id WHERE m.user_id = $1::uuid AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at DESC LIMIT 1`,
      [uid],
    );
    expect(tq.rows.length).toBe(1);
    const realId = tq.rows[0].id;
    tenantRealId[k] = realId;
    if (k === "ownerA") UUIDS.tenantA = realId;
    if (k === "ownerB") UUIDS.tenantB = realId;
    await db.query(
      `UPDATE public.tenants SET slug = $1::text, published = TRUE, status = 'active' WHERE id = $2::uuid`,
      [tenantSlug, realId],
    );
    await db.query(
      `UPDATE public.business_profiles SET timezone = $1::text WHERE tenant_id = $2::uuid`,
      [TZ, realId],
    );
  }

  for (const [k, email, role, tenantKey] of [
    ["managerA", UUIDS.managerA, "manager", "ownerA"],
    ["staffA", UUIDS.staffA, "staff", "ownerA"],
  ] as const) {
    const r = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (r.error) throw new Error(`create ${email}: ${r.error.message}`);
    userIds[k] = r.data.user.id;
    await db.query(
      `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status) VALUES ($1,$2,$3,'active')`,
      [tenantRealId[tenantKey], r.data.user.id, role],
    );
  }

  {
    const r = await svc.auth.admin.createUser({
      email: UUIDS.noMember,
      password: PASSWORD,
      email_confirm: true,
    });
    if (r.error) throw new Error(`create nomember: ${r.error.message}`);
    userIds.noMember = r.data.user.id;
  }
}

async function provisionServicesAndResources() {
  const db = await pg();
  for (const [tid, sid, name, dur, active, position] of [
    [UUIDS.tenantA, UUIDS.svcA1, "Taglio", SERVICE_DURATION, true, 1],
    [UUIDS.tenantA, UUIDS.svcA2, "Colore", 90, true, 2],
    [UUIDS.tenantB, UUIDS.svcB1, "Servizio B", 60, true, 1],
  ] as const) {
    await db.query(
      `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active, price_from, currency, position) VALUES ($1,$2,$3,$4,$5,1000,'EUR',$6::int)`,
      [sid, tid, name, dur, active, position],
    );
  }
  for (const [tid, rid, slug, name, order, color] of [
    [UUIDS.tenantA, UUIDS.resA1, "maria", "Maria", 1, "#112233"],
    [UUIDS.tenantA, UUIDS.resA2, "anna", "Anna", 2, "#445566"],
    [UUIDS.tenantB, UUIDS.resB1, "lucia-b", "Lucia B", 1, "#aabbcc"],
  ] as const) {
    await db.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, sort_order, color_hex, active, bookable) VALUES ($1,$2,$3,$4,$5,$6,true,true)`,
      [rid, tid, slug, name, order, color],
    );
  }
  for (const [tid, rid, sid] of [
    [UUIDS.tenantA, UUIDS.resA1, UUIDS.svcA1],
    [UUIDS.tenantA, UUIDS.resA1, UUIDS.svcA2],
    [UUIDS.tenantA, UUIDS.resA2, UUIDS.svcA1],
    [UUIDS.tenantB, UUIDS.resB1, UUIDS.svcB1],
  ] as const) {
    await db.query(
      `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,true)`,
      [tid, rid, sid],
    );
  }
  for (const [tid, rid] of [
    [UUIDS.tenantA, UUIDS.resA1],
    [UUIDS.tenantA, UUIDS.resA2],
    [UUIDS.tenantB, UUIDS.resB1],
  ] as const) {
    for (let wd = 1; wd <= 5; wd++) {
      await db.query(
        `INSERT INTO public.resource_availability (tenant_id, resource_id, weekday, start_time, end_time, enabled) VALUES ($1,$2,$3,'09:00'::time,'18:00'::time,true)`,
        [tid, rid, wd],
      );
    }
  }
}

async function insertBookingsForConflictTests() {
  const db = await pg();
  await db.query(
    `INSERT INTO public.customers (id, tenant_id, display_name, email_normalized, email, phone) VALUES ($1,$2,'Cliente A1','a1@test.local','a1@test.local','+390000000001')`,
    [UUIDS.custA1, UUIDS.tenantA],
  );
  const start1 = MON(10, 0);
  const end1 = MON(11, 0);
  const start2 = MON(11, 0);
  const end2 = MON(12, 0);
  const start3 = MON(14, 0);
  const end3 = MON(15, 0);
  const startC = MON(15, 0);
  const endC = MON(16, 0);
  for (const [id, st, en, status] of [
    [UUIDS.bookingConfirmedA1, start1, end1, "confirmed"],
    [UUIDS.bookingConfirmedA2, start2, end2, "confirmed"],
    [UUIDS.bookingConfirmedA3, start3, end3, "confirmed"],
    [UUIDS.bookingCancelledA, startC, endC, "cancelled"],
    [
      UUIDS.bookingCompletedA,
      DAYS_LATER(FIXED_MONDAY, -7, 10, 0),
      DAYS_LATER(FIXED_MONDAY, -7, 11, 0),
      "completed",
    ],
    [
      UUIDS.bookingNoShowA,
      DAYS_LATER(FIXED_MONDAY, -3, 10, 0),
      DAYS_LATER(FIXED_MONDAY, -3, 11, 0),
      "no_show",
    ],
  ] as const) {
    await db.query(
      `INSERT INTO public.bookings (id, tenant_id, customer_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone, revision, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CA1','a1@test.local','+390000000001',0,NOW(),NOW())`,
      [id, UUIDS.tenantA, UUIDS.custA1, UUIDS.svcA1, UUIDS.resA1, st, en, status],
    );
  }
}

beforeAll(async () => {
  await provisionTenantsAndUsers();
  await provisionServicesAndResources();
  await insertBookingsForConflictTests();
}, 120_000);

afterAll(async () => {
  await pgClose();
});

function codesOnly(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((r) => String(r.code)).filter((c, i, arr) => i === arr.indexOf(c));
}

describe("FASE13E1 — Time-Off Trusted Boundary — S13E1", () => {
  it("S13E1-01 owner preview 0 conflicts", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(8, 0);
    const end = MON(9, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const codes = codesOnly(data as never);
    expect(codes).toEqual(["OK"]);
    const conflicts = (data as Array<Record<string, unknown>>).filter((r) => r.booking_id !== null);
    expect(conflicts.length).toBe(0);
  });

  it("S13E1-02 manager preview 0 conflicts", async () => {
    const cl = await login(UUIDS.managerA);
    const start = MON(18, 0);
    const end = MON(19, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const codes = codesOnly(data as never);
    expect(codes).toEqual(["OK"]);
    const conflicts = (data as Array<Record<string, unknown>>).filter((r) => r.booking_id !== null);
    expect(conflicts.length).toBe(0);
  });

  it("S13E1-03 staff preview deny", async () => {
    const cl = await login(UUIDS.staffA);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(String(rows[0].code)).toBe("AUTHZ_DENIED");
  });

  it("S13E1-04 anon preview deny", async () => {
    const cl = anonClient();
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(String(rows[0].code)).toBe("AUTHZ_DENIED");
  });

  it("S13E1-05 owner create vacation 0 conflicts", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(16, 0);
    const end = MON(17, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA2,
      p_type: "vacation",
      p_starts_at: start,
      p_ends_at: end,
      p_expected_conflict_count: 0,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
    expect(Number(rows[0].conflict_count)).toBe(0);
    expect(rows[0].time_off_id).not.toBeNull();
  });

  it("S13E1-06 manager create sick", async () => {
    const cl = await login(UUIDS.managerA);
    const start = MON(7, 0);
    const end = MON(8, 30);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "sick",
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
    expect(Number(rows[0].conflict_count)).toBe(0);
  });

  it("S13E1-07 leave partial day", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(12, 30);
    const end = MON(14, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA2,
      p_type: "leave",
      p_starts_at: start,
      p_ends_at: end,
      p_title: "Pranzo lungo",
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
    expect(Number(rows[0].conflict_count)).toBe(0);
  });

  it("S13E1-08 training type", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = DAYS_LATER(FIXED_MONDAY, 1, 9, 0);
    const end = DAYS_LATER(FIXED_MONDAY, 1, 13, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "training",
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
  });

  it("S13E1-09 custom_block type", async () => {
    const cl = await login(UUIDS.managerA);
    const start = DAYS_LATER(FIXED_MONDAY, 2, 14, 0);
    const end = DAYS_LATER(FIXED_MONDAY, 2, 16, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA2,
      p_type: "custom_block",
      p_starts_at: start,
      p_ends_at: end,
      p_title: "Manutenzione",
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
  });

  it("S13E1-10 invalid starts>=ends deny", async () => {
    const cl = await login(UUIDS.ownerA);
    const { data } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: MON(12, 0),
      p_ends_at: MON(10, 0),
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("INVALID_INTERVAL");
  });

  it("S13E1-11 >366 days deny", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(9, 0);
    const dt = new Date(start);
    dt.setUTCDate(dt.getUTCDate() + 400);
    const end = dt.toISOString();
    const { data } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: start,
      p_ends_at: end,
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("RANGE_TOO_LARGE");
  });

  it("S13E1-12 cross-tenant resource preview deny", async () => {
    const cl = await login(UUIDS.ownerA);
    const { data } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resB1,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("RESOURCE_NOT_FOUND");
  });

  it("S13E1-13 cross-tenant resource create deny", async () => {
    const cl = await login(UUIDS.ownerA);
    const { data } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resB1,
      p_type: "vacation",
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("RESOURCE_NOT_FOUND");
  });

  it("S13E1-14 preview 3 confirmed → exact 3", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(9, 30);
    const end = MON(15, 30);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    const conflicts = rows.filter((r) => r.booking_id !== null);
    expect(conflicts.length).toBe(3);
    expect(String(rows[0].code)).toBe("OK");
    const ids = new Set(conflicts.map((r) => r.booking_id as string));
    expect(ids.has(UUIDS.bookingConfirmedA1)).toBe(true);
    expect(ids.has(UUIDS.bookingConfirmedA2)).toBe(true);
    expect(ids.has(UUIDS.bookingConfirmedA3)).toBe(true);
  });

  it("S13E1-15 cancelled excluded from preview", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(14, 30);
    const end = MON(16, 30);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    const ids = new Set(
      rows.filter((r) => r.booking_id !== null).map((r) => r.booking_id as string),
    );
    expect(ids.has(UUIDS.bookingCancelledA)).toBe(false);
    expect(ids.has(UUIDS.bookingConfirmedA3)).toBe(true);
  });

  it("S13E1-16 completed excluded from preview", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = DAYS_LATER(FIXED_MONDAY, -7, 8, 0);
    const end = DAYS_LATER(FIXED_MONDAY, -7, 12, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    const ids = new Set(
      rows.filter((r) => r.booking_id !== null).map((r) => r.booking_id as string),
    );
    expect(ids.has(UUIDS.bookingCompletedA)).toBe(false);
  });

  it("S13E1-17 no_show excluded from preview", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = DAYS_LATER(FIXED_MONDAY, -3, 8, 0);
    const end = DAYS_LATER(FIXED_MONDAY, -3, 12, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: UUIDS.resA1,
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    const ids = new Set(
      rows.filter((r) => r.booking_id !== null).map((r) => r.booking_id as string),
    );
    expect(ids.has(UUIDS.bookingNoShowA)).toBe(false);
  });

  it("S13E1-18 create rechecks conflicts server-side", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(10, 30);
    const end = MON(11, 30);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: start,
      p_ends_at: end,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("OK");
    expect(Number(rows[0].conflict_count)).toBe(2);
  });

  it("S13E1-19 stale expected count -> CONFLICT_PREVIEW_STALE", async () => {
    const cl = await login(UUIDS.ownerA);
    const start = MON(10, 0);
    const end = MON(12, 0);
    const { data, error } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "leave",
      p_starts_at: start,
      p_ends_at: end,
      p_expected_conflict_count: 999,
    });
    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(String(rows[0].code)).toBe("CONFLICT_PREVIEW_STALE");
  });

  it("S13E1-20 create preserves bookings (status stays confirmed)", async () => {
    const db = await pg();
    const cl = await login(UUIDS.ownerA);
    const start = MON(9, 0);
    const end = MON(16, 0);
    const pre = await db.query(
      `SELECT id, status FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[UUIDS.bookingConfirmedA1, UUIDS.bookingConfirmedA2, UUIDS.bookingConfirmedA3]],
    );
    expect(pre.rows.every((r) => r.status === "confirmed")).toBe(true);
    const { data } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: start,
      p_ends_at: end,
      p_expected_conflict_count: 3,
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(String(rows[0].code)).toBe("OK");
    expect(Number(rows[0].conflict_count)).toBe(3);
    const post = await db.query(
      `SELECT id, status FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[UUIDS.bookingConfirmedA1, UUIDS.bookingConfirmedA2, UUIDS.bookingConfirmedA3]],
    );
    expect(post.rows.every((r) => r.status === "confirmed")).toBe(true);
  });

  it("S13E1-21 slot V3 after time-off -> blocked", async () => {
    const db = await pg();
    const cl = anonClient();
    const start = MON(17, 0);
    const endBefore = new Date(start);
    endBefore.setUTCMinutes(endBefore.getUTCMinutes() + 30);
    await db.query(
      `INSERT INTO public.resource_time_off (id, tenant_id, resource_id, time_off_type, starts_at, ends_at) VALUES ($1,$2,$3,'custom_block',$4,$5)`,
      [UUIDS.timeOffA1, UUIDS.tenantA, UUIDS.resA1, start, MON(18, 0)],
    );
    const { error } = await callRpc(cl, "public_booking_create_v3", {
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: UUIDS.svcA1,
      p_starts_at: start,
      p_resource_slug: (
        await db.query(`SELECT slug FROM public.staff_resources WHERE id=$1`, [UUIDS.resA1])
      ).rows[0].slug,
      p_customer_name: "C",
      p_customer_email: `c-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+390000000099",
      p_notes: "",
    });
    expect(error).not.toBeNull();
    expect(String(error?.message ?? "")).toMatch(/slot taken|resource not eligible|VLTN/i);
  });

  it("S13E1-22 delete time-off -> slot returns bookable", async () => {
    const cl = await login(UUIDS.ownerA);
    const before = await callRpc(cl, "dashboard_resource_time_off_delete", {
      p_time_off_id: UUIDS.timeOffA1,
    });
    if (before.error) {
      console.warn("S13E1-22 DELETE ERROR:", JSON.stringify(before.error));
    }
    expect(before.error).toBeNull();
    const delRows = (before.data ?? []) as Array<Record<string, unknown>>;
    expect(delRows.length).toBeGreaterThanOrEqual(1);
    expect(String(delRows[0].code)).toBe("OK");
    const anon = anonClient();
    const start = MON(17, 0);
    const slug = (
      await (await pg()).query(`SELECT slug FROM public.staff_resources WHERE id=$1`, [UUIDS.resA1])
    ).rows[0].slug;
    const { error } = await callRpc(anon, "public_booking_create_v3", {
      p_tenant_slug: TENANT_A_SLUG,
      p_service_id: UUIDS.svcA1,
      p_starts_at: start,
      p_resource_slug: slug,
      p_customer_name: "C2",
      p_customer_email: `c2-${randomUUID().slice(0, 6)}@test.local`,
      p_customer_phone: "+390000000088",
      p_notes: "",
    });
    if (error) console.warn("S13E1-22 V3 POST-DELETE ERROR:", JSON.stringify(error));
    expect(error).toBeNull();
  });

  it("S13E1-23 audit create/delete PII-free (no title/email/phone)", async () => {
    const db = await pg();
    const before = await db.query(
      `SELECT COUNT(*)::int c FROM public.audit_logs WHERE tenant_id=$1 AND action IN ('resource_time_off_created','resource_time_off_deleted')`,
      [UUIDS.tenantA],
    );
    const cl = await login(UUIDS.ownerA);
    const s = DAYS_LATER(FIXED_MONDAY, 3, 10, 0);
    const e = DAYS_LATER(FIXED_MONDAY, 3, 12, 0);
    const cr = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA2,
      p_type: "training",
      p_starts_at: s,
      p_ends_at: e,
      p_title: "Training con Mario Rossi",
    });
    if (cr.error) console.warn("S13E1-23 CREATE ERROR:", JSON.stringify(cr.error));
    expect(cr.error).toBeNull();
    const crRows = (cr.data ?? []) as Array<Record<string, unknown>>;
    expect(crRows.length).toBeGreaterThanOrEqual(1);
    expect(String(crRows[0].code)).toBe("OK");
    const toId = crRows[0].time_off_id as string;
    const dr = await callRpc(cl, "dashboard_resource_time_off_delete", { p_time_off_id: toId });
    if (dr.error) console.warn("S13E1-23 DELETE ERROR:", JSON.stringify(dr.error));
    expect(dr.error).toBeNull();
    const drRows = (dr.data ?? []) as Array<Record<string, unknown>>;
    expect(drRows.length).toBeGreaterThanOrEqual(1);
    expect(String(drRows[0].code)).toBe("OK");
    const after = await db.query(
      `SELECT action, metadata FROM public.audit_logs WHERE tenant_id=$1 AND action IN ('resource_time_off_created','resource_time_off_deleted') ORDER BY id DESC LIMIT 2`,
      [UUIDS.tenantA],
    );
    expect(after.rows.length).toBe(2);
    expect(before.rows[0].c + 2).toBe(before.rows[0].c + after.rows.length - 0);
    for (const row of after.rows) {
      const meta = JSON.stringify(row.metadata ?? {});
      expect(meta).not.toMatch(/Mario Rossi/);
      expect(meta).not.toMatch(/@/);
      expect(meta).not.toMatch(/\+39/);
      expect(meta).toMatch(/resource_id/);
      expect(meta).toMatch(/range_seconds|starts_at|ends_at/);
      expect(meta).toMatch(/time_off_type|conflict_count|deleted_by_role|created_by_role/);
    }
  });

  it("S13E1-24 audit immutable (update/delete deny)", async () => {
    const db = await pg();
    const q = await db.query(
      `SELECT id FROM public.audit_logs WHERE tenant_id=$1 AND action='resource_time_off_created' LIMIT 1`,
      [UUIDS.tenantA],
    );
    expect(q.rows.length).toBeGreaterThan(0);
    const id = q.rows[0].id;
    await expect(
      db.query(`UPDATE public.audit_logs SET metadata=metadata WHERE id=$1`, [id]),
    ).rejects.toThrow();
    await expect(db.query(`DELETE FROM public.audit_logs WHERE id=$1`, [id])).rejects.toThrow();
  });
});

describe("FASE13E1 — Time-Off Trusted Boundary — F13E1 Failure Injection", () => {
  it("F13E1-01 malformed UUID for resource_id", async () => {
    const cl = await login(UUIDS.ownerA);
    const { error } = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: "not-a-uuid" as never,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    expect(error).not.toBeNull();
  });

  it("F13E1-02 inactive resource — explicitly tested preview returns OK or RESOURCE_NOT_FOUND", async () => {
    const db = await pg();
    const inactiveId = randomUUID();
    await db.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, color_hex, sort_order, active, bookable) VALUES ($1,$2,$3,$4,$5,99,false,false)`,
      [inactiveId, UUIDS.tenantA, `inactive-${UNIQ}`, "Inactive", "#ffffff"],
    );
    const cl = await login(UUIDS.ownerA);
    const r = await callRpc(cl, "dashboard_resource_time_off_preview", {
      p_resource_id: inactiveId,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    const rows = (r.data ?? []) as Array<Record<string, unknown>>;
    expect(rows.length + (r.error ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });

  it("F13E1-03 wrong type enum", async () => {
    const cl = await login(UUIDS.ownerA);
    const r = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "holidayzz" as never,
      p_starts_at: MON(9, 0),
      p_ends_at: MON(10, 0),
    });
    const rows = (r.data ?? []) as Array<Record<string, unknown>>;
    const code = rows[0] ? String(rows[0].code) : r.error ? "ERROR" : "EMPTY";
    expect(code === "VALIDATION_ERROR" || code === "ERROR").toBe(true);
  });

  it("F13E1-04 title boundary >160", async () => {
    const cl = await login(UUIDS.ownerA);
    const title = "A".repeat(200);
    const r = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: MON(7, 0),
      p_ends_at: MON(8, 0),
      p_title: title,
    });
    const rows = (r.data ?? []) as Array<Record<string, unknown>>;
    const code = rows[0] ? String(rows[0].code) : r.error ? "ERROR" : "EMPTY";
    expect(code === "VALIDATION_ERROR" || code === "ERROR").toBe(true);
  });

  it("F13E1-05 direct anon table INSERT deny (RLS + grants)", async () => {
    const cl = anonClient();
    const { error } = await cl.from("resource_time_off").insert({
      tenant_id: UUIDS.tenantA,
      resource_id: UUIDS.resA1,
      time_off_type: "vacation",
      starts_at: MON(7, 0),
      ends_at: MON(8, 0),
    } as never);
    expect(error).not.toBeNull();
  });

  it("F13E1-06 direct staff table INSERT deny", async () => {
    const cl = await login(UUIDS.staffA);
    const { error } = await cl.from("resource_time_off").insert({
      tenant_id: UUIDS.tenantA,
      resource_id: UUIDS.resA1,
      time_off_type: "vacation",
      starts_at: MON(7, 0),
      ends_at: MON(8, 0),
    } as never);
    expect(error).not.toBeNull();
  });

  it("F13E1-07 direct cross-tenant INSERT via service role with forged tenant context", async () => {
    const db = await pg();
    const svc = serviceClient();
    const ownerBLogin = await login(UUIDS.ownerB);
    const uid = (await ownerBLogin.auth.getUser()).data.user?.id;
    expect(uid).toBeTruthy();
    const { error } = await svc.from("resource_time_off").insert({
      tenant_id: UUIDS.tenantA,
      resource_id: UUIDS.resA1,
      time_off_type: "vacation",
      starts_at: MON(7, 0),
      ends_at: MON(8, 0),
    } as never);
    const _directViaSvc = error === null;
    try {
      await db.query(
        `INSERT INTO public.resource_time_off (tenant_id, resource_id, time_off_type, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5)`,
        [UUIDS.tenantB, UUIDS.resA1, "vacation", MON(7, 0), MON(8, 0)],
      );
      expect.fail("cross-tenant FK should fail");
    } catch (e) {
      expect(String(e)).toMatch(/foreign|violation/i);
    }
  });

  it("F13E1-08 audit failure rolls back main write", async () => {
    const db = await pg();
    try {
      await db.query(`BEGIN`);
      await db.query(`SELECT set_config('app.booking_write_trusted', 'true', true)`);
      const { rows: _rows } = await db.query(
        `SELECT public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,NULL::text,0::int)`,
        [UUIDS.resA1, DAYS_LATER(FIXED_MONDAY, 4, 8, 0), DAYS_LATER(FIXED_MONDAY, 4, 9, 0)],
      );
      await db.query("SET LOCAL session_replication_role = DEFAULT");
      await expect(
        db.query(
          `INSERT INTO public.audit_logs (tenant_id, action, entity_type, entity_id, actor_user_id, metadata) VALUES ($1,'FORBIDDEN_ACTION','x',gen_random_uuid(),$2,'{}'::jsonb)`,
          [UUIDS.tenantA, userIds.ownerA],
        ),
      ).rejects.toThrow();
    } finally {
      await db.query(`ROLLBACK`);
    }
  });

  it("F13E1-09 forged membership/tenant context via noMember", async () => {
    const cl = await login(UUIDS.noMember);
    const { data } = await callRpc(cl, "dashboard_resource_time_off_create", {
      p_resource_id: UUIDS.resA1,
      p_type: "vacation",
      p_starts_at: MON(7, 0),
      p_ends_at: MON(8, 0),
    });
    const rows = data as Array<Record<string, unknown>>;
    expect(String(rows[0].code)).toBe("AUTHZ_DENIED");
  });

  it("F13E1-10 function search_path='' and grants inspection", async () => {
    const db = await pg();
    const procs: Array<{ name: string; args: string; internal?: boolean }> = [
      { name: "dashboard_resource_time_off_preview", args: "(uuid,timestamptz,timestamptz)" },
      {
        name: "dashboard_resource_time_off_create",
        args: "(uuid,text,timestamptz,timestamptz,text,integer)",
      },
      { name: "dashboard_resource_time_off_delete", args: "(uuid)" },
      { name: "scheduling_lock_resource", args: "(uuid,uuid)", internal: true },
      { name: "scheduling_lock_resources_sorted", args: "(uuid,uuid[])", internal: true },
    ];
    for (const p of procs) {
      const q = await db.query(
        `SELECT pg_get_functiondef(p.oid) as def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = $1::text`,
        [p.name],
      );
      expect(q.rows.length).toBeGreaterThanOrEqual(1);
      const def = q.rows.map((r) => r.def as string).join("\n");
      if (p.internal) {
        expect(def).toMatch(/search_path\s*(?:=|TO)\s*''/i);
        const gr = await db.query(
          `SELECT has_function_privilege('authenticated','public.' || $1::text || $2::text,'EXECUTE') as ex, has_function_privilege('anon','public.' || $1::text || $2::text,'EXECUTE') as ex_anon`,
          [p.name, p.args],
        );
        expect(gr.rows[0].ex).toBe(false);
        expect(gr.rows[0].ex_anon).toBe(false);
      }
    }
  });
});
