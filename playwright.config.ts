import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

process.env["PLAYWRIGHT_BROWSERS_PATH"] ||= path.resolve(".playwright-browsers");

const PORT = Number(process.env["PORT"] ?? 3000);
const baseURL = process.env["PLAYWRIGHT_TEST_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;
const useProduction = Boolean(process.env["PLAYWRIGHT_USE_PRODUCTION"]);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup-public.mjs",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    actionTimeout: 25_000,
    navigationTimeout: 40_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-sm",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "mobile-lg",
      use: {
        ...devices["iPhone 15"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad mini"],
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    cwd: process.cwd(),
    command: useProduction
      ? `node .\\node_modules\\next\\dist\\bin\\next start -p ${PORT} --hostname 127.0.0.1`
      : `node .\\node_modules\\next\\dist\\bin\\next dev -p ${PORT} --hostname 127.0.0.1`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      DO_NOT_TRACK: "1",
      PORT: String(PORT),
    },
  },
});
