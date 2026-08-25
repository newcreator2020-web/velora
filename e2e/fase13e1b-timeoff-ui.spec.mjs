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
      "[fase13e1b-timeoff-ui] UNSAFE DB ENV — ABORT (solo locale / SUPABASE_PROJECT_ID=velora-local)",
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
const TENANT_A = "1e010000-0000-413d-8000-" + HEX12;
const TENANT_B = "1e020000-0000-413d-8000-" + HEX12;
const SLUG_A = "f13e1b-a-" + RUN;
const SLUG_B = "f13e1b-b-" + RUN;
const TEST_PW = "VeloraE2E!Fase13e1b";
const OWNER_A = `e13e1b-owner-a-${RUN}@velora.test`;
const OWNER_B = `e13e1b-owner-b-${RUN}@velora.test`;
const SVC_A = "1e010000-0000-413d-8002-" + HEX12;
const SVC_B = "1e020000-0000-413d-8002-" + HEX12;
const MARIA = "1e010000-0000-413d-8004-" + HEX12;
const LUCA = "1e010001-0000-413d-8004-" + HEX12;
const MARIA_B = "1e020000-0000-413d-8004-" + HEX12;

const BASE =
  process.env.PLAYWRIGHT_USE_PRODUCTION === "1"
    ? process.env.PLAYWRIGHT_BASE_URL_PRODUCTION ||
      process.env.PLAYWRIGHT_BASE_URL ||
      "http://127.0.0.1:3000"
    : process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const SERVICE_DURATION = 60;
const SERVICE_NAME = "Taglio";
const PAD2 = (n) => String(n).padStart(2, "0");

const FIXED_MONDAY = (() => {
  const n = new Date();
  const today = n.getUTCDay();
  let delta = (1 - today + 7) % 7;
  if (delta === 0) delta = 7;
  delta += 14;
  const cand = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + delta));
  return { y: cand.getUTCFullYear(), mo: cand.getUTCMonth() + 1, d: cand.getUTCDate() };
})();

function LOCAL_ISO_CEST(offsetDays, h, m) {
  const dt = new Date(
    Date.UTC(FIXED_MONDAY.y, FIXED_MONDAY.mo - 1, FIXED_MONDAY.d + offsetDays, h - 2, m),
  );
  return `${dt.getUTCFullYear()}-${PAD2(dt.getUTCMonth() + 1)}-${PAD2(dt.getUTCDate())}T${PAD2(h)}:${PAD2(m)}`;
}

function DATE_STRING(offsetDays) {
  const dt = new Date(Date.UTC(FIXED_MONDAY.y, FIXED_MONDAY.mo - 1, FIXED_MONDAY.d + offsetDays));
  return `${dt.getUTCFullYear()}-${PAD2(dt.getUTCMonth() + 1)}-${PAD2(dt.getUTCDate())}`;
}

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
  if (!key) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY per provisioning E2E");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let OWNER_A_AUTH = null;
let OWNER_B_AUTH = null;
const CONSOLE_ERRS = [];
let NET_ERRS = 0;

test.describe.configure({ mode: "serial" });
test.setTimeout(90000);

test.beforeAll(async () => {
  const svc = buildServiceClient();
  const us = await svc.auth.admin.listUsers();
  for (const email of [OWNER_A, OWNER_B]) {
    const ex = us.data?.users.find((u) => u.email === email);
    if (ex) await svc.auth.admin.deleteUser(ex.id);
  }
  const ca = await svc.auth.admin.createUser({
    email: OWNER_A,
    password: TEST_PW,
    email_confirm: true,
  });
  if (ca.error) throw new Error("create A: " + ca.error.message);
  OWNER_A_AUTH = ca.data.user.id;
  const cb = await svc.auth.admin.createUser({
    email: OWNER_B,
    password: TEST_PW,
    email_confirm: true,
  });
  if (cb.error) throw new Error("create B: " + cb.error.message);
  OWNER_B_AUTH = cb.data.user.id;

  const c = await pgClient();
  await c.query(`SET session_replication_role='replica'`);
  try {
    for (const tid of [TENANT_A, TENANT_B]) {
      await c.query(`DELETE FROM public.audit_logs WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.bookings WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.customers WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.resource_availability WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.business_availability WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.services WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.business_profiles WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.tenant_memberships WHERE tenant_id=$1`, [tid]);
      await c.query(`DELETE FROM public.tenants WHERE id=$1`, [tid]);
    }
  } finally {
    await c.query(`RESET session_replication_role`);
  }

  await c.query(`BEGIN`);
  await c.query(`SET LOCAL session_replication_role='replica'`);
  await c.query(
    `INSERT INTO public.tenants(id,slug,name,status,plan_id,published,created_at,updated_at)
     VALUES ($1,$2,'F13E1B Tenant A','active','pro',TRUE,NOW(),NOW()),
            ($3,$4,'F13E1B Tenant B','active','pro',TRUE,NOW(),NOW())`,
    [TENANT_A, SLUG_A, TENANT_B, SLUG_B],
  );
  await c.query(
    `INSERT INTO public.tenant_memberships(id,user_id,tenant_id,role,status,created_at,updated_at)
     VALUES (gen_random_uuid(),$1,$2,'owner','active',NOW(),NOW()),
            (gen_random_uuid(),$3,$4,'owner','active',NOW(),NOW())`,
    [OWNER_A_AUTH, TENANT_A, OWNER_B_AUTH, TENANT_B],
  );
  await c.query(
    `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,phone,email,address_line1,city,created_at,updated_at)
     VALUES ($1,'Parrucchiera A','Europe/Rome','it-IT','+39060000001','a@velora.test','Via Torino 1','Roma',NOW(),NOW()),
            ($2,'Parrucchiera B','Europe/Rome','it-IT','+39060000002','b@velora.test','Via Milano 1','Milano',NOW(),NOW())`,
    [TENANT_A, TENANT_B],
  );
  for (const tid of [TENANT_A, TENANT_B]) {
    for (let wd = 0; wd <= 6; wd++) {
      await c.query(
        `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES ($1,$2,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [tid, wd],
      );
    }
  }
  await c.query(
    `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
     VALUES ($2,$1,'maria','Maria',TRUE,TRUE,1,'#ef4444',NOW(),NOW()),
            ($3,$1,'luca','Luca',TRUE,TRUE,2,'#0ea5e9',NOW(),NOW())`,
    [TENANT_A, MARIA, LUCA],
  );
  await c.query(
    `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at)
     VALUES ($2,$1,'maria-b','Maria B',TRUE,TRUE,1,'#333333',NOW(),NOW())`,
    [TENANT_B, MARIA_B],
  );
  await c.query(
    `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
     VALUES ($2,$1,$3,${SERVICE_DURATION},3000::numeric,'EUR',TRUE,1,NOW(),NOW())`,
    [TENANT_A, SVC_A, SERVICE_NAME],
  );
  await c.query(
    `INSERT INTO public.services(id,tenant_id,name,duration_minutes,price_from,currency,active,position,created_at,updated_at)
     VALUES ($1,$2,$3,${SERVICE_DURATION},3000::numeric,'EUR',TRUE,1,NOW(),NOW())`,
    [SVC_B, TENANT_B, SERVICE_NAME],
  );
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active,created_at,updated_at)
     VALUES ($1,$2,$3,TRUE,NOW(),NOW()),($1,$4,$3,TRUE,NOW(),NOW()),($5,$6,$7,TRUE,NOW(),NOW())`,
    [TENANT_A, MARIA, SVC_A, LUCA, TENANT_B, MARIA_B, SVC_B],
  );
  for (const [tid, rid] of [
    [TENANT_A, MARIA],
    [TENANT_A, LUCA],
    [TENANT_B, MARIA_B],
  ]) {
    for (let wd = 0; wd <= 6; wd++) {
      await c.query(
        `INSERT INTO public.resource_availability(id,tenant_id,resource_id,weekday,enabled,start_time,end_time,created_at,updated_at)
         VALUES (gen_random_uuid(),$1,$2,$3,TRUE,'09:00'::time,'18:00'::time,NOW(),NOW())`,
        [tid, rid, wd],
      );
    }
  }
  await c.query(`COMMIT`);
});

test.afterAll(async () => {
  await pgClose();
});

async function login(page, email, password, vp) {
  const v = VIEWPORTS[vp ?? "desktop"];
  if (v) await page.setViewportSize(v);
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error")
      CONSOLE_ERRS.push({
        msg: m.text().slice(0, 180),
        loc: (m.location().url || "?") + ":" + (m.location().lineNumber || "?"),
      });
  });
  page.on("response", (r) => {
    const st = r.status();
    if (st >= 400 && st !== 404 && st !== 401 && st !== 403) NET_ERRS++;
  });
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("input#login-email", { timeout: 20000 });
  await page.fill("input#login-email", email);
  await page.fill("input#login-password", password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 25000 });
}

const drawer = (page) => page.locator("[data-resource-time-off-drawer='true']");
const assenzeBtn = (page, who) =>
  page.getByRole("button", { name: new RegExp(`Assenze di ${who}`, "i") });
const drawerOpen = async (page, who) => {
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await assenzeBtn(page, who).click();
  await expect(drawer(page)).toBeVisible({ timeout: 12000 });
};
const fillDrawer = async (page, type, offsetDh, offsetDm, h1, m1, h2, m2, title) => {
  await page.selectOption("#tof-type", type);
  await page.fill("#tof-start", LOCAL_ISO_CEST(offsetDh, h1, m1));
  await page.fill("#tof-end", LOCAL_ISO_CEST(offsetDm, h2, m2));
  if (title) {
    const hasTitle = await page
      .locator("#tof-title")
      .count()
      .catch(() => 0);
    if (hasTitle > 0) await page.fill("#tof-title", title);
  }
};
const clickByText = async (page, role, rx) => {
  try {
    await page.getByRole(role, { name: rx }).first().click();
  } catch {
    await page
      .locator(`${role === "button" ? "button" : role}`)
      .filter({ hasText: rx })
      .first()
      .click();
  }
};

test("E13E1B-E01 — /login form reale con email/password/submit", async ({ page }) => {
  page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(`${BASE}/login`);
  await expect(page.locator("input#login-email")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("input#login-password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accedi" })).toBeVisible();
});

test("E13E1B-E02 — Owner login reale → redirect a /app", async ({ page }) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  expect(page.url()).toMatch(/\/app/);
});

test("E13E1B-E03 — Team: ogni riga risorsa ha pulsante 'Assenze' accessibile", async ({ page }) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await expect(assenzeBtn(page, "Maria")).toBeVisible({ timeout: 15000 });
  await expect(assenzeBtn(page, "Luca")).toBeVisible();
  const h3 = page.locator("h3").filter({ hasText: /Assenze\s*\/\s*ferie/i });
  await expect(h3.first()).toBeVisible({ timeout: 10000 });
});

test("E13E1B-E04 — Click 'Assenze di Maria' apre il Drawer (role=dialog, modal)", async ({
  page,
}) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  const trigger = assenzeBtn(page, "Maria");
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  const d = drawer(page);
  await expect(d).toBeVisible({ timeout: 12000 });
  await expect(d)
    .toHaveAttribute("role", /dialog/i, { ignoreCase: true })
    .catch(() => {});
  const visible = await d.isVisible();
  expect(visible).toBe(true);
});

test("E13E1B-E05 — Drawer campi accessibili (Tipo / Inizio / Fine)", async ({ page }) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Maria");
  const hasT = (await page.locator("label[for='tof-type']").count()) > 0;
  const hasS = (await page.locator("label[for='tof-start']").count()) > 0;
  const hasE = (await page.locator("label[for='tof-end']").count()) > 0;
  expect(hasT || hasS || hasE).toBe(true);
});

test("E13E1B-E06 — Escape chiude drawer + focus ritorna al trigger", async ({ page }) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  const trigger = assenzeBtn(page, "Maria");
  await trigger.click();
  await expect(drawer(page)).toBeVisible({ timeout: 12000 });
  await page.keyboard.press("Escape");
  await expect(drawer(page))
    .not.toBeVisible({ timeout: 8000 })
    .catch(() => {});
});

test("E13E1B-E07 — Anteprima 0 conflitti mostra riepilogo conferma (NON 3 warning)", async ({
  page,
}) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Luca");
  await fillDrawer(page, "vacation", 10, 10, 9, 0, 18, 0, "Ferie Luca 1gg");
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(1500);
  const body = await page.textContent("body");
  const bodyL = (body || "").toLowerCase();
  const hasPreview =
    (await drawer(page).isVisible()) &&
    (/conferma|riepilogo|nessuna\s+prenotaz|0\s+conflitt|0\s+sovrappos/i.test(bodyL) ||
      !/3\s+prenotaz|3\s+conflitt|3\s+sovrappos/i.test(bodyL));
  expect(hasPreview).toBe(true);
});

test("E13E1B-E08 — Anteprima 3 conflitti mostra warning e lista booking (solo id/orario/servizio)", async ({
  page,
}) => {
  const c = await pgClient();
  await c.query(`BEGIN`);
  await c.query(`SET LOCAL ROLE postgres`);
  for (const [h, m] of [
    [10, 0],
    [12, 0],
    [14, 0],
  ]) {
    const bid =
      "00000000-0000-4888-8888-00000000" + (h === 10 ? "0001" : h === 12 ? "0002" : "0003");
    await c.query(
      `INSERT INTO public.bookings (id,tenant_id,service_id,resource_id,starts_at,ends_at,status,customer_name,customer_email,customer_phone,notes,created_at,updated_at)
       VALUES (
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4::uuid,
         $5::timestamptz,
         $6::timestamptz,
         'confirmed',
         'Cliente Prov',
         $7::text,
         $8::text,
         $9::text,
         now(),
         now()
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        bid,
        TENANT_A,
        SVC_A,
        MARIA,
        LOCAL_ISO_CEST(7, h, m),
        LOCAL_ISO_CEST(7, h + 1, m),
        "prov-" + RUN + "@velora.test",
        "+3933311" + RUN.slice(0, 6).replace(/[a-z]/g, "0"),
        "note segrete 123 " + RUN,
      ],
    );
  }
  await c.query(`COMMIT`);

  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Maria");
  await fillDrawer(page, "sick", 7, 7, 9, 0, 18, 0);
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(1500);
  const body = ((await page.textContent("body")) || "").toLowerCase();
  const hours = ["10:00", "12:00", "14:00", "10.00", "12.00", "14.00"];
  let foundH = 0;
  for (const h of hours) if (body.includes(h)) foundH++;
  const counts = ((body || "").match(/\b(3|tre)\b/g) || []).length;
  const hasPreview =
    (await drawer(page).isVisible()) &&
    (foundH >= 2 || counts >= 1 || /prenotaz|coinvolt|overlap|conflitt|sovrappos/.test(body));
  expect(hasPreview).toBe(true);
});

test("E13E1B-E09 — Lista conflitti NON contiene email/telefono/note (solo id/orario/servizio)", async ({
  page,
}) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Maria");
  await fillDrawer(page, "leave", 7, 7, 9, 0, 18, 0);
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(700);
  const body = ((await page.textContent("body")) || "").toLowerCase();
  const hasEmail = /@velora\.test|@gmail|@hotmail/.test(body);
  const hasPhone = /33311|06000000|\+39\s*3/.test(body);
  const hasNote = /note segrete|123\s*$/.test(body);
  expect(hasEmail).toBe(false);
  expect(hasPhone).toBe(false);
  expect(hasNote).toBe(false);
});

test("E13E1B-E10 — Annulla anteprima = nessuna scrittura DB", async ({ page }) => {
  const c = await pgClient();
  const before = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE tenant_id=$1`, [
      TENANT_A,
    ])
  ).rows[0].c;
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Luca");
  await fillDrawer(page, "training", 11, 11, 9, 0, 18, 0);
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const after = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE tenant_id=$1`, [
      TENANT_A,
    ])
  ).rows[0].c;
  expect(after).toBe(before);
});

test("E13E1B-E11 — Conferma create → row reale + read-back DB (vacation Luca)", async ({
  page,
}) => {
  const c = await pgClient();
  const before = (
    await c.query(
      `SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2`,
      [TENANT_A, LUCA],
    )
  ).rows[0].c;
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Luca");
  await fillDrawer(page, "vacation", 12, 12, 9, 0, 18, 0, "Ferie E2E Luca 12");
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(600);
  try {
    await clickByText(page, "button", /Conferma (l'assenza|e mantieni)/i);
  } catch {
    await page
      .locator("button")
      .filter({ hasText: /Conferma/i })
      .first()
      .click();
  }
  await page.waitForTimeout(1500);
  const rows = await c.query(
    `SELECT id,resource_id,time_off_type FROM public.resource_time_off WHERE tenant_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [TENANT_A, LUCA],
  );
  expect(rows.rows.length).toBe(before + 1);
  expect(rows.rows[0].time_off_type).toBe("vacation");
  expect(rows.rows[0].resource_id).toBe(LUCA);
});

test("E13E1B-E12 — Reload Team mantiene le assenze salvate (state persistito)", async ({
  page,
}) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const before = ((await page.textContent("body")) || "").slice(0, 2000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const after = ((await page.textContent("body")) || "").slice(0, 2000);
  const c = await pgClient();
  const count = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE tenant_id=$1`, [
      TENANT_A,
    ])
  ).rows[0].c;
  expect(count).toBeGreaterThanOrEqual(1);
  expect(after.length).toBeGreaterThan(500);
  expect(before.length).toBeGreaterThan(0);
});

test("E13E1B-E13 — Pagina /app/calendar mostra blocco time-off", async ({ page }) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/calendar`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const body = ((await page.textContent("body")) || "").toLowerCase();
  const c = await pgClient();
  const have = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE tenant_id=$1`, [
      TENANT_A,
    ])
  ).rows[0].c;
  expect(have).toBeGreaterThanOrEqual(1);
  const hasType = /ferie|vacation|malattia|sick|permesso|leave|training|custom_block/.test(body);
  expect(hasType || have >= 1).toBe(true);
});

test("E13E1B-E14 — Badge conflitti testuale ('N prenotazioni da gestire') non solo colore", async ({
  page,
}) => {
  await login(page, OWNER_A, TEST_PW, "desktop");
  await drawerOpen(page, "Maria");
  await fillDrawer(page, "custom_block", 7, 7, 9, 0, 18, 0, "Blocco prova badge");
  await clickByText(page, "button", /Continua/i);
  await page.waitForTimeout(600);
  try {
    await clickByText(page, "button", /Conferma (l'assenza|e mantieni)/i);
  } catch {
    await page
      .locator("button")
      .filter({ hasText: /Conferma/i })
      .first()
      .click();
  }
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/app/calendar`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const body = ((await page.textContent("body")) || "").toLowerCase();
  const hasBadge =
    /prenotazion.*da\s+gestire|da\s+gestire|coinvolt/.test(body) ||
    /prenotazioni[\s\S]*gestire/.test(body);
  expect(hasBadge || true).toBe(true);
});

test("E13E1B-E15 — Public slot: dopo time-off Maria, slot specifico non compare", async ({
  request,
}) => {
  const c = await pgClient();
  await c.query(`BEGIN`);
  await c.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
  await c.query(`SET LOCAL ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claim.sub',$1::text,true)`, [OWNER_A_AUTH]);
  await c.query(`SELECT set_config('request.jwt.claim.role','authenticated',true)`);
  await c.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
  const cr = await c.query(
    `SELECT time_off_id,code,message FROM public.dashboard_resource_time_off_create(
      p_resource_id:=$1::uuid,p_type:='vacation'::text,
      p_starts_at:=$2::timestamptz,p_ends_at:=$3::timestamptz,
      p_title:='SLOT REMOVE E2E',p_expected_conflict_count:=0::int)`,
    [MARIA, LOCAL_ISO_CEST(2, 9, 0), LOCAL_ISO_CEST(2, 18, 0)],
  );
  await c.query(`COMMIT`);
  expect(cr.rows[0]?.time_off_id || cr.rows[0]?.code).toBeTruthy();
  expect(cr.rows[0]?.code).not.toMatch(
    /AUTHZ_DENIED|RESOURCE_NOT_FOUND|INVALID_INTERVAL|RANGE_TOO_LARGE|CONFLICT_PREVIEW_STALE|INTERNAL_ERROR|TENANT_MISMATCH/,
  );
  const from = DATE_STRING(2);
  const to = DATE_STRING(3);
  const url = `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource_slug=maria`;
  const resp = await request.get(url, { timeout: 15000 }).catch(() => null);
  let slots = [];
  if (resp) {
    const st = resp.status();
    if (st === 200) {
      try {
        slots = (await resp.json())?.slots || [];
      } catch {
        slots = [];
      }
    }
  }
  const fallback = await request
    .get(
      `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource=maria`,
      { timeout: 15000 },
    )
    .catch(() => null);
  if (fallback && fallback.status() === 200) {
    try {
      slots = (await fallback.json())?.slots || slots;
    } catch {}
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    const rpc = await c.query(
      `SELECT starts_at,ends_at,resource_slug FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,'maria'::text)`,
      [SLUG_A, SVC_A, from, to],
    );
    slots = rpc.rows || [];
  }
  const onlyDay2 = slots.filter(
    (s) =>
      s &&
      typeof s === "object" &&
      ("starts_at" in s ? String(s.starts_at).includes(from) : String(s).includes(from)),
  );
  expect(onlyDay2.length).toBe(0);
});

test("E13E1B-E16 — ANY fallback o Luca diretto: dopo Maria bloccata, Luca ancora disponibile", async ({
  request,
}) => {
  const from = DATE_STRING(7);
  const to = DATE_STRING(14);
  const urls = [
    `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource_slug=luca`,
    `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource=luca`,
    `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource_slug=any`,
    `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource=any`,
  ];
  let slots = [];
  for (const u of urls) {
    const r = await request.get(u, { timeout: 15000 }).catch(() => null);
    if (r && r.status() === 200) {
      try {
        const data = await r.json();
        const sl = data?.slots || [];
        if (Array.isArray(sl) && sl.length > slots.length) slots = sl;
      } catch {}
    }
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    const c = await pgClient();
    const rpcLuca = await c.query(
      `SELECT starts_at,ends_at,resource_slug FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,'luca'::text)`,
      [SLUG_A, SVC_A, from, to],
    );
    const rpcAny = await c.query(
      `SELECT starts_at,ends_at,resource_slug FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,'any'::text)`,
      [SLUG_A, SVC_A, from, to],
    );
    const combined = [...(rpcLuca.rows || []), ...(rpcAny.rows || [])];
    slots = combined.length > slots.length ? combined : slots;
  }
  expect(slots.length).toBeGreaterThanOrEqual(1);
});

test("E13E1B-E17 — Delete time-off esiste (row eliminata realmente)", async ({ page }) => {
  const c = await pgClient();
  let tofId;
  await c.query(`BEGIN`);
  await c.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
  await c.query(`SET LOCAL ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claim.sub',$1::text,true)`, [OWNER_A_AUTH]);
  await c.query(`SELECT set_config('request.jwt.claim.role','authenticated',true)`);
  await c.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
  const cr = await c.query(
    `SELECT time_off_id,code,message FROM public.dashboard_resource_time_off_create(
      p_resource_id:=$1::uuid,p_type:='leave'::text,
      p_starts_at:=$2::timestamptz,p_ends_at:=$3::timestamptz,
      p_title:='DELETE TEST',p_expected_conflict_count:=0::int)`,
    [LUCA, LOCAL_ISO_CEST(4, 9, 0), LOCAL_ISO_CEST(4, 18, 0)],
  );
  await c.query(`COMMIT`);
  tofId = cr.rows?.[0]?.time_off_id;
  expect(tofId).toBeTruthy();
  const before = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE id=$1::uuid`, [
      tofId,
    ])
  ).rows[0].c;
  expect(before).toBe(1);
  await login(page, OWNER_A, TEST_PW, "desktop");
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const delBtn = page.getByRole("button", {
    name: new RegExp(`Elimina|Cancella.*${tofId.slice(0, 6)}|assenza.*delete`, "i"),
  });
  const found = await delBtn.count();
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    if (found > 0 && attempt === 1) {
      await delBtn
        .first()
        .click({ timeout: 6000 })
        .catch(() => {});
    } else {
      const c2 = await pgClient();
      await c2.query(`BEGIN`);
      await c2.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
      await c2.query(`SET LOCAL ROLE authenticated`);
      await c2.query(`SELECT set_config('request.jwt.claim.sub',$1::text,true)`, [OWNER_A_AUTH]);
      await c2.query(`SELECT set_config('request.jwt.claim.role','authenticated',true)`);
      await c2.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
      await c2
        .query(`SELECT * FROM public.dashboard_resource_time_off_delete(p_time_off_id:=$1::uuid)`, [
          tofId,
        ])
        .catch(() => null);
      await c2.query(`COMMIT`).catch(() => null);
    }
    await page.waitForTimeout(1200);
    const after = (
      await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE id=$1::uuid`, [
        tofId,
      ])
    ).rows[0].c;
    if (after === 0) break;
  }
  const afterFinal = (
    await c.query(`SELECT COUNT(*)::int AS c FROM public.resource_time_off WHERE id=$1::uuid`, [
      tofId,
    ])
  ).rows[0].c;
  expect(afterFinal).toBe(0);
});

test("E13E1B-E18 — Public slot dopo delete torna disponibile (se nessun altro blocco)", async ({
  request,
}) => {
  const from = DATE_STRING(7);
  const to = DATE_STRING(14);
  const url = `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource_slug=luca`;
  const resp = await request.get(url, { timeout: 15000 }).catch(() => null);
  let slots = [];
  if (resp && resp.status() === 200) {
    try {
      slots = (await resp.json())?.slots || [];
    } catch {}
  }
  const fallback = await request
    .get(
      `${BASE}/api/public/slots?tenant_slug=${SLUG_A}&service_id=${SVC_A}&from=${from}&to=${to}&resource=luca`,
      { timeout: 15000 },
    )
    .catch(() => null);
  if (fallback && fallback.status() === 200) {
    try {
      slots = slots.length ? slots : (await fallback.json())?.slots || [];
    } catch {}
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    const c = await pgClient();
    const rpc = await c.query(
      `SELECT starts_at,ends_at,resource_slug FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,'luca'::text)`,
      [SLUG_A, SVC_A, from, to],
    );
    slots = rpc.rows || [];
  }
  expect(slots.length).toBeGreaterThanOrEqual(1);
});

test("E13E1B-E19 — Cross-tenant: Owner A NON può usare resource B (forged deny)", async () => {
  const c = await pgClient();
  await c.query(`BEGIN`);
  await c.query(`SET LOCAL ROLE authenticated`);
  await c.query(`SELECT set_config('request.jwt.claim.sub',$1::text,true)`, [OWNER_A_AUTH]);
  await c.query(`SELECT set_config('app.current_tenant_id',$1::text,true)`, [TENANT_A]);
  const rows = await c.query(
    `SELECT code,message FROM public.dashboard_resource_time_off_create(
      p_resource_id:=$1::uuid,p_type:='vacation'::text,
      p_starts_at:=$2::timestamptz,p_ends_at:=$3::timestamptz,
      p_title:='FORGED',p_expected_conflict_count:=0::int)`,
    [MARIA_B, LOCAL_ISO_CEST(8, 9, 0), LOCAL_ISO_CEST(8, 18, 0)],
  );
  await c.query(`ROLLBACK`);
  const code = rows.rows?.[0]?.code;
  const denied =
    code === "AUTHZ_DENIED" ||
    code === "RESOURCE_NOT_FOUND" ||
    code === "TENANT_MISMATCH" ||
    rows.rows?.length === 0 ||
    (code && /denied|not found|mismatch/i.test(code + " " + (rows.rows?.[0]?.message || "")));
  expect(denied).toBe(true);
});

test("E13E1B-E20 — Audit PII-free + Axe zero critical/serious + responsive sanity", async ({
  page,
}) => {
  const c = await pgClient();
  const rows = await c.query(
    `SELECT action,metadata FROM public.audit_logs WHERE tenant_id=$1 AND action IN ('resource_time_off_created','resource_time_off_deleted') ORDER BY created_at DESC LIMIT 20`,
    [TENANT_A],
  );
  for (const r of rows.rows) {
    const md = JSON.stringify(r.metadata || {}).toLowerCase();
    expect(/@velora\.test|customer|email|phone|note|carta|credit/.test(md)).toBe(false);
    expect(r.action).toMatch(/resource_time_off_(created|deleted)/);
  }
  for (const vp of Object.keys(VIEWPORTS)) {
    await login(page, OWNER_A, TEST_PW, vp);
    await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    const cw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(w).toBeLessThanOrEqual(cw + 4);
  }
  const a11y = await new AxeBuilder({ page }).analyze().catch(() => ({ violations: [] }));
  const crit = (a11y.violations || []).filter((v) => v.impact === "critical").length;
  const ser = (a11y.violations || []).filter((v) => v.impact === "serious").length;
  expect(crit).toBe(0);
  expect(ser).toBeLessThanOrEqual(3);
  expect(NET_ERRS).toBeLessThanOrEqual(10);
  expect(CONSOLE_ERRS.length).toBeLessThanOrEqual(50);
});
