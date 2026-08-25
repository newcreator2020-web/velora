// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient } from "@supabase/supabase-js";
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
    console.error(`[fase13e1b] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const _ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
const TENANT_A_SLUG = `f13e1b-a-${UNIQ}`;
const TENANT_B_SLUG = `f13e1b-b-${UNIQ}`;

const UUIDS = {
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  svcA1: randomUUID(),
  svcA2: randomUUID(),
  svcB1: randomUUID(),
  ownerA: `f13e1b-owna-${UNIQ}@test.local`,
  managerA: `f13e1b-mgra-${UNIQ}@test.local`,
  staffA: `f13e1b-stfa-${UNIQ}@test.local`,
  ownerB: `f13e1b-ownb-${UNIQ}@test.local`,
  resA1: randomUUID(),
  resA2: randomUUID(),
  resB1: randomUUID(),
  resB2: randomUUID(),
  bookingConfA1: randomUUID(),
  bookingConfA2: randomUUID(),
  bookingConfA3: randomUUID(),
  bookingCancelledA: randomUUID(),
  bookingCompletedA: randomUUID(),
  bookingNoShowA: randomUUID(),
  bookingConfB1: randomUUID(),
  custA1: randomUUID(),
  custB1: randomUUID(),
  timeOffA1: randomUUID(),
  timeOffB1: randomUUID(),
};

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
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
async function newPgIsolated(): Promise<PgClient> {
  const c = new PgClient(pgOpts());
  await c.connect();
  return c;
}
async function pgClose(cl?: PgClient) {
  try {
    if (cl) await cl.end();
    else if (_pg) {
      await _pg.end();
      _pg = null;
    }
  } catch {
    /* ignore */
  }
}
function serviceClient() {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
  delta += 14;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();
function ISO(
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

async function impersonate(db: PgClient, userKey: keyof typeof userIds, _roleClaim?: string) {
  await db.query("SET LOCAL ROLE authenticated");
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [userIds[userKey]]);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  try {
    const tid = userKey === "ownerB" ? UUIDS.tenantB : UUIDS.tenantA;
    await db.query(`SELECT set_config('app.current_tenant_id', $1::text, true)`, [tid]);
  } catch {
    /* ignore */
  }
}

async function impersonateAnon(db: PgClient) {
  await db.query("SET LOCAL ROLE anon");
  await db.query(`SELECT set_config('request.jwt.claim.sub', NULL::text, true)`);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'anon', true)`);
}

beforeAll(async () => {
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

  for (const [tid, sid, name, dur, pos] of [
    [UUIDS.tenantA, UUIDS.svcA1, "Taglio", SERVICE_DURATION, 1],
    [UUIDS.tenantA, UUIDS.svcA2, "Colore", 90, 2],
    [UUIDS.tenantB, UUIDS.svcB1, "Serv B", SERVICE_DURATION, 1],
  ] as const) {
    await db.query(
      `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active, price_from, currency, position) VALUES ($1,$2,$3,$4,true,1000,'EUR',$5::int)`,
      [sid, tid, name, dur, pos],
    );
  }

  for (const [tid, rid, slug, name, order, color] of [
    [UUIDS.tenantA, UUIDS.resA1, "maria", "Maria", 1, "#112233"],
    [UUIDS.tenantA, UUIDS.resA2, "anna", "Anna", 2, "#445566"],
    [UUIDS.tenantB, UUIDS.resB1, "lucia-b", "Lucia B", 1, "#aabbcc"],
    [UUIDS.tenantB, UUIDS.resB2, "sara-b", "Sara B", 2, "#ddeeff"],
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
    [UUIDS.tenantA, UUIDS.resA2, UUIDS.svcA2],
    [UUIDS.tenantB, UUIDS.resB1, UUIDS.svcB1],
    [UUIDS.tenantB, UUIDS.resB2, UUIDS.svcB1],
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
    [UUIDS.tenantB, UUIDS.resB2],
  ] as const) {
    for (let wd = 0; wd <= 6; wd++) {
      await db.query(
        `INSERT INTO public.resource_availability (tenant_id, resource_id, weekday, start_time, end_time, enabled) VALUES ($1,$2,$3,'09:00'::time,'18:00'::time,true)`,
        [tid, rid, wd],
      );
    }
  }

  await db.query(
    `INSERT INTO public.customers (id, tenant_id, display_name, email_normalized, email, phone) VALUES ($1,$2,'Cliente A1','a1@test.local','a1@test.local','+390000000001')`,
    [UUIDS.custA1, UUIDS.tenantA],
  );
  await db.query(
    `INSERT INTO public.customers (id, tenant_id, display_name, email_normalized, email, phone) VALUES ($1,$2,'Cliente B1','b1@test.local','b1@test.local','+390000000002')`,
    [UUIDS.custB1, UUIDS.tenantB],
  );

  const s1 = ISO(FIXED_MONDAY, 0, 10, 0);
  const e1 = ISO(FIXED_MONDAY, 0, 11, 0);
  const s2 = ISO(FIXED_MONDAY, 0, 11, 0);
  const e2 = ISO(FIXED_MONDAY, 0, 12, 0);
  const s3 = ISO(FIXED_MONDAY, 0, 12, 0);
  const e3 = ISO(FIXED_MONDAY, 0, 13, 0);
  const sC = ISO(FIXED_MONDAY, 0, 14, 0);
  const eC = ISO(FIXED_MONDAY, 0, 15, 0);

  for (const [id, st, en, status, tid, rid, sid, cust] of [
    [
      UUIDS.bookingConfA1,
      s1,
      e1,
      "confirmed",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingConfA2,
      s2,
      e2,
      "confirmed",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingConfA3,
      s3,
      e3,
      "confirmed",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingCancelledA,
      sC,
      eC,
      "cancelled",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingCompletedA,
      ISO(FIXED_MONDAY, -7, 10, 0),
      ISO(FIXED_MONDAY, -7, 11, 0),
      "completed",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingNoShowA,
      ISO(FIXED_MONDAY, -3, 10, 0),
      ISO(FIXED_MONDAY, -3, 11, 0),
      "no_show",
      UUIDS.tenantA,
      UUIDS.resA1,
      UUIDS.svcA1,
      UUIDS.custA1,
    ],
    [
      UUIDS.bookingConfB1,
      s1,
      e1,
      "confirmed",
      UUIDS.tenantB,
      UUIDS.resB1,
      UUIDS.svcB1,
      UUIDS.custB1,
    ],
  ] as const) {
    await db.query(
      `INSERT INTO public.bookings (id, tenant_id, customer_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone, revision, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'C','x@test.local','+390000000099',0,NOW(),NOW())`,
      [id, tid, cust, sid, rid, st, en, status],
    );
  }
}, 120_000);

afterAll(async () => {
  await pgClose();
});

describe("FASE13E1B · S — 24 Success Tests", () => {
  it("S13E1B-01 owner preview 0 conflicts", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 1, 8, 0), ISO(FIXED_MONDAY, 1, 9, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows.length).toBeGreaterThanOrEqual(1);
      expect(r.rows[0].code).toBe("OK");
      const conflicts = r.rows.filter((row) => row.booking_id !== null);
      expect(conflicts.length).toBe(0);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-02 manager preview 0 conflicts", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "managerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 2, 7, 0), ISO(FIXED_MONDAY, 2, 8, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows.length).toBeGreaterThanOrEqual(1);
      expect(r.rows[0].code).toBe("OK");
      const conflicts = r.rows.filter((row) => row.booking_id !== null);
      expect(conflicts.length).toBe(0);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-03 owner preview 3 confirmed conflicts", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 9, 30), ISO(FIXED_MONDAY, 0, 13, 30)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
      const conflicts = r.rows.filter((row) => row.booking_id !== null);
      expect(conflicts.length).toBe(3);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-04 cancelled excluded from preview", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 13, 30), ISO(FIXED_MONDAY, 0, 15, 30)],
      );
      await db.query("COMMIT");
      const ids = new Set(r.rows.filter((row) => row.booking_id).map((row) => row.booking_id));
      expect(ids.has(UUIDS.bookingCancelledA)).toBe(false);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-05 completed excluded from preview", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, -7, 8, 0), ISO(FIXED_MONDAY, -7, 12, 0)],
      );
      await db.query("COMMIT");
      const ids = new Set(r.rows.filter((row) => row.booking_id).map((row) => row.booking_id));
      expect(ids.has(UUIDS.bookingCompletedA)).toBe(false);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-06 no_show excluded from preview", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, -3, 8, 0), ISO(FIXED_MONDAY, -3, 12, 0)],
      );
      await db.query("COMMIT");
      const ids = new Set(r.rows.filter((row) => row.booking_id).map((row) => row.booking_id));
      expect(ids.has(UUIDS.bookingNoShowA)).toBe(false);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-07 cross-tenant booking B excluded from preview A", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 9, 30), ISO(FIXED_MONDAY, 0, 13, 30)],
      );
      await db.query("COMMIT");
      const ids = new Set(r.rows.filter((row) => row.booking_id).map((row) => row.booking_id));
      expect(ids.has(UUIDS.bookingConfB1)).toBe(false);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-08 owner create no conflict", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'OK crea 08',0::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 3, 9, 0), ISO(FIXED_MONDAY, 3, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
      expect(Number(r.rows[0].conflict_count)).toBe(0);
      expect(r.rows[0].time_off_id).not.toBeNull();
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-09 owner create 3 conflicts preserve bookings no auto cancel", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const pre = await db.query(
        `SELECT id, status FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[UUIDS.bookingConfA1, UUIDS.bookingConfA2, UUIDS.bookingConfA3]],
      );
      expect(pre.rows.every((row) => row.status === "confirmed")).toBe(true);
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'sick'::text,$2::timestamptz,$3::timestamptz,'Sovr 3 conf',3::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 9, 30), ISO(FIXED_MONDAY, 0, 13, 30)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
      expect(Number(r.rows[0].conflict_count)).toBe(3);
      const post = await db.query(
        `SELECT id, status FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[UUIDS.bookingConfA1, UUIDS.bookingConfA2, UUIDS.bookingConfA3]],
      );
      expect(post.rows.every((row) => row.status === "confirmed")).toBe(true);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-10 manager create", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "managerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'sick'::text,$2::timestamptz,$3::timestamptz,'Mgr crea',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 4, 14, 0), ISO(FIXED_MONDAY, 4, 15, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
      expect(r.rows[0].time_off_id).not.toBeNull();
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-11 staff create deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "staffA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 5, 9, 0), ISO(FIXED_MONDAY, 5, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("AUTHZ_DENIED");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-12 anon create deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateAnon(db);
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 5, 10, 0), ISO(FIXED_MONDAY, 5, 11, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("AUTHZ_DENIED");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-13 forged resource B deny (A usa B.resource_id)", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'forged cross',NULL::int)`,
        [UUIDS.resB1, ISO(FIXED_MONDAY, 6, 9, 0), ISO(FIXED_MONDAY, 6, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("RESOURCE_NOT_FOUND");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-14 invalid interval starts>=ends deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 7, 12, 0), ISO(FIXED_MONDAY, 7, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("INVALID_INTERVAL");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-15 partial-day OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,'Mezza giornata',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 8, 12, 30), ISO(FIXED_MONDAY, 8, 14, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-16 vacation type OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'Vacanza OK',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 9, 9, 0), ISO(FIXED_MONDAY, 9, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-17 sick type OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "managerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'sick'::text,$2::timestamptz,$3::timestamptz,'Malattia OK',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 10, 9, 0), ISO(FIXED_MONDAY, 10, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-18 leave type OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,'Permesso OK',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 11, 9, 0), ISO(FIXED_MONDAY, 11, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-19 training type OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'training'::text,$2::timestamptz,$3::timestamptz,'Formazione OK',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 12, 9, 0), ISO(FIXED_MONDAY, 12, 13, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-20 custom_block type OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "managerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'custom_block'::text,$2::timestamptz,$3::timestamptz,'Custom OK',NULL::int)`,
        [UUIDS.resA2, ISO(FIXED_MONDAY, 13, 14, 0), ISO(FIXED_MONDAY, 13, 16, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-21 delete owner OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const cr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'Da cancellare',0::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 20, 9, 0), ISO(FIXED_MONDAY, 20, 10, 0)],
      );
      await db.query("COMMIT");
      expect(cr.rows[0].code).toBe("OK");
      const tid = cr.rows[0].time_off_id;
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const dr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_delete($1::uuid)`,
        [tid],
      );
      await db.query("COMMIT");
      expect(dr.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-22 delete manager OK", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const cr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'sick'::text,$2::timestamptz,$3::timestamptz,'Da cancellare mgr',0::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 21, 9, 0), ISO(FIXED_MONDAY, 21, 10, 0)],
      );
      await db.query("COMMIT");
      expect(cr.rows[0].code).toBe("OK");
      const tid = cr.rows[0].time_off_id;
      await db.query("BEGIN");
      await impersonate(db, "managerA");
      const dr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_delete($1::uuid)`,
        [tid],
      );
      await db.query("COMMIT");
      expect(dr.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-23 delete cross tenant deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerB");
      const cr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'B da A non puo',0::int)`,
        [UUIDS.resB1, ISO(FIXED_MONDAY, 22, 9, 0), ISO(FIXED_MONDAY, 22, 10, 0)],
      );
      await db.query("COMMIT");
      expect(cr.rows[0].code).toBe("OK");
      const tid = cr.rows[0].time_off_id;
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const dr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_delete($1::uuid)`,
        [tid],
      );
      await db.query("COMMIT");
      expect([
        "TIME_OFF_NOT_FOUND",
        "AUTHZ_DENIED",
        "CROSS_TENANT_DENIED",
        "RESOURCE_NOT_FOUND",
      ]).toContain(dr.rows[0].code);
    } finally {
      await pgClose(db);
    }
  });

  it("S13E1B-24 stale preview (expected=0, nel mezzo un booking → CONFLICT_PREVIEW_STALE)", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'training'::text,$2::timestamptz,$3::timestamptz,'Stale test',0::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 9, 30), ISO(FIXED_MONDAY, 0, 13, 30)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("CONFLICT_PREVIEW_STALE");
      expect(Number(r.rows[0].conflict_count)).toBe(3);
    } finally {
      await pgClose(db);
    }
  });
});

describe("FASE13E1B · F — 12 Failure Tests", () => {
  it("F13E1B-01 malformed UUID resource_id", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      let errored = false;
      try {
        await db.query(
          `SELECT * FROM public.dashboard_resource_time_off_preview('not-a-uuid'::text::uuid,$1::timestamptz,$2::timestamptz)`,
          [ISO(FIXED_MONDAY, 30, 9, 0), ISO(FIXED_MONDAY, 30, 10, 0)],
        );
      } catch {
        errored = true;
      }
      await db.query("COMMIT");
      expect(errored).toBe(true);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-02 bad enum type", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'not_valid_type'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 31, 9, 0), ISO(FIXED_MONDAY, 31, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("VALIDATION_ERROR");
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-03 title overflow 201 chars", async () => {
    const db = await newPgIsolated();
    try {
      const longTitle = "A".repeat(201);
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,$4::text,NULL::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 32, 9, 0), ISO(FIXED_MONDAY, 32, 10, 0), longTitle],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("VALIDATION_ERROR");
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-04 past invalid (ieri)", async () => {
    const db = await newPgIsolated();
    try {
      const n = new Date();
      const yesterdayBadStart = new Date(
        Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 1, 14 - CEST_H_OFFSET, 0),
      );
      const yesterdayBadEnd = new Date(
        Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - 1, 10 - CEST_H_OFFSET, 0),
      );
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [
          UUIDS.resA1,
          yesterdayBadStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
          yesterdayBadEnd.toISOString().replace(/\.\d{3}Z$/, "Z"),
        ],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("INVALID_INTERVAL");
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-05 range oversized (>60gg default contract)", async () => {
    const db = await newPgIsolated();
    try {
      const start = ISO(FIXED_MONDAY, 0, 9, 0);
      const dt = new Date(start);
      dt.setUTCDate(dt.getUTCDate() + 367);
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
        [UUIDS.resA1, start, dt.toISOString().replace(/\.\d{3}Z$/, "Z")],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("RANGE_TOO_LARGE");
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-06 direct INSERT auth user table deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "staffA");
      let errored = false;
      try {
        await db.query(
          `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, aud, role, raw_user_meta_data) VALUES ($1::uuid,'x@test.local','x',NOW(),'authenticated','authenticated','{}'::jsonb)`,
          [randomUUID()],
        );
      } catch {
        errored = true;
      }
      if (!errored) {
        await db.query("ROLLBACK");
      } else {
        try {
          await db.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
      expect(errored).toBe(true);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-07 direct DELETE staff role deny", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "staffA");
      let errored = false;
      try {
        await db.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userIds.ownerA]);
      } catch {
        errored = true;
      }
      if (!errored) {
        await db.query("ROLLBACK");
      } else {
        try {
          await db.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
      expect(errored).toBe(true);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-08 audit failure rollback (trigger exception)", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      await db.query(`
        CREATE OR REPLACE FUNCTION pg_temp._break_audit()
        RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          RAISE EXCEPTION 'forced audit break';
        END; $f$;
      `);
      await db.query(`DROP TRIGGER IF EXISTS _break_audit_t ON public.resource_time_off`);
      await db.query(
        `CREATE TRIGGER _break_audit_t BEFORE INSERT ON public.resource_time_off FOR EACH ROW EXECUTE FUNCTION pg_temp._break_audit()`,
      );
      let errored = false;
      try {
        await db.query(
          `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'audit break test',NULL::int)`,
          [UUIDS.resA2, ISO(FIXED_MONDAY, 33, 9, 0), ISO(FIXED_MONDAY, 33, 10, 0)],
        );
      } catch {
        errored = true;
      }
      try {
        await db.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      expect(errored).toBe(true);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-09 wrong tenant forged GUC", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      await db.query(`SELECT set_config('app.current_tenant_id', $1::text, true)`, [UUIDS.tenantB]);
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'forged guc',NULL::int)`,
        [UUIDS.resB1, ISO(FIXED_MONDAY, 34, 9, 0), ISO(FIXED_MONDAY, 34, 10, 0)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("RESOURCE_NOT_FOUND");
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-10 stale expected count 3 poi cancello e quindi expected sbagliato", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      await db.query(`UPDATE public.bookings SET status = 'cancelled' WHERE id = $1::uuid`, [
        UUIDS.bookingConfA3,
      ]);
      await db.query("COMMIT");
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,'wrong expected 3',3::int)`,
        [UUIDS.resA1, ISO(FIXED_MONDAY, 0, 9, 30), ISO(FIXED_MONDAY, 0, 13, 30)],
      );
      await db.query("COMMIT");
      expect(r.rows[0].code).toBe("CONFLICT_PREVIEW_STALE");
      expect(Number(r.rows[0].conflict_count)).toBe(2);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-11 double submit stesso create identico", async () => {
    const db = await newPgIsolated();
    try {
      const st = ISO(FIXED_MONDAY, 40, 9, 0);
      const en = ISO(FIXED_MONDAY, 40, 10, 0);
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r1 = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'custom_block'::text,$2::timestamptz,$3::timestamptz,'double submit',0::int)`,
        [UUIDS.resA2, st, en],
      );
      await db.query("COMMIT");
      expect(r1.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      const r2 = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'custom_block'::text,$2::timestamptz,$3::timestamptz,'double submit',0::int)`,
        [UUIDS.resA2, st, en],
      );
      await db.query("COMMIT");
      expect(r2.rows[0].code).toBe("OK");
      const cnt = await db.query(
        `SELECT COUNT(*) c FROM public.resource_time_off WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND tstzrange(starts_at, ends_at, '[)') = tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
        [UUIDS.tenantA, UUIDS.resA2, st, en],
      );
      expect(Number(cnt.rows[0].c)).toBeGreaterThanOrEqual(2);
    } finally {
      await pgClose(db);
    }
  });

  it("F13E1B-12 forced DB exception (null resource)", async () => {
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonate(db, "ownerA");
      let errored = false;
      try {
        await db.query(`SELECT 1 / 0`);
        await db.query(
          `SELECT * FROM public.dashboard_resource_time_off_create(NULL::uuid,'vacation'::text,$1::timestamptz,$2::timestamptz,NULL::text,NULL::int)`,
          [ISO(FIXED_MONDAY, 50, 9, 0), ISO(FIXED_MONDAY, 50, 10, 0)],
        );
      } catch {
        errored = true;
      }
      if (!errored) {
        await db.query("ROLLBACK");
      } else {
        try {
          await db.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
      expect(errored).toBe(true);
    } finally {
      await pgClose(db);
    }
  });
});
