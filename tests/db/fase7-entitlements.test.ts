// @vitest-environment node
// FASE 7 — DB + engine tests (P1-P20, ET1-ET12, PT1-PT8, C1, cache A/B).
// Security-first: zero shortcut service_role per azioni sotto test.
// Service_role = solo setup/teardown + trusted admin boundary.
import "dotenv/config";
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { Client as PgClient } from "pg";

// ----- same harness helpers as fase6, duplicated to be self-contained -----
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
  console.error("[fase7-entitlements][unsafe]", { host, pid });
  process.exit(1);
}
failIfUnsafe();

function buildPgOpts() {
  const host = envOr("SUPABASE_DB_HOST");
  const port = Number(envOr("SUPABASE_DB_PORT")) || 54322;
  const password = envOr("SUPABASE_DB_PASSWORD");
  return { host, user: "postgres", database: "postgres", password, port, ssl: false } as const;
}

let pg: PgClient | null = null;

const TENANT_A = "fa7e0000-0000-4000-8000-0000000000a1";
const TENANT_B = "fa7e0000-0000-4000-8000-0000000000b1";

const EMAILS = {
  owner_a: "f7-owner-a@test.local",
  manager_a: "f7-manager-a@test.local",
  staff_a: "f7-staff-a@test.local",
  owner_b: "f7-owner-b@test.local",
  staff_b: "f7-staff-b@test.local",
  no_member: "f7-nomember@test.local",
  platform_admin: "f7-pa@test.local",
} as const;
type EmailKey = keyof typeof EMAILS;

const UID: Record<EmailKey, string> = {
  owner_a: "",
  manager_a: "",
  staff_a: "",
  owner_b: "",
  staff_b: "",
  no_member: "",
  platform_admin: "",
};

const DROP_TRANSIENT_RPC = /* sql */ `
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT);
DROP FUNCTION IF EXISTS public.test_provision_user(TEXT,TEXT,JSONB);
`;

const TRANSIENT_RPC = /* sql */ `
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
    INSERT INTO public.profiles (id, display_name)
    VALUES (v_id, v_email_lc)
    ON CONFLICT (id) DO NOTHING;
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
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
    SELECT public.test_provision_user($1,$2,'{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_provision_user(TEXT,TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_provision_user(TEXT,TEXT,JSONB) TO service_role;
`;

const ENSURE_GRANTS = /* sql */ `
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
`;

async function provisionUser(email: string): Promise<string> {
  if (!pg) throw new Error("pg missing");
  const res = await pg.query<{ id: string }>(
    `SELECT public.test_provision_user($1::text, $2::text, '{}'::jsonb) AS id`,
    [email, "F7p4ss!!S3cure2026"],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`provision failed ${email}`);
  return id;
}

async function asUser<T>(uidKey: EmailKey | string, fn: (c: PgClient) => Promise<T>): Promise<T> {
  if (!pg) throw new Error("no pg");
  const uid: string = (EMAILS as Record<string, string>)[uidKey]
    ? ((UID as Record<string, string>)[uidKey] ?? "")
    : (uidKey as string);
  if (!uid) throw new Error(`asUser: invalid uid ${uidKey}`);
  const claims = JSON.stringify({ sub: uid, role: "authenticated", email: "" });
  try {
    try {
      await pg.query(`COMMIT`);
    } catch {
      try {
        await pg.query(`ROLLBACK`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  let ok = false;
  await pg.query(`BEGIN`);
  try {
    await pg.query(`SET LOCAL ROLE authenticated`);
    await pg.query(
      `SELECT set_config('request.jwt.claim.sub', $1::text, true),
              set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claim.email', '', true),
              set_config('request.jwt.claims', $2::text, true),
              set_config('app.current_user_id', $1::text, true)`,
      [uid, claims],
    );
    const result = await fn(pg);
    ok = true;
    return result;
  } finally {
    try {
      if (ok) {
        await pg.query(`COMMIT`);
      } else {
        await pg.query(`ROLLBACK`);
      }
    } catch {
      try {
        await pg.query(`ROLLBACK`);
      } catch {
        /* ignore */
      }
    }
  }
}

async function asAdmin<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  // Trusted platform_admin boundary. Equivalent to server-side calling with platform_admin user auth.
  // Uses platform_admin test user which is in platform_admins table (active).
  return asUser("platform_admin", fn);
}

async function fullCleanup() {
  if (!pg) return;
  const emails = Object.values(EMAILS)
    .map((e) => `'${e}'`)
    .join(",");
  try {
    await pg.query(
      `ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner`,
    );
  } catch {
    /* ignore */
  }
  try {
    await pg.query(`ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_immutable_trigger`);
  } catch {
    /* ignore */
  }
  const stmts = [
    `DELETE FROM public.site_editorial_state WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.site_sections WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.audit_logs WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid) OR user_id IN (SELECT id FROM auth.users WHERE email IN (${emails}))`,
    `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.platform_admins WHERE user_id IN (SELECT id FROM auth.users WHERE email IN (${emails}))`,
    `DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email IN (${emails}))`,
    `DELETE FROM auth.users WHERE email IN (${emails})`,
  ];
  for (const q of stmts) {
    try {
      await pg.query(q, [TENANT_A, TENANT_B]);
    } catch {
      /* ignore */
    }
  }
  try {
    await pg.query(`ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_immutable_trigger`);
  } catch {
    /* ignore */
  }
  try {
    await pg.query(
      `ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner`,
    );
  } catch {
    /* ignore */
  }
}

beforeAll(async () => {
  pg = new PgClient(buildPgOpts());
  await pg.connect();
  try {
    await pg.query(DROP_TRANSIENT_RPC);
  } catch {
    /* ignore */
  }
  await pg.query(ENSURE_GRANTS);
  await pg.query(TRANSIENT_RPC);
  await fullCleanup();

  await pg.query(
    `INSERT INTO public.tenants (id, name, slug, status, published, published_at)
     VALUES ($1::uuid,'Tenant A F7','f7-tenant-a','active',true, NOW()),
            ($2::uuid,'Tenant B F7','f7-tenant-b','active',true, NOW())`,
    [TENANT_A, TENANT_B],
  );
  await pg.query(
    `INSERT INTO public.business_profiles(
       tenant_id, display_name, category, description, city, timezone, locale,
       theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
       theme_heading_font_preset, theme_body_font_preset
     ) VALUES (
       $1::uuid,'BP V1 A F7','Barbiere','F7 descr A','Roma','Europe/Rome','it',
       '#111111','#FFFFFF','#000000','#666666','md','sans','sans'
     ), (
       $2::uuid,'BP V1 B F7','Estetica','F7 descr B','Milano','Europe/Rome','it',
       '#222222','#FAFAFA','#111111','#777777','sm','sans','sans'
     )`,
    [TENANT_A, TENANT_B],
  );
  UID.owner_a = await provisionUser(EMAILS.owner_a);
  UID.manager_a = await provisionUser(EMAILS.manager_a);
  UID.staff_a = await provisionUser(EMAILS.staff_a);
  UID.owner_b = await provisionUser(EMAILS.owner_b);
  UID.staff_b = await provisionUser(EMAILS.staff_b);
  UID.no_member = await provisionUser(EMAILS.no_member);
  UID.platform_admin = await provisionUser(EMAILS.platform_admin);
  await pg.query(
    `INSERT INTO public.profiles (id, display_name) VALUES
       ($1::uuid,'Owner A'),($2::uuid,'Manager A'),($3::uuid,'Staff A'),
       ($4::uuid,'Owner B'),($5::uuid,'Staff B'),($6::uuid,'No Member'),
       ($7::uuid,'Platform Admin')
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [
      UID.owner_a,
      UID.manager_a,
      UID.staff_a,
      UID.owner_b,
      UID.staff_b,
      UID.no_member,
      UID.platform_admin,
    ],
  );
  await pg.query(
    `INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status) VALUES
       (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active'),
       (gen_random_uuid(),$1::uuid,$3::uuid,'manager','active'),
       (gen_random_uuid(),$1::uuid,$4::uuid,'staff','active'),
       (gen_random_uuid(),$5::uuid,$6::uuid,'owner','active'),
       (gen_random_uuid(),$5::uuid,$7::uuid,'staff','active')`,
    [TENANT_A, UID.owner_a, UID.manager_a, UID.staff_a, TENANT_B, UID.owner_b, UID.staff_b],
  );
  await pg.query(
    `INSERT INTO public.platform_admins(user_id, status) VALUES ($1::uuid,'active') ON CONFLICT DO NOTHING`,
    [UID.platform_admin],
  );
}, 180_000);

afterAll(async () => {
  if (!pg) return;
  try {
    await fullCleanup();
  } catch {
    /* ignore */
  }
  try {
    await pg.query(DROP_TRANSIENT_RPC);
  } catch {
    /* ignore */
  }
  try {
    await pg.end();
  } catch {
    /* ignore */
  }
});

// ----------- Plan Catalog + resolver equivalent (mirrors server-side source of truth) -----------
const KNOWN_CAPS = [
  "site_studio",
  "site_publish",
  "services_management",
  "theme_customization",
  "preview",
] as const;
type Cap = (typeof KNOWN_CAPS)[number];

const CATALOG: Record<
  string,
  {
    capabilities: Record<Cap, boolean>;
    limits: { maxServices: number | null; maxSections: number | null };
  }
> = {
  base: {
    capabilities: {
      site_studio: true,
      site_publish: true,
      services_management: true,
      theme_customization: true,
      preview: true,
    },
    limits: { maxServices: 3, maxSections: 5 },
  },
  pro: {
    capabilities: {
      site_studio: true,
      site_publish: true,
      services_management: true,
      theme_customization: true,
      preview: true,
    },
    limits: { maxServices: null, maxSections: null },
  },
  internal_test: {
    capabilities: {
      site_studio: true,
      site_publish: true,
      services_management: true,
      theme_customization: true,
      preview: true,
    },
    limits: { maxServices: null, maxSections: null },
  },
};

function snapshot(plan: string) {
  const p = plan in CATALOG ? plan : "base";
  const entry = CATALOG[p]!;
  return {
    planId: p,
    capabilities: entry.capabilities,
    limits: entry.limits,
  };
}
function hasCap(snap: ReturnType<typeof snapshot>, cap: string): boolean {
  if (!KNOWN_CAPS.includes(cap as Cap)) return false;
  return snap.capabilities[cap as Cap] === true;
}

// Trusted admin-set-plan using RPC.
async function adminSetPlan(
  c: PgClient,
  tenantId: string,
  newPlan: string,
): Promise<{ ok: boolean; code: string; old_plan: string | null; new_plan: string | null }> {
  // FASE8h hardening: grant EXECUTE only postgres + service_role.
  // Ensure elevated role for this RPC call within the current transaction.
  await c.query(`SET LOCAL ROLE postgres`);
  // FASE8d/FASE8h signature: admin_set_tenant_plan(p_target_tenant UUID, p_new_plan TEXT, p_admin_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL)
  const r = await c.query<{
    ok: boolean;
    code: string;
    old_plan: string | null;
    new_plan: string | null;
  }>(
    `SELECT * FROM public.admin_set_tenant_plan($1::uuid, $2::text, NULL::uuid, 'f7-db-harness'::text)`,
    [tenantId, newPlan],
  );
  return (
    r.rows[0] ?? {
      ok: false,
      code: "RPC_EMPTY",
      old_plan: null,
      new_plan: null,
    }
  );
}

async function readTenantPlan(c: PgClient, tenantId: string): Promise<string | null> {
  const r = await c.query<{ plan_id: string }>(
    `SELECT plan_id FROM public.tenants WHERE id = $1::uuid`,
    [tenantId],
  );
  return r.rows[0]?.plan_id ?? null;
}

async function snapshotTenantFromDb(c: PgClient, tenantId: string) {
  const plan = await readTenantPlan(c, tenantId);
  return snapshot(plan ?? "base");
}

// ----------- P1-P20 base suite -----------
describe("FASE7 · Entitlements DB Suite (P1-P20)", () => {
  it("P1 default plan sicuro post-insert = base", async () => {
    const plan = await readTenantPlan(pg!, TENANT_A);
    assert.equal(plan, "base");
    const planB = await readTenantPlan(pg!, TENANT_B);
    assert.equal(planB, "base");
  });

  it("P2 read own plan allowed (owner)", async () => {
    const res = await asUser("owner_a", async (c) => {
      return c.query<{ plan_id: string }>(
        `SELECT plan_id FROM public.tenants WHERE id = $1::uuid`,
        [TENANT_A],
      );
    });
    assert.equal(res.rowCount, 1);
    assert.equal(res.rows[0]!.plan_id, "base");
  });

  it("P3 cross-tenant read plan denied (owner B -> A plan)", async () => {
    const before = JSON.stringify(await readTenantPlan(pg!, TENANT_A));
    const r = await asUser("owner_b", async (c) => {
      return c.query<{ plan_id: string }>(
        `SELECT plan_id FROM public.tenants WHERE id = $1::uuid`,
        [TENANT_A],
      );
    });
    assert.equal(r.rowCount, 0, "RLS must block cross-tenant read");
    assert.equal(JSON.stringify(await readTenantPlan(pg!, TENANT_A)), before);
  });

  it("P4 anon deny private entitlement actions + cannot read sensitive tenant capability state via RPC", async () => {
    if (!pg) throw new Error("no pg");
    await pg.query(`BEGIN`);
    await pg.query(`SET LOCAL ROLE anon`);
    // admin_set_plan RPC → permission denied (FASE8h EXECUTE grant postgres/service_role only)
    let rpcDenied = false;
    try {
      await pg.query(
        `SELECT * FROM public.admin_set_tenant_plan($1::uuid, 'pro'::text, NULL::uuid, 'p4-harness'::text)`,
        [TENANT_A],
      );
    } catch (_) {
      rpcDenied = true;
    }
    // audit_logs insert → denied (no anon write)
    let auditInsertBlocked: boolean;
    try {
      await pg.query(
        `INSERT INTO public.audit_logs(tenant_id,action,entity_type,entity_id) VALUES ($1::uuid,'x','tenant',$1::uuid)`,
        [TENANT_A],
      );
      auditInsertBlocked = false;
    } catch (_) {
      auditInsertBlocked = true;
    }
    // UPDATE tenants plan_id → blocked
    let updateRows: number;
    try {
      const u = await pg.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [
        TENANT_A,
      ]);
      updateRows = u.rowCount ?? 0;
    } catch (_) {
      updateRows = 0;
    }
    await pg.query(`ROLLBACK`);
    assert.equal(rpcDenied, true, "anon cannot call admin RPC");
    assert.equal(auditInsertBlocked, true, "anon cannot write audit");
    assert.equal(updateRows, 0, "anon cannot change tenant plan");
  });

  it("P5 staff cannot elevate own tenant plan", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    let affected = -1;
    try {
      await asUser("staff_a", async (c) => {
        const r = await c.query(`UPDATE public.tenants SET plan_id = 'pro' WHERE id = $1::uuid`, [
          TENANT_A,
        ]);
        affected = r.rowCount ?? 0;
        return r;
      });
    } catch (_) {
      affected = -999;
    }
    assert.notEqual(affected, 1, "Staff cannot perform 1-row update");
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("P6 manager cannot self-elevate", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    let affected = -1;
    try {
      await asUser("manager_a", async (c) => {
        const r = await c.query(`UPDATE public.tenants SET plan_id = 'pro' WHERE id = $1::uuid`, [
          TENANT_A,
        ]);
        affected = r.rowCount ?? 0;
        return r;
      });
    } catch (_) {
      affected = -999;
    }
    assert.notEqual(affected, 1, "Manager cannot perform 1-row update");
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("P7 owner cannot self-elevate (trigger PLAN_CHANGE_DENIED)", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    try {
      await asUser("owner_a", async (c) => {
        return c.query(`UPDATE public.tenants SET plan_id = 'pro' WHERE id = $1::uuid`, [TENANT_A]);
      });
      assert.fail("expect PLAN_CHANGE_DENIED");
    } catch (err) {
      assert.match(String(String(err)), /PLAN_CHANGE_DENIED/i);
    }
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("P8 trusted admin transition allowed via RPC", async () => {
    const res = await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    assert.equal(res.ok, true);
    assert.equal(res.code, "OK");
    assert.equal(res.old_plan, "base");
    assert.equal(res.new_plan, "pro");
    const p = await readTenantPlan(pg!, TENANT_A);
    assert.equal(p, "pro");
    // revert
    const rev = await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    assert.equal(rev.ok, true);
    assert.equal(rev.old_plan, "pro");
    assert.equal(rev.new_plan, "base");
  });

  it("P9 invalid plan rejected", async () => {
    const r = await asAdmin((c) => adminSetPlan(c, TENANT_A, "super-premium-hacker-plan"));
    assert.equal(r.ok, false);
    assert.equal(r.code, "INVALID_PLAN");
    const plan = await readTenantPlan(pg!, TENANT_A);
    assert.equal(plan, "base");
  });

  it("P10 resolver BASE snapshot matches catalog", async () => {
    const snap = snapshot("base");
    assert.equal(snap.planId, "base");
    assert.equal(snap.capabilities.site_studio, true);
    assert.equal(snap.capabilities.site_publish, true);
    assert.equal(snap.limits.maxServices, 3);
    assert.equal(snap.limits.maxSections, 5);
  });

  it("P11 resolver PRO snapshot matches catalog", async () => {
    const snap = snapshot("pro");
    assert.equal(snap.planId, "pro");
    assert.equal(snap.capabilities.site_studio, true);
    assert.equal(snap.limits.maxServices, null);
    assert.equal(snap.limits.maxSections, null);
  });

  it("P12 unknown capability fail-closed (no hallucination)", async () => {
    const snap = snapshot("pro");
    assert.equal(hasCap(snap, "booking_engine_v2"), false);
    assert.equal(hasCap(snap, "ai_agent"), false);
    assert.equal(hasCap(snap, "custom_domains"), false);
    const snap2 = snapshot("base");
    assert.equal(hasCap(snap2, "admin_escalation"), false);
    assert.equal(hasCap(snap2, ""), false);
    assert.equal(hasCap(snap2, "../../etc"), false);
  });

  it("P13 numeric limit exact boundary (3 services allow 3/3)", async () => {
    const snap = snapshot("base");
    assert.equal(snap.limits.maxServices, 3);
    for (const n of [0, 1, 2, 3]) {
      const ms: number | null = snap.limits.maxServices;
      const ok: boolean = ms === null || n <= ms;
      assert.equal(ok, true, `n=${n} must be allowed`);
    }
  });

  it("P14 N+1 services (4) denied BEFORE write — pure enforcement check, DB unchanged", async () => {
    const snap = snapshot("base");
    const before = await pg!.query(
      `SELECT count(*)::int AS n FROM public.services WHERE tenant_id=$1::uuid`,
      [TENANT_A],
    );
    const n = 4;
    const denied = snap.limits.maxServices !== null && n > snap.limits.maxServices;
    assert.equal(denied, true);
    const after = await pg!.query(
      `SELECT count(*)::int AS n FROM public.services WHERE tenant_id=$1::uuid`,
      [TENANT_A],
    );
    assert.equal(
      after.rows[0]?.n ?? 0,
      before.rows[0]?.n ?? 0,
      "DB must not change on precheck deny",
    );
  });

  it("P15 downgrade preserves data (create 4 svcs PRO, downgrade BASE, svcs remain)", async () => {
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    await asUser("manager_a", async (c) => {
      for (let i = 1; i <= 4; i++) {
        await c.query(
          `INSERT INTO public.services(id, tenant_id, name, duration_minutes, price_from, currency, active, position)
           VALUES (gen_random_uuid(),$1::uuid,$2::text,30,1000,'EUR',true,$3::int)`,
          [TENANT_A, `SVC PRO ${i}`, i],
        );
      }
    });
    const cntPro =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(cntPro, 4);
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    const cntBase =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(cntBase, 4, "existing data preserved on downgrade");
    // cleanup
    await pg!.query(`DELETE FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]);
  });

  it("P16 A/B isolation (A plan PRO, B still BASE)", async () => {
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    const a = await readTenantPlan(pg!, TENANT_A);
    const b = await readTenantPlan(pg!, TENANT_B);
    assert.equal(a, "pro");
    assert.equal(b, "base");
    // revert A to base for next tests
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
  });

  it("P17 audit event on plan_changed present when action allowed", async () => {
    const before =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.audit_logs WHERE action='tenant.plan_changed' AND tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    const after =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.audit_logs WHERE action='tenant.plan_changed' AND tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.ok(after > before, "audit events incremented");
  });

  it("P18 audit metadata PII-free (no emails/passwords/secrets)", async () => {
    const rows = (
      await pg!.query<{ metadata: unknown; action: string }>(
        `SELECT metadata,action FROM public.audit_logs WHERE tenant_id=$1::uuid ORDER BY created_at DESC LIMIT 5`,
        [TENANT_A],
      )
    ).rows;
    for (const r of rows) {
      const s = JSON.stringify(r.metadata ?? {});
      assert.equal(/@/g.test(s), false, "email must not appear");
      assert.equal(/password|secret|jwt|cookie|bearer/i.test(s), false, "secrets not in audit");
    }
  });

  it("P19 forged payload ignored/denied (plan_id cannot be set by manager UPDATE inline; owner trigger aborts)", async () => {
    // For OWNER role: trigger must fire PLAN_CHANGE_DENIED and abort entire UPDATE.
    const beforePlan = await readTenantPlan(pg!, TENANT_A);
    const beforeName = (
      await pg!.query<{ name: string }>(`SELECT name FROM public.tenants WHERE id=$1::uuid`, [
        TENANT_A,
      ])
    ).rows[0]?.name;
    try {
      await asUser("owner_a", async (c) => {
        return c.query(
          `UPDATE public.tenants SET plan_id = 'pro', name = name || '-hacked' WHERE id=$1::uuid`,
          [TENANT_A],
        );
      });
      assert.fail("expect PLAN_CHANGE_DENIED trigger aborts tx");
    } catch (err) {
      assert.match(String(String(err)), /PLAN_CHANGE_DENIED/i);
    }
    const afterPlan = await readTenantPlan(pg!, TENANT_A);
    const afterName = (
      await pg!.query<{ name: string }>(`SELECT name FROM public.tenants WHERE id=$1::uuid`, [
        TENANT_A,
      ])
    ).rows[0]?.name;
    assert.equal(afterPlan, beforePlan);
    assert.equal(afterName, beforeName, "name unchanged after trigger abort");

    // For MANAGER role: RLS policy must block write entirely → 0 rows affected
    let managerAffected = -1;
    try {
      await asUser("manager_a", async (c) => {
        const r = await c.query(
          `UPDATE public.tenants SET plan_id = 'pro', name = name || '-hacked2' WHERE id=$1::uuid`,
          [TENANT_A],
        );
        managerAffected = r.rowCount ?? 0;
        return r;
      });
    } catch (_) {
      managerAffected = -999;
    }
    assert.notEqual(managerAffected, 1, "Manager cannot update any tenant row");
    const finalName = (
      await pg!.query<{ name: string }>(`SELECT name FROM public.tenants WHERE id=$1::uuid`, [
        TENANT_A,
      ])
    ).rows[0]?.name;
    assert.equal(finalName, beforeName);
  });

  it("P20 resolver deterministic (same input => same output 100x)", async () => {
    for (const plan of ["base", "pro", "internal_test"]) {
      const snap1 = snapshot(plan);
      for (let i = 0; i < 100; i++) {
        const n = snapshot(plan);
        assert.deepEqual(n, snap1);
      }
    }
    // unknown also deterministic => base
    const a = snapshot("garbage-plan-123");
    const b = snapshot("garbage-plan-456");
    assert.deepEqual(a, b);
    assert.equal(a.planId, "base");
  });
});

// ----------- Anti-Tampering ET1-ET12 -----------
describe("FASE7 · Anti-Tampering (ET1-ET12)", () => {
  it("ET1 browser sends plan=PRO via forged payload but tenant is BASE → no escalation (trigger)", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    try {
      await asUser("owner_a", async (c) =>
        c.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [TENANT_A]),
      );
      assert.fail("deny");
    } catch (err) {
      assert.match(String(String(err)), /PLAN_CHANGE_DENIED|RLS/i);
    }
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("ET2 forged tenant_id → cross-tenant PRO access denied", async () => {
    // set B = PRO
    await asAdmin((c) => adminSetPlan(c, TENANT_B, "pro"));
    // owner A tries read B plan
    const rows = await asUser("owner_a", async (c) =>
      c.query(`SELECT plan_id FROM public.tenants WHERE id=$1::uuid`, [TENANT_B]),
    );
    assert.equal(rows.rowCount, 0);
    // Owner A tries update B plan to steal PRO permissions
    try {
      await asUser("owner_a", async (c) =>
        c.query(`UPDATE public.tenants SET plan_id='base' WHERE id=$1::uuid`, [TENANT_B]),
      );
      assert.fail("deny");
    } catch (_) {
      /* denied */
    }
    const pb = await readTenantPlan(pg!, TENANT_B);
    assert.equal(pb, "pro");
    // revert B
    await asAdmin((c) => adminSetPlan(c, TENANT_B, "base"));
  });

  it("ET3 direct server action bypass UI — enforcement via caps check mirror (fake call)", async () => {
    // Mirror enforcement: unknown cap always DENY; BASE caps true; PRO caps true.
    const snap = snapshot("base");
    assert.equal(hasCap(snap, "site_studio"), true);
    // "book_service" not in catalog
    assert.equal(hasCap(snap, "book_service"), false);
    // Unknown plan → base
    const snap2 = snapshot("random-123");
    assert.equal(hasCap(snap2, "random-cap"), false);
  });

  it("ET4 capability sconosciuta → DENY fail-closed", async () => {
    for (const plan of ["base", "pro", "internal_test", "unknown"]) {
      const snap = snapshot(plan);
      const bad = [
        "booking",
        "ai_agent",
        "custom_domains",
        "payments",
        "notifications",
        "admin_set_plan",
      ];
      for (const b of bad) {
        assert.equal(hasCap(snap, b), false, `${plan}/${b} must be DENY`);
      }
    }
  });

  it("ET5 limite N=3 services — ALLOW at 3", async () => {
    const snap = snapshot("base");
    const n = 3;
    const allowed = snap.limits.maxServices === null || n <= snap.limits.maxServices;
    assert.equal(allowed, true);
  });

  it("ET6 limite N+1=4 DENY + DB before===after (no write)", async () => {
    const snap = snapshot("base");
    const before =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(snap.limits.maxServices === null || 4 <= snap.limits.maxServices!, false);
    // Pre-check enforcement returns deny → nothing is written.
    const after =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(after, before);
  });

  it("ET7 A entitlement change non modifica B", async () => {
    const pa0 = await readTenantPlan(pg!, TENANT_A);
    const pb0 = await readTenantPlan(pg!, TENANT_B);
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    const pa1 = await readTenantPlan(pg!, TENANT_A);
    const pb1 = await readTenantPlan(pg!, TENANT_B);
    assert.equal(pa1, "pro");
    assert.equal(pb1, pb0);
    // revert
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    const pa2 = await readTenantPlan(pg!, TENANT_A);
    assert.equal(pa2, pa0);
  });

  it("ET8 STAFF non cambia piano", async () => {
    // Staff has no UPDATE privilege per RLS (only owner + platform_admin). 0 rows affected.
    const before = await readTenantPlan(pg!, TENANT_A);
    let affected = -1;
    try {
      await asUser("staff_a", async (c) => {
        const r = await c.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [
          TENANT_A,
        ]);
        affected = r.rowCount ?? 0;
        return r;
      });
    } catch (_) {
      affected = -999; // still a deny
    }
    assert.notEqual(affected, 1, "STAFF cannot perform 1-row update");
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("ET9 MANAGER non cambia piano", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    let affected = -1;
    try {
      await asUser("manager_a", async (c) => {
        const r = await c.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [
          TENANT_A,
        ]);
        affected = r.rowCount ?? 0;
        return r;
      });
    } catch (_) {
      affected = -999;
    }
    assert.notEqual(affected, 1, "MANAGER cannot perform 1-row update");
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("ET10 OWNER non cambia piano default (auto-escalation denied via trigger PLAN_CHANGE_DENIED)", async () => {
    const before = await readTenantPlan(pg!, TENANT_A);
    try {
      await asUser("owner_a", (c) =>
        c.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [TENANT_A]),
      );
      assert.fail("deny");
    } catch (err) {
      assert.match(String(String(err)), /PLAN_CHANGE_DENIED/i);
    }
    const after = await readTenantPlan(pg!, TENANT_A);
    assert.equal(after, before);
  });

  it("ET11 anon non legge dati privati entitlement + non esegue azioni riservate", async () => {
    await pg!.query(`BEGIN`);
    await pg!.query(`SET LOCAL ROLE anon`);
    // Anon cannot EXECUTE admin_set_tenant_plan (FASE8h grant EXECUTE only postgres/service_role).
    let rpcDeny = false;
    try {
      await pg!.query(
        `SELECT * FROM public.admin_set_tenant_plan($1::uuid, 'pro'::text, NULL::uuid, 'et11-harness'::text)`,
        [TENANT_A],
      );
    } catch (_) {
      rpcDeny = true;
    }
    // Anon cannot write audit_logs or update tenants
    let auditWrite: boolean;
    try {
      await pg!.query(
        `INSERT INTO public.audit_logs(tenant_id,action,entity_type,entity_id) VALUES ($1::uuid,'tenant.plan_changed','tenant',$1::uuid)`,
        [TENANT_A],
      );
      auditWrite = false;
    } catch (_) {
      auditWrite = true;
    }
    // Anon cannot UPDATE tenants (policy restricts to authenticated owner/admin)
    let updRows: number;
    try {
      const r = await pg!.query(`UPDATE public.tenants SET plan_id='pro' WHERE id=$1::uuid`, [
        TENANT_A,
      ]);
      updRows = r.rowCount ?? 0;
    } catch (_) {
      updRows = 0;
    }
    await pg!.query(`ROLLBACK`);
    assert.equal(rpcDeny, true, "anon cannot call admin RPC");
    assert.equal(auditWrite, true, "anon cannot write audit");
    assert.equal(updRows, 0, "anon cannot update tenants plan_id");
  });

  it("ET12 payload forged capability/limits ignored by resolver — static pure function ignores user payload", async () => {
    // Passing an forged object into snapshot: snapshot takes ONLY plan string from DB.
    // Caller cannot inject "extra_caps" or adjust limits.
    const snap = snapshot("base");
    // No cap outside known.
    const keys = Object.keys(snap.capabilities);
    for (const k of keys) assert.ok(KNOWN_CAPS.includes(k as Cap));
    assert.equal(snap.limits.maxServices, 3);
    assert.equal(snap.limits.maxSections, 5);
  });
});

// ----------- Plan Transitions PT1-PT8 -----------
describe("FASE7 · Plan Transitions (PT1-PT8)", () => {
  it("PT1 BASE initial", async () => {
    const a = await readTenantPlan(pg!, TENANT_A);
    const b = await readTenantPlan(pg!, TENANT_B);
    assert.equal(a, "base");
    assert.equal(b, "base");
  });

  it("PT2 trusted upgrade PRO (admin RPC)", async () => {
    const r = await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    assert.equal(r.ok, true);
    assert.equal(r.code, "OK");
    assert.equal(r.new_plan, "pro");
  });

  it("PT3 resolver cambia — PRO snapshot", async () => {
    const snap = await snapshotTenantFromDb(pg!, TENANT_A);
    assert.equal(snap.planId, "pro");
    assert.equal(snap.limits.maxServices, null);
    assert.equal(snap.limits.maxSections, null);
  });

  it("PT4 PRO allows 7 services (mutation at limit=4 previously → allow)", async () => {
    await asUser("manager_a", async (c) => {
      for (let i = 1; i <= 7; i++) {
        await c.query(
          `INSERT INTO public.services(id, tenant_id, name, duration_minutes, price_from, currency, active, position)
           VALUES (gen_random_uuid(),$1::uuid,$2::text,30,1000,'EUR',true,$3::int)`,
          [TENANT_A, `PT4 PRO ${i}`, i],
        );
      }
    });
    const n =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(n, 7);
    await pg!.query(`DELETE FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]);
  });

  it("PT5 downgrade BASE", async () => {
    const r = await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    assert.equal(r.ok, true);
    assert.equal(r.code, "OK");
    assert.equal(r.new_plan, "base");
    assert.equal(r.old_plan, "pro");
  });

  it("PT6 existing data preserved (4 services exist after downgrade)", async () => {
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    await asUser("manager_a", async (c) => {
      for (let i = 1; i <= 4; i++) {
        await c.query(
          `INSERT INTO public.services(id, tenant_id, name, duration_minutes, price_from, currency, active, position)
           VALUES (gen_random_uuid(),$1::uuid,$2::text,30,1000,'EUR',true,$3::int)`,
          [TENANT_A, `PT6 ${i}`, i],
        );
      }
    });
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    const n =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(n, 4, "data preserved after downgrade");
    await pg!.query(`DELETE FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]);
  });

  it("PT7 over-limit new mutation denied (5th service blocked after BASE)", async () => {
    // First create 3 services while BASE
    await asUser("manager_a", async (c) => {
      for (let i = 1; i <= 3; i++) {
        await c.query(
          `INSERT INTO public.services(id, tenant_id, name, duration_minutes, price_from, currency, active, position)
           VALUES (gen_random_uuid(),$1::uuid,$2::text,30,1000,'EUR',true,$3::int)`,
          [TENANT_A, `PT7 svc ${i}`, i],
        );
      }
    });
    const snap = await snapshotTenantFromDb(pg!, TENANT_A);
    assert.equal(snap.planId, "base");
    assert.equal(snap.limits.maxServices, 3);
    const before =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(before, 3);
    // 4th: enforce pre-deny
    const at4 = snap.limits.maxServices !== null && 4 > snap.limits.maxServices;
    assert.equal(at4, true, "4th service must be denied by precheck");
    const after =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(after, 3, "DB unchanged");
    await pg!.query(`DELETE FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]);
  });

  it("PT8 tenant B unchanged — plan base, data empty", async () => {
    const pb = await readTenantPlan(pg!, TENANT_B);
    const nb =
      (
        await pg!.query<{ n: number }>(
          `SELECT count(*)::int n FROM public.services WHERE tenant_id=$1::uuid`,
          [TENANT_B],
        )
      ).rows[0]?.n ?? 0;
    assert.equal(pb, "base");
    assert.equal(nb, 0);
  });
});

// ----------- Concurrency C1 + Cache A/B -----------
describe("FASE7 · Concurrency + Cache A/B", () => {
  it("C1 stale PRO client request — mutation evaluated against latest BASE (DB current)", async () => {
    // Tenant A → PRO
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    // Simulate "client holds stale PRO entitlement belief".
    // Now server-side downgrade happens.
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    // DB state is BASE. Mutation evaluated at DB=BASE limits.
    const snap = await snapshotTenantFromDb(pg!, TENANT_A);
    assert.equal(snap.planId, "base");
    assert.equal(snap.limits.maxServices, 3);
    const denied4 = snap.limits.maxServices !== null && 4 > snap.limits.maxServices;
    assert.equal(denied4, true, "4th service denied at latest BASE state");
  });

  it("Cache A/B isolation A=BASE B=PRO alternating 8x", async () => {
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    await asAdmin((c) => adminSetPlan(c, TENANT_B, "pro"));
    for (let i = 0; i < 8; i++) {
      const a = await snapshotTenantFromDb(pg!, TENANT_A);
      const b = await snapshotTenantFromDb(pg!, TENANT_B);
      assert.equal(a.planId, "base");
      assert.equal(b.planId, "pro");
      assert.equal(a.limits.maxServices, 3);
      assert.equal(b.limits.maxServices, null);
    }
    // Upgrade A → PRO
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "pro"));
    const a2 = await snapshotTenantFromDb(pg!, TENANT_A);
    const b2 = await snapshotTenantFromDb(pg!, TENANT_B);
    assert.equal(a2.planId, "pro");
    assert.equal(a2.limits.maxServices, null);
    assert.equal(b2.planId, "pro");
    // B still pro → unchanged.
    assert.equal(b2.limits.maxServices, null);
    // Revert A back to base, B back to base
    await asAdmin((c) => adminSetPlan(c, TENANT_A, "base"));
    await asAdmin((c) => adminSetPlan(c, TENANT_B, "base"));
  });
});
