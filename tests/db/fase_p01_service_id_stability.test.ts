// @vitest-environment node
// P0-1 FIX: Service Identity Stability across publish (SID tests)
import "dotenv/config";
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local"]);
const DEFAULT_LOCAL: Readonly<Record<string, string>> = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_PASSWORD: "postgres",
  SUPABASE_PROJECT_ID: "velora-local",
};
function envOr(k: string): string {
  const v = process.env[k];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[k];
  return typeof fb === "string" ? fb : "";
}
const host = envOr("SUPABASE_DB_HOST");
const pid = envOr("SUPABASE_PROJECT_ID");
if (!ALLOWED_DB_HOSTS.has(host) && !SAFE_PROJECT_IDS.has(pid)) {
  console.error("[sid-p01][unsafe]", { host, pid });
  process.exit(1);
}
function buildPgOpts() {
  const port = Number(envOr("SUPABASE_DB_PORT")) || 54322;
  const password = envOr("SUPABASE_DB_PASSWORD");
  return { host, user: "postgres", database: "postgres", password, port, ssl: false } as const;
}

const TEST_PW = "SidP01!Str0ngP4s5";
const TENANT_A = "fa6e0101-0000-4000-8000-000000000001";
const TENANT_B = "fa6e0102-0000-4000-8000-000000000002";
const TENANT_C = "fa6e0103-0000-4000-8000-000000000003"; // cross-injection
const OWNER_A = "p01-owner-a@velora-test.local";
const OWNER_B = "p01-owner-b@velora-test.local";

const TRANSIENT_RPCS = /* sql */ `
CREATE OR REPLACE FUNCTION public.p01_test_provision(p_email TEXT, p_password TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_iid UUID; v_id UUID; v_lc TEXT := lower(trim(p_email));
BEGIN
  v_iid := COALESCE((SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1), '00000000-0000-0000-0000-000000000000'::uuid);
  SELECT id INTO v_id FROM auth.users WHERE lower(email::text)=v_lc LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO auth.users(id,instance_id,email,encrypted_password,email_confirmed_at,role,raw_user_meta_data,aud,is_super_admin,created_at,updated_at)
    VALUES(public.gen_random_uuid(),v_iid,v_lc,public.crypt(p_password,public.gen_salt('bf')),NOW(),'authenticated','{}'::jsonb,'authenticated',false,NOW(),NOW())
    RETURNING id INTO v_id;
    INSERT INTO public.profiles(id,display_name) VALUES(v_id,v_lc) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE auth.users SET encrypted_password=public.crypt(p_password,public.gen_salt('bf')),email_confirmed_at=COALESCE(email_confirmed_at,NOW()),updated_at=NOW() WHERE id=v_id;
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.p01_test_provision(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.p01_test_provision(TEXT,TEXT) TO service_role;
`;

let pg: PgClient | null = null;
let uidA: string = "";
let uidB: string = "";

async function sql(q: string, p?: unknown[]) {
  if (!pg) throw new Error("pg missing");
  return pg.query(q, p as unknown[] | undefined);
}

function escapeSqlLiteral(v: string): string {
  return "'" + String(v).replace(/'/g, "''") + "'";
}
async function withAuth<T>(uid: string, body: () => Promise<T>): Promise<T> {
  if (!pg) throw new Error("pg");
  try {
    await pg.query("COMMIT");
  } catch {
    try {
      await pg.query("ROLLBACK");
    } catch {
      /* noop */
    }
  }
  await pg.query("BEGIN");
  try {
    await pg.query("SET LOCAL ROLE authenticated");
    await pg.query(`SET LOCAL request.jwt.claim.sub = ${escapeSqlLiteral(uid)}`);
    const result = await body();
    await pg.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await pg.query("ROLLBACK");
    } catch {
      /* noop */
    }
    throw e;
  }
}

beforeAll(async () => {
  pg = new PgClient(buildPgOpts());
  await pg.connect();
  await sql(TRANSIENT_RPCS);
  uidA = (await sql(`SELECT public.p01_test_provision($1,$2) id`, [OWNER_A, TEST_PW])).rows[0].id;
  uidB = (await sql(`SELECT public.p01_test_provision($1,$2) id`, [OWNER_B, TEST_PW])).rows[0].id;
  // Pre-cleanup deterministic replika mode for old residuals
  await sql(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await sql(`DELETE FROM public.bookings WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(`DELETE FROM public.customers WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(
    `DELETE FROM public.resource_availability WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(
    `DELETE FROM public.staff_resource_services WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(`DELETE FROM public.staff_resources WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(
    `DELETE FROM public.business_availability WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(`DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(`DELETE FROM public.site_sections WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(
    `DELETE FROM public.site_editorial_state WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(
    `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(
    `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [TENANT_A, TENANT_B, TENANT_C],
  );
  await sql(`DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid,$3::uuid)`, [
    TENANT_A,
    TENANT_B,
    TENANT_C,
  ]);
  await sql(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
}, 60_000);
afterAll(async () => {
  if (pg) {
    await sql(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await sql(`DELETE FROM public.bookings WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      TENANT_A,
      TENANT_B,
      TENANT_C,
    ]);
    await sql(`DELETE FROM public.customers WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      TENANT_A,
      TENANT_B,
      TENANT_C,
    ]);
    await sql(
      `DELETE FROM public.resource_availability WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(
      `DELETE FROM public.staff_resource_services WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(
      `DELETE FROM public.staff_resources WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(
      `DELETE FROM public.business_availability WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(`DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      TENANT_A,
      TENANT_B,
      TENANT_C,
    ]);
    await sql(`DELETE FROM public.site_sections WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      TENANT_A,
      TENANT_B,
      TENANT_C,
    ]);
    await sql(
      `DELETE FROM public.site_editorial_state WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(
      `DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(
      `DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid,$3::uuid)`,
      [TENANT_A, TENANT_B, TENANT_C],
    );
    await sql(`DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      TENANT_A,
      TENANT_B,
      TENANT_C,
    ]);
    await sql(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    await sql(`DELETE FROM auth.users WHERE lower(email::text) IN ($1,$2)`, [OWNER_A, OWNER_B]);
    await sql(`DROP FUNCTION IF EXISTS public.p01_test_provision(TEXT,TEXT)`);
    await pg.end();
    pg = null;
  }
});

async function provisionTenant(tid: string, slug: string, ownerUid: string, displayName: string) {
  const NOW = new Date().toISOString();
  await sql(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await sql(
    `
    INSERT INTO public.tenants(id,slug,name,status,published,published_at,created_at,updated_at)
    VALUES($1::uuid,$2,$3,'active',FALSE,NOW(),NOW(),NOW())
    ON CONFLICT DO NOTHING`,
    [tid, slug, displayName],
  );
  await sql(
    `
    INSERT INTO public.tenant_memberships(id,tenant_id,user_id,role,status,created_at,updated_at)
    VALUES(public.gen_random_uuid(),$1::uuid,$2,'owner','active',NOW(),NOW())
    ON CONFLICT DO NOTHING`,
    [tid, ownerUid],
  );
  await sql(
    `
    INSERT INTO public.business_profiles(tenant_id,display_name,category,city,province,postal_code,country_code,timezone,locale,email,created_at,updated_at)
    VALUES($1::uuid,$2,'hair_salon','Milano','MI','20100','IT','Europe/Rome','it-IT',$3,NOW(),NOW())
    ON CONFLICT DO NOTHING`,
    [tid, displayName, `info@${slug}.local`],
  );
  const wk = Array.from({ length: 7 })
    .map((_, i) => {
      const enabled = i >= 1 && i <= 5;
      return `($1::uuid,${i},${enabled ? "TRUE" : "FALSE"},${enabled ? "'09:00'::time" : "'00:00'::time"},${enabled ? "'18:00'::time" : "'00:01'::time"},'${NOW}'::timestamptz,'${NOW}'::timestamptz)`;
    })
    .join(",");
  await sql(
    `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at) VALUES ${wk} ON CONFLICT DO NOTHING`,
    [tid],
  );
  await sql(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
}

function servicesJson(
  items: Array<{
    id?: string | null;
    name: string;
    price_from?: number | null;
    currency?: string;
    duration_minutes?: number | null;
    active?: boolean;
    position?: number;
    description?: string | null;
  }>,
) {
  return JSON.stringify(
    items.map((it, i) => ({
      id: it.id ?? null,
      name: it.name,
      description: it.description ?? null,
      price_from: it.price_from ?? null,
      currency: it.currency ?? "EUR",
      duration_minutes: it.duration_minutes ?? null,
      position: it.position ?? i,
      active: it.active ?? true,
    })),
  );
}

async function setDraft(
  tid: string,
  servicesJsonVal: string,
  sections = "[]",
  theme = "{}",
  revision?: string,
) {
  const rev = revision ?? crypto.randomUUID();
  await sql(
    `
    INSERT INTO public.site_editorial_state(tenant_id,sections,services,theme,draft_revision,updated_at)
    VALUES($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::uuid,NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      sections=EXCLUDED.sections,
      services=EXCLUDED.services,
      theme=EXCLUDED.theme,
      draft_revision=EXCLUDED.draft_revision,
      updated_at=NOW()`,
    [tid, sections, servicesJsonVal, theme, rev],
  );
  return rev;
}

type RpcRow = {
  ok: boolean;
  code: string | null;
  message: string | null;
  services_applied: number;
};
async function publish(
  tid: string,
  whoUid: string,
  expectedRevision?: string | null,
): Promise<RpcRow> {
  return withAuth(whoUid, async () => {
    const r = await sql(
      `
      SELECT * FROM public.publish_site_draft($1::uuid, $2::uuid)`,
      [tid, expectedRevision ?? null],
    );
    return (r.rows[0] ?? {
      ok: false,
      code: "NO_ROWS",
      message: null,
      services_applied: 0,
    }) as RpcRow;
  });
}

const _sidCache = new Map<string, string>();
function sid(name: string) {
  if (_sidCache.has(name)) return _sidCache.get(name)!;
  const u = crypto.randomUUID();
  _sidCache.set(name, u);
  return u;
}

describe("P0-1 SID Service Identity Across Publish", () => {
  it("SID-01 first publish: services get stable IDs that appear in public.services with same IDs as draft", async () => {
    await provisionTenant(TENANT_A, "p01-ten-a", uidA, "Tenant A");
    const idS1 = sid("sid-01-s1");
    const idS2 = sid("sid-01-s2");
    const svcJson = servicesJson([
      {
        id: idS1,
        name: "Taglio Donna Audit",
        price_from: 25,
        duration_minutes: 45,
        currency: "EUR",
        active: true,
      },
      { id: idS2, name: "Colore", price_from: 50, duration_minutes: 90, active: true },
    ]);
    await setDraft(TENANT_A, svcJson);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    expect(r.services_applied).toBe(2);
    const rows = (
      await sql(
        `SELECT id,name,tenant_id,duration_minutes,price_from,active FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`,
        [TENANT_A],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(idS1);
    expect(rows[1].id).toBe(idS2);
    expect(rows[0].tenant_id).toBe(TENANT_A);
  });

  it("SID-02 second no-op publish IDs unchanged", async () => {
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    expect(r.services_applied).toBe(2);
    const rows = (
      await sql(`SELECT id FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`, [
        TENANT_A,
      ])
    ).rows;
    expect(rows[0].id).toBe(sid("sid-01-s1"));
    expect(rows[1].id).toBe(sid("sid-01-s2"));
    // duplicate rows check
    const dups = (
      await sql(`SELECT COUNT(*) c FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A])
    ).rows[0].c;
    expect(Number(dups)).toBe(2);
  });

  it("SID-03 edit preserves ID, updates price+duration", async () => {
    const idS1 = sid("sid-01-s1");
    const idS2 = sid("sid-01-s2");
    const newJson = servicesJson([
      {
        id: idS1,
        name: "Taglio Donna Audit Modificato",
        price_from: 30,
        duration_minutes: 50,
        active: true,
      },
      { id: idS2, name: "Colore", price_from: 50, duration_minutes: 90, active: true },
    ]);
    await setDraft(TENANT_A, newJson);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    const s1 = (
      await sql(
        `SELECT id,name,duration_minutes,price_from FROM public.services WHERE id=$1::uuid`,
        [idS1],
      )
    ).rows[0];
    expect(s1.id).toBe(idS1);
    expect(s1.name).toBe("Taglio Donna Audit Modificato");
    expect(Number(s1.duration_minutes)).toBe(50);
    expect(Number(s1.price_from)).toBe(30);
  });

  it("SID-04 add service preserves old IDs", async () => {
    const idS1 = sid("sid-01-s1");
    const idS2 = sid("sid-01-s2");
    const idS3 = sid("sid-04-s3");
    const svc = servicesJson([
      { id: idS1, name: "Taglio Donna Audit Modificato", price_from: 30, duration_minutes: 50 },
      { id: idS2, name: "Colore", price_from: 50, duration_minutes: 90 },
      { id: idS3, name: "Piega", price_from: 15, duration_minutes: 20 },
    ]);
    await setDraft(TENANT_A, svc);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    expect(r.services_applied).toBe(3);
    const rows = (
      await sql(
        `SELECT id,position FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`,
        [TENANT_A],
      )
    ).rows;
    expect(rows[0].id).toBe(idS1);
    expect(rows[1].id).toBe(idS2);
    expect(rows[2].id).toBe(idS3);
  });

  it("SID-05 staff eligibility survives republish (no cascade)", async () => {
    const r1 = (
      await sql(
        `INSERT INTO public.staff_resources(id,tenant_id,display_name,slug,bookable,active,color_hex,sort_order) VALUES(public.gen_random_uuid(),$1::uuid,'Anna','anna-sid05',TRUE,TRUE,'#ff00aa',0) ON CONFLICT DO NOTHING RETURNING id`,
        [TENANT_A],
      )
    ).rows;
    const r2 = (
      await sql(
        `INSERT INTO public.staff_resources(id,tenant_id,display_name,slug,bookable,active,color_hex,sort_order) VALUES(public.gen_random_uuid(),$1::uuid,'Beatrice','bea-sid05',TRUE,TRUE,'#00aaff',1) ON CONFLICT DO NOTHING RETURNING id`,
        [TENANT_A],
      )
    ).rows;
    const annaId =
      r1[0]?.id ??
      (
        await sql(
          `SELECT id FROM public.staff_resources WHERE tenant_id=$1::uuid AND slug='anna-sid05' LIMIT 1`,
          [TENANT_A],
        )
      ).rows[0].id;
    const beaId =
      r2[0]?.id ??
      (
        await sql(
          `SELECT id FROM public.staff_resources WHERE tenant_id=$1::uuid AND slug='bea-sid05' LIMIT 1`,
          [TENANT_A],
        )
      ).rows[0].id;
    const s1 = sid("sid-01-s1");
    const s2 = sid("sid-01-s2");
    const s3 = sid("sid-04-s3");
    await sql(
      `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active) VALUES($1::uuid,$2::uuid,$3::uuid,TRUE) ON CONFLICT DO NOTHING`,
      [TENANT_A, annaId, s1],
    );
    await sql(
      `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active) VALUES($1::uuid,$2::uuid,$3::uuid,TRUE) ON CONFLICT DO NOTHING`,
      [TENANT_A, annaId, s2],
    );
    await sql(
      `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active) VALUES($1::uuid,$2::uuid,$3::uuid,TRUE) ON CONFLICT DO NOTHING`,
      [TENANT_A, beaId, s2],
    );
    const countBefore = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.staff_resource_services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0].c,
    );
    expect(countBefore).toBeGreaterThanOrEqual(3);
    // republish with same 3 services (no-op-ish)
    const svc = servicesJson([
      { id: s1, name: "Taglio Donna Audit Modificato", price_from: 30, duration_minutes: 50 },
      { id: s2, name: "Colore", price_from: 50, duration_minutes: 90 },
      { id: s3, name: "Piega", price_from: 15, duration_minutes: 20 },
    ]);
    await setDraft(TENANT_A, svc);
    const pub = await publish(TENANT_A, uidA);
    expect(pub.ok).toBe(true);
    const countAfter = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.staff_resource_services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0].c,
    );
    expect(countAfter).toBe(countBefore);
  });

  it("SID-06 booking survives republish (RESTRICT does not fail anymore, IDs stable)", async () => {
    const s1 = sid("sid-01-s1");
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 5, 10, 0, 0, 0);
    const ends = new Date(start.getTime() + 50 * 60 * 1000);
    const {
      rows: [bk],
    } = await sql(
      `
      INSERT INTO public.bookings(id,tenant_id,service_id,starts_at,ends_at,status,customer_name,customer_email,customer_phone)
      VALUES(public.gen_random_uuid(),$1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,'confirmed','Mario Rossi','mario@test.local','+39111222333')
      RETURNING id,service_id`,
      [TENANT_A, s1, start.toISOString(), ends.toISOString()],
    );
    assert.ok(bk, "booking create failed");
    expect(bk.service_id).toBe(s1);
    // republish unchanged draft (with 3 services)
    const svc = servicesJson([
      { id: s1, name: "Taglio Donna Audit Modificato", price_from: 30, duration_minutes: 50 },
      { id: sid("sid-01-s2"), name: "Colore", price_from: 50, duration_minutes: 90 },
      { id: sid("sid-04-s3"), name: "Piega", price_from: 15, duration_minutes: 20 },
    ]);
    const rev = await setDraft(TENANT_A, svc);
    const pub = await publish(TENANT_A, uidA, rev);
    expect(pub.ok).toBe(true);
    const {
      rows: [after],
    } = await sql(`SELECT id,service_id,status FROM public.bookings WHERE id=$1::uuid`, [bk.id]);
    expect(after.service_id).toBe(s1);
    expect(after.status).toBe("confirmed");
  });

  it("SID-07 duration change reflected in slot/booking reference", async () => {
    const s1 = sid("sid-01-s1");
    const svc = servicesJson([
      { id: s1, name: "Taglio Donna 45 NEW", price_from: 35, duration_minutes: 45 },
      { id: sid("sid-01-s2"), name: "Colore", price_from: 50, duration_minutes: 90 },
      { id: sid("sid-04-s3"), name: "Piega", price_from: 15, duration_minutes: 20 },
    ]);
    await setDraft(TENANT_A, svc);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    const d = (await sql(`SELECT duration_minutes FROM public.services WHERE id=$1::uuid`, [s1]))
      .rows[0].duration_minutes;
    expect(Number(d)).toBe(45);
  });

  it("SID-08 inactive/removed service not publicly bookable (active=false)", async () => {
    const s1 = sid("sid-01-s1");
    const s2 = sid("sid-01-s2");
    const s3 = sid("sid-04-s3");
    // mark s3 active=false in draft
    const svc = servicesJson([
      { id: s1, name: "Taglio Donna", price_from: 35, duration_minutes: 45 },
      { id: s2, name: "Colore", price_from: 50, duration_minutes: 90 },
      { id: s3, name: "Piega Disattivata", price_from: 15, duration_minutes: 20, active: false },
    ]);
    await setDraft(TENANT_A, svc);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    const {
      rows: [row],
    } = await sql(`SELECT active FROM public.services WHERE id=$1::uuid`, [s3]);
    expect(row.active).toBe(false);
    const cntPublic = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.services WHERE tenant_id=$1::uuid AND active=TRUE`,
          [TENANT_A],
        )
      ).rows[0].c,
    );
    expect(cntPublic).toBe(2);
  });

  it("SID-09 remove unreferenced service from draft: deletes row + eligibility", async () => {
    const s1 = sid("sid-01-s1");
    const s2 = sid("sid-01-s2");
    const s3 = sid("sid-04-s3");
    // ensure s3 has no bookings (true by inspection: we created none for it)
    const nb = Number(
      (await sql(`SELECT COUNT(*) c FROM public.bookings WHERE service_id=$1::uuid`, [s3])).rows[0]
        .c,
    );
    expect(nb).toBe(0);
    // remove s3 in draft
    const svc = servicesJson([
      { id: s1, name: "Taglio Donna", price_from: 35, duration_minutes: 45 },
      { id: s2, name: "Colore", price_from: 50, duration_minutes: 90 },
    ]);
    await setDraft(TENANT_A, svc);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    const exists = Number(
      (await sql(`SELECT COUNT(*) c FROM public.services WHERE id=$1::uuid`, [s3])).rows[0].c,
    );
    expect(exists).toBe(0);
    const srsElig = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.staff_resource_services WHERE service_id=$1::uuid`,
          [s3],
        )
      ).rows[0].c,
    );
    expect(srsElig).toBe(0);
  });

  it("SID-10 remove referenced service from draft: soft-deactivates, preserve booking + history", async () => {
    const s1 = sid("sid-01-s1");
    const s2 = sid("sid-01-s2");
    // s1 has a booking already (SID-06). remove s1 from draft
    const svc = servicesJson([{ id: s2, name: "Colore", price_from: 50, duration_minutes: 90 }]);
    await setDraft(TENANT_A, svc);
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    // s1 booking still exists
    const nb = Number(
      (await sql(`SELECT COUNT(*) c FROM public.bookings WHERE service_id=$1::uuid`, [s1])).rows[0]
        .c,
    );
    expect(nb).toBeGreaterThanOrEqual(1);
    // s1 row still exists with active=FALSE
    const {
      rows: [row],
    } = await sql(`SELECT active FROM public.services WHERE id=$1::uuid`, [s1]);
    expect(row.active).toBe(false);
  });

  it("SID-11 cross-tenant UUID denied", async () => {
    await provisionTenant(TENANT_B, "p01-ten-b", uidB, "Tenant B");
    const bSvc = servicesJson([
      // try to use TENANT_A service ID
      { id: sid("sid-01-s2"), name: "Intrusion", price_from: 1, duration_minutes: 10 },
    ]);
    await setDraft(TENANT_B, bSvc);
    const r = await publish(TENANT_B, uidB);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("CROSS_TENANT");
    // Also: no mutation to original tenant service
    const {
      rows: [orig],
    } = await sql(`SELECT name,active FROM public.services WHERE id=$1::uuid`, [sid("sid-01-s2")]);
    expect(orig.name).toBe("Colore");
    // Tenant B has no services inserted
    const cnt = Number(
      (await sql(`SELECT COUNT(*) c FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_B]))
        .rows[0].c,
    );
    expect(cnt).toBe(0);
  });

  it("SID-12 invalid UUID payload rejected/rollback safely (non-uuid in ID → new UUID, not corrupt)", async () => {
    // invalid ID field not a UUID: RPC generates new one, publish OK
    const svc = JSON.stringify([
      {
        id: "questo-non-e-uuid",
        name: "Servizio ID Invalido",
        description: null,
        price_from: 12,
        currency: "EUR",
        duration_minutes: 15,
        position: 0,
        active: true,
      },
    ]);
    await setDraft(TENANT_B, svc);
    const r = await publish(TENANT_B, uidB);
    expect(r.ok).toBe(true);
    const rows = (
      await sql(
        `SELECT id,name FROM public.services WHERE tenant_id=$1::uuid AND name=$2 LIMIT 1`,
        [TENANT_B, "Servizio ID Invalido"],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(rows[0].id)).toBe(true);
  });

  it("SID-13 duplicate publish idempotent", async () => {
    const before = Number(
      (await sql(`SELECT COUNT(*) c FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]))
        .rows[0].c,
    );
    const rev = await setDraft(
      TENANT_A,
      servicesJson([
        {
          id: sid("sid-01-s1"),
          name: "Taglio Donna",
          price_from: 35,
          duration_minutes: 45,
          active: false,
        },
        { id: sid("sid-01-s2"), name: "Colore", price_from: 50, duration_minutes: 90 },
      ]),
    );
    const p1 = await publish(TENANT_A, uidA, rev);
    const p2 = await publish(TENANT_A, uidA, null);
    expect(p1.ok).toBe(true);
    expect(p2.ok).toBe(true);
    const after = Number(
      (await sql(`SELECT COUNT(*) c FROM public.services WHERE tenant_id=$1::uuid`, [TENANT_A]))
        .rows[0].c,
    );
    expect(after).toBe(before);
  });

  it("SID-14 no duplicate service rows across N publishes", async () => {
    const s2 = sid("sid-01-s2");
    for (let i = 0; i < 4; i++) {
      await setDraft(
        TENANT_A,
        servicesJson([
          {
            id: sid("sid-01-s1"),
            name: "Taglio " + i,
            price_from: 30 + i,
            duration_minutes: 45,
            active: false,
          },
          { id: s2, name: "Colore", price_from: 50, duration_minutes: 90 },
        ]),
      );
      const r = await publish(TENANT_A, uidA);
      expect(r.ok).toBe(true);
    }
    const c = (
      await sql(
        `SELECT COUNT(*) c, COUNT(DISTINCT id) u FROM public.services WHERE tenant_id=$1::uuid`,
        [TENANT_A],
      )
    ).rows[0];
    expect(Number(c.c)).toBe(Number(c.u));
  });

  it("SID-15 unrelated site publish preserves service graph (only site sections/theme touched)", async () => {
    const eligibilityCountBefore = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.staff_resource_services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0].c,
    );
    const s1 = sid("sid-01-s1");
    const s2 = sid("sid-01-s2");
    // Republish same services but with a new sections/theme
    await setDraft(
      TENANT_A,
      servicesJson([
        { id: s1, name: "Taglio Donna", price_from: 35, duration_minutes: 45, active: false },
        { id: s2, name: "Colore", price_from: 50, duration_minutes: 90 },
      ]),
      JSON.stringify([
        {
          id: null,
          section_type: "hero",
          enabled: true,
          position: 0,
          variant: "default",
          settings: { title: "Hello" },
        },
        {
          id: null,
          section_type: "services",
          enabled: true,
          position: 1,
          variant: "default",
          settings: {},
        },
      ]),
      JSON.stringify({ primary: "#111111" }),
    );
    const r = await publish(TENANT_A, uidA);
    expect(r.ok).toBe(true);
    const after = Number(
      (
        await sql(
          `SELECT COUNT(*) c FROM public.staff_resource_services WHERE tenant_id=$1::uuid`,
          [TENANT_A],
        )
      ).rows[0].c,
    );
    expect(after).toBe(eligibilityCountBefore);
    const rows = (
      await sql(`SELECT id FROM public.services WHERE tenant_id=$1::uuid ORDER BY position`, [
        TENANT_A,
      ])
    ).rows;
    expect(rows[0].id).toBe(s1);
    expect(rows[1].id).toBe(s2);
    // sections and theme applied
    const sections = Number(
      (
        await sql(`SELECT COUNT(*) c FROM public.site_sections WHERE tenant_id=$1::uuid`, [
          TENANT_A,
        ])
      ).rows[0].c,
    );
    expect(sections).toBeGreaterThanOrEqual(2);
  });
});
