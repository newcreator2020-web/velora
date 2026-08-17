import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PORT"] ?? 3000);
const baseURL = process.env["PLAYWRIGHT_TEST_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env["CI"]);
const useProduction = Boolean(process.env["PLAYWRIGHT_USE_PRODUCTION"]);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : "50%",
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: useProduction ? `pnpm.cmd start -p ${PORT}` : `pnpm.cmd dev -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
