// @vitest-environment node
import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client as PgClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
    console.error(`[fase13d-failure] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const TENANT_A_SLUG = "f13d-cal-alpha-f";
const TENANT_B_SLUG = "f13d-cal-beta-f";

const UUIDS = {
  tenantA: "00000000-0000-4f3d-8000-0000000000a1",
  tenantB: "00000000-0000-4f3d-8000-0000000000b1",
  svcA1: "00000000-0000-4f3d-8002-0000000000a1",
  svcA2: "00000000-0000-4f3d-8002-0000000000a2",
  svcB1: "00000000-0000-4f3d-8002-0000000000b1",
  ownerA: "f13d-f-owner-a@test.local",
  managerA: "f13d-f-manager-a@test.local",
  staffA: "f13d-f-staff-a@test.local",
  ownerB: "f13d-f-owner-b@test.local",
  noMember: "f13d-f-no-member@test.local",
  resA1: "00000000-0000-4f3d-8004-0000000000a1",
  resA2: "00000000-0000-4f3d-8004-0000000000a2",
  resA3: "00000000-0000-4f3d-8004-0000000000a3",
  resA4: "00000000-0000-4f3d-8004-0000000000a4",
  resA5: "00000000-0000-4f3d-8004-0000000000a5",
  resA6: "00000000-0000-4f3d-8004-0000000000a6",
  resA7: "00000000-0000-4f3d-8004-0000000000a7",
  resA8: "00000000-0000-4f3d-8004-0000000000a8",
  resA9: "00000000-0000-4f3d-8004-0000000000a9",
  resA10: "00000000-0000-4f3d-8004-000000000aa0",
  resB1: "00000000-0000-4f3d-8004-0000000000b1",
  bookingA: "00000000-0000-4f3d-8008-0000000000a1",
  custA1: "00000000-0000-4f3d-8010-0000000000a1",
  bseInjected1: "00000000-0000-4f3d-8012-0000000000a1",
  rtoInjected1: "00000000-0000-4f3d-8014-0000000000a1",
};

type AnyClient = SupabaseClient<Database, "public">;

const userIds: Record<string, string | null> = {
  ownerA: null,
  managerA: null,
  staffA: null,
  ownerB: null,
  noMember: null,
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
function serviceClient() {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function anonClient() {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
async function login(email: string): Promise<AnyClient> {
  const cl = anonClient();
  const r = await cl.auth.signInWithPassword({ email, password: PASSWORD });
  if (r.error) throw new Error(`signIn ${email}: ${r.error.message}`);
  return cl;
}

const CEST_H_OFFSET = 2;
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
const FIXED_MONDAY = (() => {
  const n = new Date();
  const today = n.getUTCDay();
  let delta = (1 - today + 7) % 7;
  if (delta === 0) delta = 7;
  delta += 28;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();
function MON(h: number, m: number): string {
  const { y, mo, d } = FIXED_MONDAY;
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function DAY(h: number, m: number, offset: number): string {
  const { y, mo, d } = FIXED_MONDAY;
  const dt = new Date(Date.UTC(y, mo - 1, d + offset));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}T${pad2(h - CEST_H_OFFSET)}:${pad2(m)}:00Z`;
}
function END(start: string, min: number): string {
  const s = new Date(start);
  return new Date(s.valueOf() + min * 60000).toISOString();
}

interface BookingCreateRow {
  code?: string | null;
  message?: string | null;
  booking_id?: string | null;
  revision?: number | null;
  resource_id?: string | null;
  resource_slug?: string | null;
  starts_at_out?: string | null;
  ends_at_out?: string | null;
  [key: string]: unknown;
}

interface BookingRescheduleRow {
  code?: string | null;
  message?: string | null;
  booking_id_out?: string | null;
  revision_out?: number | null;
  resource_id_out?: string | null;
  starts_at_out?: string | null;
  ends_at_out?: string | null;
  service_id_out?: string | null;
  changed_keys?: string[] | null;
  [key: string]: unknown;
}

async function rpcManualCreate(
  cl: AnyClient,
  args: {
    p_customer_id?: string | null;
    p_customer_name?: string;
    p_customer_email?: string;
    p_customer_phone?: string;
    p_service_id?: string;
    p_starts_at?: string;
    p_resource_slug?: string;
    p_notes?: string;
  },
): Promise<{ ok: boolean; row: BookingCreateRow; errorMessage: string; errorCode: string }> {
  let r: { data?: unknown; error?: unknown };
  try {
    r = await (
      cl as unknown as {
        rpc: (
          name: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data?: unknown; error?: unknown }>;
      }
    ).rpc("dashboard_booking_manual_create", {
      p_customer_id: args.p_customer_id ?? null,
      p_customer_name: args.p_customer_name ?? "",
      p_customer_email: args.p_customer_email ?? "",
      p_customer_phone: args.p_customer_phone ?? "",
      p_service_id: args.p_service_id ?? null,
      p_starts_at: args.p_starts_at ?? null,
      p_resource_slug: args.p_resource_slug ?? "any",
      p_notes: args.p_notes ?? null,
    });
  } catch (e: unknown) {
    const err = (e ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      row: {},
      errorMessage: String(err["message"] ?? String(e)),
      errorCode: String(err["code"] ?? ""),
    };
  }
  if (r.error) {
    const err = r.error as Record<string, unknown>;
    return {
      ok: false,
      row: {},
      errorMessage: String(err["message"] ?? r.error),
      errorCode: String(err["code"] ?? ""),
    };
  }
  let row: BookingCreateRow = {};
  if (Array.isArray(r.data) && r.data.length > 0) {
    row = r.data[0] as BookingCreateRow;
  } else if (r.data && typeof r.data === "object") {
    row = r.data as BookingCreateRow;
  }
  const code = String(row.code ?? "");
  const msg = String(row.message ?? "");
  return {
    ok: code === "OK",
    row,
    errorMessage: msg,
    errorCode: code,
  };
}

async function rpcReschedule(
  cl: AnyClient,
  args: {
    p_booking_id: string;
    p_expected_revision: number;
    p_new_starts_at?: string | null;
    p_new_resource_slug?: string | null;
    p_new_service_id?: string | null;
  },
): Promise<{ ok: boolean; row: BookingRescheduleRow; errorMessage: string; errorCode: string }> {
  let r: { data?: unknown; error?: unknown };
  try {
    r = await (
      cl as unknown as {
        rpc: (
          name: string,
          args?: Record<string, unknown>,
        ) => Promise<{ data?: unknown; error?: unknown }>;
      }
    ).rpc("dashboard_booking_reschedule", {
      p_booking_id: args.p_booking_id,
      p_expected_revision: args.p_expected_revision,
      p_new_starts_at: args.p_new_starts_at ?? null,
      p_new_resource_slug: args.p_new_resource_slug ?? null,
      p_new_service_id: args.p_new_service_id ?? null,
    });
  } catch (e: unknown) {
    const err = (e ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      row: {},
      errorMessage: String(err["message"] ?? String(e)),
      errorCode: String(err["code"] ?? ""),
    };
  }
  if (r.error) {
    const err = r.error as Record<string, unknown>;
    return {
      ok: false,
      row: {},
      errorMessage: String(err["message"] ?? r.error),
      errorCode: String(err["code"] ?? ""),
    };
  }
  let row: BookingRescheduleRow = {};
  if (Array.isArray(r.data) && r.data.length > 0) {
    row = r.data[0] as BookingRescheduleRow;
  } else if (r.data && typeof r.data === "object") {
    row = r.data as BookingRescheduleRow;
  }
  const code = String(row.code ?? "");
  const msg = String(row.message ?? "");
  return {
    ok: code === "OK",
    row,
    errorMessage: msg,
    errorCode: code,
  };
}

describe("F13D Failure Injection — 10 deterministic tests", () => {
  const scope: {
    client: PgClient;
    ownerA?: AnyClient;
    managerA?: AnyClient;
    staffA?: AnyClient;
    cleanupIds: string[];
  } = {
    client: null as unknown as PgClient,
    cleanupIds: [],
  };

  beforeAll(async () => {
    scope["client"] = await pg();
    const c = scope["client"];
    const svc = serviceClient();

    const ensureUser = async (email: string): Promise<string> => {
      const list = await svc.auth.admin.listUsers();
      const existing = list.data?.users.find((u) => u.email === email);
      if (existing) return existing.id;
      const r = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (r.error) throw new Error(String(r.error));
      return r.data.user.id;
    };

    userIds["ownerA"] = await ensureUser(UUIDS.ownerA);
    userIds["managerA"] = await ensureUser(UUIDS.managerA);
    userIds["staffA"] = await ensureUser(UUIDS.staffA);
    userIds["ownerB"] = await ensureUser(UUIDS.ownerB);
    userIds["noMember"] = await ensureUser(UUIDS.noMember);

    scope.cleanupIds.push(
      userIds["ownerA"],
      userIds["managerA"],
      userIds["staffA"],
      userIds["ownerB"],
      userIds["noMember"],
    );

    await c.query(`BEGIN`);
    await c.query(`SET LOCAL session_replication_role = replica`);
    const slugPh = [TENANT_A_SLUG, TENANT_B_SLUG].map((_, i) => `$${i + 1}`).join(",");
    await c.query(`DELETE FROM public.audit_logs WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.customers WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.business_schedule_exceptions WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.resource_availability WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.staff_resources WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.services WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(
      `DELETE FROM public.tenant_memberships WHERE user_id IN (SELECT unnest($1::uuid[]))`,
      [
        [
          userIds["ownerA"],
          userIds["managerA"],
          userIds["staffA"],
          userIds["ownerB"],
          userIds["noMember"],
        ],
      ],
    );
    await c.query(`DELETE FROM public.business_profiles WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.business_availability WHERE tenant_id IN ($1,$2)`, [
      UUIDS.tenantA,
      UUIDS.tenantB,
    ]);
    await c.query(`DELETE FROM public.tenants WHERE slug IN (${slugPh})`, [
      TENANT_A_SLUG,
      TENANT_B_SLUG,
    ]);
    await c.query(`COMMIT`);

    await c.query(`BEGIN`);
    await c.query(`SET LOCAL session_replication_role = replica`);

    await c.query(`
      CREATE OR REPLACE FUNCTION public.member_role_for_tenant(p_tid UUID, p_uid UUID)
      RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
        SELECT tm.role::TEXT FROM public.tenant_memberships tm
        WHERE tm.tenant_id = p_tid AND tm.user_id = p_uid AND tm.status='active' LIMIT 1;
      $$;
      ALTER FUNCTION public.member_role_for_tenant(UUID,UUID) OWNER TO postgres;
      REVOKE ALL ON FUNCTION public.member_role_for_tenant(UUID,UUID) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.member_role_for_tenant(UUID,UUID) TO postgres, anon, authenticated, service_role;
    `);

    await c.query(`
CREATE OR REPLACE FUNCTION public.dashboard_booking_manual_create(
  p_customer_id   UUID,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_service_id    UUID,
  p_starts_at     TIMESTAMPTZ,
  p_resource_slug TEXT DEFAULT 'any',
  p_notes         TEXT DEFAULT NULL
)
RETURNS TABLE (
  code          TEXT,
  message       TEXT,
  booking_id    UUID,
  revision      INTEGER,
  resource_id   UUID,
  resource_slug TEXT,
  starts_at_out TIMESTAMPTZ,
  ends_at_out   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_uid   UUID := auth.uid();
  v_actor_role  TEXT;
  v_tenant_id   UUID;
  v_tz          TEXT;
  v_const_lead  INT; v_const_horizon INT; v_const_step INT;
  v_duration    INT;
  v_end_at      TIMESTAMPTZ;
  v_cust_id     UUID;
  v_cust_name   TEXT;
  v_cust_email  TEXT;
  v_cust_phone  TEXT;
  v_resources   UUID[];
  v_slugs       TEXT[];
  v_i           INT;
  v_picked      UUID;
  v_picked_slug TEXT;
  v_new_id      UUID;
  v_rev         INTEGER := 0;
  v_past_min    INTERVAL;
  v_now         TIMESTAMPTZ := NOW();
BEGIN
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id := NULL; revision := 0; resource_id := NULL; resource_slug := NULL;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required'; RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    code := 'AUTHZ_DENIED'; message := 'tenant membership not found'; RETURN NEXT; RETURN;
  END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := NULL;
  IF public.has_tenant_role(v_tenant_id, ARRAY['owner']) THEN v_actor_role := 'owner';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['manager']) THEN v_actor_role := 'manager';
  ELSIF public.has_tenant_role(v_tenant_id, ARRAY['staff']) THEN v_actor_role := 'staff';
  END IF;
  IF v_actor_role IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'insufficient role'; RETURN NEXT; RETURN;
  END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days, s.slot_step_minutes
    INTO v_const_lead, v_const_horizon, v_const_step
  FROM public.scheduling_constants() s;

  IF p_starts_at < v_now THEN
    IF v_actor_role IN ('owner','manager') THEN
      NULL;
    ELSE
      v_past_min := (180::TEXT || ' minutes')::INTERVAL;
      IF (v_now - p_starts_at) > v_past_min THEN
        code := 'PAST_LIMIT_EXCEEDED';
        message := 'staff walk-in oltre 180m vietato';
        RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  SELECT s.duration_minutes
    INTO v_duration
  FROM public.services s
  WHERE s.id = p_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
  IF NOT FOUND OR v_duration IS NULL THEN
    code := 'SERVICE_NOT_FOUND'; message := 'service inesistente o inattivo'; RETURN NEXT; RETURN;
  END IF;

  v_end_at := p_starts_at + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_starts_at > v_now THEN
    IF p_starts_at < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
      code := 'LEAD_TIME_MINIMUM'; message := 'tempo di preavviso non sufficiente'; RETURN NEXT; RETURN;
    END IF;
    IF p_starts_at > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
      code := 'MAX_ADVANCE_EXCEEDED'; message := 'data troppo in avanti'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.display_name, c.email, c.phone
      INTO v_cust_id, v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'cliente non appartiene al tenant'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    v_cust_name := BTRIM(COALESCE(p_customer_name, ''));
    IF length(v_cust_name) = 0 OR length(v_cust_name) > 120 THEN
      code := 'VALIDATION_ERROR'; message := 'nome cliente obbligatorio max 120'; RETURN NEXT; RETURN;
    END IF;
    IF (p_customer_email IS NULL OR length(BTRIM(p_customer_email))=0)
       AND (p_customer_phone IS NULL OR length(BTRIM(p_customer_phone)) < 4) THEN
      code := 'VALIDATION_ERROR'; message := 'almeno email o telefono'; RETURN NEXT; RETURN;
    END IF;
    SELECT r.customer_id INTO v_cust_id
      FROM public.customer_upsert_for_public_booking(
        v_tenant_id,
        v_cust_name,
        NULLIF(BTRIM(p_customer_email),''),
        NULLIF(BTRIM(p_customer_phone),'')
      ) r;
    IF v_cust_id IS NULL THEN
      code := 'CUSTOMER_NOT_FOUND'; message := 'upsert cliente fallita'; RETURN NEXT; RETURN;
    END IF;
    SELECT c.display_name, c.email, c.phone
      INTO v_cust_name, v_cust_email, v_cust_phone
    FROM public.customers c WHERE c.id = v_cust_id;
  END IF;

  IF p_resource_slug IS NULL OR p_resource_slug = '' OR p_resource_slug = 'any' THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.active = TRUE AND sr.bookable = TRUE
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
        )
        OR EXISTS (
          SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id
            AND srs.resource_id = sr.id
            AND srs.service_id = p_service_id
            AND srs.active = TRUE
        )
      );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug]
      INTO v_resources, v_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_resource_slug
      AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'operatore inesistente'; RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id = v_resources[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id
           AND srs.resource_id = v_resources[1]
           AND srs.service_id = p_service_id
           AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'operatore non abilitato per servizio'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_resources IS NULL OR array_length(v_resources, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessun operatore disponibile'; RETURN NEXT; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id
      AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(p_starts_at, v_end_at, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'attività chiusa'; RETURN NEXT; RETURN;
  END IF;

  v_i := 1;
  <<try_candidates>>
  LOOP
    EXIT try_candidates WHEN v_i > array_length(v_resources, 1);
    v_picked := v_resources[v_i];
    v_picked_slug := v_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
      WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
        AND tstzrange(rto.starts_at, rto.ends_at, '[)')
            && tstzrange(p_starts_at, v_end_at, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT;
      v_in_range BOOL := FALSE;
    BEGIN
      v_local_day := (p_starts_at AT TIME ZONE v_tz)::DATE;
      v_local_st  := (p_starts_at AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_end_at   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day)
                WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT)
              END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE
          AND ra.weekday = v_wd
          AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_range;

      IF NOT v_in_range AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id
          AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE
            AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_range;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
        WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
          AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
          AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                               AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_range := EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
            AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
            AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                 AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
            AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_range THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'extra_open'
            AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                @> tstzrange(p_starts_at, v_end_at, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_candidates;
        END IF;
      END IF;
    END;

    BEGIN
      PERFORM set_config('app.booking_write_trusted', 'true', true);

      INSERT INTO public.bookings (
        tenant_id, customer_id, service_id, resource_id,
        starts_at, ends_at, status, revision,
        customer_name, customer_email, customer_phone, notes,
        created_at, updated_at
      ) VALUES (
        v_tenant_id, v_cust_id, p_service_id, v_picked,
        p_starts_at, v_end_at, 'confirmed', 0,
        v_cust_name, v_cust_email, v_cust_phone, NULLIF(LEFT(BTRIM(p_notes), 500), ''),
        v_now, v_now
      ) RETURNING id INTO v_new_id;

      code := 'OK'; message := 'appuntamento creato';
      booking_id := v_new_id; revision := 0;
      resource_id := v_picked; resource_slug := v_picked_slug;
      starts_at_out := p_starts_at; ends_at_out := v_end_at;

      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        'manual_booking_created',
        'booking',
        v_new_id,
        jsonb_build_object(
          'service_id', p_service_id::text,
          'resource_id', v_picked::text,
          'starts_at', p_starts_at::text,
          'ends_at', v_end_at::text,
          'revision_before', NULL,
          'revision_after', 0,
          'source', 'dashboard_manual',
          'created_by_role', v_actor_role
        )
      );
      RETURN NEXT; RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_candidates;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'tutti gli operatori occupati'; RETURN NEXT; RETURN;
END; $$;
ALTER FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_manual_create(UUID,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ,TEXT,TEXT) TO service_role;
`);

    await c.query(`
CREATE OR REPLACE FUNCTION public.dashboard_booking_reschedule(
  p_booking_id          UUID,
  p_expected_revision   INTEGER,
  p_new_starts_at       TIMESTAMPTZ DEFAULT NULL,
  p_new_resource_slug   TEXT DEFAULT NULL,
  p_new_service_id      UUID DEFAULT NULL
)
RETURNS TABLE (
  code           TEXT,
  message        TEXT,
  booking_id_out UUID,
  revision_out   INTEGER,
  resource_id_out UUID,
  resource_slug_out TEXT,
  starts_at_out  TIMESTAMPTZ,
  ends_at_out    TIMESTAMPTZ,
  service_id_out UUID,
  changed_keys   TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_uid  UUID := auth.uid();
  v_actor_role TEXT;
  v_tenant_id  UUID;
  v_tz         TEXT;
  v_const_lead INT; v_const_horizon INT;
  v_b          public.bookings%ROWTYPE;
  v_new_start  TIMESTAMPTZ;
  v_new_end    TIMESTAMPTZ;
  v_new_svc    UUID;
  v_duration   INT;
  v_candidates UUID[]; v_cand_slugs TEXT[];
  v_i          INT;
  v_picked     UUID; v_picked_slug TEXT;
  v_changed    TEXT[] := ARRAY[]::TEXT[];
  v_audit_act  TEXT;
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  code := 'INTERNAL_ERROR'; message := 'pending';
  booking_id_out := NULL; revision_out := 0; resource_id_out := NULL; changed_keys := v_changed;

  IF v_actor_uid IS NULL THEN
    code := 'AUTHZ_DENIED'; message := 'authenticated required'; RETURN NEXT; RETURN;
  END IF;

  SELECT DISTINCT tm.tenant_id, bp.timezone
    INTO v_tenant_id, v_tz
  FROM public.tenant_memberships tm
  LEFT JOIN public.business_profiles bp ON bp.tenant_id = tm.tenant_id
  WHERE tm.user_id = v_actor_uid AND tm.status = 'active' LIMIT 1;
  IF NOT FOUND THEN code := 'AUTHZ_DENIED'; message := 'membership'; RETURN NEXT; RETURN; END IF;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  v_actor_role := public.member_role_for_tenant(v_tenant_id, v_actor_uid);
  IF v_actor_role NOT IN ('owner','manager') THEN
    code := 'AUTHZ_DENIED'; message := 'reschedule solo owner/manager'; RETURN NEXT; RETURN;
  END IF;

  SELECT s.lead_time_minutes, s.booking_horizon_days
    INTO v_const_lead, v_const_horizon
  FROM public.scheduling_constants() s;

  SELECT b.* INTO v_b FROM public.bookings b
  WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    code := 'BOOKING_NOT_FOUND'; message := 'inesistente'; RETURN NEXT; RETURN;
  END IF;

  IF v_b.tenant_id <> v_tenant_id THEN
    code := 'CROSS_TENANT_DENIED'; message := 'cross-tenant'; RETURN NEXT; RETURN;
  END IF;

  IF v_b.status <> 'confirmed' THEN
    code := 'BOOKING_TERMINAL'; message := 'appuntamento terminale'; RETURN NEXT; RETURN;
  END IF;

  IF v_b.revision <> p_expected_revision THEN
    code := 'CONCURRENT_UPDATE'; message := 'revisione non corrisponde'; RETURN NEXT; RETURN;
  END IF;

  IF p_new_service_id IS NOT NULL AND p_new_service_id <> v_b.service_id THEN
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s
     WHERE s.id = p_new_service_id AND s.tenant_id = v_tenant_id AND s.active = TRUE;
    IF NOT FOUND OR v_duration IS NULL THEN
      code := 'SERVICE_INACTIVE'; message := 'servizio inattivo o inesistente'; RETURN NEXT; RETURN;
    END IF;
    v_new_svc := p_new_service_id;
    v_changed := array_append(v_changed, 'service_id');
  ELSE
    SELECT s.duration_minutes INTO v_duration
      FROM public.services s WHERE s.id = v_b.service_id;
    v_new_svc := v_b.service_id;
  END IF;

  IF p_new_starts_at IS NOT NULL AND p_new_starts_at <> v_b.starts_at THEN
    v_new_start := p_new_starts_at;
    IF v_new_start > v_now THEN
      IF v_new_start < v_now + (v_const_lead::TEXT || ' minutes')::INTERVAL THEN
        code := 'LEAD_TIME_MINIMUM'; message := 'lead'; RETURN NEXT; RETURN;
      END IF;
      IF v_new_start > v_now + (v_const_horizon::TEXT || ' days')::INTERVAL THEN
        code := 'MAX_ADVANCE_EXCEEDED'; message := 'horizon'; RETURN NEXT; RETURN;
      END IF;
    END IF;
    v_changed := array_append(v_changed, 'starts_at');
    v_changed := array_append(v_changed, 'ends_at');
  ELSE
    v_new_start := v_b.starts_at;
  END IF;
  v_new_end := v_new_start + (v_duration::TEXT || ' minutes')::INTERVAL;

  IF p_new_resource_slug IS NULL OR p_new_resource_slug = '' OR p_new_resource_slug = 'same' THEN
    v_candidates := ARRAY[v_b.resource_id];
    SELECT ARRAY[sr.slug] INTO v_cand_slugs
      FROM public.staff_resources sr WHERE sr.id = v_b.resource_id;
    IF v_cand_slugs IS NULL THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'stessa risorsa non esiste'; RETURN NEXT; RETURN;
    END IF;
  ELSIF p_new_resource_slug = 'any' THEN
    SELECT ARRAY_AGG(sr.id ORDER BY sr.sort_order ASC, sr.id ASC),
           ARRAY_AGG(sr.slug ORDER BY sr.sort_order ASC, sr.id ASC)
      INTO v_candidates, v_cand_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.active = TRUE AND sr.bookable = TRUE
      AND (
        NOT EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=sr.id)
        OR EXISTS (
          SELECT 1 FROM public.staff_resource_services srs
          WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = sr.id
            AND srs.service_id = v_new_svc AND srs.active = TRUE
        )
      );
  ELSE
    SELECT ARRAY[sr.id], ARRAY[sr.slug]
      INTO v_candidates, v_cand_slugs
    FROM public.staff_resources sr
    WHERE sr.tenant_id = v_tenant_id AND sr.slug = p_new_resource_slug
      AND sr.active = TRUE AND sr.bookable = TRUE;
    IF NOT FOUND THEN
      code := 'RESOURCE_NOT_FOUND'; message := 'operatore specifico non trovato'; RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_resource_services srs WHERE srs.tenant_id=v_tenant_id AND srs.resource_id=v_candidates[1])
       AND NOT EXISTS (
         SELECT 1 FROM public.staff_resource_services srs
         WHERE srs.tenant_id = v_tenant_id AND srs.resource_id = v_candidates[1]
           AND srs.service_id = v_new_svc AND srs.active = TRUE
       ) THEN
      code := 'RESOURCE_NOT_ELIGIBLE'; message := 'non eligibile'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_candidates IS NULL OR array_length(v_candidates, 1) = 0 THEN
    code := 'RESOURCE_NOT_ELIGIBLE'; message := 'nessuna risorsa'; RETURN NEXT; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_schedule_exceptions bse
    WHERE bse.tenant_id = v_tenant_id AND bse.exception_type IN ('closure','slot_block')
      AND tstzrange(bse.starts_at, bse.ends_at, '[)')
          && tstzrange(v_new_start, v_new_end, '[)')
  ) THEN
    code := 'BUSINESS_CLOSED'; message := 'chiusura'; RETURN NEXT; RETURN;
  END IF;

  v_i := 1;
  <<try_res>>
  LOOP
    EXIT try_res WHEN v_i > array_length(v_candidates, 1);
    v_picked := v_candidates[v_i];
    v_picked_slug := v_cand_slugs[v_i];

    IF EXISTS (
      SELECT 1 FROM public.resource_time_off rto
      WHERE rto.tenant_id = v_tenant_id AND rto.resource_id = v_picked
        AND tstzrange(rto.starts_at, rto.ends_at, '[)')
            && tstzrange(v_new_start, v_new_end, '[)')
    ) THEN
      v_i := v_i + 1; CONTINUE try_res;
    END IF;

    DECLARE
      v_local_day DATE; v_local_st TIME; v_local_en TIME; v_wd SMALLINT; v_in_r BOOL := FALSE;
    BEGIN
      v_local_day := (v_new_start AT TIME ZONE v_tz)::DATE;
      v_local_st  := (v_new_start AT TIME ZONE v_tz)::TIME;
      v_local_en  := (v_new_end   AT TIME ZONE v_tz)::TIME;
      v_wd := CASE EXTRACT(ISODOW FROM v_local_day) WHEN 7 THEN 0 ELSE CAST(EXTRACT(ISODOW FROM v_local_day) AS SMALLINT) END;

      SELECT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE
          AND ra.weekday = v_wd AND ra.start_time <= v_local_st AND ra.end_time >= v_local_en
      ) INTO v_in_r;

      IF NOT v_in_r AND NOT EXISTS (
        SELECT 1 FROM public.resource_availability ra
        WHERE ra.tenant_id = v_tenant_id AND ra.resource_id = v_picked AND ra.enabled = TRUE AND ra.weekday = v_wd
      ) THEN
        SELECT EXISTS (
          SELECT 1 FROM public.business_availability ba
          WHERE ba.tenant_id = v_tenant_id AND ba.enabled = TRUE AND ba.weekday = v_wd
            AND ba.start_time <= v_local_st AND ba.end_time >= v_local_en
        ) INTO v_in_r;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.business_schedule_exceptions bse
        WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
          AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
          AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                               AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
      ) THEN
        v_in_r := EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'special_hours'
            AND bse.start_time IS NOT NULL AND bse.end_time IS NOT NULL
            AND v_local_day BETWEEN (bse.starts_at AT TIME ZONE v_tz)::DATE
                                 AND (bse.ends_at   AT TIME ZONE v_tz)::DATE
            AND bse.start_time <= v_local_st AND bse.end_time >= v_local_en
        );
      END IF;

      IF NOT v_in_r THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.business_schedule_exceptions bse
          WHERE bse.tenant_id = v_tenant_id AND bse.exception_type = 'extra_open'
            AND tstzrange(bse.starts_at, bse.ends_at, '[)')
                @> tstzrange(v_new_start, v_new_end, '[)')
        ) THEN
          v_i := v_i + 1; CONTINUE try_res;
        END IF;
      END IF;
    END;

    IF v_picked <> v_b.resource_id THEN
      IF NOT ('resource_id' = ANY(v_changed)) THEN
        v_changed := array_append(v_changed, 'resource_id');
      END IF;
    END IF;

    BEGIN
      PERFORM set_config('app.booking_write_trusted', 'true', true);

      UPDATE public.bookings b SET
        starts_at   = v_new_start,
        ends_at     = v_new_end,
        service_id  = v_new_svc,
        resource_id = v_picked,
        revision    = v_b.revision + 1,
        updated_at  = v_now
      WHERE b.id = v_b.id;

      code := 'OK'; message := 'appuntamento aggiornato';
      booking_id_out := v_b.id; revision_out := v_b.revision + 1;
      resource_id_out := v_picked; resource_slug_out := v_picked_slug;
      starts_at_out := v_new_start; ends_at_out := v_new_end;
      service_id_out := v_new_svc; changed_keys := v_changed;

      IF array_length(v_changed, 1) = 1 AND v_changed[1] = 'resource_id' THEN
        v_audit_act := 'booking_resource_assigned';
      ELSE
        v_audit_act := 'booking_rescheduled';
      END IF;

      PERFORM public._audit_insert_trusted(
        v_tenant_id,
        v_audit_act,
        'booking',
        v_b.id,
        jsonb_build_object(
          'from_service_id', v_b.service_id::text,
          'to_service_id', v_new_svc::text,
          'from_resource_id', v_b.resource_id::text,
          'to_resource_id', v_picked::text,
          'from_starts_at', v_b.starts_at::text,
          'to_starts_at', v_new_start::text,
          'from_ends_at', v_b.ends_at::text,
          'to_ends_at', v_new_end::text,
          'revision_before', v_b.revision,
          'revision_after', v_b.revision + 1,
          'source', 'dashboard_manual',
          'created_by_role', v_actor_role,
          'changed_keys', to_jsonb(v_changed)
        )
      );
      RETURN NEXT; RETURN;
    EXCEPTION WHEN exclusion_violation OR SQLSTATE '23P01' THEN
      v_i := v_i + 1; CONTINUE try_res;
    END;
  END LOOP;

  code := 'SLOT_TAKEN'; message := 'nuovo slot occupato'; RETURN NEXT; RETURN;
END; $$;
ALTER FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_booking_reschedule(UUID,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO service_role;
`);

    for (const t of [
      { id: UUIDS.tenantA, slug: TENANT_A_SLUG, name: "F13D Alpha", plan: "pro", published: true },
      { id: UUIDS.tenantB, slug: TENANT_B_SLUG, name: "F13D Beta", plan: "base", published: true },
    ] as const) {
      await c.query(
        `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at)
         VALUES ($1,$2,$3,'active',$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [t.id, t.slug, t.name, t.plan, t.published],
      );
      await c.query(
        `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
         VALUES ($1,$2,'Europe/Rome','it-IT','+3902','info@velora.test','Via Fasulla 123','Milano',NOW(),NOW())`,
        [t.id, `${t.name} SRL`],
      );
      for (const wd of [1, 2, 3, 4, 5]) {
        await c.query(
          `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at)
           VALUES ($1,$2,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [t.id, wd],
        );
      }
    }
    const mkMem = async (user: string, tid: string, role: "owner" | "manager" | "staff") => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [id, user, tid, role],
      );
    };
    await mkMem(userIds["ownerA"]!, UUIDS.tenantA, "owner");
    await mkMem(userIds["managerA"]!, UUIDS.tenantA, "manager");
    await mkMem(userIds["staffA"]!, UUIDS.tenantA, "staff");
    await mkMem(userIds["ownerB"]!, UUIDS.tenantB, "owner");

    for (const s of [
      { id: UUIDS.svcA1, tenant: UUIDS.tenantA, name: "Taglio A Fail", dur: 45, price: 35, pos: 0 },
      {
        id: UUIDS.svcA2,
        tenant: UUIDS.tenantA,
        name: "Massaggio A Fail",
        dur: 30,
        price: 25,
        pos: 1,
      },
    ] as const) {
      await c.query(
        `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5::numeric,'EUR',TRUE,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [s.id, s.tenant, s.name, s.dur, s.price, s.pos],
      );
    }

    const resA = [
      UUIDS.resA1,
      UUIDS.resA2,
      UUIDS.resA3,
      UUIDS.resA4,
      UUIDS.resA5,
      UUIDS.resA6,
      UUIDS.resA7,
      UUIDS.resA8,
      UUIDS.resA9,
      UUIDS.resA10,
    ];
    const colors = [
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#14b8a6",
      "#0ea5e9",
      "#6366f1",
      "#a855f7",
      "#ec4899",
      "#64748b",
    ];
    for (let i = 0; i < resA.length; i++) {
      const id = resA[i];
      await c.query(
        `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
         VALUES ($1,$2,$3,$4,TRUE,TRUE,$5,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [id, UUIDS.tenantA, `a${i + 1}`, `Op ${i + 1} A`, i, colors[i]],
      );
      for (const wd of [1, 2, 3, 4, 5, 6]) {
        const start = wd === 6 ? "09:00" : "09:00";
        const end = wd === 6 ? "13:00" : "18:00";
        await c.query(
          `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
           VALUES ($1,$2,$3,TRUE,$4::time,$5::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, wd, start, end],
        );
      }
      if (i < 3) {
        await c.query(
          `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
           VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, UUIDS.svcA1],
        );
        await c.query(
          `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
           VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, UUIDS.svcA2],
        );
      } else {
        await c.query(
          `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
           VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, UUIDS.svcA2],
        );
      }
    }

    await c.query(
      `INSERT INTO public.customers(id,tenant_id,display_name,email,phone,created_at,updated_at)
       VALUES ($1,$2,'Cliente A1','a1@cust.test','3330000001',NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [UUIDS.custA1, UUIDS.tenantA],
    );

    await c.query(
      `INSERT INTO public.bookings(id,tenant_id,customer_id,resource_id,service_id,status,starts_at,ends_at,customer_name,customer_email,customer_phone,notes,revision,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,'Base F13D','base@f.test','3330000009','Nota base',0,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [
        UUIDS.bookingA,
        UUIDS.tenantA,
        UUIDS.custA1,
        UUIDS.resA1,
        UUIDS.svcA1,
        MON(10, 0),
        END(MON(10, 0), 45),
      ],
    );

    await c.query(
      `INSERT INTO public.business_schedule_exceptions(tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,'extra_open','F13D Global 96h window',NOW() - INTERVAL '3 days', NOW() + INTERVAL '24 hours',NOW(),NOW())`,
      [UUIDS.tenantA],
    );
    await c.query(
      `INSERT INTO public.business_schedule_exceptions(tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,'extra_open','F13D Global 96h window B',NOW() - INTERVAL '3 days', NOW() + INTERVAL '24 hours',NOW(),NOW())`,
      [UUIDS.tenantB],
    );

    await c.query(`COMMIT`);

    scope["ownerA"] = await login(UUIDS.ownerA);
    scope["managerA"] = await login(UUIDS.managerA);
    scope["staffA"] = await login(UUIDS.staffA);
  }, 120_000);

  afterAll(async () => {
    try {
      if (scope["client"]) {
        const c = scope["client"];
        await c.query(`BEGIN`);
        await c.query(`SET LOCAL session_replication_role = replica`);
        await c.query(`DELETE FROM public.audit_logs WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.customers WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(
          `DELETE FROM public.business_schedule_exceptions WHERE tenant_id IN ($1,$2)`,
          [UUIDS.tenantA, UUIDS.tenantB],
        );
        await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.resource_availability WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.staff_resources WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.services WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.business_availability WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(
          `DELETE FROM public.tenant_memberships WHERE user_id IN (SELECT unnest($1::uuid[]))`,
          [
            [
              userIds["ownerA"],
              userIds["managerA"],
              userIds["staffA"],
              userIds["ownerB"],
              userIds["noMember"],
            ].filter(Boolean),
          ],
        );
        const slugPh = [TENANT_A_SLUG, TENANT_B_SLUG].map((_, i) => `$${i + 1}`).join(",");
        await c.query(`DELETE FROM public.business_profiles WHERE tenant_id IN ($1,$2)`, [
          UUIDS.tenantA,
          UUIDS.tenantB,
        ]);
        await c.query(`DELETE FROM public.tenants WHERE slug IN (${slugPh})`, [
          TENANT_A_SLUG,
          TENANT_B_SLUG,
        ]);
        await c.query(`COMMIT;`);
        const svc = serviceClient();
        for (const uid of scope.cleanupIds) {
          if (!uid) continue;
          try {
            await svc.auth.admin.deleteUser(uid);
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      await pgClose();
    }
  }, 120_000);

  it("F1 malformed payload no service_id: write 0 bookings count unchanged", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_starts_at: MON(9, 0),
      p_customer_name: "Bad Svc",
      p_customer_email: "badsvc@test.local",
    });
    expect(r.ok).toBe(false);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
  });

  it("F2 unknown customer_id forged random uuid CUSTOMER_NOT_FOUND no write", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    const forgedCust = randomUUID();
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_customer_id: forgedCust,
      p_service_id: UUIDS.svcA1,
      p_starts_at: MON(9, 0),
    });
    expect(r.ok).toBe(false);
    expect(/CUSTOMER_NOT_FOUND/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
  });

  it("F3 invalid timezone date string starts_at='not a date' rejected VALIDATION_ERROR or throws", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    let threw = false;
    try {
      const r = await rpcManualCreate(scope["ownerA"]!, {
        p_service_id: UUIDS.svcA1,
        p_starts_at: "not a date" as never,
        p_customer_name: "Bad Date",
        p_customer_email: "baddate@test.local",
      });
      if (
        !r.ok &&
        /VALIDATION_ERROR|INVALID_DATE|22007|22008|2200X|internal_error|500|error/i.test(
          `${r.errorCode} ${r.errorMessage}`,
        )
      ) {
        threw = true;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
  });

  it("F4 closure exception inserted between validation/submit BUSINESS_CLOSED", async () => {
    const c = scope["client"];
    const targetStart = DAY(10, 30, 1);
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    try {
      await c.query(`BEGIN`);
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(
        `INSERT INTO public.business_schedule_exceptions(id,tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
         VALUES ($1,$2,'closure','Injected closure F4',$3,$4,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [UUIDS.bseInjected1, UUIDS.tenantA, DAY(9, 0, 1), DAY(18, 0, 1)],
      );
      await c.query(`COMMIT`);
    } catch {
      await c.query(`ROLLBACK`);
    }
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_service_id: UUIDS.svcA1,
      p_starts_at: targetStart,
      p_customer_name: "Injected Close",
      p_customer_email: "injclose@test.local",
    });
    expect(r.ok).toBe(false);
    expect(/BUSINESS_CLOSED/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
    try {
      await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await c.query(`DELETE FROM public.business_schedule_exceptions WHERE id=$1`, [
        UUIDS.bseInjected1,
      ]);
      await c.query(`COMMIT;`);
    } catch {
      await c.query(`ROLLBACK`);
    }
  });

  it("F5 time-off raced: insert rto between load/submit RESOURCE_TIME_OFF or SLOT_TAKEN", async () => {
    const c = scope["client"];
    const targetStart = DAY(15, 0, 2);
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    try {
      await c.query(`BEGIN`);
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(
        `INSERT INTO public.resource_time_off(id,tenant_id,resource_id,time_off_type,title,starts_at,ends_at,created_at,updated_at)
         VALUES ($1,$2,$3,'custom_block','Injected RTO F5',$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [UUIDS.rtoInjected1, UUIDS.tenantA, UUIDS.resA1, DAY(14, 0, 2), DAY(18, 0, 2)],
      );
      await c.query(`COMMIT`);
    } catch {
      await c.query(`ROLLBACK`);
    }
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_service_id: UUIDS.svcA1,
      p_starts_at: targetStart,
      p_resource_slug: "a1",
      p_customer_name: "Injected RTO",
      p_customer_email: "injrto@test.local",
    });
    expect(r.ok).toBe(false);
    expect(/SLOT_TAKEN|RESOURCE_TIME_OFF/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
    try {
      await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await c.query(`DELETE FROM public.resource_time_off WHERE id=$1`, [UUIDS.rtoInjected1]);
      await c.query(`COMMIT;`);
    } catch {
      await c.query(`ROLLBACK`);
    }
  });

  it("F6 GiST conflict during reschedule leaves original UNCHANGED all columns before=after except revision unchanged on failure", async () => {
    const c = scope["client"];
    const before = (
      await c.query(
        `SELECT id, tenant_id, customer_id, service_id, resource_id, status, starts_at, ends_at, revision, customer_name
       FROM public.bookings WHERE id=$1`,
        [UUIDS.bookingA],
      )
    ).rows[0]!;
    try {
      await c.query(`BEGIN`);
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(
        `INSERT INTO public.bookings(id,tenant_id,customer_id,resource_id,service_id,status,starts_at,ends_at,customer_name,revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,'Blocker GiST',9,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          "00000000-0000-4f3d-8008-0000000000ff",
          UUIDS.tenantA,
          UUIDS.custA1,
          UUIDS.resA3,
          UUIDS.svcA1,
          MON(11, 0),
          END(MON(11, 0), 45),
        ],
      );
      await c.query(`COMMIT`);
    } catch {
      await c.query(`ROLLBACK`);
    }
    const r = await rpcReschedule(scope["ownerA"]!, {
      p_booking_id: UUIDS.bookingA,
      p_expected_revision: 0,
      p_new_starts_at: MON(11, 0),
      p_new_resource_slug: "a3",
    });
    expect(r.ok).toBe(false);
    expect(/SLOT_TAKEN/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(
        `SELECT id, tenant_id, customer_id, service_id, resource_id, status, starts_at, ends_at, revision, customer_name
       FROM public.bookings WHERE id=$1`,
        [UUIDS.bookingA],
      )
    ).rows[0]!;
    expect(String(after.starts_at)).toBe(String(before.starts_at));
    expect(String(after.ends_at)).toBe(String(before.ends_at));
    expect(String(after.resource_id)).toBe(String(before.resource_id));
    expect(String(after.service_id)).toBe(String(before.service_id));
    expect(Number(after.revision)).toBe(Number(before.revision));
    expect(String(after.customer_name)).toBe(String(before.customer_name));
  });

  it("F7 stale revision: unchanged booking all columns identical", async () => {
    const c = scope["client"];
    const before = (
      await c.query(
        `SELECT id, starts_at, ends_at, resource_id, service_id, status, revision
       FROM public.bookings WHERE id=$1`,
        [UUIDS.bookingA],
      )
    ).rows[0]!;
    const r = await rpcReschedule(scope["ownerA"]!, {
      p_booking_id: UUIDS.bookingA,
      p_expected_revision: 99999,
      p_new_starts_at: MON(12, 0),
    });
    expect(r.ok).toBe(false);
    expect(/CONCURRENT_UPDATE/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(
        `SELECT id, starts_at, ends_at, resource_id, service_id, status, revision
       FROM public.bookings WHERE id=$1`,
        [UUIDS.bookingA],
      )
    ).rows[0]!;
    expect(String(after.starts_at)).toBe(String(before.starts_at));
    expect(String(after.ends_at)).toBe(String(before.ends_at));
    expect(String(after.resource_id)).toBe(String(before.resource_id));
    expect(Number(after.revision)).toBe(Number(before.revision));
  });

  it("F8 audit insert failure deterministic: revoke execute _audit_insert_trusted manual booking fails partial 0", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    let threw = false;
    try {
      await c.query(
        `REVOKE ALL ON FUNCTION public._audit_insert_trusted(uuid,text,text,uuid,jsonb) FROM postgres, service_role, authenticated, anon, PUBLIC`,
      );
      try {
        const r = await rpcManualCreate(scope["ownerA"]!, {
          p_service_id: UUIDS.svcA1,
          p_starts_at: MON(9, 0),
          p_customer_name: "Audit Fail",
          p_customer_email: "auditfail@test.local",
        });
        if (!r.ok) threw = true;
      } catch {
        threw = true;
      }
    } finally {
      try {
        await c.query(
          `GRANT EXECUTE ON FUNCTION public._audit_insert_trusted(uuid,text,text,uuid,jsonb) TO postgres, service_role, authenticated, anon, PUBLIC`,
        );
      } catch {
        /* ignore */
      }
    }
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
    expect(threw).toBe(true);
  });

  it("F9 customer upsert failure partial invalid email format VALIDATION_ERROR invariant count 0", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    const custBefore = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.customers WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_service_id: UUIDS.svcA1,
      p_starts_at: MON(9, 30),
      p_customer_name: "Bad Email",
      p_customer_email: "",
      p_customer_phone: "",
    });
    expect(r.ok).toBe(false);
    expect(/VALIDATION_ERROR/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    const custAfter = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.customers WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
    expect(custAfter).toBe(custBefore);
  });

  it("F10 service resource eligibility removed between load and submit RESOURCE_NOT_ELIGIBLE", async () => {
    const c = scope["client"];
    const before = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    try {
      await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await c.query(
        `DELETE FROM public.staff_resource_services WHERE tenant_id=$1 AND resource_id=$2 AND service_id=$3`,
        [UUIDS.tenantA, UUIDS.resA2, UUIDS.svcA1],
      );
      await c.query(`COMMIT;`);
    } catch {
      await c.query(`ROLLBACK`);
    }
    const r = await rpcManualCreate(scope["ownerA"]!, {
      p_service_id: UUIDS.svcA1,
      p_starts_at: MON(11, 30),
      p_resource_slug: "a2",
      p_customer_name: "Elig Removed",
      p_customer_email: "eligrem@test.local",
    });
    expect(r.ok).toBe(false);
    expect(/RESOURCE_NOT_ELIGIBLE/.test(`${r.errorCode} ${r.errorMessage}`)).toBe(true);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS cnt FROM public.bookings WHERE tenant_id=$1`, [
        UUIDS.tenantA,
      ])
    ).rows[0]!.cnt;
    expect(after).toBe(before);
    try {
      await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
      await c.query(
        `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
         VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [UUIDS.tenantA, UUIDS.resA2, UUIDS.svcA1],
      );
      await c.query(`COMMIT;`);
    } catch {
      await c.query(`ROLLBACK`);
    }
  });
});
