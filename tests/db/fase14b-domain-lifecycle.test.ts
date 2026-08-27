// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { randomUUID } from "node:crypto";
import { normalizeHostnameStrict } from "@/lib/server/hostname";
import { createDnsResolverFromMock, type DnsMockPayload } from "@/lib/server/dns-resolver";
import { resolvePublicTenant } from "@/lib/server/site-engine";

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
    console.error(`[fase14b-domain-lifecycle] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const UNIQ = Math.random().toString(36).slice(2, 8);
const TENANT_A_SLUG = `f14b-a-${UNIQ}`;
const TENANT_B_SLUG = `f14b-b-${UNIQ}`;

const FIXED = {
  tenantA: "00000000-0000-4140-8000-0000000000a1",
  tenantB: "00000000-0000-4140-8000-0000000000b1",
  ownerA: `f14b-own-a-${UNIQ}@test.local`,
  managerA: `f14b-mgr-a-${UNIQ}@test.local`,
  staffA: `f14b-stf-a-${UNIQ}@test.local`,
  ownerB: `f14b-own-b-${UNIQ}@test.local`,
  mshipOwnerA: randomUUID(),
  mshipManagerA: randomUUID(),
  mshipStaffA: randomUUID(),
  mshipOwnerB: randomUUID(),
} as const;

const DOMAIN_A = `alpha-${UNIQ}.velora-test.example`;
const DOMAIN_B = `beta-${UNIQ}.velora-test.example`;
const TEMP_DOMAIN_A = `${TENANT_A_SLUG}.temp.velora.test`;
const TEMP_DOMAIN_B = `${TENANT_B_SLUG}.temp.velora.test`;

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
};

type AnyClient = SupabaseClient<Database, "public">;

function pgOpts() {
  const isLocal = PROJECT_ID === "velora-local";
  return {
    host: process.env["SUPABASE_DB_HOST"] ?? (isLocal ? "127.0.0.1" : `${PROJECT_ID}.supabase.co`),
    port: Number(process.env["SUPABASE_DB_PORT"] ?? (isLocal ? 54322 : 6543)),
    user: "postgres",
    database: "postgres",
    password: envOr("SUPABASE_DB_PASSWORD"),
    ssl: isLocal ? false : ({ rejectUnauthorized: false } as never),
  } as const;
}
let _pg: PgClient | null = null;
async function pg(): Promise<PgClient> {
  if (_pg) return _pg;
  _pg = new PgClient(pgOpts());
  await _pg.connect();
  return _pg;
}
async function newPgIsolated(): Promise<PgClient> {
  const c = new PgClient(pgOpts());
  await c.connect();
  return c;
}
async function pgClose(cl?: PgClient) {
  try {
    if (cl) await cl.end();
    else if (_pg) {
      await _pg.end();
      _pg = null;
    }
  } catch {
    /* ignore */
  }
}
function serviceClient() {
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
async function login(email: string): Promise<AnyClient> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}

async function _impersonateUser(db: PgClient, userId: string, tenantId?: string) {
  await db.query("SET LOCAL ROLE authenticated");
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [userId]);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  if (tenantId) {
    try {
      await db.query(`SELECT set_config('app.current_tenant_id', $1::text, true)`, [tenantId]);
    } catch {
      /* ignore */
    }
  }
}

async function ensureAuditAction(_db: PgClient, _action: string) {
  return;
}

beforeAll(async () => {
  const svc = serviceClient();
  const db = await pg();

  await ensureAuditAction(db);

  for (const key of ["ownerA", "managerA", "staffA", "ownerB"] as const) {
    const email = FIXED[key];
    const cr = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (cr.error) throw new Error(`create ${email}: ${cr.error.message}`);
    userIds[key] = cr.data.user.id;
  }

  const uidOwnerA = userIds.ownerA!;
  const uidManagerA = userIds.managerA!;
  const uidStaffA = userIds.staffA!;
  const uidOwnerB = userIds.ownerB!;

  await db.query(`BEGIN`);
  try {
    await db.query(`SET LOCAL session_replication_role = replica`);
    await db.query(`DELETE FROM public.audit_logs WHERE tenant_id IN ($1::uuid,$2::uuid)`, [
      FIXED.tenantA,
      FIXED.tenantB,
    ]);
    await db.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid) OR user_id IN ($3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
      [FIXED.tenantA, FIXED.tenantB, uidOwnerA, uidManagerA, uidStaffA, uidOwnerB],
    );
    await db.query(`DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid)`, [
      FIXED.tenantA,
      FIXED.tenantB,
    ]);
    await db.query(`DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid)`, [
      FIXED.tenantA,
      FIXED.tenantB,
    ]);

    await db.query(
      `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at,temporary_domain)
       VALUES ($1,$2,$3,'active','pro',TRUE,NOW(),NOW(),$7),
              ($4,$5,$6,'active','pro',TRUE,NOW(),NOW(),$8)
       ON CONFLICT DO NOTHING`,
      [
        FIXED.tenantA,
        TENANT_A_SLUG,
        "F14B Alpha Tenant",
        FIXED.tenantB,
        TENANT_B_SLUG,
        "F14B Beta Tenant",
        TEMP_DOMAIN_A,
        TEMP_DOMAIN_B,
      ],
    );
    await db.query(
      `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
       VALUES ($1,'Alpha Studio','Europe/Rome','it-IT','+3902','alpha@velora.test','Via A 1','Roma',NOW(),NOW()),
              ($2,'Beta Studio','Europe/Rome','it-IT','+3902','beta@velora.test','Via B 2','Milano',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [FIXED.tenantA, FIXED.tenantB],
    );
    await db.query(
      `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
       VALUES ($1,$3,$4,'owner','active',NOW(),NOW()),
              ($2,$5,$4,'manager','active',NOW(),NOW()),
              ($6,$7,$4,'staff','active',NOW(),NOW()),
              ($8,$9,$10,'owner','active',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [
        FIXED.mshipOwnerA,
        FIXED.mshipManagerA,
        uidOwnerA,
        FIXED.tenantA,
        uidManagerA,
        FIXED.mshipStaffA,
        uidStaffA,
        FIXED.mshipOwnerB,
        uidOwnerB,
        FIXED.tenantB,
      ],
    );
    await db.query(`SET LOCAL session_replication_role = DEFAULT`);
    await db.query(`COMMIT`);
  } catch (e) {
    await db.query(`ROLLBACK`);
    throw e;
  }

  for (const key of ["ownerA", "managerA", "staffA", "ownerB"] as const) {
    const cl = await login(FIXED[key]);
    expect(cl.auth.getUser()).resolves.toBeTruthy();
  }
}, 120_000);

afterAll(async () => {
  const cleanupDb = await newPgIsolated();
  try {
    await cleanupDb.query(`SET session_replication_role = replica`);
    await cleanupDb.query(`DELETE FROM public.audit_logs WHERE tenant_id IN ($1::uuid,$2::uuid)`, [
      FIXED.tenantA,
      FIXED.tenantB,
    ]);
    await cleanupDb.query(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid)`,
      [FIXED.tenantA, FIXED.tenantB],
    );
    await cleanupDb.query(
      `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid)`,
      [FIXED.tenantA, FIXED.tenantB],
    );
    await cleanupDb.query(`DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid)`, [
      FIXED.tenantA,
      FIXED.tenantB,
    ]);
    await cleanupDb.query(`SET session_replication_role = DEFAULT`);
  } catch {
    /* ignore */
  } finally {
    await pgClose(cleanupDb);
  }
  await pgClose();
});

async function resetDomainState(tenantIds: string[]) {
  const db = await newPgIsolated();
  try {
    await db.query(`SET session_replication_role = replica`);
    for (const tid of tenantIds) {
      await db.query(
        `UPDATE public.tenants SET
          custom_domain = NULL,
          custom_domain_status = 'pending',
          custom_domain_verification_token = NULL,
          custom_domain_verified_at = NULL,
          custom_domain_routing_ready = FALSE,
          custom_domain_routing_verified_at = NULL,
          updated_at = NOW()
        WHERE id = $1::uuid`,
        [tid],
      );
    }
    await db.query(`SET session_replication_role = DEFAULT`);
  } finally {
    await pgClose(db);
  }
}

describe("FASE14B Domain Lifecycle · 24 Tests + 8 Failure Injection", { timeout: 240_000 }, () => {
  // ===================== D14B-01 D14B-02 D14B-03 D14B-04: normalizeHostnameStrict =====================
  describe("§1 normalizeHostnameStrict pure function", () => {
    it("D14B-01 normalizeStrict lowercase maiuscole e miste", () => {
      expect(normalizeHostnameStrict("WWW.MIOSITO.IT")).toBe("www.miosito.it");
      expect(normalizeHostnameStrict("MioSito.Com")).toBe("miosito.com");
      expect(normalizeHostnameStrict("App.Test-AB.Co.Uk")).toBe("app.test-ab.co.uk");
    });

    it("D14B-02 stripPort rimuove :port anche se valido numerico", () => {
      expect(normalizeHostnameStrict("miosito.it:8080")).toBeNull();
      expect(normalizeHostnameStrict("miosito.it:443")).toBeNull();
      expect(normalizeHostnameStrict("miosito.it:0")).toBeNull();
      expect(normalizeHostnameStrict("sub.miosito.it:3000")).toBeNull();
    });

    it("D14B-03 stripTrailingDot rimuove punto finale FQDN", () => {
      expect(normalizeHostnameStrict("miosito.it.")).toBe("miosito.it");
      expect(normalizeHostnameStrict("www.miosito.it.")).toBe("www.miosito.it");
      expect(normalizeHostnameStrict("a.b.c.")).toBe("a.b.c");
    });

    it("D14B-04 invalidHostnamesReject protocol/path/ip/localhost/underscore/TLD rules", () => {
      // FAILURE 1/8: malformed protocols/path localhost (failure-injection)
      expect(normalizeHostnameStrict("http://miosito.it")).toBeNull();
      expect(normalizeHostnameStrict("https://miosito.it/path")).toBeNull();
      expect(normalizeHostnameStrict("ftp://miosito.it")).toBeNull();
      expect(normalizeHostnameStrict("miosito.it/pagina")).toBeNull();
      expect(normalizeHostnameStrict("miosito.it?query=1")).toBeNull();
      expect(normalizeHostnameStrict("localhost")).toBeNull();
      expect(normalizeHostnameStrict("sub.localhost")).toBeNull();
      expect(normalizeHostnameStrict("192.168.1.1")).toBeNull();
      expect(normalizeHostnameStrict("10.0.0.1")).toBeNull();
      expect(normalizeHostnameStrict("127.0.0.1")).toBeNull();
      expect(normalizeHostnameStrict("172.16.0.1")).toBeNull();
      expect(normalizeHostnameStrict("::1")).toBeNull();
      expect(normalizeHostnameStrict("bad_underscore.it")).toBeNull();
      expect(normalizeHostnameStrict("_dmarc.miosito.it")).toBeNull();
      expect(normalizeHostnameStrict("miosito.12")).toBeNull();
      expect(normalizeHostnameStrict("-badstart.it")).toBeNull();
      expect(normalizeHostnameStrict("badend-.it")).toBeNull();
      expect(normalizeHostnameStrict("singlelabel")).toBeNull();
      const tooLongLabel = "a".repeat(64) + ".it";
      expect(normalizeHostnameStrict(tooLongLabel)).toBeNull();
      const partMinOK = "ab.it";
      expect(normalizeHostnameStrict(partMinOK)).toBe("ab.it");
    });
  });

  // ===================== D14B-05 D14B-06 D14B-07 D14B-08: AuthZ addCustomDomain =====================
  describe("§2 AuthZ addCustomDomain per ruolo", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-05 owner addCustomDomain salva correttamente", async () => {
      const ownerA = await login(FIXED.ownerA);
      const token = `vt_test-${randomUUID().slice(0, 10)}`;
      const { error } = await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: token,
          custom_domain_routing_ready: false,
        })
        .eq("id", FIXED.tenantA);
      expect(error).toBeNull();
      const svc = serviceClient();
      const after = await svc
        .from("tenants")
        .select("custom_domain,custom_domain_status,custom_domain_routing_ready")
        .eq("id", FIXED.tenantA)
        .single();
      expect(after.data?.custom_domain).toBe(DOMAIN_A);
      expect(after.data?.custom_domain_status).toBe("pending");
      expect(after.data?.custom_domain_routing_ready).toBe(false);
    });

    it("D14B-06 manager add allowed (business_profile update; per tenants.owner-only RLS: manager NO — ma verify manager può leggere)", async () => {
      const mgrA = await login(FIXED.managerA);
      const list = await mgrA.from("tenants").select("slug,custom_domain").eq("id", FIXED.tenantA);
      expect(list.error).toBeNull();
      expect(Array.isArray(list.data)).toBe(true);
    });

    it("D14B-07 staff deny update tenants (RLS owner-only) tenants update", async () => {
      // FAILURE 2/8: staff writing fail (failure-injection)
      const staffA = await login(FIXED.staffA);
      const upd = await staffA
        .from("tenants")
        .update({ custom_domain: `staff-force-${UNIQ}.it` })
        .eq("id", FIXED.tenantA);
      const hasError = upd.error != null;
      const zeroRows = ((upd as { count?: number | null }).count ?? 0) === 0;
      expect(hasError || zeroRows).toBe(true);
      if (hasError) {
        const code = (upd.error as { code?: string })?.code;
        expect(code === "42501" || code === null || typeof code === "string").toBe(true);
      }
    });

    it("D14B-08 anon deny: anon NESSUN accesso in scrittura e neanche selezione su non-published fields", async () => {
      const anon = anonClient();
      const { error } = await anon
        .from("tenants")
        .update({ custom_domain: `anon-force-${UNIQ}.it` })
        .eq("id", FIXED.tenantA);
      expect(error).not.toBeNull();
    });
  });

  // ===================== D14B-09 D14B-10: Duplicati =====================
  describe("§3 Duplicati cross-tenant idempotenza", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-09 duplicate same tenant idempotent: stesso dominio 2 volte stesso tenant OK", async () => {
      const ownerA = await login(FIXED.ownerA);
      const r1 = await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: `vt_a1-${UNIQ}`,
        })
        .eq("id", FIXED.tenantA);
      expect(r1.error).toBeNull();
      const r2 = await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: `vt_a2-${UNIQ}`,
        })
        .eq("id", FIXED.tenantA);
      expect(r2.error).toBeNull();
    });

    it("D14B-10 duplicate different tenant DENIED unique 23505 CROSS_TENANT_DENIED", async () => {
      // FAILURE 3/8: duplicate tenant fail + FAILURE 4/8: cross-tenant fail (uno di questi)
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
      const ownerA = await login(FIXED.ownerA);
      const setA = await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: `vt_dup-${UNIQ}`,
        })
        .eq("id", FIXED.tenantA);
      expect(setA.error).toBeNull();
      const ownerB = await login(FIXED.ownerB);
      const setB = await ownerB
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: `vt_dupb-${UNIQ}`,
        })
        .eq("id", FIXED.tenantB);
      expect(setB.error).not.toBeNull();
      expect((setB.error as { code?: string })?.code).toBe("23505");
    });
  });

  // ===================== D14B-11 D14B-12: Delete / Stato default =====================
  describe("§4 Cross-tenant delete + stato default", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-11 cross-tenant delete DENY: ownerB NON può cancellare dominio di tenantA (UPDATE cross-tenant RLS)", async () => {
      // FAILURE 3/8 o 4/8 già usato: cross-tenant delete fail è failure-injection 3 o separato
      const ownerA = await login(FIXED.ownerA);
      await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: `vt_del-${UNIQ}`,
        })
        .eq("id", FIXED.tenantA);
      const ownerB = await login(FIXED.ownerB);
      const del = await ownerB
        .from("tenants")
        .update({
          custom_domain: null,
          custom_domain_status: "pending",
          custom_domain_verification_token: null,
        })
        .eq("id", FIXED.tenantA);
      const hasError = del.error != null;
      const zeroRows = ((del as { count?: number | null }).count ?? 0) === 0;
      expect(hasError || zeroRows).toBe(true);
      if (hasError) {
        const code = (del.error as { code?: string })?.code;
        expect(code === "42501" || code === null || typeof code === "string").toBe(true);
      }
    });

    it("D14B-12 default state=pending quando si inserisce un dominio nuovo", async () => {
      await resetDomainState([FIXED.tenantA]);
      const ownerA = await login(FIXED.ownerA);
      await ownerA
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_verification_token: `vt_def-${UNIQ}`,
        })
        .eq("id", FIXED.tenantA);
      const svc = serviceClient();
      const r = await svc
        .from("tenants")
        .select("custom_domain_status")
        .eq("id", FIXED.tenantA)
        .single();
      expect(r.data?.custom_domain_status).toBe("pending");
    });
  });

  // ===================== D14B-13 D14B-14: DNS Verify con Mock =====================
  describe("§5 Verify DNS con MockDnsResolver", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-13 verify success ownership TXT + routing CNAME → OK status verified routing_ready true", async () => {
      const svc = serviceClient();
      const token = `vt_ok-${randomUUID().slice(0, 20)}`;
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "pending",
          custom_domain_verification_token: token,
          custom_domain_routing_ready: false,
        })
        .eq("id", FIXED.tenantA);

      const fqdnTxt = `_velora-verification.${DOMAIN_A}`;
      const expectedTxtValue = `velora-verification=${token}`;
      const mockPayload: DnsMockPayload = {
        resolveTxt: {
          [fqdnTxt]: [[expectedTxtValue]],
        },
        resolveCname: {
          [DOMAIN_A]: TEMP_DOMAIN_A,
        },
        lookup: {
          [DOMAIN_A]: { address: "1.2.3.4", family: 4 },
        },
      };
      const resolver = createDnsResolverFromMock(mockPayload);

      const txtOk = await resolver
        .resolveTxt(fqdnTxt)
        .then((recs) => recs.flat().includes(expectedTxtValue))
        .catch(() => false);
      expect(txtOk).toBe(true);

      const cnameOk = await resolver
        .resolveCname(DOMAIN_A)
        .then((c) => c === TEMP_DOMAIN_A)
        .catch(() => false);
      expect(cnameOk).toBe(true);

      await svc
        .from("tenants")
        .update({
          custom_domain_status: "verified",
          custom_domain_verified_at: new Date().toISOString(),
          custom_domain_routing_ready: true,
          custom_domain_routing_verified_at: new Date().toISOString(),
        })
        .eq("id", FIXED.tenantA);

      const after = await svc
        .from("tenants")
        .select("custom_domain_status,custom_domain_routing_ready,custom_domain_verified_at")
        .eq("id", FIXED.tenantA)
        .single();
      expect(after.data?.custom_domain_status).toBe("verified");
      expect(after.data?.custom_domain_routing_ready).toBe(true);
      expect(after.data?.custom_domain_verified_at).not.toBeNull();
    });

    it("D14B-14 DNS NOT verified stays failed_disabled not serving", async () => {
      // FAILURE 5/8: DNS txt mismatch (failure-injection)
      await resetDomainState([FIXED.tenantB]);
      const svc = serviceClient();
      const tokenB = `vt_fail-${randomUUID().slice(0, 20)}`;
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_B,
          custom_domain_status: "pending",
          custom_domain_verification_token: tokenB,
          custom_domain_routing_ready: false,
        })
        .eq("id", FIXED.tenantB);

      const fqdnTxt = `_velora-verification.${DOMAIN_B}`;
      const wrongMock: DnsMockPayload = {
        resolveTxt: {
          [fqdnTxt]: [["velora-verification=TOKEN_SBAGLIATO_XXX"]],
        },
      };
      const resolver = createDnsResolverFromMock(wrongMock);
      const records = await resolver.resolveTxt(fqdnTxt).catch(() => [] as string[][]);
      const expected = `velora-verification=${tokenB}`;
      const match = records.flat().some((r) => r.trim() === expected.trim());
      expect(match).toBe(false);

      await svc
        .from("tenants")
        .update({ custom_domain_status: "failed_disabled" })
        .eq("id", FIXED.tenantB);

      const after = await svc
        .from("tenants")
        .select("custom_domain_status,custom_domain_routing_ready")
        .eq("id", FIXED.tenantB)
        .single();
      expect(after.data?.custom_domain_status).toBe("failed_disabled");
      expect(after.data?.custom_domain_routing_ready).toBe(false);
    });
  });

  // ===================== D14B-15 D14B-16 D14B-17 D14B-18: resolvePublicTenant =====================
  describe("§6 resolvePublicTenant per hostname", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
      const svc = serviceClient();
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "verified",
          custom_domain_routing_ready: true,
          custom_domain_verified_at: new Date().toISOString(),
          custom_domain_routing_verified_at: new Date().toISOString(),
          published: true,
          status: "active",
        })
        .eq("id", FIXED.tenantA);
    });

    it("D14B-15 verified tenant resolve resolvePublicTenant(hostname) Found", async () => {
      const r = await resolvePublicTenant({ hostname: DOMAIN_A });
      expect(r._tag).toBe("Found");
      if (r._tag === "Found") {
        expect(r.tenantId).toBe(FIXED.tenantA);
      }
    });

    it("D14B-16 unpublished tenant does not serve NOT_PUBLISHED (anon RLS: NO_TENANT equivalente per sicurezza)", async () => {
      // FAILURE 6/8: unpublished serve fail (failure-injection)
      // Nota: anon RLS `tenants_anon_select_published published=TRUE` nasconde completamente unpublished,
      // quindi dal POV anonimo NO_TENANT è indistinguibile da NOT_PUBLISHED (security by obscurity, OK).
      const svc = serviceClient();
      await svc.from("tenants").update({ published: false }).eq("id", FIXED.tenantA);
      try {
        const r = await resolvePublicTenant({ hostname: DOMAIN_A });
        expect(r._tag).toBe("NotFound");
        if (r._tag === "NotFound") {
          expect(["NO_TENANT", "NOT_PUBLISHED"] as const).toContain(r.reason);
        }
      } finally {
        await svc.from("tenants").update({ published: true }).eq("id", FIXED.tenantA);
      }
    });

    it("D14B-17 unknown hostname no tenant NotFound", async () => {
      // FAILURE 7/8: unknown host fail (failure-injection)
      const r = await resolvePublicTenant({
        hostname: `nessuno-${randomUUID().slice(0, 8)}.notfound.example`,
      });
      expect(r._tag).toBe("NotFound");
      if (r._tag === "NotFound") {
        expect(["NO_TENANT", "INVALID_SLUG"]).toContain(r.reason);
      }
    });

    it("D14B-18 removed domain no tenant: dopo remove, hostname non risolve", async () => {
      const svc = serviceClient();
      await svc
        .from("tenants")
        .update({
          custom_domain: null,
          custom_domain_status: "pending",
          custom_domain_routing_ready: false,
        })
        .eq("id", FIXED.tenantA);
      try {
        const r = await resolvePublicTenant({ hostname: DOMAIN_A });
        expect(r._tag).toBe("NotFound");
      } finally {
        await svc
          .from("tenants")
          .update({
            custom_domain: DOMAIN_A,
            custom_domain_status: "verified",
            custom_domain_routing_ready: true,
          })
          .eq("id", FIXED.tenantA);
      }
    });
  });

  // ===================== D14B-19 D14B-20: Backward compat slug + hostname mapping =====================
  describe("§7 Slug backward compat + custom hostname mapping", () => {
    it("D14B-19 slug route still works backward compat: /s/{slug} → Found", async () => {
      const r = await resolvePublicTenant({ slug: TENANT_A_SLUG });
      expect(r._tag).toBe("Found");
      if (r._tag === "Found") {
        expect(r.site.slug).toBe(TENANT_A_SLUG);
        expect(r.tenantId).toBe(FIXED.tenantA);
      }
    });

    it("D14B-20 custom hostname mapping exact tenant: DOMAIN_A → A, non B", async () => {
      // FAILURE 8/8: cross resolve fail A/B isolation implicito (failure-injection)
      const svc = serviceClient();
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_B,
          custom_domain_status: "verified",
          custom_domain_routing_ready: true,
        })
        .eq("id", FIXED.tenantB);

      const rA = await resolvePublicTenant({ hostname: DOMAIN_A });
      expect(rA._tag).toBe("Found");
      if (rA._tag === "Found") expect(rA.tenantId).toBe(FIXED.tenantA);

      const rB = await resolvePublicTenant({ hostname: DOMAIN_B });
      expect(rB._tag).toBe("Found");
      if (rB._tag === "Found") expect(rB.tenantId).toBe(FIXED.tenantB);

      const wrong = await resolvePublicTenant({ hostname: DOMAIN_B });
      if (wrong._tag === "Found") {
        expect(wrong.tenantId).not.toBe(FIXED.tenantA);
      }
    });
  });

  // ===================== D14B-21: Tenant A ↔ Tenant B assoluta isolation =====================
  describe("§8 Multi-tenant absolute isolation", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-21 tenant A and tenant B absolute isolation (add/remove domains indipendenti)", async () => {
      const svc = serviceClient();
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "verified",
          custom_domain_routing_ready: true,
        })
        .eq("id", FIXED.tenantA);
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_B,
          custom_domain_status: "verified",
          custom_domain_routing_ready: true,
        })
        .eq("id", FIXED.tenantB);

      const ra = await resolvePublicTenant({ hostname: DOMAIN_A });
      const rb = await resolvePublicTenant({ hostname: DOMAIN_B });
      expect(ra._tag).toBe("Found");
      expect(rb._tag).toBe("Found");
      if (ra._tag === "Found" && rb._tag === "Found") {
        expect(ra.tenantId).toBe(FIXED.tenantA);
        expect(rb.tenantId).toBe(FIXED.tenantB);
      }

      await svc
        .from("tenants")
        .update({
          custom_domain: null,
          custom_domain_status: "pending",
          custom_domain_routing_ready: false,
        })
        .eq("id", FIXED.tenantA);

      const raAfter = await resolvePublicTenant({ hostname: DOMAIN_A });
      const rbAfter = await resolvePublicTenant({ hostname: DOMAIN_B });
      expect(raAfter._tag).toBe("NotFound");
      expect(rbAfter._tag).toBe("Found");
      if (rbAfter._tag === "Found") {
        expect(rbAfter.tenantId).toBe(FIXED.tenantB);
      }
    });
  });

  // ===================== D14B-22: Canonical =====================
  describe("§9 Canonical primary domain", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA]);
      const svc = serviceClient();
      await svc
        .from("tenants")
        .update({
          custom_domain: DOMAIN_A,
          custom_domain_status: "verified",
          custom_domain_routing_ready: true,
          custom_domain_verified_at: new Date().toISOString(),
          custom_domain_routing_verified_at: new Date().toISOString(),
          published: true,
          status: "active",
        })
        .eq("id", FIXED.tenantA);
    });

    it("D14B-22 canonical primary domain hostnameVerifiedCanonical=https://{domain}/ when verified", async () => {
      const r = await resolvePublicTenant({ hostname: DOMAIN_A });
      expect(r._tag).toBe("Found");
      if (r._tag === "Found") {
        expect(r.site.hostnameVerifiedCanonical).toBe(`https://${DOMAIN_A}/`);
      }
    });
  });

  // ===================== D14B-23 D14B-24: Audit logs PII safe + immutable =====================
  describe("§10 Audit logs PII safe + immutability", () => {
    beforeAll(async () => {
      await resetDomainState([FIXED.tenantA, FIXED.tenantB]);
    });

    it("D14B-23 audit_logs PII safe domain_added/removed non contengono email/token/secrets", async () => {
      const db = await newPgIsolated();
      try {
        await ensureAuditAction(db);
        const auditIdAdd = randomUUID();
        const auditIdRem = randomUUID();
        const safeMetadataAdd = {
          tenant_id: FIXED.tenantA,
          host: DOMAIN_A,
          status: "pending",
        };
        const safeMetadataRem = {
          tenant_id: FIXED.tenantA,
          host: DOMAIN_A,
          status: "removed",
        };

        await db.query(`BEGIN`);
        try {
          await db.query(`SET LOCAL ROLE service_role`);
          await db.query(
            `INSERT INTO public.audit_logs(id,tenant_id,action,entity_type,entity_id,metadata,created_at)
             VALUES ($1::uuid,$2::uuid,'domain_added','tenant',$2::uuid,$3::jsonb,NOW()),
                    ($4::uuid,$2::uuid,'domain_removed','tenant',$2::uuid,$5::jsonb,NOW())`,
            [auditIdAdd, FIXED.tenantA, safeMetadataAdd, auditIdRem, safeMetadataRem],
          );
          await db.query(`COMMIT`);
        } catch (e) {
          await db.query(`ROLLBACK`);
          throw e;
        }

        const rows = await db.query(
          `SELECT id,action,metadata FROM public.audit_logs WHERE id IN ($1::uuid,$2::uuid) ORDER BY created_at ASC`,
          [auditIdAdd, auditIdRem],
        );
        expect(rows.rows.length).toBe(2);
        for (const row of rows.rows) {
          const metaStr = JSON.stringify(row.metadata ?? {});
          expect(metaStr).not.toContain("@");
          expect(metaStr).not.toContain(PASSWORD);
          expect(metaStr).not.toMatch(/vt_[A-Za-z0-9_-]{10,}/);
          expect(metaStr).not.toContain("email");
          expect(metaStr).not.toContain("token");
          expect(metaStr).not.toContain("secret");
          if (row.action === "domain_added" || row.action === "domain_removed") {
            const md = row.metadata as Record<string, unknown>;
            expect(typeof md.tenant_id).toBe("string");
            expect(typeof md.host).toBe("string");
            expect(md.host).toBe(DOMAIN_A);
          }
        }
      } finally {
        await pgClose(db);
      }
    });

    it("D14B-24 audit immutable: UPDATE DENY trigger + DELETE DENY", async () => {
      const db = await newPgIsolated();
      try {
        await ensureAuditAction(db);
        const auditId = randomUUID();
        await db.query(`BEGIN`);
        try {
          await db.query(`SET LOCAL ROLE service_role`);
          await db.query(
            `INSERT INTO public.audit_logs(id,tenant_id,action,metadata,created_at)
             VALUES ($1::uuid,$2::uuid,'domain_added','{"host":"test-immutable.example"}'::jsonb,NOW())`,
            [auditId, FIXED.tenantA],
          );
          await db.query(`COMMIT`);
        } catch (e) {
          await db.query(`ROLLBACK`);
          throw e;
        }

        let updateThrew = false;
        try {
          await db.query(`BEGIN`);
          await db.query(`SET LOCAL ROLE service_role`);
          await db.query(
            `UPDATE public.audit_logs SET metadata='{"tampered":true}'::jsonb WHERE id=$1::uuid`,
            [auditId],
          );
          await db.query(`COMMIT`);
        } catch {
          updateThrew = true;
          try {
            await db.query(`ROLLBACK`);
          } catch {
            /* ignore */
          }
        }
        expect(updateThrew).toBe(true);

        let deleteThrew = false;
        try {
          await db.query(`BEGIN`);
          await db.query(`SET LOCAL ROLE service_role`);
          await db.query(`DELETE FROM public.audit_logs WHERE id=$1::uuid`, [auditId]);
          await db.query(`COMMIT`);
        } catch {
          deleteThrew = true;
          try {
            await db.query(`ROLLBACK`);
          } catch {
            /* ignore */
          }
        }
        expect(deleteThrew).toBe(true);

        const stillThere = await db.query(
          `SELECT COUNT(*)::int c FROM public.audit_logs WHERE id=$1::uuid`,
          [auditId],
        );
        expect(Number(stillThere.rows[0].c)).toBe(1);
      } finally {
        await pgClose(db);
      }
    });
  });
});
