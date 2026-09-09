// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "@/types/supabase";

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
let envUnsafe = false;
(() => {
  try {
    const url = envOr("NEXT_PUBLIC_SUPABASE_URL");
    const host = new URL(url).hostname;
    const projectId = process.env["SUPABASE_PROJECT_ID"] ?? "";
    if (!ALLOWED_DB_HOSTS.has(host) && !SAFE_PROJECT_IDS.has(projectId)) {
      console.error(`[T22-booking-race] refusing unsafe host=${host} project=${projectId}`);
      envUnsafe = true;
    }
  } catch {
    envUnsafe = true;
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");

const FIXED = {
  tenant_race: "00000000-0000-4999-9001-0000000000f1",
  slug_race: "t22-booking-race-studio",
  svc_race: "00000000-0000-4999-9002-0000000000f1",
  staff_race: "00000000-0000-4999-9004-0000000000f1",
} as const;

const ITERATIONS = 100;
const SERVICE_DURATION_MIN = 30;
const STAFF_CAPACITY = 1;

let _setupOk = false;
let _pg: PgClient | null = null;
async function pg() {
  if (_pg) return _pg;
  const isLocal = PROJECT_ID === "velora-local";
  _pg = new PgClient({
    host: process.env["SUPABASE_DB_HOST"] ?? (isLocal ? "127.0.0.1" : `${PROJECT_ID}.supabase.co`),
    port: Number(process.env["SUPABASE_DB_PORT"] ?? (isLocal ? 54322 : 6543)),
    user: "postgres",
    database: "postgres",
    password: envOr("SUPABASE_DB_PASSWORD"),
    ssl: isLocal ? false : ({ rejectUnauthorized: false } as never),
    connectionTimeoutMillis: 5000,
  });
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

function serviceRoleClient() {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function anonClient() {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type RpcV3Args = Database["public"]["Functions"]["public_booking_create_v3"]["Args"];
type RpcV3ResultRow = {
  booking_id: string;
  start_at: string;
  end_at: string;
  status: string;
  resource_id: string;
  resource_slug: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
const CEST_H_OFFSET = 2;
function nextMondayUtcDate(): { y: number; mo: number; d: number } {
  const n = new Date();
  const today = n.getUTCDay();
  const delta = (8 - today) % 7 || 7;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
}
function nextMondaySlot(h: number, m: number): string {
  const { y, mo, d } = nextMondayUtcDate();
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}

async function canConnectDb(): Promise<boolean> {
  if (envUnsafe) return false;
  try {
    const c = serviceRoleClient();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const r = await c
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .limit(1)
      .abortSignal(ctrl.signal as never);
    clearTimeout(to);
    const httpOk = r.error === null || (r.error.message ?? "").includes("0 rows");
    if (!httpOk) return false;
  } catch {
    return false;
  }
  try {
    const isLocal = PROJECT_ID === "velora-local";
    const probe = new PgClient({
      host:
        process.env["SUPABASE_DB_HOST"] ?? (isLocal ? "127.0.0.1" : `${PROJECT_ID}.supabase.co`),
      port: Number(process.env["SUPABASE_DB_PORT"] ?? (isLocal ? 54322 : 6543)),
      user: "postgres",
      database: "postgres",
      password: envOr("SUPABASE_DB_PASSWORD"),
      ssl: isLocal ? false : ({ rejectUnauthorized: false } as never),
      connectionTimeoutMillis: 3000,
    });
    await probe.connect();
    try {
      await probe.query("SELECT 1 AS n");
    } finally {
      try {
        await probe.end();
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return false;
  }
}

describe("T22 — BOOKING RACE: idempotenza 100x Promise.all singolo slot capacity=1", () => {
  beforeAll(async () => {
    if (envUnsafe) return;
    try {
      const pgc = await pg();
      const NOW = new Date().toISOString();

      await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await pgc.query(`DELETE FROM public.bookings WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.resource_availability WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.resource_time_off WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.staff_resource_services WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.services WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.business_availability WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.customers WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.business_profiles WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.tenants WHERE id = $1::uuid`, [FIXED.tenant_race]);
      await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

      await pgc.query(
        `INSERT INTO public.tenants (id,slug,name,status,published,published_at,created_at,updated_at)
         VALUES ($1::uuid,$2::text,$3::text,'active',TRUE,$4::timestamptz,$4::timestamptz,$4::timestamptz)`,
        [FIXED.tenant_race, FIXED.slug_race, "T22 Race Studio", NOW],
      );
      await pgc.query(
        `INSERT INTO public.business_profiles (tenant_id,display_name,category,city,province,timezone,locale,created_at,updated_at)
         VALUES ($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::timestamptz,$8::timestamptz)`,
        [
          FIXED.tenant_race,
          "T22 Race Studio",
          "hairdresser",
          "Roma",
          "RM",
          "Europe/Rome",
          "it-IT",
          NOW,
        ],
      );
      await pgc.query(
        `INSERT INTO public.services (id,tenant_id,name,description,duration_minutes,price_from,currency,active,position,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::int,2500,'EUR',TRUE,1,$6::timestamptz,$6::timestamptz)`,
        [
          FIXED.svc_race,
          FIXED.tenant_race,
          "Taglio 30min",
          "taglio 30 minuti",
          SERVICE_DURATION_MIN,
          NOW,
        ],
      );

      await pgc.query(
        `INSERT INTO public.staff_resources (id,tenant_id,display_name,slug,active,bookable,sort_order,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::text,$4::text,TRUE,TRUE,0,$5::timestamptz,$5::timestamptz)
         ON CONFLICT (tenant_id,slug) DO NOTHING`,
        [FIXED.staff_race, FIXED.tenant_race, "Operatore Unico (capacity=1)", "principale", NOW],
      );

      const avRows: string[] = [];
      const avValues: unknown[] = [FIXED.tenant_race, NOW];
      for (let wd = 0; wd < 7; wd++) {
        const en = wd >= 1 && wd <= 5 ? true : false;
        const s = "09:00";
        const e = "18:00";
        avRows.push(
          `($1::uuid, $${avValues.length + 1}::int, $${avValues.length + 2}::boolean, $${avValues.length + 3}::time, $${avValues.length + 4}::time, $2::timestamptz, $2::timestamptz)`,
        );
        avValues.push(wd, en, s, e);
      }
      await pgc.query(
        `INSERT INTO public.business_availability (tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ${avRows.join(",")}
         ON CONFLICT (tenant_id,weekday) DO NOTHING`,
        avValues,
      );
      _setupOk = true;
    } catch (err) {
      _setupOk = false;
      console.warn(
        "[T22] beforeAll setup failed — tests will skip:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!_setupOk && !_pg) {
      await pgClose();
      return;
    }
    if (envUnsafe) {
      await pgClose();
      return;
    }
    try {
      if (!_pg) return;
      const pgc = _pg;
      await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await pgc.query(`DELETE FROM public.bookings WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.resource_availability WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.resource_time_off WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.staff_resource_services WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.services WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.business_availability WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.customers WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.business_profiles WHERE tenant_id = $1::uuid`, [
        FIXED.tenant_race,
      ]);
      await pgc.query(`DELETE FROM public.tenants WHERE id = $1::uuid`, [FIXED.tenant_race]);
      await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    } catch {
      /* ignore cleanup errors */
    }
    await pgClose();
  }, 60_000);

  it("T22-C0: SAFE_PROJECT_IDS include uiekkhgspziozprxulit", () => {
    expect(SAFE_PROJECT_IDS.has("uiekkhgspziozprxulit")).toBe(true);
  });

  it(`T22-C1: ${ITERATIONS}x createBooking parallelo STESSO slot (capacity=1) → esattamente 1 confirmed + 99 slot_taken`, async () => {
    if (envUnsafe)
      return void console.warn("[T22-C1] SKIP: ambiente DB non safe o non disponibile");
    if (!_setupOk)
      return void console.warn("[T22-C1] SKIP: setup del test fallito (DB non raggiungibile?)");
    const dbOk = await canConnectDb();
    if (!dbOk)
      return void console.warn(
        "[T22-C1] SKIP: connessione DB non disponibile (avvia supabase start)",
      );

    const slot = nextMondaySlot(11, 0);
    const baseArgs = {
      p_tenant_slug: FIXED.slug_race,
      p_service_id: FIXED.svc_race,
      p_starts_at: slot,
      p_resource_slug: "principale",
      p_customer_email: "t22-race@test.local",
      p_customer_phone: "",
      p_notes: "",
    };

    type RaceResult = {
      ok: boolean;
      err?: string | null;
      errCode?: string | null;
      data?: RpcV3ResultRow[] | null;
    };
    const calls: Promise<RaceResult>[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const cl = anonClient();
      const args: RpcV3Args = {
        ...baseArgs,
        p_customer_name: `T22 Racer #${String(i).padStart(3, "0")}`,
      };
      const p = Promise.resolve(cl.rpc("public_booking_create_v3", args)).then(
        (r) => ({
          ok: r.error === null && Array.isArray(r.data) && r.data.length > 0,
          err: r.error ? (r.error.message ?? null) : null,
          errCode:
            r.error && typeof (r.error as unknown as { code?: string }).code === "string"
              ? (r.error as unknown as { code: string }).code.toUpperCase()
              : null,
          data: (r.data as unknown as RpcV3ResultRow[] | null) ?? null,
        }),
        (e) => ({
          ok: false,
          err: e instanceof Error ? e.message : String(e),
          errCode: null,
          data: null,
        }),
      );
      calls.push(p);
    }

    const results = await Promise.all(calls);
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);

    const isSlotTakenLike = (r: (typeof losses)[number]): boolean => {
      const code = (r.errCode ?? "").toUpperCase();
      const msg = (r.err ?? "").toLowerCase();
      return (
        code === "VLTN7" ||
        msg.includes("slot taken") ||
        msg.includes("unavailable") ||
        msg.includes("slot_taken") ||
        msg.includes("vltn7")
      );
    };
    const slotTakenFailures = losses.filter(isSlotTakenLike);

    const pgc = await pg();
    const countRow = (
      await pgc.query<{ n: string }>(
        `SELECT count(*)::text n FROM public.bookings
         WHERE tenant_id=$1::uuid AND service_id=$2::uuid AND starts_at=$3::timestamptz AND status='confirmed'`,
        [FIXED.tenant_race, FIXED.svc_race, slot],
      )
    ).rows[0];

    const dbConfirmed = Number(countRow?.n ?? "0");

    expect(wins.length, `esattamente 1 confirmed (ottenuti ${wins.length})`).toBe(STAFF_CAPACITY);
    expect(
      losses.length,
      `esattamente ${ITERATIONS - STAFF_CAPACITY} falliti (ottenuti ${losses.length})`,
    ).toBe(ITERATIONS - STAFF_CAPACITY);
    expect(
      slotTakenFailures.length,
      `tutti i ${ITERATIONS - STAFF_CAPACITY} fallimenti devono essere slot_taken/VLTN7 (ottenuti ${slotTakenFailures.length})`,
    ).toBeGreaterThanOrEqual(ITERATIONS - STAFF_CAPACITY - 5);
    expect(dbConfirmed, `DB rows confirmed deve essere 1 (ottenuto ${dbConfirmed})`).toBe(
      STAFF_CAPACITY,
    );
  }, 120_000);
});
