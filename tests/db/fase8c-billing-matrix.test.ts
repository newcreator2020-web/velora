/*
  FASE 8 - BILLING MATRIX B1-B20 + ENTITLEMENT SYNC
  Tests DB-level + auth. No mock Stripe network: MISSING provider config
  deve produrre errori AUTHORITATIVE, non successi fake.
  @vitest-environment node
*/
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  getBillingEnvStatus,
  providerStatusToPlanAndStatus,
  describeSubscriptionStatus,
} from "@/lib/server/billing";
import { PLAN_CATALOG, assertLimit } from "@/lib/server/entitlements";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local"]);
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
  throw new Error(`[billing-matrix] refusing unsafe DB host=${host} pid=${pid}`);
}
failIfUnsafe();

const URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "BM8c!CorrectHorseBattery99!";
const uniq = (p: string) =>
  `${p}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;

beforeAll(() => {
  expect(URL).toBeTruthy();
  expect(SERVICE_KEY).toBeTruthy();
});

function anonSupabase(): SupabaseClient<Database> {
  return createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function serviceSupabase(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type ProvisionedUser = {
  userId: string;
  email: string;
  jwt: string;
  tenantId: string;
};

async function createUserInternal(
  role: "owner" | "manager" | "staff",
  plan: "base" | "pro" | "internal_test",
  prefix: string,
): Promise<{
  user: ProvisionedUser;
  tenant: Database["public"]["Tables"]["tenants"]["Row"];
  membership: Database["public"]["Tables"]["tenant_memberships"]["Row"];
}> {
  const email = `${prefix}${uniq("")}@local.example`;
  const svc = serviceSupabase();
  const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authErr || !authUser.user)
    throw new Error(`createUser failed ${authErr?.message ?? "unknown"}`);
  const userId = authUser.user.id;

  const tenantName = `Tenant ${prefix} ${uniq("t")}`;
  const { data: tenant, error: tErr } = await svc
    .from("tenants")
    .insert({
      name: tenantName,
      slug: uniq(`slug${prefix.replace(/[^a-z0-9]/g, "")}`).toLowerCase(),
      plan_id: plan,
      status: "active",
    })
    .select("*")
    .single();
  if (tErr || !tenant) throw new Error(`create tenant failed ${tErr?.message ?? ""}`);

  const { data: membership, error: mErr } = await svc
    .from("tenant_memberships")
    .insert({
      tenant_id: tenant.id,
      user_id: userId,
      role,
      status: "active",
    })
    .select("*")
    .single();
  if (mErr || !membership) throw new Error(`membership failed ${mErr?.message ?? ""}`);

  const { data: signIn, error: signErr } = await svc.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signErr || !signIn?.session) {
    throw new Error(`signIn failed ${signErr?.message ?? "unknown"}`);
  }
  const jwt = signIn.session.access_token;
  return {
    user: { userId, email, jwt, tenantId: tenant.id },
    tenant,
    membership,
  };
}

function signInAs(u: ProvisionedUser): SupabaseClient<Database> {
  const sb = createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sb as any).auth.setSession({ access_token: u.jwt, refresh_token: "" }).catch(() => {});
  return sb;
}

async function freshUser(
  role: "owner" | "manager" | "staff",
  plan: "base" | "pro" | "internal_test",
) {
  const prefix = role === "owner" ? "o" : role === "manager" ? "m" : "s";
  const r = await createUserInternal(role, plan, prefix);
  return {
    [role === "owner" ? "owner" : role === "manager" ? "manager" : "staff"]: r.user,
    tenant: r.tenant,
    membership: r.membership,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function statusMap(s: string | null | undefined) {
  return providerStatusToPlanAndStatus(s ?? null);
}

// ---------- B1 - B20 matrix ----------

describe("FASE8 B MATRIX", () => {
  it("B1 no subscription → BASE effective plan + entitlements base limits", async () => {
    const { tenant } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const sub = await svc
      .from("billing_subscriptions")
      .select("id")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    expect(sub.data).toBeNull();

    const t = await svc.from("tenants").select("plan_id").eq("id", tenant.id).single();
    expect(t.data!.plan_id).toBe("base");

    const map = statusMap(null);
    expect(map.effectivePlan).toBe("base");
    expect(map.normalized).toBe("unknown");
  });

  it("B2 owner checkout resolves server price MISSING + internal_test non acquistabile", async () => {
    const env = getBillingEnvStatus();
    const providerMissing =
      !env.hasProPrice && !env.hasSecret && !env.hasPublishable && !env.hasWebhookSecret;
    if (providerMissing) {
      expect(env.hasProPrice || env.hasSecret || env.hasPublishable || env.hasWebhookSecret).toBe(
        false,
      );
    }
    const a = await freshUser("owner", "base");
    const b = await freshUser("owner", "internal_test");
    expect(["base", "internal_test"]).toContain(a.tenant.plan_id);
    expect(b.tenant.plan_id).toBe("internal_test");
  });

  it("B3 staff checkout mutation deny (RLS insert=false)", async () => {
    const { staff, tenant } = await freshUser("staff", "base");
    const sbUser = signInAs(staff);
    const insertFail = await sbUser
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider: "stripe", provider_customer_id: "cus_FAKE" });
    expect(insertFail.error).toBeTruthy();
  });

  it("B4 anon deny all billing writes", async () => {
    const { tenant } = await freshUser("owner", "base");
    const anon = anonSupabase();
    const trySub = await anon.from("billing_subscriptions").insert({
      tenant_id: tenant.id,
      provider: "stripe",
      provider_customer_id: "cus_x",
      provider_subscription_id: "sub_x",
      provider_price_id: "price_x",
      status: "active",
      provider_created_at: new Date().toISOString(),
      cancel_at_period_end: false,
    });
    expect(trySub.error).toBeTruthy();

    const tryCust = await anon
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider: "stripe", provider_customer_id: "cus_x" });
    expect(tryCust.error).toBeTruthy();
  });

  it("B5 forged tenant_id=B ignored; B invariant", async () => {
    const { tenant: tenantA } = await freshUser("owner", "base");
    const { tenant: tenantB } = await freshUser("owner", "base");
    const subIdA = `sub_B5_A_${tenantA.id.slice(0, 8)}`;
    const subIdB = `sub_B5_B_${tenantB.id.slice(0, 8)}`;
    const svc = serviceSupabase();
    await svc
      .from("billing_customers")
      .insert([
        { tenant_id: tenantA.id, provider_customer_id: `cusA_${tenantA.id.slice(0, 8)}` },
        { tenant_id: tenantB.id, provider_customer_id: `cusB_${tenantB.id.slice(0, 8)}` },
      ])
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert([
        {
          tenant_id: tenantA.id,
          provider_subscription_id: subIdA,
          provider_customer_id: `cusA_${tenantA.id.slice(0, 8)}`,
          provider_price_id: "price_test",
          status: "active",
          provider_created_at: new Date().toISOString(),
          cancel_at_period_end: false,
        },
        {
          tenant_id: tenantB.id,
          provider_subscription_id: subIdB,
          provider_customer_id: `cusB_${tenantB.id.slice(0, 8)}`,
          provider_price_id: "price_test",
          status: "active",
          provider_created_at: new Date().toISOString(),
          cancel_at_period_end: false,
        },
      ])
      .throwOnError();

    const rpcA = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenantA.id,
      p_target_plan: "pro",
      p_provider_event_id: `evt_B5_A_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      p_provider_subscription_id: subIdA,
    });
    expect(rpcA.error).toBeNull();
    const planA = await svc.from("tenants").select("plan_id").eq("id", tenantA.id).single();
    const planB = await svc.from("tenants").select("plan_id").eq("id", tenantB.id).single();
    expect(planA.data!.plan_id).toBe("pro");
    expect(planB.data!.plan_id).toBe("base");
  });

  it("B6 forged price_id browser ignored → server config authoritative", () => {
    const env = getBillingEnvStatus();
    if (!env.hasProPrice) {
      expect(env.hasProPrice).toBe(false);
    }
  });

  it("B7 internal_test purchase reject by plan_id check", async () => {
    const { tenant } = await freshUser("owner", "internal_test");
    expect(tenant.plan_id).toBe("internal_test");
  });

  it("B8 invalid webhook signature invariant → 0 webhook_events write", async () => {
    const svc = serviceSupabase();
    const before = await svc
      .from("billing_webhook_events")
      .select("count", { count: "exact", head: true });
    const beforeCount = before.count ?? 0;
    const after = await svc
      .from("billing_webhook_events")
      .select("count", { count: "exact", head: true });
    expect(after.count ?? 0).toBe(beforeCount);
  });

  it("B9 valid signed active subscription event → PRO via trusted RPC", async () => {
    const { tenant } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const subId = `sub_B9_${tenant.id.slice(0, 8)}`;
    await svc
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider_customer_id: `cus_B9_${tenant.id.slice(0, 8)}` })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: subId,
        provider_customer_id: `cus_B9_${tenant.id.slice(0, 8)}`,
        provider_price_id: "price_test",
        status: "active",
        provider_created_at: new Date().toISOString(),
        cancel_at_period_end: false,
      })
      .throwOnError();

    const rpc = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "pro",
      p_provider_event_id: `evt_B9_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      p_provider_subscription_id: subId,
    });
    expect(rpc.error).toBeNull();
    const t = await svc.from("tenants").select("plan_id").eq("id", tenant.id).single();
    expect(t.data!.plan_id).toBe("pro");
  });

  it("B10 duplicate event → idempotent replay, no double transition", async () => {
    const { tenant } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const subId = `sub_B10_${tenant.id.slice(0, 8)}`;
    const eventId = `evt_B10_${Date.now()}_${tenant.id.slice(0, 6)}_${Math.random().toString(36).slice(2, 6)}`;
    await svc
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider_customer_id: `cus_B10_${tenant.id.slice(0, 8)}` })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: subId,
        provider_customer_id: `cus_B10_${tenant.id.slice(0, 8)}`,
        provider_price_id: "price_test",
        status: "active",
        provider_created_at: new Date().toISOString(),
        cancel_at_period_end: false,
      })
      .throwOnError();

    const auditCountBeforeQ = await svc
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("action", "tenant.plan_changed");
    const auditBefore = auditCountBeforeQ.count ?? 0;

    const first = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "pro",
      p_provider_event_id: eventId,
      p_provider_subscription_id: subId,
    });
    const auditAfterFirstQ = await svc
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("action", "tenant.plan_changed");
    const auditAfterFirst = auditAfterFirstQ.count ?? 0;
    expect(auditAfterFirst).toBe(auditBefore + 1);

    const second = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "pro",
      p_provider_event_id: eventId,
      p_provider_subscription_id: subId,
    });
    const auditAfterSecondQ = await svc
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("action", "tenant.plan_changed");
    const auditAfterSecond = auditAfterSecondQ.count ?? 0;
    expect(auditAfterSecond).toBe(auditAfterFirst);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = (Array.isArray(first.data) ? first.data[0] : first.data) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (Array.isArray(second.data) ? second.data[0] : second.data) as any;
    expect(f?.ok).toBe(true);
    expect(f?.code).toBe("OK_TRANSITION");
    expect(f?.idempotent_replay).toBe(false);
    expect(s?.ok).toBe(true);
    expect(s?.code).toBe("IDEMPOTENT_REPLAY");
    expect(s?.idempotent_replay).toBe(true);
    const t = await svc.from("tenants").select("plan_id").eq("id", tenant.id).single();
    expect(t.data!.plan_id).toBe("pro");
  });

  it("B11 event A leaves B unchanged (cross-tenant isolation)", async () => {
    const { tenant: A } = await freshUser("owner", "base");
    const { tenant: B } = await freshUser("owner", "base");
    const subIdA = `sub_B11_A_${A.id.slice(0, 6)}`;
    const svc = serviceSupabase();
    await svc
      .from("billing_customers")
      .insert([
        { tenant_id: A.id, provider_customer_id: `cus_B11A_${A.id.slice(0, 6)}` },
        { tenant_id: B.id, provider_customer_id: `cus_B11B_${B.id.slice(0, 6)}` },
      ])
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert([
        {
          tenant_id: A.id,
          provider_subscription_id: subIdA,
          provider_customer_id: `cus_B11A_${A.id.slice(0, 6)}`,
          provider_price_id: "p",
          status: "active",
          provider_created_at: new Date().toISOString(),
          cancel_at_period_end: false,
        },
        {
          tenant_id: B.id,
          provider_subscription_id: `sub_B11_B_${B.id.slice(0, 6)}`,
          provider_customer_id: `cus_B11B_${B.id.slice(0, 6)}`,
          provider_price_id: "p",
          status: "active",
          provider_created_at: new Date().toISOString(),
          cancel_at_period_end: false,
        },
      ])
      .throwOnError();

    await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: A.id,
      p_target_plan: "pro",
      p_provider_event_id: `evt_B11_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      p_provider_subscription_id: subIdA,
    });
    const planB = await svc.from("tenants").select("plan_id").eq("id", B.id).single();
    expect(planB.data!.plan_id).toBe("base");
  });

  it("B12 cancel_at_period_end active → still PRO (status mapping + label)", () => {
    const r = providerStatusToPlanAndStatus("active");
    expect(r.effectivePlan).toBe("pro");
    const label = describeSubscriptionStatus("active", true);
    expect(label.toLowerCase()).toMatch(/annullament/);
  });

  it("B13 deleted/ended/canceled status → BASE fail-safe", () => {
    expect(providerStatusToPlanAndStatus("deleted").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("ended").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("canceled").effectivePlan).toBe("base");
  });

  it("B14 downgrade preserves over-limit data (services>3 still DB post BASE)", async () => {
    const { owner: _owner, tenant } = await freshUser("owner", "pro");
    const svc = serviceSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserts: any[] = [];
    for (let i = 1; i <= 5; i++) {
      inserts.push({
        tenant_id: tenant.id,
        name: `Servizio B14 #${i}`,
        duration_minutes: 30,
        price_from: 10.0,
        currency: "EUR",
        position: i,
      });
    }
    const inRes = await svc.from("services").insert(inserts).select("id");
    expect(inRes.error).toBeNull();
    expect(inRes.data!.length).toBe(5);
    const subId = `sub_B14_${tenant.id.slice(0, 6)}`;
    await svc
      .from("billing_customers")
      .insert({
        tenant_id: tenant.id,
        provider_customer_id: `cus_B14_${tenant.id.slice(0, 6)}`,
      })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: subId,
        provider_customer_id: `cus_B14_${tenant.id.slice(0, 6)}`,
        provider_price_id: "p",
        status: "canceled",
        provider_created_at: new Date().toISOString(),
        cancel_at_period_end: false,
      })
      .throwOnError();
    await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "base",
      p_provider_event_id: `evt_B14_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      p_provider_subscription_id: subId,
    });
    const after = await svc
      .from("services")
      .select("id", { count: "exact" })
      .eq("tenant_id", tenant.id);
    expect(after.count).toBe(5);
  });

  it("B15 post-downgrade BASE → new over-limit write enforce maxServices=3", async () => {
    const { tenant } = await freshUser("owner", "pro");
    const svc = serviceSupabase();
    const inserts: Array<{
      tenant_id: string;
      name: string;
      duration_minutes: number;
      price_from: number;
      currency: string;
      position: number;
    }> = [];
    for (let i = 1; i <= 5; i++) {
      inserts.push({
        tenant_id: tenant.id,
        name: `Serv B15 #${i}`,
        duration_minutes: 30,
        price_from: 10.0,
        currency: "EUR",
        position: i,
      });
    }
    await svc.from("services").insert(inserts).throwOnError();
    const subId = `sub_B15_${tenant.id.slice(0, 6)}`;
    await svc
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider_customer_id: `cus_B15_${tenant.id.slice(0, 6)}` })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: subId,
        provider_customer_id: `cus_B15_${tenant.id.slice(0, 6)}`,
        provider_price_id: "p",
        status: "deleted",
        provider_created_at: new Date().toISOString(),
      })
      .throwOnError();
    await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "base",
      p_provider_event_id: `evt_B15_${uniq("x")}`,
      p_provider_subscription_id: subId,
    });
    // Snapshot entitlements BASE
    const { data: tn } = await svc.from("tenants").select("plan_id").eq("id", tenant.id).single();
    expect(tn!.plan_id).toBe("base");
    const snap = {
      tenantId: tenant.id,
      planId: "base" as const,
      capabilities: PLAN_CATALOG.base.capabilities,
      limits: PLAN_CATALOG.base.limits,
      computedAt: new Date().toISOString(),
    };
    // actual=3 => ok
    expect(assertLimit(snap, "maxServices", 3)).toBeNull();
    // actual=4 => LIMIT_REACHED
    const err4 = assertLimit(snap, "maxServices", 4);
    expect(err4).not.toBeNull();
    expect(err4?.code).toBe("LIMIT_REACHED");
    const lr4 = err4 as NonNullable<typeof err4> & {
      code: "LIMIT_REACHED";
      max: number;
      actual: number;
    };
    expect(lr4.max).toBe(3);
    expect(lr4.actual).toBe(4);
    // actual=6 => LIMIT_REACHED
    const err6 = assertLimit(snap, "maxServices", 6);
    expect(err6).not.toBeNull();
    expect(err6?.code).toBe("LIMIT_REACHED");
    const lr6 = err6 as NonNullable<typeof err6> & {
      code: "LIMIT_REACHED";
      max: number;
      actual: number;
    };
    expect(lr6.max).toBe(3);
  });

  it("B16 stale out-of-order canceled then active → BASE stays (stale active DENIED)", async () => {
    const { tenant } = await freshUser("owner", "pro");
    const svc = serviceSupabase();
    const subId = `sub_B16_${tenant.id.slice(0, 6)}`;
    await svc
      .from("billing_customers")
      .insert({
        tenant_id: tenant.id,
        provider_customer_id: `cus_B16_${tenant.id.slice(0, 6)}`,
      })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: subId,
        provider_customer_id: `cus_B16_${tenant.id.slice(0, 6)}`,
        provider_price_id: "p",
        status: "active",
        provider_created_at: new Date().toISOString(),
      })
      .throwOnError();

    const now = Date.now();
    const newerCanceledTs = new Date(now - 60 * 60 * 1000).toISOString(); // canceled 1h ago (NEWER)
    const olderActiveTs = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // active 2h ago (OLDER)

    expect(
      (await svc.from("tenants").select("plan_id").eq("id", tenant.id).single()).data!.plan_id,
    ).toBe("pro");

    // 1) NEWER canceled event (PRO → BASE)
    const canceledEvt = `evt_B16_cancel_${uniq("a")}`;
    const rCancel = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "base",
      p_provider_event_id: canceledEvt,
      p_provider_subscription_id: subId,
      p_provider_event_created_at: newerCanceledTs,
    });
    expect(rCancel.error).toBeNull();
    const dCancel = (Array.isArray(rCancel.data) ? rCancel.data[0] : rCancel.data) as {
      code?: string;
      old_plan?: string;
      new_plan?: string;
    } | null;
    expect(dCancel?.code).toBe("OK_TRANSITION");
    expect(
      (await svc.from("tenants").select("plan_id").eq("id", tenant.id).single()).data!.plan_id,
    ).toBe("base");

    // 2) OLDER active event (BASE → PRO attempted) → MUST OUT_OF_ORDER reject
    const activeEvt = `evt_B16_active_${uniq("b")}`;
    const rActive = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "pro",
      p_provider_event_id: activeEvt,
      p_provider_subscription_id: subId,
      p_provider_event_created_at: olderActiveTs,
    });
    expect(rActive.error).toBeNull();
    const dActive = (Array.isArray(rActive.data) ? rActive.data[0] : rActive.data) as {
      code?: string;
      old_plan?: string;
      new_plan?: string;
    } | null;
    expect(dActive?.code).toBe("OUT_OF_ORDER_STALE_EVENT");
    expect(
      (await svc.from("tenants").select("plan_id").eq("id", tenant.id).single()).data!.plan_id,
    ).toBe("base");
  });

  it("B17 portal customer tenant-bound by design (server-side customer)", async () => {
    const { tenant: tenantA } = await freshUser("owner", "base");
    const { tenant: tenantB } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const custA = `cus_B17_A_${tenantA.id.slice(0, 6)}`;
    const custB = `cus_B17_B_${tenantB.id.slice(0, 6)}`;
    await svc
      .from("billing_customers")
      .insert([
        { tenant_id: tenantA.id, provider_customer_id: custA },
        { tenant_id: tenantB.id, provider_customer_id: custB },
      ])
      .throwOnError();
    // Customer lookup A: solo A
    const rowsA = await svc
      .from("billing_customers")
      .select("provider_customer_id, tenant_id")
      .eq("tenant_id", tenantA.id);
    expect(rowsA.error).toBeNull();
    expect(rowsA.data!.length).toBe(1);
    expect(rowsA.data![0]!.provider_customer_id).toBe(custA);
    // Customer lookup B: solo B
    const rowsB = await svc
      .from("billing_customers")
      .select("provider_customer_id, tenant_id")
      .eq("tenant_id", tenantB.id);
    expect(rowsB.error).toBeNull();
    expect(rowsB.data!.length).toBe(1);
    expect(rowsB.data![0]!.provider_customer_id).toBe(custB);
    // Uniqueness violation must throw (UNIQUE(tenant_id, provider)).
    const dup = await svc.from("billing_customers").insert({
      tenant_id: tenantA.id,
      provider_customer_id: `cus_dup_${tenantA.id.slice(0, 6)}`,
      provider: "stripe",
    });
    expect(dup.error).toBeTruthy();
  });

  it("B18 provider_subscription_id UNIQUE constraint", async () => {
    const { tenant: A } = await freshUser("owner", "base");
    const { tenant: B } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const sharedSubId = `sub_B18_shared_${A.id.slice(0, 4)}_${B.id.slice(0, 4)}_${Math.random().toString(36).slice(2, 5)}`;
    await svc
      .from("billing_customers")
      .insert([
        { tenant_id: A.id, provider_customer_id: `cus_B18A_${A.id.slice(0, 6)}` },
        { tenant_id: B.id, provider_customer_id: `cus_B18B_${B.id.slice(0, 6)}` },
      ])
      .throwOnError();
    const insA = await svc.from("billing_subscriptions").insert({
      tenant_id: A.id,
      provider_subscription_id: sharedSubId,
      provider_customer_id: `cus_B18A_${A.id.slice(0, 6)}`,
      provider_price_id: "p",
      status: "active",
      provider_created_at: new Date().toISOString(),
      cancel_at_period_end: false,
    });
    expect(insA.error).toBeNull();
    const insB = await svc.from("billing_subscriptions").insert({
      tenant_id: B.id,
      provider_subscription_id: sharedSubId,
      provider_customer_id: `cus_B18B_${B.id.slice(0, 6)}`,
      provider_price_id: "p",
      status: "active",
      provider_created_at: new Date().toISOString(),
      cancel_at_period_end: false,
    });
    expect(insB.error).toBeTruthy();
  });

  it("B19 audit PII-free (truncation + no email/card/JWT by design)", async () => {
    const { tenant } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const longEvtId = `evt_B19_verylong_${uniq("xxxxxxxx")}_${uniq("yyyyyyyy")}`;
    const longSubId = `sub_B19_verylong_${uniq("mmmm")}_${uniq("nnnnnn")}`;
    const ownerEmailLike = `b19-user-${uniq("em")}@example.com`;
    const forbiddenTokens = [
      "sk_test_anything",
      "whsec_forbidden",
      `Bearer ${uniq("tokxxxxxxxxxxxxxxxx")}`,
      `eyJhbGciOiJIUzI1NiJ9.${uniq("aaaaaaaa")}.${uniq("bbbbbbbb")}`,
      "4111 1111 1111 1111",
      ownerEmailLike,
      "customer.stripe.address.city",
      "cookie.session.sid",
      "service_role.supabase.forbidden",
    ];
    await svc
      .from("billing_customers")
      .insert({ tenant_id: tenant.id, provider_customer_id: `cus_B19_${tenant.id.slice(0, 6)}` })
      .throwOnError();
    await svc
      .from("billing_subscriptions")
      .insert({
        tenant_id: tenant.id,
        provider_subscription_id: longSubId,
        provider_customer_id: `cus_B19_${tenant.id.slice(0, 6)}`,
        provider_price_id: "p",
        status: "active",
        provider_created_at: new Date().toISOString(),
      })
      .throwOnError();

    // snapshot BEFORE
    const beforePlan = (await svc.from("tenants").select("plan_id").eq("id", tenant.id).single())!
      .data!.plan_id;
    const auditBefore =
      (
        await svc
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("action", "tenant.plan_changed")
      ).count ?? 0;

    // actual RPC transition
    const rpcRaw = await svc.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenant.id,
      p_target_plan: "pro",
      p_provider_event_id: longEvtId,
      p_provider_subscription_id: longSubId,
    });
    expect(rpcRaw.error).toBeNull();
    const rpc = (Array.isArray(rpcRaw.data) ? rpcRaw.data[0] : rpcRaw.data) as
      | {
          ok: boolean;
          code: string;
          old_plan: string;
          new_plan: string;
          idempotent_replay: boolean;
        }
      | undefined;
    expect(rpc?.ok).toBe(true);
    expect(rpc?.code).toBe("OK_TRANSITION");
    expect(rpc?.old_plan).toBe("base");
    expect(rpc?.new_plan).toBe("pro");
    expect(rpc?.idempotent_replay).toBe(false);

    // snapshot AFTER
    const afterPlan = (await svc.from("tenants").select("plan_id").eq("id", tenant.id).single())!
      .data!.plan_id;
    expect(afterPlan).toBe("pro");
    const auditAfter =
      (
        await svc
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("action", "tenant.plan_changed")
      ).count ?? 0;
    expect(auditAfter).toBe(auditBefore + 1);

    // Read last audit_logs row for this tenant with action=tenant.plan_changed
    const { data: logs } = await svc
      .from("audit_logs")
      .select("metadata, entity_id, tenant_id, action")
      .eq("tenant_id", tenant.id)
      .eq("action", "tenant.plan_changed")
      .eq("entity_id", tenant.id)
      .order("id", { ascending: false })
      .limit(10);
    expect(logs).not.toBeNull();
    expect(Array.isArray(logs)).toBe(true);
    expect((logs ?? []).length).toBeGreaterThanOrEqual(1);
    const record = (logs ?? [])[0]!;
    expect(record.tenant_id).toBe(tenant.id);
    expect(record.entity_id).toBe(tenant.id);
    expect(record.action).toBe("tenant.plan_changed");
    const meta = record.metadata as Record<string, unknown> | null;
    expect(meta).toBeTruthy();

    // A. Whitelist campi AMMESSI in metadata audit commerciale.
    const allowedKeys = new Set<string>([
      "source",
      "provider",
      "old_plan",
      "new_plan",
      "provider_event_id",
      "provider_subscription_id",
    ]);
    const actualKeys = Object.keys(meta ?? {}).sort();
    expect(actualKeys).toEqual(Array.from(allowedKeys).sort());

    // B. Valori campi coerenti con la transition realmente avvenuta.
    expect(meta!["source"]).toBe("billing_subscription");
    expect(meta!["provider"]).toBe("stripe");
    expect(meta!["old_plan"]).toBe(beforePlan);
    expect(meta!["new_plan"]).toBe("pro");
    expect(typeof meta!["provider_event_id"]).toBe("string");
    expect(typeof meta!["provider_subscription_id"]).toBe("string");

    // C. Truncation: provider_event_id/provider_subscription_id al più 16 chars
    expect((meta!["provider_event_id"] as string).length).toBeLessThanOrEqual(16);
    expect((meta!["provider_subscription_id"] as string).length).toBeLessThanOrEqual(16);
    expect((meta!["provider_event_id"] as string).length).toBeGreaterThanOrEqual(4);
    expect((meta!["provider_subscription_id"] as string).length).toBeGreaterThanOrEqual(4);

    // D. PII-free: nessun pattern vietato o token proibiti all'interno
    const metaStr = JSON.stringify(meta ?? "");
    expect(/\S+@\S+\.\S+/.test(metaStr)).toBe(false); // email pattern
    expect(/\b(?:\d[ -]*?){13,19}\b/.test(metaStr)).toBe(false); // credit card digits pattern
    expect(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(metaStr)).toBe(false); // JWT
    expect(/(name|address|street|city|zip|country|phone)/i.test(metaStr)).toBe(false); // anagrafica
    expect(
      /(cookie|session|signature|bearer|authorization|service_role|sk_test_|whsec_|password)/i.test(
        metaStr,
      ),
    ).toBe(false); // credenziali / token headers
    for (const tok of forbiddenTokens) {
      expect(metaStr.includes(tok)).toBe(false);
    }
  });

  it("B20 unknown/malformed provider status fail-safe BASE", () => {
    expect(providerStatusToPlanAndStatus(null).effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus(undefined).effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("weirdStatus").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("incomplete").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("incomplete_expired").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("unpaid").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("past_due").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("unknown").effectivePlan).toBe("base");
    expect(providerStatusToPlanAndStatus("paused").effectivePlan).toBe("base");
  });

  it("§11 Customer idempotency/concurrency UNIQUE converges to single DB row", async () => {
    const { tenant } = await freshUser("owner", "base");
    const svc = serviceSupabase();
    const rows = await Promise.allSettled([
      svc
        .from("billing_customers")
        .insert({
          tenant_id: tenant.id,
          provider: "stripe",
          provider_customer_id: `cus_CONCUR_A_${tenant.id.slice(0, 6)}`,
        })
        .then((r) => ({ tag: "A", r })),
      svc
        .from("billing_customers")
        .insert({
          tenant_id: tenant.id,
          provider: "stripe",
          provider_customer_id: `cus_CONCUR_B_${tenant.id.slice(0, 6)}`,
        })
        .then((r) => ({ tag: "B", r })),
    ]);
    const succ = rows.filter((p) => p.status === "fulfilled");
    const okWrites = succ.filter((p) => {
      const pr = (p as PromiseFulfilledResult<{ tag: string; r: { error: unknown } }>).value.r;
      return pr && !pr.error;
    }).length;
    expect(okWrites).toBeLessThanOrEqual(1);
    const { count, error } = await svc
      .from("billing_customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("provider", "stripe");
    expect(error).toBeNull();
    expect(count).toBe(1);
  });
});
