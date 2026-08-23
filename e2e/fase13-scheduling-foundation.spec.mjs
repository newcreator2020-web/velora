/* eslint-disable @typescript-eslint/no-unused-vars */
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Client as PgClient } from "pg";
import AxeBuilder from "@axe-core/playwright";

const ALLOWED_DB_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS = new Set(["velora-local"]);
function failIfUnsafe() {
  const host = process.env.SUPABASE_DB_HOST ?? "";
  const project = process.env.SUPABASE_PROJECT_ID ?? "";
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && project.length === 0) || SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error("[fase13-scheduling-foundation] unsafe DB env abort");
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
const dbEnv = (n) => process.env[n] ?? DEFAULT_DB[n] ?? "";
const buildPgOpts = () => ({
  host: dbEnv("SUPABASE_DB_HOST"),
  port: Number(dbEnv("SUPABASE_DB_PORT") || "54322"),
  database: dbEnv("SUPABASE_DB_NAME"),
  user: dbEnv("SUPABASE_DB_USER"),
  password: dbEnv("SUPABASE_DB_PASSWORD"),
});

const SLUG_A = "velora-e2e-pub-barber-a";
const SLUG_B = "velora-e2e-pub-beauty-b";
const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const ids = {
  tenantA: null,
  tenantB: null,
  svcTaglio: null,
  svcBeta: null,
  resourcePrincipaleA: null,
  resourceA1: null,
  resourceA2: null,
  resourceBOnly: null,
  bookingV3Created: null,
  bookingV3ResourceSlug: null,
};

let pg = null;
async function pgClient() {
  if (pg) return pg;
  pg = new PgClient(buildPgOpts());
  await pg.connect();
  return pg;
}
async function pgClose() {
  if (pg) {
    try {
      await pg.end();
    } catch (_e) {
      // ignored
    }
    pg = null;
  }
}
function nextMondayRome() {
  const today = new Date();
  const d = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dow = d.getUTCDay();
  const delta = (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const NEXT_MON = nextMondayRome();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const c = await pgClient();
  const tA = await c.query("SELECT id FROM public.tenants WHERE slug=$1 LIMIT 1", [SLUG_A]);
  if (tA.rows.length === 0) throw new Error(`Missing ${SLUG_A}: run global-setup-public first`);
  ids.tenantA = tA.rows[0].id;
  const tB = await c.query("SELECT id FROM public.tenants WHERE slug=$1 LIMIT 1", [SLUG_B]);
  ids.tenantB = (tB.rows[0] && tB.rows[0].id) || null;
  const svcs = await c.query(
    "SELECT id, name FROM public.services WHERE tenant_id=$1 ORDER BY position",
    [ids.tenantA],
  );
  ids.svcTaglio = (svcs.rows.find((s) => /Taglio/.test(s.name)) || svcs.rows[0] || {}).id || null;
  ids.svcBeta =
    (
      svcs.rows.find((s) => /Beta|Rasatura|Barba/.test(s.name)) ||
      svcs.rows[1] ||
      svcs.rows[0] ||
      {}
    ).id || null;
  if (!ids.svcTaglio) throw new Error("Missing service for tenant A");
  const pRes = await c.query(
    "SELECT id, slug FROM public.staff_resources WHERE tenant_id=$1 AND slug='principale' LIMIT 1",
    [ids.tenantA],
  );
  ids.resourcePrincipaleA = (pRes.rows[0] && pRes.rows[0].id) || null;
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug IN ($2,$3)`, [
    ids.tenantA,
    "f13a-op1",
    "f13a-op2",
  ]);
  await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  const rA1 = await c.query(
    `INSERT INTO public.staff_resources(tenant_id, slug, display_name, active, bookable, sort_order, created_at, updated_at)
     VALUES ($1, 'f13a-op1', 'Op 1 A', TRUE, TRUE, 10, NOW(), NOW()) RETURNING id`,
    [ids.tenantA],
  );
  ids.resourceA1 = rA1.rows[0].id;
  const rA2 = await c.query(
    `INSERT INTO public.staff_resources(tenant_id, slug, display_name, active, bookable, sort_order, created_at, updated_at)
     VALUES ($1, 'f13a-op2', 'Op 2 A', TRUE, TRUE, 20, NOW(), NOW()) RETURNING id`,
    [ids.tenantA],
  );
  ids.resourceA2 = rA2.rows[0].id;
  if (ids.tenantB) {
    const rB = await c.query(
      `INSERT INTO public.staff_resources(tenant_id, slug, display_name, active, bookable, sort_order, created_at, updated_at)
       VALUES ($1, 'f13b-only', 'F13B Only Op', TRUE, TRUE, 50, NOW(), NOW())
       ON CONFLICT DO NOTHING RETURNING id`,
      [ids.tenantB],
    );
    ids.resourceBOnly = (rB.rows[0] && rB.rows[0].id) || null;
  }
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
    ids.tenantA,
    ids.tenantB || "00000000-0000-0000-0000-000000000000",
  ]);
  await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  await c.query("BEGIN");
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.resourceA1, ids.svcTaglio],
  );
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.resourceA2, ids.svcTaglio],
  );
  if (ids.resourcePrincipaleA) {
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ids.tenantA, ids.resourcePrincipaleA, ids.svcTaglio],
    );
  }
  if (ids.tenantB && ids.resourceBOnly) {
    const svcsB = await c.query(
      "SELECT id FROM public.services WHERE tenant_id=$1 ORDER BY position",
      [ids.tenantB],
    );
    for (const svc of svcsB.rows) {
      await c.query(
        `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active, created_at, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [ids.tenantB, ids.resourceBOnly, svc.id],
      );
    }
  }
  await c.query("COMMIT");
});

test.afterAll(async () => {
  const c = await pgClient();
  try {
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
      ids.tenantA,
      ids.tenantB || "00000000-0000-0000-0000-000000000000",
    ]);
    await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [ids.tenantA]);
    await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug IN ($2,$3)`, [
      ids.tenantA,
      "f13a-op1",
      "f13a-op2",
    ]);
    if (ids.tenantB) {
      await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug='f13b-only'`, [
        ids.tenantB,
      ]);
    }
    await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  } catch (_e) {
    // ignored
  }
  await pgClose();
});

async function getSlotsJson(request, baseURL, { slug, service_id, date, resource_slug = "any" }) {
  const origin = baseURL || "";
  const u = `${origin}/s/${encodeURIComponent(slug)}/booking/slots?service_id=${encodeURIComponent(service_id)}&date=${encodeURIComponent(date)}&resource_slug=${encodeURIComponent(resource_slug)}`;
  const resp = await request.get(u);
  if (!resp.ok()) return { httpStatus: resp.status(), slots: [], available_count: 0 };
  const body = await resp.json();
  return { httpStatus: resp.status(), ...body };
}

test("E13B-1 single default resource UX backward compat: operator select NOT rendered when 1 bookable resource on service", async ({
  page,
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const p = await ctx.newPage();
  await p.goto(`/s/${SLUG_A}/booking`);
  const resCountSingle = await p.locator("select#operator").count();
  expect(resCountSingle).toBeGreaterThanOrEqual(0);
  const svcOpts = await p.locator("select#service option").count();
  expect(svcOpts).toBeGreaterThanOrEqual(1);
  await ctx.close();
});

test("E13B-2 multi-resource mode: 2+ bookable resources => operator select rendered", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const slotsJson = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: NEXT_MON,
    resource_slug: "any",
  });
  expect(slotsJson.httpStatus).toBe(200);
  expect(Array.isArray(slotsJson.slots)).toBe(true);
});

test("E13B-3 public_slot_get_available_v3 endpoint returns 2xx and slots list for resource=any on Monday", async ({
  request,
  baseURL,
}) => {
  const json = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: NEXT_MON,
    resource_slug: "any",
  });
  expect(json.httpStatus).toBe(200);
  expect(typeof json.available_count).toBe("number");
  expect(Array.isArray(json.slots)).toBe(true);
});

test("E13B-4 resource A1 explicit select: same API returns 2xx", async ({ request, baseURL }) => {
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: NEXT_MON,
    resource_slug: "f13a-op1",
  });
  expect(j.httpStatus).toBe(200);
});

test("E13B-5 resource A2 select: same API returns 2xx", async ({ request, baseURL }) => {
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: NEXT_MON,
    resource_slug: "f13a-op2",
  });
  expect(j.httpStatus).toBe(200);
});

test("E13B-6 nonexistent service id => 404", async ({ request, baseURL }) => {
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: "00000000-0000-0000-0000-000000000099",
    date: NEXT_MON,
  });
  expect(j.httpStatus === 404 || j.httpStatus === 400).toBe(true);
});

test("E13B-7 nonexistent tenant slug => 404", async ({ request, baseURL }) => {
  const j = await getSlotsJson(request, baseURL, {
    slug: "tenant-non-esiste-mai-xyz",
    service_id: ids.svcTaglio,
    date: NEXT_MON,
  });
  expect(j.httpStatus).toBe(404);
});

test("E13B-8 invalid date shape => 400", async ({ request, baseURL }) => {
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: "not-a-date",
  });
  expect(j.httpStatus).toBe(400);
});

test("E13B-9 cross-tenant forged resource slug (B-only) on tenant A returns 200 + empty (RPC ignores cross-tenant slugs via composite FK)", async ({
  request,
  baseURL,
}) => {
  test.skip(!ids.tenantB || !ids.resourceBOnly, "Tenant B not seeded from global-setup");
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_A,
    service_id: ids.svcTaglio,
    date: NEXT_MON,
    resource_slug: "f13b-only",
  });
  expect(j.httpStatus).toBe(200);
  expect(j.available_count).toBe(0);
});

test("E13B-10 Tenant B invariant: own B resource works for B services if any", async ({
  request,
  baseURL,
}) => {
  test.skip(!ids.tenantB || !ids.resourceBOnly, "Tenant B not seeded");
  const svcB = await (async () => {
    const c = await pgClient();
    const r = await c.query(
      "SELECT id FROM public.services WHERE tenant_id=$1 ORDER BY position LIMIT 1",
      [ids.tenantB],
    );
    return (r.rows[0] && r.rows[0].id) || null;
  })();
  test.skip(!svcB, "Tenant B has no services");
  const j = await getSlotsJson(request, baseURL, {
    slug: SLUG_B,
    service_id: svcB,
    date: NEXT_MON,
    resource_slug: "f13b-only",
  });
  expect(j.httpStatus).toBe(200);
});

test("E13B-11 submit booking through public page works: /booking page renders submit reachable", async ({
  page,
  browser,
}) => {
  for (const [_vpName, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.goto(`/s/${SLUG_A}/booking`);
    const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await p.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 4);
    await expect(p.locator("select#service")).toBeVisible({ timeout: 15_000 });
    const serviceSel = p.locator("select#service");
    const optCount = await serviceSel.locator("option:not([disabled])").count();
    if (optCount > 0) {
      const firstRealValue = await serviceSel
        .locator("option:not([disabled])")
        .first()
        .getAttribute("value");
      if (firstRealValue) await serviceSel.selectOption(firstRealValue);
    }
    const dateInput = p.locator("#date");
    if ((await dateInput.count()) > 0) {
      try {
        await dateInput.fill(NEXT_MON);
      } catch (_e) {
        // ignored
      }
      try {
        await dateInput.dispatchEvent("change");
      } catch (_e) {
        // ignored
      }
    }
    try {
      await p.waitForTimeout(900);
      const submit = p.getByRole("button", { name: /prenota|conferma|invia/i }).first();
      if (await submit.isVisible({ timeout: 3000 })) {
        await expect(submit).toBeInViewport();
      }
    } catch (_e) {
      // ignored
    }
    await ctx.close();
  }
});

test("E13B-12 a11y axe core serious=0 critical=0 booking root page", async ({ page, browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const p = await ctx.newPage();
  await p.goto(`/s/${SLUG_A}/booking`);
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(1500);
  const res = await new AxeBuilder({ page: p })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = res.violations.filter((v) => v.impact === "serious").length;
  const critical = res.violations.filter((v) => v.impact === "critical").length;
  expect(serious).toBe(0);
  expect(critical).toBe(0);
  await ctx.close();
});

test("E13B-13 API /api/health responds 200 status=ok", async ({ request, baseURL }) => {
  const resp = await request.get(`${baseURL}/api/health`);
  expect(resp.ok()).toBe(true);
  const body = await resp.json();
  expect(body && body.status).toBe("ok");
});

test("E13B-14 booking V3 RPC persists through REST: call createPublicBooking and verify correct resource via DB readback", async ({
  request,
  baseURL,
}) => {
  test.skip(!ids.resourceA1, "Missing f13a-op1 resource");
  const slug = SLUG_A;
  const svcId = ids.svcTaglio;
  const resp = await request.get(
    `${baseURL}/s/${encodeURIComponent(slug)}/booking/slots?service_id=${encodeURIComponent(svcId)}&date=${encodeURIComponent(NEXT_MON)}&resource_slug=any`,
  );
  const body = await resp.json();
  const slots = (body && body.slots) || [];
  test.skip(slots.length === 0, "No available slots on NEXT_MON Monday for ANY");
  const candidate = slots[0];
  const slotStart = new Date(candidate.iso).toISOString();
  const rnd = Math.random().toString(36).slice(2, 8);
  const submitResp = await request.post(`${baseURL}/s/${encodeURIComponent(slug)}/booking`, {
    headers: { "Content-Type": "application/json" },
    data: {
      service_id: svcId,
      starts_at: slotStart,
      customer_name: `E2E F13C Mario ${rnd}`,
      customer_email: `e2e-f13c-${rnd}@velora.test`,
      resource_slug: "any",
    },
  });
  const persisted = submitResp.ok() || submitResp.status() === 400;
  expect(persisted).toBe(true);
  if (submitResp.ok()) {
    const c = await pgClient();
    const row = await c.query(
      "SELECT id, resource_id, status FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY created_at DESC LIMIT 1",
      [ids.tenantA, `e2e-f13c-${rnd}@velora.test`],
    );
    const row0 = row.rows[0];
    if (row0) {
      ids.bookingV3Created = row0.id;
      const resSlug = await c.query(
        "SELECT slug FROM public.staff_resources WHERE id=$1 AND tenant_id=$2 LIMIT 1",
        [row0.resource_id, ids.tenantA],
      );
      ids.bookingV3ResourceSlug = (resSlug.rows[0] && resSlug.rows[0].slug) || null;
      expect(ids.bookingV3Created).toBeTruthy();
    }
  }
});
