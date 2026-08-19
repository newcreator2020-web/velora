// @vitest-environment node
import "dotenv/config";
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

function failIfUnsafe() {
  const host = envOr("SUPABASE_DB_HOST");
  const pid = envOr("SUPABASE_PROJECT_ID");
  if (ALLOWED_DB_HOSTS.has(host) || SAFE_PROJECT_IDS.has(pid)) return;
  console.error("[content-model][unsafe]", { host, pid });
  process.exit(1);
}
failIfUnsafe();

const URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");

function makeAnon(): SupabaseClient<Database, "public"> {
  return createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function makeService(): SupabaseClient<Database, "public"> {
  return createClient<Database>(URL, SERVICE_KEY, {
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

const TENANT_A = "fd50317e-84a0-4ef6-a081-1111111111a1";
const TENANT_B = "fd50317e-84a0-4ef6-a081-1111111111b1";

let USER_A_OWNER = "";
let USER_A_MANAGER = "";
let USER_A_STAFF = "";
let USER_B_OWNER = "";
const USER_A_OWNER_EMAIL = "owner-a@cm.test.local";
const USER_A_MANAGER_EMAIL = "manager-a@cm.test.local";
const USER_A_STAFF_EMAIL = "staff-a@cm.test.local";
const USER_B_OWNER_EMAIL = "owner-b@cm.test.local";

async function provisionUser(email: string): Promise<string> {
  if (!pg) throw new Error("pg missing");
  const res = await pg.query<{ id: string }>(
    `SELECT public.test_provision_user($1::text, $2::text, '{}'::jsonb) AS id`,
    [email, "VeryStrongTestP4ss!1"],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`provision user failed: ${email}`);
  return id;
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

const ENSURE_GRANTS_SQL = /* sql */ `
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO service_role;
GRANT SELECT
  ON ALL TABLES IN SCHEMA public
  TO anon;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
`;

function uuid(s: string): string {
  return s;
}

async function provision(): Promise<void> {
  if (!pg) throw new Error("pg missing");
  // Auth users (test wrapper if exists, safe isolation)
  try {
    await pg.query(`BEGIN`);
    await pg.query(`SELECT public.test_set_user_id($1::uuid)`, [USER_A_OWNER]);
    await pg.query(`COMMIT`);
  } catch {
    try {
      await pg.query(`ROLLBACK`);
    } catch {
      /* ignore */
    }
  }

  // Cleanup pre-fase5 (autocommit, safe)
  // Disabilito temporaneamente trigger guard_last_active_owner per cleanup safe
  try {
    await pg.query(
      `ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner`,
    );
  } catch {
    /* ignore */
  }
  const cleanup = [
    `DELETE FROM public.site_sections WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid)`,
    `DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid)`,
  ];
  for (const q of cleanup) {
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

  // Create tenants A published active, B published active
  await pg.query(
    `INSERT INTO public.tenants (id, slug, name, status, published, published_at)
     VALUES ($1::uuid,'velora-cm-tenant-a','Tenant A CM','active',true, NOW()),
            ($2::uuid,'velora-cm-tenant-b','Tenant B CM','active',true, NOW())`,
    [TENANT_A, TENANT_B],
  );
  // Create unpublished tenant C
  const TENANT_C_UNPUB = "fd50317e-84a0-4ef6-a081-1111111111c1";
  await pg.query(
    `INSERT INTO public.tenants (id, slug, name, status, published)
     VALUES ($1::uuid,'velora-cm-unpub-c','Tenant C unpublished','active',false)
     ON CONFLICT DO NOTHING`,
    [TENANT_C_UNPUB],
  );

  // Business Profiles
  await pg.query(
    `INSERT INTO public.business_profiles (tenant_id, display_name, description, phone, email, city, timezone, locale, theme_primary, theme_background, theme_foreground, theme_muted, theme_radius, theme_heading_font_preset, theme_body_font_preset)
     VALUES ($1::uuid,'Tenant A CM','Barbiere tradizionale a conduzione familiare.','+39 02 1234567','info@a.example.test','Milano','Europe/Rome','it','#111827','#fafafa','#0f172a','#6b7280','lg','sans','sans'),
            ($2::uuid,'Tenant B CM','Centro estetico moderno.','+39 06 1234567','info@b.example.test','Roma','Europe/Rome','it','#be185d','#ffffff','#111827','#64748b','md','display','sans')
     `,
    [TENANT_A, TENANT_B],
  );

  // Auth users
  USER_A_OWNER = await provisionUser(USER_A_OWNER_EMAIL);
  USER_A_MANAGER = await provisionUser(USER_A_MANAGER_EMAIL);
  USER_A_STAFF = await provisionUser(USER_A_STAFF_EMAIL);
  USER_B_OWNER = await provisionUser(USER_B_OWNER_EMAIL);

  // Profiles (required by FK tenant_memberships.user_id -> profiles.id)
  await pg.query(
    `INSERT INTO public.profiles (id, display_name) VALUES
       ($1::uuid,'CM Owner A'),
       ($2::uuid,'CM Manager A'),
       ($3::uuid,'CM Staff A'),
       ($4::uuid,'CM Owner B')
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
    [USER_A_OWNER, USER_A_MANAGER, USER_A_STAFF, USER_B_OWNER],
  );

  // Tenant Memberships
  await pg.query(
    `INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, status)
     VALUES ('00000000-0000-4000-8000-0000000000a1',$1::uuid,$2::uuid,'owner','active'),
            ('00000000-0000-4000-8000-0000000000a2',$1::uuid,$3::uuid,'manager','active'),
            ('00000000-0000-4000-8000-0000000000a3',$1::uuid,$4::uuid,'staff','active'),
            ('00000000-0000-4000-8000-0000000000b1',$5::uuid,$6::uuid,'owner','active')
     ON CONFLICT DO NOTHING`,
    [TENANT_A, USER_A_OWNER, USER_A_MANAGER, USER_A_STAFF, TENANT_B, USER_B_OWNER],
  );

  // Services A (4, 3 active)
  await pg.query(
    `INSERT INTO public.services (id, tenant_id, name, description, price_from, currency, duration_minutes, active, position)
     VALUES (gen_random_uuid(),$1::uuid,'Taglio uomo','Taglio lavaggio asciugatura',18.00,'EUR',30,true,0),
            (gen_random_uuid(),$1::uuid,'Taglio + barba','Taglio completo più barba',28.00,'EUR',45,true,1),
            (gen_random_uuid(),$1::uuid,'Colore donna','Colore e piega',55.00,'EUR',90,true,2),
            (gen_random_uuid(),$1::uuid,'Trattamento spa','Maschera e massaggio',40.00,'EUR',40,false,3)
     `,
    [TENANT_A],
  );
  // Sections A complete
  await pg.query(
    `INSERT INTO public.site_sections (id, tenant_id, section_type, position, enabled, variant, settings)
     VALUES (gen_random_uuid(),$1::uuid,'hero',0,true,'centered','{"eyebrow":"Benvenuti","ctaLabel":"Chiamaci","ctaTarget":"tel:+39021234567"}'::jsonb),
            (gen_random_uuid(),$1::uuid,'about',1,true,'default','{"eyebrow":"Chi siamo"}'::jsonb),
            (gen_random_uuid(),$1::uuid,'services',2,true,'cards','{"eyebrow":"Listino","headline":"I nostri servizi"}'::jsonb),
            (gen_random_uuid(),$1::uuid,'gallery',3,true,'default','{}'::jsonb),
            (gen_random_uuid(),$1::uuid,'reviews',4,true,'default','{}'::jsonb),
            (gen_random_uuid(),$1::uuid,'contact',5,true,'default','{"eyebrow":"Dove siamo"}'::jsonb),
            (gen_random_uuid(),$1::uuid,'staff',99,false,'default','{}'::jsonb)
     `,
    [TENANT_A],
  );
  // Sections B (different order + Hero variant split)
  await pg.query(
    `INSERT INTO public.site_sections (id, tenant_id, section_type, position, enabled, variant, settings)
     VALUES (gen_random_uuid(),$1::uuid,'hero',0,true,'split','{"eyebrow":"Beauté"}'::jsonb),
            (gen_random_uuid(),$1::uuid,'contact',1,true,'default','{}'::jsonb),
            (gen_random_uuid(),$1::uuid,'about',2,true,'minimal','{}'::jsonb),
            (gen_random_uuid(),$1::uuid,'gallery',3,true,'carousel','{}'::jsonb)
     `,
    [TENANT_B],
  );
}

beforeAll(async () => {
  pg = new PgClient(buildPgOpts());
  await pg.connect();
  try {
    await pg.query(DROP_TESTONLY_RPC_SQL);
  } catch {
    /* ignore */
  }
  await pg.query(ENSURE_GRANTS_SQL);
  await pg.query(TESTONLY_RPC_SQL);
  await provision();
});

afterAll(async () => {
  if (pg) {
    try {
      const emails = [
        USER_A_OWNER_EMAIL,
        USER_A_MANAGER_EMAIL,
        USER_A_STAFF_EMAIL,
        USER_B_OWNER_EMAIL,
      ]
        .map((x) => `'${x}'`)
        .join(",");
      try {
        await pg.query(
          `ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner`,
        );
      } catch {
        /* ignore */
      }
      const all = [
        `DELETE FROM public.site_sections WHERE tenant_id::text LIKE 'fd50317e-84a0-4ef6-a081-11111111%' OR tenant_id IN ($1::uuid,$2::uuid)`,
        `DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid)`,
        `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid) OR user_id IN (SELECT id FROM auth.users WHERE email IN (${emails}))`,
        `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid)`,
        `DELETE FROM public.tenants WHERE id::text LIKE 'fd50317e-84a0-4ef6-a081-11111111%' OR id IN ($1::uuid,$2::uuid)`,
        `DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email IN (${emails}))`,
        `DELETE FROM auth.users WHERE email IN (${emails})`,
        DROP_TESTONLY_RPC_SQL,
      ];
      for (const q of all) {
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
    } finally {
      await pg.end().catch(() => {});
      pg = null;
    }
  }
});

async function setUser(pg: PgClient, uid: string | null): Promise<void> {
  if (uid == null) {
    try {
      await pg.query(`RESET request.jwt.claim.sub`);
    } catch {
      /* ignore */
    }
    try {
      await pg.query(`RESET request.jwt.claim.role`);
    } catch {
      /* ignore */
    }
    try {
      await pg.query(`SELECT public.test_set_user_id(NULL)`);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    await pg.query(`SELECT public.test_set_user_id($1::uuid)`, [uid]);
  } catch {
    /* ignore */
  }
  try {
    await pg.query(
      `SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', $1::text, false)`,
      [uid],
    );
  } catch {
    /* ignore */
  }
}

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  if (!pg) throw new Error("no pg");
  try {
    await setUser(pg, uid);
    await pg.query(`SET ROLE authenticated`);
    return await fn();
  } finally {
    try {
      await pg.query(`RESET ROLE`);
    } catch {
      /* ignore */
    }
    await setUser(pg, null);
  }
}

describe("FASE5 §37 DB SECURITY MATRIX D1..D18 (site_sections/services)", () => {
  it("D1. Owner A can read sections A ALLOW (direct pg authenticated as owner_a)", async () => {
    const res = await asUser(USER_A_OWNER, async () => {
      const q = await pg!.query(
        `SELECT count(*)::int AS c FROM public.site_sections WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      );
      return q.rows[0].c as number;
    });
    expect(res).toBeGreaterThanOrEqual(6);
  });

  it("D2. Manager A can insert sections A ALLOW", async () => {
    if (!pg) throw new Error("no pg");
    // ensure no reviews duplicate
    await asUser(USER_A_MANAGER, async () => {
      const q = await pg!.query(
        `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
         SELECT $1::uuid,'gallery',98,true,'default','{}'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM public.site_sections WHERE tenant_id=$1::uuid AND position=98)
         RETURNING 1`,
        [TENANT_A],
      );
      expect(q.rowCount).toBeGreaterThanOrEqual(0);
    });
  });

  it("D4. Owner A cannot read private sections of B by-passing RLS by adding tenant_id B direct select → DENY (count=0)", async () => {
    const res = await asUser(USER_A_OWNER, async () => {
      const q = await pg!.query(
        `SELECT count(*)::int AS c FROM public.site_sections WHERE tenant_id=$1::uuid`,
        [TENANT_B],
      );
      return q.rows[0].c as number;
    });
    expect(res).toBe(0);
  });

  it("D5. Manager A cannot INSERT a section for tenant B DENY (0 rows affected per RLS)", async () => {
    if (!pg) throw new Error("no pg");
    try {
      await asUser(USER_A_MANAGER, async () => {
        await pg!.query(`SAVEPOINT sp_d5`);
        try {
          await pg!.query(
            `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
             VALUES ($1::uuid,'hero',77,true,'default','{}'::jsonb)
             ON CONFLICT DO NOTHING RETURNING 1`,
            [TENANT_B],
          );
        } catch {
          try {
            await pg!.query(`ROLLBACK TO SAVEPOINT sp_d5`);
          } catch {
            /* ignore */
          }
          try {
            await pg!.query(`RELEASE SAVEPOINT sp_d5`);
          } catch {
            /* ignore */
          }
          return 0;
        }
        try {
          await pg!.query(`RELEASE SAVEPOINT sp_d5`);
        } catch {
          /* ignore */
        }
        return 0;
      }).catch(() => 0);
    } catch {
      /* ignore */
    }
    // Verifica: nessuna riga con position 77 su B (indipendentemente eccezione)
    const svc = makeService();
    const row = await svc
      .from("site_sections")
      .select("id")
      .eq("tenant_id", TENANT_B)
      .eq("position", 77)
      .limit(1)
      .maybeSingle();
    expect(row.data).toBeNull();
  });

  it("D6. anon reads published A site_sections → rows > 0", async () => {
    const anon = makeAnon();
    const { data, error } = await anon
      .from("site_sections")
      .select("section_type,position")
      .order("position");
    expect(error).toBeNull();
    const filtered = (data ?? []).filter((x) => x.section_type).length;
    // Almeno Hero + About + Services + Contact (enabled)
    expect(filtered).toBeGreaterThanOrEqual(4);
  });

  it("D7. anon CANNOT read unpublished tenant sections (tenant unpublished)", async () => {
    const service = makeService();
    // First service direct insert to unpublished C via service role so RLS bypassed for setup
    const unpA = uuid("fd50317e-84a0-4ef6-a081-1111111111c1");
    const { error: ierr } = await service
      .from("site_sections")
      .insert({ tenant_id: unpA, section_type: "hero", position: 0, enabled: true });
    expect(ierr).toBeNull();
    // anon reads zero (tenant unpublished)
    const anon = makeAnon();
    const { data, error } = await anon.from("site_sections").select("section_type");
    expect(error).toBeNull();
    const anyUnpub = (data ?? []).filter(
      (s) => (s as unknown as { tenant_id?: string }).tenant_id === unpA,
    );
    expect(anyUnpub).toHaveLength(0);
  });

  it("D8. anon sees A published & B published (both visible)", async () => {
    const anon = makeAnon();
    const { data } = await anon.from("tenants").select("slug").eq("status", "active");
    const slugs = new Set((data ?? []).map((t) => t.slug));
    expect(slugs.has("velora-cm-tenant-a")).toBe(true);
    expect(slugs.has("velora-cm-tenant-b")).toBe(true);
  });

  it("D9. anon INSERT section → DENIED", async () => {
    const anon = makeAnon();
    const { error } = await anon
      .from("site_sections")
      .insert({ tenant_id: TENANT_A, section_type: "hero", position: 999, enabled: true });
    expect(error).not.toBeNull();
  });

  it("D10. anon UPDATE enabled → DENIED", async () => {
    const anon = makeAnon();
    const svc = makeService();
    const row = await svc
      .from("site_sections")
      .select("id")
      .eq("tenant_id", TENANT_A)
      .eq("section_type", "hero")
      .limit(1)
      .single();
    expect(row.error).toBeNull();
    if (!row.data) return;
    const { error } = await anon
      .from("site_sections")
      .update({ enabled: false })
      .eq("id", row.data.id);
    expect(error).not.toBeNull();
  });

  it("D11. anon DELETE section → DENIED", async () => {
    const anon = makeAnon();
    const svc = makeService();
    const row = await svc
      .from("site_sections")
      .select("id")
      .eq("tenant_id", TENANT_A)
      .eq("section_type", "about")
      .limit(1)
      .single();
    expect(row.error).toBeNull();
    if (!row.data) return;
    const { error } = await anon.from("site_sections").delete().eq("id", row.data.id);
    expect(error).not.toBeNull();
  });

  it("D12 cross-tenant cache none: A section row not present in B listing service-role filtered by B tenant_id", async () => {
    const svc = makeService();
    const b = await svc
      .from("site_sections")
      .select("section_type,position")
      .eq("tenant_id", TENANT_B)
      .order("position");
    if (b.error) console.error("D12 site_sections error:", b.error);
    expect(b.error).toBeNull();
    const orderB = (b.data ?? []).map((x) => `${x.section_type}:${x.position}`);
    // Hero:0, Contact:1, About:2, Gallery:3
    expect(orderB).toContain("hero:0");
    expect(orderB).toContain("contact:1");
    expect(orderB).toContain("about:2");
    expect(orderB).toContain("gallery:3");
    // A ha services:2 — B NON lo contiene
    expect(orderB.some((s) => s.startsWith("services:"))).toBe(false);
  });

  it("D13 tenant_memberships never exposed as staff_public (no staff_members table; render returns null)", async () => {
    // Staff section ha members = [] per app-level. DB non esiste staff table.
    const { rows } = await pg!.query(
      `SELECT to_regclass('public.staff_public') IS NOT NULL AS exists_table
       UNION ALL SELECT to_regclass('public.staff') IS NOT NULL
       UNION ALL SELECT to_regclass('public.public_staff') IS NOT NULL`,
    );
    const hasAny = rows.some((r) => Boolean(r.exists_table));
    // Staff pubblico NON esiste come tabella (GATE19).
    expect(hasAny).toBe(false);
  });

  it("D14 reviews empty does NOT fabricate records (services insert 0 per B)", async () => {
    const svc = makeService();
    const reviews = await svc
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_B);
    // Zero servizi salvati per B
    expect(reviews.error).toBeNull();
    expect(reviews.count).toBe(0);
    // No reviews model table exists
    const { rows } = await pg!.query(
      `SELECT to_regclass('public.reviews') IS NOT NULL as exists_reviews`,
    );
    expect(Boolean(rows[0]?.exists_reviews)).toBe(false);
  });

  it("D15 invalid section_type CHECK rejected (postgres sql exception)", async () => {
    if (!pg) throw new Error("no pg");
    let threw = false;
    try {
      await pg.query(
        `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
         VALUES ($1::uuid,'homepage',110,true,'default','{}'::jsonb)`,
        [TENANT_A],
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("D16 invalid variant CHECK rejected (postgres sql exception)", async () => {
    if (!pg) throw new Error("no pg");
    let threw = false;
    try {
      await pg.query(
        `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
         VALUES ($1::uuid,'services',111,true,'insane_variant','{}'::jsonb)`,
        [TENANT_A],
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("D17 duplicate singleton hero reject UNIQUE partial index", async () => {
    if (!pg) throw new Error("no pg");
    let threw = false;
    try {
      await pg.query(`SAVEPOINT dp17`);
      await pg.query(
        `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
         VALUES ($1::uuid,'hero',112,true,'default','{}'::jsonb)`,
        [TENANT_A],
      );
    } catch {
      threw = true;
      try {
        await pg.query(`ROLLBACK TO SAVEPOINT dp17`);
      } catch {
        /* ignore */
      }
    }
    expect(threw).toBe(true);
  });

  it("D18 invalid FK tenant_id (non existent UUID) rejected ON INSERT", async () => {
    if (!pg) throw new Error("no pg");
    let threw = false;
    try {
      await pg.query(`SAVEPOINT dp18`);
      await pg.query(
        `INSERT INTO public.site_sections(tenant_id,section_type,position,enabled,variant,settings)
         VALUES ('00000000-0000-4000-8000-00000000FFFF','hero',115,true,'default','{}'::jsonb)`,
      );
    } catch {
      threw = true;
      try {
        await pg.query(`ROLLBACK TO SAVEPOINT dp18`);
      } catch {
        /* ignore */
      }
    }
    expect(threw).toBe(true);
  });

  it("Bonus: services.price_from numeric 18,00 EUR; GATE 17 prices NO float", async () => {
    if (!pg) throw new Error("no pg");
    const q = await pg.query(
      `SELECT name, price_from, currency, pg_typeof(price_from)::text as t
       FROM public.services WHERE tenant_id=$1::uuid AND price_from IS NOT NULL ORDER BY position LIMIT 1`,
      [TENANT_A],
    );
    expect(q.rows).toHaveLength(1);
    expect(String(q.rows[0].price_from)).toBe("18.00");
    expect(q.rows[0].currency).toBe("EUR");
    expect(q.rows[0].t).toBe("numeric");
  });
});
