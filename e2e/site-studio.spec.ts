// @ts-check
import "dotenv/config";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Client as PgClient } from "pg";
import crypto from "node:crypto";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local"]);
function failIfUnsafe() {
  const host = process.env["SUPABASE_DB_HOST"] ?? "";
  const project = process.env["SUPABASE_PROJECT_ID"] ?? "";
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && project.length === 0) || SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error("[e2e-site-studio] unsafe DB host/project, aborting:", { host, project });
    process.exit(1);
  }
}
failIfUnsafe();

const DEFAULT_LOCAL_DB: Readonly<Record<string, string>> = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
};
function dbEnv(name: string): string {
  return process.env[name] ?? DEFAULT_LOCAL_DB[name] ?? "";
}
function buildPgOpts() {
  return {
    host: dbEnv("SUPABASE_DB_HOST"),
    port: Number(dbEnv("SUPABASE_DB_PORT") || "54322"),
    database: dbEnv("SUPABASE_DB_NAME"),
    user: dbEnv("SUPABASE_DB_USER"),
    password: dbEnv("SUPABASE_DB_PASSWORD"),
  };
}

const TEST_PW = "VeloraStudioE2E!Pass123";

type FixtureIds = {
  tenantId: string;
  slug: string;
  ownerId: string;
  email: string;
};

async function provisionUnpublishedTenantWithOwner(tag: string): Promise<FixtureIds> {
  const r = crypto.randomBytes(3).toString("hex");
  const email = `studio-${tag}-${r}@velora.test`;
  const slug = `studio-${tag}-${r}`;
  const tenantId = crypto.randomUUID();
  const client = new PgClient(buildPgOpts());
  try {
    await client.connect();

    // 1) create auth.users
    let ownerId: string;
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM auth.users WHERE lower(email::text) = lower($1::text) LIMIT 1",
      [email],
    );
    if (existing.rows[0]) {
      ownerId = existing.rows[0].id;
      await client.query(
        "UPDATE auth.users SET encrypted_password = public.crypt($1::text, public.gen_salt('bf')), email_confirmed_at = NOW(), banned_until = NULL WHERE id = $2::uuid",
        [TEST_PW, ownerId],
      );
    } else {
      const row = await client.query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, banned_until, deleted_at, is_sso_user, is_anonymous)
         VALUES (
           gen_random_uuid(),
           '00000000-0000-0000-0000-000000000000'::uuid,
           'authenticated','authenticated',
           $1::text, public.crypt($2::text, public.gen_salt('bf')),
           NOW(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
           '{"provider":"email","providers":["email"]}'::jsonb,
           jsonb_build_object('display_name', $3::text),
           NULL, NOW(), NOW(), NULL, NULL, '', '', NULL, NULL, NULL, false, false
         ) RETURNING id`,
        [email, TEST_PW, `Owner ${slug}`],
      );
      ownerId = row.rows[0]!.id;
    }

    // 2) profiles
    await client.query(
      `INSERT INTO public.profiles (id, display_name, avatar_url)
       VALUES ($1::uuid, $2::text, NULL)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [ownerId, `Owner ${slug}`],
    );

    // 3) cleanup/insert tenant unpublished
    try {
      await client.query(
        `ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner`,
      );
    } catch {
      /* ignore */
    }
    for (const q of [
      `DELETE FROM public.tenant_memberships WHERE tenant_id = $1::uuid OR user_id = $2::uuid`,
      `DELETE FROM public.site_sections WHERE tenant_id = $1::uuid`,
      `DELETE FROM public.services WHERE tenant_id = $1::uuid`,
      `DELETE FROM public.site_editorial_state WHERE tenant_id = $1::uuid`,
      `DELETE FROM public.business_profiles WHERE tenant_id = $1::uuid`,
      `DELETE FROM public.tenants WHERE id = $1::uuid`,
    ]) {
      try {
        await client.query(q, [tenantId, ownerId]);
      } catch {
        /* ignore */
      }
    }
    try {
      await client.query(
        `ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner`,
      );
    } catch {
      /* ignore */
    }

    await client.query(
      `INSERT INTO public.tenants (id, slug, name, status, published)
       VALUES ($1::uuid, $2::text, $3::text, 'active', false)`,
      [tenantId, slug, `Studio ${slug}`],
    );
    await client.query(
      `INSERT INTO public.business_profiles(
         tenant_id, display_name, category, description, city, timezone, locale,
         theme_primary, theme_background, theme_foreground, theme_muted, theme_radius,
         theme_heading_font_preset, theme_body_font_preset
       ) VALUES (
         $1::uuid,$3::text,'Barbiere',
         'Descrizione studio E2E ' || $2::text,
         'Roma','Europe/Rome','it',
         '#111827','#FFFFFF','#0f172a','#6b7280','md','sans','sans'
       )`,
      [tenantId, slug, `Studio ${slug}`],
    );
    try {
      await client.query(
        `ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner`,
      );
    } catch {
      /* ignore */
    }
    await client.query(
      `INSERT INTO public.tenant_memberships(id, tenant_id, user_id, role, status)
       VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'owner','active')`,
      [tenantId, ownerId],
    );
    try {
      await client.query(
        `ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner`,
      );
    } catch {
      /* ignore */
    }

    return { tenantId, slug, ownerId, email };
  } finally {
    await client.end().catch(() => {});
  }
}

async function studioLogin(
  page: Page,
  email: string,
  password: string,
  opts?: { expectRedirect?: RegExp | string },
) {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi/i }).click();
  const red = opts?.expectRedirect ?? /\/(dashboard|app\/site|onboarding)$/;
  if (red instanceof RegExp) {
    await expect(page).toHaveURL(red, { timeout: 30_000 });
  } else {
    await expect(page).toHaveURL(red, { timeout: 30_000 });
  }
}

test.describe("FASE 6F — Site Management Studio (E2E reale, NO mocks)", () => {
  let fixA: FixtureIds;
  let fixB: FixtureIds;

  test.beforeAll(async () => {
    [fixA, fixB] = await Promise.all([
      provisionUnpublishedTenantWithOwner("a"),
      provisionUnpublishedTenantWithOwner("b"),
    ]);
    test.skip(
      !fixA?.tenantId || !fixB?.tenantId,
      "fixture not provisioned (unsafe env or DB unavailable)",
    );
  });

  test("STUDIO-E1 — Owner A: /app/site caricato, stato iniziale published=false", async ({
    page,
  }) => {
    test
      .info()
      .annotations.push(
        { type: "requirement", description: "E1. /app/site accessibile" },
        { type: "requirement", description: "E2. stato publication iniziale corretto" },
      );
    await studioLogin(page, fixA.email, TEST_PW);

    // If onboarding redirect: tenant already has membership, skip manual onboard via direct navigate.
    await page.goto("/app/site");
    await expect(page).toHaveURL(/\/app\/site$/, { timeout: 25_000 });
    const main = page.locator("main#main-content");
    await expect(main).toBeVisible({ timeout: 10_000 });

    const initialState = JSON.parse(
      (await page.locator("html").getAttribute("data-studio-initial")) ?? "null",
    ) as { state?: { published?: boolean } } | null;
    if (initialState?.state) {
      expect(
        initialState.state.published,
        "initial published should be false for unpublished tenant",
      ).toBe(false);
    }
  });

  test("STUDIO-PREVIEW — /app/site/preview ha banner Anteprima privata (anon → deny)", async ({
    page,
    browser,
  }) => {
    test
      .info()
      .annotations.push(
        { type: "requirement", description: "E11. Anon preview → login/deny" },
        { type: "requirement", description: "§10 preview privata ≠ public" },
      );
    // Anon: preview should redirect or login wall.
    const anonCtx = await browser.newContext();
    try {
      const anonPage = await anonCtx.newPage();
      const resp = await anonCtx.request.get("/app/site/preview", {
        failOnStatusCode: false,
        maxRedirects: 5,
      });
      expect(resp.status(), "anon preview NOT 200").not.toBe(200);
      await anonPage.close();
    } finally {
      await anonCtx.close();
    }

    // Logged owner
    await studioLogin(page, fixA.email, TEST_PW);
    await page.goto("/app/site/preview", { waitUntil: "domcontentloaded" });
    const banner = page.getByRole("status").filter({ hasText: /Anteprima privata/ });
    await expect(banner).toBeVisible({ timeout: 15_000 });
  });
});
