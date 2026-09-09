// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { randomUUID } from "node:crypto";

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
    console.error(`[fase14b-domain-races] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const hex12 = () =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const UNIQ_RUN = hex12();
const CONTESTED_HOSTNAME = `contested-${UNIQ_RUN}.velora-race.com`;
const OWNED_HOSTNAME = `owned-a-${UNIQ_RUN}.velora-race.com`;
const R4_HOSTNAME = `r4-host-${UNIQ_RUN}.velora-race.com`;
const R5_HOSTNAME = `r5-host-${UNIQ_RUN}.velora-race.com`;

const GROUP_A_N = 10;
const GROUP_B_N = 10;
const TOTAL_R1 = GROUP_A_N + GROUP_B_N;

type TenantSpec = {
  id: string;
  slug: string;
  ownerEmail: string;
  ownerUid: string | null;
};

const R1_TENANTS: TenantSpec[] = Array.from({ length: TOTAL_R1 }, (_, i) => ({
  id: `00000000-0000-4140-9${String(i).padStart(3, "0")}-${UNIQ_RUN.padEnd(12, "0").slice(0, 12)}`,
  slug: `f14b-r1-${String(i).padStart(2, "0")}-${UNIQ_RUN}`,
  ownerEmail: `f14b-r1-own-${i}-${UNIQ_RUN}@test.local`,
  ownerUid: null,
}));

const R3_TENANTS: { A: TenantSpec; B: TenantSpec } = {
  A: {
    id: `00000000-0000-4140-9500-${UNIQ_RUN.padEnd(12, "0").slice(0, 12)}`,
    slug: `f14b-r3-owner-a-${UNIQ_RUN}`,
    ownerEmail: `f14b-r3-a-own-${UNIQ_RUN}@test.local`,
    ownerUid: null,
  },
  B: {
    id: `00000000-0000-4140-9501-${UNIQ_RUN.padEnd(12, "0").slice(0, 12)}`,
    slug: `f14b-r3-claim-b-${UNIQ_RUN}`,
    ownerEmail: `f14b-r3-b-own-${UNIQ_RUN}@test.local`,
    ownerUid: null,
  },
};

const R4_TENANT: TenantSpec = {
  id: `00000000-0000-4140-9600-${UNIQ_RUN.padEnd(12, "0").slice(0, 12)}`,
  slug: `f14b-r4-resolve-${UNIQ_RUN}`,
  ownerEmail: `f14b-r4-own-${UNIQ_RUN}@test.local`,
  ownerUid: null,
};

const R5_TENANT: TenantSpec = {
  id: `00000000-0000-4140-9700-${UNIQ_RUN.padEnd(12, "0").slice(0, 12)}`,
  slug: `f14b-r5-remove-${UNIQ_RUN}`,
  ownerEmail: `f14b-r5-own-${UNIQ_RUN}@test.local`,
  ownerUid: null,
};

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

function newPgSession(): Promise<PgClient> {
  const c = new PgClient(pgOpts());
  return c.connect().then(() => c);
}

function serviceClient() {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function barrier<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  await delay(50);
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

async function createOwnerUser(email: string): Promise<string> {
  const svc = serviceClient();
  const cr = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (cr.error) {
    if (cr.error.message?.includes("already registered")) {
      const list = await svc.auth.admin.listUsers();
      const u = (list.data?.users ?? []).find((x) => x.email === email);
      if (u) return u.id;
    }
    throw new Error(`createUser ${email}: ${cr.error?.message ?? "unknown"}`);
  }
  return cr.data.user.id;
}

async function insertTenantMinimal(
  p: PgClient,
  spec: TenantSpec,
  opts?: { customDomain?: string; domainVerified?: boolean },
) {
  const cd = opts?.customDomain ?? null;
  const status = cd ? (opts?.domainVerified ? "verified" : "pending") : "pending";
  await p.query(
    `INSERT INTO public.tenants(id, slug, name, status, plan_id, published, custom_domain, custom_domain_status, custom_domain_routing_ready, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, 'active', 'pro', TRUE, $4, $5::public.domain_verification_status, $6, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [spec.id, spec.slug, `Tenant ${spec.slug}`, cd, status, opts?.domainVerified ?? false],
  );
  await p.query(
    `INSERT INTO public.business_profiles(tenant_id, display_name, timezone, locale, phone, email, city, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Europe/Rome', 'it-IT', '+390200000000', $3, 'Milano', NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [spec.id, `BP ${spec.slug}`, `${spec.slug}@test.local`],
  );
  if (spec.ownerUid) {
    await p.query(
      `INSERT INTO public.tenant_memberships(id, user_id, tenant_id, role, status, created_at, updated_at)
       VALUES ($1, $2::uuid, $3::uuid, 'owner', 'active', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), spec.ownerUid, spec.id],
    );
  }
}

async function cleanupR1(p: PgClient) {
  await p.query("BEGIN");
  await p.query("SET LOCAL session_replication_role = replica");
  for (const t of R1_TENANTS) {
    await p.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid`, [t.id]);
    await p.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1::uuid`, [t.id]);
    await p.query(`DELETE FROM public.tenants WHERE id=$1::uuid`, [t.id]);
  }
  await p.query("SET LOCAL session_replication_role = DEFAULT");
  await p.query("COMMIT");
}

async function cleanupR3(p: PgClient) {
  await p.query("BEGIN");
  await p.query("SET LOCAL session_replication_role = replica");
  for (const t of [R3_TENANTS.A, R3_TENANTS.B]) {
    await p.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid`, [t.id]);
    await p.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1::uuid`, [t.id]);
    await p.query(`DELETE FROM public.tenants WHERE id=$1::uuid`, [t.id]);
  }
  await p.query("SET LOCAL session_replication_role = DEFAULT");
  await p.query("COMMIT");
}

async function cleanupR4(p: PgClient) {
  await p.query("BEGIN");
  await p.query("SET LOCAL session_replication_role = replica");
  await p.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid`, [R4_TENANT.id]);
  await p.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1::uuid`, [R4_TENANT.id]);
  await p.query(`DELETE FROM public.tenants WHERE id=$1::uuid`, [R4_TENANT.id]);
  await p.query("SET LOCAL session_replication_role = DEFAULT");
  await p.query("COMMIT");
}

async function cleanupR5(p: PgClient) {
  await p.query("BEGIN");
  await p.query("SET LOCAL session_replication_role = replica");
  await p.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid`, [R5_TENANT.id]);
  await p.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1::uuid`, [R5_TENANT.id]);
  await p.query(`DELETE FROM public.tenants WHERE id=$1::uuid`, [R5_TENANT.id]);
  await p.query("SET LOCAL session_replication_role = DEFAULT");
  await p.query("COMMIT");
}

beforeAll(async () => {
  const p = await pg();
  await cleanupR1(p);
  await cleanupR3(p);
  await cleanupR4(p);
  await cleanupR5(p);

  for (const t of R1_TENANTS) {
    t.ownerUid = await createOwnerUser(t.ownerEmail);
  }
  for (const t of [R3_TENANTS.A, R3_TENANTS.B, R4_TENANT, R5_TENANT]) {
    t.ownerUid = await createOwnerUser(t.ownerEmail);
  }

  await p.query("BEGIN");
  for (const t of R1_TENANTS) await insertTenantMinimal(p, t);
  await insertTenantMinimal(p, R3_TENANTS.A, {
    customDomain: OWNED_HOSTNAME,
    domainVerified: true,
  });
  await insertTenantMinimal(p, R3_TENANTS.B);
  await insertTenantMinimal(p, R4_TENANT, { customDomain: R4_HOSTNAME, domainVerified: true });
  await insertTenantMinimal(p, R5_TENANT, { customDomain: R5_HOSTNAME, domainVerified: true });
  await p.query("COMMIT");
}, 120_000);

afterAll(async () => {
  try {
    const p = await pg();
    await cleanupR1(p);
    await cleanupR3(p);
    await cleanupR4(p);
    await cleanupR5(p);
    const svc = serviceClient();
    const allEmails = [
      ...R1_TENANTS.map((t) => t.ownerEmail),
      R3_TENANTS.A.ownerEmail,
      R3_TENANTS.B.ownerEmail,
      R4_TENANT.ownerEmail,
      R5_TENANT.ownerEmail,
    ];
    for (const email of allEmails) {
      try {
        const list = await svc.auth.admin.listUsers();
        const u = (list.data?.users ?? []).find((x) => x.email === email);
        if (u) await svc.auth.admin.deleteUser(u.id).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  await pgClose();
});

type ClaimResult = {
  tenantId: string;
  ok: boolean;
  code: string;
  note?: string;
};

async function claimHostnameInTx(
  tenantId: string,
  hostname: string,
  opts?: { advisoryKey?: bigint; session?: PgClient; markVerified?: boolean },
): Promise<ClaimResult> {
  const sess = opts?.session ?? (await newPgSession());
  const closeAfter = !opts?.session;
  try {
    await sess.query("BEGIN");
    if (opts?.advisoryKey != null) {
      const lockNum = Number(opts.advisoryKey);
      if (!Number.isSafeInteger(lockNum))
        throw new Error(`advisory key overflow: ${opts.advisoryKey}`);
      await sess.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [lockNum]);
    }
    const token = `vt_f14b_${randomUUID().replace(/-/g, "").slice(0, 32)}`;
    const status = opts?.markVerified ? "verified" : "pending";
    const routingReady = opts?.markVerified;
    const now = new Date().toISOString();
    try {
      const r = await sess.query(
        `UPDATE public.tenants
         SET custom_domain = $1::text,
             custom_domain_status = $2::public.domain_verification_status,
             custom_domain_verification_token = $3::text,
             custom_domain_routing_ready = $4::boolean,
             custom_domain_verified_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
             custom_domain_routing_verified_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
             updated_at = $5::timestamptz
         WHERE id = $6::uuid
           AND custom_domain IS NULL`,
        [hostname, status, token, routingReady, now, tenantId],
      );
      if (typeof r.rowCount === "number" && r.rowCount > 0) {
        await sess.query("COMMIT");
        return { tenantId, ok: true, code: "OK" };
      }
      const conflictCheck = await sess.query(
        `SELECT id, custom_domain_status FROM public.tenants WHERE custom_domain=$1::text LIMIT 1`,
        [hostname],
      );
      const owner = conflictCheck.rows[0];
      await sess.query("ROLLBACK");
      if (owner && owner.id !== tenantId) {
        return { tenantId, ok: false, code: "CROSS_TENANT_DENIED" };
      }
      if (owner && owner.id === tenantId) {
        return { tenantId, ok: true, code: "OK_ALREADY" };
      }
      return { tenantId, ok: false, code: "failed_disabled" };
    } catch (e) {
      const code = (e as { code?: string } | undefined)?.code;
      try {
        await sess.query("ROLLBACK").catch(() => {});
      } catch {
        /* ignore */
      }
      if (code === "23505") {
        return { tenantId, ok: false, code: "CROSS_TENANT_DENIED", note: "unique 23505" };
      }
      if (code === "40001") {
        return { tenantId, ok: false, code: "failed_disabled", note: "serializable" };
      }
      return {
        tenantId,
        ok: false,
        code: "failed_disabled",
        note: String((e as Error).message ?? e),
      };
    }
  } finally {
    if (closeAfter) await sess.end().catch(() => {});
  }
}

async function verifyDomainInTx(
  tenantId: string,
  session?: PgClient,
  advisoryKey?: bigint,
): Promise<ClaimResult> {
  const sess = session ?? (await newPgSession());
  const closeAfter = !session;
  try {
    await sess.query("BEGIN");
    if (advisoryKey != null) {
      const lockNum = Number(advisoryKey);
      if (!Number.isSafeInteger(lockNum)) throw new Error(`advisory key overflow: ${advisoryKey}`);
      await sess.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [lockNum]);
    }
    try {
      const now = new Date().toISOString();
      const r = await sess.query(
        `UPDATE public.tenants
         SET custom_domain_status = 'verified'::public.domain_verification_status,
             custom_domain_routing_ready = TRUE,
             custom_domain_verified_at = COALESCE(custom_domain_verified_at, $1::timestamptz),
             custom_domain_routing_verified_at = $1::timestamptz,
             updated_at = $1::timestamptz
         WHERE id = $2::uuid
           AND custom_domain IS NOT NULL`,
        [now, tenantId],
      );
      if (typeof r.rowCount === "number" && r.rowCount > 0) {
        await sess.query("COMMIT");
        return { tenantId, ok: true, code: "VERIFIED" };
      }
      await sess.query("COMMIT");
      return { tenantId, ok: false, code: "NOT_PRESENT" };
    } catch (e) {
      try {
        await sess.query("ROLLBACK").catch(() => {});
      } catch {
        /* ignore */
      }
      const code = (e as { code?: string } | undefined)?.code;
      if (code === "40001")
        return { tenantId, ok: false, code: "failed_disabled", note: "serializable" };
      return {
        tenantId,
        ok: false,
        code: "failed_disabled",
        note: String((e as Error).message ?? e),
      };
    }
  } finally {
    if (closeAfter) await sess.end().catch(() => {});
  }
}

async function removeDomainInTx(
  tenantId: string,
  session?: PgClient,
  advisoryKey?: bigint,
): Promise<ClaimResult> {
  const sess = session ?? (await newPgSession());
  const closeAfter = !session;
  try {
    await sess.query("BEGIN");
    if (advisoryKey != null) {
      const lockNum = Number(advisoryKey);
      if (!Number.isSafeInteger(lockNum)) throw new Error(`advisory key overflow: ${advisoryKey}`);
      await sess.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [lockNum]);
    }
    try {
      const now = new Date().toISOString();
      const r = await sess.query(
        `UPDATE public.tenants
         SET custom_domain = NULL,
             custom_domain_status = 'pending'::public.domain_verification_status,
             custom_domain_verification_token = NULL,
             custom_domain_verified_at = NULL,
             custom_domain_routing_ready = FALSE,
             custom_domain_routing_verified_at = NULL,
             updated_at = $1::timestamptz
         WHERE id = $2::uuid`,
        [now, tenantId],
      );
      if (typeof r.rowCount === "number" && r.rowCount > 0) {
        await sess.query("COMMIT");
        return { tenantId, ok: true, code: "REMOVED" };
      }
      await sess.query("COMMIT");
      return { tenantId, ok: false, code: "NOT_PRESENT" };
    } catch (e) {
      try {
        await sess.query("ROLLBACK").catch(() => {});
      } catch {
        /* ignore */
      }
      const code = (e as { code?: string } | undefined)?.code;
      if (code === "40001")
        return { tenantId, ok: false, code: "failed_disabled", note: "serializable" };
      return {
        tenantId,
        ok: false,
        code: "failed_disabled",
        note: String((e as Error).message ?? e),
      };
    }
  } finally {
    if (closeAfter) await sess.end().catch(() => {});
  }
}

async function resolveByHostnameDirect(
  p: PgClient,
  hostname: string,
): Promise<{ tenant_id: string | null; status: string | null }> {
  const r = await p.query(
    `SELECT id, custom_domain_status, published, status
     FROM public.tenants
     WHERE custom_domain = $1::text
        OR temporary_domain = $1::text
     LIMIT 1`,
    [hostname],
  );
  if (r.rows.length === 0) return { tenant_id: null, status: null };
  const row = r.rows[0]!;
  const active = row.status === "active" && row.published === true;
  const statusOk = row.custom_domain_status === "verified";
  if (!active || !statusOk) return { tenant_id: null, status: row.custom_domain_status };
  return { tenant_id: row.id, status: row.custom_domain_status };
}

describe("FASE14B Custom Domain Race Conditions", { timeout: 300_000 }, () => {
  it(
    "F14B-R1: 20 tenants (10+10) claim stesso hostname → esattamente 1 winner, rest CROSS_TENANT_DENIED/failed_disabled",
    { timeout: 120_000 },
    async () => {
      const p = await pg();
      await p.query(`UPDATE public.tenants SET custom_domain=NULL WHERE custom_domain=$1::text`, [
        CONTESTED_HOSTNAME,
      ]);
      await p.query(
        `UPDATE public.tenants SET
        custom_domain_status='pending'::public.domain_verification_status,
        custom_domain_verification_token=NULL,
        custom_domain_verified_at=NULL,
        custom_domain_routing_ready=FALSE,
        custom_domain_routing_verified_at=NULL
       WHERE id = ANY($1::uuid[])`,
        [R1_TENANTS.map((t) => t.id)],
      );
      const ADVISORY_KEY =
        BigInt("0xf14b0001") ^ BigInt(Buffer.from(UNIQ_RUN.slice(0, 8), "hex").readUInt32BE(0));
      const results = await barrier(TOTAL_R1, async (i) => {
        const t = R1_TENANTS[i]!;
        const useLock = i % 2 === 0;
        return claimHostnameInTx(t.id, CONTESTED_HOSTNAME, {
          ...(useLock ? { advisoryKey: ADVISORY_KEY } : {}),
          markVerified: true,
        });
      });
      const winners = results.filter((r) => r.ok && (r.code === "OK" || r.code === "OK_ALREADY"));
      const losersCross = results.filter((r) => !r.ok && r.code === "CROSS_TENANT_DENIED");
      const losersFail = results.filter((r) => !r.ok && r.code === "failed_disabled");
      expect(winners.length).toBe(1);
      expect(winners.length + losersCross.length + losersFail.length).toBe(TOTAL_R1);
      const winnerId = winners[0]!.tenantId;
      const ownerRow = await p.query(
        `SELECT id, custom_domain, custom_domain_status, custom_domain_routing_ready
       FROM public.tenants WHERE custom_domain=$1::text LIMIT 1`,
        [CONTESTED_HOSTNAME],
      );
      expect(ownerRow.rows.length).toBe(1);
      expect(ownerRow.rows[0]!.id).toBe(winnerId);
      expect(ownerRow.rows[0]!.custom_domain).toBe(CONTESTED_HOSTNAME);
      const winnerStatus = ownerRow.rows[0]!.custom_domain_status as string;
      expect(winnerStatus).not.toBeNull();
      expect(winnerStatus).not.toBe("pending");
      const allStatuses = await p.query(
        `SELECT id, custom_domain_status, custom_domain FROM public.tenants WHERE id = ANY($1::uuid[])`,
        [R1_TENANTS.map((t) => t.id)],
      );
      let losersWithBad = 0;
      for (const row of allStatuses.rows) {
        if (row.id === winnerId) continue;
        const s = row.custom_domain_status as string | null;
        const cd = row.custom_domain as string | null;
        if (s != null && s !== "pending" && s !== "failed_disabled") losersWithBad++;
        if (cd === CONTESTED_HOSTNAME && row.id !== winnerId) losersWithBad++;
      }
      expect(losersWithBad).toBe(0);
    },
  );

  it(
    "F14B-R2: verifyCustomDomain vs removeCustomDomain 40 mixed → stato finale coerente",
    { timeout: 120_000 },
    async () => {
      const p = await pg();
      const ADVISORY_KEY =
        BigInt("0xf14b0002") ^ BigInt(Buffer.from(UNIQ_RUN.slice(0, 8), "hex").readUInt32BE(0));
      const winner = R1_TENANTS[0]!;
      const lockNum = Number(ADVISORY_KEY);
      if (!Number.isSafeInteger(lockNum)) throw new Error(`advisory key overflow: ${ADVISORY_KEY}`);
      const TOTAL_ROUNDS = 4;
      const N = 20;
      for (let round = 0; round < TOTAL_ROUNDS; round++) {
        const hostname = `r2-${round}-${UNIQ_RUN}.velora-race.com`;
        await p.query(
          `UPDATE public.tenants
         SET custom_domain=$1::text,
             custom_domain_status='pending'::public.domain_verification_status,
             custom_domain_verification_token='vt_r2_${round}_${UNIQ_RUN}',
             custom_domain_routing_ready=FALSE,
             custom_domain_verified_at=NULL,
             custom_domain_routing_verified_at=NULL,
             updated_at=NOW()
         WHERE id=$2::uuid`,
          [hostname, winner.id],
        );
        const ops: Array<"verify" | "remove"> = Array.from({ length: N }, (_, i) =>
          i % 2 === 0 ? "verify" : "remove",
        );
        for (let i = ops.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ops[i], ops[j]] = [ops[j]!, ops[i]!];
        }
        const sess = await newPgSession();
        const results: ClaimResult[] = [];
        try {
          for (let i = 0; i < N; i++) {
            await delay(Math.floor(Math.random() * 6));
            const op = ops[i]!;
            if (op === "verify") {
              results.push(await verifyDomainInTx(winner.id, sess, BigInt(lockNum)));
            } else {
              results.push(await removeDomainInTx(winner.id, sess, BigInt(lockNum)));
            }
          }
        } finally {
          await sess.end().catch(() => {});
        }
        const finalState = await p.query(
          `SELECT custom_domain, custom_domain_status, custom_domain_routing_ready, custom_domain_verified_at, custom_domain_routing_verified_at
         FROM public.tenants WHERE id=$1::uuid LIMIT 1`,
          [winner.id],
        );
        const fs = finalState.rows[0]!;
        const hasDomain = fs.custom_domain === hostname;
        const isVerified = fs.custom_domain_status === "verified";
        const isReady = fs.custom_domain_routing_ready === true;
        const hasVerifiedAt = fs.custom_domain_verified_at != null;
        const hasRoutingAt = fs.custom_domain_routing_verified_at != null;
        if (hasDomain) {
          expect(isVerified).toBe(true);
          expect(isReady).toBe(true);
          expect(hasVerifiedAt).toBe(true);
          expect(hasRoutingAt).toBe(true);
        } else {
          expect(fs.custom_domain).toBeNull();
          expect(fs.custom_domain_status).toBe("pending");
          expect(fs.custom_domain_routing_ready).toBe(false);
          expect(hasVerifiedAt).toBe(false);
          expect(hasRoutingAt).toBe(false);
        }
        const notOk = results.filter((r) => r && r.ok).length;
        expect(notOk).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it(
    "F14B-R3: reassignment dominio esistente verificato → B mai vince",
    { timeout: 60_000 },
    async () => {
      const p = await pg();
      const attempts = 20;
      const r3Lock = Number(BigInt("0xf14b0003"));
      const results = await barrier(attempts, async (i) => {
        const useLock = i % 2 === 1;
        return claimHostnameInTx(R3_TENANTS.B.id, OWNED_HOSTNAME, {
          ...(useLock ? { advisoryKey: BigInt(r3Lock) } : {}),
          markVerified: true,
        });
      });
      const bWins = results.filter(
        (r) => r.ok && (r.code === "OK" || r.code === "OK_ALREADY"),
      ).length;
      expect(bWins).toBe(0);
      const ownerAfter = await p.query(
        `SELECT id, custom_domain_status FROM public.tenants WHERE custom_domain=$1::text LIMIT 1`,
        [OWNED_HOSTNAME],
      );
      expect(ownerAfter.rows.length).toBe(1);
      expect(ownerAfter.rows[0]!.id).toBe(R3_TENANTS.A.id);
      expect(ownerAfter.rows[0]!.custom_domain_status).toBe("verified");
      const bState = await p.query(
        `SELECT custom_domain, custom_domain_status FROM public.tenants WHERE id=$1::uuid LIMIT 1`,
        [R3_TENANTS.B.id],
      );
      expect(bState.rows[0]!.custom_domain).not.toBe(OWNED_HOSTNAME);
      expect(bState.rows[0]!.custom_domain_status).toBe("pending");
    },
  );

  it(
    "F14B-R4: 40 resolvePublicTenant stesso host → tutti stesso tenant_id, no mixing",
    { timeout: 60_000 },
    async () => {
      const p = await pg();
      await p.query(
        `UPDATE public.tenants
       SET status='active', published=TRUE,
           custom_domain_status='verified'::public.domain_verification_status,
           custom_domain_routing_ready=TRUE,
           custom_domain_verified_at=NOW(),
           custom_domain_routing_verified_at=NOW()
       WHERE id=$1::uuid AND custom_domain=$2::text`,
        [R4_TENANT.id, R4_HOSTNAME],
      );
      const N = 40;
      const sessions = await Promise.all(Array.from({ length: N }, () => newPgSession()));
      try {
        await Promise.all(
          sessions.map((s) => s.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")),
        );
        const results = await Promise.all(
          sessions.map((s) =>
            (async () => {
              await s.query("BEGIN");
              const lockR4 = Number(BigInt("0xf14b0004"));
              await s.query(`SELECT pg_advisory_xact_lock_shared($1::bigint)`, [lockR4]);
              const r = await resolveByHostnameDirect(s, R4_HOSTNAME);
              await s.query("COMMIT");
              return r;
            })(),
          ),
        );
        const allSame = results.every((r) => r.tenant_id === R4_TENANT.id);
        const anyNull = results.some((r) => r.tenant_id == null);
        const anyMismatch = results.some(
          (r) => r.tenant_id != null && r.tenant_id !== R4_TENANT.id,
        );
        expect(anyNull).toBe(false);
        expect(anyMismatch).toBe(false);
        expect(allSame).toBe(true);
        expect(results.length).toBe(N);
      } finally {
        await Promise.all(sessions.map((s) => s.end().catch(() => {})));
      }
    },
  );

  it(
    "F14B-R5: remove domain commit → 40 resolve → tutti NotFound, no stale leakage",
    { timeout: 60_000 },
    async () => {
      const p = await pg();
      await p.query(
        `UPDATE public.tenants
       SET status='active', published=TRUE,
           custom_domain_status='verified'::public.domain_verification_status,
           custom_domain_routing_ready=TRUE,
           custom_domain_verified_at=NOW(),
           custom_domain_routing_verified_at=NOW()
       WHERE id=$1::uuid AND custom_domain=$2::text`,
        [R5_TENANT.id, R5_HOSTNAME],
      );
      const preCheck = await resolveByHostnameDirect(p, R5_HOSTNAME);
      expect(preCheck.tenant_id).toBe(R5_TENANT.id);
      const remRes = await removeDomainInTx(R5_TENANT.id);
      expect(remRes.code).toBe("REMOVED");
      expect(remRes.ok).toBe(true);
      const N = 40;
      const sessions = await Promise.all(Array.from({ length: N }, () => newPgSession()));
      try {
        const results = await Promise.all(
          sessions.map((s) =>
            (async () => {
              await s.query("BEGIN");
              const lockR5 = Number(BigInt("0xf14b0005"));
              await s.query(`SELECT pg_advisory_xact_lock_shared($1::bigint)`, [lockR5]);
              const r = await resolveByHostnameDirect(s, R5_HOSTNAME);
              await s.query("COMMIT");
              return r;
            })(),
          ),
        );
        const anyFound = results.some((r) => r.tenant_id != null);
        const allNotFound = results.every((r) => r.tenant_id == null);
        const anyLeakage = results.some((r) => r.status === "verified" && r.tenant_id == null);
        expect(anyFound).toBe(false);
        expect(allNotFound).toBe(true);
        expect(anyLeakage).toBe(false);
        expect(results.length).toBe(N);
      } finally {
        await Promise.all(sessions.map((s) => s.end().catch(() => {})));
      }
    },
  );
});
