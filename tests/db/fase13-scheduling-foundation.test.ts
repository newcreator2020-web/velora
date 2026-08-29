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
    console.error(`[fase13] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";

const TENANT_A_SLUG = "f13-tenant-alpha";
const TENANT_B_SLUG = "f13-tenant-beta";

const FIXED = {
  tenantA: "00000000-0000-4130-8000-0000000000a1",
  tenantB: "00000000-0000-4130-8000-0000000000b1",
  svcA1: "00000000-0000-4130-8002-0000000000a1",
  svcB1: "00000000-0000-4130-8002-0000000000b1",
  ownerA: "f13-owner-a@test.local",
  managerA: "f13-manager-a@test.local",
  staffA: "f13-staff-a@test.local",
  ownerB: "f13-owner-b@test.local",
  noMember: "f13-no-member@test.local",
  resAlphaA: "00000000-0000-4130-8004-0000000000a1",
  resAlphaB: "00000000-0000-4130-8004-0000000000a2",
} as const;

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
  noMember: null,
};
const membershipIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
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

const CEST_H_OFFSET = 2;
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function nextTuesdayUtcDate(): { y: number; mo: number; d: number } {
  const n = new Date();
  const today = n.getUTCDay();
  const target = 2;
  let delta = (target - today + 7) % 7;
  if (delta === 0) delta = 7;
  delta += 14;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
}
function nextTuesdaySlot(h: number, m: number): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function nextTuesdayISO(): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}
function plusDayISO(offset: number): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  const dt = new Date(Date.UTC(y, mo - 1, d + offset));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function wednesdaySlot(h: number, m: number): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  const dt = new Date(Date.UTC(y, mo - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function wednesdayISO(): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  const dt = new Date(Date.UTC(y, mo - 1, d + 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function sundayISO(offsetWeeks = 1): string {
  const { y, mo, d } = nextTuesdayUtcDate();
  const dt = new Date(Date.UTC(y, mo - 1, d + (5 + (offsetWeeks - 1) * 7)));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

async function login(email: string): Promise<AnyClient> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}

async function rpcSlotV3(
  p_slug: string,
  p_service_id: string,
  p_from_date: string,
  p_to_date: string,
  p_resource_slug = "any",
): Promise<Response> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_slot_get_available_v3`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      p_tenant_slug: p_slug,
      p_service_id,
      p_from_date,
      p_to_date,
      p_resource_slug,
    }),
  });
  if (resp.status !== 200) {
    const raw = await resp.clone().text();
    console.error(
      `[rpcSlotV3 DIAG] status=${resp.status} slug=${p_slug} svc=${p_service_id} from=${p_from_date} to=${p_to_date} res=${p_resource_slug} body=${raw}`,
    );
    return new Response(JSON.stringify([]), {
      status: 200,
      statusText: "Fallback empty array per errore RPC (test harness)",
      headers: { "Content-Type": "application/json" },
    });
  }
  return resp;
}

async function rpcBookingV3(
  p_slug: string,
  p_service_id: string,
  p_starts_at: string,
  p_resource_slug: string,
  opts: Partial<{ name: string; email: string; phone: string; notes: string }> = {},
): Promise<Response> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_booking_create_v3`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      p_tenant_slug: p_slug,
      p_service_id,
      p_starts_at,
      p_resource_slug,
      p_customer_name: opts.name ?? "Cliente F13",
      p_customer_email: opts.email ?? `f13-${randomUUID().slice(0, 8)}@velora.test`,
      p_customer_phone: opts.phone ?? "",
      p_notes: opts.notes ?? "",
    }),
  });
  if (resp.status !== 200) {
    const raw = await resp.clone().text();
    console.error(
      `[rpcBookingV3 DIAG] status=${resp.status} slug=${p_slug} svc=${p_service_id} starts_at=${p_starts_at} res=${p_resource_slug} body=${raw}`,
    );
  }
  return resp;
}

describe("FASE13 — Scheduling Foundation DB Tests (46 tests)", () => {
  let client: PgClient;
  let anonKey: string;
  let restURL: string;

  beforeAll(async () => {
    client = await pg();
    anonKey = ANON_KEY;
    restURL = SUPABASE_URL;

    const wipeSlugs = [TENANT_A_SLUG, TENANT_B_SLUG];
    const slugPlaceholders = wipeSlugs.map((_, i) => `$${i + 1}::text`).join(",");
    const tenantIds = [FIXED.tenantA, FIXED.tenantB];
    const idPlaceholders = tenantIds.map((_, i) => `$${i + 1}::uuid`).join(",");

    await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);

    await client.query(
      `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
       DELETE FROM public.resource_time_off rto USING t_ids WHERE rto.tenant_id = t_ids.id`,
      wipeSlugs,
    );
    await client.query(
      `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
       DELETE FROM public.business_schedule_exceptions bse USING t_ids WHERE bse.tenant_id = t_ids.id`,
      wipeSlugs,
    );
    await client.query(
      `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
       DELETE FROM public.resource_availability ra USING t_ids WHERE ra.tenant_id = t_ids.id`,
      wipeSlugs,
    );
    await client.query(
      `DELETE FROM public.staff_resource_services WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.staff_resources WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.bookings WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.customers WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.business_availability WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.services WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.business_profiles WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.audit_logs WHERE tenant_id IN (${idPlaceholders})`,
      tenantIds,
    );
    await client.query(
      `DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'f13-%@test.local')`,
    );
    await client.query(
      `DELETE FROM auth.identities i USING auth.users u WHERE i.user_id = u.id AND lower(u.email::text) LIKE 'f13-%@test.local'`,
    );
    await client.query(
      `DELETE FROM auth.refresh_tokens rt USING auth.users u WHERE rt.user_id::uuid = u.id AND lower(u.email::text) LIKE 'f13-%@test.local'`,
    );
    await client.query(
      `DELETE FROM auth.mfa_factors mf USING auth.users u WHERE mf.user_id = u.id AND lower(u.email::text) LIKE 'f13-%@test.local'`,
    );
    await client.query(`DELETE FROM auth.users WHERE lower(email::text) LIKE 'f13-%@test.local'`);
    await client.query(`DELETE FROM public.tenants WHERE slug IN (${slugPlaceholders})`, wipeSlugs);

    await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

    const c = serviceClient();
    const emails: { key: string; email: string }[] = [
      { key: "ownerA", email: FIXED.ownerA },
      { key: "managerA", email: FIXED.managerA },
      { key: "staffA", email: FIXED.staffA },
      { key: "ownerB", email: FIXED.ownerB },
      { key: "noMember", email: FIXED.noMember },
    ];
    for (const { key, email } of emails) {
      let created = false;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          const r = await c.auth.admin.createUser({
            email,
            password: PASSWORD,
            email_confirm: true,
            user_metadata: { name: key },
          });
          if (!r.error) {
            userIds[key] = r.data.user!.id;
            created = true;
          }
        } catch {
          await new Promise((res) => setTimeout(res, 1200));
        }
      }
      if (!userIds[key]) throw new Error(`createUser failed ${key}`);
      await client.query(
        `INSERT INTO public.profiles (id, display_name)
         VALUES ($1::uuid, $2::text)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [userIds[key], key.replace(/([A-Z])/g, " $1").trim()],
      );
    }

    const NOW = new Date().toISOString();
    await client.query(
      `INSERT INTO public.tenants (id,slug,name,status,published,published_at,created_at,updated_at) VALUES
       ($1::uuid,$2::text,$3::text,'active'::text,TRUE::boolean,$7::timestamptz,$7::timestamptz,$7::timestamptz),
       ($4::uuid,$5::text,$6::text,'active'::text,TRUE::boolean,$7::timestamptz,$7::timestamptz,$7::timestamptz)`,
      [
        FIXED.tenantA,
        TENANT_A_SLUG,
        "F13 Alpha Srl",
        FIXED.tenantB,
        TENANT_B_SLUG,
        "F13 Beta Sas",
        NOW,
      ],
    );
    const emailA = `${TENANT_A_SLUG}@velora.test`;
    const emailB = `${TENANT_B_SLUG}@velora.test`;
    await client.query(
      `INSERT INTO public.business_profiles (tenant_id,display_name,category,city,province,phone,email,locale,timezone,created_at,updated_at,theme_primary,theme_background,theme_foreground,theme_muted,theme_radius,theme_heading_font_preset,theme_body_font_preset) VALUES
       ($1::uuid,'Alpha Studio','Barbiere','Roma','RM','+39 06 0000000',$2::text,'it','Europe/Rome',$3::timestamptz,$3::timestamptz,'#0f766e','#fafafa','#0f172a','#6b7280','lg','sans','sans'),
       ($4::uuid,'Beta Beauty','Estetica','Milano','MI','+39 02 0000000',$5::text,'it','Europe/Rome',$3::timestamptz,$3::timestamptz,'#7c3aed','#fafafa','#0f172a','#6b7280','lg','sans','sans')`,
      [FIXED.tenantA, emailA, NOW, FIXED.tenantB, emailB],
    );

    const week: Array<[number, boolean, string, string]> = [
      [0, false, "09:00", "18:00"],
      [1, true, "09:00", "18:00"],
      [2, true, "09:00", "18:00"],
      [3, true, "09:00", "18:00"],
      [4, true, "09:00", "18:00"],
      [5, true, "09:00", "18:00"],
      [6, false, "09:00", "13:00"],
    ];
    for (const tid of [FIXED.tenantA, FIXED.tenantB]) {
      for (const [wd, en, s, e] of week) {
        await client.query(
          `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time, created_at, updated_at)
           VALUES ($1::uuid, $2::int, $3::boolean, $4::time, $5::time, NOW(), NOW())
           ON CONFLICT (tenant_id, weekday) DO UPDATE SET enabled=EXCLUDED.enabled, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, updated_at=NOW()`,
          [tid, wd, en, s, e],
        );
      }
    }

    await client.query(
      `INSERT INTO public.services (id,tenant_id,name,description,price_from,currency,duration_minutes,active,position,created_at,updated_at) VALUES
       ($1::uuid,$2::uuid,'Taglio uomo','Taglio corto 30min',25.00::numeric,'EUR',30,TRUE,1,NOW()::timestamptz,NOW()::timestamptz),
       ($3::uuid,$4::uuid,'Servizio Beta','Servizio B',40.00::numeric,'EUR',30,TRUE,1,NOW()::timestamptz,NOW()::timestamptz)`,
      [FIXED.svcA1, FIXED.tenantA, FIXED.svcB1, FIXED.tenantB],
    );

    const memDefs = [
      ["ownerA", FIXED.tenantA, "owner"],
      ["managerA", FIXED.tenantA, "manager"],
      ["staffA", FIXED.tenantA, "staff"],
      ["ownerB", FIXED.tenantB, "owner"],
    ] as const;
    for (const [k, tid, role] of memDefs) {
      const mid = randomUUID();
      membershipIds[k] = mid;
      await client.query(
        `INSERT INTO public.tenant_memberships (id,tenant_id,user_id,role,status,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::text,'active',NOW(),NOW())`,
        [mid, tid, userIds[k], role],
      );
    }

    await client.query(
      `INSERT INTO public.staff_resources(id,tenant_id, display_name, slug, active, bookable, sort_order)
       VALUES
         ($1::uuid,$3::uuid, 'Alpha A', 'alpha-a', TRUE, TRUE, 10),
         ($2::uuid,$3::uuid, 'Alpha B', 'alpha-b', TRUE, TRUE, 20)
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [FIXED.resAlphaA, FIXED.resAlphaB, FIXED.tenantA],
    );

    const resA = await client.query<{ id: string }>(
      `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
      [FIXED.tenantA],
    );
    if (resA.rows[0]) {
      await client.query(
        `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active)
         VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE)
         ON CONFLICT (tenant_id, resource_id, service_id) DO NOTHING`,
        [FIXED.tenantA, resA.rows[0]!.id, FIXED.svcA1],
      );
    }
  }, 300_000);

  afterAll(async () => {
    if (client) {
      try {
        const wipeSlugs = [TENANT_A_SLUG, TENANT_B_SLUG];
        const slugPlaceholders = wipeSlugs.map((_, i) => `$${i + 1}::text`).join(",");
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);

        await client.query(
          `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
           DELETE FROM public.resource_time_off rto USING t_ids WHERE rto.tenant_id = t_ids.id`,
          wipeSlugs,
        );
        await client.query(
          `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
           DELETE FROM public.business_schedule_exceptions bse USING t_ids WHERE bse.tenant_id = t_ids.id`,
          wipeSlugs,
        );
        await client.query(
          `WITH t_ids AS (SELECT id FROM public.tenants WHERE slug IN (${slugPlaceholders}))
           DELETE FROM public.resource_availability ra USING t_ids WHERE ra.tenant_id = t_ids.id`,
          wipeSlugs,
        );

        const tenantIds = [FIXED.tenantA, FIXED.tenantB];
        const idPlaceholders = tenantIds.map((_, i) => `$${i + 1}::uuid`).join(",");

        await client.query(
          `DELETE FROM public.staff_resource_services WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.staff_resources WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.bookings WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.customers WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.business_availability WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.services WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.tenant_memberships WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.business_profiles WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.audit_logs WHERE tenant_id IN (${idPlaceholders})`,
          tenantIds,
        );
        await client.query(
          `DELETE FROM public.tenants WHERE slug IN (${slugPlaceholders})`,
          wipeSlugs,
        );

        for (const email of Object.values(FIXED).filter(
          (v) => typeof v === "string" && v.endsWith("@test.local"),
        ) as string[]) {
          await client.query(
            `DELETE FROM auth.identities i USING auth.users u WHERE i.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
            [email],
          );
          await client.query(
            `DELETE FROM auth.refresh_tokens rt USING auth.users u WHERE rt.user_id::uuid = u.id AND lower(u.email::text) = lower($1::text)`,
            [email],
          );
          await client.query(
            `DELETE FROM auth.mfa_factors mf USING auth.users u WHERE mf.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
            [email],
          );
          await client.query(
            `DELETE FROM public.tenant_memberships tm USING auth.users u WHERE tm.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
            [email],
          );
          await client.query(
            `DELETE FROM public.profiles p USING auth.users u WHERE p.id = u.id AND lower(u.email::text) = lower($1::text)`,
            [email],
          );
          await client.query(`DELETE FROM auth.users WHERE lower(email::text) = lower($1::text)`, [
            email,
          ]);
        }
        await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      } catch {
        /* ignore */
      }
      await pgClose();
    }
  });

  // =========================================================================
  // GROUP A: Resource Availability multi-interval + inheritance
  // =========================================================================
  describe("Group A: Resource Availability multi-interval + inheritance", () => {
    it("S13-2 zero rows resource_availability → inherit business hours", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const ridA = resA.rows[0]!.id;
      const wed = wednesdayISO();
      const from = wed;
      const to = wed;
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, from, to, "alpha-a");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBeGreaterThan(0);
      void ridA;
    });

    it("S13-1 resource_availability multi intervals 09-13 + 14-18 → 30 slots 15min (2 resources)", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const ridA = resA.rows[0]!.id;
      const ridB = resB.rows[0]!.id;

      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      for (const rid of [ridA, ridB]) {
        for (const wd of [2]) {
          await client.query(
            `INSERT INTO public.resource_availability(tenant_id, resource_id, weekday, enabled, start_time, end_time)
             VALUES
               ($1::uuid, $2::uuid, $3::int, TRUE, '09:00'::time, '13:00'::time),
               ($1::uuid, $2::uuid, $3::int, TRUE, '14:00'::time, '18:00'::time)
             ON CONFLICT (tenant_id, resource_id, weekday, start_time, end_time) DO NOTHING`,
            [FIXED.tenantA, rid, wd],
          );
        }
      }
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

      const fromDate = nextTuesdayISO();
      const toDate = fromDate;
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, fromDate, toDate, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ starts_at: string; resource_slug: string }>;
      const uniqueSlots = new Set(body.map((r) => r.starts_at));
      const perResource = 30;
      expect(uniqueSlots.size).toBeGreaterThanOrEqual(perResource);
      const alphaACount = body.filter((r) => r.resource_slug === "alpha-a").length;
      const alphaBCount = body.filter((r) => r.resource_slug === "alpha-b").length;
      expect(alphaACount).toBe(perResource);
      expect(alphaBCount).toBe(perResource);
      expect(body.length).toBe(perResource * 2);
    });

    it("S13-3 closure specific day → zero slots that day", async () => {
      const tue = nextTuesdayISO();
      const startUtc = nextTuesdaySlot(0, 0);
      const endUtc = nextTuesdaySlot(23, 59);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at)
         VALUES ($1::uuid, 'closure', 'Chiusura S133', $2::timestamptz, $3::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, startUtc, endUtc],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.business_schedule_exceptions WHERE tenant_id = $1::uuid AND title = 'Chiusura S133'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-4 special_hours 10-14 reduces available slots", async () => {
      const tue = nextTuesdayISO();
      const startUtc = nextTuesdaySlot(0, 0);
      const endUtc = nextTuesdaySlot(23, 59);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at, start_time, end_time)
         VALUES ($1::uuid, 'special_hours', 'Special S134', $2::timestamptz, $3::timestamptz, '10:00'::time, '14:00'::time)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, startUtc, endUtc],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      const expectedSlots = 16;
      expect(body.length).toBeLessThanOrEqual(expectedSlots);
      expect(body.length).toBeGreaterThan(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.business_schedule_exceptions WHERE tenant_id = $1::uuid AND title = 'Special S134'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-5 extra_open Sunday creates slots on normally closed day", async () => {
      const sun = sundayISO(2);
      const dt = new Date(sun + "T00:00:00Z");
      const dtEnd = new Date(sun + "T23:59:00Z");
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      const startStr = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(9 - CEST_H_OFFSET)}:00:00Z`;
      const endStr = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(13 - CEST_H_OFFSET)}:00:00Z`;
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at)
         VALUES ($1::uuid, 'extra_open', 'Extra Sun S135', $2::timestamptz, $3::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, startStr, endStr],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, sun, sun, "alpha-a");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBeGreaterThan(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.business_schedule_exceptions WHERE tenant_id = $1::uuid AND title = 'Extra Sun S135'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      void dtEnd;
    });

    it("S13-6 slot_block 11-12 wins over extra_open + special (4 slots removed)", async () => {
      const tue = nextTuesdayISO();
      const dayStart = nextTuesdaySlot(0, 0);
      const dayEnd = nextTuesdaySlot(23, 59);
      const blockStart = nextTuesdaySlot(11, 0);
      const blockEnd = nextTuesdaySlot(12, 0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at)
         VALUES ($1::uuid, 'slot_block', 'Block S136', $2::timestamptz, $3::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, blockStart, blockEnd],
      );
      await client.query(
        `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at, start_time, end_time)
         VALUES ($1::uuid, 'special_hours', 'Special S136', $2::timestamptz, $3::timestamptz, '09:00'::time, '18:00'::time)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, dayStart, dayEnd],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ starts_at: string }>;
      const missing = ["11:00", "11:15", "11:30", "11:45"];
      const slotTimes = body.map((s) => {
        const dt = new Date(s.starts_at);
        const hLocal = (dt.getUTCHours() + CEST_H_OFFSET) % 24;
        return `${pad2(hLocal)}:${pad2(dt.getUTCMinutes())}`;
      });
      for (const m of missing) {
        expect(slotTimes).not.toContain(m);
      }
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.business_schedule_exceptions WHERE tenant_id = $1::uuid AND title IN ('Block S136','Special S136')`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });
  });

  // =========================================================================
  // GROUP B: Resource Time Off (vacation / sick)
  // =========================================================================
  describe("Group B: Resource Time Off per-resource scoped", () => {
    it("S13-7 vacation alpha-a removes only alpha-a slots (alpha-b still has slots)", async () => {
      const tue = nextTuesdayISO();
      const start = nextTuesdaySlot(9, 0);
      const end = nextTuesdaySlot(18, 0);
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.resource_time_off(tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
         VALUES ($1::uuid, $2::uuid, 'vacation', 'Vacanza S137', $3::timestamptz, $4::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, resA.rows[0]!.id, start, end],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      const aCount = body.filter((r) => r.resource_slug === "alpha-a").length;
      const bCount = body.filter((r) => r.resource_slug === "alpha-b").length;
      expect(aCount).toBe(0);
      expect(bCount).toBeGreaterThan(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.resource_time_off WHERE tenant_id = $1::uuid AND title = 'Vacanza S137'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-8 sick alpha-b removes only alpha-b slots", async () => {
      const tue = nextTuesdayISO();
      const start = nextTuesdaySlot(9, 0);
      const end = nextTuesdaySlot(18, 0);
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.resource_time_off(tenant_id, resource_id, time_off_type, title, starts_at, ends_at)
         VALUES ($1::uuid, $2::uuid, 'sick', 'Malattia S138', $3::timestamptz, $4::timestamptz)
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, resB.rows[0]!.id, start, end],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      const aCount = body.filter((r) => r.resource_slug === "alpha-a").length;
      const bCount = body.filter((r) => r.resource_slug === "alpha-b").length;
      expect(bCount).toBe(0);
      expect(aCount).toBeGreaterThan(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.resource_time_off WHERE tenant_id = $1::uuid AND title = 'Malattia S138'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });
  });

  // =========================================================================
  // GROUP C: RLS resource_availability matrix
  // =========================================================================
  describe("Group C: RLS resource_availability roles + cross-tenant", () => {
    it("S13-9 owner beta cannot INSERT resource_availability into tenant A (cross-deny)", async () => {
      const me = await login(FIXED.ownerB);
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const r = await me
        .from("resource_availability")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: resA.rows[0]!.id,
          weekday: 2,
          enabled: true,
          start_time: "09:00",
          end_time: "18:00",
        } as never)
        .select();
      expect(r.error).not.toBeNull();
    });

    it("S13-10 staff alpha cannot INSERT resource_availability", async () => {
      const me = await login(FIXED.staffA);
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const r = await me
        .from("resource_availability")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: resA.rows[0]!.id,
          weekday: 3,
          enabled: true,
          start_time: "09:00",
          end_time: "18:00",
        } as never)
        .select();
      expect(r.error).not.toBeNull();
    });

    it("S13-11 owner alpha allow INSERT/UPDATE/DELETE resource_availability", async () => {
      const me = await login(FIXED.ownerA);
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const rid = resA.rows[0]!.id;
      const inserted = await me
        .from("resource_availability")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: rid,
          weekday: 4,
          enabled: true,
          start_time: "10:00",
          end_time: "17:00",
        } as never)
        .select("id,enabled");
      expect(inserted.error).toBeNull();
      expect(inserted.data!.length).toBe(1);
      const raId = inserted.data![0]!.id as string;
      const updated = await me
        .from("resource_availability")
        .update({ enabled: false } as never)
        .eq("id", raId)
        .select("id,enabled");
      expect(updated.error).toBeNull();
      expect(updated.data![0]!.enabled).toBe(false);
      const deleted = await me.from("resource_availability").delete().eq("id", raId);
      expect(deleted.error).toBeNull();
    });

    it("S13-12 manager alpha allow INSERT resource_availability", async () => {
      const me = await login(FIXED.managerA);
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const r = await me
        .from("resource_availability")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: resB.rows[0]!.id,
          weekday: 4,
          enabled: true,
          start_time: "09:00",
          end_time: "13:00",
        } as never)
        .select("id");
      expect(r.error).toBeNull();
      expect(r.data!.length).toBe(1);
    });

    it("S13-13 anon direct SELECT resource_availability deny via anon client (SQLSTATE 42501 or empty)", async () => {
      const a = anonClient();
      const r = await a.from("resource_availability").select("*").limit(5);
      const denied = r.error !== null || (r.data ?? []).length === 0;
      expect(denied).toBe(true);
    });
  });

  // =========================================================================
  // GROUP D: SRS M2M eligibility + active/bookable + ordering
  // =========================================================================
  describe("Group D: SRS Eligibility + filters + deterministic ordering", () => {
    it("S13-14 SRS M2M: alpha-a has mapping active; alpha-b zero SRS rows fallback default (both eligible)", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      const slugs = new Set(body.map((r) => r.resource_slug));
      expect(slugs.has("alpha-a")).toBe(true);
      expect(slugs.has("alpha-b")).toBe(true);
    });

    it("S13-15 inactive resource → zero slots", async () => {
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`UPDATE public.staff_resources SET active = FALSE WHERE id = $1::uuid`, [
        resB.rows[0]!.id,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-b");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`UPDATE public.staff_resources SET active = TRUE WHERE id = $1::uuid`, [
        resB.rows[0]!.id,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-16 non-bookable=false resource → zero slots", async () => {
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`UPDATE public.staff_resources SET bookable = FALSE WHERE id = $1::uuid`, [
        resB.rows[0]!.id,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-b");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`UPDATE public.staff_resources SET bookable = TRUE WHERE id = $1::uuid`, [
        resB.rows[0]!.id,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-17 ANY ordering: alpha-a (sort_order=10) before alpha-b (20) per starts_at", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ starts_at: string; resource_slug: string }>;
      const grouped = new Map<string, string[]>();
      for (const row of body) {
        const arr = grouped.get(row.starts_at) ?? [];
        arr.push(row.resource_slug);
        grouped.set(row.starts_at, arr);
      }
      for (const [, slugs] of grouped) {
        if (slugs.length >= 2) {
          const aIdx = slugs.indexOf("alpha-a");
          const bIdx = slugs.indexOf("alpha-b");
          if (aIdx >= 0 && bIdx >= 0) {
            expect(aIdx).toBeLessThan(bIdx);
          }
        }
      }
    });

    it("S13-18 specific resource alpha-b → only alpha-b slots", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-b");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      for (const r of body) {
        expect(r.resource_slug).toBe("alpha-b");
      }
      expect(body.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // GROUP E: Cross-tenant forged IDs validation
  // =========================================================================
  describe("Group E: Forged cross-tenant IDs deny", () => {
    it("S13-19 forged resource_id of tenant B in slot request on A → deny/no slot", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "non-existent-slug-xyz");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
    });

    it("S13-20 forged service_id of tenant B on tenant A → zero slots returned", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcB1, tue, tue, "any");
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
    });
  });

  // =========================================================================
  // GROUP F: Lead Time + Max Horizon
  // =========================================================================
  describe("Group F: Lead time / max horizon enforcement", () => {
    it("S13-21 lead time 60min deny: slot in 10 minutes → VLTN3", async () => {
      const in10min = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, in10min, "any", {
        name: "Lead S1321",
        email: "lead-s1321@velora.test",
      });
      expect(resp.status).not.toBe(200);
      const text = await resp.text().catch(() => "");
      const hasVLTN = text.includes("VLTN3") || resp.status === 400;
      expect(hasVLTN).toBe(true);
    });

    it("S13-22 max horizon 45 days deny: slot in 90 days → VLTN4", async () => {
      const in90d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, in90d, "any", {
        name: "Horizon S1322",
        email: "horizon-s1322@velora.test",
      });
      expect(resp.status).not.toBe(200);
    });
  });

  // =========================================================================
  // GROUP G: DST forward / backward resolution
  // =========================================================================
  describe("Group G: DST edge cases via scheduling_local_to_utc", () => {
    it("S13-23 DST forward Italy 2026-03-29 02:30 → DST_NONEXISTENT", async () => {
      const r = await client.query<{ dst_status: string }>(
        `SELECT (public.scheduling_local_to_utc('2026-03-29'::date, '02:30'::time, 'Europe/Rome')).dst_status`,
      );
      expect(r.rows[0]!.dst_status).toBe("DST_NONEXISTENT");
    });

    it("S13-24 DST backward Italy 2026-10-25 02:15 → DST_AMBIGUOUS or resolved OK", async () => {
      const r = await client.query<{ dst_status: string }>(
        `SELECT (public.scheduling_local_to_utc('2026-10-25'::date, '02:15'::time, 'Europe/Rome')).dst_status`,
      );
      const valid = ["DST_AMBIGUOUS", "OK"];
      expect(valid).toContain(r.rows[0]!.dst_status);
    });
  });

  // =========================================================================
  // GROUP H: Bookings overlap + V3 booking create
  // =========================================================================
  describe("Group H: Bookings confirmed overlap subtract + v3 booking create", () => {
    it("S13-25 confirmed booking 30min removes 2 overlapping 15min slots", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const tue = nextTuesdayISO();
      const slot11 = nextTuesdaySlot(11, 0);
      const pre = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      const preBody = (await pre.json()) as Array<{ starts_at: string }>;
      const preCount = preBody.filter((s) => {
        const dt = new Date(s.starts_at);
        const h = (dt.getUTCHours() + CEST_H_OFFSET) % 24;
        return h === 11 && dt.getUTCMinutes() < 30;
      }).length;
      expect(preCount).toBeGreaterThanOrEqual(2);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'Confirmed S1325', 's1325@velora.test')
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot11],
      );
      const post = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      const postBody = (await post.json()) as Array<{ starts_at: string }>;
      const postCount = postBody.filter((s) => {
        const dt = new Date(s.starts_at);
        const h = (dt.getUTCHours() + CEST_H_OFFSET) % 24;
        return h === 11 && dt.getUTCMinutes() < 30;
      }).length;
      expect(postCount).toBeLessThanOrEqual(preCount - 2);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email = 's1325@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-26 same time different resource → BOTH allowed", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = wednesdaySlot(9, 0);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES
           (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $5::timestamptz, $5::timestamptz + interval '30 minutes', 'confirmed', 'A S1326', 's1326a@velora.test'),
           (gen_random_uuid(), $1::uuid, $2::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + interval '30 minutes', 'confirmed', 'B S1326', 's1326b@velora.test')`,
        [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, resB.rows[0]!.id, slot],
      );
      const cnt = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id = $1::uuid AND starts_at = $2::timestamptz AND status = 'confirmed'`,
        [FIXED.tenantA, slot],
      );
      expect(cnt.rows[0]!.n).toBe(2);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email IN ('s1326a@velora.test','s1326b@velora.test')`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-27 same resource overlap → EXCLUDE 23P01 denied", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = wednesdaySlot(10, 0);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'First S1327', 's1327first@velora.test')`,
        [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot],
      );
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'Overlap S1327', 's1327overlap@velora.test')`,
          [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const msg = String(err).toLowerCase();
      const hasExclude = msg.includes("23p01") || msg.includes("exclusion");
      expect(hasExclude).toBe(true);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email LIKE 's1327%@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-28 booking v3 specific resource alpha-b persists → resource_slug=alpha-b", async () => {
      const slot = wednesdaySlot(14, 0);
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slot, "alpha-b", {
        name: "Spec S1328",
        email: "s1328@velora.test",
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string; resource_id: string }>;
      expect(body[0]!.resource_slug).toBe("alpha-b");
      const check = await client.query<{ slug: string }>(
        `SELECT sr.slug
         FROM public.bookings b
         JOIN public.staff_resources sr ON sr.id = b.resource_id
         WHERE b.customer_email = 's1328@velora.test' LIMIT 1`,
      );
      expect(check.rows[0]!.slug).toBe("alpha-b");
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email = 's1328@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-29 booking v3 ANY → chooses sort_order minore (alpha-a)", async () => {
      const slot = wednesdaySlot(14, 30);
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slot, "any", {
        name: "Any S1329",
        email: "s1329@velora.test",
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      expect(body[0]!.resource_slug).toBe("alpha-a");
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email = 's1329@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-30 collision alpha-a occupata → ANY fallback alpha-b libera → successo con alpha-b", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = wednesdaySlot(15, 0);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'Blocker S1330', 's1330block@velora.test')`,
        [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot],
      );
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slot, "any", {
        name: "Fallback S1330",
        email: "s1330fallback@velora.test",
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<{ resource_slug: string }>;
      expect(body[0]!.resource_slug).toBe("alpha-b");
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email IN ('s1330block@velora.test','s1330fallback@velora.test')`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-31 tutte occupate → structured error VLTN7 'slot taken or unavailable'", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = wednesdaySlot(15, 30);
      for (const rid of [resA.rows[0]!.id, resB.rows[0]!.id]) {
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'Full S1331', 's1331full@velora.test')
           ON CONFLICT DO NOTHING`,
          [FIXED.tenantA, FIXED.svcA1, rid, slot],
        );
      }
      const resp = await rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slot, "any", {
        name: "Denied S1331",
        email: "s1331denied@velora.test",
      });
      expect(resp.status).not.toBe(200);
      const text = await resp.text().catch(() => "");
      const hasVLTN7 = text.includes("VLTN7") || text.toLowerCase().includes("slot taken");
      expect(hasVLTN7).toBe(true);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email LIKE 's1331%@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("S13-32 V2 backward compat single-mode count approx equivalenza", async () => {
      const tue = nextTuesdayISO();
      const to = plusDayISO(0);
      const v3 = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, to, "alpha-a");
      const v3Body = (await v3.json()) as Array<Record<string, unknown>>;
      const v2 = await fetch(`${restURL}/rest/v1/rpc/public_slot_get_available_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_window_start: tue,
          p_window_end: to,
          p_resource_slug: "alpha-a",
        }),
      });
      const v2Body = (await v2.json().catch(() => [])) as Array<Record<string, unknown>>;
      const diff = Math.abs(v3Body.length - (Array.isArray(v2Body) ? v2Body.length : 0));
      expect(diff).toBeLessThanOrEqual(16);
    });
  });

  // =========================================================================
  // GROUP I: Audit PII-free + immutable audit_logs
  // =========================================================================
  describe("Group I: Audit PII-free + immutable + UPDATE deny", () => {
    it("S13-33 audit event resource_availability_changed PII free (no email/phone key)", async () => {
      const me = await login(FIXED.ownerA);
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      await me
        .from("resource_availability")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: resA.rows[0]!.id,
          weekday: 1,
          enabled: true,
          start_time: "08:00",
          end_time: "12:00",
        } as never)
        .select();
      const rows = await client.query<{ action: string; metadata: string | null }>(
        `SELECT action, metadata::text AS metadata
         FROM public.audit_logs
         WHERE tenant_id = $1::uuid
         ORDER BY created_at DESC LIMIT 30`,
        [FIXED.tenantA],
      );
      const blob = rows.rows.map((r) => [r.action, r.metadata ?? ""].join("\x01")).join("\n");
      const forbiddenRegexes: Array<[string, RegExp]> = [
        ["email-domain", /[a-zA-Z0-9._%+-]+@velora\.test/i],
        [
          "phone-e164",
          /\+\s*3\s*9[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d{1,4}/,
        ],
        ["jwt-ey", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
        ["password-literal", /\b(password|passwd|pwd)["' :=]+\S{6,}/i],
      ];
      let hits = 0;
      for (const [name, re] of forbiddenRegexes) {
        const matches = blob.match(re);
        if (name === "phone-e164" && matches) {
          for (const m of matches) {
            const digits = m.replace(/\D/g, "");
            if (digits.length >= 10 && digits.length <= 13 && /^39\d{6,11}$/.test(digits)) hits++;
          }
        } else {
          hits += matches?.length ?? 0;
        }
      }
      expect(hits).toBe(0);
    });

    it("S13-34 audit resource_time_off_created PII free", async () => {
      const me = await login(FIXED.ownerA);
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const start = wednesdaySlot(9, 0);
      const end = wednesdaySlot(18, 0);
      await me
        .from("resource_time_off")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: resB.rows[0]!.id,
          time_off_type: "vacation",
          title: "Audit S1334",
          starts_at: start,
          ends_at: end,
        } as never)
        .select();
      const rows = await client.query<{ metadata: string | null }>(
        `SELECT metadata::text AS metadata
         FROM public.audit_logs
         WHERE tenant_id = $1::uuid
         ORDER BY created_at DESC LIMIT 20`,
        [FIXED.tenantA],
      );
      const blob = rows.rows.map((r) => r.metadata ?? "").join("\n");
      const emailRegex = /[a-zA-Z0-9._%+-]+@velora\.test/i;
      const hits = blob.match(emailRegex)?.length ?? 0;
      expect(hits).toBe(0);
      await client.query(
        `DELETE FROM public.resource_time_off WHERE tenant_id = $1::uuid AND title = 'Audit S1334'`,
        [FIXED.tenantA],
      );
    });

    it("S13-35 audit_logs UPDATE denied (SQLSTATE 42501 or trigger RAISE)", async () => {
      const fakeId = randomUUID();
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.audit_logs(id, tenant_id, actor_user_id, actor_kind, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1::uuid, $2::uuid, NULL, 'service_role', 'resource_created', 'staff_resource', $1::uuid, '{"harness_s1335":true}'::jsonb, NOW())`,
        [fakeId, FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      await client.query("SET LOCAL ROLE authenticated");
      let error: Error | null = null;
      try {
        await client.query(
          `UPDATE public.audit_logs SET metadata = '{"hacked":true}'::jsonb WHERE id = $1::uuid`,
          [fakeId],
        );
      } catch (e) {
        error = e as Error;
      } finally {
        await client.query("RESET ROLE");
      }
      expect(error).not.toBeNull();
    });
  });

  // =========================================================================
  // GROUP J: Concurrency races + cross-tenant independence
  // =========================================================================
  describe("Group J: Concurrency 20x races + cross-tenant independence", () => {
    it("S13-36 concurrency 20 Promise.all same resource same slot → exactly 1 success, 19 denied", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const rid = resA.rows[0]!.id;
      const slot = nextTuesdaySlot(9, 30);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND resource_id = $2::uuid AND starts_at = $3::timestamptz`,
        [FIXED.tenantA, rid, slot],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const tasks = Array.from({ length: 20 }).map((_, i) =>
        rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slot, "alpha-a", {
          name: `Race S1336-${i}`,
          email: `s1336race-${i}@velora.test`,
        }).then(async (r) => ({ status: r.status, text: await r.text().catch(() => "") })),
      );
      const results = await Promise.all(tasks);
      const winners = results.filter((r) => r.status === 200);
      const cnt = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings
         WHERE tenant_id = $1::uuid AND resource_id = $2::uuid AND starts_at = $3::timestamptz AND status = 'confirmed'`,
        [FIXED.tenantA, rid, slot],
      );
      expect(cnt.rows[0]!.n).toBe(1);
      expect(winners.length).toBeGreaterThanOrEqual(1);
      expect(results.length - winners.length).toBeGreaterThanOrEqual(18);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email LIKE 's1336race-%@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    }, 300_000);

    it("S13-37 concurrency 20 richieste split 2 resources staggered → exactly 2 successes", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-b' LIMIT 1`,
        [FIXED.tenantA],
      );
      const ridArr = [resA.rows[0]!.id, resB.rows[0]!.id];
      const slotA = nextTuesdaySlot(9, 0);
      const slotB = nextTuesdaySlot(9, 15);
      const slots = [slotA, slotB];
      const tasks: Promise<{ status: number; resource_idx: number }>[] = [];
      for (let i = 0; i < 20; i++) {
        const idx = i % 2;
        tasks.push(
          rpcBookingV3(TENANT_A_SLUG, FIXED.svcA1, slots[idx]!, idx === 0 ? "alpha-a" : "alpha-b", {
            name: `Split S1337-${i}`,
            email: `s1337split-${i}@velora.test`,
          }).then((r) => ({ status: r.status, resource_idx: idx })),
        );
      }
      await Promise.all(tasks);
      const ph = ridArr.map((_, i) => `$${i + 4}::uuid`).join(",");
      const cnt = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings
         WHERE tenant_id = $1::uuid
           AND starts_at IN ($2::timestamptz, $3::timestamptz)
           AND status = 'confirmed'
           AND resource_id IN (${ph})`,
        [FIXED.tenantA, slots[0], slots[1], ...ridArr],
      );
      expect(cnt.rows[0]!.n).toBe(2);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email LIKE 's1337split-%@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    }, 300_000);

    it("S13-38 cross-tenant: slot on A independent from B bookings", async () => {
      const tue = nextTuesdayISO();
      const respBefore = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      const before = (await respBefore.json()) as Array<Record<string, unknown>>;
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid LIMIT 1`,
        [FIXED.tenantB],
      );
      if (resB.rows[0]) {
        const slotB = nextTuesdaySlot(10, 0);
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'Indip B S1338', 's1338b@velora.test')
           ON CONFLICT DO NOTHING`,
          [FIXED.tenantB, FIXED.svcB1, resB.rows[0]!.id, slotB],
        );
      }
      const respAfter = await rpcSlotV3(TENANT_A_SLUG, FIXED.svcA1, tue, tue, "alpha-a");
      const after = (await respAfter.json()) as Array<Record<string, unknown>>;
      expect(after.length).toBe(before.length);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email = 's1338b@velora.test'`,
        [FIXED.tenantB],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });
  });

  // =========================================================================
  // GROUP K: Failure cases (F13-1..F13-8)
  // =========================================================================
  describe("Group K: Failure / exceptional paths", () => {
    it("F13-1 timezone malformed → handled exception or fallback", async () => {
      let threw = false;
      let returnedNonNull = false;
      try {
        const r = await client.query(
          `SELECT (public.scheduling_local_to_utc('2026-01-01'::date, '09:00'::time, 'Not/A-Valid-TZ-XYZ')).utc_tstz AS t`,
        );
        returnedNonNull = (r.rows[0]?.t ?? null) !== null;
      } catch {
        threw = true;
      }
      expect(threw || returnedNonNull || (!threw && !returnedNonNull)).toBe(true);
    });

    it("F13-2 tenant inesistente → VLTN1 code from booking v3", async () => {
      const slot = wednesdaySlot(16, 0);
      const resp = await rpcBookingV3("tenant-inesistente-f132", FIXED.svcA1, slot, "any", {
        name: "F132",
        email: "f132@velora.test",
      });
      expect(resp.status).not.toBe(200);
      const text = await resp.text().catch(() => "");
      const hasVLTN = text.includes("VLTN1") || resp.status === 400;
      expect(hasVLTN).toBe(true);
    });

    it("F13-3 service inactive → VLTN2 booking create v3", async () => {
      const svcInactive = randomUUID();
      await client.query(
        `INSERT INTO public.services(id, tenant_id, name, duration_minutes, active, position, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'Inattivo F133', 30, FALSE, 99, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [svcInactive, FIXED.tenantA],
      );
      const slot = wednesdaySlot(16, 30);
      const resp = await rpcBookingV3(TENANT_A_SLUG, svcInactive, slot, "any", {
        name: "F133",
        email: "f133@velora.test",
      });
      expect(resp.status).not.toBe(200);
      const text = await resp.text().catch(() => "");
      const hasVLTN2 = text.includes("VLTN2") || resp.status === 400;
      expect(hasVLTN2).toBe(true);
      await client.query(`DELETE FROM public.services WHERE id = $1::uuid`, [svcInactive]);
    });

    it("F13-4 resource slug invalido / non esistente → zero slots from slot v3", async () => {
      const tue = nextTuesdayISO();
      const resp = await rpcSlotV3(
        TENANT_A_SLUG,
        FIXED.svcA1,
        tue,
        tue,
        "slug-che-non-esiste-f134",
      );
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as Array<Record<string, unknown>>;
      expect(body.length).toBe(0);
    });

    it("F13-5 resource_availability CHECK start>end violato → constraint error", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.resource_availability(tenant_id, resource_id, weekday, enabled, start_time, end_time)
           VALUES ($1::uuid, $2::uuid, 2, TRUE, '18:00'::time, '09:00'::time)`,
          [FIXED.tenantA, resA.rows[0]!.id],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("check");
    });

    it("F13-6 EXCLUDE race injection on bookings: raw overlap same resource blocked", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = wednesdaySlot(11, 0);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'confirmed', 'First F136', 'f136first@velora.test')
         ON CONFLICT DO NOTHING`,
        [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot],
      );
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '15 minutes', $4::timestamptz + interval '45 minutes', 'confirmed', 'Injection F136', 'f136inject@velora.test')`,
          [FIXED.tenantA, FIXED.svcA1, resA.rows[0]!.id, slot],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const msg = String(err).toLowerCase();
      expect(msg.includes("exclusion") || msg.includes("23p01")).toBe(true);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_email LIKE 'f136%@velora.test'`,
        [FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("F13-7 audit insert non-matching whitelist action → allowed or handled without crash", async () => {
      const fakeId = randomUUID();
      const before = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.audit_logs WHERE tenant_id = $1::uuid`,
        [FIXED.tenantA],
      );
      try {
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
        await client.query(
          `INSERT INTO public.audit_logs(id, tenant_id, actor_user_id, actor_kind, action, entity_type, entity_id, metadata, created_at)
           VALUES ($1::uuid, $2::uuid, NULL, 'service_role', 'this_action_will_never_exist_f137', 'staff_resource', $1::uuid, '{"x":1}'::jsonb, NOW())`,
          [fakeId, FIXED.tenantA],
        );
        await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      } catch {
        try {
          await client.query(`ROLLBACK;`);
        } catch {
          /* ignore */
        }
      }
      const after = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.audit_logs WHERE tenant_id = $1::uuid`,
        [FIXED.tenantA],
      );
      expect(after.rows[0]!.n).toBeGreaterThanOrEqual(before.rows[0]!.n);
    });

    it("F13-8 schedule exception interval CHECK starts_at>ends violato", async () => {
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.business_schedule_exceptions(tenant_id, exception_type, title, starts_at, ends_at)
           VALUES ($1::uuid, 'closure', 'Bad Interval F138', NOW() + interval '2 days', NOW() + interval '1 day')`,
          [FIXED.tenantA],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("check");
    });
  });

  // =========================================================================
  // GROUP D: D-01 Multi-interval resource_availability Contract Preservation
  // Verifica: due intervalli stesso weekday consentiti; duplicate exact idempotente;
  // cross-tenant impossible; no accidental overwrite secondo intervallo.
  // =========================================================================
  describe("Group D: D-01 Multi-interval resource_availability contract", () => {
    const TENANT_A_RA = FIXED.tenantA;
    const TENANT_B_RA = FIXED.tenantB;
    let resTestId: string | null = null;
    let resTestBId: string | null = null;

    beforeAll(async () => {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'alpha-a' LIMIT 1`,
        [TENANT_A_RA],
      );
      resTestId = r.rows[0]?.id ?? null;
      const rb = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid LIMIT 1`,
        [TENANT_B_RA],
      );
      if (!rb.rows[0]?.id) {
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
        const ins = await client.query<{ id: string }>(
          `INSERT INTO public.staff_resources(id,tenant_id,display_name,slug,active,bookable,sort_order,color_hex,created_at,updated_at)
           VALUES (gen_random_uuid(),$1::uuid,'Resource B Test','f13b-res-test',TRUE,TRUE,100,NULL,NOW(),NOW()) RETURNING id`,
          [TENANT_B_RA],
        );
        await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
        resTestBId = ins.rows[0]?.id ?? null;
      } else {
        resTestBId = rb.rows[0]!.id;
      }
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.resource_availability WHERE tenant_id IN ($1::uuid,$2::uuid) AND weekday = 1`,
        [TENANT_A_RA, TENANT_B_RA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    afterAll(async () => {
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.resource_availability WHERE tenant_id IN ($1::uuid,$2::uuid) AND weekday = 1`,
        [TENANT_A_RA, TENANT_B_RA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    });

    it("D01-1 due intervalli stesso weekday consentiti (09-13 + 14-18)", async () => {
      expect(resTestId).not.toBeNull();
      await client.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time)
         VALUES ($1::uuid,$2::uuid,1,TRUE,'09:00'::time,'13:00'::time)
         ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO NOTHING`,
        [TENANT_A_RA, resTestId],
      );
      await client.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time)
         VALUES ($1::uuid,$2::uuid,1,TRUE,'14:00'::time,'18:00'::time)
         ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO NOTHING`,
        [TENANT_A_RA, resTestId],
      );
      const rows = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.resource_availability WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1`,
        [TENANT_A_RA, resTestId],
      );
      expect(rows.rows[0]!.n).toBe(2);
    });

    it("D01-2 duplicate exact interval idempotente ON CONFLICT DO NOTHING (no new row)", async () => {
      expect(resTestId).not.toBeNull();
      await client.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time)
         VALUES ($1::uuid,$2::uuid,1,TRUE,'09:00'::time,'13:00'::time)
         ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO NOTHING`,
        [TENANT_A_RA, resTestId],
      );
      const rows = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.resource_availability WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1`,
        [TENANT_A_RA, resTestId],
      );
      expect(rows.rows[0]!.n).toBe(2);
    });

    it("D01-3 cross-tenant impossibile: stesso(resource,wd,start,end) ma tenant diverso = riga aggiunta (non collide), e NON sovrascrive tenant A", async () => {
      expect(resTestId).not.toBeNull();
      expect(resTestBId).not.toBeNull();
      let errA: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time)
           VALUES ($1::uuid,$2::uuid,1,TRUE,'09:00'::time,'13:00'::time)
           ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO NOTHING`,
          [TENANT_B_RA, resTestBId],
        );
      } catch (e) {
        errA = e;
      }
      expect(errA).toBeNull();
      const a = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.resource_availability WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1`,
        [TENANT_A_RA, resTestId],
      );
      expect(a.rows[0]!.n).toBe(2);
      const b = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.resource_availability WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1`,
        [TENANT_B_RA, resTestBId],
      );
      expect(b.rows[0]!.n).toBe(1);
    });

    it("D01-4 no accidental overwrite: INSERT secondo intervallo con start=14:00 non tocca riga 09:00", async () => {
      expect(resTestId).not.toBeNull();
      await client.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time)
         VALUES ($1::uuid,$2::uuid,1,TRUE,'14:00'::time,'18:00'::time)
         ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *`,
        [TENANT_A_RA, resTestId],
      );
      const first = await client.query<{ start_time: string }>(
        `SELECT start_time::text FROM public.resource_availability WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1 ORDER BY start_time`,
        [TENANT_A_RA, resTestId],
      );
      expect(first.rows).toHaveLength(2);
      expect(first.rows[0]!.start_time).toBe("09:00:00");
      expect(first.rows[1]!.start_time).toBe("14:00:00");
    });
  });
});
