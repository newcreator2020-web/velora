#!/usr/bin/env node
/**
 * T23 — Lighthouse Mobile Check (bozza)
 *
 * Esegue Lighthouse in modalita' mobile su 4 URL predefiniti e salva
 * i report JSON in artifacts/lighthouse/.
 *
 * URL di default (eventualmente sovrascrivibili da CLI, posizione 1..4):
 *   1. http://localhost:3000/s/parrucchiere
 *   2. http://localhost:3000/s/estetista
 *   3. http://localhost:3000/s/barbiere
 *   4. http://localhost:3000/s/generico
 *
 * Dipendenze opzionali (NON installate automaticamente da questo script):
 *   pnpm add -D lighthouse chrome-launcher
 *   # oppure: npm i -D lighthouse chrome-launcher
 *
 * Se lighthouse non e' disponibile, lo script stampa un messaggio ed esce
 * con codice 0 (non rompe la CI; considerato "bozza T23").
 *
 * Utilizzo:
 *   node scripts/lighthouse-check.mjs
 *   # oppure con URL custom:
 *   node scripts/lighthouse-check.mjs \
 *       http://localhost:3000/s/parrucchiere \
 *       http://localhost:3000/s/estetista \
 *       http://localhost:3000/s/barbiere \
 *       http://localhost:3000/s/generico
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL as _pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const ARTIFACTS_DIR = resolve(PROJECT_ROOT, "artifacts", "lighthouse");

const DEFAULT_URLS = [
  "http://localhost:3000/s/parrucchiere",
  "http://localhost:3000/s/estetista",
  "http://localhost:3000/s/barbiere",
  "http://localhost:3000/s/generico",
];

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function slugFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || u.hostname.replace(/\./g, "-");
    return (
      last
        .replace(/[^a-z0-9-]/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "page"
    );
  } catch {
    return "page";
  }
}

function extractScores(lhr) {
  const out = {};
  for (const cat of CATEGORIES) {
    const entry = lhr?.categories?.[cat];
    const raw = typeof entry?.score === "number" ? entry.score : null;
    const pct = raw === null ? null : Math.round(raw * 100);
    out[cat] = {
      title: entry?.title ?? cat,
      score: raw,
      scorePct: pct,
    };
  }
  return out;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Tenta il dynamic import di lighthouse + chrome-launcher tramite createRequire
 * (try/catch per rientrare nel requisito "se NON installato, script comunque valido").
 */
async function loadLighthouseDeps() {
  const require = createRequire(import.meta.url);
  /** @type {any} */
  let lighthouse;
  /** @type {any} */
  let chromeLauncher;
  try {
    lighthouse = require("lighthouse");
    if (lighthouse && lighthouse.default) lighthouse = lighthouse.default;
  } catch (err) {
    return { ok: false, reason: "lighthouse", error: err };
  }
  try {
    chromeLauncher = require("chrome-launcher");
    if (chromeLauncher && chromeLauncher.default) chromeLauncher = chromeLauncher.default;
  } catch (err) {
    return { ok: false, reason: "chrome-launcher", error: err };
  }
  return { ok: true, lighthouse, chromeLauncher };
}

async function runOne(lighthouse, chromeFlags, url) {
  const opts = {
    logLevel: "info",
    output: "json",
    onlyCategories: CATEGORIES,
    port: undefined,
    chromeFlags,
    throttlingMethod: "simulate",
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 375,
      height: 667,
      deviceScaleFactor: 3,
      disabled: false,
    },
    emulatedUserAgent:
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  };
  const runnerResult = await lighthouse(url, opts, undefined);
  return runnerResult;
}

async function main() {
  const urls =
    process.argv.length >= 6
      ? [process.argv[2], process.argv[3], process.argv[4], process.argv[5]]
      : DEFAULT_URLS.slice(0, 4);

  console.warn(`[T23-lighthouse] Target URLs (${urls.length}):`);
  urls.forEach((u, i) => console.warn(`  ${i + 1}. ${u}`));

  await ensureDir(ARTIFACTS_DIR);

  const deps = await loadLighthouseDeps();
  if (!deps.ok) {
    console.warn(
      `[T23-lighthouse] ATTENZIONE: dipendenza "${deps.reason}" NON installata. ` +
        `Esegui: pnpm add -D lighthouse chrome-launcher`,
    );
    console.warn(
      `[T23-lighthouse] Script in modalita' BOZZA: genero soltanto un report placeholder in ${ARTIFACTS_DIR}`,
    );
    const stamp = nowStamp();
    const placeholder = {
      generatedAt: new Date().toISOString(),
      mode: "placeholder-missing-deps",
      missingDependency: deps.reason,
      installHint: "pnpm add -D lighthouse chrome-launcher",
      targets: urls.map((u) => ({ url: u, skipped: true })),
      note: "T23 bozza: struttura corretta, ma metriche reali richiedono lighthouse installato.",
    };
    const placeholderPath = resolve(ARTIFACTS_DIR, `lighthouse-summary-${stamp}.json`);
    await writeFile(placeholderPath, JSON.stringify(placeholder, null, 2), "utf-8");
    console.warn(`[T23-lighthouse] Placeholder scritto: ${placeholderPath}`);
    console.warn("[T23-lighthouse] Exit 0 (bozza OK)");
    process.exit(0);
  }

  const { lighthouse, chromeLauncher } = deps;
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const stamp = nowStamp();
    const summary = {
      generatedAt: new Date().toISOString(),
      mode: "mobile",
      categories: CATEGORIES,
      results: [],
    };

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const idx = String(i + 1).padStart(2, "0");
      const slug = slugFromUrl(url);
      const label = `${idx}-${slug}`;
      console.warn(`\n[T23-lighthouse] (${i + 1}/${urls.length}) Analizzo ${url} ...`);
      let runnerResult = null;
      let error = null;
      try {
        runnerResult = await runOne(lighthouse, [`--remote-debugging-port=${chrome.port}`], url);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`[T23-lighthouse]   ERRORE: ${error}`);
      }

      const lhr = runnerResult?.lhr ?? null;
      const scores = lhr ? extractScores(lhr) : null;
      const entry = {
        index: i + 1,
        url,
        slug,
        ok: !!lhr && !error,
        error,
        scores,
      };
      summary.results.push(entry);

      if (lhr) {
        const reportPath = resolve(ARTIFACTS_DIR, `lighthouse-${label}-${stamp}.json`);
        await writeFile(reportPath, JSON.stringify(lhr, null, 2), "utf-8");
        console.warn(`[T23-lighthouse]   Report JSON -> ${reportPath}`);
        if (scores) {
          for (const cat of CATEGORIES) {
            const pct = scores[cat]?.scorePct;
            console.warn(
              `[T23-lighthouse]     ${cat.padEnd(16, " ")} = ${pct === null ? "N/A" : `${pct}/100`}`,
            );
          }
        }
      }
    }

    const summaryPath = resolve(ARTIFACTS_DIR, `lighthouse-summary-${stamp}.json`);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    console.warn(`\n[T23-lighthouse] Summary -> ${summaryPath}`);

    const anyFailed = summary.results.some((r) => !r.ok);
    if (anyFailed) {
      console.warn("[T23-lighthouse] Una o piu' URL hanno riportato errori (exit 1).");
      process.exit(1);
    }
    console.warn("[T23-lighthouse] Completato con successo.");
  } finally {
    try {
      await chrome.kill();
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(
    "[T23-lighthouse] Fatal error:",
    err instanceof Error ? err.stack || err.message : String(err),
  );
  process.exit(2);
});
