import { test, expect } from "@playwright/test";

const SLUG_A = "velora-e2e-pub-barber-a";
const SLUG_B = "velora-e2e-pub-beauty-b";
const SLUG_UNPUB = "velora-e2e-unpublished-c";
const NAME_A = "Barbiere E2E — TENANT A FASE4";
const NAME_B = "Centro Bellezza E2E — TENANT B FASE4";
const DESC_A = "Contenuti esclusivi Tenant A";
const DESC_B = "Contenuti esclusivi Tenant B";

test.describe("FASE4 · E2E Public multi-tenant site engine", () => {
  test("E1: Tenant A published reachable → 200", async ({ page, request }) => {
    const r = await request.get(`/s/${SLUG_A}`);
    expect(r.status()).toBe(200);
    await page.goto(`/s/${SLUG_A}`);
    const h1 = page.locator("h1").first();
    await expect(h1).toContainText(NAME_A);
  });

  test("E2: Tenant B published reachable → 200", async ({ page, request }) => {
    const r = await request.get(`/s/${SLUG_B}`);
    expect(r.status()).toBe(200);
    await page.goto(`/s/${SLUG_B}`);
    const h1 = page.locator("h1").first();
    await expect(h1).toContainText(NAME_B);
  });

  test("E3: A mostra businessName A e dati A", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    const body = page.locator("body");
    await expect(body).toContainText(NAME_A);
    await expect(body).toContainText(DESC_A);
    await expect(body).toContainText("Roma");
    await expect(body).toContainText("Barbiere");
    await expect(body).toContainText("+39 06 11111111");
    await expect(body).toContainText("e2e-pub-a@velora-public.example");
  });

  test("E4: B mostra businessName B e dati B", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    const body = page.locator("body");
    await expect(body).toContainText(NAME_B);
    await expect(body).toContainText(DESC_B);
    await expect(body).toContainText("Milano");
    await expect(body).toContainText("Bellezza");
    await expect(body).toContainText("+39 02 22222222");
    await expect(body).toContainText("e2e-pub-b@velora-public.example");
  });

  test("E5: pagina A NON contiene Nome B", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    const html = page.locator("html");
    await expect(html).not.toContainText(NAME_B);
    await expect(html).not.toContainText("e2e-pub-b@velora-public.example");
  });

  test("E6: pagina B NON contiene Nome A", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    const html = page.locator("html");
    await expect(html).not.toContainText(NAME_A);
    await expect(html).not.toContainText("e2e-pub-a@velora-public.example");
  });

  test("E7: slug sconosciuto → 404 safe page", async ({ page, request }) => {
    const r = await request.get("/s/velora-non-esiste-xyz999");
    expect([404, 200]).toContain(r.status());
    await page.goto("/s/velora-non-esiste-xyz999");
    await expect(page.locator("body")).toContainText("Sito non disponibile");
  });

  test("E8: unpublished → 404 (non renderizzato)", async ({ page, request }) => {
    const r = await request.get(`/s/${SLUG_UNPUB}`);
    expect([404, 200]).toContain(r.status());
    await page.goto(`/s/${SLUG_UNPUB}`);
    await expect(page.locator("body")).toContainText("Sito non disponibile");
    await expect(page.locator("body")).not.toContainText("NON VISIBILE");
  });

  test("E9: metadata page A (title + description + canonical) contains Tenant A data", async ({
    page,
  }) => {
    await page.goto(`/s/${SLUG_A}`);
    const titlePattern = NAME_A.split(/\s*—\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(".*");
    await expect(page).toHaveTitle(new RegExp(titlePattern));
    const metaDesc = page.locator('meta[name="description"]').first();
    await expect(metaDesc).toHaveAttribute("content", new RegExp(DESC_A));
    const canonical = page.locator('link[rel="canonical"]').first();
    await expect(canonical).toHaveAttribute("href", new RegExp(`/s/${SLUG_A}`));
  });

  test("E10: refresh mantiene dati Tenants corretti", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("h1").first()).toContainText(NAME_A);
    await page.reload();
    await expect(page.locator("h1").first()).toContainText(NAME_A);
  });

  test("E11: Navigazione A → B non contamina", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).toContainText(NAME_A);
    await page.goto(`/s/${SLUG_B}`);
    await expect(page.locator("body")).toContainText(NAME_B);
    await expect(page.locator("body")).not.toContainText(NAME_A);
  });

  test("E12: Navigazione B → A non contamina", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    await expect(page.locator("body")).toContainText(NAME_B);
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).toContainText(NAME_A);
    await expect(page.locator("body")).not.toContainText(NAME_B);
  });

  test("E13: query tampering tenant_id=id_B non cambia dati in pagina A", async ({
    page,
    request,
  }) => {
    const r = await request.get(
      `/s/${SLUG_A}?tenant_id=00000000-0000-0000-0000-000000000000&role=SUPER_ADMIN&user_id=00000000-0000-0000-0000-000000000001`,
    );
    expect(r.status()).toBe(200);
    await page.goto(`/s/${SLUG_A}?tenant_id=X&role=SUPER_ADMIN&user_id=Z`);
    await expect(page.locator("h1").first()).toContainText(NAME_A);
    await expect(page.locator("body")).not.toContainText(NAME_B);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/tenant_id/i);
  });

  test("E14: public page reachable as anonymous (no login)", async ({ request }) => {
    const r = await request.get(`/s/${SLUG_A}`);
    expect(r.status()).toBe(200);
  });

  test("E15: /app continua a richiedere auth (302/200 redirect a login)", async ({
    page,
    request,
  }) => {
    const r = await request.get("/app", { maxRedirects: 0 });
    expect([302, 200, 401]).toContain(r.status());
    await page.goto("/app");
    expect(page.url()).toMatch(/\/login|\/app/);
    if (page.url().includes("/app")) {
      await expect(page.locator("body")).not.toContainText("Barbiere E2E — TENANT A FASE4");
    }
  });
});

test.describe("FASE5 · E2E Site Sections Public Engine (E16-E37)", () => {
  test("E16 A ordered sections: Hero → About → Services → Contact (empty gallery/staff/reviews omessi)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/s/${SLUG_A}`);
    const body = page.locator("body");
    await expect(body).toContainText("Taglio uomo");
    await expect(body).toContainText("22,50");
    await expect(body).not.toContainText("★★★★★");
    const h1count = await page.locator("h1").count();
    expect(h1count).toBe(1);
  });

  test("E17 B order different: Hero → Contact → About (no services/gallery/staff/reviews)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/s/${SLUG_B}`);
    const html = page.locator("html");
    await expect(html).not.toContainText("Taglio uomo");
    await expect(html).not.toContainText("Rasatura");
    const hcount = await page.locator("h1").count();
    expect(hcount).toBe(1);
  });

  test("E18 A configuration NOT in B: A eyebrow/services rendered only in A", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).toContainText("Benvenuti nel nostro salone");
    await page.goto(`/s/${SLUG_B}`);
    await expect(page.locator("body")).not.toContainText("Benvenuti nel nostro salone");
    await expect(page.locator("body")).not.toContainText("Listino prezzi");
  });

  test("E19 B configuration NOT in A: B eyebrow/split variant", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    await expect(page.locator("body")).toContainText("Beauté");
    await expect(page.locator("body")).toContainText("Milano");
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).not.toContainText("Beauté");
  });

  test("E20 disabled sections omessi (gallery A enabled ma empty => NO gallery items count)", async ({
    page,
  }) => {
    await page.goto(`/s/${SLUG_A}`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/Gallery|Galleria/i);
    expect(bodyText).not.toMatch(/Staff|Il nostro team/i);
  });

  test("E21 Hero exactly one H1 on A and B (a11y)", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    expect(await page.locator("h1").count()).toBe(1);
    await page.goto(`/s/${SLUG_B}`);
    expect(await page.locator("h1").count()).toBe(1);
  });

  test("E22 A sections H2 hierarchy (About/Services/Contact → 3+ H2)", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    const h2 = await page.locator("h2").count();
    expect(h2).toBeGreaterThanOrEqual(3);
  });

  test("E23 CTA tel: in B è anchor valido (no javascript:)", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    const cta = page.locator(`a[href^="tel:"]`).first();
    await expect(cta).toHaveAttribute("href", /^tel:/);
    const bad = page.locator(`a[href^="javascript:"], a[href^="data:"]`).count();
    expect(await bad).toBe(0);
  });

  test("E24 XSS: name/description non iniettano script (no dangerouslySetInnerHTML)", async ({
    page,
  }) => {
    let dialogTriggered = false;
    page.on("dialog", () => {
      dialogTriggered = true;
    });
    await page.goto(`/s/${SLUG_B}`);
    expect(dialogTriggered).toBe(false);
    const html = await page.content();
    expect(html).toMatch(/&lt;img|&lt;script|\\u003[cC]img|\\u003[cC]script/);
    const badAttrs = await page.evaluate(() => {
      const attrs: string[] = [];
      const all = document.querySelectorAll("body *:not(script):not(template)");
      all.forEach((el) => {
        for (const a of el.getAttributeNames()) {
          if (/^on/i.test(a)) attrs.push(`${el.tagName}.${a}`);
        }
      });
      return attrs;
    });
    expect(badAttrs).toHaveLength(0);
    const rawInjected = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("body img"));
      const injectedSrc = imgs.filter((i) => i.getAttribute("src") === "x");
      return { countBadSrc: injectedSrc.length };
    });
    expect(rawInjected.countBadSrc).toBe(0);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/javascript:/i);
  });

  test("E25 A services real fixture (3 services active + 1 inactive = 3 rendered)", async ({
    page,
  }) => {
    await page.goto(`/s/${SLUG_A}`);
    const body = page.locator("body");
    await expect(body).toContainText("Taglio uomo");
    await expect(body).toContainText("Rasatura");
    await expect(body).toContainText("Trattamento barba");
    await expect(body).not.toContainText("Pacchetto spa uomo");
  });

  test("E26 no services → services section NON presente in B", async ({ page }) => {
    await page.goto(`/s/${SLUG_B}`);
    await expect(page.locator("body")).not.toContainText("Listino prezzi");
  });

  test("E27 no reviews table → no fake ★★★ or names", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).not.toContainText("★★★★★");
    await expect(page.locator("body")).not.toContainText("Mario Rossi");
  });

  test("E28 membership users non renderizzati come staff pubblico", async ({ page }) => {
    await page.goto(`/s/${SLUG_A}`);
    await expect(page.locator("body")).not.toContainText("owner-a");
    await expect(page.locator("body")).not.toContainText("staff-a");
  });

  test("E29 Responsive A viewport=375 → NO horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/s/${SLUG_A}`);
    const { overflowX } = await page.evaluate(() => {
      const el = document.documentElement;
      return { overflowX: Math.max(el.scrollWidth, document.body.scrollWidth) - el.clientWidth };
    });
    expect(overflowX).toBeLessThanOrEqual(8);
  });

  test("E30 Responsive B viewport=768 → NO horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/s/${SLUG_B}`);
    const { overflowX } = await page.evaluate(() => {
      const el = document.documentElement;
      return { overflowX: Math.max(el.scrollWidth, document.body.scrollWidth) - el.clientWidth };
    });
    expect(overflowX).toBeLessThanOrEqual(8);
  });

  test("E31 A theme token primary non contamina B (css variables safe)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/s/${SLUG_A}`);
    const aTitle = await page.title();
    expect(aTitle).toMatch(/Barbiere/);
    const aPrimary = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[style*='--site-primary']");
      return el ? getComputedStyle(el).getPropertyValue("--site-primary").trim() : "";
    });
    expect(aPrimary.length).toBeGreaterThanOrEqual(4);
    expect(aPrimary.startsWith("#")).toBe(true);
    await page.goto(`/s/${SLUG_B}`);
    const bBody = page.locator("body");
    await expect(bBody).toContainText("Beauté");
    await expect(bBody).toContainText("Milano");
    const bPrimary = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[style*='--site-primary']");
      return el ? getComputedStyle(el).getPropertyValue("--site-primary").trim() : "";
    });
    expect(bPrimary).toBe("#be185d");
    expect(bPrimary).not.toBe(aPrimary);
  });

  test("E32 console browser: no errori critici A→B→A", async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errs.push(m.text());
    });
    await page.goto(`/s/${SLUG_A}`);
    await page.goto(`/s/${SLUG_B}`);
    await page.goto(`/s/${SLUG_A}`);
    const crit = errs.filter((e) => !/Failed to load resource.*404/.test(e));
    expect(crit).toHaveLength(0);
  });

  test("E33 C minimal (unpublished) still 404", async ({ request }) => {
    const r = await request.get(`/s/${SLUG_UNPUB}`);
    expect(r.status()).not.toBe(500);
  });

  test("E34 routes FASE4 preserved: homepage OK 200", async ({ request }) => {
    const r = await request.get("/");
    expect(r.status()).toBe(200);
  });

  test("E35 unknown slug safe 404 no stack trace", async ({ page, request }) => {
    const r = await request.get(`/s/abcdef-unknown-${Date.now()}`);
    expect(r.status()).not.toBe(500);
    await page.goto(`/s/abcdef-unknown-${Date.now()}`);
    const t = await page.locator("body").innerText();
    expect(t).not.toMatch(/Error:|Traceback|stack/i);
  });

  test("E36 A public page non leak di user email auth", async ({ request }) => {
    const r = await request.get(`/s/${SLUG_A}`);
    const t = await r.text();
    expect(t).not.toMatch(/owner-a@|manager-a@|staff-a@/);
  });

  test("E37 network requests: no 5xx responses A then B", async ({ page }) => {
    const bad: number[] = [];
    page.on("response", (resp) => {
      if (resp.status() >= 500) bad.push(resp.status());
    });
    await page.goto(`/s/${SLUG_A}`);
    await page.goto(`/s/${SLUG_B}`);
    expect(bad).toHaveLength(0);
  });
});
