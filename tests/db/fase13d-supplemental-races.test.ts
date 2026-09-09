// @vitest-environment node
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
    console.error(`[fase13d-supp-races] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();
const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const UNIQ_RUN = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const PASSWORD = "VeloraTest12345!";
const TENANT_SLUG = "f13d-supp-r";

const UUIDS = {
  tenant: "00000000-0000-413d-9000-000000000011",
  svc1: "00000000-0000-413d-9002-000000000011",
  res1: "00000000-0000-413d-9004-000000000011",
  res2: "00000000-0000-413d-9004-000000000012",
  owner: `suppr${UNIQ_RUN}@test.local`,
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
  delta += 14;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();
function MON(h: number, m: number): string {
  const { y, mo, d } = FIXED_MONDAY;
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function END(start: string, min: number): string {
  const s = new Date(start);
  return new Date(s.valueOf() + min * 60000).toISOString();
}

async function ensureTenantFixture(): Promise<{ publicHost: string; siteId: string | null }> {
  const c = await pg();
  const svc = serviceClient();
  const cr = await svc.auth.admin.createUser({
    email: UUIDS.owner,
    password: PASSWORD,
    email_confirm: true,
  });
  if (cr.error) throw new Error("createUser owner " + cr.error.message);
  const ownerAuthId = cr.data.user.id;
  const tname = "F13D Supp Races T";
  const publicHost = `${TENANT_SLUG}-p.local`;
  await c.query(`BEGIN`);
  try {
    await c.query(`SET LOCAL session_replication_role = replica`);
    // cleanup pre-existing leftovers for same UUIDs
    await c.query(`DELETE FROM public.audit_logs WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.bookings WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.customers WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.business_schedule_exceptions WHERE tenant_id=$1`, [
      UUIDS.tenant,
    ]);
    await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.resource_availability WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.services WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.tenant_memberships WHERE user_id=$1`, [ownerAuthId]);
    await c.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.business_availability WHERE tenant_id=$1`, [UUIDS.tenant]);
    await c.query(`DELETE FROM public.tenants WHERE id=$1`, [UUIDS.tenant]);

    await c.query(
      `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at)
       VALUES ($1,$2,$3,'active','pro',TRUE,NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [UUIDS.tenant, TENANT_SLUG, tname],
    );
    await c.query(
      `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
       VALUES ($1,$2,'Europe/Rome','it-IT','+3902','info-sr@velora.test','Via F 123','Milano',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [UUIDS.tenant, tname + " SRL"],
    );
    for (const wd of [1, 2, 3, 4, 5]) {
      await c.query(
        `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ($1,$2,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [UUIDS.tenant, wd],
      );
    }
    await c.query(
      `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,'owner','active',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), ownerAuthId, UUIDS.tenant],
    );
    await c.query(
      `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
       VALUES ($1,$2,'res1','Supp R Op1',TRUE,TRUE,1,'#0f172a',NOW(),NOW()),
              ($3,$2,'res2','Supp R Op2',TRUE,TRUE,2,'#0ea5e9',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [UUIDS.res1, UUIDS.tenant, UUIDS.res2],
    );
    await c.query(
      `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
       VALUES ($1,$2,'Svc Supp R',30,25::numeric,'EUR',TRUE,1,NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [UUIDS.svc1, UUIDS.tenant],
    );
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
       VALUES ($1,$2,$3,TRUE,NOW(),NOW()),($1,$4,$3,TRUE,NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [UUIDS.tenant, UUIDS.res1, UUIDS.svc1, UUIDS.res2],
    );
    for (let dow = 1; dow <= 5; dow++) {
      await c.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ($1,$2,$3,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [UUIDS.tenant, UUIDS.res1, dow],
      );
      await c.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ($1,$2,$3,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [UUIDS.tenant, UUIDS.res2, dow],
      );
    }
    await c.query(`COMMIT`);
  } catch (e) {
    await c.query(`ROLLBACK`);
    throw e;
  }
  // ensure login works (confirm user via signIn)
  const r = await anonClient().auth.signInWithPassword({ email: UUIDS.owner, password: PASSWORD });
  if (r.error) throw new Error("owner login failed " + r.error.message);
  return { publicHost, siteId: null };
}

async function countConfirmedBookingsAt(
  p: PgClient,
  tenantId: string,
  startISO: string,
  endISO: string,
  resourceId?: string,
): Promise<number> {
  const sql = resourceId
    ? `SELECT COUNT(*)::int c FROM public.bookings WHERE tenant_id=$1 AND resource_id=$4 AND status='confirmed' AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`
    : `SELECT COUNT(*)::int c FROM public.bookings WHERE tenant_id=$1 AND status='confirmed' AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`;
  const args = resourceId
    ? [tenantId, startISO, endISO, resourceId]
    : ([tenantId, startISO, endISO] as unknown[]);
  const r = await p.query<{ c: number }>(sql, args);
  return r.rows[0]!.c;
}

describe("F13D Supplemental Races B/E standalone (no public-v3)", { timeout: 180000 }, () => {
  beforeAll(async () => {
    await ensureTenantFixture();
  }, 60000);
  afterAll(async () => {
    await pgClose();
  });

  it("RACE-B: 20 ANY same time 2 resources capacity 1 each => 1 or 2 winners max (per resource)", async () => {
    const start = MON(11, 0);
    const end = END(start, 30);
    const pgC = await pg();
    // Cross-suite contamination guard: any bookings/time_off/bse in MON(11,0) range
    // from prior suites will alter capacity or cause deadlock/lock-invert. Clean first.
    await pgC.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgC.query(
      `DELETE FROM public.bookings
       WHERE tenant_id = $1::uuid
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, start, end],
    );
    await pgC.query(
      `DELETE FROM public.resource_time_off
       WHERE tenant_id = $1::uuid
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, start, end],
    );
    await pgC.query(
      `DELETE FROM public.business_schedule_exceptions
       WHERE tenant_id = $1::uuid
         AND exception_type IN ('closure','slot_block')
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, start, end],
    );
    await pgC.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    const initial = await countConfirmedBookingsAt(pgC, UUIDS.tenant, start, end);
    expect(initial).toBe(0);
    const ownerCl = await login(UUIDS.owner);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }).map(async () => {
          const suf = randomUUID().slice(0, 10);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await ownerCl.rpc("dashboard_booking_manual_create" as any, {
            p_customer_id: null,
            p_customer_name: "RaceB " + suf,
            p_customer_email: "raceb-" + suf + "@test.local",
            p_customer_phone:
              "+39" + String(Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000)),
            p_service_id: UUIDS.svc1,
            p_starts_at: start,
            p_resource_slug: "any",
            p_notes: null,
          });
          if (r.error)
            return { ok: false, code: "RPC_ERROR:" + (r.error as { message?: string }).message };
          const row = ((Array.isArray(r.data) ? r.data[0] : r.data) ?? {}) as {
            code?: string;
          };
          const ok = !!(row && row.code === "OK");
          return { ok, code: row?.code ?? "?" };
        }),
      );
      const winners = results.filter((x) => x.ok).length;
      const losers = results.filter((x) => !x.ok).length;
      expect(winners).toBeGreaterThanOrEqual(1);
      expect(winners).toBeLessThanOrEqual(2);
      expect(winners + losers).toBe(results.length);
      const after = await countConfirmedBookingsAt(pgC, UUIDS.tenant, start, end);
      expect(after).toBe(winners);
    } finally {
      // POST-RACE idempotency cleanup: remove any data created in this test so
      // a subsequent full-vitest run WITHOUT db:reset still sees empty fixture ranges.
      await pgC.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await pgC.query(
        `DELETE FROM public.bookings
         WHERE tenant_id = $1::uuid
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, start, end],
      );
      await pgC.query(
        `DELETE FROM public.resource_time_off
         WHERE tenant_id = $1::uuid
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, start, end],
      );
      await pgC.query(
        `DELETE FROM public.business_schedule_exceptions
         WHERE tenant_id = $1::uuid
           AND exception_type IN ('closure','slot_block')
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, start, end],
      );
      await pgC.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    }
  }, 60000);

  it("RACE-E: 2 concurrent reschedule same booking same expected_rev => 1 OK 1 CONCURRENT_UPDATE rev+1", async () => {
    const pgC = await pg();
    const ownerCl = await login(UUIDS.owner);
    const baseStart = MON(14, 0);
    const newStart = MON(15, 0);
    const newStart2 = MON(16, 0);
    // Cross-suite contamination guard: clean range 14:00-16:30 (base start + both new starts 30min).
    const _cleanStart = baseStart;
    const _cleanEnd = END(newStart2, 30);
    await pgC.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgC.query(
      `DELETE FROM public.bookings
       WHERE tenant_id = $1::uuid
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, _cleanStart, _cleanEnd],
    );
    await pgC.query(
      `DELETE FROM public.resource_time_off
       WHERE tenant_id = $1::uuid
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, _cleanStart, _cleanEnd],
    );
    await pgC.query(
      `DELETE FROM public.business_schedule_exceptions
       WHERE tenant_id = $1::uuid
         AND exception_type IN ('closure','slot_block')
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [UUIDS.tenant, _cleanStart, _cleanEnd],
    );
    await pgC.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pre = await ownerCl.rpc("dashboard_booking_manual_create" as any, {
        p_customer_id: null,
        p_customer_name: "RaceE Target B",
        p_customer_email: "racee-" + randomUUID().slice(0, 8) + "@test.local",
        p_customer_phone: "+390000000011",
        p_service_id: UUIDS.svc1,
        p_starts_at: baseStart,
        p_resource_slug: "res1",
        p_notes: null,
      });
      expect(pre.error).toBeFalsy();
      const preRow = ((Array.isArray(pre.data) ? pre.data[0] : pre.data) ?? {}) as {
        code?: string;
        booking_id?: string;
        revision?: number;
      };
      expect(preRow.code).toBe("OK");
      const bookingId = preRow.booking_id!;
      const revQ = await pgC.query(`SELECT revision FROM public.bookings WHERE id=$1 LIMIT 1`, [
        bookingId,
      ]);
      const rev0 = Number(revQ.rows[0]?.revision ?? preRow.revision ?? 1);
      const results = await Promise.all([
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await ownerCl.rpc("dashboard_booking_reschedule" as any, {
            p_booking_id: bookingId,
            p_expected_revision: rev0,
            p_new_starts_at: newStart,
            p_new_resource_slug: "same",
            p_new_service_id: null,
          });
          if (r.error) return { ok: false, code: "RPC_ERROR" };
          const row = ((Array.isArray(r.data) ? r.data[0] : r.data) ?? {}) as { code?: string };
          return { ok: row.code === "OK", code: row.code ?? "" };
        })(),
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await ownerCl.rpc("dashboard_booking_reschedule" as any, {
            p_booking_id: bookingId,
            p_expected_revision: rev0,
            p_new_starts_at: newStart2,
            p_new_resource_slug: "same",
            p_new_service_id: null,
          });
          if (r.error) return { ok: false, code: "RPC_ERROR" };
          const row = ((Array.isArray(r.data) ? r.data[0] : r.data) ?? {}) as { code?: string };
          return { ok: row.code === "OK", code: row.code ?? "" };
        })(),
      ]);
      const winners = results.filter((x) => x.ok).length;
      const concurrent = results.filter((x) => !x.ok && x.code === "CONCURRENT_UPDATE").length;
      const rpcErrors = results.filter((x) => !x.ok && x.code === "RPC_ERROR").length;
      // Race safety invariant: EXACTLY 1 winner (optimistic-lock revision +1 plus
      // final starts_at being one of the two proposed logically guarantees a
      // single successful reschedule; winners=0 would mean no change was applied,
      // which contradicts rev+1 and final-start match). winners>1 would be a
      // lost-update / double-write safety violation.
      expect(winners).toBe(1);
      expect(winners + concurrent + rpcErrors).toBe(2);
      expect(concurrent).toBe(1);
      const after = await pgC.query(`SELECT starts_at, revision FROM public.bookings WHERE id=$1`, [
        bookingId,
      ]);
      expect(after.rows[0]!.revision).toBe(rev0 + 1);
      const finalStartISO = new Date(after.rows[0]!.starts_at as string).toISOString();
      const okFinal =
        finalStartISO === new Date(newStart).toISOString() ||
        finalStartISO === new Date(newStart2).toISOString();
      expect(okFinal).toBe(true);
    } finally {
      // POST-RACE idempotency cleanup: restore empty fixture range 14..16:30.
      await pgC.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await pgC.query(
        `DELETE FROM public.bookings
         WHERE tenant_id = $1::uuid
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, _cleanStart, _cleanEnd],
      );
      await pgC.query(
        `DELETE FROM public.resource_time_off
         WHERE tenant_id = $1::uuid
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, _cleanStart, _cleanEnd],
      );
      await pgC.query(
        `DELETE FROM public.business_schedule_exceptions
         WHERE tenant_id = $1::uuid
           AND exception_type IN ('closure','slot_block')
           AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        [UUIDS.tenant, _cleanStart, _cleanEnd],
      );
      await pgC.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    }
  }, 60000);
});
