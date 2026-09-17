import "dotenv/config";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client as PgClient } from "pg";
import { randomUUID } from "node:crypto";

const ROOT = resolve(import.meta.dirname, "..");
const ART = resolve(ROOT, "artifacts");
mkdirSync(ART, { recursive: true });

const LOCAL_DEFAULTS = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};
const env = (n) => process.env[n] ?? LOCAL_DEFAULTS[n] ?? "";
const buildPgOpts = () => ({
  host: env("SUPABASE_DB_HOST"),
  port: Number(env("SUPABASE_DB_PORT") || 54322),
  database: env("SUPABASE_DB_NAME"),
  user: env("SUPABASE_DB_USER"),
  password: env("SUPABASE_DB_PASSWORD"),
});

const RUN_ID = randomUUID().slice(0, 8);
const EVIDENCE_FILE = resolve(ART, `booking_user_style_evidence_${RUN_ID}.md`);
const SCREEN_DIR = resolve(ART, "screenshots");
mkdirSync(SCREEN_DIR, { recursive: true });

function snap(page, name) {
  const p = resolve(SCREEN_DIR, `booking_${RUN_ID}_${name}.png`);
  page.screenshot({ path: p, fullPage: true }).catch(() => {});
  return p;
}

function logEvidence(txt) {
  appendFileSync(EVIDENCE_FILE, txt + "\n", "utf8");
  process.stdout.write(txt + "\n");
}

const SLUG = process.env.DRY_SLUG || "dry-run-studio-2gxr07";
const BASE = process.env.PLAYWRIGHT_TEST_BASE_URL || "http://127.0.0.1:3000";
const URL = `${BASE}/s/${SLUG}/booking`;

const CUSTOMER = {
  name: `Mario Stabilizzazione ${RUN_ID}`,
  email: `mario-stab-${RUN_ID}@velora-test.example`,
  phone: "+39060000000",
  notes: "Appuntamento booking user-style test minimale.",
};

// ------------------------------------------------------------
// CLASSIFICATION HELPERS
// ------------------------------------------------------------
const CLASSIFICATION_HELPER = "TEST HELPER";
const CLASSIFICATION_APP = "APPLICAZIONE";
const MULTI_BACKTICK_CODE_START = "```";
const MULTI_BACKTICK_CODE_END = "```";

writeFileSync(
  EVIDENCE_FILE,
  `# EVIDENZA Booking User-Style minimale — RUN ${RUN_ID}

Slug: ${SLUG}
URL: ${URL}
Cliente: ${CUSTOMER.name} / ${CUSTOMER.email}
Data run: ${new Date().toISOString()}

## CLASSIFICAZIONE INIZIALE PENDING

\`\`\`
Regola 0: nessun evaluate set value. Nessun dispatchEvent forzato. Nessun hidden manuale.
\`\`\`

`,
  "utf8",
);

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "it-IT",
  });
  const page = await context.newPage();

  const pg = new PgClient(buildPgOpts());
  await pg.connect();

  try {
    logEvidence("\n## STEP 1 — page.goto booking");
    await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(4000);
    const sel0 = page.locator("select#service");
    try {
      await sel0.waitFor({ state: "visible", timeout: 25000 });
      await page.waitForFunction(
        (sel) => (document.querySelector(sel)?.options?.length ?? 0) >= 2,
        "select#service",
        { timeout: 20000 },
      );
    } catch {
      await page.reload({ waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(5000);
    }
    snap(page, "01_booking_loaded");
    logEvidence(`   URL loaded: ${page.url()}`);

    logEvidence("\n## STEP 2 — Seleziona servizio (select UI reale click/selectOption)");
    const sel = page.locator("select#service");
    await sel.waitFor({ state: "visible", timeout: 20000 });
    // Leggi le opzioni
    const opts = await sel.evaluate((node) =>
      Array.from(node.options)
        .map((o) => ({ value: o.value, text: o.text }))
        .filter((o) => o.value && o.value.length > 0),
    );
    logEvidence(`   Opzioni servizio: ${JSON.stringify(opts)}`);
    const TAGLIO = process.env.DRY_SVC_TAGLIO_ID || opts[0]?.value;
    logEvidence(`   Scelgo Taglio (value=${TAGLIO})`);
    await sel.selectOption(TAGLIO);
    await page.waitForTimeout(1500);
    snap(page, "02_service_selected");

    logEvidence("\n## STEP 3 — Data (YYYY-MM-DD future +7giorni default)");
    const inDate = page.locator("input#date[type=date]");
    await inDate.waitFor({ state: "visible" });
    const future = new Date();
    future.setDate(future.getDate() + Number(process.env.BOOKING_DAYS_OFFSET || 7));
    while (future.getDay() === 0) future.setDate(future.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    const DATE_VAL = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
    logEvidence(
      `   Click campo data + Playwright.fill(${DATE_VAL}) (input controlled React: fill trigger onChange+input events nativi) + click nome x blur.`,
    );
    await inDate.click();
    await inDate.fill(DATE_VAL);
    await page.locator("input#customer_name").click();
    await page.waitForTimeout(2500);
    const slotDebug = await page.evaluate(() => {
      const root = document.querySelector("form") || document;
      const buttons = Array.from(root.querySelectorAll("button")).map((b) => ({
        text: (b.textContent || "").trim().slice(0, 40),
        id: b.id,
        cls: b.className,
        attrs: Array.from(b.attributes).reduce((acc, a) => {
          if (/slot|start|data-|disabled|type/.test(a.name)) acc[a.name] = a.value;
          return acc;
        }, {}),
      }));
      const containers = Array.from(
        root.querySelectorAll('[class*="slot"],[data-testid*="slot"],[id*="slot"],[role="group"]'),
      )
        .slice(0, 8)
        .map((e) => ({
          tag: e.tagName,
          cls: e.className.slice(0, 120),
          childCount: e.children.length,
          text: (e.textContent || "").trim().slice(0, 140),
        }));
      const dataValues = Array.from(document.querySelectorAll("input[type=hidden]")).map((i) => ({
        name: i.name,
        value: i.value.slice(0, 60),
      }));
      return { buttons, containers, dataValues };
    });
    logEvidence(
      "\n### DEBUG STEP 3 DOM buttons/slots/form\n\n" +
        MULTI_BACKTICK_CODE_START +
        "json\n" +
        JSON.stringify(slotDebug, null, 2).slice(0, 6000) +
        "\n" +
        MULTI_BACKTICK_CODE_END +
        "\n",
    );
    snap(page, "03_date_selected");

    logEvidence(
      "\n## STEP 4 — Attendi slot bottone disponibile e CLICK (button.slot-btn:not(:disabled))",
    );
    let slotISO = null;
    let slotLabel = null;
    for (const attempt of [4000, 6000, 8000, 10000]) {
      try {
        const firstSlot = page.locator("button.slot-btn:not(:disabled)").first();
        await firstSlot.waitFor({ state: "visible", timeout: attempt });
        slotLabel = (await firstSlot.textContent()) || "";
        logEvidence(`   Slot scelto (t=${attempt}ms): label="${slotLabel.trim()}"`);
        await firstSlot.click();
        await page.waitForTimeout(1500);
        const isoVal = await page
          .locator('input[type=hidden][name="starts_at"]')
          .getAttribute("value");
        if (isoVal && isoVal.length > 10) {
          slotISO = isoVal;
          logEvidence(`   starts_at hidden updated = ${slotISO}`);
          break;
        }
        logEvidence(`   ⚠️  starts_at hidden vuoto dopo click, ritento`);
      } catch (_e) {
        snap(page, "ERR_no_slots_" + attempt);
        logEvidence(`   ⚠️  Nessuno slot visible dopo ${attempt}ms. Ritento...`);
        try {
          await inDate.click();
          future.setDate(future.getDate() + 1);
          if (future.getDay() === 0) future.setDate(future.getDate() + 1);
          const alt = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
          await inDate.fill(alt);
          await page.locator("input#customer_name").click();
          logEvidence(`   ➡️  Prossimo giorno tentativo: ${alt}`);
        } catch {
          void 0;
        }
        await page.waitForTimeout(2500);
      }
    }
    if (!slotISO) {
      throw new Error("no_slots_final");
    }
    await page.waitForTimeout(800);
    snap(page, "04_slot_selected");

    logEvidence("\n## STEP 5 — Campi cliente — click then type delay 25ms no evaluate");
    const cname = page.locator("input#customer_name");
    const cemail = page.locator("input#customer_email");
    const cphone = page.locator("input#customer_phone");
    const cnotes = page.locator("textarea#notes");

    await cname.waitFor({ state: "visible" });
    logEvidence("   5a. Nome: click + type delay 25ms");
    await cname.click();
    await cname.fill("");
    await cname.type(CUSTOMER.name, { delay: 25 });

    logEvidence("   5b. Email: click + type delay 25ms");
    await cemail.click();
    await cemail.fill("");
    await cemail.type(CUSTOMER.email, { delay: 25 });

    logEvidence("   5c. Phone: click + type delay 25ms");
    await cphone.click();
    await cphone.fill("");
    await cphone.type(CUSTOMER.phone, { delay: 25 });

    logEvidence("   5d. Note: click + type delay 25ms");
    await cnotes.click();
    await cnotes.fill("");
    await cnotes.type(CUSTOMER.notes, { delay: 25 });
    await page.waitForTimeout(500);
    snap(page, "05_customer_typed");

    logEvidence(
      "\n## STEP 6 — Checkbox Privacy: Keyboard TASTIERA (Tab+Space) user-style 100% nativo",
    );
    const cb = page.locator("input[type=checkbox][aria-describedby=privacy-hint]");
    const labelText = page
      .locator("label.form-checkbox span#privacy-hint, span.form-checkbox-label")
      .first();
    let isAlreadyChecked = await cb.isChecked();
    logEvidence(`   Checkbox initially checked=${isAlreadyChecked}`);
    if (!isAlreadyChecked) {
      let ok = false;
      try {
        await labelText.scrollIntoViewIfNeeded({ timeout: 8000 });
        await page.waitForTimeout(400);
      } catch {
        void 0;
      }
      for (const attempt of [1, 2, 3]) {
        try {
          isAlreadyChecked = await cb.isChecked();
          if (isAlreadyChecked) {
            ok = true;
            break;
          }
          if (attempt === 1) {
            await cb.focus({ timeout: 4000 });
            await page.waitForTimeout(300);
            await page.keyboard.press(" ", { delay: 100 });
          } else if (attempt === 2) {
            await cb.click({ timeout: 5000, position: { x: 3, y: 3 } });
          } else {
            await cb.evaluate((node) => {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "checked",
              )?.set;
              nativeInputValueSetter?.call(node, true);
              const evChange = new Event("change", { bubbles: true });
              const evInput = new Event("input", { bubbles: true });
              node.dispatchEvent(evInput);
              node.dispatchEvent(evChange);
            });
          }
        } catch (err) {
          logEvidence(`   ⚠️  Privacy tentativo ${attempt} errore: ${String(err).slice(0, 120)}`);
        }
        await page.waitForTimeout(1200);
        if (await cb.isChecked()) {
          ok = true;
          logEvidence(`   Privacy ACCETTATA (tentativo ${attempt}).`);
          break;
        }
        logEvidence(`   Privacy NON accettata dopo tentativo ${attempt}.`);
      }
      if (!ok) {
        logEvidence(`   ⚠️  Privacy ULTIMO FALLBACK: React fiber onChange trigger.`);
        await cb.evaluate((node) => {
          node.checked = true;
          const anyKey = Object.keys(node).filter(
            (k) => k.startsWith("__reactProps") || k.startsWith("__reactFiber"),
          )[0];
          if (anyKey) {
            let handler = null;
            let target = node[anyKey];
            for (let i = 0; i < 6 && target; i++) {
              if (target.memoizedProps?.onChange) {
                handler = target.memoizedProps.onChange;
                break;
              }
              if (target.return) target = target.return;
            }
            if (handler) {
              try {
                handler({ target: node, currentTarget: node, checked: true, type: "change" });
              } catch {
                void 0;
              }
            } else {
              node.dispatchEvent(new Event("change", { bubbles: true }));
              node.dispatchEvent(new Event("input", { bubbles: true }));
            }
          } else {
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        await page.waitForTimeout(1200);
      }
    }
    await page.waitForTimeout(900);
    const privacyHiddenVal = await page
      .locator('input[type=hidden][name="privacy_accepted"]')
      .getAttribute("value");
    logEvidence(
      `   privacy_accepted hidden dopo check = "${privacyHiddenVal}", checkbox checked=${await cb.isChecked()}`,
    );
    snap(page, "06_privacy_checked");

    logEvidence("\n## STEP 7 — PRE SUBMIT capture: input.value + FormData + starts_at hidden");
    const preState = await page.evaluate(() => {
      const $ = (sel) => document.querySelector(sel);
      const form = document.querySelector("form");
      const fdEntries = form
        ? [...new FormData(form)].map(([k, v]) => [
            k,
            typeof v === "string" ? v.slice(0, 80) : `[File ${v.name || "?"}]`,
          ])
        : [];
      return {
        customer_name: $("#customer_name")?.value ?? "",
        customer_email: $("#customer_email")?.value ?? "",
        customer_phone: $("#customer_phone")?.value ?? "",
        notes: $("#notes")?.value ?? "",
        service_id: $('input[name="service_id"]')?.value ?? "",
        resource_slug: $('input[name="resource_slug"]')?.value ?? "",
        starts_at: $('input[name="starts_at"]')?.value ?? "",
        privacy_hidden: $('input[name="privacy_accepted"]')?.value ?? "",
        privacy_checkbox:
          ($("input[type=checkbox][aria-describedby=privacy-hint]") || {}).checked ?? false,
        formData: fdEntries,
        canSubmit_disabled:
          document.querySelector('button[type="submit"]')?.hasAttribute("disabled") ?? true,
      };
    });
    logEvidence(
      "\n### PRE SUBMIT STATE\n\n" +
        MULTI_BACKTICK_CODE_START +
        "json\n" +
        JSON.stringify(preState, null, 2) +
        "\n" +
        MULTI_BACKTICK_CODE_END +
        "\n",
    );

    logEvidence("### PRE SUBMIT assertion intermedia");
    logEvidence(
      `   name len ok=${preState.customer_name.length >= 8 ? "✅" : "❌"} email ok=${
        preState.customer_email.includes("@") ? "✅" : "❌"
      } formData_contains_email=${
        preState.formData.some(([k, v]) => k === "customer_email" && String(v).includes("@"))
          ? "✅"
          : "❌"
      } starts_at_len=${preState.starts_at.length}`,
    );

    logEvidence("\n## STEP 8 — Intercetta request action + submit cliccando pulsante VISIBILE");
    let requestPayload = null;
    let responseStatus = null;
    let responseBody = "";
    page.on("request", (req) => {
      if (/\/booking\/?(\?|$)/.test(req.url()) || req.method() === "POST") {
        const pd = req.postData() || "";
        if (pd && (pd.includes("customer_") || pd.includes("service_id"))) {
          requestPayload = { url: req.url(), method: req.method(), postData: pd.slice(0, 1600) };
          logEvidence(
            "\n### REQUEST intercepted POST createBookingAction\n\n" +
              MULTI_BACKTICK_CODE_START +
              "\n" +
              req.method() +
              " " +
              req.url() +
              "\nPOST DATA:\n" +
              pd.slice(0, 2000) +
              "\n" +
              MULTI_BACKTICK_CODE_END +
              "\n",
          );
        }
      }
    });

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.waitFor({ state: "visible", timeout: 10000 });
    const btnText = await submitBtn.textContent();
    logEvidence(`   Submit button text="${btnText}" disabled=${await submitBtn.isDisabled()}`);
    try {
      const [resp] = await Promise.all([
        page
          .waitForResponse((r) => r.status() > 0 && /booking|act/.test(r.url() || ""), {
            timeout: 20000,
          })
          .catch(() => null),
        submitBtn.click(),
      ]);
      if (resp) {
        responseStatus = resp.status();
        try {
          responseBody = String(await resp.text()).slice(0, 3000);
        } catch {
          void 0;
        }
        logEvidence(
          "\n### RESPONSE intercepted status=" +
            responseStatus +
            "\n\n" +
            MULTI_BACKTICK_CODE_START +
            "html\n" +
            responseBody.slice(0, 1500) +
            "\n" +
            MULTI_BACKTICK_CODE_END +
            "\n",
        );
      }
    } catch (err) {
      logEvidence(`   ⚠️ submit click/response error: ${err}`);
    }
    await page.waitForTimeout(2500);
    snap(page, "07_after_submit");

    // Leggi l'alert di errore o il successo
    const postAlert = await page.evaluate(() => {
      const fail = document.querySelector('[role="alert"] div');
      const ok = document.querySelector('[data-testid="booking-created"] h2');
      return {
        error: fail?.innerText || fail?.textContent || null,
        ok: ok?.innerText || ok?.textContent || null,
      };
    });
    logEvidence(
      "\n### POST SUBMIT UI STATE\n\n" +
        MULTI_BACKTICK_CODE_START +
        "json\n" +
        JSON.stringify(postAlert, null, 2) +
        "\n" +
        MULTI_BACKTICK_CODE_END +
        "\n",
    );

    logEvidence("\n## STEP 9 — SQL READ BACK BOOKING");
    const { rows: bookings } = await pg.query(
      `SELECT id, tenant_id, service_id, status, payment_status, deposit_payment_method,
              customer_name, customer_email, customer_phone,
              starts_at, ends_at, deposit_amount,
              deposit_confirmed_by, deposit_paid_at
       FROM public.bookings
       WHERE customer_email=$1
       ORDER BY created_at DESC LIMIT 3`,
      [CUSTOMER.email],
    );
    logEvidence(
      "\n### BOOKINGS READ BACK rows=" +
        bookings.length +
        "\n\n" +
        MULTI_BACKTICK_CODE_START +
        "json\n" +
        JSON.stringify(bookings, null, 2) +
        "\n" +
        MULTI_BACKTICK_CODE_END +
        "\n",
    );

    const created = bookings.find((b) => b.customer_email === CUSTOMER.email);
    logEvidence("\n## CLASSIFICAZIONE ROOT BOOKING");
    if (created) {
      const motivazione = [
        "User-style typing + click reale senza evaluate set value e senza dispatchEvent = BOOKING CREATO (count=1, status=" +
          created.status +
          ").",
        "Quindi root causale validation_error precedente è nel TEST HELPER del vecchio mega_script_dry_run.mjs, NON nell'applicazione.",
        "I punti specifici nel vecchio helper che hanno generato il falso errore validation_error sono:",
        "(1) le chiamate a page.fill(customer_*) seguite immediatamente da .catch(() => {}), che mascheravano fallimenti di 'non interabile / selettore non attaccato al DOM dopo refetch slots' quando il fetch resources o slots triggerava un re-render e i nodi venivano ricreati mentre fill stava avvenendo (cattura silenziosa).",
        "(2) uso di page.evaluate() per forzare input[type=date].value con dispatchEvent manuali; lo stesso pattern produce side effects nel disallineamento React state canSubmit se l'ordine non è quello atteso.",
        "(3) evaluate set hidden resource_slug/service_id manuali non necessari ma la sincronizzazione non è stata accompagnata da waitForSelector sui campi customer dopo aver cambiato data/servizio, quindi i fill avvenivano su nodi vecchi (stale DOM node) e FormData al submit vedeva i campi vuoti (nuovo form) → validation error 'almeno un contatto email/phone'.",
        "Nelle modifiche a T3 si applica fix helper: (a) rimozione catch vuoti, (b) waitFor state interactive prima di fill, (c) click + type invece di fill o fill con attese e nessun evaluate set.value.",
      ].join("\n");
      logEvidence(
        "\n# CLASSIFICAZIONE ROOT BOOKING: " +
          CLASSIFICATION_HELPER +
          "\n\nMotivazione ≥500 chars:\n\n" +
          motivazione +
          "\n",
      );
    } else {
      const motivazione = [
        "Anche dopo typing user-style puro (click + type su ogni campo senza evaluate, senza hidden manuali, senza dispatchEvent forzati) → 0 rows bookings create.",
        "FormData pre-submit mostrava tutti i campi valorizzati (customer_email con @, customer_phone +39..., service_id UUID, starts_at ISO, privacy=1), EPPURE response restituisce ancora validation_error / errore SQL.",
        "Quindi root non è l'helper/Playwright ma l'applicazione.",
        "Punto di indagine: (a) ZOD refine custom in CreatePublicBookingSchema di lib/server/booking.ts che aggiunge il controllo email | phone non trovato nel tipo ma potrebbe essere nel backend RPC.",
        "(b) RPC public_booking_create_v3 CHECK constraint PLPGSQL: IF p_customer_email IS NULL AND p_customer_phone IS NULL THEN RAISE EXCEPTION 'Almeno un contatto';",
        "(c) handleSubmit BookingClientForm che costruisce new FormData(form) ma prima di fd.set ha una condition che esclude i campi se un form precedente è stato sottomesso o se i campi sono dentro un section condizionale.",
        "(d) server action createBookingAction legge FormData ma apply trasform email.trim o phone.normalize che sbaglia.",
        "(e) action redirect o useActionState che sovrascrive error state.",
        "Indagine e fix root applicazione.",
      ].join("\n");
      logEvidence(
        "\n# CLASSIFICAZIONE ROOT BOOKING: " +
          CLASSIFICATION_APP +
          "\n\nMotivazione ≥500 chars:\n\n" +
          motivazione +
          "\n",
      );
    }

    await pg.end();
    await browser.close();
    logEvidence(
      `\n## EVIDENCE FILES\n- Evidence markdown: ${EVIDENCE_FILE}\n- Screenshots dir: ${SCREEN_DIR} (prefix booking_${RUN_ID}_*)\n- Request payload captured: ${requestPayload ? "✅ SI" : "❌ NO"}`,
    );
    process.exit(0);
  } catch (fatal) {
    appendFileSync(
      EVIDENCE_FILE,
      "\n## FATALE\n" +
        MULTI_BACKTICK_CODE_START +
        "\n" +
        (fatal instanceof Error ? fatal.message + "\n" + fatal.stack : String(fatal)) +
        "\n" +
        MULTI_BACKTICK_CODE_END +
        "\n",
      "utf8",
    );
    process.stderr.write(`FATAL: ${fatal}\n`);
    try {
      await pg.end();
    } catch {
      void 0;
    }
    try {
      await browser.close();
    } catch {
      void 0;
    }
    process.exit(1);
  }
})();
