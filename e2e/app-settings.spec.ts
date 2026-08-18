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
    console.error("[e2e-app] unsafe DB host/project, aborting:", { host, project });
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
  return `e2e-f3-${tag}-${r}@velora.test`;
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
    const displayName = opts?.displayName ?? `E2E F3 ${email.split("@")[0]}`;
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
           'authenticated', 'authenticated', $1::text,
           public.crypt($2::text, public.gen_salt('bf')),
           NOW(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
           '{"provider":"email","providers":["email"]}'::jsonb,
           $3::jsonb, NULL, NOW(), NOW(),
           NULL, NULL, '', '', NULL, NULL, NULL, false, false
         ) RETURNING id`,
        [email, password, JSON.stringify({ display_name: displayName })],
      );
      uid = idR.rows[0]!.id;
    }
    await client.query(
      `INSERT INTO public.profiles (id, display_name, avatar_url)
       VALUES ($1::uuid, $2::text, NULL) ON CONFLICT (id) DO NOTHING`,
      [uid, displayName],
    );
    await client.query("COMMIT");
    return { id: uid };
  } finally {
    await client.end().catch(() => {});
  }
}

test.describe("FASE 3 — App Shell + Business Settings E2E", () => {
  test("E1 — unauthenticated /app redirects to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  });

  test("E2 — authenticated incomplete onboarding redirected from /app to /onboarding", async ({
    page,
  }) => {
    const email = newUserEmail("incomplete");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.goto("/app");
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  });

  test("E3,E4 — completed account /app renders dashboard with tenant name", async ({ page }) => {
    const email = newUserEmail("dashboard");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    const BUSINESS = `F3 Dash ${Math.random().toString(36).slice(2, 6)}`;
    await page.getByLabel("Nome attività").fill(BUSINESS);
    await page.getByLabel("Categoria").fill("Barbiere");
    await page.getByLabel("Città").fill("Roma");
    await page.getByLabel("Provincia").fill("RM");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    const body = page.locator("body");
    await expect(body).toContainText(BUSINESS, { timeout: 15_000 });
    await expect(body).toContainText(/owner|manager/i);
  });

  test("E5,E6,E7,E8 — navigate settings, invalid form validation, valid update persists after reload", async ({
    page,
  }) => {
    const email = newUserEmail("settings");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    const BUSINESS = `F3 Settings ${Math.random().toString(36).slice(2, 6)}`;
    await page.getByLabel("Nome attività").fill(BUSINESS);
    await page.getByLabel("Categoria").fill("Parrucchiere");
    await page.getByLabel("Città").fill("Milano");
    await page.getByLabel("Provincia").fill("MI");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    await page.goto("/app/settings");
    await expect(page).toHaveURL(/\/app\/settings$/, { timeout: 20_000 });

    await page.getByLabel("Nome attività").fill("A");
    await page.getByLabel("Email attività").fill("non_email");
    await page.getByRole("button", { name: /salva|salva modifiche|applica/i }).click();
    const errEl = page.locator('input[name="business_name"]').first();
    await expect(errEl).toHaveAttribute("aria-invalid", "true", { timeout: 15_000 });

    const NEW_BIZ = `F3 Updated ${Math.random().toString(36).slice(2, 6)}`;
    await page.getByLabel("Nome attività").fill(NEW_BIZ);
    await page.getByLabel("Email attività").fill("");
    await page.getByLabel("Telefono").fill("+39 06 1234567");
    await page.getByLabel("Indirizzo").fill("Via Nazionale 1");
    await page.getByLabel("Città").fill("Roma");
    await page.getByLabel("Provincia").fill("RM");
    await page.getByLabel("CAP").fill("00100");
    await page.getByLabel("Descrizione attività").fill("Descrizione test E2E FASE3.");
    await page.getByRole("button", { name: /salva|salva modifiche|applica/i }).click();

    await page.waitForTimeout(600);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(NEW_BIZ, { timeout: 15_000 });
  });

  test("E9 — logout: protected route becomes inaccessible", async ({ page, context }) => {
    const email = newUserEmail("logoutf3");
    await provisionConfirmedUser(email, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill("Logout F3 SRL");
    await page.getByLabel("Categoria").fill("Bar");
    await page.getByLabel("Città").fill("Torino");
    await page.getByLabel("Provincia").fill("TO");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    await page.goto("/app");
    const body = page.locator("body");
    await expect(body).toContainText("Logout F3 SRL", { timeout: 15_000 });

    await page
      .getByRole("button", { name: /logout|esci/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
    await context.clearCookies();
  });

  test("E10 — cross-tenant tampering: user B dashboard cannot see user A data", async ({
    page,
  }) => {
    const emailA = newUserEmail("f3a");
    const A_BIZ = `F3 A-Saloon ${Math.random().toString(36).slice(2, 6)}`;
    await provisionConfirmedUser(emailA, TEST_PW);

    await page.goto("/login");
    await page.getByLabel("Email").fill(emailA);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill(A_BIZ);
    await page.getByLabel("Categoria").fill("Beauty");
    await page.getByLabel("Città").fill("Venezia");
    await page.getByLabel("Provincia").fill("VE");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    await page.goto("/app/settings");
    await page.getByLabel("Telefono").fill("+39 041 0000001");
    await page.getByRole("button", { name: /salva|salva modifiche|applica/i }).click();
    await page.waitForTimeout(500);

    await page
      .getByRole("button", { name: /logout|esci/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    const emailB = newUserEmail("f3b");
    const B_BIZ = `F3 B-Shop ${Math.random().toString(36).slice(2, 6)}`;
    await provisionConfirmedUser(emailB, TEST_PW);

    await page.getByLabel("Email").fill(emailB);
    await page.getByLabel("Password").fill(TEST_PW);
    await page.getByRole("button", { name: /accedi/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });

    await page.getByLabel("Nome attività").fill(B_BIZ);
    await page.getByLabel("Categoria").fill("SPA");
    await page.getByLabel("Città").fill("Bologna");
    await page.getByLabel("Provincia").fill("BO");
    await page.getByLabel("Timezone").fill("Europe/Rome");
    await page.getByLabel("Lingua").fill("it-IT");
    await page.getByRole("button", { name: /crea la tua attività/i }).click();
    await expect(page).toHaveURL(/\/app$|\/dashboard$/, { timeout: 45_000 });

    const body = page.locator("body");
    await expect(body).toContainText(B_BIZ, { timeout: 15_000 });
    const hasA = await body.evaluate(
      (el: HTMLElement, needle: string) => el.textContent?.includes(needle) ?? false,
      A_BIZ,
    );
    expect(hasA).toBe(false);
  });
});
