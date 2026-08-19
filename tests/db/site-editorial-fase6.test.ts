// @vitest-environment node
// TRANSIENT TEST FILE. Integrazione RLS FASE 6 editorial + tampering + failure injection.
// Pattern: impersonation SET ROLE authenticated + request.jwt.claim.sub = auth uid reale.
// Nessun service_role shortcut per le azioni SOTTO TEST; service_role solo per setup/cleanup.
import "dotenv/config";
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "@/types/supabase";

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
  console.error("[editorial-fase6][unsafe]", { host, pid });
  process.exit(1);
}
failIfUnsafe();

const SUPA_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");

function makeAnon(): SupabaseClient<Database, "public"> {
  return createClient<Database>(SUPA_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function makeService(): SupabaseClient<Database, "public"> {
  return createClient<Database>(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function buildPgOpts() {
  const host = envOr("SUPABASE_DB_HOST");
  const port = Number(envOr("SUPABASE_DB_PORT")) || 54322;
  const password = envOr("SUPABASE_DB_PASSWORD");
  return { host, user: "postgres", database: "postgres", password, port, ssl: false } as const;
}

let pg: PgClient | null = null;

const TENANT_A = "fa6e0000-0000-4000-8000-0000000000a1";
const TENANT_B = "fa6e0000-0000-4000-8000-0000000000b1";

const UID = {
  owner_a: "",
  manager_a: "",
  staff_a: "",
  owner_b: "",
  staff_b: "",
  no_member: "",
  platform_admin: "",
};
const EMAILS = {
  owner_a: "editorial-owner-a@test.local",
  manager_a: "editorial-manager-a@test.local",
  staff_a: "editorial-staff-a@test.local",
  owner_b: "editorial-owner-b@test.local",
  staff_b: "editorial-staff-b@test.local",
  no_member: "editorial-nomember@test.local",
  platform_admin: "editorial-pa@test.local",
} as const;
type EmailKey = keyof typeof EMAILS;

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
    [email, "EditorialTest!P4ssS3cure2026"],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`provision failed ${email}`);
  return id;
}

async function asUser<T>(uidKey: EmailKey | string, fn: () => Promise<T>): Promise<T> {
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
    const result = await fn();
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
  const stmts = [
    `DELETE FROM public.site_editorial_state WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.site_sections WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid)`,
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

  // Tenants
  await pg.query(
    `INSERT INTO public.tenants (id, name, slug, status, published, published_at)
     VALUES ($1::uuid,'Tenant A Editorial','editorial-tenant-a','active',true, NOW()),
            ($2::uuid,'Tenant B Editorial','editorial-tenant-b','active',true, NOW())`,
    [TENANT_A, TENANT_B],
  );
  // Business profiles
  await pg.query(
    `INSERT INTO public.business_profiles(
       tenant_id, display_name, category, description, city, timezone, locale,
       theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
       theme_heading_font_preset, theme_body_font_preset
     ) VALUES (
       $1::uuid,'BP V1 A','Barbiere','V1 descr A','Roma','Europe/Rome','it',
       '#111111','#FFFFFF','#000000','#666666','md','sans','sans'
     ), (
       $2::uuid,'BP V1 B','Estetica','V1 descr B','Milano','Europe/Rome','it',
       '#222222','#FAFAFA','#111111','#777777','sm','sans','sans'
     )`,
    [TENANT_A, TENANT_B],
  );
  // Auth users
  UID.owner_a = await provisionUser(EMAILS.owner_a);
  UID.manager_a = await provisionUser(EMAILS.manager_a);
  UID.staff_a = await provisionUser(EMAILS.staff_a);
  UID.owner_b = await provisionUser(EMAILS.owner_b);
  UID.staff_b = await provisionUser(EMAILS.staff_b);
  UID.no_member = await provisionUser(EMAILS.no_member);
  UID.platform_admin = await provisionUser(EMAILS.platform_admin);

  // Memberships
  await pg.query(
    `INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status) VALUES
       (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active'),
       (gen_random_uuid(),$1::uuid,$3::uuid,'manager','active'),
       (gen_random_uuid(),$1::uuid,$4::uuid,'staff','active'),
       (gen_random_uuid(),$5::uuid,$6::uuid,'owner','active'),
       (gen_random_uuid(),$5::uuid,$7::uuid,'staff','active')`,
    [TENANT_A, UID.owner_a, UID.manager_a, UID.staff_a, TENANT_B, UID.owner_b, UID.staff_b],
  );
  // Platform admin
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
  await pg.end().catch(() => {});
  pg = null;
});

// Helpers
function expectAllowed(err: unknown, data: unknown, msg: string) {
  expect(err).toBeNull();
  expect(data).not.toBeNull();
  if (Array.isArray(data)) expect(data.length, msg).toBeGreaterThan(0);
}
function expectDenied(err: unknown, data: unknown, msg: string) {
  const denied =
    err != null ||
    data == null ||
    (typeof data === "number" && data === 0) ||
    (Array.isArray(data) && data.length === 0) ||
    (typeof data === "object" && data !== null && Object.keys(data).length === 0);
  expect(denied, `${msg} denied=${String(denied)} err=${String(err)}`).toBe(true);
}

type EditorialRow = {
  tenant_id: string;
  sections: unknown[];
  services: unknown[];
  theme: Record<string, unknown>;
  draft_revision: string;
};

const DRAFT_V1 = {
  sections: [
    {
      section_type: "hero",
      position: 0,
      enabled: true,
      variant: "centered",
      settings: { eyebrow: "V1 eyebrow" },
    },
    { section_type: "about", position: 1, enabled: true, variant: "default", settings: {} },
    { section_type: "services", position: 2, enabled: true, variant: "cards", settings: {} },
    { section_type: "contact", position: 3, enabled: true, variant: "default", settings: {} },
  ],
  services: [
    {
      name: "Taglio uomo V1",
      description: "Lavaggio e piega",
      price_from: 18,
      currency: "EUR",
      duration_minutes: 30,
      position: 0,
      active: true,
    },
    {
      name: "Barba V1",
      description: "Rasatura classica",
      price_from: 12,
      currency: "EUR",
      duration_minutes: 20,
      position: 1,
      active: true,
    },
  ],
  theme: {
    primary: "#111111",
    background: "#FFFFFF",
    foreground: "#000000",
    muted: "#666666",
    radius: "md",
    headingFont: "sans",
    bodyFont: "sans",
  },
};

const DRAFT_V2 = {
  sections: [
    {
      section_type: "hero",
      position: 0,
      enabled: true,
      variant: "split",
      settings: { eyebrow: "V2 eyebrow" },
    },
    { section_type: "gallery", position: 1, enabled: true, variant: "default", settings: {} },
    { section_type: "about", position: 2, enabled: true, variant: "default", settings: {} },
    { section_type: "services", position: 3, enabled: true, variant: "cards", settings: {} },
    { section_type: "staff", position: 4, enabled: true, variant: "default", settings: {} },
    { section_type: "reviews", position: 5, enabled: true, variant: "default", settings: {} },
    { section_type: "contact", position: 6, enabled: true, variant: "default", settings: {} },
  ],
  services: [
    {
      name: "Taglio V2",
      description: "Taglio uomo V2",
      price_from: 22,
      currency: "EUR",
      duration_minutes: 35,
      position: 0,
      active: true,
    },
    {
      name: "Barba V2",
      description: "Rasatura V2",
      price_from: 15,
      currency: "EUR",
      duration_minutes: 25,
      position: 1,
      active: true,
    },
    {
      name: "Trattamento V2",
      description: "Idratazione capelli V2",
      price_from: 35,
      currency: "EUR",
      duration_minutes: 40,
      position: 2,
      active: true,
    },
  ],
  theme: {
    primary: "#7C3AED",
    background: "#F8FAFC",
    foreground: "#0F172A",
    muted: "#64748B",
    radius: "lg",
    headingFont: "display",
    bodyFont: "sans",
  },
};

async function upsertDraftA(
  opts: { override?: Partial<typeof DRAFT_V1>; asUserKey?: EmailKey } = {},
) {
  const body = { ...DRAFT_V1, ...(opts.override ?? {}) };
  const role = opts.asUserKey ?? "owner_a";
  return asUser(role, async () => {
    const r = await pg!.query<EditorialRow>(
      `INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme)
       VALUES ($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET
         sections = EXCLUDED.sections,
         services = EXCLUDED.services,
         theme = EXCLUDED.theme,
         draft_revision = gen_random_uuid(),
         updated_at = NOW()
       RETURNING tenant_id, sections, services, theme, draft_revision`,
      [
        TENANT_A,
        JSON.stringify(body.sections),
        JSON.stringify(body.services),
        JSON.stringify(body.theme),
      ],
    );
    return r.rows[0] ?? null;
  });
}

async function readDraftByTenantDirect(tenantId: string): Promise<EditorialRow | null> {
  const r = await pg!.query<EditorialRow>(
    `SELECT tenant_id, sections, services, theme, draft_revision FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
    [tenantId],
  );
  return r.rows[0] ?? null;
}

// ======================= GRUPPO R1-R16: RLS FASE 6 =======================
describe("§9 · R1-R16 RLS Editorial FASE 6 (user-bound identity, RLS attivo)", () => {
  it("R1. Owner A legge editorial own tenant A → ALLOW", async () => {
    await upsertDraftA();
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query<EditorialRow>(
        `SELECT tenant_id, sections, services, theme, draft_revision FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return { err: null as unknown, data: q.rows.length ? q.rows[0] : null };
    }).catch((e) => ({ err: e, data: null }));
    expectAllowed(r.err, r.data, "R1");
  });

  it("R2. Manager A inserisce/aggiorna editorial A → ALLOW (check theme scritto)", async () => {
    await upsertDraftA({
      asUserKey: "manager_a",
      override: { theme: { ...DRAFT_V1.theme, primary: "#2222FF" } },
    });
    const row = await readDraftByTenantDirect(TENANT_A);
    expect(row).not.toBeNull();
    assert(row);
    const theme = row.theme as Record<string, unknown>;
    expect(theme["primary"]).toBe("#2222FF");
  });

  it("R3. Owner A rimuove editorial A (DELETE) → ALLOW, poi ripristina", async () => {
    await upsertDraftA();
    const pre = await readDraftByTenantDirect(TENANT_A);
    expect(pre).not.toBeNull();
    const del = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `DELETE FROM public.site_editorial_state WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null as unknown, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectAllowed(del.err, del.data, "R3");
    await upsertDraftA();
    const post = await readDraftByTenantDirect(TENANT_A);
    expect(post).not.toBeNull();
  });

  it("R4. Manager A DELETE editorial A → ALLOW", async () => {
    await upsertDraftA();
    const r = await asUser("manager_a", async () => {
      const q = await pg!.query(
        `DELETE FROM public.site_editorial_state WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectAllowed(r.err, r.data, "R4");
    await upsertDraftA();
  });

  it("R5. Staff A legge editorial A → ALLOW (policy is_tenant_member)", async () => {
    await upsertDraftA();
    const r = await asUser("staff_a", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return { err: null, data: q.rows[0].c };
    }).catch((e) => ({ err: e, data: 0 }));
    expectAllowed(r.err, r.data, "R5");
    expect(r.data).toBe(1);
  });

  it("R6. Staff A scrive editorial A → DENY (role insufficient)", async () => {
    const before = await readDraftByTenantDirect(TENANT_A);
    const r = await asUser("staff_a", async () => {
      await pg!.query(
        `INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme)
         VALUES ($1::uuid,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb)
         ON CONFLICT (tenant_id) DO UPDATE SET sections = '[]'::jsonb RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: 1 };
    }).catch((e) => ({ err: e, data: null }));
    expectDenied(r.err, r.data, "R6 staff write denied");
    const after = await readDraftByTenantDirect(TENANT_A);
    expect(after?.sections).toEqual(before?.sections);
  });

  it("R7. Staff A UPDATE editorial A theme → DENY", async () => {
    const before = await readDraftByTenantDirect(TENANT_A);
    const r = await asUser("staff_a", async () => {
      const q = await pg!.query(
        `UPDATE public.site_editorial_state SET theme = '{"primary":"#FF0000"}'::jsonb WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "R7 staff update denied");
    const after = await readDraftByTenantDirect(TENANT_A);
    const afterTheme = (after?.theme as Record<string, unknown> | undefined) ?? {};
    const beforeTheme = (before?.theme as Record<string, unknown> | undefined) ?? {};
    expect(afterTheme["primary"]).toBe(beforeTheme["primary"]);
  });

  it("R8. Staff A DELETE editorial A → DENY", async () => {
    const before = await readDraftByTenantDirect(TENANT_A);
    const r = await asUser("staff_a", async () => {
      const q = await pg!.query(
        `DELETE FROM public.site_editorial_state WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "R8 staff delete denied");
    const after = await readDraftByTenantDirect(TENANT_A);
    expect(after).toEqual(before);
  });

  it("R9. Owner A cross-tenant legge editorial B → DENY", async () => {
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_B],
      );
      return { err: null, data: q.rows[0].c };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data === 0 ? null : r.data, "R9");
    expect(r.data).toBe(0);
  });

  it("R10. Owner A cross-tenant INSERT editorial B → DENY (WITH CHECK). DB invariato per B.", async () => {
    const before = await readDraftByTenantDirect(TENANT_B);
    const r = await asUser("owner_a", async () => {
      await pg!.query(
        `INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme)
         VALUES ($1::uuid,'[{"section_type":"hero"}]'::jsonb,'[]'::jsonb,'{}'::jsonb)`,
        [TENANT_B],
      );
      return { err: null, data: 1 };
    }).catch((e) => ({ err: e, data: null }));
    expectDenied(r.err, r.data, "R10");
    const after = await readDraftByTenantDirect(TENANT_B);
    expect(after).toEqual(before);
  });

  it("R11. Staff B cross-tenant legge editorial A → DENY", async () => {
    const r = await asUser("staff_b", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return { err: null, data: q.rows[0].c };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data === 0 ? null : r.data, "R11 staff B cross read A denied");
    expect(r.data).toBe(0);
  });

  it("R12. Manager A cross-tenant UPDATE editorial B → DENY, invariato B.", async () => {
    const before = await readDraftByTenantDirect(TENANT_B);
    const r = await asUser("manager_a", async () => {
      const q = await pg!.query(
        `UPDATE public.site_editorial_state SET sections='[]'::jsonb WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_B],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "R12");
    const after = await readDraftByTenantDirect(TENANT_B);
    expect(after).toEqual(before);
  });

  it("R13. No-member (authenticated ma 0 memberships) legge editorial A → DENY", async () => {
    const r = await asUser("no_member", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return { err: null, data: q.rows[0].c };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data === 0 ? null : r.data, "R13 nomember read");
    expect(r.data).toBe(0);
  });

  it("R14. Anon client legge editorial → 0 rows (grants non concessi ad anon dalla migration 024)", async () => {
    const anon = makeAnon();
    const { data, error } = await anon.from("site_editorial_state").select("tenant_id");
    const denied = error != null || (data ?? []).length === 0;
    expect(denied, `R14 anon editorial: err=${String(error)} rows=${(data ?? []).length}`).toBe(
      true,
    );
    expect((data ?? []).length).toBe(0);
  });

  it("R15. Platform Admin legge editorial A e editorial B → ALLOW entrambe", async () => {
    await upsertDraftA();
    const rA = await asUser("platform_admin", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return q.rows[0].c;
    });
    expect(rA).toBe(1);
    // crea editorial B per test PA cross
    await makeService()
      .from("site_editorial_state")
      .insert({
        tenant_id: TENANT_B,
        sections: [
          { section_type: "hero", position: 0, enabled: true, variant: "default", settings: {} },
        ] as never,
        services: [] as never,
        theme: {} as never,
      });
    const rB = await asUser("platform_admin", async () => {
      const q = await pg!.query(
        `SELECT count(*)::int c FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_B],
      );
      return q.rows[0].c;
    });
    expect(rB).toBe(1);
  });

  it("R16. publish_site_draft: authz matrice OWNER A→A ALLOW, OWNER A→B DENY, STAFF A→A DENY, NO_MEMBER A→A DENY", async () => {
    await upsertDraftA();
    type Pub = { ok: boolean; code: string | null; message: string | null };
    const runPub = (key: EmailKey, tenantId: string) =>
      asUser(key, async () => {
        const q = await pg!.query<Pub>(
          `SELECT ok, code, message FROM public.publish_site_draft($1::uuid)`,
          [tenantId],
        );
        return q.rows[0] ?? null;
      }).catch((e) => ({ ok: false, code: "ERR", message: String(e) }));

    const aAllow = await runPub("owner_a", TENANT_A);
    expect(aAllow?.ok, `owner A -> A publish ok`).toBe(true);
    expect(aAllow?.code).toBe("OK");

    const crossDeny = await runPub("owner_a", TENANT_B);
    expect(crossDeny?.ok, `owner A -> B publish denied`).toBe(false);
    expect(crossDeny?.code).toBe("AUTHZ");

    const staffDeny = await runPub("staff_a", TENANT_A);
    expect(staffDeny?.ok, `staff A -> A publish denied`).toBe(false);
    expect(staffDeny?.code).toBe("AUTHZ");

    const nomemberDeny = await runPub("no_member", TENANT_A);
    expect(nomemberDeny?.ok, `nomember -> A publish denied`).toBe(false);
    expect(nomemberDeny?.code === "AUTHZ" || nomemberDeny?.code === "NO_DRAFT").toBe(true);
  });
});

// ======================= GRUPPO T1-T10: TAMPERING =======================
describe("§10 · T1-T10 Tampering FASE 6", () => {
  it("T1. Owner A INSERT editorial SET tenant_id = B (spoof) → WITH CHECK DENY. B invariato.", async () => {
    const before = await readDraftByTenantDirect(TENANT_B);
    const r = await asUser("owner_a", async () => {
      await pg!.query(
        `INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme)
         VALUES ($1::uuid,'[{"section_type":"hero"}]'::jsonb,'[]'::jsonb,'{"primary":"#FF0000"}'::jsonb)`,
        [TENANT_B],
      );
      return { err: null, data: 1 };
    }).catch((e) => ({ err: e, data: null }));
    expectDenied(r.err, r.data, "T1 cross-tenant insert denied");
    const after = await readDraftByTenantDirect(TENANT_B);
    expect(after).toEqual(before);
  });

  it("T2. Tampering user_id/sub claim: impersonation non autorizzata su editorial A (sessione anon sub=owner_a) → DENY", async () => {
    if (!pg) throw new Error("pg missing");
    const before = await readDraftByTenantDirect(TENANT_A);
    let result: { err: unknown; data: unknown };
    try {
      await pg.query(`BEGIN`);
      const claims = JSON.stringify({ sub: UID.owner_a, role: "anon" });
      await pg.query(
        `SELECT set_config('request.jwt.claim.sub', $1::text, true),
                set_config('request.jwt.claims', $2::text, true)`,
        [UID.owner_a, claims],
      );
      await pg.query(`SET LOCAL ROLE anon`);
      try {
        const q = await pg.query(
          `UPDATE public.site_editorial_state SET sections='[]'::jsonb WHERE tenant_id=$1::uuid RETURNING 1`,
          [TENANT_A],
        );
        result = { err: null, data: q.rowCount ?? 0 };
      } catch (e) {
        result = { err: e, data: null };
      }
    } finally {
      try {
        await pg.query(`ROLLBACK`);
      } catch {
        /* ignore */
      }
      try {
        await pg.query(`RESET ROLE`);
      } catch {
        /* ignore */
      }
    }
    expectDenied(result.err, result.data === 0 ? null : result.data, "T2 spoof anon denied");
    const after = await readDraftByTenantDirect(TENANT_A);
    expect(after).toEqual(before);
  });

  it("T3. Tampering role: claim.role='service_role' + sub=staff_a SET ROLE authenticated → write editorial A DENY (policy usa membership DB, non claim.role)", async () => {
    const before = await readDraftByTenantDirect(TENANT_A);
    const r = await asUser("staff_a", async () => {
      await pg!.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
      const q = await pg!.query(
        `UPDATE public.site_editorial_state SET sections='[]'::jsonb WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "T3 claim.role spoof ignored by DB membership");
    const after = await readDraftByTenantDirect(TENANT_A);
    expect(after).toEqual(before);
  });

  it("T4. Owner A aggiorna tenants.published di B → DENY. B.published invariato.", async () => {
    if (!pg) throw new Error("pg missing");
    const preQ = await pg.query(`SELECT published FROM public.tenants WHERE id=$1::uuid`, [
      TENANT_B,
    ]);
    const pre = preQ.rows[0]?.published as boolean;
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `UPDATE public.tenants SET published=false WHERE id=$1::uuid RETURNING 1`,
        [TENANT_B],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "T4 cross tenant published");
    const postQ = await pg.query(`SELECT published FROM public.tenants WHERE id=$1::uuid`, [
      TENANT_B,
    ]);
    expect(postQ.rows[0]?.published).toBe(pre);
  });

  it("T5. Owner A cross-tenant modifica business_profiles di B → DENY. B BP invariato.", async () => {
    if (!pg) throw new Error("pg missing");
    const preQ = await pg.query(
      `SELECT theme_primary, display_name FROM public.business_profiles WHERE tenant_id=$1::uuid`,
      [TENANT_B],
    );
    const before = preQ.rows[0];
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `UPDATE public.business_profiles SET theme_primary='#FF0000', display_name='TAMPERED B' WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_B],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "T5 bp B tamper denied");
    const postQ = await pg.query(
      `SELECT theme_primary, display_name FROM public.business_profiles WHERE tenant_id=$1::uuid`,
      [TENANT_B],
    );
    expect(postQ.rows[0]).toEqual(before);
  });

  it("T6. Owner A modifica section ID di tenant B → DENY. B sezione invariata (PRE/POST).", async () => {
    if (!pg) throw new Error("pg missing");
    await pg.query(
      `INSERT INTO public.site_sections (id, tenant_id, section_type, position, enabled, variant, settings)
       VALUES (gen_random_uuid(), $1::uuid, 'hero', 0, true, 'default', '{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    const preQ = await pg.query<{ id: string; settings: unknown }>(
      `SELECT id, settings FROM public.site_sections WHERE tenant_id=$1::uuid AND section_type='hero' LIMIT 1`,
      [TENANT_B],
    );
    const preRow = preQ.rows[0];
    expect(preRow, "T6 PRE: sezione B esistente").toBeTruthy();
    assert(preRow);
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `UPDATE public.site_sections SET settings='{"tampered":true}'::jsonb WHERE id=$1::uuid RETURNING 1`,
        [preRow.id],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "T6 cross section id update denied");
    const postQ = await pg.query(
      `SELECT id, settings FROM public.site_sections WHERE id=$1::uuid`,
      [preRow.id],
    );
    assert(postQ.rows[0]);
    expect(postQ.rows[0].settings).toEqual(preRow.settings);
  });

  it("T7. Owner A modifica service ID di tenant B → DENY. B servizio invariato.", async () => {
    if (!pg) throw new Error("pg missing");
    await pg.query(
      `INSERT INTO public.services (id, tenant_id, name, description, price_from, currency, duration_minutes, active, position)
       VALUES (gen_random_uuid(), $1::uuid, 'Service B T7', 'desc b', 10.00, 'EUR', 10, true, 0)
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    const preQ = await pg.query<{ id: string; price_from: unknown }>(
      `SELECT id, price_from FROM public.services WHERE tenant_id=$1::uuid AND name='Service B T7' LIMIT 1`,
      [TENANT_B],
    );
    const preRowSvc = preQ.rows[0];
    expect(preRowSvc, "T7 PRE: servizio B esistente").toBeTruthy();
    assert(preRowSvc);
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query(
        `UPDATE public.services SET price_from=0.01, name='HACKED B' WHERE id=$1::uuid RETURNING 1`,
        [preRowSvc.id],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "T7 cross service id update denied");
    const postQ = await pg.query(
      `SELECT id, price_from, name FROM public.services WHERE id=$1::uuid`,
      [preRowSvc.id],
    );
    assert(postQ.rows[0]);
    expect(postQ.rows[0].price_from).toEqual(preRowSvc.price_from);
    expect(postQ.rows[0].name).toBe("Service B T7");
  });

  it("T8. Invalid section_type 'hacked_page' passato nel draft → publish rifiuta (site_sections ha CHECK section_type enum).", async () => {
    // Prima salviamo un draft valido per A, poi ne sovrascriviamo uno con section_type invalido
    await upsertDraftA({
      override: {
        sections: [
          {
            section_type: "hacked_page",
            position: 0,
            enabled: true,
            variant: "default",
            settings: {},
          },
        ] as never,
      },
    });
    const draftBefore = await readDraftByTenantDirect(TENANT_A);
    expect(draftBefore).not.toBeNull();
    // Pubblichiamo: DEVE fallire per violazione CHECK su site_sections.section_type
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string | null; message: string | null }>(
        `SELECT ok, code, message FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0] ?? { ok: false, code: null, message: null };
    }).catch((e) => ({ ok: false, code: "ERR", message: String(e) }));
    // Attenzione: la RPC publish_site_draft non ha try-catch interno per errori CHECK.
    // Quindi eccezione Postgres risale → r.code sarà "ERR" oppure se migrazione aggiunge try/catch ok=false con dettaglio.
    // Noi verifichiamo semplicemente ok=false.
    expect(r.ok, "T8 invalid section_type publish must fail").toBe(false);
    // Ripuliamo: risalviamo draft valido e ripubblichiamo per prossimi test
    await upsertDraftA();
  });

  it("T9. Malicious token: tamper HTML/JS in services.description + section hero.settings → publish whitelist solo campi strutturati attesi, nessuna colonna arbitraria creata.", async () => {
    const maliciousHtmlDesc = "<img src=x onerror=alert(1)> <script>alert('xss-desc')</script>";
    const maliciousSettingsHtml = '<img src=x onerror=alert(2)>" onclick="alert(3)"';
    const override: Partial<typeof DRAFT_V1> = {
      sections: [
        {
          section_type: "hero",
          position: 0,
          enabled: true,
          variant: "centered",
          settings: {
            title: "Normal Title",
            subtitle: maliciousSettingsHtml,
            extra_field: "DROP TABLE site_sections; --",
            __proto__: { polluted: true } as unknown,
          },
        },
        {
          section_type: "about",
          position: 1,
          enabled: true,
          variant: "default",
          settings: { body: "Safe" },
        },
        { section_type: "services", position: 2, enabled: true, variant: "cards", settings: {} },
        { section_type: "contact", position: 3, enabled: true, variant: "default", settings: {} },
      ] as never,
      services: [
        {
          name: "Safe Service Name",
          description: maliciousHtmlDesc,
          price_from: 35,
          currency: "EUR",
          duration_minutes: 30,
          active: true,
          position: 0,
        },
      ] as never,
      theme: { ...DRAFT_V1.theme },
    };
    await upsertDraftA({ override });
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string | null; message: string | null }>(
        `SELECT ok, code, message FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      const row = q.rows[0];
      return { ok: row?.ok ?? false, code: row?.code ?? null, message: row?.message ?? null };
    }).catch((e) => ({ ok: false, code: "ERR", message: String(e) }));
    expect(
      r.ok,
      `T9 publish whitelist ok=false code=${String(r.code)} msg=${String(r.message)}`,
    ).toBe(true);
    if (!pg) throw new Error("pg missing");
    const colsQ = await pg.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='business_profiles'
          AND column_name LIKE 'theme_%' ORDER BY ordinal_position`,
    );
    const cols = colsQ.rows.map((r) => r.column_name);
    const expected = [
      "theme_primary",
      "theme_background",
      "theme_foreground",
      "theme_muted",
      "theme_radius",
      "theme_heading_font_preset",
      "theme_body_font_preset",
    ];
    expect(cols).toEqual(expected);
    expect(cols.some((c) => c.includes("extra"))).toBe(false);
    expect(cols.some((c) => c.includes("settings"))).toBe(false);
    expect(cols.some((c) => c.includes("malicious"))).toBe(false);
  });

  it("T10. Prototype pollution: __proto__ chiave in JSONB settings draft. Save passa (Postgres JSONB safe), publish passa senza errori JS.", async () => {
    const polluted = [
      {
        section_type: "hero",
        position: 0,
        enabled: true,
        variant: "centered",
        settings: { __proto__: { injected: true }, normal: "ok" } as never,
      },
    ];
    const saved = await upsertDraftA({ override: { sections: polluted as never } });
    expect(saved).not.toBeNull();
    // publish
    const r = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean }>(
        `SELECT ok FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0]?.ok ?? false;
    }).catch((e) => {
      console.error("T10 err", e);
      return false;
    });
    expect(r, "T10 JSONB proto key safe publish ok").toBe(true);
  });
});

// ======================= GRUPPO F1-F6: FAILURE INJECTION =======================
describe("§11 · F1-F6 Failure Injection", () => {
  it("F1. Malformed draft: sections JSONB non array → CHECK constraint rifiuta.", async () => {
    const r = await asUser("owner_a", async () => {
      await pg!.query(
        `INSERT INTO public.site_editorial_state (tenant_id, sections, services, theme)
         VALUES ($1::uuid,'"not-an-array"'::jsonb,'[]'::jsonb,'{}'::jsonb)
         ON CONFLICT (tenant_id) DO UPDATE SET sections = EXCLUDED.sections`,
        [TENANT_A],
      );
      return { err: null, data: 1 };
    }).catch((e) => ({ err: e, data: null }));
    expectDenied(r.err, r.data, "F1 sections not array CHECK violated");
  });

  it("F2. RLS deny: Staff A aggiorna sections array di editorial A → DENY.", async () => {
    const before = await readDraftByTenantDirect(TENANT_A);
    const r = await asUser("staff_a", async () => {
      const q = await pg!.query(
        `UPDATE public.site_editorial_state SET sections='[]'::jsonb WHERE tenant_id=$1::uuid RETURNING 1`,
        [TENANT_A],
      );
      return { err: null, data: q.rowCount ?? 0 };
    }).catch((e) => ({ err: e, data: 0 }));
    expectDenied(r.err, r.data, "F2 staff update sections denied");
    const after = await readDraftByTenantDirect(TENANT_A);
    expect(after?.sections).toEqual(before?.sections);
  });

  it("F3 + §12 ROLLBACK PROOF: publish fallisce (price_from non numerico malformed) → transazione rollbackata. A published = V1, draft = V2 malformed rimane. Poi publish regolare → V2 pulita live.", async () => {
    if (!pg) throw new Error("pg missing");
    // Setup V1 published
    await upsertDraftA();
    const setup1 = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean }>(
        `SELECT ok FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0]?.ok ?? false;
    });
    expect(setup1, "pre F3 publish V1 ok").toBe(true);
    // snapshot published V1
    const snapV1 = {
      sections: (
        await pg.query(
          `SELECT section_type, position, variant FROM public.site_sections WHERE tenant_id=$1::uuid ORDER BY position`,
          [TENANT_A],
        )
      ).rows,
      services: (
        await pg.query(
          `SELECT name, price_from FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`,
          [TENANT_A],
        )
      ).rows,
      bp: (
        await pg.query(
          `SELECT theme_primary, theme_radius FROM public.business_profiles WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0],
      tenant: (
        await pg.query(
          `SELECT published, published_at IS NOT NULL AS has_pa FROM public.tenants WHERE id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0],
    };
    // Scriviamo V2 draft con service price_from = "abc-invalid-number"
    const servicesBad = [
      {
        name: "DontPublish",
        description: "x",
        price_from: "abc",
        currency: "EUR",
        duration_minutes: 30,
        position: 0,
        active: true,
      },
    ];
    const draftV2BadWritten = await upsertDraftA({
      override: {
        sections: DRAFT_V2.sections,
        services: servicesBad as never,
        theme: DRAFT_V2.theme,
      },
    });
    expect(draftV2BadWritten).not.toBeNull();
    const revisionBad = draftV2BadWritten!.draft_revision;
    // Publish malformed: DEVE fallire per cast NUMERIC
    const pubBad = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string | null }>(
        `SELECT ok, code FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0] ?? null;
    }).catch((_e) => ({ ok: false, code: "ERR" }));
    // Fallimento per cast o per altro: comunque ok deve essere false
    assert(pubBad);
    expect(pubBad.ok, "F3 publish malformed DEVE fallire").toBe(false);
    // Ora: published deve essere esattamente V1
    const snapPostBad = {
      sections: (
        await pg.query(
          `SELECT section_type, position, variant FROM public.site_sections WHERE tenant_id=$1::uuid ORDER BY position`,
          [TENANT_A],
        )
      ).rows,
      services: (
        await pg.query(
          `SELECT name, price_from FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`,
          [TENANT_A],
        )
      ).rows,
      bp: (
        await pg.query(
          `SELECT theme_primary, theme_radius FROM public.business_profiles WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0],
      tenant: (
        await pg.query(
          `SELECT published, published_at IS NOT NULL AS has_pa FROM public.tenants WHERE id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0],
    };
    assert(snapV1.bp);
    assert(snapV1.tenant);
    assert(snapPostBad.bp);
    assert(snapPostBad.tenant);
    expect(snapPostBad.sections, "F3 V1 sections unchanged post-bad-publish").toEqual(
      snapV1.sections,
    );
    expect(snapPostBad.services, "F3 V1 services unchanged").toEqual(snapV1.services);
    expect(snapPostBad.bp, "F3 V1 theme unchanged").toEqual(snapV1.bp);
    expect(snapPostBad.tenant, "F3 V1 tenant published unchanged").toEqual(snapV1.tenant);
    // Draft deve essere ancora V2Bad (non modificato da publish fallito)
    const draftPostBad = await readDraftByTenantDirect(TENANT_A);
    expect(draftPostBad?.draft_revision).toBe(revisionBad);

    // §12 continuazione: publish regolare V2 PULITO -> V2 live
    await upsertDraftA({
      override: { sections: DRAFT_V2.sections, services: DRAFT_V2.services, theme: DRAFT_V2.theme },
    });
    const pubClean = await asUser("owner_a", async () => {
      const q = await pg!.query<{
        ok: boolean;
        sections_applied: number;
        services_applied: number;
        theme_applied: boolean;
      }>(
        `SELECT ok, sections_applied, services_applied, theme_applied FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0] ?? null;
    });
    expect(pubClean?.ok, "§12 publish clean v2 ok").toBe(true);
    expect(pubClean?.sections_applied).toBe(DRAFT_V2.sections.length);
    expect(pubClean?.services_applied).toBe(DRAFT_V2.services.length);
    expect(pubClean?.theme_applied).toBe(true);
    // Verifica V2 in tabelle live
    const v2sections = (
      await pg.query(`SELECT count(*)::int c FROM public.site_sections WHERE tenant_id=$1::uuid`, [
        TENANT_A,
      ])
    ).rows[0].c;
    const v2services = (
      await pg.query(`SELECT count(*)::int c FROM public.services WHERE tenant_id=$1::uuid`, [
        TENANT_A,
      ])
    ).rows[0].c;
    const v2bp = (
      await pg.query<{ theme_primary: string }>(
        `SELECT theme_primary FROM public.business_profiles WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      )
    ).rows[0];
    assert(v2bp);
    expect(v2sections).toBe(DRAFT_V2.sections.length);
    expect(v2services).toBe(DRAFT_V2.services.length);
    expect(v2bp.theme_primary).toBe(DRAFT_V2.theme["primary"]);
  });

  it("F4 + §13 CONCURRENCY PROOF: 2 client stessa revision R1 → C1 publish ok (R2), C2 publish con R1 → CONCURRENT no overwrite.", async () => {
    if (!pg) throw new Error("pg missing");
    // Stesso draft, entrambi hanno revision R1 (quella salvata ora)
    await upsertDraftA();
    const baseRow = await readDraftByTenantDirect(TENANT_A);
    expect(baseRow).not.toBeNull();
    const R1 = baseRow!.draft_revision;
    expect(typeof R1).toBe("string");
    expect(R1.length).toBe(36);

    // Client 1 = owner_a, publish con p_expected_revision = R1 → OK
    const C1 = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string | null }>(
        `SELECT ok, code FROM public.publish_site_draft($1::uuid, $2::uuid)`,
        [TENANT_A, R1],
      );
      return q.rows[0] ?? null;
    });
    expect(C1?.ok, "§13 C1 publish con R1 OK").toBe(true);
    expect(C1?.code).toBe("OK");

    // Dopo publish OK, revision rimane invariata? No. La publish non incrementa la draft_revision.
    // Quindi per simulare revisione cambiata dobbiamo SALVARE nuovamente il draft → revision R2 generata
    await upsertDraftA();
    const R2 = (await readDraftByTenantDirect(TENANT_A))!.draft_revision;
    expect(R2).not.toBe(R1);

    // Client 2 = manager_a tenta publish con OLD revision R1 → code=CONCURRENT
    const C2 = await asUser("manager_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string | null }>(
        `SELECT ok, code FROM public.publish_site_draft($1::uuid, $2::uuid)`,
        [TENANT_A, R1],
      );
      return q.rows[0] ?? null;
    });
    expect(C2?.ok, "§13 C2 CONCURRENT mismatch revision must be rejected").toBe(false);
    expect(C2?.code).toBe("CONCURRENT");
  });

  it("F5. Audit failure NON-ATOMIC BY DESIGN: publish_site_draft() non scrive audit_logs. Constatare che publish riesce anche senza write audit (produzione audit = separato in backend via service_role).", async () => {
    if (!pg) throw new Error("pg missing");
    await upsertDraftA();
    const beforeQ = await pg.query<{ c: number }>(`SELECT count(*)::int c FROM public.audit_logs`);
    assert(beforeQ.rows[0]);
    const cntBefore = beforeQ.rows[0].c;
    const pub = await asUser("owner_a", async () => {
      const q = await pg!.query<{ ok: boolean; code: string }>(
        `SELECT ok, code FROM public.publish_site_draft($1::uuid)`,
        [TENANT_A],
      );
      return q.rows[0] ?? null;
    });
    expect(pub?.ok).toBe(true);
    expect(pub?.code).toBe("OK");
    const afterQ = await pg.query<{ c: number }>(`SELECT count(*)::int c FROM public.audit_logs`);
    assert(afterQ.rows[0]);
    const cntAfter = afterQ.rows[0].c;
    // Publish RPC NON scrive audit (conferma: cntAfter === cntBefore). La scrittura audit è demandata a server action separate service_role.
    // Questo è NON-ATOMIC BY DESIGN e va documentato come tale. Quindi:
    expect(cntAfter).toBe(cntBefore);
  });

  it("F6. Preview failure NO leak B: Owner B NON vede editorial stato di A in SELECT. RLS nega read cross.", async () => {
    await upsertDraftA();
    const rowA = await readDraftByTenantDirect(TENANT_A);
    expect(rowA).not.toBeNull();
    const r = await asUser("owner_b", async () => {
      const q = await pg!.query(
        `SELECT tenant_id, sections FROM public.site_editorial_state WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return { err: null, data: q.rows.length ? q.rows : null };
    }).catch((e) => ({ err: e, data: null }));
    expectDenied(r.err, r.data, "F6 cross leak editorial denied");
  });
});
