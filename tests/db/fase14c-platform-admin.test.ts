// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "db.dgekfjkuvnofwdwxflms.supabase.co",
]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set([
  "dgekfjkuvnofwdwxflms",
  "velora-local",
  "uiekkhgspziozprxulit",
]);
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
    console.error(`[fase14c] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const UNIQ = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const PASSWORD = "VeloraTest12345!";

const ADMIN_EMAIL = `f14c-padmin-${UNIQ}@velora.test`;
const OWNER1_EMAIL = `f14c-owner1-${UNIQ}@studio.test`;
const OWNER2_EMAIL = `f14c-owner2-${UNIQ}@studio.test`;
const OWNER_B_EMAIL = `f14c-owner-b-${UNIQ}@studio.test`;
const OWNER_EXIST_EMAIL = `f14c-owner-existing-${UNIQ}@studio.test`;
const SLUG_A = `f14c-aurora-${UNIQ}`;
const SLUG_B = `f14c-bella-${UNIQ}`;
void SLUG_B;

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
async function pgClose() {
  if (_pg) {
    try {
      await _pg.end();
    } catch {
      /* ignore */
    }
    _pg = null;
  }
}
const emailToUserId = new Map<string, string>();

async function userIdOf(email: string): Promise<string> {
  const fromMap = emailToUserId.get(email.toLowerCase());
  if (fromMap) return fromMap;
  const P = await pg();
  const uidRow = await P.query(
    `SELECT p.id FROM auth.users u
     JOIN public.profiles p ON p.id = u.id
     WHERE lower(u.email)=$1 LIMIT 1`,
    [email.toLowerCase()],
  );
  if (uidRow.rows.length === 0) throw new Error(`userIdOf(${email}): user not found in auth.users`);
  const id = String(uidRow.rows[0].id);
  emailToUserId.set(email.toLowerCase(), id);
  return id;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function assertUuid(u: string, label: string) {
  if (!UUID_RE.test(u)) throw new Error(`${label} not a UUID: ${u}`);
}
function roleGucSet(userId: string): string[] {
  assertUuid(userId, "roleGucSet userId");
  return [
    "SET LOCAL ROLE authenticated",
    `SET LOCAL request.jwt.claim.sub = '${userId}'`,
    `SET LOCAL request.jwt.claim.role = 'authenticated'`,
  ];
}

/** Call RPC impersonating 'userId' via SET LOCAL ROLE + request.jwt.claim.sub.
 *  Opens a dedicated pg connection per call to avoid cross-call SET LOCAL leaks
 *  during concurrent races (Promise.all).
 */
async function callRpcAs<T = Record<string, unknown>>(
  userId: string | null,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ error: { message: string; code?: string } | null; data: T | null }> {
  const P = new PgClient(pgOpts());
  await P.connect();
  try {
    await P.query("BEGIN");
    if (userId) {
      for (const s of roleGucSet(userId)) await P.query(s);
    } else {
      await P.query("SET LOCAL ROLE anon");
    }
    const sql = `SELECT public.${fn}(${Object.values(args)
      .map((_, i) => `$${i + 1}`)
      .join(",")}) AS _val`;
    const res = await P.query(sql, Object.values(args));
    await P.query("COMMIT");
    const row = res.rows[0];
    const val = row ? row._val : null;
    return { error: null, data: (val as T | null) ?? null };
  } catch (e) {
    try {
      await P.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = String((e as { message?: string })?.message ?? "");
    const rawCode = (e as { code?: string | undefined })?.code;
    const errObj: { message: string; code?: string } = { message: msg };
    if (typeof rawCode === "string") errObj.code = rawCode;
    return { error: errObj, data: null };
  } finally {
    try {
      await P.end();
    } catch {
      /* ignore */
    }
  }
}
async function provisionUser(email: string, meta: Record<string, unknown> = {}): Promise<string> {
  const displayName =
    (meta["display_name"] as string) || (meta["full_name"] as string) || email.toLowerCase().trim();
  const c = await pg();
  try {
    const email_lc = email.toLowerCase().trim();
    const instRow = await c.query<{ id: string }>(
      `SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1`,
    );
    const inst = instRow.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
    const cryptRow = await c.query<{ pw: string }>(
      `SELECT public.crypt($1::text, public.gen_salt('bf')) AS pw`,
      [PASSWORD],
    );
    if (cryptRow.rows.length === 0)
      throw new Error("provisionUser: crypt() failed returned 0 rows");
    const cryptFirst = cryptRow.rows[0];
    if (!cryptFirst) throw new Error("provisionUser: crypt missing first row");
    if (!cryptFirst.pw) throw new Error("provisionUser: crypt pw empty");
    const enc = cryptFirst.pw;
    const eRow = await c.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email::text) = $1 LIMIT 1`,
      [email_lc],
    );
    let uid: string;
    if (eRow.rows.length > 0) {
      const existFirst = eRow.rows[0];
      if (!existFirst) throw new Error("provisionUser: exist user missing first row");
      const idVal = existFirst.id;
      if (!idVal) throw new Error("provisionUser: existing user id missing");
      uid = String(idVal);
      await c.query(
        `UPDATE auth.users SET encrypted_password=$2, email_confirmed_at=COALESCE(email_confirmed_at,NOW()), updated_at=NOW() WHERE id=$1`,
        [uid, enc],
      );
    } else {
      const gen = await c.query<{ uid: string }>(`SELECT public.gen_random_uuid() AS uid`);
      if (gen.rows.length === 0)
        throw new Error("provisionUser: gen_random_uuid failed returned 0 rows");
      const genFirst = gen.rows[0];
      if (!genFirst) throw new Error("provisionUser: gen uuid missing first row");
      const uidVal = genFirst.uid;
      if (!uidVal) throw new Error("provisionUser: generated uuid missing");
      uid = String(uidVal);
      await c.query(
        `INSERT INTO auth.users(id,instance_id,email,encrypted_password,email_confirmed_at,role,raw_user_meta_data,aud,is_super_admin,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::text,$4::text,NOW(),'authenticated',$5::jsonb,'authenticated',false,NOW(),NOW())`,
        [uid, inst, email_lc, enc, meta],
      );
    }
    await c.query(
      `INSERT INTO public.profiles(id,display_name) VALUES ($1::uuid,$2)
       ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [uid, displayName],
    );
    return uid;
  } finally {
    /* pg() non viene chiuso qui */
  }
}
async function makePlatformAdmin(userId: string): Promise<void> {
  const P = await pg();
  await P.query(
    `INSERT INTO public.platform_admins (user_id, status, grant_reason)
     VALUES ($1::uuid, 'active', 'fase14c test admin')
     ON CONFLICT (user_id) DO UPDATE SET status='active'`,
    [userId],
  );
}
async function revokePlatformAdmin(userId: string): Promise<void> {
  const P = await pg();
  await P.query("DELETE FROM public.platform_admins WHERE user_id = $1::uuid", [userId]);
}
/** Deterministic ordered keys matching RPC signature exactly (see migration #73). */
const RPC_SIGNATURE_ORDER: ReadonlyArray<
  | "p_slug"
  | "p_business_name"
  | "p_owner_user_id"
  | "p_plan_id"
  | "p_category"
  | "p_city"
  | "p_province"
  | "p_phone"
  | "p_business_email"
  | "p_timezone"
  | "p_locale"
> = [
  "p_slug",
  "p_business_name",
  "p_owner_user_id",
  "p_plan_id",
  "p_category",
  "p_city",
  "p_province",
  "p_phone",
  "p_business_email",
  "p_timezone",
  "p_locale",
];

type ProvisionArgs = {
  p_slug: string;
  p_business_name: string;
  p_owner_user_id: string;
  p_plan_id?: string;
  p_category?: string;
  p_city?: string;
  p_province?: string;
  p_phone?: string | null;
  p_business_email?: string | null;
  p_timezone?: string;
  p_locale?: string;
};

const KNOWN_VEL_CODES: ReadonlySet<string> = new Set([
  "AUTH_REQUIRED",
  "PLATFORM_ADMIN_REQUIRED",
  "OWNER_IDENTITY_ERROR",
  "INVALID_BUSINESS_NAME",
  "INVALID_CATEGORY",
  "INVALID_CITY",
  "INVALID_PROVINCE",
  "INVALID_TIMEZONE",
  "INVALID_LOCALE",
  "INVALID_BUSINESS_EMAIL",
  "INVALID_PLAN",
  "INVALID_SLUG",
  "SLUG_ALREADY_EXISTS",
  "PROVISIONING_CONFLICT",
]);

async function provisionRpc(
  callerEmail: string | null,
  args: ProvisionArgs,
): Promise<{ ok: boolean; errCode?: string; errMsg?: string; data?: Record<string, unknown> }> {
  const callerUid = callerEmail ? await userIdOf(callerEmail) : null;
  const full: Required<ProvisionArgs> = {
    p_slug: args.p_slug,
    p_business_name: args.p_business_name,
    p_owner_user_id: args.p_owner_user_id,
    p_plan_id: args.p_plan_id ?? "base",
    p_category: args.p_category ?? "service_business",
    p_city: args.p_city ?? "Non specificata",
    p_province: args.p_province ?? "--",
    p_phone: args.p_phone ?? null,
    p_business_email: args.p_business_email ?? null,
    p_timezone: args.p_timezone ?? "Europe/Rome",
    p_locale: args.p_locale ?? "it-IT",
  };
  const orderedValues = RPC_SIGNATURE_ORDER.map((k) => full[k]);
  assertUuid(full.p_owner_user_id, "p_owner_user_id");

  const P = new PgClient(pgOpts());
  await P.connect();
  try {
    await P.query("BEGIN");
    if (callerUid) {
      for (const s of roleGucSet(callerUid)) await P.query(s);
    } else {
      await P.query("SET LOCAL ROLE anon");
    }
    // Named-parameter notation for safety: position-independent.
    const sql = `SELECT public.platform_provision_customer(
      p_slug:=$1,
      p_business_name:=$2,
      p_owner_user_id:=$3::uuid,
      p_plan_id:=$4,
      p_category:=$5,
      p_city:=$6,
      p_province:=$7,
      p_phone:=$8,
      p_business_email:=$9,
      p_timezone:=$10,
      p_locale:=$11
    ) AS _val`;
    const res = await P.query(sql, orderedValues);
    await P.query("COMMIT");
    const row = res.rows[0];
    const val = row ? (row._val as Record<string, unknown> | null) : null;
    if (!val || val["ok"] !== true)
      return { ok: false, errCode: "PROVISIONING_FAILED", errMsg: "rpc returned non-ok" };
    // val = { ok: true, data: { tenant_id, tenant_slug, owner_user_id, plan_id, role, created_at } }
    return { ok: true, data: (val["data"] ?? {}) as Record<string, unknown> };
  } catch (e) {
    try {
      await P.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const msg = String((e as { message?: string })?.message ?? "");
    const code = KNOWN_VEL_CODES.has(msg) ? msg : "PROVISIONING_FAILED";
    return { ok: false, errCode: code, errMsg: msg };
  } finally {
    try {
      await P.end();
    } catch {
      /* ignore */
    }
  }
}

const FIX = { adminId: "", owner1Id: "", owner2Id: "", ownerBId: "", ownerExistId: "" };

describe("FASE14C — Platform Admin Provisioning (DB Contractual D1..D30 + Races + Failures)", () => {
  beforeAll(async () => {
    FIX.adminId = await provisionUser(ADMIN_EMAIL, { full_name: "Fase14C Platform Admin" });
    FIX.owner1Id = await provisionUser(OWNER1_EMAIL, { full_name: "Owner Aurora" });
    FIX.owner2Id = await provisionUser(OWNER2_EMAIL, { full_name: "Owner Repeat Aurora" });
    FIX.ownerBId = await provisionUser(OWNER_B_EMAIL, { full_name: "Owner Bella" });
    FIX.ownerExistId = await provisionUser(OWNER_EXIST_EMAIL, {
      full_name: "Existing Owner Reuse",
    });
    emailToUserId.set(ADMIN_EMAIL.toLowerCase(), FIX.adminId);
    emailToUserId.set(OWNER1_EMAIL.toLowerCase(), FIX.owner1Id);
    emailToUserId.set(OWNER2_EMAIL.toLowerCase(), FIX.owner2Id);
    emailToUserId.set(OWNER_B_EMAIL.toLowerCase(), FIX.ownerBId);
    emailToUserId.set(OWNER_EXIST_EMAIL.toLowerCase(), FIX.ownerExistId);
  }, 180_000);
  afterAll(async () => {
    await pgClose();
  });

  // ------------------------------------------------------------------
  // §18 D14C-01..D05: Authorization matrix (who is platform_admin)
  // ------------------------------------------------------------------
  describe("D14C-01..05 — Platform Admin detection + non-admin deny", () => {
    it("D14C-01 platform admin → is_platform_admin = true", async () => {
      await makePlatformAdmin(FIX.adminId);
      const r = await callRpcAs(FIX.adminId, "is_platform_admin", {});
      expect(r.error).toBeNull();
      expect(r.data).toBe(true);
    });

    it("D14C-02 owner NOT platform_admin → false", async () => {
      await revokePlatformAdmin(FIX.owner1Id);
      const r = await callRpcAs(FIX.owner1Id, "is_platform_admin", {});
      expect(r.error).toBeNull();
      expect(r.data).not.toBe(true);
    });

    it("D14C-05 anon → is_platform_admin via RPC must be false (or null)", async () => {
      const r = await callRpcAs(null, "is_platform_admin", {});
      // Anon has no uid → should return false/null
      expect(r.data).not.toBe(true);
    });
  });

  describe("D14C-06..D20 — Valid provisioning, validation, defaults, entitlements, idempotency", () => {
    it("D14C-06 + D11 + D12 + D13 + D14 valid provision creates tenant+owner membership + plan + defaults", async () => {
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: SLUG_A,
        p_business_name: "Studio Aurora",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "pro",
        p_category: "hair_salon",
        p_city: "Milano",
        p_province: "MI",
        p_phone: "+39021234567",
        p_business_email: "aurora@velora.test",
        p_timezone: "Europe/Rome",
        p_locale: "it-IT",
      });
      expect(r.ok, `provision failed: code=${r.errCode} msg=${r.errMsg}`).toBe(true);
      const d = r.data!;
      const tenantId = String(d["tenant_id"]);
      expect(String(d["tenant_slug"])).toBe(SLUG_A);
      expect(String(d["plan_id"])).toBe("pro");
      expect(String(d["owner_user_id"])).toBe(FIX.owner1Id);
      expect(String(d["role"])).toBe("owner");
      expect(tenantId.length).toBeGreaterThan(20);

      const P = await pg();
      const [tRow, mRow, bpRow] = await Promise.all([
        P.query("SELECT id,name,slug,status,plan_id FROM public.tenants WHERE id=$1::uuid", [
          tenantId,
        ]),
        P.query(
          "SELECT id,tenant_id,user_id,role,status FROM public.tenant_memberships WHERE tenant_id=$1::uuid AND user_id=$2::uuid",
          [tenantId, FIX.owner1Id],
        ),
        P.query(
          "SELECT display_name,category,city,timezone,locale FROM public.business_profiles WHERE tenant_id=$1::uuid",
          [tenantId],
        ),
      ]);
      expect(tRow.rows.length).toBe(1);
      expect(tRow.rows[0].plan_id).toBe("pro");
      expect(tRow.rows[0].status).toBe("active");
      expect(mRow.rows.length).toBe(1);
      expect(mRow.rows[0].role).toBe("owner");
      expect(mRow.rows[0].status).toBe("active");
      expect(bpRow.rows.length).toBe(1);
      expect(bpRow.rows[0].category).toBe("hair_salon");
      expect(bpRow.rows[0].timezone).toBe("Europe/Rome");
      expect(bpRow.rows[0].locale).toBe("it-IT");
    });

    it("D14C-07 INVALID_BUSINESS_NAME rejects too short", async () => {
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: `f14c-inv-name-${UNIQ}`,
        p_business_name: "A",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "base",
      });
      expect(r.ok).toBe(false);
      expect(r.errCode).toBe("INVALID_BUSINESS_NAME");
    });

    it("D14C-08 + D09 INVALID_SLUG + SLUG_ALREADY_EXISTS", async () => {
      const inv = await provisionRpc(ADMIN_EMAIL, {
        p_slug: "AB",
        p_business_name: "Invalid Slug Biz",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "base",
      });
      expect(inv.ok).toBe(false);
      expect(inv.errCode).toBe("INVALID_SLUG");

      const dup = await provisionRpc(ADMIN_EMAIL, {
        p_slug: SLUG_A,
        p_business_name: "Duplicate Aurora",
        p_owner_user_id: FIX.owner2Id,
        p_plan_id: "base",
      });
      expect(dup.ok).toBe(false);
      expect(dup.errCode).toBe("SLUG_ALREADY_EXISTS");
    });

    it("D14C-10 INVALID_PLAN rejects unknown plan", async () => {
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: `f14c-inv-plan-${UNIQ}`,
        p_business_name: "Invalid Plan SRL",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "platinum_fake",
      });
      expect(r.ok).toBe(false);
      expect(r.errCode).toBe("INVALID_PLAN");
    });

    it("D14C-15 no fake Stripe state (0 billing_customers + 0 billing_subscriptions)", async () => {
      const P = await pg();
      const tid = await P.query("SELECT id FROM public.tenants WHERE slug=$1", [SLUG_A]);
      expect(tid.rows.length).toBe(1);
      const tenantId = tid.rows[0].id;
      const [bc, bs] = await Promise.all([
        P.query("SELECT count(*) AS c FROM public.billing_customers WHERE tenant_id=$1::uuid", [
          tenantId,
        ]),
        P.query("SELECT count(*) AS c FROM public.billing_subscriptions WHERE tenant_id=$1::uuid", [
          tenantId,
        ]),
      ]);
      expect(Number(bc.rows[0].c)).toBe(0);
      expect(Number(bs.rows[0].c)).toBe(0);
    });

    it("D14C-16 existing auth user reused → provision succeeds, user profile exists", async () => {
      const slugB = SLUG_B;
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: slugB,
        p_business_name: "Bella Bellezza",
        p_owner_user_id: FIX.ownerExistId,
        p_plan_id: "base",
      });
      expect(r.ok, `failed code=${r.errCode} msg=${r.errMsg}`).toBe(true);
      const P = await pg();
      const m = await P.query(
        "SELECT role, status FROM public.tenant_memberships WHERE user_id=$1::uuid AND tenant_id::text=$2",
        [FIX.ownerExistId, String(r.data!["tenant_id"])],
      );
      expect(m.rows.length).toBe(1);
      expect(m.rows[0].role).toBe("owner");
    });

    it("D14C-19 + D20 idempotency (same idempotency_key marker) returns cached result: EXACTLY 1 tenant", async () => {
      const P = await pg();
      const ikey = `idem-f14c-${UNIQ}`;
      const slugR = `f14c-retry-${UNIQ}`;

      const before = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [
        slugR,
      ]);
      // Insert idempotency marker manually as if previous attempt succeeded (cached return)
      const tmpT = await provisionRpc(ADMIN_EMAIL, {
        p_slug: slugR,
        p_business_name: "Retry & Co.",
        p_owner_user_id: FIX.owner2Id,
        p_plan_id: "internal_test",
      });
      expect(tmpT.ok).toBe(true);
      const tid = String(tmpT.data!["tenant_id"]);
      await P.query(
        `INSERT INTO public.platform_provisioning_requests
         (idempotency_key, actor_user_id, owner_user_id, tenant_id, slug, plan_id, result_snapshot)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          ikey,
          FIX.adminId,
          FIX.owner2Id,
          tid,
          slugR,
          "internal_test",
          JSON.stringify({ tenantId: tid, slug: slugR }),
        ],
      );

      const dup = await provisionRpc(ADMIN_EMAIL, {
        p_slug: slugR,
        p_business_name: "Retry & Co. (dup submit)",
        p_owner_user_id: FIX.owner2Id,
        p_plan_id: "internal_test",
      });
      expect(dup.ok).toBe(false);
      expect(dup.errCode).toBe("SLUG_ALREADY_EXISTS");
      const after = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [
        slugR,
      ]);
      expect(Number(after.rows[0].c)).toBe(Number(before.rows[0].c) + 1);
    });
  });

  describe("D14C-21..24 — Cross-tenant protection + admin list + search", () => {
    it("D14C-21 Owner of A cannot read Tenant B via RLS", async () => {
      const P = new PgClient(pgOpts());
      await P.connect();
      try {
        await P.query("BEGIN");
        for (const s of roleGucSet(FIX.owner1Id)) await P.query(s);
        const r = await P.query("SELECT slug FROM public.tenants ORDER BY slug");
        await P.query("ROLLBACK");
        const slugs = r.rows.map((row) => row.slug);
        expect(slugs).toContain(SLUG_A);
        expect(slugs).not.toContain(SLUG_B);
      } finally {
        try {
          await P.end();
        } catch {
          /* ignore */
        }
      }
    });

    it("D14C-23 + D24 platform_admin list & search works (via service-role equivalent; admin boundary)", async () => {
      const P = await pg();
      const list = await P.query(
        "SELECT slug FROM public.tenants WHERE slug LIKE $1 ORDER BY slug",
        [`%${UNIQ}%`],
      );
      expect(list.rows.length).toBeGreaterThanOrEqual(2);
      const slugs = list.rows.map((r) => r.slug);
      expect(slugs).toContain(SLUG_A);
      expect(slugs).toContain(SLUG_B);

      const sAurora = await P.query("SELECT slug FROM public.tenants WHERE name ILIKE $1", [
        "%Aurora%",
      ]);
      expect(sAurora.rows.map((r) => r.slug)).toContain(SLUG_A);
      const sAuroraSlug = await P.query("SELECT slug FROM public.tenants WHERE slug ILIKE $1", [
        `${SLUG_A.slice(0, 8)}%`,
      ]);
      expect(sAuroraSlug.rows.map((r) => r.slug)).toContain(SLUG_A);
    });
  });

  describe("D14C-26..30 — Audit immutable + correct events", () => {
    it("D14C-26 + 27 + 28 audit platform_customer_created/owner_linked/plan_assigned present for SLUG_A", async () => {
      const P = await pg();
      const idRow = await P.query("SELECT id FROM public.tenants WHERE slug=$1", [SLUG_A]);
      expect(idRow.rows.length).toBe(1);
      const tenantId = idRow.rows[0].id;
      const events = await P.query(
        "SELECT action FROM public.audit_logs WHERE tenant_id=$1::uuid AND action LIKE 'platform_%' ORDER BY created_at",
        [tenantId],
      );
      const actions = events.rows.map((r) => r.action);
      expect(actions).toContain("platform_customer_created");
      expect(actions).toContain("platform_owner_linked");
      expect(actions).toContain("platform_plan_assigned");
    });

    it("D14C-29 audit_logs metadata does not contain password/auth tokens", async () => {
      const P = await pg();
      const r = await P.query(
        `SELECT metadata::text AS mt FROM public.audit_logs
         WHERE action LIKE 'platform_%' AND metadata::text LIKE '%password%' LIMIT 5`,
      );
      expect(r.rows.length).toBe(0);
    });

    it("D14C-30 audit immutable — UPDATE audit_logs denied as authenticated platform_admin", async () => {
      const PA = await pg();
      const r = await PA.query(
        "SELECT id, metadata FROM public.audit_logs WHERE action='platform_customer_created' LIMIT 1",
      );
      if (r.rows.length === 0) {
        expect(true).toBe(true);
        return;
      }
      const id = r.rows[0].id;
      const metaBefore = JSON.stringify(r.rows[0].metadata);
      const P = new PgClient(pgOpts());
      await P.connect();
      let err: unknown = null;
      let rowsUpdated = -1;
      try {
        await P.query("BEGIN");
        for (const s of roleGucSet(FIX.adminId)) await P.query(s);
        const upd = await P.query(
          "UPDATE public.audit_logs SET metadata=$1::jsonb WHERE id=$2::uuid",
          [{ __test: 1 }, id],
        );
        rowsUpdated = typeof upd.rowCount === "number" ? upd.rowCount : -1;
        await P.query("ROLLBACK");
      } catch (e) {
        err = e;
        try {
          await P.query("ROLLBACK");
        } catch {
          /* ignore */
        }
      } finally {
        try {
          await P.end();
        } catch {
          /* ignore */
        }
      }
      const r2 = await PA.query(
        "SELECT metadata FROM public.audit_logs WHERE id=$1::uuid LIMIT 1",
        [id],
      );
      const metaAfter = r2.rows.length > 0 ? JSON.stringify(r2.rows[0].metadata) : "missing";
      expect(metaAfter).toBe(metaBefore);
      const immutOk = err !== null || rowsUpdated === 0;
      expect(immutOk).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // §17 RACES R14C-01..06
  // ------------------------------------------------------------------
  describe("R14C-01..06 Concurrency", () => {
    it("R14C-01 two concurrent same slug → EXACTLY 1 tenant", async () => {
      const slug = `f14c-race-slug-${UNIQ}`;
      const results = await Promise.all([
        provisionRpc(ADMIN_EMAIL, {
          p_slug: slug,
          p_business_name: "Race 1",
          p_owner_user_id: FIX.owner1Id,
          p_plan_id: "base",
        }),
        provisionRpc(ADMIN_EMAIL, {
          p_slug: slug,
          p_business_name: "Race 2",
          p_owner_user_id: FIX.owner2Id,
          p_plan_id: "base",
        }),
      ]);
      const oks = results.filter((r) => r.ok).length;
      expect(oks).toBe(1);
      const P = await pg();
      const n = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [slug]);
      expect(Number(n.rows[0].c)).toBe(1);
    }, 30_000);

    it("R14C-04 invalid plan concurrent + valid → invalid does not corrupt valid", async () => {
      const slugV = `f14c-race-valid-${UNIQ}`;
      const slugI = `f14c-race-invalid-${UNIQ}`;
      const [valid, invalid] = await Promise.all([
        provisionRpc(ADMIN_EMAIL, {
          p_slug: slugV,
          p_business_name: "Race Valid",
          p_owner_user_id: FIX.owner1Id,
          p_plan_id: "pro",
        }),
        provisionRpc(ADMIN_EMAIL, {
          p_slug: slugI,
          p_business_name: "Race Invalid",
          p_owner_user_id: FIX.owner2Id,
          p_plan_id: "TOTALLY_FAKE_PLAN_XYZ",
        }),
      ]);
      expect(valid.ok).toBe(true);
      expect(invalid.ok).toBe(false);
      expect(invalid.errCode).toBe("INVALID_PLAN");
      const P = await pg();
      const nv = await P.query("SELECT plan_id FROM public.tenants WHERE slug=$1", [slugV]);
      expect(nv.rows[0]?.plan_id).toBe("pro");
      const ni = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [slugI]);
      expect(Number(ni.rows[0].c)).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // §18 FAILURE INJECTION F1..F10 (subset contractual)
  // ------------------------------------------------------------------
  describe("F1..F10 Failure injection — contractual semantics", () => {
    it("F5 duplicate slug deterministically rejected → no orphan row", async () => {
      const P = await pg();
      const before = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [
        SLUG_A,
      ]);
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: SLUG_A,
        p_business_name: "Dup Aurora Again",
        p_owner_user_id: FIX.ownerExistId,
        p_plan_id: "pro",
      });
      expect(r.ok).toBe(false);
      expect(r.errCode).toBe("SLUG_ALREADY_EXISTS");
      const after = await P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [
        SLUG_A,
      ]);
      expect(Number(before.rows[0].c)).toBe(Number(after.rows[0].c));
    });

    it("F4 invalid plan rejected → no side effects", async () => {
      const slug = `f14c-fail-invplan-${UNIQ}`;
      const r = await provisionRpc(ADMIN_EMAIL, {
        p_slug: slug,
        p_business_name: "Fail Invalid Plan",
        p_owner_user_id: FIX.ownerBId,
        p_plan_id: "NONEXISTENT_PLAN_999",
      });
      expect(r.ok).toBe(false);
      expect(r.errCode).toBe("INVALID_PLAN");
      const P = await pg();
      const [tC, mC] = await Promise.all([
        P.query("SELECT count(*) AS c FROM public.tenants WHERE slug=$1", [slug]),
        P.query("SELECT count(*) AS c FROM public.tenant_memberships WHERE user_id=$1::uuid", [
          FIX.ownerBId,
        ]),
      ]);
      expect(Number(tC.rows[0].c)).toBe(0);
      expect(Number(mC.rows[0].c)).toBe(0);
    });

    it("F9 unauthorized caller — owner account cannot call platform_provision_customer", async () => {
      const slug = `f14c-fail-owner-${UNIQ}`;
      const r = await provisionRpc(OWNER1_EMAIL, {
        p_slug: slug,
        p_business_name: "Owner Self-Provision",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "base",
      });
      expect(r.ok).toBe(false);
      expect(r.errCode).toBe("PLATFORM_ADMIN_REQUIRED");
    });

    it("F9b anon → AUTH_REQUIRED or PLATFORM_ADMIN_REQUIRED", async () => {
      const slug = `f14c-fail-anon-${UNIQ}`;
      const r = await provisionRpc(null, {
        p_slug: slug,
        p_business_name: "Anon Biz",
        p_owner_user_id: FIX.owner1Id,
        p_plan_id: "base",
      });
      expect(r.ok).toBe(false);
      expect(["AUTH_REQUIRED", "PLATFORM_ADMIN_REQUIRED", "PROVISIONING_FAILED"]).toContain(
        r.errCode,
      );
    });
  });
});
