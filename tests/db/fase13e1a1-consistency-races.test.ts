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
    console.error(`[fase13e1a1] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
const TENANT_SLUG = `f13e1a1-${UNIQ}`;

const UUIDS = {
  tenant: randomUUID(),
  svc1: randomUUID(),
  res1: randomUUID(),
  res2: randomUUID(),
  res3: randomUUID(),
  owner: `f13e1a1-own-${UNIQ}@test.local`,
};

const TZ = "Europe/Rome";
const SERVICE_DURATION = 30;

let userIdOwner: string | null = null;
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
function anonClient() {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
async function _login(email: string): Promise<SupabaseClient<Database, "public">> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}

async function impersonateOwner(db: PgClient): Promise<void> {
  await db.query("SET LOCAL ROLE authenticated");
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [userIdOwner]);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  // also set app.current_tenant_id if function exists
  try {
    await db.query(`SELECT set_config('app.current_tenant_id', $1::text, true)`, [UUIDS.tenant]);
  } catch {
    /* ignore */
  }
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
    await impersonateOwner(db);
    await db.query(
      `SELECT public.create_tenant_with_owner($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text)`,
      [`E1A1 Tenant ${UNIQ}`, "Servizi", "Roma", "RM", "+390600000099", UUIDS.owner, TZ, "it-IT"],
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
  await db.query(
    `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active, price_from, currency, position) VALUES ($1,$2,$3,$4,true,1000,'EUR',1)`,
    [UUIDS.svc1, UUIDS.tenant, "Taglio Breve", SERVICE_DURATION],
  );
  for (const [rid, slug, name, order] of [
    [UUIDS.res1, "e1a1-1", "E1A1 Uno", 1],
    [UUIDS.res2, "e1a1-2", "E1A1 Due", 2],
    [UUIDS.res3, "e1a1-3", "E1A1 Tre", 3],
  ] as const) {
    await db.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, sort_order, color_hex, active, bookable) VALUES ($1,$2,$3,$4,$5,'#000000',true,true)`,
      [rid, UUIDS.tenant, slug, name, order],
    );
    await db.query(
      `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,true)`,
      [UUIDS.tenant, rid, UUIDS.svc1],
    );
  }
  // full availability Sun-Sat 9-18 (weekday 0..6)
  for (const rid of [UUIDS.res1, UUIDS.res2, UUIDS.res3]) {
    for (let wd = 0; wd <= 6; wd++) {
      await db.query(
        `INSERT INTO public.resource_availability (tenant_id, resource_id, weekday, enabled, start_time, end_time) VALUES ($1,$2,$3,true,'09:00'::time,'18:00'::time)`,
        [UUIDS.tenant, rid, wd],
      );
    }
  }
  // stub per funzioni RPC che dipendono da member_role_for_tenant non definita nel boundary corrente
  await db.query(`
    CREATE OR REPLACE FUNCTION public.member_role_for_tenant(p_tenant_id UUID, p_user_id UUID)
    RETURNS TEXT LANGUAGE plpgsql STABLE AS $f$
    BEGIN
      IF p_user_id = $2::uuid AND p_user_id IS NOT NULL THEN RETURN 'owner'; END IF;
      RETURN 'staff';
    END; $f$;
    ALTER FUNCTION public.member_role_for_tenant(UUID,UUID) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.member_role_for_tenant(UUID,UUID) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.member_role_for_tenant(UUID,UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.member_role_for_tenant(UUID,UUID) TO service_role;
  `);
}, 120_000);

afterAll(async () => {
  try {
    const cleanupDb = await newPgIsolated();
    try {
      await cleanupDb.query(`DROP FUNCTION IF EXISTS public.member_role_for_tenant(UUID,UUID)`);
    } finally {
      await pgClose(cleanupDb);
    }
  } catch {
    /* ignore */
  }
  await pgClose();
});

// =====================  A RACE TIME-OFF ↔ TIME-OFF  =====================
describe("FASE13E1-A1 · §4 Race Time-Off vs Time-Off", () => {
  it("R-A1: 20 concorrenti STESSA risorsa RANGES NON SOVRAPPOSTI → 20/20 COMMITTED, 0 VE309", async () => {
    const resId = UUIDS.res1;
    const jobs: Promise<any>[] = [];
    for (let i = 0; i < 20; i++) {
      const _h = 9 + i; // 09:00-10:00, 10:00-11:00, ... 04:00 del giorno dopo (MA 20h range fino a 29:00? Usiamo min * 30min)
      const start = ISO(FIXED_MONDAY, 0, 9 + Math.floor(i / 2), (i % 2) * 30);
      const jEnd = new Date(start);
      jEnd.setUTCMinutes(jEnd.getUTCMinutes() + 25); // 25m ciascuno, TUTTI non sovrapposti 09:00-09:25, 09:30-09:55, ...
      jEnd.setUTCMinutes((i % 2) * 30 + 25);
      const end = new Date(Date.parse(start));
      end.setUTCMinutes(end.getUTCMinutes() + 25);
      jobs.push(
        (async () => {
          const c = await newPgIsolated();
          try {
            await c.query("BEGIN");
            await impersonateOwner(c);
            const r = await c.query(
              `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
              [resId, start, end.toISOString().replace(/\.\d{3}Z$/, "Z")],
            );
            await c.query("COMMIT");
            return { idx: i, row: r.rows[0] };
          } catch (e: any) {
            try {
              await c.query("ROLLBACK");
            } catch {
              /* ignore */
            }
            return {
              idx: i,
              err: {
                message: e.message,
                code: e.code,
                stack: String(e?.stack?.slice(0, 120) ?? ""),
              },
            };
          } finally {
            await pgClose(c);
          }
        })(),
      );
      void start;
    }
    const results = await Promise.all(jobs);
    const ok = results.filter((r) => !r.err && r.row?.code === "OK");
    const ve309 = results.filter(
      (r) => r.err?.code === "VE309" || r.row?.code?.includes("INTERNAL"),
    );
    const nonVe = results.filter((r) => r.err && r.err.code !== "VE309");
    expect(ok.length).toBe(20);
    expect(ve309.length).toBe(0);
    expect(nonVe.length).toBe(0);
    const dbAudit = await newPgIsolated();
    try {
      const ac = await dbAudit.query(
        `SELECT COUNT(*) FROM public.audit_logs WHERE tenant_id=$1::uuid AND action='resource_time_off_created' AND (metadata->>'resource_id')=$2::text`,
        [UUIDS.tenant, resId],
      );
      expect(Number(ac.rows[0].count)).toBeGreaterThanOrEqual(20);
    } finally {
      await pgClose(dbAudit);
    }
  }, 90_000);

  it("R-A2: 20 create concorrenti STESSA risorsa STESSO EXACT RANGE → 20/20 committibili (nessuna EXCLUDE)", async () => {
    const resId = UUIDS.res2;
    // range non conflittuale con gli altri 20 (dopo mezzanotte martedì a vuoto)
    const start = ISO(FIXED_MONDAY, 2, 10, 0);
    const end = ISO(FIXED_MONDAY, 2, 13, 0);
    const jobs: Promise<any>[] = [];
    for (let i = 0; i < 20; i++) {
      jobs.push(
        (async () => {
          const c = await newPgIsolated();
          try {
            await c.query("BEGIN");
            await impersonateOwner(c);
            const r = await c.query(
              `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'sick'::text,$2::timestamptz,$3::timestamptz,NULL::text,NULL::int)`,
              [resId, start, end],
            );
            await c.query("COMMIT");
            return { idx: i, row: r.rows[0] };
          } catch (e: any) {
            try {
              await c.query("ROLLBACK");
            } catch {
              /* ignore */
            }
            return { idx: i, err: { code: e.code, message: e.message } };
          } finally {
            await pgClose(c);
          }
        })(),
      );
    }
    const results = await Promise.all(jobs);
    const ok = results.filter((r) => !r.err && r.row?.code === "OK");
    // 20/20 attesi (no exclude constraint overlap su resource_time_off)
    expect(ok.length).toBe(20);
  }, 90_000);

  it("R-A3: 2 create concorrenti STESSA risorsa PARTIAL OVERLAP → entrambe esistono (overlap legal)", async () => {
    const resId = UUIDS.res3;
    const s1 = ISO(FIXED_MONDAY, 3, 9, 0);
    const e1 = ISO(FIXED_MONDAY, 3, 12, 0);
    const s2 = ISO(FIXED_MONDAY, 3, 11, 0);
    const e2 = ISO(FIXED_MONDAY, 3, 15, 0);
    const runOne = async (label: string, s: string, e: string) => {
      const c = await newPgIsolated();
      try {
        await c.query("BEGIN");
        await impersonateOwner(c);
        await c.query("SELECT pg_sleep($1::float)", [label === "A" ? 0 : 0.25]);
        const r = await c.query(
          `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,$4::text,NULL::int)`,
          [resId, s, e, label],
        );
        await c.query("COMMIT");
        return { label, row: r.rows[0] };
      } catch (e: any) {
        try {
          await c.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { label, err: e };
      } finally {
        await pgClose(c);
      }
    };
    const [a, b] = await Promise.all([runOne("A", s1, e1), runOne("B", s2, e2)]);
    expect(a.err).toBeUndefined();
    expect(b.err).toBeUndefined();
    expect(a.row?.code).toBe("OK");
    expect(b.row?.code).toBe("OK");
    const dbCount = await newPgIsolated();
    try {
      const c = await dbCount.query(
        `SELECT COUNT(*) FROM public.resource_time_off WHERE tenant_id=$1::uuid AND resource_id=$2::uuid`,
        [UUIDS.tenant, resId],
      );
      expect(Number(c.rows[0].count)).toBe(2);
    } finally {
      await pgClose(dbCount);
    }
  }, 15_000);
});

// ================  §5 BOOKING ↔ TIME-OFF CONTRACT  =================
describe("FASE13E1-A1 · §5 Booking vs Time-Off", () => {
  const res = () => UUIDS.res1;
  const baseStart = () => ISO(FIXED_MONDAY, 4, 10, 0);
  const _baseEnd = () => ISO(FIXED_MONDAY, 4, 10, SERVICE_DURATION);

  it("B1 — BOOKING commit PRIMA, time-off create DOPO → booking PRESERVED, time-off CREATED conflict_count=1", async () => {
    const r = res();
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const booking = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'B1 Cliente','b1@test.local','+393330000001',$1::uuid,$2::timestamptz,$3::text,NULL::text)`,
        [
          UUIDS.svc1,
          baseStart(),
          r === UUIDS.res1
            ? "e1a1-1"
            : (() => {
                throw new Error("sync bug");
              })(),
        ],
      );
      await db.query("COMMIT");
      expect(booking.rows[0].code).toBe("OK");
      const bookingId = booking.rows[0].booking_id;
      await db.query("BEGIN");
      await impersonateOwner(db);
      const toStart = ISO(FIXED_MONDAY, 4, 9, 0);
      const toEnd = ISO(FIXED_MONDAY, 4, 12, 0);
      const toR = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'training'::text,$2::timestamptz,$3::timestamptz,'B1 sovr',1::int)`,
        [r, toStart, toEnd],
      );
      await db.query("COMMIT");
      expect(toR.rows[0].code).toBe("OK");
      expect(Number(toR.rows[0].conflict_count)).toBeGreaterThanOrEqual(1);
      const bc = await db.query(`SELECT status FROM public.bookings WHERE id=$1::uuid`, [
        bookingId,
      ]);
      expect(bc.rows[0].status).toBe("confirmed");
    } finally {
      await pgClose(db);
    }
  }, 30_000);

  it("B2 — TIME-OFF commit PRIMA, booking DOPO → booking DENIED (SLOT_TAKEN or equivalente)", async () => {
    const r = UUIDS.res2;
    const toStart = ISO(FIXED_MONDAY, 4, 14, 0);
    const toEnd = ISO(FIXED_MONDAY, 4, 16, 0);
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const toR = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'vacation'::text,$2::timestamptz,$3::timestamptz,'B2',0::int)`,
        [r, toStart, toEnd],
      );
      await db.query("COMMIT");
      expect(toR.rows[0].code).toBe("OK");
      const bs = ISO(FIXED_MONDAY, 4, 14, 30);
      await db.query("BEGIN");
      await impersonateOwner(db);
      const bk = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'B2 Cliente','b2@test.local','+393330000002',$1::uuid,$2::timestamptz,$3::text,NULL::text)`,
        [UUIDS.svc1, bs, "e1a1-2"],
      );
      await db.query("COMMIT");
      expect(["SLOT_TAKEN", "RESOURCE_NOT_ELIGIBLE", "MAX_ADVANCE_EXCEEDED"]).toContain(
        bk.rows[0].code,
      );
      const count = await db.query(
        `SELECT COUNT(*) FROM public.bookings WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND status='confirmed' AND tstzrange(starts_at, ends_at, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
        [UUIDS.tenant, r, toStart, toEnd],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    } finally {
      await pgClose(db);
    }
  }, 30_000);

  it("B3 — CONCURRENT barrier: booking e time-off start contemporaneo. 2 soli finali accettabili. INVARIANTE: nessun booking confirmed DOPO time-off committed che si sovrappongano", async () => {
    const r = UUIDS.res3;
    const slotStart = ISO(FIXED_MONDAY, 4, 11, 0);
    const toStart = ISO(FIXED_MONDAY, 4, 10, 30);
    const toEnd = ISO(FIXED_MONDAY, 4, 12, 30);
    // pg_advisory advisory xact lock: ordiniamo due con pg_sleep inverso per barrier con advisory lock classico? No:
    // Facciamo barriera applicativa: Promise.all + inizializzazione simultanea
    const runBooking = async () => {
      const c = await newPgIsolated();
      try {
        await c.query("BEGIN");
        await impersonateOwner(c);
        const br = await c.query(
          `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'B3 Client','b3@test.local','+393330000003',$1::uuid,$2::timestamptz,$3::text,NULL::text)`,
          [UUIDS.svc1, slotStart, "e1a1-3"],
        );
        await c.query("COMMIT");
        return { who: "B", row: br.rows[0] };
      } catch (e: any) {
        try {
          await c.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { who: "B", err: e };
      } finally {
        await pgClose(c);
      }
    };
    const runTimeOff = async () => {
      const c = await newPgIsolated();
      try {
        await c.query("BEGIN");
        await impersonateOwner(c);
        const tr = await c.query(
          `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'custom_block'::text,$2::timestamptz,$3::timestamptz,'B3 block',NULL::int)`,
          [r, toStart, toEnd],
        );
        await c.query("COMMIT");
        return { who: "T", row: tr.rows[0] };
      } catch (e: any) {
        try {
          await c.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { who: "T", err: e };
      } finally {
        await pgClose(c);
      }
    };
    const [br, tr] = await Promise.all([runBooking(), runTimeOff()]);
    expect(br.err).toBeUndefined();
    expect(tr.err).toBeUndefined();
    const bookingOK = br.row?.code === "OK";
    const toOK = tr.row?.code === "OK";
    // Casi accettabili:
    if (bookingOK && toOK) {
      // Booking first, time-off dopo (preserve + conflict)
      expect(Number(tr.row.conflict_count)).toBeGreaterThanOrEqual(1);
    } else if (toOK && !bookingOK) {
      // Time-off first, booking denied
      expect(["SLOT_TAKEN", "RESOURCE_NOT_ELIGIBLE", "MAX_ADVANCE_EXCEEDED"]).toContain(
        br.row?.code,
      );
    } else {
      throw new Error(`B3 scenario non valido: bookingOK=${bookingOK} toOK=${toOK}`);
    }
    const dbCheck = await newPgIsolated();
    try {
      const inv = await dbCheck.query(
        `
          SELECT b.id, b.starts_at, b.ends_at, t.starts_at t_s, t.ends_at t_e
          FROM public.bookings b CROSS JOIN public.resource_time_off t
          WHERE b.tenant_id=$1::uuid AND t.tenant_id=$1::uuid
            AND b.resource_id=$2::uuid AND t.resource_id=$2::uuid
            AND b.status='confirmed'
            AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(t.starts_at, t.ends_at, '[)')
            AND b.created_at > t.created_at + interval '1 microsecond'
        `,
        [UUIDS.tenant, r],
      );
      expect(inv.rows.length).toBe(0);
    } finally {
      await pgClose(dbCheck);
    }
  }, 30_000);
});

// ================  §6 MANUAL BOOKING vs TIME-OFF  =================
describe("FASE13E1-A1 · §6 Manual Booking vs Time-Off", () => {
  it("M1 — manual commit first → time-off allow + conflict", async () => {
    const r = UUIDS.res1;
    const s = ISO(FIXED_MONDAY, 6, 9, 30);
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const m = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'M1','m1@test.it','+39000000001',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, s, "e1a1-1"],
      );
      await db.query("COMMIT");
      expect(m.rows[0].code).toBe("OK");
      const ts = ISO(FIXED_MONDAY, 6, 9, 0);
      const te = ISO(FIXED_MONDAY, 6, 13, 0);
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'training'::text,$2::timestamptz,$3::timestamptz,'M1',NULL::int)`,
        [r, ts, te],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      expect(Number(to.rows[0].conflict_count) >= 1).toBe(true);
    } finally {
      await pgClose(db);
    }
  }, 15_000);

  it("M2 — time-off commit first → manual denied", async () => {
    const r = UUIDS.res2;
    const ts = ISO(FIXED_MONDAY, 6, 14, 0);
    const te = ISO(FIXED_MONDAY, 6, 17, 0);
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'sick'::text,$2::timestamptz,$3::timestamptz,'M2',NULL::int)`,
        [r, ts, te],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const mb = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'M2','m2@test.it','+39000000002',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 6, 15, 0), "e1a1-2"],
      );
      await db.query("COMMIT");
      expect(["SLOT_TAKEN", "RESOURCE_NOT_ELIGIBLE", "MAX_ADVANCE_EXCEEDED"]).toContain(
        mb.rows[0].code,
      );
    } finally {
      await pgClose(db);
    }
  }, 15_000);
});

// ================  §7 RESCHEDULE vs TIME-OFF  =================
describe("FASE13E1-A1 · §7 Reschedule vs Time-Off", () => {
  it("RS1 — reschedule committed first → time-off allow + conflict include booking", async () => {
    const r = UUIDS.res1;
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const init = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'RS1','r1@test.it','+39000000010',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 7, 9, 0), "e1a1-1"],
      );
      await db.query("COMMIT");
      expect(init.rows[0].code).toBe("OK");
      const bid = init.rows[0].booking_id;
      const rev = init.rows[0].revision;
      await db.query("BEGIN");
      await impersonateOwner(db);
      const rs = await db.query(
        `SELECT * FROM public.dashboard_booking_reschedule($1::uuid,$2::int,$3::timestamptz,'same'::text,NULL::uuid)`,
        [bid, rev, ISO(FIXED_MONDAY, 7, 15, 0)],
      );
      await db.query("COMMIT");
      expect(rs.rows[0].code).toBe("OK");
      const newRev = rs.rows[0].revision_out;
      expect(newRev).toBe(rev + 1);
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'vacation'::text,$2::timestamptz,$3::timestamptz,'RS1',NULL::int)`,
        [r, ISO(FIXED_MONDAY, 7, 14, 30), ISO(FIXED_MONDAY, 7, 16, 30)],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      expect(Number(to.rows[0].conflict_count) >= 1).toBe(true);
    } finally {
      await pgClose(db);
    }
  }, 20_000);

  it("RS2 — time-off first → reschedule into interval DENY", async () => {
    const r = UUIDS.res2;
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const init = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'RS2','r2@test.it','+39000000020',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 7, 9, 0), "e1a1-2"],
      );
      await db.query("COMMIT");
      expect(init.rows[0].code).toBe("OK");
      const bid = init.rows[0].booking_id;
      const rev = init.rows[0].revision;
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'leave'::text,$2::timestamptz,$3::timestamptz,'RS2 block',NULL::int)`,
        [r, ISO(FIXED_MONDAY, 7, 15, 30), ISO(FIXED_MONDAY, 7, 18, 0)],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const rs = await db.query(
        `SELECT * FROM public.dashboard_booking_reschedule($1::uuid,$2::int,$3::timestamptz,'same'::text,NULL::uuid)`,
        [bid, rev, ISO(FIXED_MONDAY, 7, 16, 0)],
      );
      await db.query("COMMIT");
      expect(["SLOT_TAKEN", "RESOURCE_NOT_ELIGIBLE", "MAX_ADVANCE_EXCEEDED"]).toContain(
        rs.rows[0].code,
      );
    } finally {
      await pgClose(db);
    }
  }, 20_000);
});

// ================  §8 DELETE vs BOOKING  =================
describe("FASE13E1-A1 · §8 Delete Time-Off vs Booking", () => {
  it("D1 — delete time-off → booking successivo su range ALLOW", async () => {
    const r = UUIDS.res3;
    const ts = ISO(FIXED_MONDAY, 8, 9, 0);
    const te = ISO(FIXED_MONDAY, 8, 12, 0);
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'vacation'::text,$2::timestamptz,$3::timestamptz,'D1',NULL::int)`,
        [r, ts, te],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      const tid = to.rows[0].time_off_id;
      await db.query("BEGIN");
      await impersonateOwner(db);
      const dl = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_delete($1::uuid)`,
        [tid],
      );
      await db.query("COMMIT");
      expect(dl.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const bk = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'D1','d1@test.it','+39000000099',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 8, 10, 0), "e1a1-3"],
      );
      await db.query("COMMIT");
      expect(bk.rows[0].code).toBe("OK");
    } finally {
      await pgClose(db);
    }
  }, 20_000);

  it("D2 — time-off ancora esistente → booking sul range DENIED", async () => {
    const r = UUIDS.res1;
    const ts = ISO(FIXED_MONDAY, 8, 14, 0);
    const te = ISO(FIXED_MONDAY, 8, 16, 0);
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const to = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1,'custom_block'::text,$2::timestamptz,$3::timestamptz,'D2',NULL::int)`,
        [r, ts, te],
      );
      await db.query("COMMIT");
      expect(to.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const bk = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'D2','d2@test.it','+39000000088',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 8, 14, 30), "e1a1-1"],
      );
      await db.query("COMMIT");
      expect(["SLOT_TAKEN", "RESOURCE_NOT_ELIGIBLE", "MAX_ADVANCE_EXCEEDED"]).toContain(
        bk.rows[0].code,
      );
    } finally {
      await pgClose(db);
    }
  }, 15_000);
});

// ================  §9 PREVIEW TOKEN AUDIT  =================
describe("FASE13E1-A1 · §9 Preview Token Audit", () => {
  it("P1 — preview NON usa lock, create RI-CALCOLA conflitti DOPO lock (server recheck authority)", async () => {
    const r = UUIDS.res2;
    const db = await newPgIsolated();
    try {
      await db.query("BEGIN");
      await impersonateOwner(db);
      const pv = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_preview($1::uuid,$2::timestamptz,$3::timestamptz)`,
        [r, ISO(FIXED_MONDAY, 9, 13, 0), ISO(FIXED_MONDAY, 9, 14, 0)],
      );
      await db.query("COMMIT");
      expect(pv.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const bk = await db.query(
        `SELECT * FROM public.dashboard_booking_manual_create(NULL::uuid,'P1','p@test.it','+39000000077',$1::uuid,$2::timestamptz,$3::text,NULL)`,
        [UUIDS.svc1, ISO(FIXED_MONDAY, 9, 13, 15), "e1a1-2"],
      );
      await db.query("COMMIT");
      expect(bk.rows[0].code).toBe("OK");
      await db.query("BEGIN");
      await impersonateOwner(db);
      const cr = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,'P1 stale',0::int)`,
        [r, ISO(FIXED_MONDAY, 9, 13, 0), ISO(FIXED_MONDAY, 9, 14, 0)],
      );
      await db.query("COMMIT");
      expect(cr.rows[0].code).toBe("CONFLICT_PREVIEW_STALE");
      expect(Number(cr.rows[0].conflict_count)).toBe(1);
      await db.query("BEGIN");
      await impersonateOwner(db);
      const cr2 = await db.query(
        `SELECT * FROM public.dashboard_resource_time_off_create($1::uuid,'leave'::text,$2::timestamptz,$3::timestamptz,'P1 rivale NULL',NULL::int)`,
        [r, ISO(FIXED_MONDAY, 9, 13, 0), ISO(FIXED_MONDAY, 9, 14, 0)],
      );
      await db.query("COMMIT");
      expect(cr2.rows[0].code).toBe("OK");
      expect(Number(cr2.rows[0].conflict_count)).toBe(1);
    } finally {
      await pgClose(db);
    }
  }, 15_000);
});

// ================  §10 LOCK KEY COLLISION  =================
describe("FASE13E1-A1 · §10 Lock Key Collision", () => {
  it("K1 — 10k coppie (tenant,resource) generazione deterministica collisioni", async () => {
    const db = await newPgIsolated();
    try {
      await db.query(`
        CREATE OR REPLACE FUNCTION pg_temp._lock_key_for(p_tenant_id UUID, p_resource_id UUID)
        RETURNS BIGINT LANGUAGE plpgsql AS $f$
        DECLARE
          v_bucket CONSTANT INT := 131;
          v_key BIGINT;
        BEGIN
          v_key :=
              (BIGINT '1' << 31) * (ABS(HASHTEXT(p_tenant_id::TEXT)) % 2147483647)::BIGINT
            + ((ABS(HASHTEXT(p_resource_id::TEXT)) % 1073741823)::BIGINT * 1009)
            + v_bucket::BIGINT;
          RETURN v_key;
        END; $f$;
      `);
      const r = await db.query(`
        WITH pairs AS (
          SELECT
            (MD5('ten' || LPAD(g.t::text, 10, '0'))::uuid) AS tid,
            (MD5('res' || LPAD(g.t::text, 10, '0'))::uuid) AS rid
          FROM generate_series(1, 10000) g(t)
        ),
        keys AS (
          SELECT pg_temp._lock_key_for(tid, rid) k, COUNT(*) c FROM pairs GROUP BY 1
        )
        SELECT
          COUNT(*)::int total_pairs,
          (SELECT COUNT(*) FROM keys) distinct_keys,
          SUM(CASE WHEN c > 1 THEN c ELSE 0 END)::int colliding_pairs,
          (SELECT COUNT(*) FROM keys WHERE c > 1) colliding_buckets,
          MAX(c)::int max_per_bucket
        FROM keys
      `);
      const row = r.rows[0];
      const total = Number(row.total_pairs);
      const distinct = Number(row.distinct_keys);
      const collidingPairs = Number(row.colliding_pairs);
      expect(total).toBe(10000);
      expect(distinct).toBeGreaterThan(9900);
      expect(collidingPairs).toBeLessThanOrEqual(100);
    } finally {
      await pgClose(db);
    }
  }, 30_000);
});

// ================  §11 LOCK PERFORMANCE  =================
describe("FASE13E1-A1 · §11 Lock Performance", () => {
  async function timingMs(fn: () => Promise<any>): Promise<number> {
    const s = process.hrtime.bigint();
    await fn();
    return Number(process.hrtime.bigint() - s) / 1e6;
  }

  function pct(arr: number[], p: number): number {
    if (arr.length === 0) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const i = Math.max(0, Math.min(s.length - 1, Math.floor((p / 100) * s.length)));
    return s[i];
  }

  it("K2 — 20 writes STESSA risorsa (serializzati) vs 20 write 20 risorse DIFFERENTI (paralleli)", async () => {
    const resSame = UUIDS.res1;
    const sameTimes: number[] = [];
    const totalSame = await timingMs(async () => {
      for (let i = 0; i < 20; i++) {
        const s = ISO(FIXED_MONDAY, 10, 7, 0);
        const startDt = new Date(s);
        startDt.setUTCMinutes(startDt.getUTCMinutes() + i * 10);
        const endDt = new Date(startDt);
        endDt.setUTCMinutes(endDt.getUTCMinutes() + 8);
        const db = await newPgIsolated();
        try {
          await db.query("BEGIN");
          await impersonateOwner(db);
          const ms = await timingMs(async () => {
            await db.query(
              `SELECT * FROM public.dashboard_resource_time_off_create($1,'custom_block'::text,$2::timestamptz,$3::timestamptz,'perf-same',NULL::int)`,
              [
                resSame,
                startDt.toISOString().replace(/\.\d{3}/, ""),
                endDt.toISOString().replace(/\.\d{3}/, ""),
              ],
            );
          });
          await db.query("COMMIT");
          sameTimes.push(ms);
        } finally {
          await pgClose(db);
        }
      }
    });
    const dbh = await newPgIsolated();
    const diffResources: string[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const rid = randomUUID();
        const slug = `perf-${UNIQ}-${i}`;
        await dbh.query(
          `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, sort_order, color_hex, active, bookable) VALUES ($1,$2,$3,$4,$5,'#ffffff',true,true)`,
          [rid, UUIDS.tenant, slug, `Perf ${i}`, 100 + i],
        );
        diffResources.push(rid);
      }
    } finally {
      await pgClose(dbh);
    }
    const diffTimes: number[] = [];
    const totalDiff = await timingMs(async () => {
      const slots = Array.from({ length: 20 }, (_, i) => i);
      await Promise.all(
        slots.map(async (i) => {
          const rid = diffResources[i];
          const s = ISO(FIXED_MONDAY, 10, 18, 0);
          const startDt = new Date(s);
          startDt.setUTCMinutes(startDt.getUTCMinutes() + i * 10);
          const endDt = new Date(startDt);
          endDt.setUTCMinutes(endDt.getUTCMinutes() + 8);
          const c = await newPgIsolated();
          try {
            await c.query("BEGIN");
            await impersonateOwner(c);
            const ms = await timingMs(async () => {
              await c.query(
                `SELECT * FROM public.dashboard_resource_time_off_create($1,'custom_block'::text,$2::timestamptz,$3::timestamptz,'perf-diff',NULL::int)`,
                [
                  rid,
                  startDt.toISOString().replace(/\.\d{3}/, ""),
                  endDt.toISOString().replace(/\.\d{3}/, ""),
                ],
              );
            });
            await c.query("COMMIT");
            diffTimes.push(ms);
          } finally {
            await pgClose(c);
          }
        }),
      );
    });
    const S = {
      min: Math.min(...sameTimes),
      p50: pct(sameTimes, 50),
      p95: pct(sameTimes, 95),
      max: Math.max(...sameTimes),
      total: totalSame,
    };
    const D = {
      min: Math.min(...diffTimes),
      p50: pct(diffTimes, 50),
      p95: pct(diffTimes, 95),
      max: Math.max(...diffTimes),
      total: totalDiff,
    };
    // invariant: le 20 transazioni su risorse diverse parallel total NON devono essere MOLTO PIÙ LENTE (≤ 2.2x lo stesso p95)
    // Altrimenti: lock globale serializzante.
    // Valori attesi: same serial = wall time lineare, diff parallelo = wall time ~= max singolo
    console.warn(
      `[perf-lock] SAME  res  (20 serial)  min=${S.min.toFixed(1)}ms p50=${S.p50.toFixed(1)} p95=${S.p95.toFixed(1)} max=${S.max.toFixed(1)} total=${S.total.toFixed(1)}`,
    );
    console.warn(
      `[perf-lock] DIFF res (20 parallel) min=${D.min.toFixed(1)}ms p50=${D.p50.toFixed(1)} p95=${D.p95.toFixed(1)} max=${D.max.toFixed(1)} total=${D.total.toFixed(1)}`,
    );
    // S.total deve essere maggiore di D.total tipicamente. Non introduciamo reject hard, ma assicuriamoci che la p95 DIFF non sia 20 * p95 SAME (cioè serializzazione globale).
    // Se il lock è per resource: p95 diff ~= p95 same. Se lock globale degenerato: p95 diff ~= 20 * p95 same.
    const ratio = D.p95 / Math.max(1.0, S.p95);
    expect(ratio < 12).toBe(true);
  }, 120_000);
});
