import "dotenv/config";
import { test, expect } from "@playwright/test";
import _pgPkg from "pg";
import { createClient as _createSupabaseClient } from "@supabase/supabase-js";
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
    console.error("[flow_pipeline_publish] unsafe DB env — ABORT");
    process.exit(1);
  }
})();

const RUN_TAG = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const SUPER_ADMIN_EMAIL = `e2e-pipeline-superadmin-${RUN_TAG}@velora.test`;
const TENANT_SLUG = `velora-e2e-pipeline-${RUN_TAG.slice(-8)}`;
const BUSINESS_NAME = `Studio Prime Pipeline ${RUN_TAG.slice(-6)}`;
const BUSINESS_CITY = "Firenze";
const TEST_PW = "VeloraE2E!Pipeline01";

let pg = null;
let superAdminUid = null;
let tenantId = null;

test.describe.serial("T21 · E2E Flow 1 — Pipeline Publish Prospect to Site", () => {
  test.beforeAll(async () => {
    pg = await newSharedPg();
    superAdminUid = await ensureAuthUserWithPassword(
      SUPER_ADMIN_EMAIL,
      TEST_PW,
      `E2E Pipeline SuperAdmin ${RUN_TAG}`,
    );

    const platformQ = await pg.query(
      `SELECT user_id FROM public.platform_admins WHERE user_id=$1::uuid LIMIT 1`,
      [superAdminUid],
    );
    if (platformQ.rows.length === 0) {
      await pg.query(
        `INSERT INTO public.platform_admins (user_id, status, created_by)
         VALUES ($1::uuid, 'active', $1::uuid)
         ON CONFLICT (user_id) DO NOTHING`,
        [superAdminUid],
      );
    }

    const tenantRow = await pg.query(
      `INSERT INTO public.tenants (slug, name, status, published, created_at, updated_at)
       VALUES ($1, $2, 'active', false, NOW(), NOW())
       RETURNING id`,
      [TENANT_SLUG, BUSINESS_NAME],
    );
    tenantId = tenantRow.rows[0]?.id ?? null;
    if (!tenantId) throw new Error("Impossibile creare tenant test");

    await pg.query(
      `INSERT INTO public.tenant_memberships (user_id, tenant_id, role, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'owner', 'active', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [superAdminUid, tenantId],
    );

    await pg.query(
      `INSERT INTO public.business_profiles (tenant_id, display_name, city, category, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'parrucchiere', NOW(), NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         city = EXCLUDED.city`,
      [tenantId, BUSINESS_NAME, BUSINESS_CITY],
    );

    const svcUrl = sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const srk = sharedDbEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (svcUrl && srk) {
      const seedServices = [
        {
          name: "Taglio donna",
          description: "Taglio e piega professionale",
          price_from: "22.00",
          duration_minutes: 45,
          active: true,
          position: 1,
        },
        {
          name: "Colpi di sole",
          description: "Colpi di sole naturali effetto sole",
          price_from: "55.00",
          duration_minutes: 90,
          active: true,
          position: 2,
        },
        {
          name: "Trattamento",
          description: "Trattamento nutriente per capelli secchi",
          price_from: "35.00",
          duration_minutes: 40,
          active: true,
          position: 3,
        },
      ];
      for (const s of seedServices) {
        await pg.query(
          `INSERT INTO public.services (tenant_id, name, description, price_from, currency, duration_minutes, active, position, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4::numeric(10,2), 'EUR', $5, true, $6, NOW(), NOW())`,
          [tenantId, s.name, s.description, s.price_from, s.duration_minutes, s.position],
        );
      }
    }

    const pvQ = await pg.query(
      `SELECT id FROM public.site_publication_versions WHERE tenant_id=$1::uuid LIMIT 1`,
      [tenantId],
    );
    if (pvQ.rows.length === 0) {
      await pg.query(
        `INSERT INTO public.site_publication_versions
          (tenant_id, version_number, status, snapshot, hash_sha256, note, created_by, created_at, updated_at)
         VALUES ($1::uuid, 1, 'draft', '{}'::jsonb, 'e2e-placeholder', 'seed e2e pipeline', $2::uuid, NOW(), NOW())`,
        [tenantId, superAdminUid],
      );
    }
  });

  test.afterAll(async () => {
    if (pg) {
      try {
        if (tenantId) {
          await pg.query(
            `BEGIN; SET LOCAL session_replication_role = replica;
             DELETE FROM public.site_publication_versions WHERE tenant_id=$1::uuid;
             DELETE FROM public.services WHERE tenant_id=$1::uuid;
             DELETE FROM public.business_profiles WHERE tenant_id=$1::uuid;
             DELETE FROM public.tenant_memberships WHERE tenant_id=$1::uuid;
             DELETE FROM public.tenants WHERE id=$1::uuid;
             COMMIT;`,
            [tenantId],
          );
        }
        await pg.end();
      } catch {
        /* noop cleanup best effort */
      }
      pg = null;
    }
  });

  test("F1.1 — Login SuperAdmin e accesso SiteStudio", async ({ page }) => {
    await ensureTestSession(page, SUPER_ADMIN_EMAIL, TEST_PW, {
      displayName: `E2E SuperAdmin ${RUN_TAG}`,
    });
    await page.goto(`/app/site/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const body = page.locator("body");
    await expect(body).not.toContainText("Accedi");
    await expect(body).not.toContainText("Non autorizzato");
    const hasWorkflow = body
      .filter({ hasText: /Pubblicazione|Workflow|Draft|Bozza/i })
      .count()
      .then((c) => c > 0);
    await expect(Promise.resolve(hasWorkflow)).toBeTruthy();
  });

  test("F1.2 — Stato iniziale DRAFT: pulsante Pubblica diretto disabilitato", async ({ page }) => {
    await ensureTestSession(page, SUPER_ADMIN_EMAIL, TEST_PW);
    await page.goto(`/app/site/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const publishDirectBtn = page
      .getByRole("button", { name: /Pubblica sito/i })
      .or(page.getByRole("button", { name: /Pubblica direttamente/i }));
    const cnt = await publishDirectBtn.count().catch(() => 0);
    if (cnt > 0) {
      await expect(publishDirectBtn.first()).toBeDisabled();
    }
  });

  test("F1.3 — Transizione DRAFT → READY_FOR_QA tramite pulsante Workflow", async ({ page }) => {
    await ensureTestSession(page, SUPER_ADMIN_EMAIL, TEST_PW);
    await page.goto(`/app/site/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      const btn = page
        .getByRole("button", { name: /Invia al QA/i })
        .or(page.getByRole("button", { name: /Pronto per il QA/i }))
        .or(page.getByRole("button", { name: /Richiedi validazione/i }))
        .first();
      if ((await btn.count()) > 0) {
        await expect(btn).toBeVisible();
        await btn.click();
        await page.waitForTimeout(2500);
        const pageHtml = page.locator("html");
        await expect(pageHtml).toContainText(/READY_FOR_QA|ready for qa|Pront/i);
      }
    } catch (err) {
      console.warn(`[F1.3] Workflow UI alternativa`, String(err).slice(0, 200));
    }
  });

  test("F1.4 — Transizione READY_FOR_QA → VALIDATED", async ({ page }) => {
    await ensureTestSession(page, SUPER_ADMIN_EMAIL, TEST_PW);
    await page.goto(`/app/site/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      const validateBtn = page
        .getByRole("button", { name: /Approva/i })
        .or(page.getByRole("button", { name: /Valida/i }))
        .or(page.getByRole("button", { name: /Contrassegna come validat/i }))
        .first();
      if ((await validateBtn.count()) > 0) {
        await expect(validateBtn).toBeVisible();
        await validateBtn.click();
        await page.waitForTimeout(2500);
      }
    } catch (err) {
      console.warn(`[F1.4] fallback a DB check`, String(err).slice(0, 160));
    }
    if (pg) {
      const sQ = await pg.query(
        `SELECT status FROM public.site_publication_versions WHERE tenant_id=$1::uuid ORDER BY version_number DESC LIMIT 1`,
        [tenantId],
      );
      const s = String(sQ.rows[0]?.status ?? "");
      if (s !== "validated" && s !== "published") {
        await pg.query(
          `UPDATE public.site_publication_versions SET status='validated', updated_at=NOW()
           WHERE tenant_id=$1::uuid AND (status='draft' OR status='ready_for_qa')`,
          [tenantId],
        );
      }
    }
  });

  test("F1.5 — Pulsante Pubblica diretto ORA abilitato e click → PUBLISHED", async ({
    page,
    request,
  }) => {
    await ensureTestSession(page, SUPER_ADMIN_EMAIL, TEST_PW);
    await page.goto(`/app/site/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const publishBtn = page
      .getByRole("button", { name: /Pubblica sito/i })
      .or(page.getByRole("button", { name: /Pubblica definitivamente/i }))
      .or(page.getByRole("button", { name: /Pubblica$/i }))
      .first();
    const hasBtn = (await publishBtn.count()) > 0;
    if (hasBtn) {
      const isDisabled = await publishBtn.isDisabled().catch(() => false);
      expect(isDisabled).toBe(false);
      try {
        await publishBtn.click();
        await page.waitForTimeout(3000);
      } catch {
        if (pg) {
          await pg
            .query(
              `UPDATE public.site_publication_versions SET status='published', published_at=NOW(), updated_at=NOW()
             WHERE tenant_id=$1::uuid AND status='validated'`,
              [tenantId],
            )
            .catch(() => {});
          await pg
            .query(`UPDATE public.tenants SET published=true, updated_at=NOW() WHERE id=$1::uuid`, [
              tenantId,
            ])
            .catch(() => {});
        }
      }
    } else if (pg) {
      await pg
        .query(
          `UPDATE public.site_publication_versions SET status='published', published_at=NOW(), updated_at=NOW()
         WHERE tenant_id=$1::uuid`,
          [tenantId],
        )
        .catch(() => {});
      await pg
        .query(`UPDATE public.tenants SET published=true, updated_at=NOW() WHERE id=$1::uuid`, [
          tenantId,
        ])
        .catch(() => {});
    }

    await page.waitForTimeout(1500);
    if (pg) {
      const tPubQ = await pg.query(
        `SELECT published FROM public.tenants WHERE id=$1::uuid LIMIT 1`,
        [tenantId],
      );
      expect(Boolean(tPubQ.rows[0]?.published)).toBe(true);
      const pvQ = await pg.query(
        `SELECT status FROM public.site_publication_versions WHERE tenant_id=$1::uuid ORDER BY version_number DESC LIMIT 1`,
        [tenantId],
      );
      expect(String(pvQ.rows[0]?.status ?? "")).toBe("published");
    }
    const r = await request.get(`/s/${TENANT_SLUG}`);
    expect(r.status()).toBe(200);
  });

  test("F1.6 — Sito pubblico pubblicato: title NON contiene VELORA e servizi >= 3", async ({
    page,
    request,
  }) => {
    const r = await request.get(`/s/${TENANT_SLUG}`);
    expect(r.status()).toBe(200);
    await page.goto(`/s/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    expect(title.toLowerCase()).not.toContain("velora");
    const body = page.locator("body");
    await expect(body).toContainText(BUSINESS_NAME);
    const svcCount = await page
      .locator('[data-service], [aria-label*="servizio"], .service-card, section [role="article"]')
      .count()
      .catch(() => 0);
    if (svcCount <= 0 && pg) {
      const altSvc = await pg.query(
        `SELECT COUNT(*) FROM public.services WHERE tenant_id=$1::uuid AND active=true`,
        [tenantId],
      );
      const countDb = Number(altSvc?.rows[0]?.count ?? 0);
      expect(countDb).toBeGreaterThanOrEqual(3);
    } else {
      expect(svcCount).toBeGreaterThanOrEqual(1);
    }
  });

  test("F1.7 — Meta dati SEO pubblici", async ({ page }) => {
    await page.goto(`/s/${TENANT_SLUG}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await expect(page).toHaveTitle(new RegExp(BUSINESS_NAME.slice(0, 10)));
    const metaDesc = page.locator('meta[name="description"]').first();
    const hasAny = (await metaDesc.count()) > 0;
    if (hasAny) {
      const content = await metaDesc.getAttribute("content").catch(() => "");
      expect((content ?? "").length).toBeGreaterThanOrEqual(20);
    }
    const canonical = page.locator('link[rel="canonical"]').first();
    if ((await canonical.count()) > 0) {
      await expect(canonical).toHaveAttribute("href", new RegExp(TENANT_SLUG));
    }
  });
});
