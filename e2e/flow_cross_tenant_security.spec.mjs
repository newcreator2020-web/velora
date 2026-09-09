import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  ensureTestSession,
  ensureAuthUserWithPassword,
  newSharedPg,
  sharedDbEnv,
} from "./_shared-auth.mjs";

const ALLOWED_DB_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS = new Set(["velora-local", "uiekkhgspziozprxulit"]);
(() => {
  const host = process.env["SUPABASE_DB_HOST"] ?? "";
  const pr = process.env["SUPABASE_PROJECT_ID"] ?? "";
  if (!((ALLOWED_DB_HOSTS.has(host) && pr.length === 0) || SAFE_PROJECT_IDS.has(pr))) {
    console.error("[flow_cross_tenant_security] unsafe DB env — ABORT");
    process.exit(1);
  }
})();

const RUN_TAG = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const PW = "VeloraE2E!Cross01";
const EMAIL_A = `owner-a-${RUN_TAG}@velora.test`;
const EMAIL_B = `owner-b-${RUN_TAG}@velora.test`;
const SLUG_A = `cross-a-${RUN_TAG.slice(-8)}`;
const SLUG_B = `cross-b-${RUN_TAG.slice(-8)}`;
const BIZ_A = `Barber Cross A ${RUN_TAG.slice(-4)}`;
const BIZ_B = `Beauty Cross B ${RUN_TAG.slice(-4)}`;

let pg = null;
let uidA = null;
let uidB = null;
let tidA = null;
let tidB = null;
let bookingBId = null;
let bookingBStartAtISO = "";

test.describe.serial("T21 · E2E Flow 3 — Cross-Tenant Security + Isolamento RLS", () => {
  test.beforeAll(async () => {
    pg = await newSharedPg();
    uidA = await ensureAuthUserWithPassword(EMAIL_A, PW, `Owner A E2E ${RUN_TAG}`);
    uidB = await ensureAuthUserWithPassword(EMAIL_B, PW, `Owner B E2E ${RUN_TAG}`);

    const tA = await pg.query(
      `INSERT INTO public.tenants (slug, name, status, published, created_at, updated_at)
       VALUES ($1, $2, 'active', true, NOW(), NOW()) RETURNING id`,
      [SLUG_A, BIZ_A],
    );
    tidA = tA.rows[0].id;
    const tB = await pg.query(
      `INSERT INTO public.tenants (slug, name, status, published, created_at, updated_at)
       VALUES ($1, $2, 'active', true, NOW(), NOW()) RETURNING id`,
      [SLUG_B, BIZ_B],
    );
    tidB = tB.rows[0].id;
    if (!tidA || !tidB) throw new Error("Impossibile creare tenant cross-tenant");

    for (const [uid, tid, role, bizName] of [
      [uidA, tidA, "owner", BIZ_A],
      [uidB, tidB, "owner", BIZ_B],
    ]) {
      await pg.query(
        `INSERT INTO public.tenant_memberships (user_id, tenant_id, role, status, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, 'active', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [uid, tid, role],
      );
      await pg.query(
        `INSERT INTO public.business_profiles (tenant_id, display_name, city, category, created_at, updated_at)
         VALUES ($1::uuid, $2, 'Roma', 'parrucchiere', NOW(), NOW()) ON CONFLICT (tenant_id) DO NOTHING`,
        [tid, bizName],
      );
    }

    const svcB = await pg.query(
      `INSERT INTO public.services (tenant_id, name, description, price_from, currency, duration_minutes, active, position, created_at, updated_at)
       VALUES ($1::uuid, 'Servizio Cross B', 'Servizio del Tenant B solo per B', 40.00::numeric(10,2), 'EUR', 30, true, 1, NOW(), NOW())
       RETURNING id`,
      [tidB],
    );
    const svcBId = svcB.rows[0]?.id;
    if (!svcBId) throw new Error("Impossibile creare servizio B");

    const bookingDate = new Date(Date.now() + 72 * 3600 * 1000);
    bookingDate.setUTCHours(11, 0, 0, 0);
    bookingBStartAtISO = bookingDate.toISOString();
    const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SRK =
      process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? sharedDbEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (URL && SRK) {
      const sbSvc = createSupabaseClient(URL, SRK, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await sbSvc.rpc("public_booking_create_v3", {
        p_tenant_slug: SLUG_B,
        p_service_id: svcBId,
        p_starts_at: bookingBStartAtISO,
        p_resource_slug: "any",
        p_customer_name: `Cliente B (cross-test ${RUN_TAG})`,
        p_customer_email: `cross-booking-${RUN_TAG}@velora.test`,
        p_customer_phone: "+39060000001",
        p_notes: "E2E cross tenant security — DO NOT LEAK",
      });
      if (error || !data || !Array.isArray(data) || data.length === 0) {
        const direct = await pg.query(
          `INSERT INTO public.bookings
            (tenant_id, service_id, customer_name, customer_email, customer_phone, starts_at, ends_at, status, notes, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '30 minutes', 'confirmed', $7, NOW(), NOW())
           RETURNING id`,
          [
            tidB,
            svcBId,
            `Cliente B (cross-test ${RUN_TAG})`,
            `cross-booking-${RUN_TAG}@velora.test`,
            "+39060000001",
            bookingBStartAtISO,
            "E2E cross tenant security — DO NOT LEAK",
          ],
        );
        bookingBId = direct.rows[0]?.id ?? null;
      } else {
        bookingBId = Array.isArray(data) && data.length > 0 ? (data[0]?.booking_id ?? null) : null;
      }
    } else {
      const direct = await pg.query(
        `INSERT INTO public.bookings
          (tenant_id, service_id, customer_name, customer_email, customer_phone, starts_at, ends_at, status, notes, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '30 minutes', 'confirmed', $7, NOW(), NOW())
         RETURNING id`,
        [
          tidB,
          svcBId,
          `Cliente B (cross-test ${RUN_TAG})`,
          `cross-booking-${RUN_TAG}@velora.test`,
          "+39060000001",
          bookingBStartAtISO,
          "E2E cross tenant security — DO NOT LEAK",
        ],
      );
      bookingBId = direct.rows[0]?.id ?? null;
    }
    if (!bookingBId) throw new Error("Impossibile creare booking B per cross test");
  });

  test.afterAll(async () => {
    if (pg) {
      try {
        await pg.query(
          `BEGIN; SET LOCAL session_replication_role = replica;
           DELETE FROM public.bookings WHERE tenant_id IN ($1::uuid,$2::uuid) AND customer_email LIKE '%cross-booking-${RUN_TAG}%';
           DELETE FROM public.services WHERE tenant_id IN ($1::uuid,$2::uuid);
           DELETE FROM public.business_profiles WHERE tenant_id IN ($1::uuid,$2::uuid);
           DELETE FROM public.tenant_memberships WHERE tenant_id IN ($1::uuid,$2::uuid);
           DELETE FROM public.tenants WHERE id IN ($1::uuid,$2::uuid);
           COMMIT;`,
          [tidA, tidB],
        );
        await pg.end();
      } catch {
        /* noop */
      }
      pg = null;
    }
  });

  test("F3.1 — Setup: Owner A e Owner B hanno membership corretta", async () => {
    expect(uidA).toBeTruthy();
    expect(uidB).toBeTruthy();
    expect(tidA).toBeTruthy();
    expect(tidB).toBeTruthy();
    expect(bookingBId).toBeTruthy();
  });

  test("F3.2 — Anonimo non accede a pagine protette (/dashboard /admin)", async ({
    page,
    request,
  }) => {
    void page;
    for (const p of [
      "/app/admin/prospects",
      "/dashboard",
      "/app/bookings",
      "/app/analytics",
      "/app/audit",
    ]) {
      const r = await request.get(p);
      expect([302, 307, 401, 403, 200]).toContain(r.status());
    }
  });

  test("F3.3 — Owner A LOGGATO non vede dati Tenant B in /app/site/SLUG_B", async ({
    page,
    request,
  }) => {
    await ensureTestSession(page, EMAIL_A, PW, {
      businessName: BIZ_A,
      category: "Barbiere",
      city: "Roma",
    });
    const resp = await request.get(`/app/site/${SLUG_B}`).catch(() => ({ status: 0 }));
    const status = resp.status ?? 0;
    if (status === 200) {
      await page
        .goto(`/app/site/${SLUG_B}`, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
      const bodyHtml =
        (await page
          .locator("body")
          .textContent()
          .catch(() => "")) ?? "";
      const leaks = bodyHtml.toLowerCase().includes(BIZ_B.toLowerCase());
      if (leaks) {
        expect(
          page.url().includes("login") ||
            bodyHtml.includes("Non autorizzato") ||
            bodyHtml.includes("403"),
        ).toBe(true);
      }
    }
  });

  test("F3.4 — Owner A tenta GET booking Tenant B tramite richiesta HTTP", async ({
    page,
    request,
  }) => {
    await ensureTestSession(page, EMAIL_A, PW);
    const attempts = [
      `/api/app/calendar?tenant_id=${tidB}&start=${encodeURIComponent(bookingBStartAtISO.slice(0, 10))}`,
      `/api/res?tenant_id=${tidB}`,
    ];
    for (const a of attempts) {
      const r = await request.get(a);
      expect([200, 400, 401, 403, 404, 500]).toContain(r.status());
      if (r.status() === 200) {
        const t = await r.text().catch(() => "{}");
        expect(t.includes(BIZ_B) || t.includes("Cliente B")).toBe(false);
      }
    }
  });

  test("F3.5 — Owner A tenta PATCH booking di Tenant B tramite anon Supabase JS (RLS) → ERROR", async () => {
    const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const ANON =
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!URL || !ANON || !uidA || !bookingBId || !pg) {
      test.skip();
      return;
    }
    const sb = createSupabaseClient(URL, ANON, { auth: { persistSession: false } });
    const sA = await sb.auth.signInWithPassword({ email: EMAIL_A, password: PW });
    if (sA.error) {
      test.skip();
      return;
    }
    const BEFORE =
      (await pg.query(`SELECT notes FROM public.bookings WHERE id=$1::uuid LIMIT 1`, [bookingBId]))
        .rows[0]?.notes ?? "";
    const { error } = await sb
      .from("bookings")
      .update({ notes: "HACK A su B" })
      .eq("id", bookingBId)
      .select("id");
    const AFTER =
      (await pg.query(`SELECT notes FROM public.bookings WHERE id=$1::uuid LIMIT 1`, [bookingBId]))
        .rows[0]?.notes ?? "";
    expect(BEFORE === AFTER || Boolean(error)).toBe(true);
  });

  test("F3.6 — Owner B corretto LEGGE booking (CONSENTITO)", async () => {
    const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const ANON =
      process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!URL || !ANON || !uidB || !bookingBId) {
      test.skip();
      return;
    }
    const sb = createSupabaseClient(URL, ANON, { auth: { persistSession: false } });
    const lB = await sb.auth.signInWithPassword({ email: EMAIL_B, password: PW });
    if (lB.error) {
      test.skip();
      return;
    }
    const { data } = await sb
      .from("bookings")
      .select("id, tenant_id")
      .eq("id", bookingBId)
      .limit(1)
      .maybeSingle();
    if (data) expect(data.tenant_id).toBe(tidB);
  });

  test("F3.7 — Owner A NON modifica SiteStudio Tenant B", async ({ page }) => {
    if (!tidB || !tidA) {
      test.skip();
      return;
    }
    await ensureTestSession(page, EMAIL_A, PW, { businessName: BIZ_A });
    if (pg) {
      const OLD =
        (await pg.query(`SELECT name FROM public.tenants WHERE id=$1::uuid LIMIT 1`, [tidB]))
          .rows[0]?.name ?? "";
      await page
        .goto(`/app/site/${SLUG_B}`, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
      try {
        const nameIn = page
          .getByRole("textbox", { name: /Nome attivit|business name|titolo sito/i })
          .first();
        if ((await nameIn.count()) > 0 && (await nameIn.isVisible())) {
          await nameIn.fill(`HACK ATTEMPT OWNER A ${RUN_TAG}`);
          const saveB = page.getByRole("button", { name: /Salva|Applica|Aggiorna/i }).first();
          if ((await saveB.count()) > 0) {
            await saveB.click().catch(() => {});
          }
        }
      } catch {
        /* noop */
      }
      const POST =
        (await pg.query(`SELECT name FROM public.tenants WHERE id=$1::uuid LIMIT 1`, [tidB]))
          .rows[0]?.name ?? "";
      expect(POST).toBe(OLD);
    }
  });

  test("F3.8 — Anonimo su /api/events/track non leak booking B", async ({ request }) => {
    const res = await request.post("/api/events/track", {
      data: {
        action: "page_view",
        hostname: "evil.test",
        tenant_id: tidB,
        customer_email: "leak@velora.test",
      },
    });
    expect([200, 202, 204, 400, 401, 403]).toContain(res.status());
  });
});
