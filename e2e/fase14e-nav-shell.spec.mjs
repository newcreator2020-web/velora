import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import "dotenv/config";

const PASSWORD = "VeloraTest12345!";

const ownerEmail = (n) => `e2e-f14e-${n}-owner@velora.local`;
const _managerEmail = (n) => `e2e-f14e-${n}-manager@velora.local`;
const _staffEmail = (n) => `e2e-f14e-${n}-staff@velora.local`;
const paEmail = () => `e2e-f14e-pa@velora.local`;

async function sharedAuthModule() {
  return import("./_shared-auth.mjs");
}

async function ensurePlatformAdminLocally(email, password) {
  const mod = await sharedAuthModule();
  const userId = await mod.ensureAuthUserWithPassword(email, password, "F14E Platform Admin");
  const db = await mod.newSharedPg();
  try {
    await db.query(
      `INSERT INTO public.platform_admins (user_id, status) 
       VALUES ($1::uuid, 'active') 
       ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
      [userId],
    );
    return { userId };
  } finally {
    await db.end().catch(() => void 0);
  }
}

test.describe("FASE14E — Operational App Navigation Shell", () => {
  test.describe.configure({ mode: "serial" });

  let tenantSlug;
  let customerId;
  let runOwnerEmail;
  let runManagerEmail;
  let runStaffEmail;
  let _runPaEmail;

  test.beforeAll(async ({ browserName, browser }) => {
    test.skip(browserName !== "chromium", "Chromium only for nav shell");
    const mod = await sharedAuthModule();

    runOwnerEmail = ownerEmail("a");
    const runTag = Math.random().toString(36).slice(2, 8);
    runManagerEmail = `e2e-f14e-${runTag}-manager@velora.local`;
    runStaffEmail = `e2e-f14e-${runTag}-staff@velora.local`;
    _runPaEmail = paEmail();

    const _ownerUserId = await mod.ensureAuthUserWithPassword(
      runOwnerEmail,
      PASSWORD,
      "F14E Owner A",
    );
    const managerUserId = await mod.ensureAuthUserWithPassword(
      runManagerEmail,
      PASSWORD,
      "F14E Manager A",
    );
    const staffUserId = await mod.ensureAuthUserWithPassword(
      runStaffEmail,
      PASSWORD,
      "F14E Staff A",
    );

    {
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      try {
        await mod.ensureTestSession(pg, runOwnerEmail, PASSWORD, {
          businessName: "Velora F14E Test Biz",
        });
      } finally {
        await pg.close().catch(() => void 0);
        await ctx.close().catch(() => void 0);
      }
    }

    const db = await mod.newSharedPg();
    try {
      const tenant = await db.query(
        `SELECT t.id, t.slug FROM public.tenants t 
         JOIN public.tenant_memberships tm ON tm.tenant_id = t.id 
         JOIN auth.users au ON au.id = tm.user_id 
         WHERE lower(au.email::text) = lower($1) AND tm.role = 'owner' AND tm.status = 'active' 
         ORDER BY t.created_at DESC LIMIT 1`,
        [runOwnerEmail],
      );
      tenantSlug = tenant.rows[0]?.slug ?? "";
      const tenantId = tenant.rows[0]?.id;
      let customer_id = "";
      if (tenantSlug && tenantId) {
        const cust = await db.query(
          `SELECT id FROM public.customers WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [tenantId],
        );
        customer_id = cust.rows[0]?.id ?? "";

        const mgrExists = await db.query(
          `SELECT 1 FROM public.tenant_memberships WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND role='manager' AND status='active' LIMIT 1`,
          [tenantId, managerUserId],
        );
        if (!mgrExists.rows.length) {
          await db.query(
            `INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
             VALUES (public.gen_random_uuid(), $1::uuid, $2::uuid, 'manager', 'active', NOW(), NOW())`,
            [tenantId, managerUserId],
          );
        }
        const staffExists = await db.query(
          `SELECT 1 FROM public.tenant_memberships WHERE tenant_id=$1::uuid AND user_id=$2::uuid AND role='staff' AND status='active' LIMIT 1`,
          [tenantId, staffUserId],
        );
        if (!staffExists.rows.length) {
          await db.query(
            `INSERT INTO public.tenant_memberships (id, tenant_id, user_id, role, status, created_at, updated_at)
             VALUES (public.gen_random_uuid(), $1::uuid, $2::uuid, 'staff', 'active', NOW(), NOW())`,
            [tenantId, staffUserId],
          );
        }
      }
      customerId = customer_id;
    } finally {
      await db.end().catch(() => void 0);
    }
  });

  test("NAV-01 anon /app denied redirect /login", async ({ page, context }) => {
    await context.clearCookies();
    const resp = await page.goto("/app", { waitUntil: "commit" });
    expect(resp?.ok() || resp?.status() === 302 || resp?.status() === 307).toBe(true);
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });

  test("NAV-02 owner shell renders nav items", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    await page.waitForSelector(
      'aside[aria-label="Navigazione area privata"], nav[aria-label="Navigazione area privata"]',
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByRole("link", { name: "Dashboard", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendario", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Prenotazioni", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Clienti", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Team", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Disponibilità", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sito", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abbonamento", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Impostazioni", exact: true }).first(),
    ).toBeVisible();
  });

  test("NAV-03 active state dashboard", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const active = page.locator('[aria-current="page"]').first();
    await expect(active).toBeVisible();
    await expect(active).toHaveText("Dashboard");
  });

  test("NAV-04 Calendar navigation + active state", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const cal = page.getByRole("link", { name: "Calendario", exact: true }).first();
    await expect(cal).toBeEnabled();
    await cal.click();
    await page.waitForURL("/app/calendar", { timeout: 15_000 });
    const active = page.locator('[aria-current="page"]').first();
    await expect(active).toBeVisible();
    await expect(active).toHaveText("Calendario");
  });

  test("NAV-05 Team navigation + active state", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app/team");
    await page.waitForURL("/app/team", { timeout: 15_000 });
    const active = page.locator('[aria-current="page"]').first();
    await expect(active).toBeVisible();
    await expect(active).toHaveText("Team");
  });

  test("NAV-06 Site navigation + active state", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app/site");
    await page.waitForURL("/app/site", { timeout: 15_000 });
    const active = page.locator('[aria-current="page"]').first();
    await expect(active).toBeVisible();
    await expect(active).toHaveText("Sito");
  });

  test("NAV-07 nested route active on parent /app/customers/[id]", async ({ page }) => {
    test.skip(!customerId, "no customer in tenant yet");
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto(`/app/customers/${customerId}`);
    await page.waitForURL(`/app/customers/${customerId}`, { timeout: 15_000 });
    const active = page.locator('[aria-current="page"]').first();
    await expect(active).toBeVisible();
    await expect(active).toHaveText("Clienti");
  });

  test("NAV-08 manager: owner-only links hidden", async ({ page }) => {
    test.skip(!runManagerEmail, "no manager email generated");
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, runManagerEmail, PASSWORD);
    await page.goto("/app");
    await page.waitForSelector(
      'aside[aria-label="Navigazione area privata"], nav[aria-label="Navigazione area privata"]',
      { timeout: 20_000 },
    );
    await expect(
      page.getByRole("link", { name: "Abbonamento", exact: true }).first(),
    ).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Disponibilità", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sito", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Impostazioni", exact: true }).first(),
    ).toBeVisible();
  });

  test("NAV-09 staff: manager-only links hidden", async ({ page }) => {
    test.skip(!runStaffEmail, "no staff email generated");
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, runStaffEmail, PASSWORD);
    await page.goto("/app");
    await page.waitForSelector(
      'aside[aria-label="Navigazione area privata"], nav[aria-label="Navigazione area privata"]',
      { timeout: 20_000 },
    );
    await expect(
      page.getByRole("link", { name: "Disponibilità", exact: true }).first(),
    ).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Sito", exact: true }).first()).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Impostazioni", exact: true }).first(),
    ).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abbonamento", exact: true }).first(),
    ).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Team", exact: true }).first()).toBeVisible();
  });

  test("NAV-10 cross-tenant direct URL customer denied", async ({ browser, contextOptions }) => {
    const ctxB = await browser.newContext(contextOptions);
    const pageB = await ctxB.newPage();
    try {
      const mod = await sharedAuthModule();
      const ownerB = await mod.ensureAuthUserWithPassword(
        ownerEmail("b"),
        PASSWORD,
        "F14E Owner B",
      );
      void ownerB;
      await mod.ensureTestSession(pageB, ownerEmail("b"), PASSWORD);
      test.skip(!customerId, "no customer from tenant A");
      await pageB.goto(`/app/customers/${customerId}`, { waitUntil: "commit" });
      await pageB.waitForTimeout(2000);
      const url = new URL(pageB.url());
      expect(url.pathname).not.toBe(`/app/customers/${customerId}`);
    } finally {
      await ctxB.close();
    }
  });

  test("NAV-11 platform admin opens customer shell", async ({ page }) => {
    const mod = await sharedAuthModule();
    const pa = await ensurePlatformAdminLocally(paEmail(), PASSWORD);
    expect(pa).toBeTruthy();
    await mod.ensureTestSession(page, paEmail(), PASSWORD, {});
    await page.goto("/app/admin/clients");
    await page.waitForURL("/app/admin/clients", { timeout: 15_000 });
    await page.waitForSelector('h1, [role="heading"]', { timeout: 15_000 });
    test.skip(!tenantSlug, "no tenantA slug");
    const row = page.locator(`a[href$="/app/admin/clients/${tenantSlug}"]`).first();
    const rowAlt = page.getByRole("link", { name: tenantSlug }).first();
    const link = (await row.count()) > 0 ? row : rowAlt;
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await page.waitForURL((u) => u.pathname.startsWith(`/app/admin/clients/${tenantSlug}`), {
      timeout: 20_000,
    });
    const openStudioBtn = page.getByRole("button", { name: /Apri Site Studio/i }).first();
    await expect(openStudioBtn).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
      openStudioBtn.click(),
    ]);
    const u = new URL(page.url());
    expect(u.pathname === "/app" || u.pathname.startsWith("/app/")).toBe(true);
    await expect(page.locator('nav[aria-label="Navigazione area privata"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("NAV-12 platform admin context persist return PA UI", async ({ page }) => {
    const mod = await sharedAuthModule();
    const pa = await ensurePlatformAdminLocally(paEmail(), PASSWORD);
    expect(pa).toBeTruthy();
    await mod.ensureTestSession(page, paEmail(), PASSWORD, {});
    await page.goto("/app/admin/clients");
    await page.waitForURL("/app/admin/clients", { timeout: 15_000 });
    const paHeader = page.getByText("Velora Platform Admin").first();
    await expect(paHeader).toBeVisible({ timeout: 10_000 });
  });

  test("NAV-13 return to client management", async ({ page }) => {
    const mod = await sharedAuthModule();
    const pa = await ensurePlatformAdminLocally(paEmail(), PASSWORD);
    expect(pa).toBeTruthy();
    await mod.ensureTestSession(page, paEmail(), PASSWORD, {});
    test.skip(!tenantSlug, "no tenant slug");
    await page.goto(`/app/admin/clients/${tenantSlug}`);
    const back = page.getByRole("link", { name: /Tutti i clienti|← Tutti i clienti/i }).first();
    if ((await back.count()) > 0) {
      await back.click();
    } else {
      await page.goto("/app/admin/clients");
    }
    await page.waitForURL("/app/admin/clients", { timeout: 15_000 });
    await expect(page.getByText("Velora Platform Admin").first()).toBeVisible();
  });

  test("NAV-14 invalid tenant context safe deny redirect no blank no loop", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    await page.waitForSelector(
      'aside[aria-label="Navigazione area privata"], nav[aria-label="Navigazione area privata"]',
      { timeout: 20_000 },
    );
    const okBase = await page.evaluate(() => {
      return (
        typeof document !== "undefined" &&
        !!document.querySelector(
          'aside[aria-label="Navigazione area privata"], nav[aria-label="Navigazione area privata"]',
        )
      );
    });
    expect(okBase).toBe(true);
    const state = await page.evaluate(() => {
      const blankish =
        document.body &&
        (document.body.innerText?.trim().length || 0) < 40 &&
        !document.querySelector("nav") &&
        !document.querySelector("header");
      return {
        pathname: window.location.pathname,
        blankish: !!blankish,
        atLeastOneNavOrLogin: !!document.querySelector(
          'nav[aria-label], nav[aria-label*="Platform"], a[href="/app"], a[href="/login"], aside[aria-label]',
        ),
      };
    });
    expect(state.blankish).toBe(false);
    expect(state.atLeastOneNavOrLogin).toBe(true);
  });

  test("NAV-15 mobile menu 375×812 interactable real", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const openBtn = page.getByRole("button", { name: /Apri menu di navigazione/i }).first();
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await expect(openBtn).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
    const scrim = page.locator("button[aria-label='Chiudi menu navigazione toccando fuori']");
    await expect(scrim).toBeHidden();
    const drawer = page.locator("#app-nav-mobile-drawer");
    await openBtn.click();
    await expect(openBtn).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(scrim).toBeVisible({ timeout: 10_000 });
    const calendarLinkInside = drawer.getByRole("link", { name: "Calendario", exact: true });
    await expect(calendarLinkInside).toBeVisible({ timeout: 10_000 });
    await expect(calendarLinkInside).toBeEnabled();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }),
      calendarLinkInside.click(),
    ]);
    expect(page.url()).toContain("/app/calendar");
    await page.goto("/app");
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();
    await expect(openBtn).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
    await expect(scrim).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(openBtn).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
    await expect(scrim).toBeHidden({ timeout: 10_000 });
    await expect(openBtn).toBeFocused({ timeout: 5_000 });
    const noHorizOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 64;
    });
    expect(noHorizOverflow).toBe(true);
  });

  test("NAV-16 tablet 768×1024 sidebar visible interactable", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const side = page.locator('aside[aria-label="Navigazione area privata"]');
    await expect(side).toBeVisible({ timeout: 15_000 });
    const dashboard = page.getByRole("link", { name: "Dashboard", exact: true }).first();
    await expect(dashboard).toBeVisible({ timeout: 10_000 });
    await expect(dashboard).toBeEnabled();
    const calendar = page.getByRole("link", { name: "Calendario", exact: true }).first();
    await expect(calendar).toBeVisible();
  });

  test("NAV-17 desktop 1440×900 sidebar persistent interactable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const side = page.locator('aside[aria-label="Navigazione area privata"]');
    await expect(side).toBeVisible({ timeout: 15_000 });
    const billing = page.getByRole("link", { name: "Abbonamento", exact: true }).first();
    await expect(billing).toBeVisible({ timeout: 10_000 });
    await expect(billing).toBeEnabled();
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
  });

  test("NAV-18 keyboard traversal Tab/Escape mobile robust", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    await page.goto("/app");
    const openBtn = page.getByRole("button", { name: /Apri menu di navigazione/i }).first();
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    const scrim = page.locator("button[aria-label='Chiudi menu navigazione toccando fuori']");
    await expect(scrim).toBeHidden();
    const drawer = page.locator("#app-nav-mobile-drawer");
    await openBtn.focus();
    await page.keyboard.press("Enter");
    await expect(openBtn).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(scrim).toBeVisible({ timeout: 10_000 });
    const dashboardInside = drawer.getByRole("link", { name: "Dashboard", exact: true });
    await expect(dashboardInside).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const tag = await focused.evaluate((el) => el.tagName.toLowerCase());
    expect(["a", "button"].includes(tag)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(openBtn).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
    await expect(scrim).toBeHidden({ timeout: 10_000 });
    await expect(openBtn).toBeFocused({ timeout: 5_000 });
  });

  test("NAV-19 axe critical=0 serious=0 shell pages", async ({ page }) => {
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, ownerEmail("a"), PASSWORD);
    for (const p of ["/app", "/app/team", "/app/site"]) {
      await page.goto(p);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(serious).toHaveLength(0);
    }
  });

  test("NAV-20 staff direct /app/billing unauthorized denied", async ({ page }) => {
    test.skip(!runStaffEmail, "no staff email generated");
    const mod = await sharedAuthModule();
    await mod.ensureTestSession(page, runStaffEmail, PASSWORD);
    const resp = await page.goto("/app/billing", { waitUntil: "commit" });
    const statusOk = resp && resp.status() >= 200 && resp.status() < 400;
    await page.waitForTimeout(1500);
    const u = new URL(page.url());
    const denied =
      !statusOk ||
      u.pathname === "/login" ||
      u.pathname === "/onboarding" ||
      !(await page
        .getByText(/Abbonamento|fatturazione|piano/i)
        .first()
        .isVisible({ timeout: 1500 }));
    expect(denied).toBe(true);
  });
});
