// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient } from "@supabase/supabase-js";
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
};
function envOr(key: string): string {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  return DEFAULT_LOCAL[key] ?? "";
}
const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
(() => {
  try {
    const h = new URL(SUPABASE_URL).hostname;
    if (!ALLOWED_DB_HOSTS.has(h)) throw new Error(`Host non autorizzato: ${h}`);
  } catch {
    if (!ALLOWED_DB_HOSTS.has(SUPABASE_URL)) throw new Error("URL non allowed");
  }
  if (!SAFE_PROJECT_IDS.has(PROJECT_ID))
    throw new Error(`PROJECT_ID ${PROJECT_ID} non whitelistato. STOP.`);
})();
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
function DATELCL(base: { y: number; mo: number; d: number }, days: number): string {
  const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
const TZ = "Europe/Rome";
const SERVICE_DURATION = 60;

const TENANT_SLUG = `slot-${UNIQ}`;
const UUIDS: Record<string, string> = {
  owner: randomUUID(),
  maria: randomUUID(),
  luca: randomUUID(),
  svcTaglio: randomUUID(),
  tenant: "",
};
const userIds: Record<string, string> = {};

let pgShared: PgClient | null = null;
const PG_CONN =
  process.env.DIRECT_DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:54322/postgres`;

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function newPg(): Promise<PgClient> {
  const c = new PgClient(PG_CONN);
  await c.connect();
  return c;
}
async function closePg(c: PgClient) {
  try {
    await c.end();
  } catch {
    /* ignore */
  }
}

async function impersonate(db: PgClient, uid: string) {
  await db.query("SET LOCAL ROLE authenticated");
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [uid]);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  try {
    if (UUIDS.tenant) {
      await db.query(`SELECT set_config('app.current_tenant_id', $1::text, true)`, [UUIDS.tenant]);
    }
  } catch {
    /* ignore */
  }
}

describe("FASE13E1-B §11 Public Slot Propagation (DB/E2E slot engine V3)", () => {
  beforeAll(async () => {
    pgShared = await newPg();
    const svc = serviceClient();
    const { error: ownE, data: ownData } = await svc.auth.admin.createUser({
      email: `slot-owner-${UNIQ}@velora.test`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (ownE) throw new Error(`create owner: ${ownE.message}`);
    if (!ownData?.user) throw new Error("owner create failed");
    userIds.owner = ownData.user.id;

    try {
      await pgShared.query("BEGIN");
      await pgShared.query("SET LOCAL ROLE authenticated");
      await pgShared.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [
        userIds.owner,
      ]);
      await pgShared.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
      await pgShared.query(`SELECT public.create_tenant_with_owner($1,$2,$3,$4,$5,$6,$7,$8)`, [
        `Slot Shop ${UNIQ}`,
        "Servizi",
        "Roma",
        "RM",
        "+390600000000",
        `slot-owner-${UNIQ}@velora.test`,
        TZ,
        "it-IT",
      ]);
      await pgShared.query("RESET ROLE");
      await pgShared.query("COMMIT");
    } catch (e) {
      try {
        await pgShared.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    }

    const tq = await pgShared.query<{ id: string }>(
      `SELECT t.id FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id=t.id WHERE m.user_id=$1::uuid AND m.role='owner' AND m.status='active' ORDER BY t.created_at DESC LIMIT 1`,
      [userIds.owner],
    );
    expect(tq.rows.length).toBe(1);
    UUIDS.tenant = tq.rows[0].id;
    await pgShared.query(
      `UPDATE public.tenants SET slug=$1::text, published=TRUE, status='active' WHERE id=$2::uuid`,
      [TENANT_SLUG, UUIDS.tenant],
    );
    await pgShared.query(
      `UPDATE public.business_profiles SET timezone=$1::text WHERE tenant_id=$2::uuid`,
      [TZ, UUIDS.tenant],
    );

    // Servizi
    await pgShared.query(
      `INSERT INTO public.services (id, tenant_id, name, duration_minutes, active, price_from, currency, position) VALUES ($1,$2,'Taglio',$3,true,3000,'EUR',1)`,
      [UUIDS.svcTaglio, UUIDS.tenant, SERVICE_DURATION],
    );
    // Risorse
    for (const [rid, slug, name, order, color] of [
      [UUIDS.maria, "maria", "Maria", 1, "#112233"],
      [UUIDS.luca, "luca", "Luca", 2, "#446688"],
    ] as const) {
      await pgShared.query(
        `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, sort_order, color_hex, active, bookable) VALUES ($1,$2,$3,$4,$5::int,$6,true,true)`,
        [rid, UUIDS.tenant, slug, name, order, color],
      );
    }
    // assegnazione servizi-risorse (entrambe risorse possono fare Taglio)
    for (const rid of [UUIDS.maria, UUIDS.luca]) {
      await pgShared.query(
        `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,true)`,
        [UUIDS.tenant, rid, UUIDS.svcTaglio],
      );
    }
    // disponibilità tutte le giornate 9-18 per entrambe
    for (const rid of [UUIDS.maria, UUIDS.luca]) {
      for (let wd = 0; wd <= 6; wd++) {
        await pgShared.query(
          `INSERT INTO public.resource_availability (tenant_id, resource_id, weekday, start_time, end_time, enabled) VALUES ($1,$2,$3,'09:00'::time,'18:00'::time,true)`,
          [UUIDS.tenant, rid, wd],
        );
      }
    }
  }, 120_000);

  afterAll(async () => {
    if (pgShared) {
      // cleanup
      try {
        await pgShared.query("BEGIN");
        // Bypass security triggers during test-only cleanup (audit_logs immutabile + guard_last_active_owner)
        await pgShared.query(`SET LOCAL session_replication_role = replica`);
        await pgShared.query(`DELETE FROM public.bookings WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(`DELETE FROM public.resource_availability WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(
          `DELETE FROM public.staff_resource_services WHERE tenant_id=$1::uuid`,
          [UUIDS.tenant],
        );
        await pgShared.query(`DELETE FROM public.services WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid`, [
          UUIDS.tenant,
        ]);
        await pgShared.query(`DELETE FROM public.tenants WHERE id=$1::uuid`, [UUIDS.tenant]);
        await pgShared.query(`SET LOCAL session_replication_role = origin`);
        await pgShared.query("COMMIT");
      } catch (e) {
        try {
          await pgShared.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        console.error("cleanup slot propagation:", e);
      }
      await closePg(pgShared);
      pgShared = null;
    }
  }, 60_000);

  function is10cest(row: { starts_at: unknown }): boolean {
    try {
      const d = row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at as any);
      return d.getUTCHours() === 8 && d.getUTCMinutes() === 0;
    } catch {
      return false;
    }
  }
  function datePartYMD(row: { starts_at: unknown }): string {
    const d = row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at as any);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  it("S11-01 BEFORE: Maria 10:00 FIXED_MONDAY disponibile (slug specific)", async () => {
    expect(pgShared).not.toBeNull();
    const db = pgShared!;
    const fromD = DATELCL(FIXED_MONDAY, 0);
    const toD = DATELCL(FIXED_MONDAY, 1);
    const r = await db.query<{ starts_at: unknown; resource_slug: string }>(
      `SELECT starts_at, resource_slug FROM public.public_slot_get_available_v3($1,$2::uuid,$3::date,$4::date,$5)`,
      [TENANT_SLUG, UUIDS.svcTaglio, fromD, toD, "maria"],
    );
    expect(r.rows.length).toBeGreaterThan((8 * 60) / SERVICE_DURATION - 2);
    const slot10 = r.rows.filter((x) => is10cest(x));
    expect(slot10.length).toBeGreaterThanOrEqual(1);
    expect(slot10[0].resource_slug).toBe("maria");
  });

  it("S11-02 CREATE time-off vacation Maria FIXED_MONDAY 09-18 tramite RPC frozen", async () => {
    const db = await newPg();
    try {
      await db.query("BEGIN");
      await impersonate(db, userIds.owner);
      const startIso = ISO(FIXED_MONDAY, 0, 9, 0);
      const endIso = ISO(FIXED_MONDAY, 0, 18, 0);
      const r = await db.query<{ code: string; time_off_id?: string; message?: string }>(
        `SELECT * FROM public.dashboard_resource_time_off_create(
          p_resource_id := $1::uuid,
          p_type := 'vacation',
          p_starts_at := $2::timestamptz,
          p_ends_at := $3::timestamptz,
          p_title := 'Ferie Maria',
          p_expected_conflict_count := 0
        )`,
        [UUIDS.maria, startIso, endIso],
      );
      if (r.rows[0].code !== "OK") {
        console.error("CREATE TIME_OFF FAIL:", r.rows[0], "start:", startIso, "end:", endIso);
      }
      expect(r.rows[0].code).toBe("OK");
      const tofId = r.rows[0].time_off_id;
      expect(tofId).toBeTruthy();
      await db.query("COMMIT");
      (globalThis as any).__SLOT11_TIME_OFF_ID = tofId;
      // §6 READ-BACK OBBLIGATORIO dopo CREATE
      const rb = await db.query<{ id: string; resource_id: string; time_off_type: string }>(
        `SELECT id, resource_id, time_off_type FROM public.resource_time_off WHERE id=$1::uuid AND tenant_id=$2::uuid`,
        [tofId, UUIDS.tenant],
      );
      expect(rb.rows.length).toBe(1);
      expect(rb.rows[0].resource_id).toBe(UUIDS.maria);
      expect(rb.rows[0].time_off_type).toBe("vacation");
    } finally {
      await closePg(db);
    }
  });

  it("S11-03 AFTER create: Maria 10:00 NON disponibile (specific resource)", async () => {
    expect(pgShared).not.toBeNull();
    const db = pgShared!;
    const fromD = DATELCL(FIXED_MONDAY, 0);
    const toD = DATELCL(FIXED_MONDAY, 1);
    const r = await db.query<{ starts_at: unknown; resource_slug: string }>(
      `SELECT starts_at, resource_slug FROM public.public_slot_get_available_v3($1,$2::uuid,$3::date,$4::date,$5)`,
      [TENANT_SLUG, UUIDS.svcTaglio, fromD, toD, "maria"],
    );
    const fixedMondayOnly = r.rows.filter((x) => datePartYMD(x) === fromD);
    expect(fixedMondayOnly.length).toBe(0);
  });

  it("S11-04 ANY resource: Maria bloccata, Luca slot 10:00 disponibili", async () => {
    expect(pgShared).not.toBeNull();
    const db = pgShared!;
    const fromD = DATELCL(FIXED_MONDAY, 0);
    const toD = DATELCL(FIXED_MONDAY, 1);
    const r = await db.query<{ starts_at: unknown; resource_slug: string }>(
      `SELECT starts_at, resource_slug FROM public.public_slot_get_available_v3($1,$2::uuid,$3::date,$4::date,$5)`,
      [TENANT_SLUG, UUIDS.svcTaglio, fromD, toD, "any"],
    );
    const luca10 = r.rows.filter(
      (x) => x.resource_slug === "luca" && is10cest(x) && datePartYMD(x) === fromD,
    );
    expect(luca10.length).toBeGreaterThanOrEqual(1);
    const mariaAny = r.rows.filter((x) => x.resource_slug === "maria" && datePartYMD(x) === fromD);
    expect(mariaAny.length).toBe(0);
  });

  it("S11-05 DELETE time-off → slot Maria 10:00 ripristinati", async () => {
    const tofId = (globalThis as any).__SLOT11_TIME_OFF_ID as string | undefined;
    expect(tofId).toBeTruthy();
    const db = await newPg();
    try {
      await db.query("BEGIN");
      await impersonate(db, userIds.owner);
      const r = await db.query<{ code: string; message?: string }>(
        `SELECT * FROM public.dashboard_resource_time_off_delete($1::uuid)`,
        [tofId],
      );
      if (r.rows[0].code !== "OK") {
        console.error("DELETE TIME_OFF FAIL:", r.rows[0]);
      }
      expect(r.rows[0].code).toBe("OK");
      await db.query("COMMIT");
      // §6 READ-BACK OBBLIGATORIO dopo DELETE: conferma assenza record
      const rb = await db.query<{ id: string }>(
        `SELECT id FROM public.resource_time_off WHERE id=$1::uuid AND tenant_id=$2::uuid`,
        [tofId, UUIDS.tenant],
      );
      expect(rb.rows.length).toBe(0);
    } finally {
      await closePg(db);
    }
    const fromD = DATELCL(FIXED_MONDAY, 0);
    const toD = DATELCL(FIXED_MONDAY, 1);
    const db2 = pgShared!;
    const after = await db2.query<{ starts_at: unknown; resource_slug: string }>(
      `SELECT starts_at, resource_slug FROM public.public_slot_get_available_v3($1,$2::uuid,$3::date,$4::date,$5)`,
      [TENANT_SLUG, UUIDS.svcTaglio, fromD, toD, "maria"],
    );
    expect(after.rows.length).toBeGreaterThan((8 * 60) / SERVICE_DURATION - 2);
    const slot10 = after.rows.filter((x) => is10cest(x));
    expect(slot10.length).toBeGreaterThanOrEqual(1);
  });
});
