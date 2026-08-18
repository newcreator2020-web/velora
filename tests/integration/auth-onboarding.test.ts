// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import type { Json } from "@/types/supabase";

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

function requiredOrDefault(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[name];
  if (typeof fb === "string" && fb.length > 0) return fb;
  throw new Error(`[auth-integration] missing required env: ${name}`);
}

function failIfUnsafeEnv(): void {
  const url = requiredOrDefault("NEXT_PUBLIC_SUPABASE_URL");
  const GlobalURL = (globalThis as typeof globalThis & { URL: typeof URL }).URL;
  let host: string;
  try {
    host = new GlobalURL(url).hostname;
  } catch {
    throw new Error(`[auth-integration] NEXT_PUBLIC_SUPABASE_URL invalid: ${url}`);
  }
  const projectId = process.env["SUPABASE_PROJECT_ID"] ?? "";
  if (ALLOWED_DB_HOSTS.has(host) || SAFE_PROJECT_IDS.has(projectId)) return;
  console.error(`[auth-integration][ENV] unsafe host=${host} project=${projectId}`);
  process.exit(1);
}
failIfUnsafeEnv();

const SERVICE_KEY = requiredOrDefault("SUPABASE_SERVICE_ROLE_KEY");
void SERVICE_KEY;
const TEST_PASSWORD = "VeloraAuthInt123!";

function buildPgConnOpts() {
  return {
    host: requiredOrDefault("SUPABASE_DB_HOST"),
    port: Number(requiredOrDefault("SUPABASE_DB_PORT")),
    user: "postgres",
    password: requiredOrDefault("SUPABASE_DB_PASSWORD"),
    database: "postgres",
  };
}

const TESTONLY_RPC_SQL = /* sql */ `
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
  SELECT id INTO v_id
    FROM auth.users
   WHERE lower(email::text) = v_email_lc
   ORDER BY created_at ASC LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO auth.users (
        id, instance_id, email, encrypted_password, email_confirmed_at, role,
        raw_user_meta_data, aud, is_super_admin, created_at, updated_at
    ) VALUES (
        public.gen_random_uuid(), v_instance_id, v_email_lc,
        public.crypt(p_password, public.gen_salt('bf')), v_confirmed_at,
        'authenticated', COALESCE(p_meta, '{}'::jsonb),
        'authenticated', false, NOW(), NOW()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE auth.users SET
      encrypted_password = public.crypt(p_password, public.gen_salt('bf')),
      raw_user_meta_data = COALESCE(p_meta, raw_user_meta_data),
      email_confirmed_at = COALESCE(email_confirmed_at, v_confirmed_at),
      aud                = COALESCE(NULLIF(aud, ''), 'authenticated'),
      role               = COALESCE(NULLIF(role, ''), 'authenticated'),
      updated_at         = NOW()
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.test_provision_user(TEXT,TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER
  SET search_path = public, auth AS $$
    SELECT public.test_provision_user($1,$2,'{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO service_role;
`;

const DROP_TESTONLY_RPC_SQL = /* sql */ `
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT);
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT,JSONB);
`;

let pg: PgClient;

const EMAILS = {
  alice: `alice-${Math.random().toString(36).slice(2, 8)}@authint.test`,
  bob: `bob-${Math.random().toString(36).slice(2, 8)}@authint.test`,
  clara: `clara-${Math.random().toString(36).slice(2, 8)}@authint.test`,
};

async function provision(email: string, displayName: string): Promise<string> {
  const meta = { display_name: displayName } as Json;
  const { rows } = await pg.query<{ uid: string }>(
    "SELECT public.test_provision_user($1::text, $2::text, $3::jsonb)::text AS uid",
    [email, TEST_PASSWORD, meta],
  );
  const uid = rows?.[0]?.uid;
  if (!uid) throw new Error(`test_provision_user failed for ${email}`);
  return uid;
}

async function runAs<T>(
  userId: string,
  role: "authenticated" | "anon" | "postgres",
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  await pg.query("BEGIN");
  try {
    const claims = JSON.stringify({
      sub: userId,
      role: role === "anon" ? "anon" : "authenticated",
      email: "",
    });
    await pg.query(`SET LOCAL ROLE ${role}`);
    await pg.query(`SELECT set_config('request.jwt.claims', $1::text, true)`, [claims]);
    await pg.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [userId]);
    await pg.query(`SELECT set_config('request.jwt.claim.role', $1::text, true)`, [
      role === "anon" ? "anon" : "authenticated",
    ]);
    await pg.query(`SELECT set_config('request.jwt.claim.email', '', true)`);
    const out = await fn(pg);
    await pg.query("COMMIT");
    return out;
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  }
}

async function callOnboarding(
  client: PgClient,
  args: readonly [string, string, string, string, string | null, string | null, string, string],
): Promise<{
  tenant_id: string;
  tenant_name?: string;
  tenant_slug: string;
  tenant_status?: string;
  membership_role?: string;
  membership_status?: string;
  business_profile_id?: string;
  category?: string;
  city?: string;
  province?: string;
  phone?: string | null;
  business_email?: string | null;
  timezone?: string;
  locale?: string;
  is_existing: boolean;
  [key: string]: unknown;
}> {
  const sql = `SELECT public.create_tenant_with_owner(
    $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text
  ) AS create_tenant_with_owner`;
  const { rows } = await client.query<{ create_tenant_with_owner: unknown }>(sql, [...args]);
  return rows[0]!.create_tenant_with_owner as {
    tenant_id: string;
    tenant_slug: string;
    is_existing: boolean;
    membership_role?: string;
  };
}

describe("FASE 2 — Integration Auth + Onboarding", () => {
  beforeAll(async () => {
    pg = new PgClient(buildPgConnOpts());
    await pg.connect();
    await pg.query(TESTONLY_RPC_SQL);
  }, 60_000);

  afterAll(async () => {
    try {
      await pg.query(DROP_TESTONLY_RPC_SQL);
    } catch {
      /* ignore */
    }
    try {
      await pg.end();
    } catch {
      /* ignore */
    }
  });

  it("I1 — auth user provision creates a profile row", async () => {
    const uid = await provision(EMAILS.alice, "Alice Rossi");
    const { rows } = await pg.query<{ id: string; display_name: string | null }>(
      "SELECT id, display_name FROM public.profiles WHERE id = $1 LIMIT 1",
      [uid],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(uid);
    expect(rows[0]!.display_name).toBe("Alice Rossi");
  });

  it("I2 — user without any membership returns empty active membership", async () => {
    const uid = await provision(EMAILS.bob, "Bob NoTenant");
    const { rows } = await pg.query(
      "SELECT id FROM public.tenant_memberships WHERE user_id = $1 AND status = 'active'",
      [uid],
    );
    expect(rows).toHaveLength(0);
  });

  it("I3 — onboarding RPC creates tenant (status, owner uid, slug normalized)", async () => {
    const uid = await provision(EMAILS.clara, "Clara Owner");
    const result = await runAs(uid, "authenticated", async (client) =>
      callOnboarding(client, [
        "Clara Beauty Lab",
        "Estetica",
        "Roma",
        "RM",
        "+39061234567",
        "info@clarabeauty.test",
        "Europe/Rome",
        "it-IT",
      ]),
    );
    expect(typeof result.tenant_id).toBe("string");
    expect(result.tenant_slug).toMatch(/^clara-beauty-lab(-\d+)?$/);
    expect(result.is_existing).toBe(false);
    expect(result.membership_role).toBe("owner");
    const { rows } = await pg.query<{ id: string; name: string; slug: string; status: string }>(
      "SELECT id, name, slug, status FROM public.tenants WHERE id = $1 LIMIT 1",
      [result.tenant_id as string],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("onboarding");
    expect(rows[0]!.name).toBe("Clara Beauty Lab");
  });

  it("I4 — onboarding RPC creates active owner membership", async () => {
    const uid = await provision(
      `memcheck-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "Mem Owner",
    );
    const result = await runAs(uid, "authenticated", async (client) =>
      callOnboarding(client, [
        "Membership Test Spa",
        "Salute",
        "Napoli",
        "NA",
        null,
        null,
        "Europe/Rome",
        "it-IT",
      ]),
    );
    const tenantId = result.tenant_id as string;
    const { rows } = await pg.query<{ role: string; status: string }>(
      "SELECT role, status FROM public.tenant_memberships WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, uid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("owner");
    expect(rows[0]!.status).toBe("active");
  });

  it("I5 — onboarding RPC creates business_profile with correct columns", async () => {
    const uid = await provision(
      `bp-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "BP Owner",
    );
    const NAME = "BP Parrucchieri SRL";
    const CAT = "Parrucchiere";
    const CITY = "Torino";
    const PROV = "TO";
    const E = "hello@bp.test";
    const result = await runAs(uid, "authenticated", async (client) =>
      callOnboarding(client, [NAME, CAT, CITY, PROV, null, E, "Europe/Rome", "it-IT"]),
    );
    const tenantId = result.tenant_id as string;
    const { rows } = await pg.query<{
      display_name: string;
      category: string;
      city: string;
      province: string;
      email: string | null;
    }>(
      "SELECT display_name, category, city, province, email FROM public.business_profiles WHERE tenant_id = $1 LIMIT 1",
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.display_name).toBe(NAME);
    expect(rows[0]!.category).toBe(CAT);
    expect(rows[0]!.city).toBe(CITY);
    expect(rows[0]!.province).toBe(PROV);
    expect(rows[0]!.email).toBe(E);
  });

  it("I6 — double onboarding submit is idempotent (1 tenant, 1 owner)", async () => {
    const uid = await provision(
      `idempotent-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "Idem Owner",
    );
    const params: readonly [string, string, string, string, null, null, string, string] = [
      "Idempotent Studio",
      "Bar",
      "Firenze",
      "FI",
      null,
      null,
      "Europe/Rome",
      "it-IT",
    ];
    const [first, second] = await Promise.all([
      runAs(uid, "authenticated", (client) => callOnboarding(client, params)),
      runAs(uid, "authenticated", (client) => callOnboarding(client, params)),
    ]);
    const oneIsExisting = first.is_existing === true || second.is_existing === true;
    const sameTenant = first.tenant_id === second.tenant_id;
    expect(oneIsExisting || sameTenant).toBe(true);
    const { rows } = await pg.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM public.tenant_memberships WHERE user_id = $1 AND role = 'owner' AND status = 'active'",
      [uid],
    );
    expect(new Set(rows.map((r) => r.tenant_id)).size).toBe(1);
  });

  it("I7 — cross-tenant: user B cannot read tenant A private rows (RLS enforced impersonation)", async () => {
    const uidA = await provision(
      `cross-a-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "A",
    );
    const tenantA = await runAs(uidA, "authenticated", async (client) =>
      callOnboarding(client, [
        "Tenant A Spa",
        "Servizi",
        "Venezia",
        "VE",
        null,
        null,
        "Europe/Rome",
        "it-IT",
      ]),
    );
    const uidB = await provision(
      `cross-b-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "B",
    );
    const read = await runAs(uidB, "authenticated", async (client) => {
      const bps = await client.query(
        "SELECT count(*)::int FROM public.business_profiles WHERE tenant_id = $1",
        [tenantA.tenant_id],
      );
      const mems = await client.query(
        "SELECT count(*)::int FROM public.tenant_memberships WHERE tenant_id = $1",
        [tenantA.tenant_id],
      );
      const tns = await client.query("SELECT count(*)::int FROM public.tenants WHERE id = $1", [
        tenantA.tenant_id,
      ]);
      return {
        bp: bps.rows[0]!.count as number,
        ms: mems.rows[0]!.count as number,
        tn: tns.rows[0]!.count as number,
      };
    });
    expect(read.bp).toBe(0);
    expect(read.ms).toBe(0);
    expect(read.tn).toBe(0);
  });

  it("I8 — stranger user (no memberships) cannot list any tenants/bp/memberships", async () => {
    const uidOwner = await provision(
      `rls-o-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "OwnerX",
    );
    await runAs(uidOwner, "authenticated", async (client) => {
      await callOnboarding(client, [
        "Other Tenants SRL",
        "Altro",
        "Palermo",
        "PA",
        null,
        null,
        "Europe/Rome",
        "it-IT",
      ]);
      return 0;
    });
    const uidStranger = await provision(
      `rls-s-${Math.random().toString(36).slice(2, 8)}@authint.test`,
      "Stranger",
    );
    const res = await runAs(uidStranger, "authenticated", async (client) => {
      const t = await client.query("SELECT count(*)::int FROM public.tenants");
      const bp = await client.query("SELECT count(*)::int FROM public.business_profiles");
      const m = await client.query("SELECT count(*)::int FROM public.tenant_memberships");
      return { t: t.rows[0]!.count, bp: bp.rows[0]!.count, m: m.rows[0]!.count };
    });
    expect(res.t).toBe(0);
    expect(res.bp).toBe(0);
    expect(res.m).toBe(0);
  });
});
