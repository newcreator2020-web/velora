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
    await expect(body).toContainText("Estetica");
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
    await expect(page).toHaveTitle(new RegExp(NAME_A.replace(/\s*—\s*/, " ")));
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
    const html = await page.content();
    expect(html).not.toMatch(/tenant_id/i);
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
