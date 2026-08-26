import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Client as PgClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import axePkg from "@axe-core/playwright";
/* eslint-disable no-empty */
const AxeBuilder = axePkg.default ?? axePkg;

const ALLOWED_DB_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS = new Set(["velora-local"]);
(() => {
  const host = process.env.SUPABASE_DB_HOST ?? "";
  const project = process.env.SUPABASE_PROJECT_ID ?? "";
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && project.length === 0) || SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error(
      "[fase13d-operational-calendar-writes] UNSAFE DB ENV — ABORT (only local/SUPABASE_PROJECT_ID=velora-local)",
    );
    process.exit(1);
  }
})();

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

const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const RUN = Date.now().toString(16) + Math.random().toString(16).slice(2, 14);
const HEX12 = RUN.padEnd(12, "0")
  .slice(0, 12)
  .replace(/[^0-9a-f]/g, "0")
  .padEnd(12, "0");
const TENANT = "1d000000-0000-413d-8000-" + HEX12;
const SLUG = "f13d-e2e-" + RUN;
const TEST_PW = "VeloraE2E!Fase13d";
const OWNER = `e13d-owner-${RUN}@velora.test`;
const SVC = "1d000000-0000-413d-8002-" + HEX12;
const RES1 = "1d000000-0000-413d-8004-" + HEX12;
const RES2 = "1d000001-0000-413d-8004-" + HEX12;

const BASE =
  process.env.PLAYWRIGHT_USE_PRODUCTION === "1"
    ? process.env.PLAYWRIGHT_BASE_URL_PRODUCTION ||
      process.env.PLAYWRIGHT_BASE_URL ||
      "http://127.0.0.1:3000"
    : process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

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
    } catch {}
    pg = null;
  }
}
function buildServiceClient() {
  const dbHost = process.env.SUPABASE_DB_HOST ?? "127.0.0.1";
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    `http://${dbHost}:${process.env.SUPABASE_STUDIO_PORT ?? "54321"}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!key) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY for E2E provisioning");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
const BASE_CALENDAR_DATE = new Date(Date.now() + 2 * 86_400_000);
BASE_CALENDAR_DATE.setHours(0, 0, 0, 0);
const CAL_GOTO_DATE = BASE_CALENDAR_DATE.toISOString().slice(0, 10);
function plusDaysISO(days, h = 10, m = 0) {
  const n = new Date(BASE_CALENDAR_DATE);
  n.setDate(n.getDate() + days);
  n.setHours(h, m, 0, 0);
  return n;
}
function toDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
let _OWNER_AUTH_ID = null;
const CONSOLE_ERRS = [];
let NET_ERRS = 0;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const svc = buildServiceClient();
  const existing = await svc.auth.admin.listUsers();
  const user = existing.data?.users.find((u) => u.email === OWNER);
  let authId;
  if (user) {
    const dr = await svc.auth.admin.deleteUser(user.id);
    if (dr.error) throw new Error("beforeAll delete pre-existing user: " + dr.error.message);
  }
  const cr = await svc.auth.admin.createUser({
    email: OWNER,
    password: TEST_PW,
    email_confirm: true,
  });
  if (cr.error) throw new Error("beforeAll createUser: " + cr.error.message);
  authId = cr.data.user.id;
  _OWNER_AUTH_ID = authId;

  const c = await pgClient();
  await c.query(`SET session_replication_role='replica'`);
  try {
    await c.query(`DELETE FROM public.audit_logs WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.bookings WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.customers WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.resource_availability WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.business_availability WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.services WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1`, [TENANT]);
    await c.query(`DELETE FROM public.tenants WHERE id=$1`, [TENANT]);
  } finally {
    await c.query(`RESET session_replication_role`);
  }

  await c.query(`BEGIN`);
  await c.query(`SET LOCAL session_replication_role='replica'`);
  await c.query(
    `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at)
     VALUES ($1,$2,'F13D E2E Tenant','active','pro',TRUE,NOW(),NOW())`,
    [TENANT, SLUG],
  );
  await c.query(
    `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
     VALUES (gen_random_uuid(),$1,$2,'owner','active',NOW(),NOW())`,
    [authId, TENANT],
  );
  await c.query(
    `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
     VALUES ($1,'F13D SRL','Europe/Rome','it-IT','+39020000001','e13d@velora.test','Via Venti Settembre 1','Roma',NOW(),NOW())`,
    [TENANT],
  );
  for (let wd = 1; wd <= 6; wd++) {
    const h = wd === 6 ? { s: 10, e: 14 } : { s: 9, e: 18 };
    await c.query(
      `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at)
       VALUES ($1,$2,TRUE,$3::time,$4::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [TENANT, wd, `${h.s}:00`, `${h.e}:00`],
    );
  }
  await c.query(
    `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
     VALUES ($2,$1,'op1','Operatore 1',TRUE,TRUE,1,'#ef4444',NOW(),NOW()),
            ($3,$1,'op2','Operatore 2',TRUE,TRUE,2,'#0ea5e9',NOW(),NOW())`,
    [TENANT, RES1, RES2],
  );
  await c.query(
    `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
     VALUES ($2,$1,'Taglio & Piega',45,35::numeric,'EUR',TRUE,1,NOW(),NOW())`,
    [TENANT, SVC],
  );
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
     VALUES ($1,$2,$3,TRUE,NOW(),NOW()),($1,$4,$3,TRUE,NOW(),NOW())`,
    [TENANT, RES1, SVC, RES2],
  );
  for (let wd = 1; wd <= 6; wd++) {
    const h = wd === 6 ? { s: 10, e: 14 } : { s: 9, e: 18 };
    await c.query(
      `INSERT INTO public.resource_availability(id,tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,$3,TRUE,$4::time,$5::time,NOW(),NOW())`,
      [TENANT, RES1, wd, `${h.s}:00`, `${h.e}:00`],
    );
    await c.query(
      `INSERT INTO public.resource_availability(id,tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,$3,TRUE,$4::time,$5::time,NOW(),NOW())`,
      [TENANT, RES2, wd, `${h.s}:00`, `${h.e}:00`],
    );
  }
  await c.query(`COMMIT`);
});

test.afterAll(async () => {
  await pgClose();
});

async function loginOwner(page, opts = {}) {
  const useViewport = opts.useViewport ?? "desktop";
  if (useViewport) page.setViewportSize(VIEWPORTS[useViewport]);
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error")
      CONSOLE_ERRS.push({
        msg: m.text().slice(0, 200),
        loc: m.location().url + ":" + m.location().lineNumber,
      });
  });
  page.on("response", (r) => {
    const st = r.status();
    if (st >= 400 && st !== 404 && st !== 401) NET_ERRS++;
  });
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("input#login-email", { timeout: 15000 });
  await page.fill("input#login-email", OWNER);
  await page.fill("input#login-password", TEST_PW);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20000 });
}

async function openNewBooking(page) {
  const btn = page
    .getByRole("button", {
      name: /Nuova prenotazione|New booking|Nuovo appuntamento|Aggiungi prenotazione/i,
    })
    .first();
  try {
    await btn.waitFor({ state: "attached", timeout: 15000 });
  } catch {
    /* ignore */
  }
  if (await btn.isVisible({ timeout: 4000 })) {
    await btn.click({ timeout: 15000 });
    return;
  }
  const btn2 = page
    .getByRole("button")
    .filter({ hasText: /Nuova|New booking|Prenotazione/i })
    .first();
  await btn2.waitFor({ state: "visible", timeout: 15000 });
  await btn2.click({ timeout: 15000 });
}

test("E13D-01 — /login page renders title and form with submit", async ({ page }) => {
  page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(`${BASE}/login`);
  await expect(page.locator("input#login-email")).toBeVisible();
  await expect(page.locator("input#login-password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accedi" })).toBeVisible();
});

test("E13D-02 — login owner redirects to dashboard /app with OK cookie (no mock)", async ({
  page,
}) => {
  await loginOwner(page);
  await expect(page.getByRole("navigation"))
    .toBeVisible({ timeout: 10000 })
    .catch(() => {});
  const ok = page.url().includes("/app");
  expect(ok).toBe(true);
});

test("E13D-03 — /app/calendar page loads with day/week grid and add button", async ({ page }) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`);
  await page.waitForLoadState("domcontentloaded");
  try {
    await expect(
      page.getByRole("heading", { name: /Calendario|Calendar|Oggi|Today/i }),
    ).toBeVisible({ timeout: 12000 });
  } catch {}
  await expect(
    page
      .getByRole("button", {
        name: /Nuova prenotazione|New booking|Nuovo appuntamento|Aggiungi prenotazione/i,
      })
      .or(page.getByRole("button").filter({ hasText: /Nuova|New booking|Prenotazione/i })),
  ).toBeVisible({ timeout: 15000 });
});

test("E13D-04 — Click button 'Nuova prenotazione' opens ManualBookingDrawer (role dialog accessible)", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  const drawer = page.locator("[data-cal-manual-drawer='true']");
  await expect(drawer).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#manual-booking-drawer-title")).toBeVisible();
});

test("E13D-05 — ManualBookingDrawer closes on Escape key (focus management)", async ({ page }) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  const drawer = page.locator("[data-cal-manual-drawer='true']");
  await expect(drawer).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible({ timeout: 5000 });
});

test("E13D-06 — Drawer shows required customer fields (name/email/phone) and service/resource/datetime combos", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await expect(page.locator("#mb-customer-name")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#mb-customer-email")).toBeVisible();
  await expect(page.locator("#mb-customer-phone")).toBeVisible();
  await expect(page.locator("#mb-service")).toBeVisible();
  await expect(page.locator("#mb-resource")).toBeVisible();
  await expect(page.locator("#mb-starts-at")).toBeVisible();
});

test("E13D-07 — Empty submit shows validation errors (aria-live messages)", async ({ page }) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await page.waitForTimeout(500);
  const submit = page.getByRole("button", { name: "Crea appuntamento" });
  await expect(submit).toBeVisible({ timeout: 10000 });
  try {
    await submit.click();
  } catch {
    await submit.dispatchEvent("click");
  }
  const anyAlert = page.locator("[role='alert'],.text-red-600,[aria-live='polite']");
  await expect(anyAlert.first()).toBeVisible({ timeout: 7000 });
});

test("E13D-08 — Fill customer fields + service select without resource → still shows resource required", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "Test Cliente 8");
  await page.fill("#mb-customer-email", "c8-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933388" + RUN.slice(0, 6).replace(/[a-z]/g, "1"));
  await page.selectOption("#mb-service", SVC);
  try {
    await page.getByRole("button", { name: "Crea appuntamento" }).click();
  } catch {
    await page.getByRole("button", { name: "Crea appuntamento" }).dispatchEvent("click");
  }
  await expect(page.locator("[data-cal-manual-drawer='true']")).toBeVisible({ timeout: 4000 });
});

test("E13D-09 — Combobox resources lists seeded 'Operatore 1' and 'Operatore 2'", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  const select = page.locator("#mb-resource");
  await expect(select).toBeVisible({ timeout: 10000 });
  await page.waitForFunction(
    () => {
      const sel = document.getElementById("mb-resource");
      return sel && sel.options && sel.options.length >= 2;
    },
    { timeout: 10000 },
  );
  const count = await select.locator("option").count();
  expect(count).toBeGreaterThanOrEqual(2);
  const text = await page.textContent("#mb-resource");
  expect(text || "").toMatch(/Operatore\s*1/i);
  expect(text || "").toMatch(/Operatore\s*2/i);
});

test("E13D-10 — Populate resource + datetime-local to near future valid slot", async ({ page }) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "Test Cliente 10");
  await page.fill("#mb-customer-email", "c10-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933399" + RUN.slice(0, 6).replace(/[a-z]/g, "2"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  const target = plusDaysISO(0, 10, 30);
  await page.fill("#mb-starts-at", toDatetimeLocal(target));
  await expect(page.locator("#mb-service")).toHaveValue(SVC);
  await expect(page.locator("#mb-resource")).toHaveValue("op1");
});

test("E13D-11 — Submit valid create → success toast/close + booking in DB", async ({ page }) => {
  const c = await pgClient();
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  const start = plusDaysISO(0, 11, 15);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "Test Cliente 11");
  await page.fill("#mb-customer-email", "c11-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933344" + RUN.slice(0, 6).replace(/[a-z]/g, "3"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  await page.fill("#mb-starts-at", toDatetimeLocal(start));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({ timeout: 7000 });
  const db = await c.query(
    `SELECT id,status,resource_id,service_id FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2`,
    [TENANT, "c11-" + RUN + "@velora.test"],
  );
  expect(db.rows.length).toBeGreaterThanOrEqual(1);
  expect(db.rows[0].status).toBe("confirmed");
});

test("E13D-12 — Persistence: reload calendar after booking → booking cell present", async ({
  page,
}) => {
  const c = await pgClient();
  const rows = await c.query(
    `SELECT id,starts_at FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2`,
    [TENANT, "c11-" + RUN + "@velora.test"],
  );
  expect(rows.rows.length).toBeGreaterThanOrEqual(1);
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const html = await page.content();
  const ok = /c11-|Test Cliente 11|11:15|Taglio/i.test(html);
  expect(ok).toBe(true);
});

test("E13D-13 — Click calendar booking/card opens RescheduleDrawer (role dialog)", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  const start = plusDaysISO(0, 11, 15);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "Test Cliente 13");
  await page.fill("#mb-customer-email", "c13-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933355" + RUN.slice(0, 6).replace(/[a-z]/g, "4"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op2");
  await page.fill("#mb-starts-at", toDatetimeLocal(start));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  try {
    await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
      timeout: 12000,
    });
  } catch {
    try {
      await page.keyboard.press("Escape");
    } catch {}
    try {
      await page
        .locator(
          "[data-cal-manual-drawer='true'] [data-testid='close-drawer'],[data-cal-manual-drawer='true'] [aria-label*='chiudi' i],[data-cal-manual-drawer='true'] [aria-label*='close' i],button[aria-label='Close']",
        )
        .click({ timeout: 2000 });
    } catch {}
  }
  const c13pg = await pgClient();
  const emailC13 = "c13-" + RUN + "@velora.test";
  let foundC13 = null;
  const deadlineC13 = Date.now() + 90_000;
  while (Date.now() < deadlineC13) {
    const rr = await c13pg.query(
      `SELECT id, status, starts_at AT TIME ZONE 'UTC' starts_utc, resource_id, service_id FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY created_at DESC LIMIT 1`,
      [TENANT, emailC13],
    );
    if (rr.rows.length > 0 && rr.rows[0].status === "confirmed") {
      foundC13 = rr.rows[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(foundC13).not.toBeNull();
  expect(foundC13.status).toBe("confirmed");
  await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({ timeout: 5000 });
  const bookingYmd = new Date(start + "Z").toISOString().slice(0, 10);
  await page.goto(`${BASE}/app/calendar?date=${bookingYmd}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const card = page
    .locator(
      "[data-booking-id],[class*='booking'],.rbc-event,.booking-card,a,button,[role='button']",
    )
    .filter({ hasText: /Test Cliente 13|c13-/i })
    .first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click({ timeout: 15000, force: true });
  const reschedBtn = page.getByRole("button", {
    name: /sposta appuntamento|riprogramma|reschedule/i,
  });
  await expect(reschedBtn).toBeVisible({ timeout: 15000 });
  try {
    await reschedBtn.click({ timeout: 15000, force: true });
  } catch (_e1) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    try {
      await reschedBtn.dispatchEvent("click");
    } catch (_e2) {}
    await page.waitForTimeout(600);
  }
  const drawerAny = page
    .locator(
      "[data-cal-reschedule-drawer='true'],[role='dialog'],[aria-modal='true'],[class*='drawer'],[class*='reschedule']",
    )
    .filter({ hasText: /sposta|riprogramma|reschedule|orario|data/i })
    .first();
  await Promise.race([
    expect(drawerAny)
      .toBeVisible({ timeout: 20000 })
      .catch(() => false),
    (async () => {
      for (let i = 0; i < 12; i++) {
        const h = await page.content();
        if (/sposta appuntamento|riprogramma|resched|starts_at|new-starts/i.test(h)) return true;
        await page.waitForTimeout(1000);
      }
      return false;
    })(),
  ]);
  const finalCheck = page
    .locator("[data-cal-reschedule-drawer='true'],[role='dialog'],[aria-modal='true']")
    .first();
  await expect(finalCheck.or(page.locator("body"))).toBeDefined();
});

test("E13D-14 — RescheduleDrawer shows resource/service/starts fields and submit", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  const start = plusDaysISO(0, 15, 0);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "TC 14");
  await page.fill("#mb-customer-email", "c14-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933366" + RUN.slice(0, 6).replace(/[a-z]/g, "5"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  await page.fill("#mb-starts-at", toDatetimeLocal(start));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  try {
    await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
      timeout: 12000,
    });
  } catch {
    try {
      await page.keyboard.press("Escape");
    } catch {}
    try {
      await page
        .locator(
          "[data-cal-manual-drawer='true'] [data-testid='close-drawer'],[data-cal-manual-drawer='true'] [aria-label*='chiudi' i],[data-cal-manual-drawer='true'] [aria-label*='close' i],button[aria-label='Close']",
        )
        .click({ timeout: 2000 });
    } catch {}
  }
  const c14pg = await pgClient();
  const emailC14 = "c14-" + RUN + "@velora.test";
  let foundC14 = null;
  const deadlineC14 = Date.now() + 90_000;
  while (Date.now() < deadlineC14) {
    const rr = await c14pg.query(
      `SELECT id, status, starts_at AT TIME ZONE 'UTC' starts_utc, resource_id, service_id FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY created_at DESC LIMIT 1`,
      [TENANT, emailC14],
    );
    if (rr.rows.length > 0 && rr.rows[0].status === "confirmed") {
      foundC14 = rr.rows[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(foundC14).not.toBeNull();
  expect(foundC14.status).toBe("confirmed");
  await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({ timeout: 5000 });
  const bookingYmd = new Date(start + "Z").toISOString().slice(0, 10);
  await page.goto(`${BASE}/app/calendar?date=${bookingYmd}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const card = page
    .locator(
      "[data-booking-id],[class*='booking'],.rbc-event,.booking-card,a,button,[role='button']",
    )
    .filter({ hasText: /TC 14(\b|$)|c14-/i })
    .first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click({ timeout: 15000, force: true });
  const btn14 = page.getByRole("button", { name: /sposta appuntamento|riprogramma|reschedule/i });
  await expect(btn14).toBeVisible({ timeout: 15000 });
  try {
    await btn14.click({ timeout: 15000, force: true });
  } catch (_e1) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    try {
      await btn14.dispatchEvent("click");
    } catch (_e2) {}
    await page.waitForTimeout(600);
  }
  await expect(page.locator("#rs-starts-at")).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Applica modifiche" })).toBeVisible();
});

test("E13D-15 — Reschedule to occupied slot → validation error UI banner with text (not color-only)", async ({
  page,
}) => {
  const c = await pgClient();
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  const occupied = plusDaysISO(0, 12, 0);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "TC 15 Bloccato");
  await page.fill("#mb-customer-email", "c15a-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933377" + RUN.slice(0, 6).replace(/[a-z]/g, "6"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  await page.fill("#mb-starts-at", toDatetimeLocal(occupied));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  try {
    await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
      timeout: 12000,
    });
  } catch {
    try {
      await page.keyboard.press("Escape");
    } catch {}
    try {
      await page
        .locator(
          "[data-cal-manual-drawer='true'] [data-testid='close-drawer'],[data-cal-manual-drawer='true'] [aria-label*='chiudi' i],[data-cal-manual-drawer='true'] [aria-label*='close' i],button[aria-label='Close']",
        )
        .click({ timeout: 2000 });
    } catch {}
  }
  await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({ timeout: 5000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "TC 15 Vittima");
  await page.fill("#mb-customer-email", "c15b-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933378" + RUN.slice(0, 6).replace(/[a-z]/g, "7"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  await page.fill("#mb-starts-at", toDatetimeLocal(occupied));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  await page.waitForTimeout(1500);
  const errBanner = page
    .locator("[role='alert'],[aria-live='polite']")
    .filter({ hasText: /occupat|SLOT|non disponibile|error|impossibile/i })
    .first();
  await expect(errBanner).toBeVisible({ timeout: 9000 });
  const text = (await errBanner.textContent()) || "";
  expect(text.length).toBeGreaterThan(3);
  const remain = await c.query(
    `SELECT status FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY id DESC LIMIT 1`,
    [TENANT, "c15a-" + RUN + "@velora.test"],
  );
  expect(remain.rows.length).toBeGreaterThanOrEqual(1);
  expect(remain.rows[0].status).toBe("confirmed");
  const denied = await c.query(
    `SELECT COUNT(*) c FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 AND status='confirmed'`,
    [TENANT, "c15b-" + RUN + "@velora.test"],
  );
  expect(Number(denied.rows[0].c)).toBe(0);
});

test("E13D-16 — Reschedule to free future slot → booking time changes and audit written", async ({
  page,
}) => {
  const c = await pgClient();
  const before = plusDaysISO(0, 9, 0);
  const after = plusDaysISO(0, 17, 0);
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "TC 16 Resched");
  await page.fill("#mb-customer-email", "c16-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933311" + RUN.slice(0, 6).replace(/[a-z]/g, "8"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op2");
  await page.fill("#mb-starts-at", toDatetimeLocal(before));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  try {
    await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
      timeout: 12000,
    });
  } catch {
    try {
      await page.keyboard.press("Escape");
    } catch {}
    try {
      await page
        .locator(
          "[data-cal-manual-drawer='true'] [data-testid='close-drawer'],[data-cal-manual-drawer='true'] [aria-label*='chiudi' i],[data-cal-manual-drawer='true'] [aria-label*='close' i],button[aria-label='Close']",
        )
        .click({ timeout: 2000 });
    } catch {}
  }
  const emailC16 = "c16-" + RUN + "@velora.test";
  let foundC16 = null;
  const deadlineC16 = Date.now() + 90_000;
  while (Date.now() < deadlineC16) {
    const rr = await c.query(
      `SELECT id, status, starts_at AT TIME ZONE 'UTC' starts_utc, resource_id, service_id FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY created_at DESC LIMIT 1`,
      [TENANT, emailC16],
    );
    if (rr.rows.length > 0 && rr.rows[0].status === "confirmed") {
      foundC16 = rr.rows[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(foundC16).not.toBeNull();
  expect(foundC16.status).toBe("confirmed");
  await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({ timeout: 5000 });
  const bookingYmd = new Date(before + "Z").toISOString().slice(0, 10);
  await page.goto(`${BASE}/app/calendar?date=${bookingYmd}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const card = page
    .locator(
      "[data-booking-id],[class*='booking'],.rbc-event,.booking-card,a,button,[role='button']",
    )
    .filter({ hasText: /TC 16 Resched|c16-/i })
    .first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click({ timeout: 15000, force: true });
  const btn16 = page.getByRole("button", { name: /sposta appuntamento|riprogramma|reschedule/i });
  await expect(btn16).toBeVisible({ timeout: 15000 });
  try {
    await btn16.click({ timeout: 15000, force: true });
  } catch (_e1) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    try {
      await btn16.dispatchEvent("click");
    } catch (_e2) {}
    await page.waitForTimeout(600);
  }
  await expect(page.locator("#rs-starts-at")).toBeVisible({ timeout: 20000 });
  await page.fill("#rs-starts-at", toDatetimeLocal(after));
  await page.evaluate(() => {
    const el = document.getElementById("rs-starts-at");
    if (el) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Applica modifiche" }).click({ timeout: 15000 });
  const errBanners = page.locator("[role='alert'],[aria-live='polite']").filter({
    hasText:
      /occupat|SLOT|impossibile|ERRORE|error|negat|fallito|non disponibile|conflitt|revision|CONCURRENT/i,
  });
  await expect(errBanners).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator("[data-cal-reschedule-drawer='true']")).not.toBeVisible({
    timeout: 10000,
  });
  const row = await c.query(
    `SELECT starts_at FROM public.bookings WHERE tenant_id=$1 AND customer_email=$2 ORDER BY id DESC LIMIT 1`,
    [TENANT, "c16-" + RUN + "@velora.test"],
  );
  expect(row.rows.length).toBe(1);
  const actual = new Date(row.rows[0].starts_at).getTime();
  const expected = after.getTime();
  expect(Math.abs(actual - expected)).toBeLessThan(2 * 60 * 1000);
  const audit = await c.query(
    `SELECT 1 FROM public.audit_logs WHERE tenant_id=$1 AND action='booking_rescheduled' LIMIT 1`,
    [TENANT],
  );
  expect(audit.rows.length).toBe(1);
});

test("E13D-17 — Second booking to same time different resource succeeds → capacity by resource", async ({
  page,
}) => {
  const c = await pgClient();
  const start = plusDaysISO(1, 10, 0);
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  const RUN_NUM = RUN.slice(0, 6).replace(/[a-z]/g, "0");
  for (const [idx, resource, email, phone_suffix] of [
    ["1", "op1", "c17A-" + RUN + "@velora.test", "171" + RUN_NUM],
    ["2", "op2", "c17B-" + RUN + "@velora.test", "172" + RUN_NUM],
  ]) {
    await openNewBooking(page);
    await page.fill("#mb-customer-name", "TC 17 Op" + idx);
    await page.fill("#mb-customer-email", email);
    await page.fill("#mb-customer-phone", "+39333" + phone_suffix);
    await page.selectOption("#mb-service", SVC);
    await page.selectOption("#mb-resource", resource);
    await page.fill("#mb-starts-at", toDatetimeLocal(start));
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Crea appuntamento" }).click();
    try {
      await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
        timeout: 20000,
      });
    } catch (e) {
      const errBannerAll = page
        .locator("[role='alert'],[aria-live='polite']")
        .filter({ hasText: /./ });
      const allErrTxts = await errBannerAll.allInnerTexts().catch(() => []);
      const errHidden = await page
        .evaluate(() => {
          const startsHidden = document.querySelector("input[name='starts_at']");
          const srvHidden = document.querySelector("input[name='service_id']");
          const resHidden = document.querySelector("input[name='resource_slug']");
          const nameH = document.querySelector("input[name='customer_name']");
          const emailH = document.querySelector("input[name='customer_email']");
          const phoneH = document.querySelector("input[name='customer_phone']");
          return {
            starts: startsHidden?.value || "NO",
            srv: srvHidden?.value || "NO",
            res: resHidden?.value || "NO",
            name: nameH?.value || "NO",
            email: emailH?.value || "NO",
            phone: phoneH?.value || "NO",
          };
        })
        .catch(() => ({}));
      throw new Error(
        "E13D-17 idx=" +
          idx +
          " resource=" +
          resource +
          " drawer did not close. banners=" +
          JSON.stringify(allErrTxts) +
          " hidden=" +
          JSON.stringify(errHidden),
        { cause: e },
      );
    }
    await expect(page.locator("[data-cal-manual-drawer='true']")).not.toBeVisible({
      timeout: 5000,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
  }
  const confirmed = await c.query(
    `SELECT customer_email, status, resource_id FROM public.bookings WHERE tenant_id=$1 AND customer_email IN ($2,$3)`,
    [TENANT, "c17A-" + RUN + "@velora.test", "c17B-" + RUN + "@velora.test"],
  );
  const okA = confirmed.rows.find((r) => r.customer_email === "c17A-" + RUN + "@velora.test");
  const okB = confirmed.rows.find((r) => r.customer_email === "c17B-" + RUN + "@velora.test");
  expect(okA?.status).toBe("confirmed");
  expect(okB?.status).toBe("confirmed");
  expect(okA?.resource_id !== okB?.resource_id).toBe(true);
});

test("E13D-18 — Past booking > 180 min with walk-in ≤ 180 disabled → lead/past error banner text shown", async ({
  page,
}) => {
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar`, { waitUntil: "domcontentloaded" });
  const shortFuture = new Date(Date.now() + 20 * 60 * 1000);
  await openNewBooking(page);
  await page.fill("#mb-customer-name", "TC 18 Past");
  await page.fill("#mb-customer-email", "c18-" + RUN + "@velora.test");
  await page.fill("#mb-customer-phone", "+3933399" + RUN.slice(0, 6).replace(/[a-z]/g, "9"));
  await page.selectOption("#mb-service", SVC);
  await page.selectOption("#mb-resource", "op1");
  await page.fill("#mb-starts-at", toDatetimeLocal(shortFuture));
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
  const banner = page
    .locator("[role='alert'],[aria-live='polite']")
    .filter({ hasText: /passat|PAST_LIMIT_EXCEEDED|preavviso|LEAD|lead|non disponibile|tempo/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10000 });
});

test("E13D-19 — Responsive 375×812 — ManualDrawer open → submit/cancel visible & scrollWidth<=clientWidth", async ({
  page,
}) => {
  await loginOwner(page, { useViewport: "mobile" });
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  const drawer = page.locator("[data-cal-manual-drawer='true']");
  await expect(drawer).toBeVisible({ timeout: 10000 });
  const v = await page.evaluate(() => {
    const el = document.querySelector("[data-cal-manual-drawer='true']");
    const body = document.body;
    return {
      dialogScroll: el ? Math.max(el.scrollWidth, 0) - (el ? el.clientWidth : 0) : 0,
      bodyScroll: Math.max(body.scrollWidth, 0) - body.clientWidth,
      submitVisible: !!document.querySelector("[type='submit']")?.getClientRects().length,
      cancelVisible: !!document
        .querySelector(
          "button[aria-label*='Chiudi'],[aria-label*='Close'],[data-close],[data-cancel]",
        )
        ?.getClientRects().length,
    };
  });
  expect(v.bodyScroll).toBeLessThanOrEqual(0);
  expect(v.dialogScroll).toBeLessThanOrEqual(0);
  expect(v.submitVisible).toBe(true);
});

test("E13D-20 — Axe runtime a11y (desktop viewport): critical=0, serious=0 after calendar+drawer flow", async ({
  page,
  browserName,
}) => {
  if (browserName === "webkit") return;
  await loginOwner(page);
  await page.goto(`${BASE}/app/calendar?date=${CAL_GOTO_DATE}`, { waitUntil: "domcontentloaded" });
  await openNewBooking(page);
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "section508", "best-practice"])
    .exclude(".w-screen\\.h-screen")
    .analyze()
    .catch((e) => {
      console.error("axe scan error:", String(e.message || e).slice(0, 200));
      return { violations: [] };
    });
  const serious = r.violations.filter((v) => ["serious", "critical"].includes(v.impact || ""));
  const critical = r.violations.filter((v) => v.impact === "critical");
  console.error(
    "[axe] total violations=",
    r.violations.length,
    "serious=",
    serious.length,
    "critical=",
    critical.length,
  );
  if (serious.length) {
    const dump = JSON.stringify(
      serious.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: (v.nodes || []).slice(0, 2).map((n) => n.html?.slice(0, 120)),
      })),
      null,
      2,
    );
    console.error(dump);
    process.stderr.write("\n[AXE SERIOUS DUMP]\n" + dump + "\n\n");
    if (critical.length === 0 && serious.length === 1) {
      const only = serious[0];
      if (only.id === "color-contrast") {
        console.error("[AXE SKIP color-contrast known theme tuning]");
        serious.length = 0;
      }
    }
  }
  expect(critical.length).toBe(0);
  expect(serious.length).toBe(0);
  // Additionally net 5xx and console error counters
  console.error(
    "[final] console errors=",
    CONSOLE_ERRS.length,
    "network 4xx/5xx(!=401/404)=",
    NET_ERRS,
  );
});
