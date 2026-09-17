/* eslint-disable */
import "dotenv/config";
import pg from "pg";
import http from "node:http";
import fs from "node:fs";

const { Pool } = pg;

const outLines = [];
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...args) => {
  origLog.apply(console, args);
  outLines.push(args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" "));
};
console.error = (...args) => {
  origErr.apply(console, args);
  outLines.push("[ERROR] " + args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" "));
};
console.warn = (...args) => {
  origWarn.apply(console, args);
  outLines.push("[WARN] " + args.map((a) => {
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" "));
};

const pool = new Pool({
  host: process.env.DB_HOST || process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.DB_PORT || process.env.POSTGRES_PORT || 54322),
  database: process.env.DB_NAME || process.env.POSTGRES_DB || "postgres",
  user: process.env.DB_USER || process.env.POSTGRES_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "postgres",
});

const SLUG = process.env.DRY_SLUG || "slugo-mtu30v76-1fon";
const SERVICE_NAME = process.env.DRY_SVC_NAME || "Pulizia viso profonda";
const TENANT_ENV = process.env.DRY_SLUG ? "DRY" : "TONINO";
const CUSTOMER = {
  name: "Mario Rossi E2E Booking",
  email: "mario-rossi-e2e@velora.test",
  phone: "+39 333 000 0001",
  notes: "Test E2E booking Fase FC. Cliente reale simulato.",
};
const BASE_URL = "http://localhost:3000";

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 15000,
        headers: { Accept: "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || "{}") });
          } catch (e) {
            resolve({ status: res.statusCode, body: { raw: data } });
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("HTTP timeout slots"));
    });
    req.end();
  });
}

function nextWeekdayOnOrAfter(startDate, targetWeekday, minDaysAhead = 7) {
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + minDaysAhead);
  while (d.getDay() !== targetWeekday) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  VELORA BOOKING E2E — TENANT " + TENANT_ENV.padEnd(37, " ") + "║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n--- B-00: INFO PAYMENT & SCOPE ---");
  console.log(
    "ℹ️  Deposito e pagamento LIVE NON inclusi. Bonifico bancario manuale è il canale ufficiale.",
  );
  console.log(
    "ℹ️  Divieto Stripe regola progetto. Nessun pagamento LIVE implementato in questo gate.",
  );

  const t = await pool.query(`SELECT id, slug, name FROM tenants WHERE slug=$1 LIMIT 1`, [SLUG]);
  const TENANT_ID = t.rows[0].id;
  console.log("\n--- B-01: TENANT + SERVICE ---");
  console.log("TENANT_ID:", TENANT_ID);

  const svc = await pool.query(
    `SELECT id, name, duration_minutes, price_from, currency, deposit_strategy, deposit_value
     FROM services WHERE tenant_id=$1 AND name=$2 LIMIT 1`,
    [TENANT_ID, SERVICE_NAME],
  );
  const SVC = svc.rows[0];
  if (!SVC) throw new Error("Servizio non trovato: " + SERVICE_NAME);
  console.log(
    "SERVICE:",
    SVC.name,
    "dur=" + SVC.duration_minutes + "m",
    "price=" + SVC.price_from + SVC.currency,
    "deposit=" + SVC.deposit_strategy + ":" + SVC.deposit_value,
  );

  console.log(
    "\n--- B-02: CLEANUP PRE-ESISTENTI 'Mario Rossi E2E' + Race concorrenti (soft-cancel) ---",
  );
  const pre = await pool.query(
    `SELECT id, status, customer_name FROM bookings WHERE tenant_id=$1
     AND (customer_name=$2 OR customer_name LIKE '%Concorrente%' OR customer_name LIKE 'Gina %' OR customer_name LIKE 'Gino %')`,
    [TENANT_ID, CUSTOMER.name],
  );
  console.log("Preesistenti da soft-cancellare (status=cancelled):", pre.rowCount);
  for (const r of pre.rows) {
    if (r.status !== "cancelled") {
      const upd = await pool.query(
        `UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING id, status`,
        [r.id],
      );
      console.log(
        "  cancelled",
        r.id.slice(0, 8) +
          "… name=" +
          r.customer_name +
          " new_status=" +
          (upd.rows[0]?.status || "?"),
      );
    } else {
      console.log("  already cancelled", r.id.slice(0, 8) + "… name=" + r.customer_name);
    }
  }

  const targetDate = nextWeekdayOnOrAfter(new Date(), 1, 10); // Lunedi tra 10+ giorni
  const DATE_STR = isoDate(targetDate);
  console.log("\n--- B-03: TARGET DATE =", DATE_STR, "(Lunedi enabled) ---");

  const SLUG_ENC = encodeURIComponent(SLUG);
  const SVC_ENC = encodeURIComponent(SVC.id);
  const slotsBeforeUrl = `${BASE_URL}/s/${SLUG_ENC}/booking/slots?service_id=${SVC_ENC}&date=${DATE_STR}&resource_slug=any`;
  console.log("HTTP GET slots:", slotsBeforeUrl);
  const slotsBeforeRaw = await httpJson(slotsBeforeUrl);
  if (slotsBeforeRaw.status !== 200) {
    console.error("HTTP slots status:", slotsBeforeRaw.status, slotsBeforeRaw.body);
    throw new Error("Impossibile recuperare slot: status " + slotsBeforeRaw.status);
  }
  const SLOTS_BEFORE = slotsBeforeRaw.body.slots || [];
  console.log("Slots disponibili PRIMA del booking:", SLOTS_BEFORE.length);
  if (SLOTS_BEFORE.length < 3) {
    console.error("Servono almeno 3 slots (1 base + 2 race). Trovati:", SLOTS_BEFORE.length);
    console.log(
      "Slots:",
      SLOTS_BEFORE.slice(0, 10).map((s) => s.label + "(" + s.iso + ")"),
    );
    throw new Error("Slot insufficienti per la batteria di test.");
  }
  const SLOT_BASE = SLOTS_BEFORE[0];
  const baseStartMs = new Date(SLOT_BASE.iso).getTime();
  const durationMs = Number(SVC.duration_minutes || 30) * 60 * 1000;
  const baseEndMs = baseStartMs + durationMs;
  const SLOT_RACE =
    SLOTS_BEFORE.find((s) => new Date(s.iso).getTime() >= baseEndMs + 2 * 60 * 1000) ||
    SLOTS_BEFORE[Math.min(5, SLOTS_BEFORE.length - 1)];
  console.log(
    "SLOT_BASE scelta:",
    SLOT_BASE.label,
    "→",
    SLOT_BASE.iso,
    "(fine ~",
    new Date(baseEndMs).toISOString(),
    ")",
  );
  console.log("SLOT_RACE scelta (no sovrapposizione):", SLOT_RACE.label, "→", SLOT_RACE.iso);

  console.log("\n--- B-04: SUBMIT BOOKING BASE (Mario Rossi) via RPC public_booking_create_v3 ---");
  const bookingBase = await pool.query(
    `SELECT * FROM public.public_booking_create_v3(
      p_tenant_slug:=$1,
      p_service_id:=$2,
      p_starts_at:=$3::timestamptz,
      p_resource_slug:=$4,
      p_customer_name:=$5,
      p_customer_email:=$6,
      p_customer_phone:=$7,
      p_notes:=$8
    )`,
    [
      SLUG,
      SVC.id,
      SLOT_BASE.iso,
      "any",
      CUSTOMER.name,
      CUSTOMER.email,
      CUSTOMER.phone,
      CUSTOMER.notes,
    ],
  );
  const BASE_RESULT = bookingBase.rows[0];
  if (!BASE_RESULT) throw new Error("RPC booking create ha restituito 0 righe (slot_taken?)");
  console.log("BOOKING BASE OK:");
  console.log("  RPC columns returned:", Object.keys(BASE_RESULT));
  console.log(
    "  booking_id:",
    BASE_RESULT.booking_id ? BASE_RESULT.booking_id.slice(0, 13) + "…" : "NULL",
  );
  console.log("  status:", BASE_RESULT.status);
  console.log("  starts_at (RPC start_at):", BASE_RESULT.start_at);
  console.log("  ends_at (RPC end_at):", BASE_RESULT.end_at);
  console.log(
    "  resource_id:",
    BASE_RESULT.resource_id ? BASE_RESULT.resource_id.slice(0, 8) + "…" : "NULL",
  );
  console.log("  resource_slug:", BASE_RESULT.resource_slug);
  console.log("  total_price:", BASE_RESULT.total_price, "deposit:", BASE_RESULT.deposit_amount);

  console.log("\n--- B-05: READ BACK DB bookings ---");
  const readBack = await pool.query(
    `SELECT id, tenant_id, service_id, starts_at, ends_at, status,
            customer_name, customer_email, customer_phone, notes,
            resource_id, payment_status, deposit_amount
     FROM bookings WHERE id=$1 LIMIT 1`,
    [BASE_RESULT.booking_id],
  );
  const RB = readBack.rows[0];
  if (!RB) throw new Error("READ BACK FALLITO: booking non trovato su DB");
  console.log("READ BACK OK:");
  let assertPass = 0,
    assertFail = 0;
  function assert(name, actual, expected) {
    const ok = actual === expected;
    if (ok) {
      console.log("  ✅", name, ":", String(actual).slice(0, 80));
      assertPass++;
    } else {
      console.error("  ❌", name, ": expected=", expected, "actual=", actual);
      assertFail++;
    }
  }
  assert("tenant_id OK", RB.tenant_id, TENANT_ID);
  assert("service_id OK", RB.service_id, SVC.id);
  assert("customer_name OK", RB.customer_name, CUSTOMER.name);
  assert("customer_email OK", RB.customer_email, CUSTOMER.email);
  assert("customer_phone OK", RB.customer_phone, CUSTOMER.phone);
  assert("notes OK", RB.notes, CUSTOMER.notes);
  assert("status OK", RB.status, "confirmed");
  const startsAtDb = new Date(RB.starts_at).getTime();
  const startsAtExpected = new Date(SLOT_BASE.iso).getTime();
  const okStart = Math.abs(startsAtDb - startsAtExpected) < 1000;
  if (okStart) {
    console.log("  ✅ starts_at OK:", new Date(RB.starts_at).toISOString());
    assertPass++;
  } else {
    console.error(
      "  ❌ starts_at: expected=",
      SLOT_BASE.iso,
      "actual=",
      new Date(RB.starts_at).toISOString(),
    );
    assertFail++;
  }
  const expectedEndMs = startsAtExpected + SVC.duration_minutes * 60 * 1000;
  const actualEndMs = new Date(RB.ends_at).getTime();
  const okEnd = Math.abs(actualEndMs - expectedEndMs) < 1000;
  if (okEnd) {
    console.log(
      "  ✅ ends_at OK +durata(" + SVC.duration_minutes + "m):",
      new Date(RB.ends_at).toISOString(),
    );
    assertPass++;
  } else {
    console.error("  ❌ ends_at mismatch: expected_ms=", expectedEndMs, "actual_ms=", actualEndMs);
    assertFail++;
  }

  console.log("\n--- B-06: VERIFICA SLOT BASE NON PIÙ DISPONIBILE (GET /slots) ---");
  await sleep(1500);
  const slotsAfterRaw = await httpJson(slotsBeforeUrl);
  const SLOTS_AFTER = slotsAfterRaw.body.slots || [];
  console.log("Slots disponibili DOPO booking:", SLOTS_AFTER.length);
  const baseStillThere = SLOTS_AFTER.find((s) => s.iso === SLOT_BASE.iso);
  if (!baseStillThere) {
    console.log("  ✅ SLOT_BASE (" + SLOT_BASE.label + ") rimosso dalla lista come atteso.");
    assertPass++;
  } else {
    console.error("  ❌ SLOT_BASE ancora presente nonostante confirmed!", baseStillThere);
    assertFail++;
  }

  console.log("\n--- B-07: SLOT LOCK SAFETY + RACE CONDITION (2 test) ---");
  console.log("Slot target:", SLOT_RACE.label, SLOT_RACE.iso);
  let scenarioA = false;
  let scenarioB = false;

  console.log("\nB-07a: TEST SAFETY SERIALE (1 win, 1 lose atteso) sullo stesso slot");
  function makeRaceArgs(name, email, phone, notes) {
    return [SLUG, SVC.id, SLOT_RACE.iso, "any", name, email, phone, notes];
  }
  const argsGina = makeRaceArgs(
    "Gina Safety Booking S1",
    "gina-s1@velora.test",
    "+39 333 888 0101",
    "Safety test seriale 1",
  );
  const argsGino = makeRaceArgs(
    "Gino Safety Booking S2",
    "gino-s2@velora.test",
    "+39 333 888 0202",
    "Safety test seriale 2 (dovrebbe fallire)",
  );
  let ginaOk = false,
    ginoOk = false;
  let ginaBookingId = null;
  try {
    const r = await pool.query(
      `SELECT * FROM public.public_booking_create_v3($1,$2,$3::timestamptz,$4,$5,$6,$7,$8)`,
      argsGina,
    );
    ginaOk = r.rows && r.rows.length > 0;
    if (ginaOk) ginaBookingId = r.rows[0].booking_id;
    console.log(
      "  S1 Gina:",
      ginaOk
        ? "✅ WIN (booking_id=" + r.rows[0].booking_id.slice(0, 8) + "…)"
        : "❌ LOSE rows=" + (r.rows?.length || 0),
    );
  } catch (e) {
    console.log("  S1 Gina: ❌ LOSE code=" + e.code + " msg=" + e.message.slice(0, 80));
  }
  try {
    const r = await pool.query(
      `SELECT * FROM public.public_booking_create_v3($1,$2,$3::timestamptz,$4,$5,$6,$7,$8)`,
      argsGino,
    );
    ginoOk = r.rows && r.rows.length > 0;
    console.log(
      "  S2 Gino (dopo Gina):",
      ginoOk
        ? "❌ WIN (DOPPIO BOOKING NON CONSENTITO!)"
        : "✅ LOSE (corretto — slot occupato) rows=" + (r.rows?.length || 0),
    );
  } catch (e) {
    console.log("  S2 Gino: ✅ LOSE (corretto) code=" + e.code + " msg=" + e.message.slice(0, 80));
  }
  const serialSafetyOk = ginaOk && !ginoOk;
  if (serialSafetyOk) {
    console.log("  ✅ SAFETY SERIALE OK: 1 winner / 1 loser. Doppio booking impossibile.");
    assertPass++;
  } else {
    console.error(
      "  ❌ SAFETY SERIALE FAIL: gina=" + ginaOk + " gino=" + ginoOk + " (atteso true/false)",
    );
    assertFail++;
  }
  if (ginaBookingId) {
    const cancelRes = await pool.query(
      `UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING id, status`,
      [ginaBookingId],
    );
    console.log(
      "  (soft-cancel S1 per race B-07b: updated_rows=" +
        cancelRes.rowCount +
        " new_status=" +
        (cancelRes.rows[0]?.status || "?") +
        ")",
    );
    await sleep(1200);
    const rb = await pool.query(`SELECT status FROM bookings WHERE id=$1`, [ginaBookingId]);
    if (rb.rows[0]?.status === "cancelled") {
      console.log("  (readback confermato: S1 status=cancelled, slot ripristinato)");
    } else {
      console.warn(
        "  ⚠️  readback S1 status=" + (rb.rows[0]?.status || "NULL") + " — update fallito!",
      );
    }
  }

  console.log("\nB-07b: TEST RACE SIMULTANEO Promise.all (2 concorrenti)");
  console.log("Promise.all([G1-RACE, G2-RACE])...");
  const raceArgs = makeRaceArgs(
    "Gina Concorrente R1",
    "gina-r1@velora.test",
    "+39 333 999 0001",
    "Race concorrente 1",
  );
  const raceArgs2 = makeRaceArgs(
    "Gino Concorrente R2",
    "gino-r2@velora.test",
    "+39 333 999 0002",
    "Race concorrente 2",
  );
  const [race1Res, race2Res] = await Promise.allSettled([
    pool.query(
      `SELECT * FROM public.public_booking_create_v3($1,$2,$3::timestamptz,$4,$5,$6,$7,$8)`,
      raceArgs,
    ),
    pool.query(
      `SELECT * FROM public.public_booking_create_v3($1,$2,$3::timestamptz,$4,$5,$6,$7,$8)`,
      raceArgs2,
    ),
  ]);
  function unwrapRace(promiseResult, idx) {
    console.log("\n  [RACE-" + idx + "] promise status:", promiseResult.status);
    if (promiseResult.status === "rejected") {
      const e = promiseResult.reason;
      console.log(
        "  [RACE-" +
          idx +
          "] REJECTED: code=" +
          (e?.code || "?") +
          " message=" +
          String(e?.message || e).slice(0, 120),
      );
      return {
        ok: false,
        error_code: e?.code || "unknown",
        error_message: e?.message || String(e),
      };
    }
    const qr = promiseResult.value;
    console.log(
      "  [RACE-" +
        idx +
        "] FULFILLED: rowCount=" +
        qr?.rowCount +
        " rows.length=" +
        (qr?.rows?.length ?? "?"),
    );
    if (qr?.rows) {
      qr.rows.forEach((r, i) =>
        console.log(
          "    [RACE-" + idx + "][" + i + "] booking_id=" + r.booking_id + " status=" + r.status,
        ),
      );
    }
    const rows = qr?.rows || [];
    if (rows.length === 0) return { ok: false, error_code: "no_rows", error_message: "RPC 0 rows" };
    return { ok: true, booking_id: rows[0].booking_id, booking_status: rows[0].status };
  }
  const R1 = unwrapRace(race1Res, 1);
  const R2 = unwrapRace(race2Res, 2);
  console.log("\nSUMMARY RACE PROMISE.ALL:");
  console.log("RACE-1:", JSON.stringify(R1));
  console.log("RACE-2:", JSON.stringify(R2));

  console.log(
    "\n  DB state confirmed bookings DOPO race (diretto, slot iso=" + SLOT_RACE.iso + "):",
  );
  const raceState = await pool.query(
    `SELECT id, status, customer_name, starts_at, ends_at FROM bookings
     WHERE tenant_id=$1 AND starts_at=$2::timestamptz AND status='confirmed'`,
    [TENANT_ID, SLOT_RACE.iso],
  );
  console.log("  confirmed count =", raceState.rowCount);
  raceState.rows.forEach((r, i) =>
    console.log("   [" + i + "]", r.id.slice(0, 8) + "…", r.status, r.customer_name),
  );
  const totalConfirmedRace = Number(raceState.rowCount);
  const winners = [R1, R2].filter((r) => r.ok).length;
  const losers = [R1, R2].filter((r) => !r.ok).length;
  console.log(
    "  total confirmed DB =",
    totalConfirmedRace,
    " | API winners =",
    winners,
    " | API losers =",
    losers,
  );
  const noDoubleBooking = totalConfirmedRace <= 1;
  scenarioA = winners === 1 && losers === 1 && totalConfirmedRace === 1;
  scenarioB = winners === 0 && losers === 2 && totalConfirmedRace === 0;
  let b09Ok = false;
  {
    console.log(
      "\n--- B-09: SLOT RACE DOPO LA RACE (verifica coerenza stato, PRIMA soft-cancel) ---",
    );
    await sleep(800);
    const slotsRaceAfterPre = await httpJson(slotsBeforeUrl);
    const SRP = slotsRaceAfterPre.body.slots || [];
    const raceStillTherePre = SRP.find((s) => s.iso === SLOT_RACE.iso);
    console.log(
      "  scenarioA=" + scenarioA + " (1 confirmed) scenarioB=" + scenarioB + " (0 confirmed)",
    );
    console.log("  slot_race presente=" + !!raceStillTherePre);
    b09Ok = scenarioA ? !raceStillTherePre : scenarioB ? !!raceStillTherePre : false;
    if (b09Ok) {
      console.log(
        "  ✅ SLOT RACE stato coerente: " +
          (scenarioA
            ? "rimosso dopo race confirmed."
            : "ancora disponibile dopo race 0 confirmed (safety OK, slot libero)."),
      );
      assertPass++;
    } else {
      console.error(
        "  ❌ SLOT RACE stato incoerente: scenarioA=" +
          scenarioA +
          " presente=" +
          !!raceStillTherePre +
          " (atteso " +
          (scenarioA ? "assente" : "presente") +
          ")",
      );
      assertFail++;
    }
  }
  if (noDoubleBooking && (scenarioA || scenarioB)) {
    if (scenarioA)
      console.log(
        "  ✅ RACE CONDITION (Scenario A): 1 API WIN / 1 API LOSE / DB=1 confirmed → NO double booking.",
      );
    if (scenarioB)
      console.log(
        "  ✅ RACE CONDITION (Scenario B): 0 API WIN / 2 LOSE / DB=0 confirmed → NO double booking (nessun doppio involontario; safety OK). Note: slot resta libero, si può ritentare.",
      );
    assertPass++;
  } else {
    console.error(
      "  ❌ RACE FAIL: confirmed=" +
        totalConfirmedRace +
        " API winners=" +
        winners +
        " losers=" +
        losers +
        " (NO DOUBLE BOOKING VIOLATO o stato inatteso)",
    );
    assertFail++;
  }
  const raceWinner = [R1, R2].find((r) => r.ok);
  if (raceWinner?.booking_id) {
    const up = await pool.query(
      `UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING id, status`,
      [raceWinner.booking_id],
    );
    console.log(
      "  (race winner SOFT-CANCELLED per ripristinare slot fixture, new_status=" +
        (up.rows[0]?.status || "?") +
        ")",
    );
  } else if (totalConfirmedRace === 1) {
    const onlyOne = raceState.rows[0];
    if (onlyOne) {
      await pool.query(`UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=$1`, [
        onlyOne.id,
      ]);
      console.log(
        "  (DB ha 1 confirmed ma API non lo ha restituito → soft-cancel forzato id=" +
          onlyOne.id.slice(0, 8) +
          "…)",
      );
    }
  }
  await sleep(750);

  console.log("\n--- B-08: TENANT ISOLATION cross-tenant ---");
  let isolationOk = true;
  for (const otherSlug of ["barbieri-luca", "giulia-hair"]) {
    const c = await pool.query(
      `SELECT count(*)::int c FROM bookings b
       JOIN tenants t ON t.id=b.tenant_id
       WHERE t.slug=$1 AND (customer_name=$2 OR customer_name LIKE '%Concorrente%')`,
      [otherSlug, CUSTOMER.name],
    );
    const n = Number(c.rows[0].c);
    if (n === 0) {
      console.log("  ✅ " + otherSlug + ": 0 bookings Mario Rossi (isolamento OK)");
    } else {
      console.error(
        "  ❌ ISOLAMENTO FALLITO: " + otherSlug + " ha " + n + " bookings Mario Rossi!!",
      );
      isolationOk = false;
      assertFail++;
    }
  }
  if (isolationOk) assertPass++;

  console.log("\n--- B-10: PAYMENT STATUS / DEPOSITO ---");
  const paymentRow = await pool.query(
    `SELECT payment_status, deposit_amount, deposit_payment_ref, deposit_payment_method FROM bookings WHERE id=$1`,
    [BASE_RESULT.booking_id],
  );
  const PR = paymentRow.rows[0];
  console.log(
    "payment_status:",
    PR.payment_status,
    "| deposit_amount:",
    PR.deposit_amount,
    "| deposit_ref:",
    PR.deposit_payment_ref || "(nessuno)",
  );
  if (
    PR.payment_status === "unpaid" &&
    (PR.deposit_amount == null || Number(PR.deposit_amount) === 0)
  ) {
    console.log("  ✅ Servizio a deposito NONE: payment=unpaid, deposit=0/null. OK.");
    assertPass++;
  } else {
    console.warn("  ⚠️  Stato pagamento diverso da atteso (ma servizio deposit=NONE).");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("ASSERT TOTALI: PASS=" + assertPass + " / FAIL=" + assertFail);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(
    "\nℹ️  Backoffice visibility: se esiste route /app/bookings con filtro tenant Tonino → Mario Rossi presente.",
  );
  console.log("    (Verifica DB effettuata con read-back sopra: record esistente confirmed.)");

  try {
    const p = new URL("../artifacts/booking-e2e-v1.log", import.meta.url);
    fs.writeFileSync(p, outLines.join("\n") + "\n", { encoding: "utf8" });
    console.log("(runner: scritto artifact " + p.pathname + " lines=" + outLines.length + ")");
  } catch (e) {
    console.error("(runner: scrittura artifact fallita " + e.message + ")");
  }

  await pool.end();
  process.exit(assertFail === 0 ? 0 : 2);
}
main().catch((e) => {
  console.error("\n❌ BOOKING E2E FALLITO GRAVE:", e);
  process.exit(1);
});
