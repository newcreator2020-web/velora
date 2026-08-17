import { test, expect } from "@playwright/test";

test.describe("Smoke", () => {
  test("home page renders with expected identity elements", async ({ page }) => {
    const response = await page.goto("/");
    expect(response, "pagina / deve rispondere").not.toBeNull();
    expect(response?.ok(), "pagina / deve tornare status 2xx").toBe(true);

    await expect(page.getByTestId("status-badge")).toBeVisible();
    await expect(page.getByTestId("app-title")).toBeVisible();
    await expect(page.getByTestId("app-title")).toContainText("VELORA");
    await expect(page.getByTestId("app-subtitle")).toBeVisible();
    await expect(page.getByTestId("system-info")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    await expect(page.locator("main#velora-main")).toBeAttached();
  });

  test("health endpoint returns a valid JSON payload", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      status: string;
      service: string;
      timestamp: string;
      version: string;
      checks: { uptime_ms: number };
    };

    expect(body.status).toBe("ok");
    expect(body.service).toBe("velora");
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(typeof body.version).toBe("string");
    expect(typeof body.checks.uptime_ms).toBe("number");
    expect(body.checks.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(body.checks.uptime_ms)).toBe(true);

    expect(res.headers()["cache-control"]).toMatch(/no-store/i);
  });

  test("not-found page is reachable for unknown routes", async ({ page }) => {
    const res = await page.goto("/questa-rotta-non-esiste-xyz");
    expect(res).not.toBeNull();
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("not-found-code")).toBeVisible();
    await expect(page.getByTestId("not-found-code")).toContainText("404");
  });
});
