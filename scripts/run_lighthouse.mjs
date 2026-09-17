/* eslint-disable no-console */
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "lighthouse");
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const AUDITS = [
  { site: "tonino", slug: "slugo-mtu30v76-1fon", page: "home", label: "Tonino Home" },
  { site: "luca", slug: "barbieri-luca", page: "home", label: "Luca Home" },
  { site: "giulia", slug: "giulia-hair", page: "home", label: "Giulia Home" },
  { site: "tonino", slug: "slugo-mtu30v76-1fon", page: "booking", label: "Tonino Booking" },
  { site: "luca", slug: "barbieri-luca", page: "booking", label: "Luca Booking" },
  { site: "giulia", slug: "giulia-hair", page: "booking", label: "Giulia Booking" },
];

function extractScores(lhr) {
  const cats = lhr.categories ?? {};
  const perf = cats.performance?.score ?? null;
  const a11y = cats.accessibility?.score ?? null;
  const bp = cats["best-practices"]?.score ?? null;
  const seo = cats.seo?.score ?? null;

  const auditVals = lhr.audits ?? {};
  const lcp = auditVals["largest-contentful-paint"]?.numericValue ?? null;
  const cls = auditVals["cumulative-layout-shift"]?.numericValue ?? null;
  const inp = auditVals["interaction-to-next-paint"]?.numericValue ?? null;
  const tbt = auditVals["total-blocking-time"]?.numericValue ?? null;

  return {
    performance: perf != null ? Math.round(perf * 100) : null,
    accessibility: a11y != null ? Math.round(a11y * 100) : null,
    bestPractices: bp != null ? Math.round(bp * 100) : null,
    seo: seo != null ? Math.round(seo * 100) : null,
    lcpMs: lcp != null ? Math.round(lcp) : null,
    cls: cls != null ? Number(cls.toFixed(3)) : null,
    inpMs: inp != null ? Math.round(inp) : null,
    tbtMs: tbt != null ? Math.round(tbt) : null,
  };
}

(async function main() {
  let chrome;
  try {
    console.log("Launching Chrome…");
    chrome = await launch({
      chromeFlags: [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
      ],
      output: "json",
    });
    console.log(`Chrome port=${chrome.port} pid=${chrome.pid}`);

    const runnerResult = [];

    for (const a of AUDITS) {
      const url = a.page === "home" ? `${BASE}/s/${a.slug}` : `${BASE}/s/${a.slug}/booking`;
      console.log(`\n⚡ ${a.label} → ${url}`);
      try {
        const opts = {
          port: chrome.port,
          output: "json",
          onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
          throttlingMethod: "provided",
          skipAboutBlank: true,
        };
        const config = null;
        const runner = await lighthouse(url, opts, config);
        const lhr = runner?.lhr;
        if (!lhr) throw new Error("No lhr from runner");
        const score = extractScores(lhr);
        runnerResult.push({ ...a, url, ...score, ok: true });

        const jsonPath = path.join(OUT, `${a.site}_${a.page}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(lhr, null, 2));
        console.log(
          `  scores: perf=${score.performance} a11y=${score.accessibility} bp=${score.bestPractices} seo=${score.seo}  |  LCP=${score.lcpMs}ms CLS=${score.cls} TBT=${score.tbtMs}ms INP=${score.inpMs}ms`,
        );
      } catch (e) {
        runnerResult.push({ ...a, url, ok: false, error: e.message });
        console.log(`  ✗ Lighthouse failed: ${e.message}`);
      }
    }

    const summaryPath = path.join(OUT, "summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(runnerResult, null, 2));
    console.log("\n=== LIGHTHOUSE SUMMARY ===");
    const rows = runnerResult.map((r) => ({
      label: r.label,
      ok: r.ok ? "OK" : "FAIL",
      perf: r.performance,
      a11y: r.accessibility,
      bp: r.bestPractices,
      seo: r.seo,
      LCPms: r.lcpMs,
      CLS: r.cls,
      TBTms: r.tbtMs,
      INPms: r.inpMs,
    }));
    console.table(rows);
    console.log("Summary JSON:", summaryPath);
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch {
        /* ignore */
      }
    }
  }
})().catch((e) => {
  console.error("Lighthouse runner failed:", e);
  process.exit(1);
});
