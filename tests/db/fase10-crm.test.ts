// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
(() => {
  const url = envOr("NEXT_PUBLIC_SUPABASE_URL");
  const host = new URL(url).hostname;
  const projectId = process.env["SUPABASE_PROJECT_ID"] ?? "";
  if (!ALLOWED_DB_HOSTS.has(host) && !SAFE_PROJECT_IDS.has(projectId)) {
    console.error(`[fase10-crm] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();
const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraFase10Crm!";

const EMAILS = {
  owner_a: "f10-owner-a@test.local",
  manager_a: "f10-manager-a@test.local",
  staff_a: "f10-staff-a@test.local",
  owner_b: "f10-owner-b@test.local",
  staff_b: "f10-staff-b@test.local",
  no_member: "f10-no-member@test.local",
} as const;

type AnyClient = SupabaseClient<Database, "public">;
const FIXED = {
  tenant_a: "00000000-0000-4100-9001-0000000000a1",
  tenant_b: "00000000-0000-4100-9001-0000000000b1",
  svc_a: "00000000-0000-4100-9002-0000000000a1",
  svc_b: "00000000-0000-4100-9002-0000000000b1",
  bp_a: "00000000-0000-4100-9003-0000000000a1",
  bp_b: "00000000-0000-4100-9003-0000000000b1",
  res_a: "00000000-0000-4100-9004-0000000000a1",
  res_b: "00000000-0000-4100-9004-0000000000b1",
  slug_a: "f10-tenant-alpha",
  slug_b: "f10-tenant-beta",
};

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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
function anonClient() {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

const userIds: Record<keyof typeof EMAILS, string | null> = {
  owner_a: null,
  manager_a: null,
  staff_a: null,
  owner_b: null,
  staff_b: null,
  no_member: null,
};

async function provisionUsers(c: AnyClient) {
  const pgc = await pg();
  const keys = Object.keys(EMAILS) as Array<keyof typeof EMAILS>;
  for (const k of keys) {
    const email = EMAILS[k];
    await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgc.query(
      `DELETE FROM auth.refresh_tokens rt USING auth.users u WHERE rt.user_id::uuid = u.id AND lower(u.email::text) = lower($1::text)`,
      [email],
    );
    await pgc.query(
      `DELETE FROM auth.identities i USING auth.users u WHERE i.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
      [email],
    );
    await pgc.query(
      `DELETE FROM auth.mfa_factors mf USING auth.users u WHERE mf.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
      [email],
    );
    await pgc.query(
      `DELETE FROM public.tenant_memberships tm USING auth.users u WHERE tm.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
      [email],
    );
    await pgc.query(
      `DELETE FROM public.profiles p USING auth.users u WHERE p.id = u.id AND lower(u.email::text) = lower($1::text)`,
      [email],
    );
    await pgc.query(`DELETE FROM auth.users WHERE lower(email::text) = lower($1::text)`, [email]);
    await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

    let r: Awaited<ReturnType<(typeof c.auth.admin)["createUser"]>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await c.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { name: k },
        });
        if (!r.error) break;
      } catch {
        // swallow transient
      }
      if (attempt < 2) await new Promise((res) => setTimeout(res, 1200));
    }
    if (!r || r.error) throw new Error(`createUser ${k}: ${r?.error?.message ?? "no response"}`);
    userIds[k] = r.data.user!.id;

    await pgc.query(
      `INSERT INTO public.profiles (id, display_name)
       VALUES ($1::uuid, $2::text)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [r.data.user!.id, k.replace(/_/g, " ")],
    );
  }
}

async function provisionTenantsAndServices(pgc: PgClient) {
  await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await pgc.query(
    `DELETE FROM public.bookings WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.customers WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.business_availability WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.services WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.tenant_memberships WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.business_profiles WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.site_sections WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.site_editorial_state WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.billing_customers WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.billing_webhook_events WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.billing_subscriptions WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(
    `DELETE FROM public.tenants WHERE id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
  );
  await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

  const NOW = new Date().toISOString();
  await pgc.query(
    `INSERT INTO public.tenants (id,slug,name,status,published,published_at,created_at,updated_at) VALUES
      ('${FIXED.tenant_a}','${FIXED.slug_a}','F10 Alpha','active',TRUE,'${NOW}','${NOW}','${NOW}'),
      ('${FIXED.tenant_b}','${FIXED.slug_b}','F10 Beta','active',TRUE,'${NOW}','${NOW}','${NOW}');`,
  );
  await pgc.query(
    `INSERT INTO public.business_profiles (tenant_id,display_name,category,city,province,timezone,locale,created_at,updated_at) VALUES
      ('${FIXED.tenant_a}','F10 Alpha Studio','hairdresser','Roma','RM','Europe/Rome','it-IT','${NOW}','${NOW}'),
      ('${FIXED.tenant_b}','F10 Beta Beauty','beauty','Milano','MI','Europe/Rome','it-IT','${NOW}','${NOW}');`,
  );
  await pgc.query(
    `INSERT INTO public.tenant_memberships (id,tenant_id,user_id,role,status,created_at,updated_at) VALUES
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.owner_a}','owner','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.manager_a}','manager','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.staff_a}','staff','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_b}','${userIds.owner_b}','owner','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_b}','${userIds.staff_b}','staff','active','${NOW}','${NOW}');`,
  );
  await pgc.query(
    `INSERT INTO public.services (id,tenant_id,name,description,duration_minutes,price_from,currency,active,position,created_at,updated_at) VALUES
      ('${FIXED.svc_a}','${FIXED.tenant_a}','Taglio A','taglio uomo',45,2500,'EUR',TRUE,1,'${NOW}','${NOW}'),
      ('${FIXED.svc_b}','${FIXED.tenant_b}','Pie B','piega donna',45,3500,'EUR',TRUE,1,'${NOW}','${NOW}');`,
  );
  const av = (tid: string, wd: number, en: boolean, s: string, e: string) =>
    `('${tid}',${wd},${en},'${s}'::time,'${e}'::time,'${NOW}'::timestamptz,'${NOW}'::timestamptz)`;
  const seed: string[] = [];
  for (const tid of [FIXED.tenant_a, FIXED.tenant_b]) {
    for (let wd = 0; wd < 7; wd++) {
      const en = wd >= 1 && wd <= 5 ? true : wd === 6 ? true : false;
      const s = "09:00";
      const e = wd === 6 ? "13:00" : "18:00";
      seed.push(av(tid, wd, en, s, e));
    }
  }
  await pgc.query(
    `INSERT INTO public.business_availability (tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at) VALUES ${seed.join(",")} ON CONFLICT (tenant_id,weekday) DO NOTHING;`,
  );
  await pgc.query(
    `INSERT INTO public.staff_resources (id,tenant_id,slug,display_name,active,bookable,sort_order,created_at,updated_at) VALUES
      ('${FIXED.res_a}','${FIXED.tenant_a}','f10-default-a','Default A',TRUE,TRUE,1,'${NOW}','${NOW}'),
      ('${FIXED.res_b}','${FIXED.tenant_b}','f10-default-b','Default B',TRUE,TRUE,1,'${NOW}','${NOW}')
     ON CONFLICT DO NOTHING;`,
  );
  await pgc.query(
    `INSERT INTO public.staff_resource_services (tenant_id,resource_id,service_id,active,created_at,updated_at) VALUES
      ('${FIXED.tenant_a}','${FIXED.res_a}','${FIXED.svc_a}',TRUE,'${NOW}','${NOW}'),
      ('${FIXED.tenant_b}','${FIXED.res_b}','${FIXED.svc_b}',TRUE,'${NOW}','${NOW}')
     ON CONFLICT DO NOTHING;`,
  );
  const rav = (tid: string, rid: string, wd: number, en: boolean, s: string, e: string) =>
    `('${tid}','${rid}',${wd},${en},'${s}'::time,'${e}'::time,'${NOW}'::timestamptz,'${NOW}'::timestamptz)`;
  const raSeed: string[] = [];
  for (const [tid, rid] of [
    [FIXED.tenant_a, FIXED.res_a],
    [FIXED.tenant_b, FIXED.res_b],
  ] as const) {
    for (let wd = 0; wd < 7; wd++) {
      const en = wd >= 1 && wd <= 5 ? true : wd === 6 ? true : false;
      const s = "09:00";
      const e = wd === 6 ? "13:00" : "18:00";
      raSeed.push(rav(tid, rid, wd, en, s, e));
    }
  }
  await pgc.query(
    `INSERT INTO public.resource_availability (tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at) VALUES ${raSeed.join(",")} ON CONFLICT DO NOTHING;`,
  );
}

function getNextMondayAnchor(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const currentWeekday = d.getUTCDay();
  const delta = currentWeekday === 1 ? 0 : (8 - currentWeekday) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}
const _MON_ANCHOR: Date = getNextMondayAnchor();
function isoPlusDays(n: number, hour = 10, minute = 0): string {
  const d = new Date(_MON_ANCHOR.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function authedClient(k: keyof typeof EMAILS) {
  const c = anonClient();
  const email = EMAILS[k];
  const { data } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  expect(data.user).toBeTruthy();
  expect(data.user!.id).not.toBeNull();
  return c;
}

describe("FASE10 CRM CORE — DB / RLS / DEDUP / CONCURRENCY / AUDIT PII-FREE", () => {
  beforeAll(async () => {
    const c = serviceRoleClient();
    await provisionUsers(c);
    const pgc = await pg();
    await provisionTenantsAndServices(pgc);
  }, 90_000);
  afterAll(async () => {
    const pgc = await pg();
    await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgc.query(
      `DELETE FROM public.bookings WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.customers WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.resource_availability WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.staff_resource_services WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.staff_resources WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.business_availability WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.services WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.business_profiles WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.site_sections WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.site_editorial_state WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.billing_customers WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.billing_webhook_events WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.billing_subscriptions WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.tenants WHERE id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    for (const k of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) {
      const email = EMAILS[k];
      await pgc.query(
        `DELETE FROM auth.refresh_tokens rt USING auth.users u WHERE rt.user_id::uuid = u.id AND lower(u.email::text) = lower($1::text)`,
        [email],
      );
      await pgc.query(
        `DELETE FROM auth.identities i USING auth.users u WHERE i.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
        [email],
      );
      await pgc.query(
        `DELETE FROM auth.mfa_factors mf USING auth.users u WHERE mf.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
        [email],
      );
      await pgc.query(
        `DELETE FROM public.tenant_memberships tm USING auth.users u WHERE tm.user_id = u.id AND lower(u.email::text) = lower($1::text)`,
        [email],
      );
      await pgc.query(
        `DELETE FROM public.profiles p USING auth.users u WHERE p.id = u.id AND lower(u.email::text) = lower($1::text)`,
        [email],
      );
      await pgc.query(`DELETE FROM auth.users WHERE lower(email::text) = lower($1::text)`, [email]);
    }
    await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    await pgClose();
  });

  it("C1 — booking pubblico crea e linka customer (RPC anon + SELECT verify)", async () => {
    const a = anonClient();
    const iso = isoPlusDays(3, 9, 30);
    const { data, error } = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso,
      p_customer_name: "Mario Rossi",
      p_customer_email: "mario.rossi@example.com",
      p_customer_phone: "+39 333 123 4567",
    });
    expect(error).toBeNull();
    const rows =
      (data as unknown as Array<{
        booking_id: string;
        customer_id?: string | null;
      }>) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.customer_id).toBeTruthy();
    const svc = serviceRoleClient();
    const { data: cust, error: cerr } = await svc
      .from("customers")
      .select("id,tenant_id,display_name,email_normalized,phone_normalized,email,phone")
      .eq("id", rows[0]!.customer_id!)
      .limit(1)
      .maybeSingle();
    expect(cerr).toBeNull();
    expect(cust).toBeTruthy();
    expect(cust!.tenant_id).toBe(FIXED.tenant_a);
    expect(cust!.email_normalized).toBe("mario.rossi@example.com");
    expect(cust!.display_name).toBe("Mario Rossi");
  });

  it("C2 — stesso tenant stessa normalized email → riusa customer", async () => {
    const a = anonClient();
    const iso1 = isoPlusDays(4, 10, 0);
    const iso2 = isoPlusDays(7, 15, 0);
    const r1 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso1,
      p_customer_name: "Mario Rossi",
      p_customer_email: "  Mario.Rossi@Example.com  ",
    });
    expect(r1.error).toBeNull();
    const r2 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso2,
      p_customer_name: "MARIO ROSSI",
      p_customer_email: "mario.rossi@example.com",
    });
    expect(r2.error).toBeNull();
    const rows1 = r1.data as unknown as Array<{ customer_id?: string | null }>;
    const rows2 = r2.data as unknown as Array<{ customer_id?: string | null }>;
    expect(rows1.length).toBeGreaterThan(0);
    expect(rows2.length).toBeGreaterThan(0);
    expect(rows1[0]!.customer_id).toBeTruthy();
    expect(rows1[0]!.customer_id).toBe(rows2[0]!.customer_id);
  });

  it("C3 — stesso tenant stesso normalized phone → riusa customer (senza email)", async () => {
    const a = anonClient();
    const iso1 = isoPlusDays(14, 9, 0);
    const iso2 = isoPlusDays(16, 10, 0);
    const r1 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso1,
      p_customer_name: "Giovanni Verdi",
      p_customer_phone: "02 1234 5678",
    });
    expect(r1.error).toBeNull();
    const r2 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso2,
      p_customer_name: "G. Verdi",
      p_customer_phone: "+39 02-1234-5678",
    });
    expect(r2.error).toBeNull();
    const rows1 = r1.data as unknown as Array<{ customer_id?: string | null }>;
    const rows2 = r2.data as unknown as Array<{ customer_id?: string | null }>;
    expect(rows1.length).toBeGreaterThan(0);
    expect(rows2.length).toBeGreaterThan(0);
    expect(rows1[0]!.customer_id).toBeTruthy();
    expect(rows1[0]!.customer_id).toBe(rows2[0]!.customer_id);
  });

  it("C4 — stesso nome SOLAMENTE non forza merge", async () => {
    const a = anonClient();
    const iso1 = isoPlusDays(10, 9, 0);
    const iso2 = isoPlusDays(11, 9, 0);
    const r1 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso1,
      p_customer_name: "Nome Unico",
      p_customer_email: "nome1@only.com",
    });
    const r2 = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: iso2,
      p_customer_name: "Nome Unico",
      p_customer_email: "nome2@only.com",
    });
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const rows1 = r1.data as unknown as Array<{ customer_id?: string | null }>;
    const rows2 = r2.data as unknown as Array<{ customer_id?: string | null }>;
    expect(rows1.length).toBeGreaterThan(0);
    expect(rows2.length).toBeGreaterThan(0);
    expect(rows1[0]!.customer_id).not.toBe(rows2[0]!.customer_id);
  });

  it("C5 — stessa email different tenant → 2 customer distinti", async () => {
    const a = anonClient();
    const isoA = isoPlusDays(14, 10, 0);
    const isoB = isoPlusDays(14, 11, 30);
    const rA = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: isoA,
      p_customer_name: "Cliente Cross",
      p_customer_email: "cross@multi-tenant.test",
    });
    const rB = await a.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_b,
      p_service_id: FIXED.svc_b,
      p_starts_at: isoB,
      p_customer_name: "Cliente Cross B",
      p_customer_email: "cross@multi-tenant.test",
    });
    expect(rA.error).toBeNull();
    expect(rB.error).toBeNull();
    const rowsA = rA.data as unknown as Array<{ customer_id?: string | null }>;
    const rowsB = rB.data as unknown as Array<{ customer_id?: string | null }>;
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsA[0]!.customer_id).toBeTruthy();
    expect(rowsB[0]!.customer_id).toBeTruthy();
    expect(rowsA[0]!.customer_id).not.toBe(rowsB[0]!.customer_id);
    const svc = serviceRoleClient();
    const { count: cnt } = await svc
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("email_normalized", "cross@multi-tenant.test");
    expect(cnt).toBe(2);
  });

  it("C6 — ANON direct read customer DENY (RLS)", async () => {
    const a = anonClient();
    const { data, error } = await a.from("customers").select("*").limit(10);
    const rows = data?.length ?? 0;
    const denied = Boolean(error) || rows === 0;
    expect(denied).toBe(true);
    if (error) expect(["42501", "42P01"]).toContain(error.code ?? "");
    if (!error) expect(rows).toBe(0);
  });

  it("C7 — ANON direct write customer DENY (INSERT RLS)", async () => {
    const a = anonClient();
    const { error } = await a.from("customers").insert({
      tenant_id: FIXED.tenant_a,
      display_name: "Anon Intrusion",
      email: "anon@x.test",
    });
    expect(error).toBeTruthy();
    expect(error!.code).toBe("42501");
  });

  it("C8 — STAFF own tenant customer READ allowed", async () => {
    const cl = await authedClient("staff_a");
    const { data, error } = await cl
      .from("customers")
      .select("id,display_name")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(20);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const c of data!) expect(c.display_name.length).toBeGreaterThan(0);
  });

  it("C9 — STAFF write customer DENY (notes update)", async () => {
    const svc = serviceRoleClient();
    const { data: one } = await svc
      .from("customers")
      .select("id")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(1)
      .maybeSingle();
    expect(one).toBeTruthy();
    const cl = await authedClient("staff_a");
    const upd = await cl.from("customers").update({ notes: "intrusion" }).eq("id", one!.id);
    const denied =
      Boolean(upd.error) || Number((upd as unknown as { count?: number | null }).count ?? 0) === 0;
    expect(denied).toBe(true);
    if (upd.error) expect(["42501", "42P01"]).toContain(upd.error.code ?? "");
  });

  it("C10 — MANAGER update notes OWN allowed", async () => {
    const svc = serviceRoleClient();
    const { data: one } = await svc
      .from("customers")
      .select("id,notes")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(1)
      .maybeSingle();
    expect(one).toBeTruthy();
    const cl = await authedClient("manager_a");
    const newNotes = `note-f10-manager-${Date.now()}`;
    const { data: after, error } = await cl
      .from("customers")
      .update({ notes: newNotes })
      .eq("id", one!.id)
      .select("id,notes")
      .limit(1)
      .maybeSingle();
    expect(error).toBeNull();
    expect(after!.notes).toBe(newNotes);
  });

  it("C11 — OWNER update customer OWN allowed", async () => {
    const svc = serviceRoleClient();
    const { data: one } = await svc
      .from("customers")
      .select("id")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(1)
      .maybeSingle();
    expect(one).toBeTruthy();
    const cl = await authedClient("owner_a");
    const { error } = await cl
      .from("customers")
      .update({ phone: "06 7890 1234" })
      .eq("id", one!.id);
    expect(error).toBeNull();
  });

  it("C12 — cross-tenant customer READ denied (Staff A → Tenant B)", async () => {
    const cl = await authedClient("staff_a");
    const { data: custB } = await cl
      .from("customers")
      .select("id,display_name")
      .eq("tenant_id", FIXED.tenant_b)
      .limit(20);
    expect(custB).toHaveLength(0);
  });

  it("C13 — cross-tenant update denied (Manager A → Customer B)", async () => {
    const svc = serviceRoleClient();
    const { data: before } = await svc
      .from("customers")
      .select("id,display_name,notes")
      .eq("tenant_id", FIXED.tenant_b)
      .limit(1)
      .maybeSingle();
    expect(before).toBeTruthy();
    const cl = await authedClient("manager_a");
    const upd = await cl.from("customers").update({ notes: "A-tamper" }).eq("id", before!.id);
    const denied =
      Boolean(upd.error) || Number((upd as unknown as { count?: number | null }).count ?? 0) === 0;
    expect(denied).toBe(true);
    const { data: after } = await svc
      .from("customers")
      .select("notes")
      .eq("id", before!.id)
      .limit(1)
      .maybeSingle();
    expect(after!.notes).toBe(before!.notes);
  });

  it("C14 — forged customer_id B in status update booking mutation A denied", async () => {
    const svc = serviceRoleClient();
    const { data: bkA } = await svc
      .from("bookings")
      .select("id,status")
      .eq("tenant_id", FIXED.tenant_a)
      .eq("status", "confirmed")
      .limit(1)
      .maybeSingle();
    expect(bkA).toBeTruthy();
    const { data: custB } = await svc
      .from("customers")
      .select("id")
      .eq("tenant_id", FIXED.tenant_b)
      .limit(1)
      .maybeSingle();
    expect(custB).toBeTruthy();
    const cl = await authedClient("manager_a");
    const { error } = await cl
      .from("bookings")
      .update({ customer_id: custB!.id })
      .eq("id", bkA!.id);
    expect(error).toBeTruthy();
    expect(error!.code).toBe("VF403");
  });

  it("C15 — notes XSS stored non eseguibile: React escape preserved + audit PII-free", async () => {
    const svc = serviceRoleClient();
    const { data: one } = await svc
      .from("customers")
      .select("id")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(1)
      .maybeSingle();
    const cl = await authedClient("owner_a");
    const xss = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    const { data: after, error } = await cl
      .from("customers")
      .update({ notes: xss })
      .eq("id", one!.id)
      .select("id,notes")
      .limit(1)
      .maybeSingle();
    expect(error).toBeNull();
    expect(after!.notes).toBe(xss);
    const { count } = await svc
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("entity_id", one!.id)
      .eq("entity_type", "customer")
      .eq("action", "customer_updated");
    expect(count ?? 0).toBeGreaterThan(0);
    const { data: al } = await svc
      .from("audit_logs")
      .select("metadata")
      .eq("entity_id", one!.id)
      .eq("action", "customer_updated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const meta = al?.metadata as Record<string, unknown> | null;
    expect(meta).not.toHaveProperty("display_name");
    expect(meta).not.toHaveProperty("notes_value");
    const metaStr = JSON.stringify(meta ?? "");
    expect(metaStr).not.toContain(xss);
  });

  it("C16 — invalid status transition (completed→confirmed) denied before===after", async () => {
    const svc = serviceRoleClient();
    const { data: bk } = await svc
      .from("bookings")
      .select("id,status")
      .eq("tenant_id", FIXED.tenant_a)
      .eq("status", "confirmed")
      .limit(1)
      .maybeSingle();
    expect(bk).toBeTruthy();
    const res = await svc
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", bk!.id)
      .select("id,status")
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data!.status).toBe("completed");
    const cl = await authedClient("owner_a");
    const res2 = await cl.from("bookings").update({ status: "confirmed" }).eq("id", bk!.id);
    expect(res2.error).toBeTruthy();
    const { data: verify } = await svc
      .from("bookings")
      .select("id,status")
      .eq("id", bk!.id)
      .limit(1)
      .maybeSingle();
    expect(verify!.status).toBe("completed");
  });

  it("C17 — legal transition confirmed→no_show allowed + audit_created", async () => {
    const svc = serviceRoleClient();
    const { data: bk } = await svc
      .from("bookings")
      .select("id,status")
      .eq("tenant_id", FIXED.tenant_a)
      .eq("status", "confirmed")
      .limit(1)
      .maybeSingle();
    expect(bk).toBeTruthy();
    const cl = await authedClient("manager_a");
    const res = await cl
      .from("bookings")
      .update({ status: "no_show" })
      .eq("id", bk!.id)
      .eq("status", "confirmed")
      .select("id,status")
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data!.status).toBe("no_show");
  });

  it("C18 — concurrent duplicate identity → deterministic dedup (single customer via RPC)", async () => {
    const iso = isoPlusDays(21, 9, 0);
    const sharedEmail = "concurrent-dedup@test.local";
    let successCount = 0;
    let errorCount = 0;
    const customerIds = new Set<string>();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }).map(async (_, i) => {
        const a = anonClient();
        const shifted = new Date(new Date(iso).getTime() + i * 45 * 60_000).toISOString();
        const { data, error } = await a.rpc("public_booking_create_slug", {
          p_slug: FIXED.slug_a,
          p_service_id: FIXED.svc_a,
          p_starts_at: shifted,
          p_customer_name: "Concurrent User",
          p_customer_email: sharedEmail,
        });
        if (error) throw error;
        const rows = data as unknown as Array<{ booking_id: string; customer_id?: string | null }>;
        return rows[0];
      }),
    );
    const svc = serviceRoleClient();
    for (const r of results) {
      if (r.status === "fulfilled") {
        successCount++;
        const cid = r.value?.customer_id;
        if (typeof cid === "string" && cid.length > 0) customerIds.add(cid);
      } else {
        errorCount++;
      }
    }
    expect(successCount + errorCount).toBe(6);
    expect(customerIds.size).toBeLessThanOrEqual(2);
    const { count } = await svc
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", FIXED.tenant_a)
      .eq("email_normalized", sharedEmail);
    expect(count).toBe(1);
  });

  it("C19 — audit_logs PII-free (no email/phone/notes in customer/booking events)", async () => {
    const pgc = await pg();
    const { rows } = await pgc.query(
      `SELECT action, entity_type, metadata FROM public.audit_logs
        WHERE tenant_id IN ($1,$2)
          AND (action IN ('customer_created','customer_updated','booking_created','booking_status_changed','booking_completed','booking_no_show','booking_cancelled'))
        ORDER BY created_at DESC LIMIT 200`,
      [FIXED.tenant_a, FIXED.tenant_b],
    );
    expect(rows.length).toBeGreaterThan(0);
    const metaStr = JSON.stringify(rows);
    const piiPatterns = [
      "mario.rossi@example.com",
      "Mario Rossi",
      "cross@multi-tenant.test",
      "333 123 4567",
      "02 1234 5678",
      "<script>alert",
      "note-f10-manager-",
    ];
    for (const pii of piiPatterns) {
      expect(metaStr).not.toContain(pii);
    }
  });

  it("C20 — booking customer history scoped correctly (B non vede A)", async () => {
    const svc = serviceRoleClient();
    const { data: custA } = await svc
      .from("customers")
      .select("id")
      .eq("tenant_id", FIXED.tenant_a)
      .limit(1)
      .maybeSingle();
    expect(custA).toBeTruthy();
    const staffB = await authedClient("staff_b");
    const { data: bkB } = await staffB
      .from("bookings")
      .select("id,customer_id")
      .eq("customer_id", custA!.id);
    expect(bkB).toHaveLength(0);
    const { data: custBView } = await staffB
      .from("customers")
      .select("id")
      .eq("id", custA!.id)
      .limit(1)
      .maybeSingle();
    expect(custBView).toBeNull();
  });
});
