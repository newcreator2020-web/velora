import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Client as PgClient } from "pg";

const ALLOWED_DB_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS: ReadonlySet<string> = new Set(["velora-local"]);
function failIfUnsafeEnv() {
  const host = process.env["SUPABASE_DB_HOST"] ?? "";
  const project = process.env["SUPABASE_PROJECT_ID"] ?? "";
  const safe =
    (ALLOWED_DB_HOSTS.has(host) && project.length === 0) || SAFE_PROJECT_IDS.has(project);
  if (!safe) {
    console.error("[e2e-auth] unsafe DB host/project, aborting:", { host, project });
    process.exit(1);
  }
}
failIfUnsafeEnv();

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
function buildPgConnOpts() {
  return {
    host: dbEnv("SUPABASE_DB_HOST"),
    port: Number(dbEnv("SUPABASE_DB_PORT") || "54322"),
    database: dbEnv("SUPABASE_DB_NAME"),
    user: dbEnv("SUPABASE_DB_USER"),
    password: dbEnv("SUPABASE_DB_PASSWORD"),
  };
}

function newUserEmail(tag: string): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `e2e-${tag}-${r}@velora.test`;
}

const TEST_PW = "VeloraE2E!Pass123";

async function provisionConfirmedUser(
  email: string,
  password: string,
  opts?: { displayName?: string },
): Promise<{ id: string }> {
  const client = new PgClient(buildPgConnOpts());
  try {
    await client.connect();
    const displayName = opts?.displayName ?? `E2E ${email.split("@")[0]}`;

    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM auth.users WHERE lower(email::text) = lower($1::text) LIMIT 1",
      [email],
    );
    let uid: string;
    if (existing.rows[0]) {
      uid = existing.rows[0].id;
      await client.query(
        "UPDATE auth.users SET encrypted_password = public.crypt($1::text, public.gen_salt('bf')), email_confirmed_at = NOW(), banned_until = NULL WHERE id = $2::uuid",
        [password, uid],
      );
    } else {
      const idR = await client.query<{ id: string }>(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, banned_until, deleted_at, is_sso_user, is_anonymous)
         VALUES (
           gen_random_uuid(),
           '00000000-0000-0000-0000-000000000000'::uuid,
           'authenticated',
           'authenticated',
           $1::text,
           public.crypt($2::text, public.gen_salt('bf')),
           NOW(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
           '{"provider":"email","providers":["email"]}'::jsonb,
           $3::jsonb,
           NULL, NOW(), NOW(), NULL, NULL, '', '', NULL, NULL, NULL, false, false
         )
         RETURNING id`,
        [email, password, JSON.stringify({ display_name: displayName })],
      );
      uid = idR.rows[0]!.id;
    }
    await client.query(
      `INSERT INTO public.profiles (id, display_name, avatar_url)
       VALUES ($1::uuid, $2::text, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [uid, displayName],
    );
    await client.query("COMMIT");
    return { id: uid };
  } finally {
    await client.end().catch(() => {});
  }
}

test.describe("FASE 2 — Auth + Onboarding E2E", () => {
  test("E2E 1 — anon: /dashboard redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  });

  test("E2E 7 — wrong password: generic error message, no session", async ({ page }) => {
    const email = newUserEmail("badpw");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("WRONG-PASSWORD-1234");
    await page.getByRole("button", { name: /accedi/i }).click();

    const error = page.locator('[role="alert"][aria-live="polite"]').first();
    await expect(error).toBeVisible({ timeout: 15_000 });
    const text = (await error.textContent()) ?? "";
    expect(text.length).toBeGreaterThan(0);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  });

  test("E2E 3 — login no-tenant redirects to /onboarding", async ({ page }) => {
    const email = newUserEmail("nontenant");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
  });

  test("E2E 4,5,6 — onboarding -> dashboard, after refresh still shows real data", async ({
    page,
  }) => {
    const email = newUserEmail("onboard");
    await provisionConfirmedUser(email, TEST_PW);

    // Login
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    const BUSINESS = `E2E Bellezza ${Math.random().toString(36).slice(2, 6)}`;
    const CATEGORY = "Centro Estetica";
    const CITY = "Bologna";
    const PROV = "BO";

    await page.getByLabel("Nome attività").fill(BUSINESS);
    await page.getByLabel("Categoria").fill(CATEGORY);
    await page.getByLabel("Città").fill(CITY);
    await page.getByLabel("Provincia").fill(PROV);
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");

    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    const body = page.locator("body");
    await expect(body).toContainText(BUSINESS, { timeout: 15_000 });
    await expect(body).toContainText(CATEGORY);
    await expect(body).toContainText(CITY);
    await expect(body).toContainText("owner");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(body).toContainText(BUSINESS, { timeout: 15_000 });
  });

  test("E2E 7bis — logout clears session, dashboard not accessible", async ({ page }) => {
    const email = newUserEmail("logout");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill("Logout Test SRL");
    await page.getByLabel("Categoria").fill("Barbiere");
    await page.getByLabel("Città").fill("Verona");
    await page.getByLabel("Provincia").fill("VR");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    await page
      .getByRole("button", { name: /logout|esci/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  });

  test("E2E 8 — cross-tenant: user B dashboard shows OWN data not user A", async ({ page }) => {
    const emailA = newUserEmail("crossA");
    const A_BIZ = `A-Shop ${Math.random().toString(36).slice(2, 6)}`;
    await provisionConfirmedUser(emailA, TEST_PW, { displayName: "Utente A" });

    await page.goto("/login");
    await page.getByLabel("Email").fill(emailA);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill(A_BIZ);
    await page.getByLabel("Categoria").fill("Ristorante");
    await page.getByLabel("Città").fill("Milano");
    await page.getByLabel("Provincia").fill("MI");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });
    await expect(page.locator("body")).toContainText(A_BIZ, { timeout: 15_000 });

    await page
      .getByRole("button", { name: /logout|esci/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    const emailB = newUserEmail("crossB");
    const B_BIZ = `B-Office ${Math.random().toString(36).slice(2, 6)}`;
    await provisionConfirmedUser(emailB, TEST_PW, { displayName: "Utente B" });

    await page.getByLabel("Email").fill(emailB);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill(B_BIZ);
    await page.getByLabel("Categoria").fill("CoWorking");
    await page.getByLabel("Città").fill("Firenze");
    await page.getByLabel("Provincia").fill("FI");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    const body = page.locator("body");
    await expect(body).toContainText(B_BIZ, { timeout: 15_000 });
    const hasAData = await body.evaluate(
      (el: HTMLElement, bizName: string) => el.textContent?.includes(bizName) ?? false,
      A_BIZ,
    );
    expect(hasAData).toBe(false);
  });
});
