// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
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
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set([
  "dgekfjkuvnofwdwxflms",
  "velora-local",
  "uiekkhgspziozprxulit",
]);
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
    console.error(`[fase13e1-races] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
const TENANT_SLUG = `f13e1-race-${UNIQ}`;

const UUIDS = {
  tenant: randomUUID(),
  svc1: randomUUID(),
  svc2: randomUUID(),
  res1: randomUUID(),
  res2: randomUUID(),
  owner: `f13e1-race-own-${UNIQ}@test.local`,
  cust: randomUUID(),
};

const TZ = "Europe/Rome";
const SERVICE_DURATION = 60;

let userIdOwner: string | null = null;

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
async function login(email: string): Promise<SupabaseClient<Database, "public">> {
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
  delta += 28;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();
function DAYS_LATER(
  base: { y: number; mo: number; d: number },
  days: number,
  h: number,
  m: number,
): string {
  const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}

beforeAll(async () => {
  const svc = serviceClient();
  const db = await pg();
  const r = await svc.auth.admin.createUser({
    email: UUIDS.owner,
    password: PASSWORD,
    email_confirm: true,
  });
  if (r.error) throw new Error(`create ${UUIDS.owner}: ${r.error.message}`);
  userIdOwner = r.data.user.id;
  const uid = userIdOwner;
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE authenticated");
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [uid]);
    await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    await db.query(
      `SELECT public.create_tenant_with_owner($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text)`,
      [`Race Tenant ${UNIQ}`, "Servizi", "Roma", "RM", "+390600000001", UUIDS.owner, TZ, "it-IT"],
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
  UUIDS.tenant = tq.rows[0].id;
  await db.query(
    `UPDATE public.tenants SET slug = $1::text, published = TRUE, status = 'active' WHERE id = $2::uuid`,
    [TENANT_SLUG, UUIDS.tenant],
  );
  await db.query(`UPDATE public.business_profiles SET timezone=$1::text WHERE tenant_id=$2::uuid`, [
    TZ,
    UUIDS.tenant,
  ]);

  for (const [sid, name, dur, position] of [
    [UUIDS.svc1, "Taglio Race", SERVICE_DURATION, 1],
    [UUIDS.svc2, "Colore Race", 90, 2],
  ] as const) {
    await db.query(
      `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active, price_from, currency, position) VALUES ($1,$2,$3,$4,true,1000,'EUR',$5::int)`,
      [sid, UUIDS.tenant, name, dur, position],
    );
  }
  for (const [rid, slug, name, order, color] of [
    [UUIDS.res1, "race-maria", "Race Maria", 1, "#112233"],
    [UUIDS.res2, "race-anna", "Race Anna", 2, "#445566"],
  ] as const) {
    await db.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, sort_order, color_hex, active, bookable) VALUES ($1,$2,$3,$4,$5,$6,true,true)`,
      [rid, UUIDS.tenant, slug, name, order, color],
    );
  }
  for (const [rid, sid] of [
    [UUIDS.res1, UUIDS.svc1],
    [UUIDS.res2, UUIDS.svc1],
    [UUIDS.res1, UUIDS.svc2],
  ] as const) {
    await db.query(
      `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,true)`,
      [UUIDS.tenant, rid, sid],
    );
  }
  for (const rid of [UUIDS.res1, UUIDS.res2]) {
    for (let wd = 1; wd <= 5; wd++) {
      await db.query(
        `INSERT INTO public.resource_availability (tenant_id, resource_id, weekday, start_time, end_time, enabled) VALUES ($1,$2,$3,'09:00'::time,'18:00'::time,true)`,
        [UUIDS.tenant, rid, wd],
      );
    }
  }
  await db.query(
    `INSERT INTO public.customers (id, tenant_id, display_name, email_normalized, email, phone) VALUES ($1,$2,'Race Cust','rc@test.local','rc@test.local','+390000000999')`,
    [UUIDS.cust, UUIDS.tenant],
  );
}, 120_000);

afterAll(async () => {
  await pgClose();
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function barrier<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const start = delay(80);
  await start;
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}
function uuidSuffix12(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

type RpcResult = {
  data?: Array<Record<string, unknown>> | null;
  error?: { code?: string; message?: string } | null;
};
type AnyRpcClient = {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<RpcResult>;
};
async function callRpc(
  cl: unknown,
  name: string,
  params: Record<string, unknown>,
): Promise<{ data: Array<any>; error: { code?: string; message?: string } | null }> {
  const r = await (cl as AnyRpcClient).rpc(name, params);
  const arr = Array.isArray(r.data) ? r.data : [];
  return { data: arr, error: r.error ?? null };
}
function codeOf(row: Record<string, unknown> | undefined | null): string {
  return String((row ?? {})["code"] ?? "");
}
function numOf(row: Record<string, unknown> | undefined | null, key: string): number {
  const v = (row ?? {})[key];
  return typeof v === "number" ? v : v == null ? 0 : Number(v);
}

describe("FASE13E1 — Time-Off Race Conditions — R13E1", () => {
  it("R13E1-01 20 create time-off differenti su stessa risorsa (tutti commit, 0 lost audit)", async () => {
    const db = await pg();
    const owner = await login(UUIDS.owner);
    const N = 20;
    const offsets = Array.from({ length: N }, (_, i) => i * 15);
    const results = await barrier(N, async (i) => {
      const min = 8 * 60 + offsets[i];
      const h = Math.floor(min / 60);
      const m = min % 60;
      const s = DAYS_LATER(FIXED_MONDAY, 1, h, m);
      const eh = Math.floor((min + 10) / 60);
      const em = (min + 10) % 60;
      const e = DAYS_LATER(FIXED_MONDAY, 1, eh, em);
      const { data } = await callRpc(owner, "dashboard_resource_time_off_create", {
        p_resource_id: UUIDS.res1,
        p_type: "leave",
        p_starts_at: s,
        p_ends_at: e,
      });
      return data[0];
    });
    const oks = results.filter((r) => codeOf(r) === "OK");
    expect(oks.length).toBe(N);
    const q = await db.query(
      `SELECT COUNT(*)::int c FROM public.resource_time_off WHERE resource_id=$1 AND tenant_id=$2 AND time_off_type='leave'`,
      [UUIDS.res1, UUIDS.tenant],
    );
    expect(q.rows[0].c).toBeGreaterThanOrEqual(N);
    const aq = await db.query(
      `SELECT COUNT(*)::int c FROM public.audit_logs WHERE tenant_id=$1 AND action='resource_time_off_created'`,
      [UUIDS.tenant],
    );
    expect(aq.rows[0].c).toBeGreaterThanOrEqual(N);
  }, 60_000);

  it("R13E1-02 booking public V3 vs create time-off stesso resource/range (20 round deterministico)", async () => {
    const owner = await login(UUIDS.owner);
    let ghost = 0;
    let _bookingWon = 0;
    let _toWon = 0;
    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round++) {
      const dayOffset = 2 + Math.floor(round / 4);
      const hour = 10 + (round % 4);
      const s = DAYS_LATER(FIXED_MONDAY, dayOffset, hour, 0);
      const e = DAYS_LATER(FIXED_MONDAY, dayOffset, hour + 1, 0);
      const res1Slug = (
        await (
          await pg()
        ).query(`SELECT slug FROM public.staff_resources WHERE id=$1`, [UUIDS.res1])
      ).rows[0].slug;
      const bookingTask = (async () => {
        const anon = anonClient();
        try {
          const { data, error } = await callRpc(anon, "public_booking_create_v3", {
            p_tenant_slug: TENANT_SLUG,
            p_service_id: UUIDS.svc1,
            p_starts_at: s,
            p_resource_slug: res1Slug,
            p_customer_name: `Round${round}`,
            p_customer_email: `r${round}-${randomUUID().slice(0, 6)}@test.local`,
            p_customer_phone: "+390000000001",
            p_notes: "",
          });
          return {
            ok: !error && data && data.length > 0,
            type: "booking" as const,
          };
        } catch {
          return { ok: false, type: "booking" as const };
        }
      })();
      const toTask = (async () => {
        try {
          const { data } = await callRpc(owner, "dashboard_resource_time_off_create", {
            p_resource_id: UUIDS.res1,
            p_type: "vacation",
            p_starts_at: s,
            p_ends_at: e,
          });
          const r = data[0];
          const ok = codeOf(r) === "OK";
          return { ok, type: "to" as const, cc: numOf(r, "conflict_count") };
        } catch {
          return { ok: false, type: "to" as const, cc: 0 };
        }
      })();
      const [br, tr] = await Promise.all([bookingTask, toTask]);
      if (br.ok && tr.ok) {
        if (Number((tr as { cc?: number }).cc ?? 0) === 0) ghost++;
        else _bookingWon++;
      } else if (br.ok && !tr.ok) {
        _bookingWon++;
      } else if (!br.ok && tr.ok) {
        _toWon++;
      }
    }
    expect(ghost).toBe(0);
  }, 120_000);

  it("R13E1-03 manual booking vs time-off: stessa semantica deterministica", async () => {
    const owner = await login(UUIDS.owner);
    let ghost = 0;
    let okBook = 0;
    let okTo = 0;
    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round++) {
      const dayOffset = 10 + Math.floor(round / 4);
      const hour = 11 + (round % 3);
      const s = DAYS_LATER(FIXED_MONDAY, dayOffset, hour, 0);
      const bookTask = (async () => {
        const cl = await login(UUIDS.owner);
        try {
          const { data } = await callRpc(cl, "dashboard_booking_manual_create", {
            p_customer_name: `ManualRound${round}`,
            p_customer_email: `m${round}-${randomUUID().slice(0, 6)}@test.local`,
            p_customer_phone: "+390000000002",
            p_service_id: UUIDS.svc1,
            p_starts_at: s,
            p_resource_slug: "race-anna",
          });
          const r = data[0];
          return { ok: codeOf(r) === "OK", type: "man" as const };
        } catch {
          return { ok: false, type: "man" as const };
        }
      })();
      const toTask = (async () => {
        try {
          const { data } = await callRpc(owner, "dashboard_resource_time_off_create", {
            p_resource_id: UUIDS.res2,
            p_type: "sick",
            p_starts_at: s,
            p_ends_at: DAYS_LATER(FIXED_MONDAY, dayOffset, hour + 1, 0),
          });
          const r = data[0];
          return {
            ok: codeOf(r) === "OK",
            type: "to" as const,
            cc: numOf(r, "conflict_count"),
          };
        } catch {
          return { ok: false, type: "to" as const, cc: 0 };
        }
      })();
      const [br, tr] = await Promise.all([bookTask, toTask]);
      if (br.ok && tr.ok) ghost++;
      else if (br.ok) okBook++;
      else if (tr.ok) okTo++;
    }
    expect(ghost).toBe(0);
    expect(okBook + okTo).toBeGreaterThanOrEqual(Math.floor(ROUNDS / 2));
  }, 120_000);

  it("R13E1-04 reschedule INTO range vs time-off: semantica deterministica", async () => {
    const db = await pg();
    const owner = await login(UUIDS.owner);
    let ghost = 0;
    let _okRes = 0;
    let _okTo = 0;
    const ROUNDS = 12;
    for (let round = 0; round < ROUNDS; round++) {
      const dayOffset = 20 + round;
      const initStart = DAYS_LATER(FIXED_MONDAY, dayOffset, 9, 0);
      const targetStart = DAYS_LATER(FIXED_MONDAY, dayOffset, 14, 0);
      const targetEnd = DAYS_LATER(FIXED_MONDAY, dayOffset, 15, 0);
      const bid = `00000000-0000-4133-9008-${uuidSuffix12()}`;
      await db.query(
        `INSERT INTO public.bookings (id, tenant_id, customer_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone, revision) VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed','R${round}','r${round}@t.local','+391',0)`,
        [
          bid,
          UUIDS.tenant,
          UUIDS.cust,
          UUIDS.svc1,
          UUIDS.res2,
          initStart,
          DAYS_LATER(FIXED_MONDAY, dayOffset, 10, 0),
        ],
      );
      const resTask = (async () => {
        const cl = await login(UUIDS.owner);
        try {
          const { data } = await callRpc(cl, "dashboard_booking_reschedule", {
            p_booking_id: bid,
            p_expected_revision: 0,
            p_new_starts_at: targetStart,
          });
          const r = data[0];
          return { ok: codeOf(r) === "OK", type: "res" as const };
        } catch {
          return { ok: false, type: "res" as const };
        }
      })();
      const toTask = (async () => {
        try {
          const { data } = await callRpc(owner, "dashboard_resource_time_off_create", {
            p_resource_id: UUIDS.res2,
            p_type: "training",
            p_starts_at: targetStart,
            p_ends_at: targetEnd,
          });
          const r = data[0];
          return {
            ok: codeOf(r) === "OK",
            type: "to" as const,
            cc: numOf(r, "conflict_count"),
          };
        } catch {
          return { ok: false, type: "to" as const, cc: 0 };
        }
      })();
      const [rr, tr] = await Promise.all([resTask, toTask]);
      if (rr.ok && tr.ok) ghost++;
      else if (rr.ok) _okRes++;
      else if (tr.ok) _okTo++;
    }
    expect(ghost).toBe(0);
  }, 120_000);

  it("R13E1-05 2 create time-off stesso preview conflict_count: entrambi con conflict_count ricalcolato", async () => {
    const db = await pg();
    const owner = await login(UUIDS.owner);
    const s = DAYS_LATER(FIXED_MONDAY, 35, 10, 0);
    const e = DAYS_LATER(FIXED_MONDAY, 35, 12, 0);
    const bid = `00000000-0000-4133-9008-${uuidSuffix12()}`;
    await db.query(
      `INSERT INTO public.bookings (id, tenant_id, customer_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email, customer_phone, revision) VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed','PreConflict','pc@t.local','+399',0)`,
      [
        bid,
        UUIDS.tenant,
        UUIDS.cust,
        UUIDS.svc1,
        UUIDS.res1,
        DAYS_LATER(FIXED_MONDAY, 35, 10, 30),
        DAYS_LATER(FIXED_MONDAY, 35, 11, 30),
      ],
    );
    const [r1, r2] = await Promise.all([
      callRpc(owner, "dashboard_resource_time_off_create", {
        p_resource_id: UUIDS.res1,
        p_type: "vacation",
        p_starts_at: s,
        p_ends_at: e,
        p_expected_conflict_count: 1,
      }),
      callRpc(owner, "dashboard_resource_time_off_create", {
        p_resource_id: UUIDS.res1,
        p_type: "leave",
        p_starts_at: s,
        p_ends_at: e,
        p_expected_conflict_count: 1,
      }),
    ]);
    const row1 = r1.data[0];
    const row2 = r2.data[0];
    const ok1 = codeOf(row1) === "OK";
    const ok2 = codeOf(row2) === "OK";
    if (ok1) expect(numOf(row1, "conflict_count")).toBe(1);
    if (ok2) expect(numOf(row2, "conflict_count")).toBeGreaterThanOrEqual(1);
    const aq = await db.query(
      `SELECT COUNT(*)::int c FROM public.audit_logs WHERE tenant_id=$1 AND action='resource_time_off_created' AND metadata->>'resource_id'=$2`,
      [UUIDS.tenant, UUIDS.res1],
    );
    expect(aq.rows[0].c).toBeGreaterThanOrEqual((ok1 ? 1 : 0) + (ok2 ? 1 : 0));
  }, 30_000);

  it("R13E1-06 delete time-off contemporaneo a booking create: risultato coerente, no phantom", async () => {
    const db = await pg();
    const owner = await login(UUIDS.owner);
    let phantom = 0;
    let bookingPassed = 0;
    let bookingDenied = 0;
    const ROUNDS = 20;
    for (let round = 0; round < ROUNDS; round++) {
      const dayOffset = 40 + Math.floor(round / 4);
      const hour = 13 + (round % 4);
      const s = DAYS_LATER(FIXED_MONDAY, dayOffset, hour, 0);
      const toId = `00000000-0000-4133-9014-${uuidSuffix12()}`;
      await db.query(
        `INSERT INTO public.resource_time_off (id, tenant_id, resource_id, time_off_type, starts_at, ends_at) VALUES ($1,$2,$3,'custom_block',$4,$5)`,
        [toId, UUIDS.tenant, UUIDS.res1, s, DAYS_LATER(FIXED_MONDAY, dayOffset, hour + 1, 0)],
      );
      const delTask = (async () => {
        try {
          const { data } = await callRpc(owner, "dashboard_resource_time_off_delete", {
            p_time_off_id: toId,
          });
          return codeOf(data[0]) === "OK";
        } catch {
          return false;
        }
      })();
      const bookTask = (async () => {
        const anon = anonClient();
        const slug = (
          await db.query(`SELECT slug FROM public.staff_resources WHERE id=$1`, [UUIDS.res1])
        ).rows[0].slug;
        try {
          const { data, error } = await callRpc(anon, "public_booking_create_v3", {
            p_tenant_slug: TENANT_SLUG,
            p_service_id: UUIDS.svc1,
            p_starts_at: s,
            p_resource_slug: slug,
            p_customer_name: `Phantom${round}`,
            p_customer_email: `p${round}-${randomUUID().slice(0, 6)}@test.local`,
            p_customer_phone: "+390000000777",
            p_notes: "",
          });
          return { passed: !error && data && Array.isArray(data) && data.length > 0 };
        } catch {
          return { passed: false };
        }
      })();
      const [_delOk, br] = await Promise.all([delTask, bookTask]);
      void _delOk;
      const toStillExists =
        (await db.query(`SELECT 1 FROM public.resource_time_off WHERE id=$1`, [toId])).rows.length >
        0;
      if (br.passed && toStillExists) phantom++;
      else if (br.passed) bookingPassed++;
      else bookingDenied++;
    }
    expect(phantom).toBe(0);
    expect(bookingPassed + bookingDenied).toBe(ROUNDS);
  }, 120_000);
});
