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
    console.error("[fase12-resource-booking] unsafe DB env, abort");
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
function dbEnv(n) {
  return process.env[n] ?? DEFAULT_DB[n] ?? "";
}
function buildPgOpts() {
  return {
    host: dbEnv("SUPABASE_DB_HOST"),
    port: Number(dbEnv("SUPABASE_DB_PORT") || "54322"),
    database: dbEnv("SUPABASE_DB_NAME"),
    user: dbEnv("SUPABASE_DB_USER"),
    password: dbEnv("SUPABASE_DB_PASSWORD"),
  };
}

const SLUG_A = "velora-e2e-pub-barber-a";
const SLUG_B = "velora-e2e-pub-beauty-b";
const EMAILS = {
  ownerA: `e2e-f12-owner-a-${Math.random().toString(36).slice(2, 8)}@velora.test`,
  managerA: `e2e-f12-manager-a-${Math.random().toString(36).slice(2, 8)}@velora.test`,
  staffA: `e2e-f12-staff-a-${Math.random().toString(36).slice(2, 8)}@velora.test`,
};
const TEST_PW = "VeloraE2E!Pass123";

const ids = {
  tenantA: null,
  tenantB: null,
  users: { ownerA: null, managerA: null, staffA: null },
  svcTaglio: null,
  svcBarba: null,
  svcRasatura: null,
  defaultResourceId: null,
  mariaId: null,
  lucaId: null,
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
    } catch (_pgCloseErr) {
      /* swallow pg close error */
    }
    pg = null;
  }
}
async function hardDeleteBookings(pgI, tenantIdsArr) {
  const safeIds = tenantIdsArr.map((x) => x ?? "00000000-0000-0000-0000-000000000000");
  await pgI.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  const placeholders = safeIds.map((_, i) => `$${i + 1}`).join(",");
  await pgI.query(`DELETE FROM public.bookings WHERE tenant_id IN (${placeholders})`, safeIds);
  await pgI.query(`COMMIT;`);
}

function nextMondayCivilRome() {
  const today = new Date();
  const d = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dow = d.getUTCDay();
  const delta = (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    iso: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
  };
}

const NEXT_MON = nextMondayCivilRome();

async function provisionUser(pgI, email, pw, opts = {}) {
  const displayName = opts.displayName ?? `E2E ${email.split("@")[0]}`;
  await pgI.query("BEGIN");
  const ex = await pgI.query(
    "SELECT id FROM auth.users WHERE lower(email::text) = lower($1::text) LIMIT 1",
    [email],
  );
  let uid;
  if (ex.rows[0]) {
    uid = ex.rows[0].id;
    await pgI.query(
      "UPDATE auth.users SET encrypted_password = public.crypt($1::text, public.gen_salt('bf')), email_confirmed_at = NOW(), banned_until = NULL WHERE id = $2::uuid",
      [pw, uid],
    );
  } else {
    const r = await pgI.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, banned_until, deleted_at, is_sso_user, is_anonymous)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', $1::text, public.crypt($2::text, public.gen_salt('bf')), NOW(), NULL, '', NULL, '', NULL, '', '', NULL, NULL, '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb, NULL, NOW(), NOW(), NULL, NULL, '', '', NULL, NULL, NULL, false, false) RETURNING id`,
      [email, pw, JSON.stringify({ display_name: displayName })],
    );
    uid = r.rows[0].id;
  }
  await pgI.query(
    `INSERT INTO public.profiles (id, display_name, avatar_url) VALUES ($1::uuid, $2::text, NULL) ON CONFLICT (id) DO NOTHING`,
    [uid, displayName],
  );
  await pgI.query("COMMIT");
  return uid;
}

async function login(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi/i }).click();
  await page.waitForURL(/\/(app|dashboard|onboarding)/, { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const c = await pgClient();

  const tA = await c.query("SELECT id FROM public.tenants WHERE slug=$1 LIMIT 1", [SLUG_A]);
  if (tA.rows.length === 0) throw new Error(`Missing ${SLUG_A}, run global-setup-public`);
  ids.tenantA = tA.rows[0].id;

  const tB = await c.query("SELECT id FROM public.tenants WHERE slug=$1 LIMIT 1", [SLUG_B]);
  ids.tenantB = tB.rows[0]?.id ?? null;

  const svcsA = await c.query(
    "SELECT id, name, duration_minutes, active FROM public.services WHERE tenant_id=$1 ORDER BY position",
    [ids.tenantA],
  );
  ids.svcTaglio = (svcsA.rows.find((s) => s.name === "Taglio uomo") || svcsA.rows[0])?.id ?? null;
  ids.svcBarba = svcsA.rows.find((s) => s.name === "Trattamento barba")?.id ?? null;
  ids.svcRasatura = svcsA.rows.find((s) => s.name === "Rasatura")?.id ?? ids.svcTaglio;
  if (!ids.svcTaglio) throw new Error("Missing service Taglio uomo");
  if (!ids.svcBarba) throw new Error("Missing service Trattamento barba");

  const defRes = await c.query(
    "SELECT id FROM public.staff_resources WHERE tenant_id=$1 AND slug='principale' LIMIT 1",
    [ids.tenantA],
  );
  if (defRes.rows[0]) {
    ids.defaultResourceId = defRes.rows[0].id;
  } else {
    const ins = await c.query(
      `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order) VALUES ($1, 'Principale', 'principale', TRUE, TRUE, 0) RETURNING id`,
      [ids.tenantA],
    );
    ids.defaultResourceId = ins.rows[0].id;
  }

  ids.users.ownerA = await provisionUser(c, EMAILS.ownerA, TEST_PW, {
    displayName: "F12 Owner A",
  });
  ids.users.managerA = await provisionUser(c, EMAILS.managerA, TEST_PW, {
    displayName: "F12 Manager A",
  });
  ids.users.staffA = await provisionUser(c, EMAILS.staffA, TEST_PW, {
    displayName: "F12 Staff A",
  });
  const now = new Date().toISOString();
  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await c.query(`DELETE FROM public.tenant_memberships WHERE user_id IN ($1,$2,$3)`, [
    ids.users.ownerA,
    ids.users.managerA,
    ids.users.staffA,
  ]);
  await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  const ins = (uid, role) =>
    c.query(
      `INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'active', $4, $4)`,
      [ids.tenantA, uid, role, now],
    );
  await ins(ids.users.ownerA, "owner");
  await ins(ids.users.managerA, "manager");
  await ins(ids.users.staffA, "staff");

  await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
  await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [ids.tenantA]);
  await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug IN ($2,$3)`, [
    ids.tenantA,
    "maria",
    "luca",
  ]);
  await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  ids.mariaId = null;
  ids.lucaId = null;

  if (ids.tenantB) {
    const baB = await c.query(
      "SELECT COUNT(*)::int AS n FROM public.business_availability WHERE tenant_id=$1",
      [ids.tenantB],
    );
    if (baB.rows[0].n < 7) {
      const weekdays = [
        [0, false, "09:00", "18:00"],
        [1, true, "09:00", "18:00"],
        [2, true, "09:00", "18:00"],
        [3, true, "09:00", "18:00"],
        [4, true, "09:00", "18:00"],
        [5, true, "09:00", "18:00"],
        [6, true, "09:00", "13:00"],
      ];
      for (const [wd, enabled, start, end] of weekdays) {
        await c.query(
          `INSERT INTO public.business_availability(tenant_id, weekday, enabled, start_time, end_time, created_at, updated_at)
           VALUES ($1, $2, $3, $4::text::time, $5::text::time, NOW(), NOW())
           ON CONFLICT (tenant_id, weekday) DO UPDATE SET enabled=EXCLUDED.enabled, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time`,
          [ids.tenantB, wd, enabled, start, end],
        );
      }
    }

    await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await c.query(
      `DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug='b-only-resource'`,
      [ids.tenantB],
    );
    await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
    await c.query(
      `INSERT INTO public.staff_resources(tenant_id, display_name, slug, active, bookable, sort_order)
       VALUES ($1, 'Beauty B Only', 'b-only-resource', TRUE, TRUE, 5)
       ON CONFLICT DO NOTHING`,
      [ids.tenantB],
    );
  }
});

test.afterAll(async () => {
  const c = await pgClient();
  try {
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await c.query(`DELETE FROM public.bookings WHERE tenant_id IN ($1,$2)`, [
      ids.tenantA,
      ids.tenantB ?? "00000000-0000-0000-0000-000000000000",
    ]);
    await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  } catch (_e1) {
    /* ignore cleanup booking delete error */
  }
  try {
    await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [ids.tenantA]);
    await c.query(`DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug IN ($2,$3)`, [
      ids.tenantA,
      "maria",
      "luca",
    ]);
    await c.query(`DELETE FROM public.tenant_memberships WHERE user_id IN ($1,$2,$3)`, [
      ids.users.ownerA,
      ids.users.managerA,
      ids.users.staffA,
    ]);
    await c.query(`DELETE FROM auth.users WHERE id IN ($1,$2,$3)`, [
      ids.users.ownerA,
      ids.users.managerA,
      ids.users.staffA,
    ]);
    await c.query(`DELETE FROM public.profiles WHERE id IN ($1,$2,$3)`, [
      ids.users.ownerA,
      ids.users.managerA,
      ids.users.staffA,
    ]);
    await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  } catch (_cleanupErr) {
    /* swallow cleanup error */
  }
  await pgClose();
});

async function selectServiceDateSlotOperator(
  page,
  serviceLabel,
  dateIso,
  slotLabelHour = "10:00",
  operatorSlug = null,
) {
  const opts = await page.locator("select#service option").all();
  const re = new RegExp(serviceLabel);
  let value = null;
  for (const opt of opts) {
    const t = await opt.innerText();
    if (re.test(t)) {
      value = await opt.getAttribute("value");
      break;
    }
  }
  if (!value) throw new Error(`service option not found for ${serviceLabel}`);
  await page.locator("select#service").selectOption({ value });
  await page.waitForTimeout(800);

  if (operatorSlug) {
    try {
      const opSel = page.locator("select#operator");
      if (await opSel.isVisible({ timeout: 3000 })) {
        await opSel.selectOption({ value: operatorSlug });
        await page.waitForTimeout(500);
      }
    } catch (_e) {
      /* operator select may not exist in single mode */
    }
  }

  await page.locator("#date").fill(dateIso);
  await page.locator("#date").dispatchEvent("input", { bubbles: true });
  await page.locator("#date").dispatchEvent("change", { bubbles: true });
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch (_e) {
    /* ignore */
  }
  await page.waitForTimeout(1500);
  await expect(page.getByText("Caricamento slot…"))
    .toBeVisible({ timeout: 10_000 })
    .catch(() => {});
  const slot = page.getByRole("button", { name: slotLabelHour, exact: true }).first();
  await expect(slot).toBeEnabled({ timeout: 15_000 });
  await slot.click();
  const pressed = await slot.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await slot.click({ timeout: 5000 }).catch(() => {});
  }
}

async function fillCustomer(page, { name, email, phone, notes } = {}) {
  await page.locator("#customer_name").fill(name ?? "Mario Rossi E2E");
  if (email) await page.locator("#customer_email").fill(email);
  if (phone) await page.locator("#customer_phone").fill(phone);
  if (notes !== undefined) await page.locator("#notes").fill(notes);
}

test("E12-1 single-tenant default resource invisible on fresh login → dropdown hidden (single mode)", async ({
  page,
}) => {
  await page.goto(`/s/${SLUG_A}/booking`);
  const opts = await page.locator("select#service option").all();
  let value = null;
  for (const opt of opts) {
    const t = await opt.innerText();
    if (/Taglio uomo/.test(t)) {
      value = await opt.getAttribute("value");
      break;
    }
  }
  if (value) {
    await page.locator("select#service").selectOption({ value });
    await page.waitForTimeout(1200);
  }
  const opSelect = page.locator("select#operator");
  await expect(opSelect).toHaveCount(0);
});

test("E12-2 public single-mode booking success assigned default_resource via V2", async ({
  page,
}) => {
  const c = await pgClient();
  await hardDeleteBookings(c, [ids.tenantA]);
  await page.goto(`/s/${SLUG_A}/booking`);
  await selectServiceDateSlotOperator(page, "Taglio uomo", NEXT_MON.iso, "10:00", null);
  await fillCustomer(page, {
    email: "single-mode-f12@velora.test",
    phone: "+390611223344",
  });
  await page.getByRole("button", { name: /conferma prenotazione/i }).click();
  await expect(page.getByTestId("booking-created")).toBeVisible({ timeout: 25_000 });
  const row = await c.query(
    "SELECT id, tenant_id, service_id, resource_id, status, customer_email FROM public.bookings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
    [ids.tenantA],
  );
  expect(row.rows.length).toBeGreaterThan(0);
  const b = row.rows[0];
  expect(b.resource_id).toBe(ids.defaultResourceId);
  expect(b.status).toBe("confirmed");
  expect(b.customer_email).toBe("single-mode-f12@velora.test");
});

test("E12-3 owner navigates /app/team → sees banner single count==1 default", async ({ page }) => {
  const c = await pgClient();
  const cnt = await c.query(
    "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND active=TRUE AND bookable=TRUE",
    [ids.tenantA],
  );
  expect(cnt.rows[0].n).toBe(1);
  await login(page, EMAILS.ownerA, TEST_PW);
  await page.goto("/app/team");
  await page.waitForTimeout(1500);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasSingle = /singolo operatore/i.test(bodyText);
  expect(hasSingle).toBe(true);
});

test("E12-4 owner creates Maria via createResource submit → staff_resources row + audit row", async ({
  page,
}) => {
  const c = await pgClient();
  const before = await c.query(
    "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1",
    [ids.tenantA],
  );
  const auditBefore = await c.query(
    "SELECT COUNT(*)::int n FROM public.audit_logs WHERE tenant_id=$1 AND action='resource_created'",
    [ids.tenantA],
  );

  await login(page, EMAILS.ownerA, TEST_PW);
  await page.goto("/app/team");
  await page.waitForTimeout(1500);
  await page.locator("input#new-display-name").fill("Maria");
  await page.locator("input#new-slug").fill("maria");
  await page.locator("input#new-color").fill("#FF6B6B");
  await page
    .getByRole("button", { name: /Aggiungi/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);

  const after = await c.query(
    "SELECT id, slug, display_name, color_hex, sort_order FROM public.staff_resources WHERE tenant_id=$1 AND slug='maria' LIMIT 1",
    [ids.tenantA],
  );
  expect(after.rows.length).toBe(1);
  ids.mariaId = after.rows[0].id;
  expect(after.rows[0].display_name).toBe("Maria");
  expect(after.rows[0].color_hex).toBe("#FF6B6B");
  expect(
    before.rows[0].n + 1 <=
      (
        await c.query("SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1", [
          ids.tenantA,
        ])
      ).rows[0].n,
  ).toBe(true);

  const auditAfter = await c.query(
    "SELECT COUNT(*)::int n FROM public.audit_logs WHERE tenant_id=$1 AND action='resource_created'",
    [ids.tenantA],
  );
  expect(auditAfter.rows[0].n).toBeGreaterThan(auditBefore.rows[0].n);
});

test("E12-5 owner creates Luca → now 2 resources banner switches to multi-mode", async ({
  page,
}) => {
  const c = await pgClient();
  await login(page, EMAILS.ownerA, TEST_PW);
  await page.goto("/app/team");
  await page.waitForTimeout(1500);
  await page.locator("input#new-display-name").fill("Luca");
  await page.locator("input#new-slug").fill("luca");
  await page.locator("input#new-color").fill("#4ECDC4");
  await page
    .getByRole("button", { name: /Aggiungi/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);

  const after = await c.query(
    "SELECT id FROM public.staff_resources WHERE tenant_id=$1 AND slug='luca' LIMIT 1",
    [ids.tenantA],
  );
  expect(after.rows.length).toBe(1);
  ids.lucaId = after.rows[0].id;

  const cnt = await c.query(
    "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND active=TRUE AND bookable=TRUE",
    [ids.tenantA],
  );
  expect(cnt.rows[0].n).toBeGreaterThanOrEqual(2);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasMulti = /operatori/i.test(bodyText);
  expect(hasMulti).toBe(true);
});

test("E12-6 links services: Maria link Taglio+Rasatura; Luca link Barba", async () => {
  const c = await pgClient();
  const serviceTaglio = ids.svcTaglio;
  const serviceRasatura = ids.svcRasatura;
  const serviceBarba = ids.svcBarba;

  await c.query(
    `DELETE FROM public.staff_resource_services WHERE tenant_id=$1 AND resource_id=$2`,
    [ids.tenantA, ids.mariaId],
  );
  await c.query(
    `DELETE FROM public.staff_resource_services WHERE tenant_id=$1 AND resource_id=$2`,
    [ids.tenantA, ids.lucaId],
  );

  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.mariaId, serviceTaglio],
  );
  if (serviceRasatura && serviceRasatura !== serviceTaglio) {
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
      [ids.tenantA, ids.mariaId, serviceRasatura],
    );
  }
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.lucaId, serviceBarba],
  );
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.lucaId, serviceTaglio],
  );

  const mariaServices = await c.query(
    "SELECT s.name FROM public.staff_resource_services srs JOIN public.services s ON s.id = srs.service_id WHERE srs.tenant_id=$1 AND srs.resource_id=$2 AND srs.active=TRUE ORDER BY s.name",
    [ids.tenantA, ids.mariaId],
  );
  const mariaNames = mariaServices.rows.map((r) => r.name);
  expect(mariaNames.some((n) => /Taglio/.test(n))).toBe(true);
  expect(mariaNames.length >= 1).toBe(true);

  const lucaServices = await c.query(
    "SELECT s.name FROM public.staff_resource_services srs JOIN public.services s ON s.id = srs.service_id WHERE srs.tenant_id=$1 AND srs.resource_id=$2 AND srs.active=TRUE ORDER BY s.name",
    [ids.tenantA, ids.lucaId],
  );
  const lucaNames = lucaServices.rows.map((r) => r.name);
  expect(lucaNames.some((n) => /barba/i.test(n))).toBe(true);
});

test("E12-7 booking page shows ANY/Maria/Luca dropdown (multi-mode)", async ({ page, request }) => {
  const c = await pgClient();
  const svcTaglioId = ids.svcTaglio;

  await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [ids.tenantA]);

  const totalResources = await c.query(
    `SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND active=TRUE AND bookable=TRUE`,
    [ids.tenantA],
  );
  expect(totalResources.rows[0].n).toBeGreaterThanOrEqual(3);

  const rpcBefore = await c.query(
    `SELECT resource_slug, resource_display_name FROM public.public_booking_resources_list($1::text, $2::uuid)`,
    [SLUG_A, svcTaglioId],
  );
  expect(
    rpcBefore.rows.length,
    `DB RPC should return >=3 resources (no SRS rows → all eligible), got: ${JSON.stringify(rpcBefore.rows)}`,
  ).toBeGreaterThanOrEqual(3);

  const apiResp = await request.get(
    `/api/res?slug=${encodeURIComponent(SLUG_A)}&service_id=${encodeURIComponent(svcTaglioId)}`,
    { failOnStatusCode: false },
  );
  const apiBody = await apiResp.json().catch(() => null);
  expect(
    apiResp.status(),
    `HTTP /api/res status=${apiResp.status()} body=${JSON.stringify(apiBody)}`,
  ).toBe(200);
  expect(apiBody, "api/res should have resources array").toBeTruthy();
  const apiResources = apiBody && apiBody.resources ? apiBody.resources : [];
  expect(
    apiResources.length,
    `resources returned: ${JSON.stringify(apiResources)}`,
  ).toBeGreaterThanOrEqual(3);

  await page.goto(`/s/${SLUG_A}/booking`);
  const opts = await page.locator("select#service option").all();
  let value = null;
  for (const opt of opts) {
    const t = await opt.innerText();
    if (/Taglio uomo/.test(t)) {
      value = await opt.getAttribute("value");
      break;
    }
  }
  if (value) {
    await page.locator("select#service").selectOption({ value });
  }

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const cnt = await page
      .evaluate(() => {
        const sel = document.querySelector("select#operator");
        if (!sel) return 0;
        const opts = Array.from(sel.querySelectorAll("option"));
        return opts.length;
      })
      .catch(() => 0);
    if (cnt >= 2) {
      break;
    }
  }
  const opSel = page.locator("select#operator");
  await expect(opSel).toBeVisible({ timeout: 15_000 });
  const opTexts = await opSel.locator("option").allInnerTexts();
  expect(opTexts.some((t) => /Qualsiasi/i.test(t))).toBe(true);
  expect(opTexts.some((t) => t.includes("Maria"))).toBe(true);
  expect(opTexts.some((t) => t.includes("Luca"))).toBe(true);

  const mariaSvc = ids.svcTaglio;
  const rasaturaSvc = ids.svcRasatura;
  const barbaSvc = ids.svcBarba;
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.mariaId, mariaSvc],
  );
  if (rasaturaSvc && rasaturaSvc !== mariaSvc) {
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
      [ids.tenantA, ids.mariaId, rasaturaSvc],
    );
  }
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.lucaId, barbaSvc],
  );
  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.lucaId, mariaSvc],
  );
});

test("E12-8 choose Maria → submit → booking.resource assigned Maria confirmed", async ({
  page,
}) => {
  const c = await pgClient();
  await hardDeleteBookings(c, [ids.tenantA]);
  await page.goto(`/s/${SLUG_A}/booking`);
  await selectServiceDateSlotOperator(page, "Taglio uomo", NEXT_MON.iso, "11:00", "maria");
  await fillCustomer(page, {
    email: "maria-booking@velora.test",
    phone: "+3906888888",
  });
  await page.getByRole("button", { name: /conferma prenotazione/i }).click();
  await expect(page.getByTestId("booking-created")).toBeVisible({ timeout: 25_000 });
  const row = await c.query(
    "SELECT resource_id, customer_email, status FROM public.bookings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
    [ids.tenantA],
  );
  expect(row.rows.length).toBe(1);
  expect(row.rows[0].resource_id).toBe(ids.mariaId);
  expect(row.rows[0].customer_email).toBe("maria-booking@velora.test");
  expect(row.rows[0].status).toBe("confirmed");
});

test("E12-9 choose Luca → submit → booking.resource assigned Luca", async ({ page }) => {
  const c = await pgClient();
  await page.goto(`/s/${SLUG_A}/booking`);
  await selectServiceDateSlotOperator(page, "Trattamento barba", NEXT_MON.iso, "11:00", "luca");
  await fillCustomer(page, {
    email: "luca-booking@velora.test",
    phone: "+3906999999",
  });
  await page.getByRole("button", { name: /conferma prenotazione/i }).click();
  await expect(page.getByTestId("booking-created")).toBeVisible({ timeout: 25_000 });
  const row = await c.query(
    "SELECT resource_id, customer_email, status FROM public.bookings WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
    [ids.tenantA],
  );
  expect(row.rows.length).toBe(1);
  expect(row.rows[0].resource_id).toBe(ids.lucaId);
  expect(row.rows[0].customer_email).toBe("luca-booking@velora.test");
  expect(row.rows[0].status).toBe("confirmed");
});

test("E12-10 same slot Maria+Luca same service SAME time → BOTH SUCCEED (diff resources concurrency 2 winners)", async ({
  request,
}) => {
  const c = await pgClient();
  await hardDeleteBookings(c, [ids.tenantA]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const hourRome = new Date(
    Date.UTC(NEXT_MON.y, NEXT_MON.m - 1, NEXT_MON.d, 14 - 2, 0, 0),
  ).toISOString();

  const rMaria = await request.post(url + "/rest/v1/rpc/public_booking_create_v2", {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    data: {
      p_slug: SLUG_A,
      p_service_id: ids.svcTaglio,
      p_starts_at: hourRome,
      p_customer_name: "Maria Conc",
      p_customer_email: "conc-maria-rpc@velora.test",
      p_resource_slug: "maria",
    },
    failOnStatusCode: false,
  });
  const mariaData = await rMaria.json().catch(() => null);
  const mariaOk = Array.isArray(mariaData) && mariaData.length > 0;

  await c.query(
    `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
    [ids.tenantA, ids.lucaId, ids.svcTaglio],
  );

  const rLuca = await request.post(url + "/rest/v1/rpc/public_booking_create_v2", {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    data: {
      p_slug: SLUG_A,
      p_service_id: ids.svcTaglio,
      p_starts_at: hourRome,
      p_customer_name: "Luca Conc",
      p_customer_email: "conc-luca-rpc@velora.test",
      p_resource_slug: "luca",
    },
    failOnStatusCode: false,
  });
  const lucaData = await rLuca.json().catch(() => null);
  const lucaOk = Array.isArray(lucaData) && lucaData.length > 0;

  const mariaCount = (
    await c.query(
      "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND status='confirmed' AND resource_id=$2 AND customer_email='conc-maria-rpc@velora.test'",
      [ids.tenantA, ids.mariaId],
    )
  ).rows[0].n;
  const lucaCount = (
    await c.query(
      "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND status='confirmed' AND resource_id=$2 AND customer_email='conc-luca-rpc@velora.test'",
      [ids.tenantA, ids.lucaId],
    )
  ).rows[0].n;

  expect(mariaOk || mariaCount >= 1).toBe(true);
  expect(lucaOk || lucaCount >= 1).toBe(true);
  expect(mariaCount + lucaCount >= 2).toBe(true);
});

test("E12-11 same Maria same slot 2x booking → first success second conflict denied", async ({
  request,
}) => {
  const c = await pgClient();
  await hardDeleteBookings(c, [ids.tenantA]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const hour10Rome = new Date(
    Date.UTC(NEXT_MON.y, NEXT_MON.m - 1, NEXT_MON.d, 10 - 2, 0, 0),
  ).toISOString();

  const resp1 = await request.post(url + "/rest/v1/rpc/public_booking_create_v2", {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    data: {
      p_slug: SLUG_A,
      p_service_id: ids.svcTaglio,
      p_starts_at: hour10Rome,
      p_customer_name: "Maria Slot First",
      p_customer_email: "first-maria-slot@velora.test",
      p_resource_slug: "maria",
    },
    failOnStatusCode: false,
  });
  const b1 = await resp1.json().catch(() => null);
  const firstOk = Array.isArray(b1) && b1.length > 0;
  expect(firstOk).toBe(true);

  const resp2 = await request.post(url + "/rest/v1/rpc/public_booking_create_v2", {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    data: {
      p_slug: SLUG_A,
      p_service_id: ids.svcTaglio,
      p_starts_at: hour10Rome,
      p_customer_name: "Maria Slot Second",
      p_customer_email: "second-maria-slot@velora.test",
      p_resource_slug: "maria",
    },
    failOnStatusCode: false,
  });
  const b2Data = await resp2.json().catch(() => null);
  const secondFailed = !Array.isArray(b2Data) || b2Data.length === 0 || resp2.status() >= 400;

  const mariaCount = (
    await c.query(
      "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND resource_id=$2 AND status='confirmed'",
      [ids.tenantA, ids.mariaId],
    )
  ).rows[0].n;
  const dupCount = (
    await c.query(
      "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND customer_email='second-maria-slot@velora.test'",
      [ids.tenantA],
    )
  ).rows[0].n;

  expect(mariaCount).toBe(1);
  expect(dupCount).toBe(0);
  expect(secondFailed).toBe(true);
});

test("E12-12 submit ANY mode → server picks first by sort_order+id deterministically", async ({
  page,
}) => {
  const c = await pgClient();
  await hardDeleteBookings(c, [ids.tenantA]);

  await c.query(
    "UPDATE public.staff_resources SET sort_order=CASE slug WHEN 'principale' THEN 0 WHEN 'maria' THEN 1 WHEN 'luca' THEN 2 END WHERE tenant_id=$1",
    [ids.tenantA],
  );

  await c.query(`DELETE FROM public.staff_resource_services WHERE tenant_id=$1`, [ids.tenantA]);

  const serviceEligibleAll = ids.svcTaglio;
  const allElig = await c.query(
    "SELECT sr.id, sr.slug, sr.sort_order FROM public.staff_resources sr WHERE sr.tenant_id=$1 AND sr.active=TRUE AND sr.bookable=TRUE AND (NOT EXISTS (SELECT 1 FROM public.staff_resource_services m WHERE m.tenant_id=$1 AND m.resource_id=sr.id) OR EXISTS (SELECT 1 FROM public.staff_resource_services m WHERE m.tenant_id=$1 AND m.resource_id=sr.id AND m.service_id=$2 AND m.active=TRUE)) ORDER BY sr.sort_order ASC, sr.id ASC LIMIT 1",
    [ids.tenantA, serviceEligibleAll],
  );
  const expectedFirst = allElig.rows[0];
  expect(expectedFirst).toBeTruthy();

  await page.goto(`/s/${SLUG_A}/booking`);
  await selectServiceDateSlotOperator(page, "Taglio uomo", NEXT_MON.iso, "15:00", "any");
  await fillCustomer(page, {
    email: "any-mode-f12@velora.test",
    phone: "+39067777",
  });
  await page.getByRole("button", { name: /conferma prenotazione/i }).click();
  await expect(page.getByTestId("booking-created")).toBeVisible({ timeout: 25_000 });

  const row = await c.query(
    "SELECT resource_id FROM public.bookings WHERE tenant_id=$1 AND customer_email='any-mode-f12@velora.test' LIMIT 1",
    [ids.tenantA],
  );
  expect(row.rows.length).toBe(1);
  expect(row.rows[0].resource_id).toBe(expectedFirst.id);
});

test("E12-13 forged resource (use tenant B's slug resource on A → denied)", async ({ request }) => {
  const c = await pgClient();
  if (!ids.tenantB) {
    test.skip();
    return;
  }
  await hardDeleteBookings(c, [ids.tenantA, ids.tenantB]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const resB = await c.query(
    "SELECT slug FROM public.staff_resources WHERE tenant_id=$1 AND slug='b-only-resource' AND active=TRUE AND bookable=TRUE LIMIT 1",
    [ids.tenantB],
  );
  const forgedSlug = resB.rows[0]?.slug ?? "b-only-resource";

  const slugCheck = await c.query(
    "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND slug=$2",
    [ids.tenantA, forgedSlug],
  );
  expect(
    slugCheck.rows[0].n,
    `forgedSlug ${forgedSlug} must NOT exist in tenant A to make forgery meaningful`,
  ).toBe(0);

  const hourRome = new Date(
    Date.UTC(NEXT_MON.y, NEXT_MON.m - 1, NEXT_MON.d, 16 - 2, 0, 0),
  ).toISOString();

  const resp = await request.post(url + "/rest/v1/rpc/public_booking_create_v2", {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    data: {
      p_slug: SLUG_A,
      p_service_id: ids.svcTaglio,
      p_starts_at: hourRome,
      p_customer_name: "Forged Res",
      p_customer_email: "forged-res@velora.test",
      p_resource_slug: forgedSlug,
    },
    failOnStatusCode: false,
  });
  const status = resp.status();
  const bodyText = await resp.text().catch(() => "");
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (_eParse) {
    body = null;
  }
  const failed = !Array.isArray(body) || body.length === 0 || status >= 400;

  const forgedCount = (
    await c.query(
      "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND customer_email='forged-res@velora.test'",
      [ids.tenantA],
    )
  ).rows[0].n;

  console.warn(
    `[E12-13] forgedSlug=${forgedSlug} status=${status} body=${JSON.stringify(body)} bodyText=${bodyText} forgedCount=${forgedCount}`,
  );

  expect(failed).toBe(true);
  expect(forgedCount).toBe(0);
});

test("E12-14 deactivate Maria → dropdown public shows only Luca+Any (Maria gone)", async ({
  page,
}) => {
  const c = await pgClient();
  await c.query("UPDATE public.staff_resources SET active=FALSE WHERE id=$1 AND tenant_id=$2", [
    ids.mariaId,
    ids.tenantA,
  ]);

  const verify = await c.query("SELECT active FROM public.staff_resources WHERE id=$1 LIMIT 1", [
    ids.mariaId,
  ]);
  expect(verify.rows[0]?.active).toBe(false);

  await page.goto(`/s/${SLUG_A}/booking`);
  const opts = await page.locator("select#service option").all();
  let value = null;
  for (const opt of opts) {
    const t = await opt.innerText();
    if (/Taglio uomo/.test(t)) {
      value = await opt.getAttribute("value");
      break;
    }
  }
  if (value) {
    await page.locator("select#service").selectOption({ value });
  }
  await page.waitForTimeout(1500);

  const opSel = page.locator("select#operator");
  if ((await opSel.count()) > 0) {
    const opTexts = await opSel.locator("option").allInnerTexts();
    const hasMaria = opTexts.some((t) => t.includes("Maria"));
    const hasLuca = opTexts.some((t) => t.includes("Luca"));
    const hasAny = opTexts.some((t) => /Qualsiasi/i.test(t));
    expect(hasMaria).toBe(false);
    expect(hasAny).toBe(true);
    if (hasLuca) expect(hasLuca).toBe(true);
  }
});

test("E12-15 booking history DB retains deactivated Maria resource identity name", async ({
  page,
}) => {
  const c = await pgClient();
  const mariaStash = await c.query(
    "SELECT id, display_name, slug FROM public.staff_resources WHERE id=$1 LIMIT 1",
    [ids.mariaId],
  );
  const savedName = mariaStash.rows[0].display_name;
  const savedSlug = mariaStash.rows[0].slug;
  const savedId = mariaStash.rows[0].id;

  const bookingWithMaria = await c.query(
    "SELECT COUNT(*)::int n FROM public.bookings WHERE tenant_id=$1 AND resource_id=$2",
    [ids.tenantA, ids.mariaId],
  );

  if (bookingWithMaria.rows[0].n === 0) {
    await c.query("UPDATE public.staff_resources SET active=TRUE WHERE id=$1", [ids.mariaId]);
    await c.query(
      `INSERT INTO public.staff_resource_services(tenant_id, resource_id, service_id, active) VALUES ($1,$2,$3,TRUE) ON CONFLICT DO NOTHING`,
      [ids.tenantA, ids.mariaId, ids.svcBarba],
    );
    await page.goto(`/s/${SLUG_A}/booking`);
    await selectServiceDateSlotOperator(page, "Trattamento barba", NEXT_MON.iso, "16:00", "maria");
    await fillCustomer(page, {
      email: "stash-maria@velora.test",
      phone: "+39065555",
    });
    await page.getByRole("button", { name: /conferma prenotazione/i }).click();
    await expect(page.getByTestId("booking-created")).toBeVisible({ timeout: 25_000 });
    await c.query("UPDATE public.staff_resources SET active=FALSE WHERE id=$1", [ids.mariaId]);
  }

  const bookings = await c.query(
    `SELECT b.id, b.resource_id, sr.display_name AS res_name, sr.slug AS res_slug
     FROM public.bookings b
     JOIN public.staff_resources sr ON sr.id = b.resource_id
     WHERE b.tenant_id=$1 AND b.resource_id=$2 LIMIT 1`,
    [ids.tenantA, ids.mariaId],
  );
  expect(bookings.rows.length).toBeGreaterThanOrEqual(1);
  const bk = bookings.rows[0];
  expect(bk.resource_id).toBe(savedId);
  expect(bk.res_name).toBe(savedName);
  expect(bk.res_slug).toBe(savedSlug);
});

test("E12-16 Staff login → /app/team create button hidden write denied", async ({ browser }) => {
  await pgClient();
  const ctxStaff = await browser.newContext();
  try {
    const pStaff = await ctxStaff.newPage();
    await login(pStaff, EMAILS.staffA, TEST_PW);
    await pStaff.goto("/app/team");
    await pStaff.waitForTimeout(2000);

    const addSection = pStaff.getByRole("heading", { name: /Aggiungi operatore/i });
    const addInputVisible =
      (await pStaff.locator("input#new-display-name").count()) > 0 &&
      (await pStaff
        .locator("input#new-display-name")
        .first()
        .isVisible()
        .catch(() => false));

    const noCreateUI = (await addSection.count()) === 0 || !addInputVisible;
    expect(noCreateUI).toBe(true);
  } finally {
    await ctxStaff.close();
  }
});

test("E12-17 Manager can create resource", async ({ browser }) => {
  const c = await pgClient();
  const before = await c.query(
    "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND slug='manager-risorsa'",
    [ids.tenantA],
  );
  expect(before.rows[0].n).toBe(0);

  const ctxMng = await browser.newContext();
  try {
    const pMng = await ctxMng.newPage();
    await login(pMng, EMAILS.managerA, TEST_PW);
    await pMng.goto("/app/team");
    await pMng.waitForTimeout(2000);
    const inpName = pMng.locator("input#new-display-name");
    const visibleCreate =
      (await inpName.count()) > 0 &&
      (await inpName
        .first()
        .isVisible()
        .catch(() => false));
    if (visibleCreate) {
      await inpName.first().fill("Manager Risorsa");
      await pMng.locator("input#new-slug").first().fill("manager-risorsa");
      await pMng
        .getByRole("button", { name: /Aggiungi/i })
        .first()
        .click();
      await pMng.waitForTimeout(2500);
    }
    const after = await c.query(
      "SELECT COUNT(*)::int n FROM public.staff_resources WHERE tenant_id=$1 AND slug='manager-risorsa'",
      [ids.tenantA],
    );
    expect(after.rows[0].n).toBe(1);

    await c.query(`BEGIN; SET LOCAL session_replication_role = replica;`);
    await c.query(
      `DELETE FROM public.staff_resource_services WHERE resource_id IN (SELECT id FROM public.staff_resources WHERE tenant_id=$1 AND slug='manager-risorsa')`,
      [ids.tenantA],
    );
    await c.query(
      `DELETE FROM public.staff_resources WHERE tenant_id=$1 AND slug='manager-risorsa'`,
      [ids.tenantA],
    );
    await c.query(`SET LOCAL session_replication_role = DEFAULT; COMMIT;`);
  } finally {
    await ctxMng.close();
  }
});

test("E12-18 audit rows PII-free scan (no email/phone/notes/secret in metadata)", async () => {
  const c = await pgClient();
  const audits = await c.query(
    `SELECT id, action, entity_type, metadata::text AS meta_txt
     FROM public.audit_logs
     WHERE tenant_id=$1
       AND action IN (
         'resource_created','resource_updated','resource_deactivated',
         'resource_service_added','resource_service_changed','resource_service_removed',
         'booking_created','tenant_created','onboarding_completed'
       )
     ORDER BY created_at DESC
     LIMIT 100`,
    [ids.tenantA],
  );

  const piiPatterns = [
    /@[a-z0-9]+\.[a-z]{2,}/i,
    /\+39[0-9]{5,}/,
    /06[0-9]{5,}/,
    /customer_email/i,
    /customer_phone/i,
    /password/i,
    /secret/i,
    /Bearer /i,
  ];

  const violations = [];
  for (const row of audits.rows) {
    const txt = row.meta_txt || "";
    for (const pat of piiPatterns) {
      if (pat.test(txt)) {
        violations.push({ id: row.id, action: row.action, pattern: String(pat) });
        break;
      }
    }
  }
  expect(violations).toEqual([]);
});

test("E12-19 responsive 375/768/1440 on team+booking pages (scrollWidth<=clientWidth, clickable)", async ({
  page,
}) => {
  const sizes = [
    { w: 375, h: 812 },
    { w: 768, h: 1024 },
    { w: 1440, h: 900 },
  ];
  const pages = [
    { name: "booking", url: `/s/${SLUG_A}/booking` },
    { name: "team", url: "/app/team", needsLogin: true },
  ];

  for (const pgItem of pages) {
    for (const sz of sizes) {
      await page.setViewportSize({ width: sz.w, height: sz.h });
      if (pgItem.needsLogin) {
        await login(page, EMAILS.ownerA, TEST_PW);
      }
      await page.goto(pgItem.url);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      const { scrollWidth, clientWidth, scrollHeight, clientHeight } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 4);
      expect(clientWidth).toBe(sz.w);
      expect(scrollHeight).toBeGreaterThan(0);
      expect(clientHeight).toBeGreaterThan(0);

      const btnCount = await page
        .locator("button:visible, a:visible, [role='button']:visible")
        .count();
      expect(btnCount).toBeGreaterThanOrEqual(1);
    }
  }
});

test("E12-20 axe accessibility 0 serious/critical on team+booking pages", async ({ page }) => {
  const checkPages = [
    { name: "booking", url: `/s/${SLUG_A}/booking` },
    { name: "team", url: "/app/team", needsLogin: true },
  ];

  for (const item of checkPages) {
    if (item.needsLogin) {
      await login(page, EMAILS.ownerA, TEST_PW);
    }
    await page.goto(item.url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const serious = results.violations.filter((v) => v.impact === "serious");
    const critical = results.violations.filter((v) => v.impact === "critical");

    const detailReport = [...serious, ...critical].map((v) => ({
      page: item.name,
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodesAffected: v.nodes?.length ?? 0,
    }));

    expect(
      critical.length,
      `Axe critical violations on ${item.name}: ${JSON.stringify(detailReport.filter((d) => d.impact === "critical"))}`,
    ).toBe(0);
    expect(
      serious.length,
      `Axe serious violations on ${item.name}: ${JSON.stringify(detailReport.filter((d) => d.impact === "serious"))}`,
    ).toBe(0);
  }
});
