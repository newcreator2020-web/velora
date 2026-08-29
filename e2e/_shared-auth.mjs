import "dotenv/config";
import pgPkg from "pg";
import { expect } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const { Client: PgClient } = pgPkg;

const ALLOWED_DB_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS = new Set(["velora-local"]);
(() => {
  const host = process.env.SUPABASE_DB_HOST ?? "";
  const pr = process.env.SUPABASE_PROJECT_ID ?? "";
  if (!((ALLOWED_DB_HOSTS.has(host) && pr.length === 0) || SAFE_PROJECT_IDS.has(pr))) {
    console.error("[shared-auth-e2e] unsafe DB env — ABORT");
    process.exit(1);
  }
})();

const DEFAULT_DB = {
  SUPABASE_DB_HOST: "127.0.0.1",
  SUPABASE_DB_PORT: "54322",
  SUPABASE_DB_NAME: "postgres",
  SUPABASE_DB_USER: "postgres",
  SUPABASE_DB_PASSWORD: "postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
};
export function sharedDbEnv(n) {
  return process.env[n] ?? DEFAULT_DB[n] ?? "";
}
export function sharedPgOpts() {
  return {
    host: sharedDbEnv("SUPABASE_DB_HOST"),
    port: Number(sharedDbEnv("SUPABASE_DB_PORT") || 54322),
    database: sharedDbEnv("SUPABASE_DB_NAME"),
    user: sharedDbEnv("SUPABASE_DB_USER"),
    password: sharedDbEnv("SUPABASE_DB_PASSWORD"),
  };
}
export async function newSharedPg() {
  const c = new PgClient(sharedPgOpts());
  await c.connect();
  return c;
}

export async function ensureAuthUserWithPassword(email, password, displayNameHint) {
  const c = await newSharedPg();
  try {
    const displayName = displayNameHint ?? `E2E ${email}`;
    const meta = { full_name: displayName, display_name: displayName };
    const email_lc = email.toLowerCase().trim();

    const SUPABASE_URL = sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SRK = sharedDbEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (SUPABASE_URL && SRK) {
      const svc = createSupabaseClient(SUPABASE_URL, SRK, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const exists = await c.query(
        `SELECT id FROM auth.users WHERE lower(email::text)=$1 LIMIT 1`,
        [email_lc],
      );
      let uid;
      if (exists.rows.length > 0) {
        uid = String(exists.rows[0].id);
        const resetRes = await svc.auth.admin.updateUserById(uid, {
          password,
          email_confirm: true,
        });
        if (resetRes.error) {
          const cr = await c.query(`SELECT public.crypt($1::text, public.gen_salt('bf')) AS pw`, [
            password,
          ]);
          await c.query(
            `UPDATE auth.users SET encrypted_password=$1::text, email_confirmed_at=COALESCE(email_confirmed_at, NOW()), updated_at=NOW() WHERE id=$2::uuid`,
            [cr.rows[0].pw, uid],
          );
        }
      } else {
        const { data, error } = await svc.auth.admin.createUser({
          email: email_lc,
          password,
          email_confirm: true,
          user_metadata: meta,
        });
        if (error) {
          const retry = await c.query(
            `SELECT id FROM auth.users WHERE lower(email::text)=$1 LIMIT 1`,
            [email_lc],
          );
          uid = retry.rows[0]?.id;
          if (!uid) throw error;
        } else {
          uid = data.user?.id;
        }
      }
      if (!uid) throw new Error(`ensureAuthUser failed for ${email_lc}`);
      await c.query(
        `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [uid, displayName],
      );
      return uid;
    }

    /* Fallback legacy SQL direct insert (service role unavailable local) */
    const cr = await c.query(`SELECT public.crypt($1::text, public.gen_salt('bf')) AS pw`, [
      password,
    ]);
    const enc_pw = cr.rows[0].pw;
    const inst_row = await c.query(`SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1`);
    const inst = inst_row.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
    const e = await c.query(`SELECT id FROM auth.users WHERE lower(email::text)=$1 LIMIT 1`, [
      email_lc,
    ]);
    let uid;
    if (e.rows.length > 0) {
      uid = String(e.rows[0].id);
      await c.query(
        `UPDATE auth.users SET encrypted_password=$1::text, email_confirmed_at=COALESCE(email_confirmed_at, NOW()), updated_at=NOW() WHERE id=$2::uuid`,
        [enc_pw, uid],
      );
    } else {
      const id_row = await c.query(`SELECT public.gen_random_uuid() AS uid`);
      uid = String(id_row.rows[0].uid);
      await c.query(
        `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, raw_user_meta_data, aud, is_super_admin, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text, NOW(), 'authenticated', $5::jsonb, 'authenticated', false, NOW(), NOW())`,
        [uid, inst, email_lc, enc_pw, meta],
      );
    }
    const idRes = await c.query(`SELECT public.gen_random_uuid() AS id`);
    const identId = idRes.rows[0].id;
    await c.query(
      `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, email, last_sign_in_at, created_at, updated_at)
       VALUES ($1::uuid, $2::text, $3::uuid, $4::jsonb, 'email', $5::text, NOW(), NOW(), NOW())
       ON CONFLICT (provider_id, provider) DO UPDATE SET identity_data=EXCLUDED.identity_data, email=EXCLUDED.email, updated_at=NOW()`,
      [identId, email_lc, uid, { sub: uid, email: email_lc, email_verified: true }, email_lc],
    );
    await c.query(
      `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [uid, displayName],
    );
    return uid;
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * After session is set, the app may redirect to /onboarding if the authenticated
 * user has no active tenant membership. This helper idempotently handles the
 * onboarding wizard (minimal deterministic data, no side effects if already done).
 * Expects the page to either be at /onboarding or already authenticated elsewhere.
 */
export async function handleOnboardingIfPresent(page, opts = {}) {
  const defaultBiz = opts.businessName ?? `Velora Test Biz ${Date.now().toString(36).slice(-5)}`;
  const defaultCat = opts.category ?? "Barbiere";
  const defaultCity = opts.city ?? "Roma";
  const defaultProv = opts.province ?? "RM";
  const defaultTz = opts.timezone ?? "Europe/Rome";
  const defaultLoc = opts.locale ?? "it-IT";
  // Production hydration is slower; give time for React to mount the form.
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
  } catch {
    void 0;
  }
  let tries = 0;
  while (tries < 8) {
    const url = page.url();
    if (!url.includes("/onboarding")) {
      return { handled: false, url };
    }
    tries++;
    try {
      const { expect: pwExpect } = await import("@playwright/test");
      const nameInput = page
        .getByRole("textbox", { name: /Nome attivit/i })
        .or(page.locator('input[placeholder*="Mario Hair Studio"]'))
        .or(page.locator('input[placeholder*="Nome attivit"]'))
        .or(page.locator('input[name="businessName"]'))
        .or(page.getByLabel(/Nome attivit/i))
        .first();
      const catInput = page
        .getByRole("textbox", { name: /Categoria/i })
        .or(page.locator('input[placeholder*="Parrucchiere"]'))
        .or(page.locator('input[placeholder*="Categoria"]'))
        .or(page.locator('input[name="category"]'))
        .or(page.getByLabel(/Categoria/i))
        .first();
      const cityInput = page
        .getByRole("textbox", { name: /Citt/i })
        .or(page.locator('input[placeholder*="Milano"]'))
        .or(page.locator('input[placeholder*="Citt"]'))
        .or(page.locator('input[name="city"]'))
        .or(page.getByLabel(/Citt/i))
        .first();
      const provInput = page
        .getByRole("textbox", { name: /Provincia/i })
        .or(page.locator('input[placeholder="MI"]'))
        .or(page.locator('input[placeholder*="Provincia"]'))
        .or(page.locator('input[name="province"]'))
        .or(page.getByLabel(/Provincia/i))
        .first();
      const tzInput = page
        .getByRole("textbox", { name: /Timezone/i })
        .or(page.locator('input[placeholder*="Europe/Rome"]'))
        .or(page.locator('input[placeholder*="Timezone"]'))
        .or(page.locator('input[name="timezone"]'))
        .or(page.getByLabel(/Timezone/i))
        .first();
      const locInput = page
        .getByRole("textbox", { name: /Lingua/i })
        .or(page.locator('input[placeholder*="it-IT"]'))
        .or(page.locator('input[placeholder*="Lingua"]'))
        .or(page.locator('input[name="locale"]'))
        .or(page.getByLabel(/Lingua/i))
        .first();
      const phoneInput = page
        .getByRole("textbox", { name: /Telefono/i })
        .or(page.locator('input[placeholder*="+39 02"]'))
        .or(page.locator('input[name="phone"]'))
        .or(page.getByLabel(/Telefono/i))
        .first();
      const bizEmailInput = page
        .getByRole("textbox", { name: /Email attivit/i })
        .or(page.locator('input[placeholder*="info@tuoattivit"]'))
        .or(page.locator('input[name="businessEmail"]'))
        .or(page.getByLabel(/Email attivit/i))
        .first();
      const submitBtn = page
        .getByRole("button", { name: /crea la tua attivit/i })
        .or(page.getByRole("button", { name: /Crea attivit/i }))
        .first();

      const anyName = await nameInput.count().catch(() => 0);
      if (anyName === 0 || !(await nameInput.isVisible().catch(() => false))) {
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        } catch {
          void 0;
        }
        await page.waitForTimeout(2200);
        continue;
      }
      await pwExpect(nameInput).toBeVisible({ timeout: 10_000 });
      await nameInput.fill(defaultBiz);
      await catInput.fill(defaultCat);
      await cityInput.fill(defaultCity);
      await provInput.fill(defaultProv);
      try {
        if (
          (await phoneInput.count().catch(() => 0)) > 0 &&
          (await phoneInput.isVisible().catch(() => false))
        ) {
          await phoneInput.fill("+39 06 12345678");
        }
      } catch {
        void 0;
      }
      try {
        if (
          (await bizEmailInput.count().catch(() => 0)) > 0 &&
          (await bizEmailInput.isVisible().catch(() => false))
        ) {
          await bizEmailInput.fill("biz-onboard@velora.test");
        }
      } catch {
        void 0;
      }
      try {
        if (
          (await tzInput.count().catch(() => 0)) > 0 &&
          (await tzInput.isVisible().catch(() => false))
        ) {
          await tzInput.fill(defaultTz);
        }
      } catch {
        void 0;
      }
      try {
        if (
          (await locInput.count().catch(() => 0)) > 0 &&
          (await locInput.isVisible().catch(() => false))
        ) {
          await locInput.fill(defaultLoc);
        }
      } catch {
        void 0;
      }
      await pwExpect(submitBtn).toBeVisible();
      // ensure submit is enabled (client-side validation)
      try {
        await submitBtn.click();
      } catch {
        void 0;
      }
      // wait for potential redirect
      for (let i = 0; i < 18; i++) {
        const u = page.url();
        if (!u.includes("/onboarding")) return { handled: true, url: u };
        await page.waitForTimeout(750);
        // after submit, check for errors on form
        try {
          const errs = await page.evaluate(() => {
            const al = Array.from(
              document.querySelectorAll(
                '[role="alert"], [data-alert], .alert, .text-red, .toast, [aria-live="assertive"], [aria-live="polite"]',
              ),
            )
              .map((el) => el.textContent?.trim())
              .filter(Boolean)
              .slice(0, 8);
            const fe = Array.from(
              document.querySelectorAll("form p, form span, [data-error], [role='status']"),
            )
              .map((el) => el.textContent?.trim())
              .filter((t) => t && t.length > 2)
              .slice(0, 12);
            return [...al, ...fe];
          });
          if (errs.length > 0) {
            // propagate errors into test log via throw (will be caught by outer catch)
            throw new Error(
              `[onboarding] submit errors tentative ${tries}: ${JSON.stringify(errs.slice(0, 6))}`,
            );
          }
        } catch (e) {
          if (/submit errors/.test(String(e))) throw e;
        }
      }
    } catch (err) {
      // This propagates meaningful errors: Playwright runner will capture in logs
      // for submit errors. For hydration issues just continue retry with longer delay
      const msg = String(err);
      if (/submit errors/.test(msg)) {
        throw err;
      }
      console.error(`[handleOnboardingIfPresent] tentative ${tries} exception: ${msg}`);
      try {
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      } catch {
        void 0;
      }
      await page.waitForTimeout(1800);
    }
  }
  return { handled: "unknown", url: page.url() };
}

/**
 * Test-only production-safe auth helper.
 * Strategy:
 *  1. provision user + identity + password via service role admin API (real GoTrue schema).
 *  2. submit real /login form (matches FASE14D green behavior, server action + GoTrue).
 *  3. IF form redirects to /login (failed), fallback: signInWithPassword anon client REALE +
 *     inject cookies in browser context (still real session from GoTrue).
 *  4. If after auth the app lands on /onboarding → completes it deterministically.
 */
export async function ensureTestSession(page, email, password, opts = {}) {
  const userId = await ensureAuthUserWithPassword(email, password, opts.displayName);

  // A) login form reale
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 20000 });
    const emailInput = page.locator('input[name="email"]');
    const passInput = page.locator('input[name="password"]');
    const submitBtn = page.getByRole("button", { name: /Accedi/i });
    if (
      (await emailInput.count()) > 0 &&
      (await passInput.count()) > 0 &&
      (await submitBtn.count()) > 0
    ) {
      await expect(emailInput).toBeVisible({ timeout: 10000 });
      await expect(passInput).toBeVisible();
      await expect(submitBtn).toBeVisible();
      await emailInput.fill(email);
      await passInput.fill(password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {}),
        submitBtn.click(),
      ]);
      const finalUrl = page.url();
      const hasAlert =
        (await page
          .getByRole("alert")
          .count()
          .catch(() => 0)) > 0;
      const stillLogin = finalUrl.includes("/login");
      if (!stillLogin && !hasAlert) {
        const onb = await handleOnboardingIfPresent(page, opts.onboarding);
        return { userId, mode: "A:form", onboarding: onb };
      }
      console.warn(
        `[ensureTestSession] Modello A redirected back a login url=${finalUrl} alert=${hasAlert}. Fallback B signInWithPassword.`,
      );
    } else {
      console.warn(
        `[ensureTestSession] Modello A selettori non trovati (email=${await emailInput.count()} pass=${await passInput.count()} btn=${await submitBtn.count()}). Fallback B.`,
      );
    }
  } catch (e) {
    console.warn(`[ensureTestSession] Modello A eccezione: ${String(e)}. Fallback B.`);
  }

  // B) signInWithPassword diretto client anon REALE
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_URL");
  const ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? sharedDbEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const client = createSupabaseClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(
      `[ensureTestSession MODELLO B FALLITO] signInWithPassword per ${email}: ${error?.name ?? "unknown"} ${error?.message ?? ""} (status=${error?.status ?? "?"})`,
    );
  }
  const session = data.session;
  const AT = session.access_token;
  const RT = session.refresh_token;
  const EXPIRES_AT = String(session.expires_at ?? Math.floor(Date.now() / 1000) + 3500);
  const EXPIRES_IN = String(session.expires_in ?? 3500);
  const TOK_TYPE = session.token_type ?? "bearer";
  const user = {
    id: session.user?.id ?? userId,
    email: session.user?.email ?? email,
    email_confirmed_at: session.user?.email_confirmed_at ?? new Date().toISOString(),
    aud: session.user?.aud ?? "authenticated",
    role: session.user?.role ?? "authenticated",
    app_metadata: session.user?.app_metadata ?? {},
    user_metadata: session.user?.user_metadata ?? { display_name: email },
  };
  const baseOpts = {
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };
  const urlB64 = Buffer.from(URL).toString("base64url").replace(/=/g, "");
  await page.context().addCookies([
    { ...baseOpts, name: "sb-access-token", value: AT },
    { ...baseOpts, name: "sb-refresh-token", value: RT },
    { ...baseOpts, name: "sb-token-type", value: TOK_TYPE },
    { ...baseOpts, name: "sb-expires-at", value: EXPIRES_AT },
    { ...baseOpts, name: "sb-expires-in", value: EXPIRES_IN },
    {
      ...baseOpts,
      name: `sb-${urlB64}-auth-token`,
      value: JSON.stringify({
        access_token: AT,
        refresh_token: RT,
        expires_at: EXPIRES_AT,
        expires_in: EXPIRES_IN,
        token_type: TOK_TYPE,
        user,
      }),
    },
  ]);
  // After injecting cookies, navigate to dashboard: lets Next.js middleware/route guards
  // evaluate session and possibly redirect to onboarding.
  try {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch {
    /* ignore */
  }
  const onb = await handleOnboardingIfPresent(page, opts.onboarding);
  return { userId, mode: "B:signInWithPassword", onboarding: onb };
}
/* [end-of-file] helper auth shared test-only. Sessioni originate esclusivamente da GoTrue reale. */
