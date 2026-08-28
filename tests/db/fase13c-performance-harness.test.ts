// @vitest-environment node
import "dotenv/config";
import { Client as PgClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import { describe, it, beforeAll, afterAll, expect } from "vitest";

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
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};

function envOr(name: string): string {
  const v = process.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  const fb = DEFAULT_LOCAL[name];
  if (typeof fb === "string") return fb;
  return "";
}
function failIfUnsafe() {
  const host = envOr("SUPABASE_DB_HOST");
  const project = envOr("SUPABASE_PROJECT_ID");
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && (project.length === 0 || SAFE_PROJECT_IDS.has(project))) ||
    SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error("[perf-harness] unsafe DB env abort");
    process.exit(1);
  }
}
failIfUnsafe();

const DEFAULT_DB = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};
const dbEnv = (n: keyof typeof DEFAULT_DB) => (process.env[n] as string) ?? DEFAULT_DB[n] ?? "";
const buildPgOpts = () => ({
  host: dbEnv("SUPABASE_DB_HOST"),
  port: Number(dbEnv("SUPABASE_DB_PORT") || "54322"),
  database: dbEnv("SUPABASE_DB_NAME"),
  user: dbEnv("SUPABASE_DB_USER"),
  password: dbEnv("SUPABASE_DB_PASSWORD"),
});

const TENANT_PERF_SLUG = "f13-perf-harness-only";
const TENANT_PERF_ID = "00000000-0000-4130-8000-000000000099";
const TZ = "Europe/Rome";
const PERF_OWNER_EMAIL = "perf-f13c-owner@velora.test.local";
const PERF_PASSWORD = "VeloraPerfHarness99!";

/**
 * Performance harness TEST-ONLY.
 *
 * Dataset: 1 dedicated tenant slug='f13-perf-harness-only', 10 active bookable
 * resources, 1 service 30min duration, 10000 historical bookings
 * (confirmed/cancelled 80/20) distributed across 360 days.
 *
 * Measures taken:
 * - EXPLAIN (ANALYZE, BUFFERS) slot V3 1 resource / 10 resources
 * - EXPLAIN (ANALYZE, BUFFERS) Calendar RPC (Day view, Week view)
 * - 5 warmup discarded + ≥45 samples per configuration.
 * - Real min/median/p95/max computed from samples.
 * - JSON payload bytes per Day view / Week view windows.
 * - Planner check: verify no Seq Scan on public.bookings critical overlap path.
 */

let pg: PgClient | null = null;
let svcId: string | null = null;
let fromDate: string | null = null;
let toDate: string | null = null;
let perfOwnerUid: string | null = null;

async function setupTenantResourcesAndBookings(c: PgClient, count: number) {
  await c.query("BEGIN");
  await c.query(
    `INSERT INTO public.tenants(id, slug, name, plan_id, published, created_at, updated_at)
     VALUES ($1::uuid, $2, 'F13 Performance Harness', 'base', TRUE, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [TENANT_PERF_ID, TENANT_PERF_SLUG],
  );
  await c.query(
    `INSERT INTO public.business_profiles(tenant_id, display_name, category, city, province, phone, email, locale, timezone, created_at, updated_at, theme_primary, theme_background, theme_foreground, theme_muted, theme_radius, theme_heading_font_preset, theme_body_font_preset)
     VALUES ($1::uuid, 'F13 Perf Studio', 'Servizi', 'Performance', 'PF', '+39 00 00000000', 'f13-perf@velora.test', 'it', $2::text, NOW(), NOW(), '#0f766e', '#fafafa', '#0f172a', '#6b7280', 'lg', 'sans', 'sans')
     ON CONFLICT DO NOTHING`,
    [TENANT_PERF_ID, TZ],
  );
  for (let wd = 0; wd < 7; wd++) {
    const enabled = wd !== 0;
    await c.query(
      `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, '09:00'::time, '18:00'::time, NOW(), NOW())
       ON CONFLICT (tenant_id, weekday) DO UPDATE SET enabled=EXCLUDED.enabled, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time`,
      [TENANT_PERF_ID, wd, enabled],
    );
  }
  const svc = await c.query(
    `INSERT INTO public.services(id, tenant_id, name, duration_minutes, active, description, price_from, currency, created_at, updated_at, position)
     VALUES (gen_random_uuid(), $1::uuid, 'Performance taglio 30', 30, TRUE, 'svc perf', 25.00::numeric, 'EUR', NOW(), NOW(), 1)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [TENANT_PERF_ID],
  );
  svcId = (svc.rows[0]?.id as string) ?? null;
  if (!svcId) {
    const s = await c.query(
      "SELECT id FROM public.services WHERE tenant_id=$1 AND name='Performance taglio 30' LIMIT 1",
      [TENANT_PERF_ID],
    );
    svcId = s.rows[0]!.id as string;
  }
  for (let i = 1; i <= 10; i++) {
    await c.query(
      `INSERT INTO public.staff_resources(tenant_id, slug, display_name, active, bookable, sort_order, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, TRUE, TRUE, $4, NOW(), NOW())
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [TENANT_PERF_ID, `perf-op-${String(i).padStart(2, "0")}`, `Perf Op ${i}`, i * 10],
    );
  }
  const resources = await c.query(
    "SELECT id, slug FROM public.staff_resources WHERE tenant_id=$1 ORDER BY sort_order ASC, id ASC",
    [TENANT_PERF_ID],
  );
  if (resources.rows.length !== 10) {
    throw new Error(`expected 10 perf resources got ${resources.rows.length}`);
  }
  await c.query("SET LOCAL session_replication_role = replica");
  await c.query(`DELETE FROM public.bookings WHERE tenant_id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query("SET LOCAL session_replication_role = DEFAULT");
  await c.query("COMMIT");
  const baseDate = new Date(Date.UTC(2026, 0, 5));
  let bookingsInserted = 0;
  let attempts = 0;
  const dayMs = 24 * 3600 * 1000;
  const hourMs = 3600 * 1000;
  const minuteMs = 60 * 1000;
  outer: while (bookingsInserted < count && attempts < count * 50) {
    const day = Math.floor(Math.random() * 360);
    const d = new Date(baseDate.getTime() + day * dayMs);
    const dow = d.getUTCDay();
    if (dow === 0) continue;
    const opIdx = Math.floor(Math.random() * 10);
    const opId = resources.rows[opIdx]!.id as string;
    const s = 9 * 4 + Math.floor(Math.random() * 8 * 4);
    const startsAt = new Date(d.getTime() + Math.floor(s / 4) * hourMs + (s % 4) * 15 * minuteMs);
    const confirmed = Math.random() < 0.8;
    const result = await c
      .query(
        `INSERT INTO public.bookings(id, tenant_id, service_id, resource_id, starts_at, ends_at, status, customer_name, customer_email)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '30 minutes', $5, 'Historical Perf Customer', 'f13-perf-historical@velora.test')
         ON CONFLICT DO NOTHING`,
        [
          TENANT_PERF_ID,
          svcId,
          opId,
          startsAt.toISOString(),
          confirmed ? "confirmed" : "cancelled",
        ],
      )
      .catch(() => null);
    attempts++;
    if (result && typeof result.rowCount === "number" && result.rowCount > 0) {
      bookingsInserted++;
      if (bookingsInserted >= count) break outer;
    }
  }
  if (bookingsInserted < count) {
    throw new Error(`only inserted ${bookingsInserted}/${count} historical bookings`);
  }
  const today = new Date();
  const todayPlus2 = new Date(today.getTime() + 2 * dayMs);
  const todayPlus8 = new Date(today.getTime() + 8 * dayMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  fromDate = `${todayPlus2.getUTCFullYear()}-${pad(todayPlus2.getUTCMonth() + 1)}-${pad(todayPlus2.getUTCDate())}`;
  toDate = `${todayPlus8.getUTCFullYear()}-${pad(todayPlus8.getUTCMonth() + 1)}-${pad(todayPlus8.getUTCDate())}`;
  await c.query("COMMIT");
  return { bookingsInserted };
}

async function impersonateOwner(c: PgClient, uid: string) {
  await c.query(`SET ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1::text, false)`, [uid]);
  await c.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);
}

async function cleanup(c: PgClient) {
  await c.query("ROLLBACK").catch(() => {});
  await c.query("RESET ROLE");
  await c.query("BEGIN");
  await c.query("SET LOCAL session_replication_role = replica");
  await c.query(`DELETE FROM public.tenant_memberships WHERE tenant_id = $1::uuid`, [
    TENANT_PERF_ID,
  ]);
  await c
    .query(
      `DELETE FROM public.profiles WHERE id IN (
    SELECT user_id FROM public.tenant_memberships WHERE tenant_id = $1::uuid
  )`,
      [TENANT_PERF_ID],
    )
    .catch(() => {});
  await c.query(`DELETE FROM public.audit_logs WHERE tenant_id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query(`DELETE FROM public.bookings WHERE tenant_id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id = $1::uuid`, [
    TENANT_PERF_ID,
  ]);
  await c.query(`DELETE FROM public.staff_resources WHERE tenant_id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query("SET LOCAL session_replication_role = DEFAULT");
  await c.query(`DELETE FROM public.business_availability WHERE tenant_id = $1::uuid`, [
    TENANT_PERF_ID,
  ]);
  await c.query(`DELETE FROM public.business_profiles WHERE tenant_id = $1::uuid`, [
    TENANT_PERF_ID,
  ]);
  await c.query(`DELETE FROM public.services WHERE tenant_id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query(`DELETE FROM public.tenants WHERE id = $1::uuid`, [TENANT_PERF_ID]);
  await c.query("COMMIT");
}

describe("F13 Performance harness (TEST-ONLY)", () => {
  beforeAll(async () => {
    pg = new PgClient(buildPgOpts());
    await pg.connect();
    await cleanup(pg);
    const r = await setupTenantResourcesAndBookings(pg, 10000);
    envOr("SUPABASE_SERVICE_ROLE_KEY");
    expect(r.bookingsInserted).toBeGreaterThanOrEqual(10000);
    const sbSvc = createClient(
      envOr("NEXT_PUBLIC_SUPABASE_URL"),
      envOr("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
    const ex = await sbSvc.auth.admin.listUsers().catch(() => ({ data: { users: [] } }));
    const prior = (ex.data?.users ?? []).find((u) => u.email === PERF_OWNER_EMAIL);
    if (prior) {
      perfOwnerUid = prior.id;
    } else {
      const created = await sbSvc.auth.admin.createUser({
        email: PERF_OWNER_EMAIL,
        password: PERF_PASSWORD,
        email_confirm: true,
        user_metadata: { name: "Perf Owner F13C" },
      });
      if (!created.error && created.data.user?.id) {
        perfOwnerUid = created.data.user.id;
      } else if (created.error?.message?.includes("already been registered")) {
        const direct = await pg!.query(`SELECT id FROM auth.users WHERE email = $1::text LIMIT 1`, [
          PERF_OWNER_EMAIL,
        ]);
        if (direct.rows?.[0]?.id) perfOwnerUid = direct.rows[0].id;
      }
    }
    if (!perfOwnerUid) {
      const PERF_UID = "11111111-1111-1111-1111-0000000000f1";
      const direct = await pg!.query(`SELECT id FROM auth.users WHERE email = $1::text LIMIT 1`, [
        PERF_OWNER_EMAIL,
      ]);
      if (direct.rows?.[0]?.id) {
        perfOwnerUid = direct.rows[0].id;
      } else {
        await pg!.query(
          `INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
              raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
              banned_until, deleted_at, is_sso_user, is_anonymous,
              confirmation_token, recovery_token, email_change_token_new, email_change,
              phone_change_token, phone_change, reauthentication_token)
            VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
              'authenticated','authenticated', $2::text,
              public.crypt($3::text, public.gen_salt('bf')), NOW(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Perf Owner F13C"}'::jsonb,
              NULL, NOW(), NOW(), NULL, NULL, false, false,
              '','','','','','','')
            ON CONFLICT (id) DO NOTHING`,
          [PERF_UID, PERF_OWNER_EMAIL, PERF_PASSWORD],
        );
        perfOwnerUid = PERF_UID;
      }
    }
    if (!perfOwnerUid) throw new Error("perfOwnerUid not resolved (create/find/query failed)");
    await pg!.query(
      `INSERT INTO public.profiles(id, display_name, created_at, updated_at)
       VALUES ($1::uuid, 'Perf Owner F13C', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name`,
      [perfOwnerUid],
    );
    await pg!.query(
      `INSERT INTO public.tenant_memberships(tenant_id, user_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'owner', 'active', NOW(), NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status`,
      [TENANT_PERF_ID, perfOwnerUid],
    );
  }, 360_000);

  afterAll(async () => {
    if (pg && perfOwnerUid) {
      try {
        await pg.query("RESET ROLE");
        await pg
          .query(`DELETE FROM public.tenant_memberships WHERE user_id=$1::uuid`, [perfOwnerUid])
          .catch(() => {});
        await pg
          .query(`DELETE FROM public.profiles WHERE id=$1::uuid`, [perfOwnerUid])
          .catch(() => {});
        const sbSvc = createClient(
          envOr("NEXT_PUBLIC_SUPABASE_URL"),
          envOr("SUPABASE_SERVICE_ROLE_KEY"),
          {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          },
        );
        await sbSvc.auth.admin.deleteUser(perfOwnerUid).catch(() => {});
      } catch (_e) {
        /* non-blocking */
      }
    }
    if (pg) {
      await cleanup(pg);
      await pg.end().catch(() => {});
      pg = null;
    }
  });

  it("P13-1 dataset >= 10000 historical bookings confirmed+mix", async () => {
    const r = await pg!.query(
      "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed FROM public.bookings WHERE tenant_id=$1",
      [TENANT_PERF_ID],
    );
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(10000);
    expect(r.rows[0]!.confirmed).toBeGreaterThanOrEqual(7000);
  });

  it("P13-2 EXPLAIN ANALYZE 1 resource path: NO Seq Scan public.bookings overlap", async () => {
    const res = await pg!.query({
      rowMode: "array",
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
             SELECT * FROM public.public_slot_get_available_v3($1::text, $2::uuid, $3::date, $4::date, $5::text)`,
      values: [TENANT_PERF_SLUG, svcId!, fromDate!, toDate!, "perf-op-01"],
    });
    const planLines = (res.rows as string[][]).map((r) => r[0] as string);
    const plan = planLines.join("\n");
    // Accept planner choice; only document Seq Scan.
    const seqOnBookings =
      /Seq Scan on public\.bookings/i.test(plan) || /Seq Scan on bookings/i.test(plan);
    expect(seqOnBookings).toBe(false);
    console.warn(`  [plan-1res] lines=${planLines.length} firstLine=${planLines[0] ?? ""}`);
  });

  it("P13-3 EXPLAIN ANALYZE 10 resources ANY mode planner", async () => {
    const res = await pg!.query({
      rowMode: "array",
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
             SELECT * FROM public.public_slot_get_available_v3($1::text, $2::uuid, $3::date, $4::date, 'any')`,
      values: [TENANT_PERF_SLUG, svcId!, fromDate!, toDate!],
    });
    const planLines = (res.rows as string[][]).map((r) => r[0] as string);
    const plan = planLines.join("\n");
    const seqOnBookings =
      /Seq Scan on public\.bookings/i.test(plan) || /Seq Scan on bookings/i.test(plan);
    expect(seqOnBookings).toBe(false);
    console.warn(`  [plan-10res] lines=${planLines.length}`);
  });

  it("P13-4 warm 50 calls slot V3 1 resource → compute real min/median/p95/max", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = process.hrtime.bigint();
      await pg!.query(
        `SELECT * FROM public.public_slot_get_available_v3($1::text, $2::uuid, $3::date, $4::date, $5::text)`,
        [TENANT_PERF_SLUG, svcId!, fromDate!, toDate!, "perf-op-01"],
      );
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= 5) samples.push(dt);
    }
    samples.sort((a, b) => a - b);
    const min = samples[0]!;
    const median = samples[Math.floor(samples.length / 2)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const max = samples[samples.length - 1]!;
    console.warn(
      `  [perf-1res samples=${samples.length}] min=${min.toFixed(1)}ms median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(45);
    expect(min).toBeGreaterThan(0);
    expect(p95).toBeLessThanOrEqual(600);
  });

  it("P13-5 warm 50 calls slot V3 10 resources ANY → real min/median/p95/max", async () => {
    const samples: number[] = [];
    let payloadBytes = 0;
    for (let i = 0; i < 50; i++) {
      const t0 = process.hrtime.bigint();
      const r = await pg!.query(
        `SELECT * FROM public.public_slot_get_available_v3($1::text, $2::uuid, $3::date, $4::date, 'any')`,
        [TENANT_PERF_SLUG, svcId!, fromDate!, toDate!],
      );
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= 5) {
        samples.push(dt);
        payloadBytes = Math.max(payloadBytes, Buffer.byteLength(JSON.stringify(r.rows), "utf8"));
      }
    }
    samples.sort((a, b) => a - b);
    const min = samples[0]!;
    const median = samples[Math.floor(samples.length / 2)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const max = samples[samples.length - 1]!;
    console.warn(
      `  [perf-10res samples=${samples.length}] min=${min.toFixed(1)}ms median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms payload=${payloadBytes}B`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(45);
    expect(min).toBeGreaterThan(0);
    (globalThis as unknown as { __f13c_last_payload_bytes?: number }).__f13c_last_payload_bytes =
      payloadBytes;
  });

  it("P13-6 EXPLAIN ANALYZE Calendar Day view: NO Seq Scan public.bookings overlap", async () => {
    expect(perfOwnerUid).not.toBeNull();
    const base = new Date(`${fromDate}T00:00:00Z`);
    const rStart = new Date(base.valueOf() - 2 * 3600_000).toISOString();
    const rEnd = new Date(base.valueOf() + 22 * 3600_000).toISOString();
    await impersonateOwner(pg!, perfOwnerUid!);
    const plan = await pg!.query({
      rowMode: "array",
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
             SELECT * FROM public.dashboard_calendar_get_range($1::timestamptz, $2::timestamptz, NULL, ARRAY['confirmed','completed','no_show','cancelled']::text[])`,
      values: [rStart, rEnd],
    });
    const planLines = (plan.rows as string[][]).map((r) => r[0] as string);
    const planText = planLines.join("\n");
    const seqOnBookings =
      /Seq Scan on public\.bookings/i.test(planText) || /Seq Scan on bookings/i.test(planText);
    expect(seqOnBookings).toBe(false);
    console.warn(`  [plan-cal-day] lines=${planLines.length} firstLine=${planLines[0] ?? ""}`);
  });

  it("P13-7 EXPLAIN ANALYZE Calendar Week view: NO Seq Scan public.bookings overlap", async () => {
    expect(perfOwnerUid).not.toBeNull();
    const base = new Date(`${fromDate}T00:00:00Z`);
    const rStart = new Date(base.valueOf() - 2 * 3600_000).toISOString();
    const rEnd = new Date(base.valueOf() + 7 * 86400_000 - 2 * 3600_000).toISOString();
    await impersonateOwner(pg!, perfOwnerUid!);
    const plan = await pg!.query({
      rowMode: "array",
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
             SELECT * FROM public.dashboard_calendar_get_range($1::timestamptz, $2::timestamptz, NULL, ARRAY['confirmed','completed','no_show','cancelled']::text[])`,
      values: [rStart, rEnd],
    });
    const planLines = (plan.rows as string[][]).map((r) => r[0] as string);
    const planText = planLines.join("\n");
    const seqOnBookings =
      /Seq Scan on public\.bookings/i.test(planText) || /Seq Scan on bookings/i.test(planText);
    expect(seqOnBookings).toBe(false);
    console.warn(`  [plan-cal-week] lines=${planLines.length}`);
  });

  it("P13-8 warm 50 calls Calendar Day 1d window → p95 ≤ 150ms, payload ≤ 100KB", async () => {
    expect(perfOwnerUid).not.toBeNull();
    const base = new Date(`${fromDate}T00:00:00Z`);
    const rStart = new Date(base.valueOf() - 2 * 3600_000).toISOString();
    const rEnd = new Date(base.valueOf() + 22 * 3600_000).toISOString();
    await impersonateOwner(pg!, perfOwnerUid!);
    const samples: number[] = [];
    let payloadBytes = 0;
    for (let i = 0; i < 50; i++) {
      const t0 = process.hrtime.bigint();
      const r = await pg!.query(
        `SELECT * FROM public.dashboard_calendar_get_range($1::timestamptz, $2::timestamptz, NULL, ARRAY['confirmed','completed','no_show','cancelled']::text[])`,
        [rStart, rEnd],
      );
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= 5) {
        samples.push(dt);
        payloadBytes = Math.max(payloadBytes, Buffer.byteLength(JSON.stringify(r.rows), "utf8"));
      }
    }
    samples.sort((a, b) => a - b);
    const min = samples[0]!;
    const median = samples[Math.floor(samples.length / 2)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const max = samples[samples.length - 1]!;
    console.warn(
      `  [cal-day samples=${samples.length}] min=${min.toFixed(1)}ms median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms payload=${payloadBytes}B (≤100KB? ${payloadBytes <= 100_000})`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(45);
    expect(min).toBeGreaterThan(0);
    expect(p95).toBeLessThanOrEqual(150);
    expect(payloadBytes).toBeLessThanOrEqual(100_000);
  });

  it("P13-9 warm 50 calls Calendar Week 7d window → p95 ≤ 250ms, payload ≤ 500KB", async () => {
    expect(perfOwnerUid).not.toBeNull();
    const base = new Date(`${fromDate}T00:00:00Z`);
    const rStart = new Date(base.valueOf() - 2 * 3600_000).toISOString();
    const rEnd = new Date(base.valueOf() + 7 * 86400_000 - 2 * 3600_000).toISOString();
    await impersonateOwner(pg!, perfOwnerUid!);
    const samples: number[] = [];
    let payloadBytes = 0;
    for (let i = 0; i < 50; i++) {
      const t0 = process.hrtime.bigint();
      const r = await pg!.query(
        `SELECT * FROM public.dashboard_calendar_get_range($1::timestamptz, $2::timestamptz, NULL, ARRAY['confirmed','completed','no_show','cancelled']::text[])`,
        [rStart, rEnd],
      );
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      if (i >= 5) {
        samples.push(dt);
        payloadBytes = Math.max(payloadBytes, Buffer.byteLength(JSON.stringify(r.rows), "utf8"));
      }
    }
    samples.sort((a, b) => a - b);
    const min = samples[0]!;
    const median = samples[Math.floor(samples.length / 2)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const max = samples[samples.length - 1]!;
    console.warn(
      `  [cal-week samples=${samples.length}] min=${min.toFixed(1)}ms median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms payload=${payloadBytes}B (≤500KB? ${payloadBytes <= 500_000})`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(45);
    expect(min).toBeGreaterThan(0);
    expect(p95).toBeLessThanOrEqual(250);
    expect(payloadBytes).toBeLessThanOrEqual(500_000);
  });
});
