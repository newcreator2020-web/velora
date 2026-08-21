// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "@/types/supabase";

// SAFETY guardrails against staging/prod
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
    console.error(`[fase9-booking] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();
const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";

const EMAILS = {
  owner_a: "f9-owner-a@test.local",
  manager_a: "f9-manager-a@test.local",
  staff_a: "f9-staff-a@test.local",
  owner_b: "f9-owner-b@test.local",
  no_member: "f9-no-member@test.local",
} as const;

type AnyClient = SupabaseClient<Database, "public">;
const FIXED = {
  tenant_a: "00000000-0000-4999-9001-0000000000a1",
  tenant_b: "00000000-0000-4999-9001-0000000000b1",
  svc_a: "00000000-0000-4999-9002-0000000000a1",
  svc_b: "00000000-0000-4999-9002-0000000000b1",
  bp_a: "00000000-0000-4999-9003-0000000000a1",
  bp_b: "00000000-0000-4999-9003-0000000000b1",
  slug_a: "f9-tenant-alpha",
  slug_b: "f9-tenant-beta",
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
    } catch (_err: unknown) {
      /* ignore pg connection errors on close */
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
type RpcBookingArgs = Database["public"]["Functions"]["public_booking_create_slug"]["Args"];
const userIds: Record<keyof typeof EMAILS, string | null> = {
  owner_a: null,
  manager_a: null,
  staff_a: null,
  owner_b: null,
  no_member: null,
};

describe("FASE9 BOOKING CORE — DB / RLS / TAMP / CONCURRENCY / FAILURE", () => {
  beforeAll(async () => {
    const c = serviceRoleClient();
    // cleanup leftovers idempotent (direct pg, bypass RLS + trigger guard_last_active_owner)
    const pgc = await pg();
    await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgc.query(
      `DELETE FROM public.bookings WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.business_availability WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.services WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.business_profiles WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.site_editorial_state WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.billing_subscriptions WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(`DELETE FROM public.billing_webhook_events WHERE true IS NOT NULL;`);
    await pgc.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(
      `DELETE FROM public.tenants WHERE id IN ('${FIXED.tenant_a}','${FIXED.tenant_b}');`,
    );
    await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    await pgc.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await pgc.query(
      `DELETE FROM auth.users u WHERE u.email LIKE '%@test.local' AND u.email LIKE 'f9-%';`,
    );
    await pgc.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);

    // create users
    const roleOrder: (keyof typeof EMAILS)[] = [
      "owner_a",
      "manager_a",
      "staff_a",
      "owner_b",
      "no_member",
    ];
    for (const k of roleOrder) {
      const email = EMAILS[k];
      // Cleanup identities + users FIRST via SQL (replica mode to bypass audit immutable FK SET NULL)
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

      // Now create via official Supabase admin HTTP API so GoTrue state/cache is consistent
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

      // Ensure profiles row exists for has_tenant_role to work
      await pgc.query(
        `INSERT INTO public.profiles (id, display_name)
         VALUES ($1::uuid, $2::text)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [r.data.user!.id, k.replace(/_/g, " ")],
      );
    }
    // Idempotent cleanup for any prior residue (cross-suite contamination)
    {
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
    }
    // tenants + profiles
    const NOW = new Date().toISOString();
    await pgc.query(`INSERT INTO public.tenants (id,slug,name,status,published,published_at,created_at,updated_at) VALUES
      ('${FIXED.tenant_a}','${FIXED.slug_a}','F9 Alpha','active',TRUE,'${NOW}','${NOW}','${NOW}'),
      ('${FIXED.tenant_b}','${FIXED.slug_b}','F9 Beta','active',TRUE,'${NOW}','${NOW}','${NOW}');`);
    await pgc.query(`INSERT INTO public.business_profiles (tenant_id,display_name,category,city,province,timezone,locale,created_at,updated_at) VALUES
      ('${FIXED.tenant_a}','F9 Alpha Studio','hairdresser','Roma','RM','Europe/Rome','it-IT','${NOW}','${NOW}'),
      ('${FIXED.tenant_b}','F9 Beta Beauty','beauty','Milano','MI','Europe/Rome','it-IT','${NOW}','${NOW}');`);
    // memberships
    await pgc.query(`INSERT INTO public.tenant_memberships (id,tenant_id,user_id,role,status,created_at,updated_at) VALUES
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.owner_a}','owner','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.manager_a}','manager','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_a}','${userIds.staff_a}','staff','active','${NOW}','${NOW}'),
      (gen_random_uuid(),'${FIXED.tenant_b}','${userIds.owner_b}','owner','active','${NOW}','${NOW}');`);
    // services
    await pgc.query(`INSERT INTO public.services (id,tenant_id,name,description,duration_minutes,price_from,currency,active,position,created_at,updated_at) VALUES
      ('${FIXED.svc_a}','${FIXED.tenant_a}','Taglio','taglio corto uomo',45,2500,'EUR',TRUE,1,'${NOW}','${NOW}'),
      ('${FIXED.svc_b}','${FIXED.tenant_b}','Massaggio','Massaggio 60',60,5000,'EUR',TRUE,1,'${NOW}','${NOW}');`);
    // availability (seed default)
    const av = (tenantId: string, wd: number, en: boolean, s: string, e: string) =>
      `('${tenantId}',${wd},${en},'${s}'::time,'${e}'::time,'${NOW}'::timestamptz,'${NOW}'::timestamptz)`;
    const seed = [];
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
  }, 60_000);

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
    await pgc.query(`DELETE FROM public.billing_webhook_events WHERE true IS NOT NULL;`);
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
  }, 60_000);

  async function login(k: keyof typeof EMAILS): Promise<AnyClient> {
    const cl = anonClient();
    const r = await cl.auth.signInWithPassword({ email: EMAILS[k], password: PASSWORD });
    if (r.error) throw new Error(`signIn ${k}: ${r.error.message}`);
    return cl;
  }

  // -------- RLS MATRIX (R9 12) ----------
  it("R9-1 anon cannot read bookings (RLS returns 0 rows or explicit deny)", async () => {
    const a = anonClient();
    const r = await a.from("bookings").select();
    const rows = (r.data ?? []).length;
    expect(r.error !== null || rows === 0).toBe(true);
    expect(rows).toBe(0);
  });

  it("R9-2 anon cannot update booking", async () => {
    const a = anonClient();
    const r = await a
      .from("bookings")
      .update({ status: "cancelled" } as never)
      .eq("tenant_id", FIXED.tenant_a);
    expect(r.error).not.toBeNull();
  });

  it("R9-3 anon controlled create only through safe boundary (INSERT direct denied by RLS)", async () => {
    const a = anonClient();
    const r = await a.from("bookings").insert({
      tenant_id: FIXED.tenant_a,
      service_id: FIXED.svc_a,
      starts_at: new Date(Date.now() + 86400_000 * 5).toISOString(),
      ends_at: new Date(Date.now() + 86400_000 * 5 + 45 * 60_000).toISOString(),
      customer_name: "Mario",
      customer_email: "m@example.com",
    } as Database["public"]["Tables"]["bookings"]["Insert"]);
    expect(r.error).not.toBeNull();
  });

  it("R9-4 owner A reads bookings tenant A", async () => {
    const me = await login("owner_a");
    // prima crea booking via RPC
    const slot = nextMondaySlot(FIXED.tenant_a, 10, 0);
    const anon = anonClient();
    const cr = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "Sig. A Test",
      p_customer_email: "a1@ex.it",
    } as RpcBookingArgs);
    expect(cr.error).toBeNull();
    const bookingId = (cr.data as unknown as { booking_id: string }[])?.[0]?.booking_id;
    expect(bookingId).toBeTruthy();
    if (!bookingId) throw new Error("booking id missing");
    const sel = await me.from("bookings").select().eq("id", bookingId);
    expect(sel.error).toBeNull();
    expect(sel.data!.length).toBeGreaterThanOrEqual(1);
  });

  it("R9-5 manager A reads A", async () => {
    const me = await login("manager_a");
    const sel = await me.from("bookings").select();
    expect(sel.error).toBeNull();
    expect(Array.isArray(sel.data)).toBe(true);
    // same for availability
    const av = await me.from("business_availability").select();
    expect(av.error).toBeNull();
  });

  it("R9-6 staff A reads A bookings read-only", async () => {
    const me = await login("staff_a");
    const sel = await me.from("bookings").select();
    expect(sel.error).toBeNull();
    expect(Array.isArray(sel.data)).toBe(true);
    const first = sel.data?.[0]?.id;
    const beforeStatus = sel.data?.[0]?.status;
    if (first) {
      const upd = await me
        .from("bookings")
        .update({ status: "cancelled" } as never)
        .eq("id", first)
        .select();
      const denied = upd.error !== null || (Array.isArray(upd.data) && upd.data.length === 0);
      expect(denied, "staff update should be denied (error or 0 rows)").toBe(true);
      const after = await me.from("bookings").select("status").eq("id", first).maybeSingle();
      if (after.data && beforeStatus) {
        expect(after.data.status).toBe(beforeStatus);
      }
    }
  });

  it("R9-7 owner A cannot read B", async () => {
    // ensure there is at least 1 booking for B via RPC
    const anon = anonClient();
    const slot = nextMondaySlot(FIXED.tenant_b, 10, 0);
    const cr = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_b,
      p_service_id: FIXED.svc_b,
      p_starts_at: slot,
      p_customer_name: "Sig. B Test",
      p_customer_email: "b1@ex.it",
    } as RpcBookingArgs);
    expect(cr.error).toBeNull();
    const bidB = (cr.data as unknown as { booking_id: string }[])?.[0]?.booking_id;
    expect(bidB).toBeTruthy();
    if (!bidB) throw new Error("booking id missing");
    const me = await login("owner_a");
    const sel = await me.from("bookings").select().eq("id", bidB);
    expect(sel.error).toBeNull();
    expect((sel.data ?? []).length).toBe(0);
  });

  it("R9-8 manager A cannot mutate B", async () => {
    const me = await login("manager_a");
    const pgc = await pg();
    const target = (
      await pgc.query<{ id: string; status: string }>(
        `SELECT id, status FROM public.bookings WHERE tenant_id=$1 LIMIT 1`,
        [FIXED.tenant_b],
      )
    ).rows[0];
    if (target) {
      const upd = await me
        .from("bookings")
        .update({ status: "cancelled" } as never)
        .eq("id", target.id)
        .select();
      const denied = upd.error !== null || (Array.isArray(upd.data) && upd.data.length === 0);
      expect(denied, "manager A mutate B should be denied").toBe(true);
      const after = (
        await pgc.query<{ status: string }>(`SELECT status FROM public.bookings WHERE id=$1`, [
          target.id,
        ])
      ).rows[0];
      expect(after?.status).toBe(target.status);
    }
  });

  it("R9-9 no-member deny list bookings (reads 0 rows by RLS)", async () => {
    const me = await login("no_member");
    const r = await me.from("bookings").select();
    expect((r.data ?? []).length).toBe(0);
  });

  it("R9-10 service B cannot create booking for A via rpc (trust slug boundary)", async () => {
    const anon = anonClient();
    const slot = nextMondaySlot(FIXED.tenant_a, 11, 0);
    const cr = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_b,
      p_starts_at: slot,
      p_customer_name: "X Attack",
      p_customer_email: "x@ex.it",
    } as RpcBookingArgs);
    expect(cr.error).not.toBeNull();
  });

  it("R9-11 tenant A cancellation cannot affect B", async () => {
    const pgc = await pg();
    const beforeRows = (
      await pgc.query<{ id: string; status: string }>(
        `SELECT id, status FROM public.bookings WHERE tenant_id=$1 ORDER BY id LIMIT 1`,
        [FIXED.tenant_b],
      )
    ).rows;
    const before = beforeRows[0];
    if (!before) return;
    expect(beforeRows.length).toBe(1);
    const me = await login("owner_a");
    const upd = await me
      .from("bookings")
      .update({ status: "cancelled" } as never)
      .eq("id", before.id)
      .select();
    const denied = upd.error !== null || (Array.isArray(upd.data) && upd.data.length === 0);
    expect(denied, "owner A mutate B should be denied").toBe(true);
    const afterRows = (
      await pgc.query<{ status: string }>(`SELECT status FROM public.bookings WHERE id=$1`, [
        before.id,
      ])
    ).rows;
    const after = afterRows[0];
    expect(after).toBeTruthy();
    expect(after!.status).toBe(before.status);
  });

  it("R9-12 direct authenticated INSERT bypass denied", async () => {
    const me = await login("owner_a");
    const slot = nextMondaySlot(FIXED.tenant_a, 12, 0);
    const ins = await me.from("bookings").insert({
      tenant_id: FIXED.tenant_a,
      service_id: FIXED.svc_a,
      starts_at: slot,
      ends_at: new Date(new Date(slot).getTime() + 45 * 60_000).toISOString(),
      customer_name: "Bypass",
      customer_email: "b@ex.it",
    } as Database["public"]["Tables"]["bookings"]["Insert"]);
    // RLS WITH CHECK: allowed only if public_booking RPC path, direct insert policy not present for authenticated users INSERT → denied
    expect(ins.error).not.toBeNull();
  });

  // -------- TAMPERING MATRIX T9 (minimal) ----------
  it("T9-1 slug -> tenant B forged via RPC (wrong slug)", async () => {
    const anon = anonClient();
    const slot = nextMondaySlot(FIXED.tenant_a, 14, 0);
    // wrong slug, but service belonging a → denied by RPC
    const r = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_b,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "T1",
      p_customer_email: "t@ex.it",
    } as RpcBookingArgs);
    expect(r.error).not.toBeNull();
  });

  it("T9-2 service_id B from A slug RPC", async () => {
    const anon = anonClient();
    const slot = nextMondaySlot(FIXED.tenant_a, 15, 0);
    const r = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_b,
      p_starts_at: slot,
      p_customer_name: "T2",
      p_customer_email: "t@ex.it",
    } as RpcBookingArgs);
    expect(r.error).not.toBeNull();
  });

  it("T9-6 starts_at closed day (Sunday)", async () => {
    const anon = anonClient();
    // find next Sunday 10:00 Rome
    const sunday = nextWeekdayRome(0, 10, 0);
    const r = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: sunday.toISOString(),
      p_customer_name: "T6",
      p_customer_email: "t6@ex.it",
    } as RpcBookingArgs);
    expect(r.error).not.toBeNull();
  });

  it("T9-7 starts_at in the past", async () => {
    const anon = anonClient();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const r = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: past,
      p_customer_name: "T7",
      p_customer_email: "t7@ex.it",
    } as RpcBookingArgs);
    expect(r.error).not.toBeNull();
  });

  it("T9-11 overlong notes 10k chars", async () => {
    const anon = anonClient();
    const slot = nextMondaySlot(FIXED.tenant_a, 9, 0);
    const notes = "A".repeat(10_000);
    const r = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "T11",
      p_customer_email: "t11@ex.it",
      p_notes: notes,
    } as RpcBookingArgs);
    expect(r.error).not.toBeNull();
  });

  // CONCURRENCY EXACTLY 1 WIN
  it("CONCURRENCY: 2 simultaneous requests same slot → exactly 1 confirmed", async () => {
    const slot = nextMondaySlot(FIXED.tenant_a, 16, 0);
    const common = {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_email: "race@ex.it",
    } as const;
    const anon1 = anonClient();
    const anon2 = anonClient();
    const [p1, p2] = await Promise.all([
      anon1.rpc("public_booking_create_slug", {
        ...common,
        p_customer_name: "Racer Alpha",
      } as RpcBookingArgs),
      anon2.rpc("public_booking_create_slug", {
        ...common,
        p_customer_name: "Racer Beta",
      } as RpcBookingArgs),
    ]);
    const wins = [p1, p2].filter(
      (r) => r.error === null && Array.isArray(r.data) && r.data.length > 0,
    );
    const pgc = await pg();
    const countRows = (
      await pgc.query<{ n: string }>(
        `SELECT count(*)::text n FROM public.bookings WHERE tenant_id=$1 AND service_id=$2 AND starts_at=$3::timestamptz AND status='confirmed'`,
        [FIXED.tenant_a, FIXED.svc_a, slot],
      )
    ).rows;
    expect(countRows.length).toBeGreaterThanOrEqual(1);
    const row0 = countRows[0];
    expect(row0).toBeTruthy();
    const count = row0!.n;
    expect(wins.length, `exactly 1 winner (got ${wins.length})`).toBe(1);
    expect(count).toBe("1");

    // CROSS-TENANT: stesso UTC slot → A + B entrambi riescono (nessun overlap inter-tenant)
    // Orario NON usato prima da altri tests: 13:00 Rome Civil = 11:00 UTC.
    // A 45min → ends 13:45; B 60min → ends 14:00. Entrambi ≤ availability end 18:00.
    const slotCross = nextMondaySlot(FIXED.tenant_a, 13, 0);
    const callA = anonClient().rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slotCross,
      p_customer_name: "Cross A",
      p_customer_email: "cross-a@ex.it",
    } as Database["public"]["Functions"]["public_booking_create_slug"]["Args"]);
    const callB = anonClient().rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_b,
      p_service_id: FIXED.svc_b,
      p_starts_at: slotCross,
      p_customer_name: "Cross B",
      p_customer_email: "cross-b@ex.it",
    } as Database["public"]["Functions"]["public_booking_create_slug"]["Args"]);
    const [crA, crB] = await Promise.all([callA, callB]);
    expect(crA.error).toBeNull();
    expect(crB.error).toBeNull();
    const bidA = (crA.data as unknown as { booking_id: string }[])?.[0]?.booking_id;
    const bidB = (crB.data as unknown as { booking_id: string }[])?.[0]?.booking_id;
    expect(bidA).toBeTruthy();
    expect(bidB).toBeTruthy();
    const cntA = (
      await pgc.query<{ n: string }>(
        `SELECT count(*)::text n FROM public.bookings WHERE id=$1 AND status='confirmed'`,
        [bidA],
      )
    ).rows[0]?.n;
    const cntB = (
      await pgc.query<{ n: string }>(
        `SELECT count(*)::text n FROM public.bookings WHERE id=$1 AND status='confirmed'`,
        [bidB],
      )
    ).rows[0]?.n;
    expect(cntA).toBe("1");
    expect(cntB).toBe("1");
  }, 30_000);

  // FAILURE F9
  it("F9-3 unavailable slot → no write", async () => {
    const slot = nextMondaySlot(FIXED.tenant_a, 17, 0);
    const anon = anonClient();
    const first = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "F9-3A",
      p_customer_email: "f9-3a@ex.it",
    } as RpcBookingArgs);
    expect(first.error).toBeNull();
    const second = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "F9-3B",
      p_customer_email: "f9-3b@ex.it",
    } as RpcBookingArgs);
    expect(second.error).not.toBeNull();
  });

  // CANCELLATION + slot back available
  it("CANCELLATION: owner cancels → slot available again", async () => {
    const slot = nextMondaySlot(FIXED.tenant_a, 15, 0);
    const anon = anonClient();
    const cr = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "Cancel",
      p_customer_email: "c@ex.it",
    } as RpcBookingArgs);
    expect(cr.error).toBeNull();
    const bid = (cr.data as unknown as { booking_id: string }[])?.[0]?.booking_id;
    expect(bid).toBeTruthy();
    if (!bid) throw new Error("booking id missing");
    const me = await login("owner_a");
    // PRECONDITION: owner DEVE vedere la propria riga (SELECT policy OK)
    const pre = await me.from("bookings").select("id,tenant_id,status").eq("id", bid).maybeSingle();
    expect(pre.error).toBeNull();
    expect(pre.data?.id).toBe(bid);
    expect(pre.data?.tenant_id).toBe(FIXED.tenant_a);
    expect(pre.data?.status).toBe("confirmed");
    const upd = await me
      .from("bookings")
      .update({ status: "cancelled" } as never)
      .eq("id", bid)
      .select();
    expect(upd.error).toBeNull();
    expect(upd.data).toBeTruthy();
    expect(upd.data!.length).toBeGreaterThanOrEqual(1);
    const firstRow = upd.data?.[0];
    expect(firstRow).toBeTruthy();
    expect(firstRow!.status).toBe("cancelled");
    // now re-book successfully on same slot
    const again = await anon.rpc("public_booking_create_slug", {
      p_slug: FIXED.slug_a,
      p_service_id: FIXED.svc_a,
      p_starts_at: slot,
      p_customer_name: "NewBook",
      p_customer_email: "new@ex.it",
    } as RpcBookingArgs);
    expect(again.error).toBeNull();
  });
});

// -------- helpers ----------
// NOTA AGOSTO/SETTEMBRE CEST: Europe/Rome = UTC+2 (DST).
// Per i test evitiamo dipendenze da new Date() locale host: costruiamo UTC ISO manuale.
// Strategia: prossimo Lunedi (UTC day) → slot = (Rome Civil HH - 2):mm UTC.
// I test slot sono tutti in range 10:00..17:00 Rome Civil (non borderline <09:00).
const CEST_H_OFFSET = 2;
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function nextMondayUtcDate(): { y: number; mo: number; d: number } {
  const n = new Date();
  const today = n.getUTCDay(); // 0 Sun .. 6 Sat
  const delta = (8 - today) % 7 || 7;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
}
function nextMondaySlot(_tenantId: string, h: number, m: number): string {
  const { y, mo, d } = nextMondayUtcDate();
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function nextWeekdayRome(weekday: number, h: number, m: number): Date {
  const n = new Date();
  let delta = (weekday - n.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  const cand = new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta, h - CEST_H_OFFSET, m),
  );
  return cand;
}
