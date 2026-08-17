/**
 * Database RLS — END-TO-END cross-tenant security tests.
 * ===================================================================
 * Environment: node. These tests hit the REAL Supabase cloud project
 * via the official JS clients. NO mocking. NO PostgREST override.
 *
 * Seed data:
 *   Tenant A (slug `tenant-alpha` id: 00000000-0000-4000-8000-0000000000a1)
 *     owner-a@test.local       OWNER
 *     manager-a@test.local     MANAGER
 *     staff-a@test.local       STAFF
 *   Tenant B (slug `tenant-beta`  id: 00000000-0000-4000-8000-0000000000b1)
 *     owner-b@test.local       OWNER
 *     staff-b@test.local       STAFF
 *   no-member@test.local      authenticated, NO membership
 *   platform-admin@test.local SUPER ADMIN in platform_admins
 *
 * All users are (re)provisioned with password "Test1234!" in beforeAll
 * via the service-role-only RPC `public.test_provision_user(email, pw)`.
 *
 * Impersonation: we avoid `signInWithPassword` (unreliable in some
 * GoTrue versions running on small cloud projects — fails with
 * "Database error querying schema"). Instead, every test that needs
 * to behave as a specific user calls the service-role-only SECURITY
 * DEFINER RPC `public.test_rls(p_user_id, p_action, p_args)` which:
 *     (a) builds `request.jwt.claims` so `auth.uid()` = p_user_id,
 *     (b) SET LOCAL ROLE authenticated so RLS applies,
 *     (c) runs a WHITELISTED SQL action (no dynamic SQL, no injection).
 * ===================================================================
 */
// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect, assert } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, Json } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

const PASSWORD = "Test1234!" as const;

const FIXTURE = {
  tenants: {
    A: "00000000-0000-4000-8000-0000000000a1",
    B: "00000000-0000-4000-8000-0000000000b1",
  },
} as const;

type EmailMapKey =
  "owner_a" | "manager_a" | "staff_a" | "owner_b" | "staff_b" | "no_member" | "platform_admin";

const USER_IDS: Record<EmailMapKey, string> = {
  owner_a: "",
  manager_a: "",
  staff_a: "",
  owner_b: "",
  staff_b: "",
  no_member: "",
  platform_admin: "",
};

const LEGACY_USER_IDS = [
  "11111111-1111-4000-8000-000000000001",
  "11111111-1111-4000-8000-000000000002",
  "11111111-1111-4000-8000-000000000003",
  "11111111-1111-4000-8000-000000000004",
  "11111111-1111-4000-8000-000000000005",
  "11111111-1111-4000-8000-000000000006",
  "11111111-1111-4000-8000-000000000007",
] as const;

const EMAIL_BY_USER: Record<EmailMapKey, string> = {
  owner_a: "owner-a@test.local",
  manager_a: "manager-a@test.local",
  staff_a: "staff-a@test.local",
  owner_b: "owner-b@test.local",
  staff_b: "staff-b@test.local",
  no_member: "no-member@test.local",
  platform_admin: "platform-admin@test.local",
};

const required = (name: string): string => {
  const v = process.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`[db-test] missing required env: ${name}`);
  }
  return v;
};

const URL = required("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

type AnyClient = SupabaseClient<Database, "public">;

function makeAnonClient(): AnyClient {
  return createClient<Database>(URL, ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function makeServiceClient(): AnyClient {
  return createClient<Database>(URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Short deterministic UUID-ish PK for re-inserted membership rows.
function memPk(n: number): string {
  const c = n < 10 ? "a" : "b";
  const s = n.toString().padStart(2, "0");
  return `00000000-0000-4000-8000-000000000${c}${s}`;
}

// High-level: run a whitelisted SQL action impersonating a given user.
// Returns the raw JSONB (or null) from the RPC plus any client-level error.
async function runRls(
  who: EmailMapKey,
  p_action: string,
  p_args: Record<string, unknown> = {},
): Promise<{ data: unknown; error: unknown }> {
  const svc = makeServiceClient();
  const uid = USER_IDS[who];
  assert(uid, `runRls: no USER_IDS for ${who}`);
  const { data, error } = await svc.rpc("test_rls", {
    p_user_id: uid,
    p_action,
    p_args: p_args as Json,
  });
  return { data, error };
}

// ---------------------------------------------------------------------------
// BeforeAll: deterministic, cloud-safe user provisioning.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const service = makeServiceClient();
  const users = Object.keys(EMAIL_BY_USER) as EmailMapKey[];

  // 1. Provision each user in auth.users and capture its real ID.
  for (const who of users) {
    const email = EMAIL_BY_USER[who];
    const meta = { display_name: who };
    const { data, error } = await service.rpc("test_provision_user", {
      p_email: email,
      p_password: PASSWORD,
      p_meta: meta,
    });
    if (error || !data) {
      throw new Error(
        `[db-test] test_provision_user failed for ${who}: ${
          (error as { message?: string } | null)?.message ?? "no data"
        }`,
      );
    }
    USER_IDS[who] = data as string;
  }

  // 2. Remove stale public.* rows that may be linked to the legacy
  // placeholder UUIDs (11111111-*).
  const e1 = await service.from("tenant_memberships").delete().in("user_id", LEGACY_USER_IDS);
  if (e1.error) throw new Error(`[db-test] clean memberships: ${e1.error.message}`);
  const e2 = await service.from("platform_admins").delete().in("user_id", LEGACY_USER_IDS);
  if (e2.error) throw new Error(`[db-test] clean platform_admins: ${e2.error.message}`);
  const e3 = await service.from("profiles").delete().in("id", LEGACY_USER_IDS);
  if (e3.error) throw new Error(`[db-test] clean profiles: ${e3.error.message}`);

  // 3. Re-link public schema to the resolved IDs.
  const profileRows = users.map((who) => ({
    id: USER_IDS[who],
    display_name: who.replace(/_/g, " "),
  }));
  const e4 = await service
    .from("profiles")
    .upsert(profileRows, { onConflict: "id", ignoreDuplicates: false });
  if (e4.error) throw new Error(`[db-test] upsert profiles: ${e4.error.message}`);

  const tA = FIXTURE.tenants.A;
  const tB = FIXTURE.tenants.B;
  const ts = new Date(0).toISOString();
  const membershipRows = [
    {
      id: memPk(1),
      tenant_id: tA,
      user_id: USER_IDS.owner_a,
      role: "owner" as const,
      status: "active" as const,
      created_at: ts,
      updated_at: ts,
    },
    {
      id: memPk(2),
      tenant_id: tA,
      user_id: USER_IDS.manager_a,
      role: "manager" as const,
      status: "active" as const,
      created_at: ts,
      updated_at: ts,
    },
    {
      id: memPk(3),
      tenant_id: tA,
      user_id: USER_IDS.staff_a,
      role: "staff" as const,
      status: "active" as const,
      created_at: ts,
      updated_at: ts,
    },
    {
      id: memPk(4),
      tenant_id: tB,
      user_id: USER_IDS.owner_b,
      role: "owner" as const,
      status: "active" as const,
      created_at: ts,
      updated_at: ts,
    },
    {
      id: memPk(5),
      tenant_id: tB,
      user_id: USER_IDS.staff_b,
      role: "staff" as const,
      status: "active" as const,
      created_at: ts,
      updated_at: ts,
    },
  ];
  const e5 = await service
    .from("tenant_memberships")
    .upsert(membershipRows, { onConflict: "tenant_id,user_id", ignoreDuplicates: false });
  if (e5.error) throw new Error(`[db-test] upsert tenant_memberships: ${e5.error.message}`);

  const e6 = await service.from("platform_admins").upsert(
    {
      user_id: USER_IDS.platform_admin,
      status: "active",
      grant_reason: `seed provision at ${new Date().toISOString()}`,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: false },
  );
  if (e6.error) throw new Error(`[db-test] upsert platform_admin: ${e6.error.message}`);
}, 180_000);

afterAll(async () => {
  try {
    const anon = makeAnonClient();
    await anon.auth.signOut();
  } catch {
    /* non-fatal */
  }
});

// ---------------------------------------------------------------------------
// Utility assertions.
// ---------------------------------------------------------------------------

function expectAllowed(err: unknown, data: unknown, msg: string) {
  expect(err, `${msg} — expected no error, got ${inspect(err)}`).toBeNull();
  expect(data, msg).not.toBeNull();
}

function expectDeniedOrEmpty(err: unknown, rows: unknown[] | null | undefined, msg: string) {
  const denied =
    (err !== null && err !== undefined) ||
    (Array.isArray(rows) && rows.length === 0) ||
    rows === undefined ||
    rows === null;
  if (!denied) {
    console.error(`[${msg}] expected deny, got:`, { err, rows });
  }
  expect(denied, `${msg} — expected access denied or empty result`).toBe(true);
}

// Like expectDeniedOrEmpty but also accepts scalar `null` as result (e.g.
// select:tenants.by_id returns `null` when RLS denies access).
function expectDenied(err: unknown, result: unknown, msg: string) {
  const isEmpty =
    result === null || result === undefined || (Array.isArray(result) && result.length === 0);
  const denied = (err !== null && err !== undefined) || isEmpty;
  if (!denied) {
    console.error(`[${msg}] expected deny, got:`, { err, result });
  }
  expect(denied, `${msg} — expected access denied`).toBe(true);
}

function inspect(err: unknown): string {
  if (err === null || err === undefined) return "null";
  if (typeof err === "string") return err;
  const m = (err as { message?: unknown }).message;
  if (typeof m === "string" && m.length > 0) return m;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function expectError(err: unknown, msg: string, containsHint?: string) {
  assert(err, `${msg} — expected an error, got none.`);
  const s = inspect(err);
  if (containsHint) {
    expect(
      s.includes(containsHint),
      `${msg} — expected error mentioning ${JSON.stringify(containsHint)}, got: ${s}`,
    ).toBe(true);
  }
}

// ===========================================================================
// Group 1 — HAPPY PATH: tenant A read/write own resources.
// ===========================================================================

describe("FASE 1 — Multi-tenant RLS — Group 1: Own-tenant reads (ALLOW)", () => {
  it("H1. Owner A reads Tenant A → ALLOWED", async () => {
    const { data, error } = await runRls("owner_a", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(error, data, "H1");
    expect((data as Tables<"tenants">).slug).toBe("tenant-alpha");
  });

  it("H2. Staff A reads Business Profile of Tenant A → ALLOWED", async () => {
    const { data, error } = await runRls("staff_a", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(error, data, "H2");
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it("H3. Staff A lists colleagues of Tenant A → ALLOWED", async () => {
    const { data, error } = await runRls("staff_a", "select:members.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(error, data, "H3");
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it("H4. Owner A updates name of Tenant A → ALLOWED", async () => {
    const r1 = await runRls("owner_a", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(r1.error, r1.data, "H4 read-before");
    const originalName = (r1.data as Tables<"tenants">).name;
    const newValue = `${originalName}-mut`;

    const r2 = await runRls("owner_a", "update:tenants.name", {
      tenant_id: FIXTURE.tenants.A,
      new_name: newValue,
    });
    expectAllowed(r2.error, r2.data, "H4 update");
    expect((r2.data as Tables<"tenants">).name).toBe(newValue);

    const r3 = await runRls("owner_a", "update:tenants.name", {
      tenant_id: FIXTURE.tenants.A,
      new_name: originalName,
    });
    expectAllowed(r3.error, r3.data, "H4 restore");
  });

  it("H5. Manager A edits Business Profile A description → ALLOWED", async () => {
    const r1 = await runRls("manager_a", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(r1.error, r1.data, "H5 read");
    const orig =
      ((r1.data as unknown[])[0] as Tables<"business_profiles"> | undefined)?.description ?? "";
    const newDesc = orig + "\n[updated-by-manager-a]";

    const r2 = await runRls("manager_a", "update:bp.description", {
      tenant_id: FIXTURE.tenants.A,
      new_description: newDesc,
    });
    expectAllowed(r2.error, r2.data, "H5 update");
    expect((r2.data as Tables<"business_profiles">).description).toBe(newDesc);

    const r3 = await runRls("manager_a", "update:bp.description", {
      tenant_id: FIXTURE.tenants.A,
      new_description: orig,
    });
    expectAllowed(r3.error, r3.data, "H5 restore");
  });
});

// ===========================================================================
// Group 2 — CROSS-TENANT VIOLATIONS. Expected DENIED.
// ===========================================================================

describe("FASE 1 — Multi-tenant RLS — Group 2: Cross-tenant reads/writes (DENY)", () => {
  it("N1. Owner A reads Tenant B row → DENIED (null)", async () => {
    const { data, error } = await runRls("owner_a", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.B,
    });
    expectDenied(error, data, "N1");
  });

  it("N2. Staff A reads Business Profile of Tenant B → DENIED", async () => {
    const { data, error } = await runRls("staff_a", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.B,
    });
    expectDenied(error, data, "N2");
  });

  it("N3. Owner A cannot UPDATE Tenant B name → DENIED", async () => {
    const svc = makeServiceClient();
    const { data: before } = await svc
      .from("tenants")
      .select("name")
      .eq("id", FIXTURE.tenants.B)
      .single();

    const { data, error } = await runRls("owner_a", "update:tenants.name", {
      tenant_id: FIXTURE.tenants.B,
      new_name: "HACKED TENANT B",
    });
    expectDenied(error, data, "N3");

    const { data: unchanged } = await svc
      .from("tenants")
      .select("name")
      .eq("id", FIXTURE.tenants.B)
      .single();
    expect((unchanged as Tables<"tenants">).name).toBe((before as Tables<"tenants">).name);
  });

  it("N4. Owner A cannot UPDATE Business Profile of Tenant B → DENIED", async () => {
    const { data, error } = await runRls("owner_a", "update:bp.description", {
      tenant_id: FIXTURE.tenants.B,
      new_description: "HACKED",
    });
    expectDenied(error, data, "N4");
  });

  it("N5. Manager A cannot INSERT membership into Tenant B → DENIED by RLS", async () => {
    const { data, error } = await runRls("manager_a", "insert:membership", {
      tenant_id: FIXTURE.tenants.B,
      user_id: USER_IDS.manager_a,
      role: "staff",
      status: "active",
    });
    expectDenied(error, data, "N5");
  });
});

// ===========================================================================
// Group 3 — ANON + NO-MEMBERSHIP access.
// ===========================================================================

describe("FASE 1 — Multi-tenant RLS — Group 3: Anon / no-member access (DENY)", () => {
  it("A1. Anon selects tenants → DENIED (0 rows)", async () => {
    const client = makeAnonClient();
    const { data, error } = await client.from("tenants").select();
    expectDeniedOrEmpty(error, data, "A1");
  });

  it("A2. No-membership user reads Tenant A → DENIED", async () => {
    const { data, error } = await runRls("no_member", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectDenied(error, data, "A2");
  });

  it("A3. No-membership user reads any business_profile → DENIED", async () => {
    const { data, error } = await runRls("no_member", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectDenied(error, data, "A3");
  });
});

// ===========================================================================
// Group 4 — ROLE BASED CHECKS (RBAC).
// ===========================================================================

describe("FASE 1 — Multi-tenant RLS — Group 4: Role-based checks (RBAC)", () => {
  it("R1. Staff A cannot UPDATE tenants.name (owner-only policy) → DENIED", async () => {
    const { data, error } = await runRls("staff_a", "update:tenants.name", {
      tenant_id: FIXTURE.tenants.A,
      new_name: "Staff cannot rename",
    });
    expectDenied(error, data, "R1");
  });

  it("R2. Staff A cannot INSERT new membership in Tenant A → DENIED", async () => {
    const { data, error } = await runRls("staff_a", "insert:membership", {
      tenant_id: FIXTURE.tenants.A,
      user_id: USER_IDS.staff_a,
      role: "owner",
      status: "active",
    });
    expectDenied(error, data, "R2");
  });

  it("R3. Staff B cannot read members of Tenant A → DENIED", async () => {
    const { data, error } = await runRls("staff_b", "select:members.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectDenied(error, data, "R3");
  });
});

// ===========================================================================
// Group 5 — PLATFORM ADMIN.
// ===========================================================================

describe("FASE 1 — Multi-tenant RLS — Group 5: Platform admin global access", () => {
  it("P1. Platform Admin reads Tenant A → ALLOWED", async () => {
    const { data, error } = await runRls("platform_admin", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.A,
    });
    expectAllowed(error, data, "P1");
    expect((data as Tables<"tenants">).slug).toBe("tenant-alpha");
  });

  it("P2. Platform Admin reads Tenant B → ALLOWED", async () => {
    const { data, error } = await runRls("platform_admin", "select:tenants.by_id", {
      tenant_id: FIXTURE.tenants.B,
    });
    expectAllowed(error, data, "P2");
    expect((data as Tables<"tenants">).slug).toBe("tenant-beta");
  });

  it("P3. Platform Admin reads ALL business_profiles across tenants → ALLOWED", async () => {
    const a = await runRls("platform_admin", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.A,
    });
    const b = await runRls("platform_admin", "select:bp.by_tenant", {
      tenant_id: FIXTURE.tenants.B,
    });
    expectAllowed(a.error, a.data, "P3 A");
    expectAllowed(b.error, b.data, "P3 B");
    expect((a.data as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((b.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Group 6 — INTEGRITY CONSTRAINTS (service_role, no RLS involved).
// ===========================================================================

describe("FASE 1 — Multi-tenant DB — Group 6: Integrity constraints (service role)", () => {
  it("C1. Cannot create tenant with duplicate UNIQUE slug → 23505", async () => {
    const svc = makeServiceClient();
    const { error } = await svc.from("tenants").insert({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaa01",
      name: "Dupe Alpha",
      slug: "tenant-alpha",
    });
    expectError(error, "C1", "duplicate key");
  });

  it("C2. Cannot create duplicate membership (same tenant+user) → 23505", async () => {
    const svc = makeServiceClient();
    const { error } = await svc.from("tenant_memberships").insert({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaa02",
      tenant_id: FIXTURE.tenants.A,
      user_id: USER_IDS.owner_a,
      role: "staff",
      status: "active",
    });
    expectError(error, "C2", "duplicate key");
  });

  it("C3. Cannot insert INVALID tenant role → CHECK violation", async () => {
    const svc = makeServiceClient();
    const { error } = await svc.from("tenant_memberships").insert({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaa03",
      tenant_id: FIXTURE.tenants.A,
      user_id: USER_IDS.platform_admin,
      role: "superman", // invalid
      status: "active",
    });
    expectError(error, "C3", "violates check constraint");
  });

  it("C4. Cannot insert membership with NON-EXISTENT tenant → 23503 FK", async () => {
    const svc = makeServiceClient();
    const { error } = await svc.from("tenant_memberships").insert({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaa04",
      tenant_id: "deadbeef-dead-4ead-8ead-deadbeef0001",
      user_id: USER_IDS.owner_a,
      role: "staff",
      status: "active",
    });
    expectError(error, "C4", "foreign key constraint");
  });

  it("C5. Cannot insert SECOND business profile for same tenant → 23505 PK", async () => {
    const svc = makeServiceClient();
    const { error } = await svc.from("business_profiles").insert({
      tenant_id: FIXTURE.tenants.A,
    });
    expectError(error, "C5", "duplicate key");
  });

  it("C6. Audit logs are APPEND-ONLY — UPDATE throws", async () => {
    const svc = makeServiceClient();
    // First: grab a known row or insert a new non-conflicting marker.
    const markerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    try {
      await svc.from("audit_logs").insert({ id: markerId, action: "system.migration" });
    } catch {
      /* ignore duplicate */
    }
    const { error } = await svc
      .from("audit_logs")
      .update({ action: "tenant.created" })
      .eq("id", markerId);
    expectError(error, "C6 update blocked", "audit_logs is append-only");
  });
});
