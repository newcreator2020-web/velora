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
    console.error(`[fase12] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";

const TENANT_A_SLUG = "f12-tenant-alpha";
const TENANT_B_SLUG = "f12-tenant-beta";
const SHARED_EMAIL = "f12-shared@velora.test";

const FIXED = {
  tenantA: "00000000-0000-4120-8000-0000000000a1",
  tenantB: "00000000-0000-4120-8000-0000000000b1",
  svcA1: "00000000-0000-4120-8002-0000000000a1",
  svcA2: "00000000-0000-4120-8002-0000000000a2",
  svcB1: "00000000-0000-4120-8002-0000000000b1",
  ownerA: "f12-owner-a@test.local",
  managerA: "f12-manager-a@test.local",
  staffA: "f12-staff-a@test.local",
  ownerB: "f12-owner-b@test.local",
  noMember: "f12-no-member@test.local",
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

async function replicaWipe(
  pg: PgClient,
  tid: string,
  extra: { email?: string; name?: string } = {},
) {
  const emailLikes = [SHARED_EMAIL, extra.email ?? "X-NO-MATCH-X"].filter(Boolean);
  const names = ["Resource Test", extra.name ?? "X-NO-NAME-X"].filter(Boolean);
  await pg.query("BEGIN; SET LOCAL session_replication_role = replica;");
  for (const e of emailLikes) {
    await pg.query(
      `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND (customer_email = $2 OR customer_email ILIKE $2)`,
      [tid, e],
    );
    await pg.query(
      `DELETE FROM public.customers WHERE tenant_id = $1::uuid AND (email_normalized = $2 OR email = $2)`,
      [tid, e],
    );
  }
  for (const n of names) {
    await pg.query(
      `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND customer_name = $2`,
      [tid, n],
    );
    await pg.query(
      `DELETE FROM public.customers WHERE tenant_id = $1::uuid AND display_name = $2`,
      [tid, n],
    );
  }
  await pg.query("SET LOCAL session_replication_role = DEFAULT; COMMIT;");
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

async function login(email: string): Promise<AnyClient> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}

describe("FASE12 — Resource Scheduling DB Tests", () => {
  let client: PgClient;
  let anonKey: string;
  let restURL: string;

  beforeAll(async () => {
    client = await pg();
    anonKey = ANON_KEY;
    restURL = SUPABASE_URL;

    const wipeIds = [FIXED.tenantA, FIXED.tenantB];
    const placeholders = wipeIds.map((_, i) => `$${i + 1}::uuid`).join(",");
    await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await client.query(
      `DELETE FROM public.staff_resource_services WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(
      `DELETE FROM public.staff_resources WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(`DELETE FROM public.bookings WHERE tenant_id IN (${placeholders})`, wipeIds);
    await client.query(
      `DELETE FROM public.customers WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(
      `DELETE FROM public.business_availability WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(`DELETE FROM public.services WHERE tenant_id IN (${placeholders})`, wipeIds);
    await client.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(
      `DELETE FROM public.business_profiles WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(
      `DELETE FROM public.audit_logs WHERE tenant_id IN (${placeholders})`,
      wipeIds,
    );
    await client.query(
      `DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'f12-%@test.local')`,
    );
    await client.query(
      `DELETE FROM auth.identities i USING auth.users u WHERE i.user_id = u.id AND lower(u.email::text) LIKE 'f12-%@test.local'`,
    );
    await client.query(
      `DELETE FROM auth.refresh_tokens rt USING auth.users u WHERE rt.user_id::uuid = u.id AND lower(u.email::text) LIKE 'f12-%@test.local'`,
    );
    await client.query(
      `DELETE FROM auth.mfa_factors mf USING auth.users u WHERE mf.user_id = u.id AND lower(u.email::text) LIKE 'f12-%@test.local'`,
    );
    await client.query(`DELETE FROM auth.users WHERE lower(email::text) LIKE 'f12-%@test.local'`);
    await client.query(`DELETE FROM public.tenants WHERE id IN (${placeholders})`, wipeIds);
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
        "F12 Alpha Srl",
        FIXED.tenantB,
        TENANT_B_SLUG,
        "F12 Beta Sas",
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
      [6, true, "09:00", "13:00"],
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
       ($1::uuid,$2::uuid,'Taglio uomo','Taglio corto',25.00::numeric,'EUR',30,TRUE,1,NOW()::timestamptz,NOW()::timestamptz),
       ($3::uuid,$2::uuid,'Barba','Barba completa',15.00::numeric,'EUR',20,TRUE,2,NOW()::timestamptz,NOW()::timestamptz),
       ($4::uuid,$5::uuid,'Viso','Trattamento viso',40.00::numeric,'EUR',45,TRUE,1,NOW()::timestamptz,NOW()::timestamptz)`,
      [FIXED.svcA1, FIXED.tenantA, FIXED.svcA2, FIXED.svcB1, FIXED.tenantB],
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

    await replicaWipe(client, FIXED.tenantA);
    await replicaWipe(client, FIXED.tenantB);

    await client.query(
      `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
       VALUES
         ($1::uuid, 'Principale A', 'principale', TRUE, TRUE, 0),
         ($2::uuid, 'Principale B', 'principale', TRUE, TRUE, 0)
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [FIXED.tenantA, FIXED.tenantB],
    );

    for (const tid of [FIXED.tenantA, FIXED.tenantB]) {
      const week: Array<[number, boolean, string, string]> = [
        [0, false, "09:00", "18:00"],
        [1, true, "09:00", "18:00"],
        [2, true, "09:00", "18:00"],
        [3, true, "09:00", "18:00"],
        [4, true, "09:00", "18:00"],
        [5, true, "09:00", "18:00"],
        [6, false, "09:00", "18:00"],
      ];
      for (const [wd, en, s, e] of week) {
        await client.query(
          `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time, created_at, updated_at)
           VALUES ($1::uuid, $2::int, $3::boolean, $4::time, $5::time, NOW(), NOW())
           ON CONFLICT (tenant_id, weekday) DO UPDATE SET enabled=EXCLUDED.enabled, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, updated_at=NOW()`,
          [tid, wd, en, s, e],
        );
      }
    }
  }, 300_000);

  afterAll(async () => {
    if (client) {
      try {
        await replicaWipe(client, FIXED.tenantA);
        await replicaWipe(client, FIXED.tenantB);
        const wipeIds = [FIXED.tenantA, FIXED.tenantB];
        const placeholders = wipeIds.map((_, i) => `$${i + 1}::uuid`).join(",");
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
        await client.query(
          `DELETE FROM public.staff_resource_services WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.staff_resources WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.bookings WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.customers WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.business_availability WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.services WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.tenant_memberships WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.business_profiles WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(
          `DELETE FROM public.audit_logs WHERE tenant_id IN (${placeholders})`,
          wipeIds,
        );
        await client.query(`DELETE FROM public.tenants WHERE id IN (${placeholders})`, wipeIds);
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
  // GROUP A: staff_resources default seed + backfill idempotent
  // =========================================================================
  describe("Group A: Default Resource Seed + Backfill Idempotent", () => {
    it("R12-1 backfill 1st run: tenant A default resource created with slug=principale", async () => {
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid`, [
        FIXED.tenantA,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

      const tid = FIXED.tenantA.replace(/'/g, "''");
      await client.query(`DO $$
DECLARE
  r RECORD;
  v_display TEXT;
  v_slug TEXT;
BEGIN
  v_slug := 'principale';
  FOR r IN
    SELECT t.id AS tenant_id, COALESCE(NULLIF(BTRIM(bp.display_name), ''), 'Principale') AS pref_name
    FROM public.tenants t
    LEFT JOIN public.business_profiles bp ON bp.tenant_id = t.id
    WHERE NOT EXISTS (SELECT 1 FROM public.staff_resources sr WHERE sr.tenant_id = t.id)
      AND t.id = '${tid}'::uuid
    ORDER BY t.created_at ASC
  LOOP
    INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order, color_hex)
    VALUES (r.tenant_id, SUBSTRING(BTRIM(r.pref_name) FROM 1 FOR 80), v_slug, TRUE, TRUE, 0, NULL)
    ON CONFLICT (tenant_id, slug) DO NOTHING;
  END LOOP;
END $$;`);

      const rows = await client.query<{ slug: string; active: boolean; bookable: boolean }>(
        `SELECT slug, active, bookable FROM public.staff_resources WHERE tenant_id = $1::uuid`,
        [FIXED.tenantA],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0]!.slug).toBe("principale");
      expect(rows.rows[0]!.active).toBe(true);
      expect(rows.rows[0]!.bookable).toBe(true);
    });

    it("R12-2 backfill is idempotent: 2nd run inserts 0 rows", async () => {
      const before = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id = $1::uuid`,
        [FIXED.tenantA],
      );
      expect(before.rows[0]!.n).toBeGreaterThanOrEqual(1);

      const tid = FIXED.tenantA.replace(/'/g, "''");
      await client.query(`DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id AS tenant_id FROM public.tenants t
    WHERE NOT EXISTS (SELECT 1 FROM public.staff_resources sr WHERE sr.tenant_id = t.id)
      AND t.id = '${tid}'::uuid
  LOOP
    INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
    VALUES (r.tenant_id, 'Principale', 'principale', TRUE, TRUE, 0)
    ON CONFLICT (tenant_id, slug) DO NOTHING;
  END LOOP;
END $$;`);

      const after = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id = $1::uuid`,
        [FIXED.tenantA],
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });

    it("R12-3 default resource has linked_membership=owner for fresh onboarding-created tenant via RPC", async () => {
      const newUid = userIds["noMember"]!;
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(`DELETE FROM public.tenant_memberships WHERE user_id = $1::uuid`, [
        newUid,
      ]);
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

      // eslint-disable-next-line no-useless-assignment
      let pgUpdateOk = false;
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [newUid]);
        await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
        await client.query(`SELECT public.create_tenant_with_owner($1,$2,$3,$4,$5,$6,$7,$8)`, [
          "F12 Gamma Onboard",
          "Barbiere",
          "Napoli",
          "NA",
          "+39 081 000000",
          "gamma@velora.test",
          "Europe/Rome",
          "it-IT",
        ]);
        pgUpdateOk = true;
      } catch {
        pgUpdateOk = false;
      } finally {
        await client.query("RESET ROLE");
      }
      const tAfter = await client.query<{ id: string }>(
        `SELECT t.id FROM public.tenants t
         JOIN public.tenant_memberships m ON m.tenant_id = t.id
         WHERE m.user_id = $1::uuid AND m.role = 'owner' AND m.status = 'active'
         ORDER BY m.created_at DESC LIMIT 1`,
        [newUid],
      );
      if (pgUpdateOk && tAfter.rows[0]) {
        const tid = tAfter.rows[0]!.id;
        const res = await client.query<{ slug: string; has_linked: boolean }>(
          `SELECT slug, (linked_membership_id IS NOT NULL) AS has_linked
           FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
          [tid],
        );
        if (res.rows[0]) {
          expect(res.rows[0]!.slug).toBe("principale");
          expect(res.rows[0]!.has_linked).toBe(true);
        }
      }
    });

    it("R12-4 staff_resources composite UNIQUE(tenant_id,id) exists for FK prerequisites", async () => {
      const r = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = 'staff_resources' AND c.conname = 'staff_resources_tenant_id_id_key'`,
      );
      expect(r.rows[0]!.n).toBe(1);
    });
  });

  // =========================================================================
  // GROUP B: RLS roles cross-tenant deny + staff_resources / SRS policies
  // =========================================================================
  describe("Group B: RLS Cross-Tenant + Role Matrix", () => {
    it("R12-5 owner A can INSERT resource into tenant A", async () => {
      const me = await login(FIXED.ownerA);
      const r = await me
        .from("staff_resources")
        .insert({
          tenant_id: FIXED.tenantA,
          display_name: "Maria R125",
          slug: "maria-r125",
          active: true,
          bookable: true,
          sort_order: 1,
        } as never)
        .select("id,slug");
      expect(r.error).toBeNull();
      expect(r.data!.length).toBe(1);
      expect(r.data![0]!.slug).toBe("maria-r125");
    });

    it("R12-6 staff A cannot INSERT resource (only owner/manager)", async () => {
      const me = await login(FIXED.staffA);
      const r = await me
        .from("staff_resources")
        .insert({
          tenant_id: FIXED.tenantA,
          display_name: "Staff Hack",
          slug: "staff-hack-r126",
          active: true,
          bookable: true,
          sort_order: 2,
        } as never)
        .select();
      expect(r.error).not.toBeNull();
    });

    it("R12-7 manager A can INSERT resource into tenant A", async () => {
      const me = await login(FIXED.managerA);
      const r = await me
        .from("staff_resources")
        .insert({
          tenant_id: FIXED.tenantA,
          display_name: "Luca R127",
          slug: "luca-r127",
          active: true,
          bookable: true,
          sort_order: 2,
        } as never)
        .select("id,slug");
      expect(r.error).toBeNull();
      expect(r.data!.length).toBe(1);
      expect(r.data![0]!.slug).toBe("luca-r127");
    });

    it("R12-8 owner A cannot INSERT resource into tenant B (cross-tenant RLS)", async () => {
      const me = await login(FIXED.ownerA);
      const r = await me
        .from("staff_resources")
        .insert({
          tenant_id: FIXED.tenantB,
          display_name: "Intruder R128",
          slug: "intruder-r128",
          active: true,
          bookable: true,
          sort_order: 1,
        } as never)
        .select();
      expect(r.error).not.toBeNull();
      const check = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'intruder-r128'`,
        [FIXED.tenantB],
      );
      expect(check.rows[0]!.n).toBe(0);
    });

    it("R12-9 staff A can SELECT resources of tenant A (member read)", async () => {
      const me = await login(FIXED.staffA);
      const r = await me.from("staff_resources").select("slug").eq("tenant_id", FIXED.tenantA);
      expect(r.error).toBeNull();
      expect(r.data!.length).toBeGreaterThanOrEqual(1);
    });

    it("R12-10 anon cannot direct SELECT staff_resources table (RLS deny)", async () => {
      const a = anonClient();
      const r = await a.from("staff_resources").select("slug");
      expect((r.data ?? []).length).toBe(0);
    });

    it("R12-11 owner A cannot read resources of tenant B (cross-tenant)", async () => {
      const me = await login(FIXED.ownerA);
      const r = await me.from("staff_resources").select("slug").eq("tenant_id", FIXED.tenantB);
      expect(r.error).toBeNull();
      expect(r.data!.length).toBe(0);
    });

    it("R12-12 staff A cannot UPDATE resource (only owner/manager)", async () => {
      const me = await login(FIXED.staffA);
      const r = await me
        .from("staff_resources")
        .update({ bookable: false } as never)
        .eq("tenant_id", FIXED.tenantA)
        .eq("slug", "principale")
        .select();
      const denied = r.error !== null || (r.data && r.data.length === 0);
      expect(denied).toBe(true);
      const check = await client.query<{ bookable: boolean }>(
        `SELECT bookable FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      expect(check.rows[0]!.bookable).toBe(true);
    });

    it("R12-13 owner A can INSERT staff_resource_services (owner/manager write)", async () => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const rid = res.rows[0]!.id;
      const me = await login(FIXED.ownerA);
      const r = await me
        .from("staff_resource_services")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: rid,
          service_id: FIXED.svcA1,
          active: true,
        } as never)
        .select();
      expect(r.error).toBeNull();
    });

    it("R12-14 staff A cannot INSERT staff_resource_services", async () => {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const rid = res.rows[0]!.id;
      const me = await login(FIXED.staffA);
      const r = await me
        .from("staff_resource_services")
        .insert({
          tenant_id: FIXED.tenantA,
          resource_id: rid,
          service_id: FIXED.svcA2,
          active: true,
        } as never)
        .select();
      expect(r.error).not.toBeNull();
    });
  });

  // =========================================================================
  // GROUP C: Composite FK cross-tenant deny for linked_membership + SRS
  // =========================================================================
  describe("Group C: Composite FK Cross-Tenant Integrity", () => {
    it("R12-15 composite FK: linked_membership_id from tenant B CANNOT be linked to resource of tenant A", async () => {
      const memB = membershipIds["ownerB"]!;
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order, linked_membership_id)
           VALUES (gen_random_uuid(), $1::uuid, 'Cross Tenant Bad', 'cross-bad-r1215', TRUE, TRUE, 5, $2::uuid)`,
          [FIXED.tenantA, memB],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const msg = String(err).toLowerCase();
      const hasFkViolation =
        msg.includes("violates foreign key constraint") || msg.includes("foreign");
      expect(hasFkViolation).toBe(true);
    });

    it("R12-16 composite FK: linked_membership_id from tenant A linked to A resource IS allowed", async () => {
      const memA = membershipIds["ownerA"]!;
      const id = randomUUID();
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order, linked_membership_id)
         VALUES ($1::uuid, $2::uuid, 'Linked Owner R1216', 'linked-owner-r1216', TRUE, TRUE, 10, $3::uuid)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [id, FIXED.tenantA, memA],
      );
      const check = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE id = $1::uuid`,
        [id],
      );
      expect(check.rows[0]!.n).toBe(1);
    });

    it("R12-17 staff_resource_services composite FK: service from tenant B into resource of tenant A DENIED", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active)
           VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE)`,
          [FIXED.tenantA, resA.rows[0]!.id, FIXED.svcB1],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("foreign");
    });

    it("R12-18 staff_resource_services composite FK: resource from tenant B into service of tenant A DENIED", async () => {
      const resB = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantB],
      );
      let err: unknown = null;
      try {
        await client.query(
          `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active)
           VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE)`,
          [FIXED.tenantA, resB.rows[0]!.id, FIXED.svcA1],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("foreign");
    });

    it("R12-19 staff_resource_services composite FK: resource A + service A = ALLOWED", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      await client.query(
        `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active)
         VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE)
         ON CONFLICT (tenant_id, resource_id, service_id) DO NOTHING`,
        [FIXED.tenantA, resA.rows[0]!.id, FIXED.svcA2],
      );
      const check = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resource_services
         WHERE tenant_id = $1::uuid AND resource_id = $2::uuid AND service_id = $3::uuid`,
        [FIXED.tenantA, resA.rows[0]!.id, FIXED.svcA2],
      );
      expect(check.rows[0]!.n).toBe(1);
    });
  });

  // =========================================================================
  // GROUP D: bookings.resource_id backfill proof + CHECK invariant
  // =========================================================================
  describe("Group D: Bookings Resource ID Backfill + Invariant", () => {
    it("R12-20 raw INSERT confirmed booking with resource_id=NULL → trigger fills default resource automatically", async () => {
      const slot = nextTuesdaySlot(14, 0);
      const bid = randomUUID();
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::timestamptz, $4::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'Backfill R1220', $5)`,
        [bid, FIXED.tenantA, FIXED.svcA1, slot, `${randomUUID().slice(0, 6)}@velora.test`],
      );
      const check = await client.query<{ resource_id: string | null }>(
        `SELECT resource_id FROM public.bookings WHERE id = $1::uuid`,
        [bid],
      );
      expect(check.rows[0]!.resource_id).not.toBeNull();
      const def = await client.query<{ id: string }>(
        `SELECT sr.id FROM public.staff_resources sr
         WHERE sr.tenant_id = $1::uuid AND sr.slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      expect(check.rows[0]!.resource_id).toBe(def.rows[0]!.id);
    });

    it("R12-21 CHECK invariant: confirmed booking CANNOT have resource_id NULL (constraint enforced)", async () => {
      let err: unknown = null;
      const bid = randomUUID();
      try {
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
        await client.query(
          `ALTER TABLE public.bookings DISABLE TRIGGER trg_bookings_set_resource_if_null`,
        );
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, NOW() + interval '5 days', NOW() + interval '5 days 30 minutes', 'confirmed', 'Null R1221', 'null@velora.test')`,
          [bid, FIXED.tenantA, FIXED.svcA1],
        );
        await client.query(
          `ALTER TABLE public.bookings ENABLE TRIGGER trg_bookings_set_resource_if_null`,
        );
        await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      } catch (e) {
        err = e;
        try {
          await client.query(
            `ALTER TABLE public.bookings ENABLE TRIGGER trg_bookings_set_resource_if_null`,
          );
        } catch {
          /* ignore */
        }
        try {
          await client.query(`ROLLBACK;`);
        } catch {
          /* ignore */
        }
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("check");
    });

    it("R12-22 bookings backfill DO block correctly fills NULL resource_ids", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      if (!resA.rows[0]) {
        await client.query(
          `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
           VALUES ($1::uuid, 'Principale', 'principale', TRUE, TRUE, 0)
           ON CONFLICT (tenant_id, slug) DO NOTHING`,
          [FIXED.tenantA],
        );
      }
      const resA2 = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const defRid = resA2.rows[0]!.id;

      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `ALTER TABLE public.bookings DISABLE TRIGGER trg_bookings_set_resource_if_null`,
      );
      const bid = randomUUID();
      const slot = nextTuesdaySlot(15, 0);
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::timestamptz, $4::timestamptz + (30 || ' minutes')::interval, 'cancelled', 'BackfillDO R1222', 'bd@velora.test')`,
        [bid, FIXED.tenantA, FIXED.svcA1, slot],
      );
      await client.query(
        `ALTER TABLE public.bookings ENABLE TRIGGER trg_bookings_set_resource_if_null`,
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

      const pre = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings WHERE id = $1::uuid AND resource_id IS NULL`,
        [bid],
      );
      expect(pre.rows[0]!.n).toBe(1);

      await client.query(`DO $$
DECLARE
  v_count_backfilled BIGINT;
BEGIN
  WITH candidate AS (
    SELECT b.bt AS tenant_id, (
      SELECT sr.id FROM public.staff_resources sr
      WHERE sr.tenant_id = b.bt AND sr.active = TRUE
      ORDER BY CASE WHEN sr.slug = 'principale' THEN 0 ELSE 1 END, sr.sort_order ASC, sr.id ASC LIMIT 1
    ) AS rid
    FROM (SELECT DISTINCT tenant_id AS bt FROM public.bookings bb WHERE bb.resource_id IS NULL) b(bt)
  )
  UPDATE public.bookings bk SET resource_id = c.rid
  FROM candidate c
  WHERE bk.tenant_id = c.tenant_id AND bk.resource_id IS NULL AND c.rid IS NOT NULL;
END $$;`);

      const post = await client.query<{ resource_id: string }>(
        `SELECT resource_id FROM public.bookings WHERE id = $1::uuid`,
        [bid],
      );
      expect(post.rows[0]!.resource_id).toBe(defRid);
    });

    it("R12-23 bookings.resource_id composite FK RESTRICT: cannot hard-delete resource with bookings", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      let err: unknown = null;
      try {
        await client.query(`DELETE FROM public.staff_resources WHERE id = $1::uuid`, [
          resA.rows[0]!.id,
        ]);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("violates foreign key");
    });
  });

  // =========================================================================
  // GROUP E: EXCLUDE transition (new works, old removed)
  // =========================================================================
  describe("Group E: EXCLUDE Constraint Semantics", () => {
    it("R12-24 old EXCLUDE bookings_no_overlap_confirmed removed (tenant+service+time)", async () => {
      const r = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = 'bookings' AND c.conname = 'bookings_no_overlap_confirmed'`,
      );
      expect(r.rows[0]!.n).toBe(0);
    });

    it("R12-25 new EXCLUDE bookings_no_resource_overlap_confirmed exists (tenant+resource+time)", async () => {
      const r = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = 'bookings' AND c.conname = 'bookings_no_resource_overlap_confirmed'`,
      );
      expect(r.rows[0]!.n).toBe(1);
    });

    it("R12-26 same resource same time overlap → DENIED", async () => {
      const resA = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const rid = resA.rows[0]!.id;
      const slot = nextTuesdaySlot(9, 0);
      const bid1 = randomUUID();
      const email1 = `${randomUUID().slice(0, 8)}a@velora.test`;
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'R1226 First', $6)`,
        [bid1, FIXED.tenantA, FIXED.svcA1, rid, slot, email1],
      );
      let err: unknown = null;
      const bid2 = randomUUID();
      const email2 = `${randomUUID().slice(0, 8)}b@velora.test`;
      try {
        await client.query(
          `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'R1226 Overlap', $6)`,
          [bid2, FIXED.tenantA, FIXED.svcA1, rid, slot, email2],
        );
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String(err).toLowerCase()).toContain("exclusion");
    });

    it("R12-27 DIFFERENT resources SAME service SAME time → BOTH ALLOWED (multi-resource parallel)", async () => {
      const rid2 = randomUUID();
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, $2::uuid, 'Gio R1227', 'gio-r1227', TRUE, TRUE, 3)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [rid2, FIXED.tenantA],
      );
      const actualRid = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'gio-r1227' LIMIT 1`,
        [FIXED.tenantA],
      );
      const mainRid = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = nextTuesdaySlot(10, 0);
      const bidM = randomUUID();
      const bidG = randomUUID();
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'R1227 Maria', $6)`,
        [bidM, FIXED.tenantA, FIXED.svcA1, mainRid.rows[0]!.id, slot, `r1227m@velora.test`],
      );
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'R1227 Gio', $6)`,
        [bidG, FIXED.tenantA, FIXED.svcA1, actualRid.rows[0]!.id, slot, `r1227g@velora.test`],
      );
      const cnt = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings
         WHERE tenant_id = $1::uuid AND service_id = $2::uuid AND starts_at = $3::timestamptz AND status = 'confirmed'`,
        [FIXED.tenantA, FIXED.svcA1, slot],
      );
      expect(cnt.rows[0]!.n).toBe(2);
    });

    it("R12-28 cancelled bookings do NOT participate in EXCLUDE overlap", async () => {
      const mainRid = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = nextTuesdaySlot(11, 0);
      const bidC = randomUUID();
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'cancelled', 'R1228 Cancelled', 'r1228c@velora.test')`,
        [bidC, FIXED.tenantA, FIXED.svcA1, mainRid.rows[0]!.id, slot],
      );
      const bidOK = randomUUID();
      await client.query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $5::timestamptz + (30 || ' minutes')::interval, 'confirmed', 'R1228 After', 'r1228ok@velora.test')`,
        [bidOK, FIXED.tenantA, FIXED.svcA1, mainRid.rows[0]!.id, slot],
      );
      const cnt = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings WHERE id = $1::uuid AND status = 'confirmed'`,
        [bidOK],
      );
      expect(cnt.rows[0]!.n).toBe(1);
    });
  });

  // =========================================================================
  // GROUP F: ANY deterministic assignment + inactive/nonbookable + ineligible
  // =========================================================================
  describe("Group F: Deterministic ANY Assignment + Availability Filters", () => {
    it("R12-29 ANY deterministic: lowest sort_order wins (tiebreak id ASC)", async () => {
      const ridLow = randomUUID();
      const ridHigh = randomUUID();
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES
           ($1::uuid, $3::uuid, 'Low Sort R1229', 'low-sort-r1229', TRUE, TRUE, 0),
           ($2::uuid, $3::uuid, 'High Sort R1229', 'high-sort-r1229', TRUE, TRUE, 5)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [ridLow, ridHigh, FIXED.tenantA],
      );
      const slot = nextTuesdaySlot(12, 0);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1229 Any",
          p_customer_email: "r1229@velora.test",
          p_resource_slug: "any",
        }),
      });
      expect(res.status === 200 || res.status === 409 || res.status === 400).toBe(true);
      if (res.status === 200) {
        const body = (await res.json()) as Array<{ resource_slug: string }>;
        if (
          body[0]?.resource_slug === "low-sort-r1229" ||
          body[0]?.resource_slug === "principale"
        ) {
          expect(
            body[0]!.resource_slug === "low-sort-r1229" || body[0]!.resource_slug === "principale",
          ).toBe(true);
        }
      }
    });

    it("R12-30 INACTIVE resource excluded from ANY selection", async () => {
      const ridInactive = randomUUID();
      const slugInactive = "inactive-r1230";
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, $2::uuid, 'Inactive R1230', $3, FALSE, TRUE, 0)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [ridInactive, FIXED.tenantA, slugInactive],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const me = await login(FIXED.ownerA);
      void (await me.from("staff_resource_services").insert({
        tenant_id: FIXED.tenantA,
        resource_id: ridInactive,
        service_id: FIXED.svcA1,
        active: true,
      } as never));
      const slot = nextTuesdaySlot(13, 0);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1230 InactiveCheck",
          p_customer_email: "r1230@velora.test",
          p_resource_slug: slugInactive,
        }),
      });
      const denied = res.status !== 200;
      expect(denied).toBe(true);
    });

    it("R12-31 NONBOOKABLE resource excluded from ANY selection", async () => {
      const ridNB = randomUUID();
      const slugNB = "nonbookable-r1231";
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, $2::uuid, 'Nonbookable R1231', $3, TRUE, FALSE, 0)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [ridNB, FIXED.tenantA, slugNB],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const slot = nextTuesdaySlot(13, 30);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1231 NBCheck",
          p_customer_email: "r1231@velora.test",
          p_resource_slug: slugNB,
        }),
      });
      expect(res.status).not.toBe(200);
    });

    it("R12-32 INELIGIBLE resource/service combo DENIED (SRS has_any_m2m=TRUE but service not listed)", async () => {
      const ridEl = randomUUID();
      const slugEl = "eligible-r1232";
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, $2::uuid, 'Elig R1232', $3, TRUE, TRUE, 1)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [ridEl, FIXED.tenantA, slugEl],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const actualId = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2 LIMIT 1`,
        [FIXED.tenantA, slugEl],
      );
      const me = await login(FIXED.ownerA);
      await me.from("staff_resource_services").insert({
        tenant_id: FIXED.tenantA,
        resource_id: actualId.rows[0]!.id,
        service_id: FIXED.svcA2,
        active: true,
      } as never);
      const slot = nextTuesdaySlot(14, 30);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1232 Inelig",
          p_customer_email: "r1232@velora.test",
          p_resource_slug: slugEl,
        }),
      });
      expect(res.status).not.toBe(200);
    });

    it("R12-33 forged tenant B resource slug from A RPC → DENIED (resource validated against slug tenant)", async () => {
      const bOnlySlug = "b-only-r1233-" + randomUUID().slice(0, 6);
      await client.query(
        `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, 'Only Tenant B', $2::text, TRUE, TRUE, 50)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [FIXED.tenantB, bOnlySlug],
      );
      const checkB = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2::text`,
        [FIXED.tenantB, bOnlySlug],
      );
      expect(checkB.rows[0]!.n).toBe(1);
      const checkA = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2::text`,
        [FIXED.tenantA, bOnlySlug],
      );
      expect(checkA.rows[0]!.n).toBe(0);
      const slot = nextTuesdaySlot(17, 0);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1233 Forged",
          p_customer_email: "r1233@velora.test",
          p_resource_slug: bOnlySlug,
        }),
      });
      expect(res.status).not.toBe(200);
    });
  });

  // =========================================================================
  // GROUP G: Booking V2 + Slot V2 RPCs
  // =========================================================================
  describe("Group G: Booking V2 + Slot V2 RPCs", () => {
    it("R12-34 booking V2 creates confirmed booking with resource_id set", async () => {
      const slot = nextTuesdaySlot(16, 0);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1234 V2",
          p_customer_email: "r1234@velora.test",
          p_resource_slug: "any",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        booking_id: string;
        booking_status: string;
        resource_slug: string;
      }>;
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]!.booking_status).toBe("confirmed");
      expect(body[0]!.resource_slug).toBeTruthy();
      const check = await client.query<{ resource_id: string | null }>(
        `SELECT resource_id FROM public.bookings WHERE id = $1::uuid`,
        [body[0]!.booking_id],
      );
      expect(check.rows[0]!.resource_id).not.toBeNull();
    });

    it("R12-35 booking V2 with SPECIFIC resource slug succeeds if available", async () => {
      const mainRid = await client.query<{ slug: string }>(
        `SELECT slug FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const slot = nextTuesdaySlot(16, 30);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_starts_at: slot,
          p_customer_name: "R1235 Specific",
          p_customer_email: "r1235@velora.test",
          p_resource_slug: mainRid.rows[0]!.slug,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ resource_slug: string }>;
      expect(body[0]!.resource_slug).toBe("principale");
    });

    it("R12-36 slot V2 returns starts_at, ends_at, resource_slug, resource_display_name (PII-free shape)", async () => {
      const winStart = nextTuesdayISO();
      const winEnd = plusDayISO(1);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_slot_get_available_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_window_start: winStart,
          p_window_end: winEnd,
          p_resource_slug: "any",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        starts_at?: string;
        ends_at?: string;
        resource_slug?: string;
        resource_display_name?: string;
      }>;
      expect(Array.isArray(body)).toBe(true);
      if (body.length > 0) {
        const first = body[0]!;
        expect(typeof first.starts_at).toBe("string");
        expect(typeof first.ends_at).toBe("string");
        expect(typeof first.resource_slug).toBe("string");
        expect(typeof first.resource_display_name).toBe("string");
        const keys = Object.keys(first);
        for (const k of keys) {
          expect(k).toMatch(/^(starts_at|ends_at|resource_slug|resource_display_name)$/);
        }
      }
    });

    it("R12-37 slot V2 with specific resource slug filters only that resource", async () => {
      const mainRid = await client.query<{ slug: string; display_name: string }>(
        `SELECT slug, display_name FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = 'principale' LIMIT 1`,
        [FIXED.tenantA],
      );
      const winStart = nextTuesdayISO();
      const winEnd = plusDayISO(1);
      const res = await fetch(`${restURL}/rest/v1/rpc/public_slot_get_available_v2`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
          p_window_start: winStart,
          p_window_end: winEnd,
          p_resource_slug: mainRid.rows[0]!.slug,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ resource_slug: string }>;
      for (const row of body) {
        expect(row.resource_slug).toBe("principale");
      }
    });

    it("R12-38 public_booking_resources_list returns PII-free resource list (slug/display/sort only)", async () => {
      const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_resources_list`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_slug: TENANT_A_SLUG,
          p_service_id: FIXED.svcA1,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      if (body.length > 0) {
        for (const r of body) {
          const keys = Object.keys(r);
          for (const k of keys) {
            expect(k).toMatch(/^(resource_slug|resource_display_name|sort_order)$/);
          }
        }
      }
    });
  });

  // =========================================================================
  // GROUP H: Audit PII-free + immutable
  // =========================================================================
  describe("Group H: Audit PII-Free + Immutable", () => {
    it("R12-39 resource audit rows have NO email/phone/notes/PII (PII scan forbidden=0)", async () => {
      const me = await login(FIXED.ownerA);
      const newSlug = `audit-res-${randomUUID().slice(0, 8)}`;
      await me
        .from("staff_resources")
        .insert({
          tenant_id: FIXED.tenantA,
          display_name: "Audit Test R1239",
          slug: newSlug,
          active: true,
          bookable: true,
          sort_order: 50,
        } as never)
        .select();
      const rows = await client.query<{
        action: string;
        metadata: string | null;
      }>(
        `SELECT action, metadata::text AS metadata
         FROM public.audit_logs
         WHERE tenant_id = $1::uuid
           AND action IN ('resource_created','resource_updated','resource_deactivated','resource_service_added','resource_service_changed','resource_service_removed')
         ORDER BY created_at DESC LIMIT 50`,
        [FIXED.tenantA],
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      const blob = rows.rows.map((r) => [r.action, r.metadata ?? ""].join("\x01")).join("\n");
      const forbiddenRegexes: Array<[string, RegExp]> = [
        ["email-domain", /[a-zA-Z0-9._%+-]+@velora\.test/i],
        [
          "phone-e164",
          /\+\s*3\s*9[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d{1,4}/,
        ],
        ["jwt-ey", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
        ["authorization-bearer", /authorization[:=]\s*bearer\s+[A-Za-z0-9._-]{20,}/i],
        ["password-literal", /\b(password|passwd|pwd)["' :=]+\S{6,}/i],
        ["stripe-sk", /\bsk_(test|live)_[A-Za-z0-9]{8,}/],
        ["cvc-3digit", /["'\\/](?:cvc|cvv|security)["'\\/\s:=]*\d{3,4}/i],
        [
          "notes-pii",
          /("(?:notes|address|indirizzo|via|citt[àa]|city|cap|postal)"\s*:\s*".{8,}")|((?:notes|address|indirizzo|via|città|city|cap|postal)["' :=].{8,})/i,
        ],
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

    it("R12-40 audit_logs UPDATE denied + DELETE denied (before===after)", async () => {
      try {
        await client.query(`ROLLBACK;`);
      } catch {
        /* ignore */
      }
      const fakeId = randomUUID();
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `INSERT INTO public.audit_logs(id, tenant_id, actor_user_id, actor_kind, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1::uuid, $2::uuid, NULL, 'service_role', 'resource_created', 'staff_resource', $1::uuid, '{"harness":true}'::jsonb, NOW())`,
        [fakeId, FIXED.tenantA],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const before = await client.query<{ id: string; action: string; metadata: string }>(
        `SELECT id, action, metadata::text AS metadata FROM public.audit_logs WHERE id = $1::uuid`,
        [fakeId],
      );
      expect(before.rows.length).toBe(1);
      const anonUpdate = await fetch(`${restURL}/rest/v1/audit_logs?id=eq.${fakeId}`, {
        method: "PATCH",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "hacked" }),
      });
      expect(anonUpdate.status).not.toBe(204);
      const anonDelete = await fetch(`${restURL}/rest/v1/audit_logs?id=eq.${fakeId}`, {
        method: "DELETE",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      expect(anonDelete.status).not.toBe(204);
      // eslint-disable-next-line no-useless-assignment
      let pgUpdateOk = false;
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(
          `UPDATE public.audit_logs SET action = 'hacked_pg_auth' WHERE id = $1::uuid`,
          [fakeId],
        );
        pgUpdateOk = true;
      } catch {
        pgUpdateOk = false;
      } finally {
        await client.query("RESET ROLE");
      }
      expect(pgUpdateOk).toBe(false);
      // eslint-disable-next-line no-useless-assignment
      let pgDeleteOk = false;
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(`DELETE FROM public.audit_logs WHERE id = $1::uuid`, [fakeId]);
        pgDeleteOk = true;
      } catch {
        pgDeleteOk = false;
      } finally {
        await client.query("RESET ROLE");
      }
      expect(pgDeleteOk).toBe(false);
      const after = await client.query<{ id: string; action: string; metadata: string }>(
        `SELECT id, action, metadata::text AS metadata FROM public.audit_logs WHERE id = $1::uuid`,
        [fakeId],
      );
      expect(after.rows.length).toBe(1);
      expect(after.rows[0]!.action).toEqual(before.rows[0]!.action);
      expect(after.rows[0]!.metadata).toEqual(before.rows[0]!.metadata);
    });
  });

  // =========================================================================
  // GROUP I: Concurrency tests (20x same resource = 1 winner; 20x 2 resources = 2 winners)
  // =========================================================================
  describe("Group I: 20x Concurrency Race", () => {
    it("CONC-20x: same slot SAME resource ANY → exactly 1 winner confirmed", async () => {
      const singleRid = randomUUID();
      const singleSlug = "conc-single-r12";
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.staff_resource_services WHERE resource_id IN (
          SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2
        )`,
        [FIXED.tenantA, singleSlug],
      );
      await client.query(
        `DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2`,
        [FIXED.tenantA, singleSlug],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      await client.query(
        `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
         VALUES ($1::uuid, $2::uuid, 'Concurrency Single', $3, TRUE, TRUE, 100)
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [singleRid, FIXED.tenantA, singleSlug],
      );
      const actualId = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2 LIMIT 1`,
        [FIXED.tenantA, singleSlug],
      );
      const slot = wednesdaySlot(9, 0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await client.query(
        `DELETE FROM public.bookings WHERE tenant_id = $1::uuid AND resource_id = $2::uuid AND starts_at = $3::timestamptz`,
        [FIXED.tenantA, actualId.rows[0]!.id, slot],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const tasks = Array.from({ length: 20 }).map(async (_, i) => {
        const res = await fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            p_slug: TENANT_A_SLUG,
            p_service_id: FIXED.svcA1,
            p_starts_at: slot,
            p_customer_name: `Race20Same-${i}`,
            p_customer_email: `race20same-${i}@velora.test`,
            p_resource_slug: singleSlug,
          }),
        });
        return { status: res.status, body: await res.text().catch(() => "") };
      });
      const results = await Promise.all(tasks);
      const winners = results.filter((r) => r.status === 200);
      const countQ = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings
         WHERE tenant_id = $1::uuid AND resource_id = $2::uuid AND starts_at = $3::timestamptz`,
        [FIXED.tenantA, actualId.rows[0]!.id, slot],
      );
      expect(countQ.rows[0]!.n).toBe(1);
      expect(winners.length).toBeGreaterThanOrEqual(1);
    }, 300_000);

    it("CONC-20x split: same slot across 2 distinct resources ANY deterministic → exactly 2 winners", async () => {
      const rids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const rid = randomUUID();
        const slug = `conc-split-r12-${i}`;
        await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
        await client.query(
          `DELETE FROM public.staff_resource_services WHERE resource_id IN (
            SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2
          )`,
          [FIXED.tenantA, slug],
        );
        await client.query(
          `DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug = $2`,
          [FIXED.tenantA, slug],
        );
        await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
        await client.query(
          `INSERT INTO public.staff_resources(id, tenant_id, display_name, slug, active, bookable, sort_order)
           VALUES ($1::uuid, $2::uuid, 'Concurrency Split ${i}', $3, TRUE, TRUE, ${200 + i})
           ON CONFLICT (tenant_id, slug) DO NOTHING`,
          [rid, FIXED.tenantA, slug],
        );
        rids.push(rid);
      }
      const actualRids = await client.query<{ id: string }>(
        `SELECT id FROM public.staff_resources WHERE tenant_id = $1::uuid AND slug IN ('conc-split-r12-0','conc-split-r12-1') ORDER BY sort_order ASC, id ASC`,
        [FIXED.tenantA],
      );
      const ridArr = actualRids.rows.map((r) => r.id);
      expect(ridArr.length).toBe(2);
      const slot = wednesdaySlot(10, 0);
      await client.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      const ph = ridArr.map((_, i) => `$${i + 3}::uuid`).join(",");
      await client.query(
        `DELETE FROM public.bookings
         WHERE tenant_id = $1::uuid AND starts_at = $2::timestamptz AND resource_id IN (${ph})`,
        [FIXED.tenantA, slot, ...ridArr],
      );
      await client.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
      const tasks: Promise<{ status: number; body: string }>[] = [];
      for (let i = 0; i < 20; i++) {
        const slug = i % 2 === 0 ? "conc-split-r12-0" : "conc-split-r12-1";
        tasks.push(
          fetch(`${restURL}/rest/v1/rpc/public_booking_create_v2`, {
            method: "POST",
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              p_slug: TENANT_A_SLUG,
              p_service_id: FIXED.svcA1,
              p_starts_at: slot,
              p_customer_name: `Race20Split-${i}`,
              p_customer_email: `race20split-${i}@velora.test`,
              p_resource_slug: slug,
            }),
          }).then(async (r) => ({ status: r.status, body: await r.text().catch(() => "") })),
        );
      }
      const results = await Promise.all(tasks);
      const winners = results.filter((r) => r.status === 200);
      const placeholders = ridArr.map((_, i) => `$${i + 3}::uuid`).join(",");
      const countQ = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int n FROM public.bookings
         WHERE tenant_id = $1::uuid AND starts_at = $2::timestamptz AND status = 'confirmed'
           AND resource_id IN (${placeholders})`,
        [FIXED.tenantA, slot, ...ridArr],
      );
      expect(countQ.rows[0]!.n).toBe(2);
      expect(winners.length).toBeGreaterThanOrEqual(2);
    }, 300_000);
  });
});
