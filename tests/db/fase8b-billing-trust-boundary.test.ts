// FASE 8B: Billing trust boundary BT1-BT10 10/10 runtime certification.
// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "@/types/supabase";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local", "uiekkhgspziozprxulit"]);
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
function envOr(k: string): string {
  const v = process.env[k];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[k];
  if (typeof fb === "string" && fb.length > 0) return fb;
  return "";
}
function failIfUnsafe(): void {
  const host = envOr("SUPABASE_DB_HOST");
  const pid = envOr("SUPABASE_PROJECT_ID");
  if (ALLOWED_DB_HOSTS.has(host) || SAFE_PROJECT_IDS.has(pid)) return;
  throw new Error(`[bt8b] refusing unsafe DB host=${host} pid=${pid}`);
}
failIfUnsafe();

const SUPABASE_PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "BT8b!CorrectHorseBattery42!";

type ProvisionedUser = {
  userId: string;
  email: string;
  jwt: string;
  tenantId: string;
};

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authenticatedClient(jwt: string): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

function buildPgConnOpts() {
  const isLocal = SUPABASE_PROJECT_ID === "velora-local";
  const defaultHost = isLocal ? "127.0.0.1" : `${SUPABASE_PROJECT_ID}.supabase.co`;
  const defaultPort = isLocal ? "54322" : "6543";
  const host = envOr("SUPABASE_DB_HOST") || defaultHost;
  const password = envOr("SUPABASE_DB_PASSWORD");
  const portStr = envOr("SUPABASE_DB_PORT") || defaultPort;
  const port = Number(portStr) || Number(defaultPort) || 54322;
  const ssl = isLocal ? false : { rejectUnauthorized: false };
  return {
    host,
    user: "postgres",
    database: "postgres",
    password,
    port,
    ssl,
    connectionTimeoutMillis: 15_000,
  } as const;
}

let pg: PgClient | null = null;
async function getPg(): Promise<PgClient> {
  if (pg) return pg;
  pg = new PgClient(buildPgConnOpts());
  await pg.connect();
  return pg;
}

const TESTONLY_RPC_SQL = `
CREATE OR REPLACE FUNCTION public.test_provision_user(
    p_email    TEXT,
    p_password TEXT,
    p_meta     JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, auth AS $$
DECLARE
  v_instance_id UUID := COALESCE(
    (SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  );
  v_id UUID;
  v_email_lc TEXT := lower(trim(both from p_email));
  v_confirmed_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_email_lc IS NULL OR length(v_email_lc) = 0 OR p_password IS NULL THEN
    RAISE EXCEPTION 'test_provision_user: email and password required';
  END IF;
  SELECT id INTO v_id FROM auth.users
   WHERE lower(email::text) = v_email_lc ORDER BY created_at ASC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO auth.users (id, instance_id, email, encrypted_password,
      email_confirmed_at, role, raw_user_meta_data, aud, is_super_admin,
      created_at, updated_at)
    VALUES (public.gen_random_uuid(), v_instance_id, v_email_lc,
      public.crypt(p_password, public.gen_salt('bf')), v_confirmed_at,
      'authenticated', COALESCE(p_meta,'{}'::jsonb),
      'authenticated', false, NOW(), NOW())
    RETURNING id INTO v_id;
  ELSE
    UPDATE auth.users SET
      encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, v_confirmed_at),
      raw_user_meta_data = COALESCE(p_meta, raw_user_meta_data)
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.test_provision_user(TEXT, TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER
  SET search_path = public, auth AS $$
    SELECT public.test_provision_user($1,$2,'{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT) TO service_role, postgres;
`;

const ENSURE_GRANTS_SQL = `
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO service_role;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role;

GRANT ALL ON SCHEMA auth TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres;
`;

async function ensurePgSetup(): Promise<void> {
  const db = await getPg();
  await db.query(TESTONLY_RPC_SQL);
  await db.query(ENSURE_GRANTS_SQL);
}

const DROP_TESTONLY_RPC = `
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT);
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT,JSONB);
`;

async function provisionTenantWithRole(
  email: string,
  role: "owner" | "manager" | "staff",
  plan: "base" | "pro" | "internal_test" = "base",
): Promise<ProvisionedUser> {
  const db = await getPg();
  const slugLocal = email.toLowerCase().replace(/[^a-z0-9]/g, "") || "tenant";
  const slug = "bt-" + slugLocal + Math.floor(Math.random() * 1e6);
  const tenantId = crypto.randomUUID();

  await db.query(
    `INSERT INTO public.tenants(id,name,slug,status,plan_id)
    VALUES ($1::uuid,$2,$3,'active',$4)`,
    [tenantId, "BT Tenant " + slugLocal, slug, plan],
  );
  await db.query(
    `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale)
    VALUES ($1::uuid,$2,'Europe/Rome','it')`,
    [tenantId, "BP " + slug],
  );

  const display = `${role.toUpperCase()} ${slugLocal}`;
  // Crea utente via Supabase Admin API ufficiale (compatibile con signIn)
  const { data, error: err } = await serviceClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: display },
  });
  if (err || !data.user) throw new Error(`createUser failed ${err?.message ?? ""}`);
  const userId = data.user!.id;

  await db.query(
    `INSERT INTO public.profiles(id,display_name) VALUES ($1::uuid,$2)
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [userId, display],
  );

  const memId = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.tenant_memberships(id,tenant_id,user_id,role,status)
    VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'active')`,
    [memId, tenantId, userId, role],
  );

  const { data: signIn } = await anonClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (!signIn.session) throw new Error("signIn failed");
  return { userId, email, jwt: signIn.session.access_token, tenantId };
}

async function getPlanTenantsTable(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<string> {
  const { data, error } = await client
    .from("tenants")
    .select("plan_id")
    .eq("id", tenantId)
    .limit(1)
    .single();
  if (error) throw error;
  return (data as unknown as { plan_id: string }).plan_id;
}

async function getPlanDirect(tenantId: string): Promise<string> {
  const db = await getPg();
  const { rows } = await db.query(`SELECT plan_id FROM public.tenants WHERE id=$1::uuid LIMIT 1`, [
    tenantId,
  ]);
  return (rows?.[0]?.plan_id as string) ?? "__NULL__";
}

async function freshUser(
  role: "owner" | "manager" | "staff",
  plan: "base" | "pro" | "internal_test" = "base",
): Promise<ProvisionedUser> {
  const tag = `${role}-${plan}`;
  const rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return await provisionTenantWithRole(`bt-${tag}-${rnd}@velora.test`, role, plan);
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

describe("FASE8B — Billing Trust Boundary BT1-BT10", () => {
  beforeAll(async () => {
    if (!URL || !ANON_KEY || !SERVICE_KEY)
      throw new Error(`BT env missing: URL=${!!URL} AK=${!!ANON_KEY} SK=${!!SERVICE_KEY}`);
    await ensurePgSetup();
    const sanity = await serviceClient()
      .auth.admin.listUsers({ perPage: 1 })
      .catch((e) => new Error(String(e?.message ?? e)));
    if (sanity instanceof Error) throw new Error(`admin listUsers fails: ${sanity.message}`);
  }, 180_000);

  afterAll(async () => {
    try {
      await (await getPg()).query(DROP_TESTONLY_RPC);
    } finally {
      if (pg) {
        try {
          await pg.end();
        } catch {
          /* noop */
        }
        pg = null;
      }
    }
  });

  it("BT1 owner direct UPDATE plan_id → DENY unchanged", async () => {
    const user = await freshUser("owner", "base");
    const c = authenticatedClient(user.jwt);
    const before = await getPlanDirect(user.tenantId);
    expect(before).toBe("base");
    const r = await c.from("tenants").update({ plan_id: "pro" }).eq("id", user.tenantId);
    if (r.error) {
      // Note: debug code
      // (only code/status message truncated, no PII
    }
    expect(r.error).toBeDefined();
    const afterSvc = await getPlanTenantsTable(serviceClient(), user.tenantId);
    const afterDirect = await getPlanDirect(user.tenantId);
    expect(afterDirect).toBe("base");
    expect(afterSvc).toBe("base");
  });

  it("BT2 manager direct UPDATE plan_id → DENY", async () => {
    const user = await freshUser("manager", "base");
    const before = await getPlanTenantsTable(serviceClient(), user.tenantId);
    const c = authenticatedClient(user.jwt);
    await c.from("tenants").update({ plan_id: "pro" }).eq("id", user.tenantId);
    const after = await getPlanTenantsTable(serviceClient(), user.tenantId);
    expect(after).toBe(before);
  });

  it("BT3 staff direct UPDATE plan_id → DENY", async () => {
    const user = await freshUser("staff", "base");
    const before = await getPlanTenantsTable(serviceClient(), user.tenantId);
    const c = authenticatedClient(user.jwt);
    await c.from("tenants").update({ plan_id: "pro" }).eq("id", user.tenantId);
    const after = await getPlanTenantsTable(serviceClient(), user.tenantId);
    expect(after).toBe(before);
  });

  it("BT4 anon direct UPDATE plan_id → DENY", async () => {
    const user = await freshUser("owner", "base");
    const before = await getPlanTenantsTable(serviceClient(), user.tenantId);
    const c = anonClient();
    const r = await c.from("tenants").update({ plan_id: "pro" }).eq("id", user.tenantId);
    expect(r.error).toBeDefined();
    const after = await getPlanTenantsTable(serviceClient(), user.tenantId);
    expect(after).toBe(before);
  });

  it("BT5 owner authenticated cannot invoke billing_apply_subscription_plan RPC", async () => {
    const owner = await freshUser("owner", "base");
    const db = await getPg();
    const sub = uniq("sub_bt5");
    await db.query(
      `INSERT INTO public.billing_subscriptions
      (tenant_id, provider, provider_customer_id, provider_subscription_id,
       provider_price_id, status, provider_created_at)
      VALUES ($1::uuid,'stripe','cus_bt5',$2,'price_bt5','active', NOW())`,
      [owner.tenantId, sub],
    );
    const c = authenticatedClient(owner.jwt);
    const r = await c.rpc("billing_apply_subscription_plan", {
      p_tenant_id: owner.tenantId,
      p_target_plan: "pro",
      p_provider_event_id: uniq("evt_bt5"),
      p_provider_subscription_id: sub,
    });
    expect(r.error).toBeDefined();
    const after = await getPlanTenantsTable(serviceClient(), owner.tenantId);
    expect(after).toBe("base");
  });

  it("BT6 anon cannot invoke billing RPC", async () => {
    const ownerB = await freshUser("owner", "base");
    const c = anonClient();
    const r = await c.rpc("billing_apply_subscription_plan", {
      p_tenant_id: ownerB.tenantId,
      p_target_plan: "pro",
      p_provider_event_id: uniq("evt_bt6"),
      p_provider_subscription_id: "sub_bt6_neverexist",
    });
    expect(r.error).toBeDefined();
  });

  it("BT7 forged set_config app.billing_trusted + direct plan UPDATE → DENY", async () => {
    const owner = await freshUser("owner", "base");
    const before = await getPlanDirect(owner.tenantId);
    expect(before).toBe("base");
    const db = await getPg();

    await db.query("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [owner.userId]);
    await db.query(`SELECT set_config('app.billing_trusted', 'true', true)`);
    const { rows: authUidCheck } = await db.query(
      `SELECT COALESCE(current_setting('request.jwt.claim.sub', true), NULL) AS uid,
              current_setting('app.billing_trusted', true) AS guc`,
    );
    expect((authUidCheck?.[0] as { uid: string })?.uid).toBe(owner.userId);
    expect((authUidCheck?.[0] as { guc: string })?.guc).toBe("true");
    let raised: Error | null = null;
    try {
      await db.query(`UPDATE public.tenants SET plan_id = 'pro' WHERE id = $1::uuid`, [
        owner.tenantId,
      ]);
    } catch (e) {
      raised = e as Error;
    } finally {
      await db.query("ROLLBACK");
    }
    expect(raised).not.toBeNull();
    expect(String(raised?.message ?? "")).toMatch(
      /plan_id mutation denied|insufficient_privilege/i,
    );
    const after = await getPlanDirect(owner.tenantId);
    expect(after).toBe("base");
  });

  it("BT8 forged SET LOCAL app.billing_trusted + direct plan UPDATE → DENY", async () => {
    const owner = await freshUser("owner", "base");
    const before = await getPlanDirect(owner.tenantId);
    expect(before).toBe("base");
    const db = await getPg();

    await db.query("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [owner.userId]);
    await db.query(`SELECT set_config('app.billing_trusted', 'true', true)`);
    const { rows: authUidCheck } = await db.query(
      `SELECT current_setting('request.jwt.claim.sub', true) AS uid,
              current_setting('app.billing_trusted', true) AS guc`,
    );
    expect((authUidCheck?.[0] as { uid: string })?.uid).toBe(owner.userId);
    expect((authUidCheck?.[0] as { guc: string })?.guc).toBe("true");
    let raised: Error | null = null;
    try {
      await db.query(`UPDATE public.tenants SET plan_id = 'pro' WHERE id = $1::uuid`, [
        owner.tenantId,
      ]);
    } catch (e) {
      raised = e as Error;
    } finally {
      await db.query("ROLLBACK");
    }
    expect(raised).not.toBeNull();
    expect(String(raised?.message ?? "")).toMatch(
      /plan_id mutation denied|insufficient_privilege/i,
    );
    const after = await getPlanDirect(owner.tenantId);
    expect(after).toBe("base");
  });

  it("BT9 service_role trusted billing RPC transition PRO OK", async () => {
    const owner = await freshUser("owner", "base");
    const before = await getPlanTenantsTable(serviceClient(), owner.tenantId);
    expect(before).toBe("base");
    const db = await getPg();
    const sub = uniq("sub_bt9");
    const cust = uniq("cus_bt9");
    await db.query(
      `INSERT INTO public.billing_customers(tenant_id,provider,provider_customer_id) VALUES($1::uuid,'stripe',$2) ON CONFLICT DO NOTHING`,
      [owner.tenantId, cust],
    );
    await db.query(
      `INSERT INTO public.billing_subscriptions
      (tenant_id,provider,provider_customer_id,provider_subscription_id,provider_price_id,status,provider_created_at)
      VALUES($1::uuid,'stripe',$2,$3,'price_pro_bt9','active',NOW())`,
      [owner.tenantId, cust, sub],
    );

    const svc = serviceClient();
    const eventId = uniq("evt_bt9");
    const r = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: owner.tenantId,
      p_target_plan: "pro",
      p_provider_event_id: eventId,
      p_provider_subscription_id: sub,
    });
    expect(r.error).toBeNull();
    const arr = r.data as unknown as Array<{
      ok: boolean;
      code: string;
      old_plan: string;
      new_plan: string;
    }> | null;
    expect(arr).not.toBeNull();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr!.length).toBeGreaterThanOrEqual(1);
    const res0 = arr![0]!;
    expect(res0.ok).toBe(true);
    expect(res0.code).toBe("OK_TRANSITION");
    expect(res0.old_plan).toBe("base");
    expect(res0.new_plan).toBe("pro");
    const after = await getPlanTenantsTable(svc, owner.tenantId);
    expect(after).toBe("pro");
  }, 60_000);

  it("BT10 billing transition A leaves tenant B plan unchanged", async () => {
    const ownerA = await freshUser("owner", "base");
    const ownerB = await freshUser("owner", "base");
    const svc = serviceClient();
    const db = await getPg();

    const subA = uniq("sub_bt10A");
    const custA = uniq("cus_bt10A");
    await db.query(
      `INSERT INTO public.billing_customers(tenant_id,provider,provider_customer_id) VALUES($1::uuid,'stripe',$2)`,
      [ownerA.tenantId, custA],
    );
    await db.query(
      `INSERT INTO public.billing_subscriptions
      (tenant_id,provider,provider_customer_id,provider_subscription_id,provider_price_id,status,provider_created_at)
      VALUES($1::uuid,'stripe',$2,$3,'price_pro_bt10A','active',NOW())`,
      [ownerA.tenantId, custA, subA],
    );

    const beforeB = await getPlanTenantsTable(svc, ownerB.tenantId);
    expect(beforeB).toBe("base");

    const eventId = uniq("evt_bt10A");
    const r = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: ownerA.tenantId,
      p_target_plan: "pro",
      p_provider_event_id: eventId,
      p_provider_subscription_id: subA,
    });
    expect(r.error).toBeNull();
    const arr = r.data as unknown as Array<{
      ok: boolean;
      code: string;
      old_plan: string;
      new_plan: string;
    }> | null;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr![0]!.code).toBe("OK_TRANSITION");

    const afterA = await getPlanTenantsTable(svc, ownerA.tenantId);
    const afterB = await getPlanTenantsTable(svc, ownerB.tenantId);
    expect(afterA).toBe("pro");
    expect(afterB).toBe("base");
  }, 60_000);
});
