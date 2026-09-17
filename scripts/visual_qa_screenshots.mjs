/* eslint-disable no-console */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "visual-qa");
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const SITES = [
  { id: "tonino", slug: "slugo-mtu30v76-1fon", name: "Estetista da Tonino" },
  { id: "luca", slug: "barbieri-luca", name: "Barbieri Luca" },
  { id: "giulia", slug: "giulia-hair", name: "Giulia Hair Studio" },
];

const VIEWPORTS = [
  { id: "mobile-sm", w: 360, h: 800 },
  { id: "mobile-lg", w: 390, h: 844 },
  { id: "tablet", w: 768, h: 1024 },
  { id: "desktop", w: 1440, h: 900 },
];

const SECTION_SCROLLS = [
  {
    key: "hero",
    selector:
      'section[data-section="hero"], #hero, [aria-labelledby*="hero"], .hero, section:nth-of-type(2)',
  },
  {
    key: "services",
    selector:
      'section[data-section="services"], #services, .services, section:has(h2:has-text("servizi"))',
  },
  { key: "gallery", selector: 'section[data-section="gallery"], #gallery, .gallery' },
  { key: "staff", selector: 'section[data-section="staff"], #staff, .staff' },
  { key: "contact", selector: 'section[data-section="contact"], #contact, .contact' },
  { key: "footer", selector: 'footer, section[data-section="footer"], .footer' },
  {
    key: "booking_section",
    selector: 'section[data-section="booking_widget"], #booking, [data-testid="booking-section"]',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrollIntoViewIfExists(page, sel) {
  try {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded({ timeout: 4000 });
      await sleep(500);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function clickIfExists(page, sel, opts = {}) {
  try {
    const el = await page.$(sel);
    if (el && (await el.isVisible({ timeout: 1500 }))) {
      await el.click(opts);
      await sleep(400);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function captureSite(browser, site, viewport) {
  const dir = path.join(OUT, site.id);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `${viewport.id}_${viewport.w}x${viewport.h}`;

  const ctx = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h },
    deviceScaleFactor: viewport.w < 500 ? 2 : 1,
    locale: "it-IT",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);

  // ---------- HOME ----------
  const homeUrl = `${BASE}/s/${site.slug}`;
  await page.goto(homeUrl, { waitUntil: "networkidle" });
  await sleep(3500);

  await page.screenshot({
    path: path.join(dir, `${prefix}_home_fullpage.png`),
    fullPage: true,
  });
  console.log(`✓ ${site.id}/${prefix} home full-page`);

  // Section-specific screenshots
  for (const s of SECTION_SCROLLS) {
    const ok = await scrollIntoViewIfExists(page, s.selector);
    if (ok) {
      try {
        await page.screenshot({
          path: path.join(dir, `${prefix}_section_${s.key}.png`),
          fullPage: false,
        });
      } catch {
        // ignore
      }
    }
  }

  // Mobile menu
  if (viewport.w <= 768) {
    const openSel =
      'button[aria-label*="menu" i], button[aria-label*="apri menu" i], [data-testid="mobile-menu-open"], .mobile-menu-toggle, button:has(svg), nav button';
    const ok = await clickIfExists(page, openSel, { force: true });
    if (ok) {
      await sleep(500);
      try {
        await page.screenshot({
          path: path.join(dir, `${prefix}_mobile_menu_open.png`),
        });
      } catch {
        // ignore
      }
      await page.keyboard.press("Escape");
    }
  } else {
    // Desktop hero close-up
    const heroOk = await scrollIntoViewIfExists(page, SECTION_SCROLLS[0].selector);
    if (heroOk) {
      try {
        await page.screenshot({
          path: path.join(dir, `${prefix}_hero_closeup.png`),
          clip: { x: 0, y: 0, width: viewport.w, height: Math.min(viewport.h, 900) },
        });
      } catch {
        // ignore
      }
    }
  }

  // ---------- BOOKING ----------
  const bookingUrl = `${BASE}/s/${site.slug}/booking`;
  await page.goto(bookingUrl, { waitUntil: "networkidle" });
  await sleep(3500);
  await page.screenshot({
    path: path.join(dir, `${prefix}_booking_fullpage.png`),
    fullPage: true,
  });
  console.log(`✓ ${site.id}/${prefix} booking full-page`);

  await ctx.close();
}

(async function main() {
  console.log("BASE_URL:", BASE);
  console.log("OUT:", OUT);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--ignore-certificate-errors",
    ],
  });

  let failed = 0;
  for (const site of SITES) {
    for (const viewport of VIEWPORTS) {
      try {
        await captureSite(browser, site, viewport);
      } catch (e) {
        console.error(`✗ FAILED ${site.id} ${viewport.id}:`, e.message);
        failed++;
      }
    }
  }

  await browser.close();
  console.log(`\n=== Visual QA screenshots DONE. failures=${failed} ===`);
  console.log("Dir:", OUT);
})();
