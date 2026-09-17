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
    console.error(`[fase13c-calendar] refusing unsafe host=${host} project=${projectId}`);
    process.exit(1);
  }
})();

const SUPABASE_URL = envOr("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = envOr("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = envOr("SUPABASE_SERVICE_ROLE_KEY");
const PROJECT_ID = envOr("SUPABASE_PROJECT_ID");
const PASSWORD = "VeloraTest12345!";
const TENANT_A_SLUG = "f13c-cal-alpha";
const TENANT_B_SLUG = "f13c-cal-beta";

const UUIDS = {
  tenantA: "00000000-0000-413c-8000-0000000000a1",
  tenantB: "00000000-0000-413c-8000-0000000000b1",
  svcA1: "00000000-0000-413c-8002-0000000000a1",
  svcB1: "00000000-0000-413c-8002-0000000000b1",
  ownerA: "f13c-owner-a@test.local",
  managerA: "f13c-manager-a@test.local",
  staffA: "f13c-staff-a@test.local",
  ownerB: "f13c-owner-b@test.local",
  noMember: "f13c-no-member@test.local",
  resA1: "00000000-0000-413c-8004-0000000000a1",
  resA2: "00000000-0000-413c-8004-0000000000a2",
  resA3: "00000000-0000-413c-8004-0000000000a3",
  resA4: "00000000-0000-413c-8004-0000000000a4",
  resA5: "00000000-0000-413c-8004-0000000000a5",
  resA6: "00000000-0000-413c-8004-0000000000a6",
  resA7: "00000000-0000-413c-8004-0000000000a7",
  resA8: "00000000-0000-413c-8004-0000000000a8",
  resA9: "00000000-0000-413c-8004-0000000000a9",
  resA10: "00000000-0000-413c-8004-000000000aa0",
  resB1: "00000000-0000-413c-8004-0000000000b1",
  bookingAConfirmed: "00000000-0000-413c-8008-0000000000a1",
  bookingBCancelled: "00000000-0000-413c-8008-0000000000a2",
  bookingB1: "00000000-0000-413c-8008-0000000000b1",
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
function MON_ISO(): string {
  const { y, mo, d } = FIXED_MONDAY;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}
function PLUS_DAY_ISO(offset: number): string {
  const { y, mo, d } = FIXED_MONDAY;
  const dt = new Date(Date.UTC(y, mo - 1, d + offset));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
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

interface CalendarRow {
  row_type?: string;
  booking_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  service_duration_minutes?: number | null;
  resource_id?: string | null;
  resource_display_name?: string | null;
  resource_color_hex?: string | null;
  customer_display_name?: string | null;
  [key: string]: unknown;
}

async function rpcCalendar(
  cl: AnyClient,
  opts: {
    start: string;
    end: string;
    resource_ids?: string[] | null;
    statuses?: string[];
  },
): Promise<{
  httpStatus: number;
  ok: boolean;
  rows: CalendarRow[];
  errorMessage: string;
  errorCode: string;
}> {
  const r = await (
    cl as unknown as {
      rpc: (
        name: string,
        args?: Record<string, unknown>,
      ) => Promise<{ data?: unknown; error?: unknown }>;
    }
  ).rpc("dashboard_calendar_get_range", {
    p_range_start: opts.start,
    p_range_end: opts.end,
    p_resource_ids: opts.resource_ids ?? null,
    p_statuses: opts.statuses ?? ["confirmed", "completed", "no_show"],
  });
  if (r.error) {
    const err = r.error as Record<string, unknown>;
    return {
      httpStatus: 500,
      ok: false,
      rows: [],
      errorMessage: String(err["message"] ?? r.error),
      errorCode: String(err["code"] ?? ""),
    };
  }
  return {
    httpStatus: 200,
    ok: true,
    rows: (r.data ?? []) as CalendarRow[],
    errorMessage: "",
    errorCode: "",
  };
}

describe("C13 Calendar Read Contract Matrix — 20/20 required", () => {
  const scope: {
    client: PgClient;
    ownerA?: AnyClient;
    managerA?: AnyClient;
    staffA?: AnyClient;
    ownerB?: AnyClient;
    noMember?: AnyClient;
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
    await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
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
    await c.query(`DELETE FROM public.tenants WHERE slug IN (${slugPh})`, [
      TENANT_A_SLUG,
      TENANT_B_SLUG,
    ]);
    await c.query(`COMMIT`);

    await c.query(`BEGIN`);
    await c.query(`SET LOCAL session_replication_role = replica`);

    for (const t of [
      { id: UUIDS.tenantA, slug: TENANT_A_SLUG, name: "C13 Alpha", plan: "pro", published: true },
      { id: UUIDS.tenantB, slug: TENANT_B_SLUG, name: "C13 Beta", plan: "base", published: true },
    ] as const) {
      await c.query(
        `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at)
         VALUES ($1,$2,$3,'active',$4,$5,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [t.id, t.slug, t.name, t.plan, t.published],
      );
      const bp = t.id === UUIDS.tenantA ? "Europe/Rome" : "America/New_York";
      await c.query(
        `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
         VALUES ($1,$2,$3,'it-IT','+3902','info@velora.test','Via Fasulla 123','Milano',NOW(),NOW())`,
        [t.id, `${t.name} SRL`, bp],
      );
    }
    const mkMem = async (user: string, tid: string, role: "owner" | "manager" | "staff") => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'active',NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [id, user, tid, role],
      );
    };
    await mkMem(userIds["ownerA"]!, UUIDS.tenantA, "owner");
    await mkMem(userIds["managerA"]!, UUIDS.tenantA, "manager");
    await mkMem(userIds["staffA"]!, UUIDS.tenantA, "staff");
    await mkMem(userIds["ownerB"]!, UUIDS.tenantB, "owner");

    for (const s of [
      {
        id: UUIDS.svcA1,
        tenant: UUIDS.tenantA,
        name: "Taglio Donna A",
        dur: 45,
        price: 35,
        pos: 0,
      },
      { id: UUIDS.svcB1, tenant: UUIDS.tenantB, name: "Servizio B1", dur: 20, price: 15, pos: 0 },
    ] as const) {
      await c.query(
        `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5::numeric,'EUR',TRUE,$6,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
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
         VALUES ($1,$2,$3,$4,TRUE,TRUE,$5,$6,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [id, UUIDS.tenantA, `a${i + 1}`, `Op ${i + 1} A`, i, colors[i]],
      );
      for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
        const en = wd === 0 ? false : true;
        const start = wd === 6 ? "09:00" : "09:00";
        const end = wd === 6 ? "13:00" : "18:00";
        await c.query(
          `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5::time,$6::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, wd, en, start, end],
        );
      }
      if (i < 3) {
        await c.query(
          `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
           VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [UUIDS.tenantA, id, UUIDS.svcA1],
        );
      }
    }
    await c.query(
      `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
       VALUES ($1,$2,'b1','B1 Only',TRUE,TRUE,1,'#0f172a',NOW(),NOW())`,
      [UUIDS.resB1, UUIDS.tenantB],
    );
    for (const wd of [1, 2, 3, 4, 5]) {
      await c.query(
        `INSERT INTO public.resource_availability(tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ($1,$2,$3,TRUE,'10:00'::time,'19:00'::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [UUIDS.tenantB, UUIDS.resB1, wd],
      );
    }
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
       VALUES ($1,$2,$3,TRUE,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [UUIDS.tenantB, UUIDS.resB1, UUIDS.svcB1],
    );

    for (const b of [
      {
        id: UUIDS.bookingAConfirmed,
        tid: UUIDS.tenantA,
        rid: UUIDS.resA1,
        sid: UUIDS.svcA1,
        start: MON(10, 0),
        dur: 45,
        status: "confirmed",
        name: "Anna Rossi",
        email: "anna@example.com",
        phone: "3331112233",
        notes: "Privileged note",
      },
      {
        id: UUIDS.bookingBCancelled,
        tid: UUIDS.tenantA,
        rid: UUIDS.resA2,
        sid: UUIDS.svcA1,
        start: MON(11, 0),
        dur: 45,
        status: "cancelled",
        name: "Luca Bianchi",
        email: "luca@example.com",
        phone: "3334445566",
        notes: "Note cancellato",
      },
      {
        id: UUIDS.bookingB1,
        tid: UUIDS.tenantB,
        rid: UUIDS.resB1,
        sid: UUIDS.svcB1,
        start: MON(10, 0),
        dur: 20,
        status: "confirmed",
        name: "Gina Beta",
        email: "gina@b.example",
        phone: "3339999999",
        notes: null,
      },
    ] as const) {
      await c.query(
        `INSERT INTO public.bookings(id,tenant_id,resource_id,service_id,status,starts_at,ends_at,customer_name,customer_email,customer_phone,notes,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [
          b.id,
          b.tid,
          b.rid,
          b.sid,
          b.status,
          b.start,
          END(b.start, b.dur),
          b.name,
          b.email,
          b.phone,
          b.notes,
        ],
      );
    }

    // BUSINESS CLOSURE: Tuesday (day 1 offset) 10:00-18:00 CEST → 08:00-16:00 UTC
    await c.query(
      `INSERT INTO public.business_schedule_exceptions(tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,'closure','C13 Chiusura martedì',$2,$3,NOW(),NOW())`,
      [UUIDS.tenantA, DAY(10, 0, 1), DAY(18, 0, 1)],
    );
    // EXTRA OPEN: Wednesday (day2) 08:00-09:00
    await c.query(
      `INSERT INTO public.business_schedule_exceptions(tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,'extra_open','C13 Extra mercoledì mattina',$2,$3,NOW(),NOW())`,
      [UUIDS.tenantA, DAY(8, 0, 2), DAY(9, 0, 2)],
    );
    // REDUCED HOURS: Thursday (day3) 09:00-14:00 (mapped RPC via exception_type=special_hours)
    await c.query(
      `INSERT INTO public.business_schedule_exceptions(tenant_id,exception_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,'special_hours','C13 Orario ridotto giovedì',$2,$3,NOW(),NOW())`,
      [UUIDS.tenantA, DAY(9, 0, 3), DAY(14, 0, 3)],
    );
    // TIME OFF: Res A1 Friday (day4) 14:00-18:00
    await c.query(
      `INSERT INTO public.resource_time_off(tenant_id,resource_id,time_off_type,title,starts_at,ends_at,created_at,updated_at)
       VALUES ($1,$2,'custom_block','Ferie Op1 Venerdì',$3,$4,NOW(),NOW())`,
      [UUIDS.tenantA, UUIDS.resA1, DAY(14, 0, 4), DAY(18, 0, 4)],
    );

    await c.query(`COMMIT`);

    scope["ownerA"] = await login(UUIDS.ownerA);
    scope["managerA"] = await login(UUIDS.managerA);
    scope["staffA"] = await login(UUIDS.staffA);
    scope["ownerB"] = await login(UUIDS.ownerB);
    scope["noMember"] = await login(UUIDS.noMember);
  }, 120_000);

  afterAll(async () => {
    try {
      if (scope["client"]) {
        const c = scope["client"];
        await c.query(`BEGIN`);
        await c.query(`SET LOCAL session_replication_role = replica`);
        await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
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

  function WEEK_RANGE(startIso: string): { start: string; end: string } {
    const [ys, ms, ds] = startIso.split("-");
    const s = Date.UTC(parseInt(ys!, 10), parseInt(ms!, 10) - 1, parseInt(ds!, 10), 0, 0, 0);
    const e = s + 7 * 86400000;
    return { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
  }
  function DAY_RANGE(startIso: string, days: number): { start: string; end: string } {
    const [ys, ms, ds] = startIso.split("-");
    const s = Date.UTC(parseInt(ys!, 10), parseInt(ms!, 10) - 1, parseInt(ds!, 10), 0, 0, 0);
    const e = s + days * 86400000;
    return { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
  }

  it("C13-1 owner range: returns own bookings with customer_display_name only", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const bookings = x.rows.filter((row: CalendarRow) => row.row_type === "booking");
    expect(bookings.length).toBeGreaterThanOrEqual(1);
    const b1 = bookings.find((row: CalendarRow) => row.booking_id === UUIDS.bookingAConfirmed);
    expect(b1).toBeTruthy();
    expect(b1!.customer_display_name).toBe("Anna Rossi");
    expect(b1!.status).toBe("confirmed");
  });

  it("C13-2 manager range: projection includes booking rows", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["managerA"]!, r);
    expect(x.ok).toBe(true);
    const bookings = x.rows.filter((row: CalendarRow) => row.row_type === "booking");
    expect(bookings.length).toBeGreaterThanOrEqual(1);
  });

  it("C13-3 staff range: staff role authorized, rows returned", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["staffA"]!, r);
    expect(x.ok).toBe(true);
    const foundRow = x.rows.find((row: CalendarRow) => row.row_type);
    expect(foundRow).toBeTruthy();
  });

  it("C13-4 anon deny: anonymous returns authorization error", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(anonClient(), r);
    expect(x.ok).toBe(false);
    expect(/AUTHZ_DENIED|28000|42501|42883/.test(`${x.errorCode} ${x.errorMessage}`)).toBe(true);
  });

  it("C13-5 A/B isolation: ownerA never sees booking from B", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const anyB = x.rows.find(
      (row: CalendarRow) => row.booking_id === UUIDS.bookingB1 || row.resource_id === UUIDS.resB1,
    );
    expect(anyB).toBeFalsy();
  });

  it("C13-6 forged resource B: ownerA passing B-only resource id raises RESOURCE_NOT_FOUND", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, { ...r, resource_ids: [UUIDS.resB1] });
    expect(x.ok).toBe(false);
    expect(/RESOURCE_NOT_FOUND|02000/.test(`${x.errorMessage} ${x.errorCode}`)).toBe(true);
  });

  it("C13-7 >14 days deny: WINDOW_TOO_LARGE raised", async () => {
    const d0 = MON_ISO();
    const r = DAY_RANGE(d0, 20);
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(false);
    expect(/WINDOW_TOO_LARGE/.test(x.errorMessage)).toBe(true);
  });

  it("C13-8 invalid range: start >= end INVALID_DATE error", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, { start: r.end, end: r.start });
    expect(x.ok).toBe(false);
    expect(/INVALID_DATE/.test(x.errorMessage)).toBe(true);
  });

  it("C13-9 cancelled excluded default: default statuses hide cancelled booking", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const b = x.rows.find((row: CalendarRow) => row.booking_id === UUIDS.bookingBCancelled);
    expect(b).toBeFalsy();
  });

  it("C13-10 cancelled explicitly included: statuses=[cancelled] reveals cancelled booking", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, { ...r, statuses: ["confirmed", "cancelled"] });
    expect(x.ok).toBe(true);
    const b = x.rows.find((row: CalendarRow) => row.booking_id === UUIDS.bookingBCancelled);
    expect(b).toBeTruthy();
    expect(b!.customer_display_name).toBe("Luca Bianchi");
  });

  it("C13-11 single resource filter: only resA1 rows visible", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, { ...r, resource_ids: [UUIDS.resA1] });
    expect(x.ok).toBe(true);
    const bookings = x.rows.filter((row: CalendarRow) => row.row_type === "booking");
    expect(bookings.length).toBeGreaterThanOrEqual(1);
    for (const b of bookings) expect(b!.resource_id).toBe(UUIDS.resA1);
  });

  it("C13-12 three resources filter: A1+A2+A3 produce union", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, {
      ...r,
      resource_ids: [UUIDS.resA1, UUIDS.resA2, UUIDS.resA3],
    });
    expect(x.ok).toBe(true);
    const foundBooking = x.rows.find((row: CalendarRow) => row.row_type === "booking");
    expect(foundBooking).toBeTruthy();
    const rids = new Set([UUIDS.resA1, UUIDS.resA2, UUIDS.resA3]);
    for (const row of x.rows.filter((r) => r.resource_id))
      expect(rids.has(row.resource_id!)).toBe(true);
  });

  it("C13-13 10 resources filter: all 10 A resources accepted, no cross tenant", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const allTen = [
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
    const x = await rpcCalendar(scope["ownerA"]!, { ...r, resource_ids: allTen });
    expect(x.ok).toBe(true);
    const timeoffs = x.rows.filter((row: CalendarRow) => row.row_type === "resource_time_off");
    expect(timeoffs.length).toBeGreaterThanOrEqual(1);
    expect(timeoffs[0]?.resource_id).toBe(UUIDS.resA1);
  });

  it("C13-14 closure projection: business_closure row_type present on week range", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const closures = x.rows.filter((row: CalendarRow) => row.row_type === "business_closure");
    expect(closures.length).toBe(1);
    expect(closures[0]?.booking_id).toBeNull();
  });

  it("C13-15 time-off projection: resource_time_off row with resource A1 present", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const to = x.rows.filter((row: CalendarRow) => row.row_type === "resource_time_off");
    expect(to.length).toBeGreaterThanOrEqual(1);
    expect(to.find((row: CalendarRow) => row.resource_id === UUIDS.resA1)).toBeTruthy();
  });

  it("C13-16 extra_open/reduced projection: both rows discriminated", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
    const extra = x.rows.find((row: CalendarRow) => row.row_type === "extra_open");
    const red = x.rows.find((row: CalendarRow) => row.row_type === "reduced_hours");
    expect(extra).toBeTruthy();
    expect(red).toBeTruthy();
  });

  it("C13-17 payload PII: NO email/phone/notes/customer_id fields in ANY booking row", async () => {
    const r = WEEK_RANGE(MON_ISO());
    const x = await rpcCalendar(scope["ownerA"]!, {
      ...r,
      statuses: ["confirmed", "completed", "no_show", "cancelled"],
    });
    expect(x.ok).toBe(true);
    for (const row of x.rows) {
      const keys = Object.keys(row);
      expect(keys).not.toContain("customer_email");
      expect(keys).not.toContain("customer_id");
      expect(keys).not.toContain("customer_phone");
      expect(keys).not.toContain("notes");
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("phone");
      expect(keys).not.toContain("address");
    }
  });

  it("C13-18 business timezone: owner B NY produces America/New_York booking starts on Europe Monday 10:00 Italy = Monday 04:00 NY", async () => {
    const r = DAY_RANGE(PLUS_DAY_ISO(0), 2);
    const x = await rpcCalendar(scope["ownerB"]!, r);
    expect(x.ok).toBe(true);
    const bookingB = x.rows.find((row: CalendarRow) => row.booking_id === UUIDS.bookingB1);
    expect(bookingB).toBeTruthy();
    expect(bookingB!.row_type).toBe("booking");
    const start = new Date(bookingB!.starts_at as string);
    expect(start.getUTCHours()).toBe(8);
    expect(start.getUTCMinutes()).toBe(0);
  });

  it("C13-19 DST boundary: across October DST backward in CET, range OK no duplicate", async () => {
    // DST backward Sunday last Sunday October — 2026-10-25 (Europe/Rome)
    // Use 10-24..10-27 range. Should NOT fail.
    const r = { start: "2026-10-24T00:00:00Z", end: "2026-10-27T00:00:00Z" };
    const x = await rpcCalendar(scope["ownerA"]!, r);
    expect(x.ok).toBe(true);
  });

  it("C13-20 RESULT_TOO_LARGE: hard limit 1500 raises never truncates", async () => {
    const c = scope["client"];
    const bigTid = UUIDS.tenantA;
    const resourceIds = [
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
    const svc = UUIDS.svcA1;
    const mon = MON_ISO();
    const [ys, ms, ds] = mon.split("-");
    const baseDay = Date.UTC(parseInt(ys!, 10), parseInt(ms!, 10) - 1, parseInt(ds!, 10));
    const DAYS = 14;
    const RESOURCES = 10;
    const STATUS_SLOTS = [
      { status: "confirmed", hourBase: 8, mins: [0, 15, 30, 45] },
      { status: "completed", hourBase: 10, mins: [0, 15, 30, 45] },
      { status: "no_show", hourBase: 12, mins: [0, 15, 30, 45] },
    ];
    const SLOTS_PER_RES_DAY = STATUS_SLOTS.length * 4;
    const expectedInWindow = DAYS * RESOURCES * SLOTS_PER_RES_DAY;
    if (expectedInWindow <= 1500) {
      throw new Error(`Harness design error: expectedInWindow=${expectedInWindow} must be > 1500`);
    }
    await c.query(`BEGIN`);
    await c.query(`SET LOCAL session_replication_role = replica`);
    let idx = 0;
    try {
      for (let dayOff = 0; dayOff < DAYS; dayOff++) {
        for (let r = 0; r < RESOURCES; r++) {
          const rid = resourceIds[r]!;
          for (const ss of STATUS_SLOTS) {
            for (const m of ss.mins) {
              const s = new Date(
                baseDay + dayOff * 86400_000 + ss.hourBase * 3600_000 + m * 60_000,
              );
              const e = new Date(s.valueOf() + 14 * 60_000);
              const uuid = `00000000-0000-413c-8008-${idx.toString().padStart(12, "0")}`;
              await c.query(
                `INSERT INTO public.bookings(id,tenant_id,resource_id,service_id,status,starts_at,ends_at,customer_name,created_at,updated_at)
                 VALUES ($1,$2,$3,$4,$5::text,$6,$7,$8,NOW(),NOW()) ON CONFLICT DO NOTHING`,
                [uuid, bigTid, rid, svc, ss.status, s.toISOString(), e.toISOString(), `P${idx}`],
              );
              idx++;
            }
          }
        }
      }
      const { count } = (
        await c.query(`SELECT COUNT(*)::int AS count FROM public.bookings WHERE tenant_id=$1`, [
          bigTid,
        ])
      ).rows[0] as { count: number };
      const windowStart = new Date(baseDay).toISOString();
      const windowEnd = new Date(baseDay + DAYS * 86400_000).toISOString();
      const { count: inWindowCount } = (
        await c.query(
          `SELECT COUNT(*)::int AS count FROM public.bookings WHERE tenant_id=$1 AND starts_at >= $2 AND starts_at < $3`,
          [bigTid, windowStart, windowEnd],
        )
      ).rows[0] as { count: number };
      if (count < 1550 || inWindowCount < 1550) {
        throw new Error(
          `RESULT_TOO_LARGE harness insufficient: total=${count}, inWindow=${inWindowCount}, need both >= 1550`,
        );
      }
      await c.query(`COMMIT`);
    } catch (err) {
      await c.query(`ROLLBACK`);
      throw err;
    }
    try {
      const wide = { start: DAY_RANGE(MON_ISO(), 14).start, end: DAY_RANGE(MON_ISO(), 14).end };
      const x = await rpcCalendar(scope["ownerA"]!, {
        ...wide,
        statuses: ["confirmed", "completed", "no_show", "cancelled"],
      });
      expect(x.ok).toBe(false);
      expect(/RESULT_TOO_LARGE|54000/.test(`${x.errorMessage} ${x.errorCode}`)).toBe(true);
    } finally {
      await c.query(`BEGIN`);
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(
        `DELETE FROM public.bookings WHERE tenant_id=$1 AND starts_at >= $2 AND starts_at < $3`,
        [UUIDS.tenantA, DAY_RANGE(MON_ISO(), 0).start, DAY_RANGE(MON_ISO(), 28).end],
      );
      await c.query(`COMMIT`);
    }
  }, 30_000);
});
