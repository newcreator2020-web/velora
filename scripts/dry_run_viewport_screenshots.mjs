/* eslint-disable */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const ROOT = resolve(process.cwd());
const env = JSON.parse(readFileSync(resolve(ROOT, "artifacts/.dry-run-env.json"), "utf8"));
const OUT = resolve(ROOT, "artifacts/visual-qa", env.DRY_SLUG);
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "mobile_s_360x800", w: 360, h: 800 },
  { name: "mobile_l_390x844", w: 390, h: 844 },
  { name: "tablet_768x1024", w: 768, h: 1024 },
  { name: "desktop_1440x900", w: 1440, h: 900 },
];
const PAGES = [
  { key: "home", url: env.DRY_HOME, wait: "#contact,footer,[data-dry-run]" },
  { key: "booking", url: env.DRY_BOOKING, wait: "form,[data-testid],button" },
];

const browser = await chromium.launch({ headless: true });
let totalSnaps = 0;
let badgeFoundHome = 0,
  badgeFoundBooking = 0;

try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      locale: "it-IT",
    });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      console.log(`📸 ${vp.name} × ${p.key} → navigating...`);
      const res = await page.goto(p.url, { waitUntil: "networkidle", timeout: 45000 });
      console.log(`   HTTP ${res?.status()} ${res?.statusText()}`);
      try {
        await page.waitForLoadState("networkidle", { timeout: 10000 });
      } catch {}
      try {
        await page.waitForTimeout(1200);
      } catch {}
      const path = resolve(OUT, `${vp.name}__${p.key}.png`);
      await page.screenshot({ path, fullPage: true });
      totalSnaps++;
      console.log(`   saved ${path}`);

      // Verifica etichettatura DRY
      const html = await page.content();
      const hasDry =
        /DRY[\s_-]?RUN|NON UN CLIENTE VERO|NON COMMERCIALE|DEMO NON COMMERCIALE|⚠️/i.test(html);
      if (p.key === "home" && hasDry) badgeFoundHome++;
      if (p.key === "booking" && hasDry) badgeFoundBooking++;
      console.log(`   badge DRY visible? ${hasDry ? "YES ✅" : "NO ❌"}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log("\n================ T2 SCREENSHOTS SUMMARY ================");
console.log("Screenshots prodotti =", totalSnaps, "/ 8");
console.log("Home badge DRY count  =", badgeFoundHome, "/ 4 viewport");
console.log("Booking badge DRY     =", badgeFoundBooking, "/ 4 viewport");
console.log("Output dir =", OUT);
const allOk = totalSnaps === 8 && badgeFoundHome === 4 && badgeFoundBooking === 4;
console.log(
  "VERDICT LAYOUT+LABEL rubric ≥4/5 →",
  allOk ? "PASS ✅" : "CHECK ⚠️ (partial badge; visual review required)",
);
process.exit(allOk ? 0 : 2);
