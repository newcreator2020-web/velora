// @vitest-environment node
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local", "uiekkhgspziozprxulit"]);

const DEFAULT_LOCAL: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
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
function requiredEnv(k: string): string {
  const v = envOr(k);
  if (v.length === 0) throw new Error(`[db-test] missing required env: ${k}`);
  return v;
}

function failIfUnsafe() {
  const host = requiredEnv("SUPABASE_DB_HOST");
  const projectId = process.env["SUPABASE_PROJECT_ID"] ?? "";
  if (ALLOWED_DB_HOSTS.has(host) || SAFE_PROJECT_IDS.has(projectId)) return;
  console.error(`[db-test][unsafe] host=${host} project=${projectId}`);
  process.exit(1);
}
failIfUnsafe();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");

function createTestAnonSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function buildPgOpts() {
  const host = requiredEnv("SUPABASE_DB_HOST");
  const portStr = envOr("SUPABASE_DB_PORT");
  const port = Number(portStr) || 54322;
  const password = requiredEnv("SUPABASE_DB_PASSWORD");
  return { host, user: "postgres", database: "postgres", password, port, ssl: false } as const;
}

let pg: PgClient | null = null;

beforeAll(async () => {
  pg = new PgClient(buildPgOpts());
  await pg.connect();
});
afterAll(async () => {
  if (pg) {
    try {
      await pg.end();
    } finally {
      pg = null;
    }
  }
});

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface PublicFixtureTenant {
  slug: string;
  tenantId: string;
}

async function makePublicTenant(input: {
  slug: string;
  name: string;
  businessName: string;
  category: string;
  description: string;
  city: string;
  province: string;
  phone?: string;
  emailContact?: string;
  address?: string;
  published: boolean;
  status: string;
}): Promise<PublicFixtureTenant> {
  const tenantId = uuidv4();
  const now = new Date().toISOString();
  const locale = "it";
  const timezone = "Europe/Rome";
  const publishedAt = input.published ? now : null;

  await pg!.query(
    `INSERT INTO public.tenants(id, name, slug, status, published, published_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, input.name, input.slug, input.status, input.published, publishedAt, now, now],
  );
  await pg!.query(
    `INSERT INTO public.business_profiles(
        tenant_id, display_name, category, description, phone, email, website_url,
        address_line1, address_line2, city, province, postal_code, country_code,
        latitude, longitude, locale, timezone, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      tenantId,
      input.businessName,
      input.category,
      input.description,
      input.phone ?? null,
      input.emailContact ?? null,
      null,
      input.address ?? null,
      null,
      input.city,
      input.province,
      "00100",
      "IT",
      null,
      null,
      locale,
      timezone,
      now,
      now,
    ],
  );
  return { slug: input.slug, tenantId };
}

async function cleanupFixture(tenantId: string) {
  await pg!.query(`DELETE FROM public.business_profiles WHERE tenant_id = $1`, [tenantId]);
  await pg!.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]);
}

describe("FASE4 · P1-P11 Public anonymous RLS + Site Engine Data Access", () => {
  let tA: PublicFixtureTenant;
  let tB: PublicFixtureTenant;
  let tC: PublicFixtureTenant;
  let tD: PublicFixtureTenant;
  let tE: PublicFixtureTenant;

  beforeEach(async () => {
    const base = await Promise.all([
      makePublicTenant({
        slug: "velora-test-barber-roma",
        name: "Barber Roma Srl",
        businessName: "Barbieri di Roma — Test Tenant A",
        category: "Barbiere",
        description: "Barbiere storico a Roma, taglio uomo e bambino.",
        city: "Roma",
        province: "RM",
        phone: "+39 06 12345678",
        emailContact: "info@barberiroma-test.example",
        address: "Via Nazionale 12",
        published: true,
        status: "active",
      }),
      makePublicTenant({
        slug: "velora-test-beauty-milano",
        name: "Beauty Milano Sas",
        businessName: "Centro Bellezza Milano — Test Tenant B",
        category: "Centro estetico",
        description: "Estetica avanzata a Milano, trattamenti viso e corpo.",
        city: "Milano",
        province: "MI",
        phone: "+39 02 87654321",
        emailContact: "hello@beautymilano-test.example",
        address: "Corso Buenos Aires 45",
        published: true,
        status: "active",
      }),
      makePublicTenant({
        slug: "velora-test-unpublished",
        name: "Unpublished Napoli Snc",
        businessName: "Non Devo Essere Visibile",
        category: "Prova",
        description: "Contenuto non pubblicato.",
        city: "Napoli",
        province: "NA",
        published: false,
        status: "active",
      }),
      makePublicTenant({
        slug: "velora-test-suspended",
        name: "Sospeso Torino Srl",
        businessName: "Sono Sospeso",
        category: "Prova",
        description: "Sito sospeso.",
        city: "Torino",
        province: "TO",
        published: true,
        status: "suspended",
      }),
      makePublicTenant({
        slug: "velora-test-incomplete-bp",
        name: "Incomplete Ancona Srl",
        businessName: "Nome transitorio da annullare",
        category: "Sconosciuto",
        description: "",
        city: "Ancona",
        province: "AN",
        published: true,
        status: "active",
      }),
    ]);
    [tA, tB, tC, tD, tE] = base;
    await pg!.query(
      `UPDATE public.business_profiles SET display_name = NULL, description = NULL WHERE tenant_id = $1`,
      [tE.tenantId],
    );
  }, 45000);

  afterEach(async () => {
    await Promise.all([
      cleanupFixture(tA.tenantId),
      cleanupFixture(tB.tenantId),
      cleanupFixture(tC.tenantId),
      cleanupFixture(tD.tenantId),
      cleanupFixture(tE.tenantId),
    ]);
  }, 45000);

  it("P1: anon legge Tenant A pubblicato → projection pubblica visibile", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon
      .from("tenants")
      .select("slug,status,published")
      .eq("slug", tA.slug)
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(res.data!.status).toBe("active");
    expect(res.data!.published).toBe(true);
  });

  it("P2: anon legge Tenant NON pubblicato (published=false) → 0 righe", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon
      .from("tenants")
      .select("slug,status,published")
      .eq("slug", tC.slug)
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("P3: anon slug INESISTENTE → 0 righe", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon
      .from("tenants")
      .select("slug")
      .eq("slug", "velora-inesistente-abc123")
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("P4: anon non enumera memberships → 0 righe o errore", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon
      .from("tenant_memberships")
      .select("tenant_id", { count: "exact", head: true });
    expect(res.count ?? 0).toBe(0);
  });

  it("P5: anon non legge platform_admins → 0 righe o errore", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon.from("platform_admins").select("id", { count: "exact", head: true });
    expect(res.count ?? 0).toBe(0);
  });

  it("P6: anon non legge audit_logs → 0 righe o errore", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon.from("audit_logs").select("id", { count: "exact", head: true });
    expect(res.count ?? 0).toBe(0);
  });

  it("P7: anon non legge tenant suspended published=true → 0", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon.from("tenants").select("slug,status").eq("slug", tD.slug).maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("P8: anon legge business_profile A pubblicato → OK display_name/city", async () => {
    const anon = createTestAnonSupabase();
    const res = await anon
      .from("business_profiles")
      .select("tenant_id, display_name, description, city, province")
      .eq("tenant_id", tA.tenantId)
      .maybeSingle();
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(res.data!.display_name).toBe("Barbieri di Roma — Test Tenant A");
    expect(res.data!.city).toBe("Roma");
  });

  it("P9: cross-tenant anon → A NON contiene B", async () => {
    const anon = createTestAnonSupabase();
    const a = (
      await anon
        .from("business_profiles")
        .select("display_name, city")
        .eq("tenant_id", tA.tenantId)
        .single()
    ).data!;
    const b = (
      await anon
        .from("business_profiles")
        .select("display_name, city")
        .eq("tenant_id", tB.tenantId)
        .single()
    ).data!;
    expect(a.display_name).not.toContain("Milano");
    expect(b.display_name).not.toContain("Roma");
    expect(a.city).toBe("Roma");
    expect(b.city).toBe("Milano");
  });

  it("P10: transition published=true→false rimuove visibilità anon", async () => {
    const anon = createTestAnonSupabase();
    const before = await anon.from("tenants").select("slug").eq("slug", tA.slug).maybeSingle();
    expect(before.data).not.toBeNull();

    await pg!.query(`UPDATE public.tenants SET published = FALSE WHERE id = $1`, [tA.tenantId]);

    const after = await anon.from("tenants").select("slug").eq("slug", tA.slug).maybeSingle();
    expect(after.data).toBeNull();
  });

  it("P11: published active ma display_name NULL → resolver deve rifiutare (Dati Pubblici Incompleti)", async () => {
    const anon = createTestAnonSupabase();
    const withBp = await anon
      .from("tenants")
      .select(`slug,business_profiles(display_name)`)
      .eq("slug", tE.slug)
      .maybeSingle();
    expect(withBp.error).toBeNull();
    expect(withBp.data).not.toBeNull();
    const raw = withBp.data as { business_profiles?: { display_name?: unknown } | unknown };
    const bpObj =
      typeof raw.business_profiles === "object" && raw.business_profiles !== null
        ? (raw.business_profiles as { display_name?: unknown })
        : null;
    const displayName = bpObj?.display_name;
    const missing =
      displayName === null ||
      displayName === undefined ||
      (typeof displayName === "string" && displayName.trim().length === 0);
    expect(missing).toBe(true);

    const countWithBp = await anon
      .from("tenants")
      .select("slug", { count: "exact", head: true })
      .eq("slug", tE.slug)
      .not("business_profiles.display_name", "is", null);
    expect(countWithBp.count ?? 0).toBe(0);
  });
});
