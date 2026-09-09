/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unused-vars */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ARTIFACTS_DIR = resolve(ROOT, "artifacts", "fase0");
const REPORT_PATH = resolve(ARTIFACTS_DIR, "task-0.2-booking-rpc-report.json");

const TENANT_SLUG = "velora-prod-acceptance-studio";
const TENANT_ID = "57ba7988-e8e6-46d4-b4ea-3192420d6ab0";
const SERVICE_COLORE_ID = "2883bcc4-bd56-4fd5-9829-73af5aaf4d00";
const RESOURCE_LUCIA_SLUG = "lucia-bianchi";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error("FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = {
  startedAt: new Date().toISOString(),
  tenant: { slug: TENANT_SLUG, id: TENANT_ID },
  service: { id: SERVICE_COLORE_ID, name: "Colore" },
  resource: { slug: RESOURCE_LUCIA_SLUG },
  preBookingCount: null,
  postBookingCount: null,
  tests: [],
};

async function countBookings() {
  try {
    const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const serviceClient = srKey
      ? createClient(url, srKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : client;
    const { count, error } = await serviceClient
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    if (error) {
      console.warn(
        "  [WARN] countBookings errored (using " +
          (srKey ? "service" : "anon") +
          " client): " +
          JSON.stringify(error),
      );
      return -1;
    }
    return count;
  } catch (e) {
    console.warn("  [WARN] countBookings exception:", e && e.message ? e.message : e);
    return -1;
  }
}

function describeError(err) {
  const code =
    err?.code ||
    err?.data?.code ||
    (err && typeof err === "object" && "code" in err ? err.code : undefined);
  const message =
    err?.message ||
    err?.data?.message ||
    (err && typeof err === "object" && "message" in err ? err.message : String(err));
  const details = err?.data?.details || err?.details || undefined;
  const hint = err?.data?.hint || err?.hint || undefined;
  return { code, message, details, hint };
}

/**
 * Calls the Postgres RPC public_booking_create_v3 via supabase-js client.rpc
 * Signature: (p_tenant_slug, p_service_id, p_starts_at, p_resource_slug,
 *             p_customer_name, p_customer_email, p_customer_phone, p_notes)
 */
async function callBookingRpc(params) {
  try {
    const { data, error } = await client.rpc("public_booking_create_v3", {
      p_tenant_slug: params.tenantSlug,
      p_service_id: params.serviceId,
      p_starts_at: params.startsAt,
      p_resource_slug: params.resourceSlug,
      p_customer_name: params.customerName,
      p_customer_email: params.customerEmail,
      p_customer_phone: params.customerPhone,
      p_notes: params.notes ?? "",
    });
    if (error) {
      return { ok: false, error: describeError(error), raw: error };
    }
    return { ok: true, data: Array.isArray(data) ? data : data ? [data] : [], raw: data };
  } catch (thrown) {
    return { ok: false, error: describeError(thrown), raw: thrown };
  }
}

function addTest(test) {
  results.tests.push(test);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  console.log("======= FASE 0 — TASK 0.2: BOOKING RPC DEFECT TEST N3/N4/B1 =======");
  console.log(`  DB URL        : ${url}`);
  console.log(`  Tenant slug   : ${TENANT_SLUG}`);
  console.log(`  Service id    : ${SERVICE_COLORE_ID}`);
  console.log(`  Resource slug : ${RESOURCE_LUCIA_SLUG}`);
  console.log("");

  results.preBookingCount = await countBookings();
  console.log(`PRE  bookings count for tenant: ${results.preBookingCount}`);
  console.log("");

  // ========================================================================
  // TEST N3 — FULL TIMEOFF SINGOLO OPERATORE (16/09 10:00 CEST = 08:00Z)
  // Atteso: VLTO1
  // ========================================================================
  const n3StartsAt = "2026-09-16T08:00:00.000Z";
  const n3Params = {
    tenantSlug: TENANT_SLUG,
    serviceId: SERVICE_COLORE_ID,
    startsAt: n3StartsAt,
    resourceSlug: RESOURCE_LUCIA_SLUG,
    customerName: "Test N3 DEFECT Full Timeoff",
    customerEmail: "n3-test-full-timeoff@velora.studio",
    customerPhone: "+390000000003",
    notes: "DEFECT TEST N3 — FULL TIMEOFF Lucia 16/09 — deve essere VLTO1",
  };
  const n3Res = await callBookingRpc(n3Params);
  const n3Pass =
    !n3Res.ok &&
    (n3Res.error?.code === "VLTO1" ||
      (typeof n3Res.error?.message === "string" &&
        /time.?off|ferie|chiusura|non disponibile|operator unavailable/i.test(
          n3Res.error.message,
        )));
  addTest({
    id: "N3-FULL-TIMEOFF-VLTO1",
    label: "N3 Full Day Timeoff singolo operatore Lucia 16/09 10:00 CEST",
    params: { startsAt: n3StartsAt, resourceSlug: RESOURCE_LUCIA_SLUG },
    expected: "!ok && error.code === VLTO1",
    got: n3Res.ok
      ? { ok: true, rows: n3Res.data?.length ?? 0, first: n3Res.data?.[0] ?? null }
      : { ok: false, error: n3Res.error },
    pass: n3Pass,
  });
  console.log(
    `TEST N3  => ${n3Pass ? "PASS" : "FAIL"}`,
    n3Pass ? "" : JSON.stringify(n3Res.ok ? n3Res.data : n3Res.error),
  );

  // ========================================================================
  // TEST N4 — PARTIAL TIMEOFF SINGOLO OPERATORE (22/09 15:00 CEST = 13:00Z)
  // Blocco 14:00-19:00. Slot 15:00 (durata 90min = 15:00-16:30) = overlapped
  // Atteso: VLTO1 (perché singolo operatore, NON mode=any)
  // ========================================================================
  const n4StartsAt = "2026-09-22T13:00:00.000Z";
  const n4Params = {
    tenantSlug: TENANT_SLUG,
    serviceId: SERVICE_COLORE_ID,
    startsAt: n4StartsAt,
    resourceSlug: RESOURCE_LUCIA_SLUG,
    customerName: "Test N4 DEFECT Partial Timeoff",
    customerEmail: "n4-test-partial-timeoff@velora.studio",
    customerPhone: "+390000000004",
    notes: "DEFECT TEST N4 — PARTIAL TIMEOFF Lucia 22/09 14-19 — deve essere VLTO1",
  };
  const n4Res = await callBookingRpc(n4Params);
  const n4Pass =
    !n4Res.ok &&
    (n4Res.error?.code === "VLTO1" ||
      (typeof n4Res.error?.message === "string" &&
        /time.?off|ferie|chiusura|non disponibile|operator unavailable/i.test(
          n4Res.error.message,
        )));
  addTest({
    id: "N4-PARTIAL-TIMEOFF-VLTO1",
    label: "N4 Partial Timeoff singolo operatore Lucia 22/09 15:00 CEST (blocco 14-19)",
    params: { startsAt: n4StartsAt, resourceSlug: RESOURCE_LUCIA_SLUG },
    expected: "!ok && error.code === VLTO1 (singolo op. timeoff)",
    got: n4Res.ok
      ? { ok: true, rows: n4Res.data?.length ?? 0, first: n4Res.data?.[0] ?? null }
      : { ok: false, error: n4Res.error },
    pass: n4Pass,
  });
  console.log(
    `TEST N4  => ${n4Pass ? "PASS" : "FAIL"}`,
    n4Pass ? "" : JSON.stringify(n4Res.ok ? n4Res.data : n4Res.error),
  );

  // ========================================================================
  // TEST B1 — REGRESSIONE: slot valido, senza timeoff (24/09 10:00 CEST = 08:00Z)
  // Deve andare a buon fine (ok:true) oppure conflict se slot occupato (VLTN7).
  // Qualsiasi cosa purché NON sia VLTO1/VLTO2.
  // ========================================================================
  const b1StartsAt = "2026-09-24T08:00:00.000Z";
  const b1Params = {
    tenantSlug: TENANT_SLUG,
    serviceId: SERVICE_COLORE_ID,
    startsAt: b1StartsAt,
    resourceSlug: RESOURCE_LUCIA_SLUG,
    customerName: "Test B1 Regression Slot Libero",
    customerEmail: "b1-regression@velora.studio",
    customerPhone: "+390000000001",
    notes: "DEFECT TEST B1 — REGRESSIONE slot 24/09 senza timeoff",
  };
  const b1Res = await callBookingRpc(b1Params);
  const code = b1Res.ok ? null : b1Res.error?.code;
  const b1Pass = code !== "VLTO1" && code !== "VLTO2";
  addTest({
    id: "B1-REGRESSION-SLOT-VALIDO",
    label: "B1 Regressione — slot 24/09 10:00 CEST senza timeoff (no VLTO)",
    params: { startsAt: b1StartsAt, resourceSlug: RESOURCE_LUCIA_SLUG },
    expected: "code != VLTO1 && code != VLTO2 (può essere ok:true oppure VLTN7 se occupato)",
    got: b1Res.ok
      ? { ok: true, rows: b1Res.data?.length ?? 0, first: b1Res.data?.[0] ?? null }
      : { ok: false, error: b1Res.error },
    pass: b1Pass,
  });
  console.log(
    `TEST B1  => ${b1Pass ? "PASS" : "FAIL"}`,
    b1Pass ? "" : JSON.stringify(b1Res.ok ? b1Res.data : b1Res.error),
  );

  // ========================================================================
  // COUNT POST
  // ========================================================================
  results.postBookingCount = await countBookings();
  console.log("");
  console.log(`POST bookings count for tenant: ${results.postBookingCount}`);

  const diff = results.postBookingCount - results.preBookingCount;
  // Atteso: 0 o 1 (solo B1 può aver creato 1 booking; N3/N4 non devono creare nulla)
  const countPass = diff === 0 || diff === 1;
  addTest({
    id: "COUNT-INVARIANT-N3-N4-NO-CREATE",
    label: "Count bookings: N3/N4 NON devono incrementare; al +1 solo per B1",
    expected: "diff ∈ {0, 1}",
    got: {
      pre: results.preBookingCount,
      post: results.postBookingCount,
      delta: diff,
    },
    pass: countPass,
  });
  console.log(`COUNT   => ${countPass ? "PASS" : "FAIL"} (delta = ${diff})`);

  // ========================================================================
  // REPORT FINALE
  // ========================================================================
  const totalPass = results.tests.filter((t) => t.pass).length;
  const totalTests = results.tests.length;
  results.endedAt = new Date().toISOString();
  results.summary = {
    total: totalTests,
    passed: totalPass,
    failed: totalTests - totalPass,
    allPassed: totalPass === totalTests,
  };

  console.log("");
  console.log("===================== SUMMARY =====================");
  console.log(`Totale test : ${totalTests}`);
  console.log(`Passati     : ${totalPass}`);
  console.log(`Falliti     : ${totalTests - totalPass}`);
  console.log(`Esito       : ${results.summary.allPassed ? "ALL PASSED ✅" : "SOME FAILED ❌"}`);
  console.log("Report JSON : " + REPORT_PATH);
  console.log("===================================================");

  await writeFile(REPORT_PATH, JSON.stringify(results, null, 2), "utf8");

  process.exit(results.summary.allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("UNEXPECTED FATAL:", e);
  process.exit(2);
});
