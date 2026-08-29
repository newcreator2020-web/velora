/* eslint-disable no-empty */
import "dotenv/config";
import { test, expect } from "@playwright/test";
import pgPkg from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import axePkg from "@axe-core/playwright";
const { Client: PgClient } = pgPkg;
const AxeBuilder = axePkg.default ?? axePkg;

/* ============================================================
   SAFETY GUARDRAILS — locale / velora-local only
   ============================================================ */
const ALLOWED_DB_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_PROJECT_IDS = new Set(["velora-local"]);
(() => {
  const host = process.env.SUPABASE_DB_HOST ?? "";
  const pr = process.env.SUPABASE_PROJECT_ID ?? "";
  if (!((ALLOWED_DB_HOSTS.has(host) && pr.length === 0) || SAFE_PROJECT_IDS.has(pr))) {
    console.error("[fase14d-e2e] unsafe DB env — ABORT");
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
};
const dbEnv = (n) => process.env[n] ?? DEFAULT_DB[n] ?? "";
const pgOpts = () => ({
  host: dbEnv("SUPABASE_DB_HOST"),
  port: Number(dbEnv("SUPABASE_DB_PORT") || 54322),
  database: dbEnv("SUPABASE_DB_NAME"),
  user: dbEnv("SUPABASE_DB_USER"),
  password: dbEnv("SUPABASE_DB_PASSWORD"),
});
async function newPg() {
  const c = new PgClient(pgOpts());
  await c.connect();
  return c;
}
async function queryOne(sql, args = []) {
  const c = await newPg();
  try {
    const r = await c.query(sql, args);
    return r.rows[0];
  } finally {
    await c.end().catch(() => {});
  }
}

const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const _RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const PASSWORD = "VeloraTest12345!";
const OWNER_A = "f14d-owner-a@test.local";
const MANAGER_A = "f14d-manager-a@test.local";
const STAFF_A = "f14d-staff-a@test.local";
const OWNER_B = "f14d-owner-b@test.local";
const FIXED = {
  tenantA: "00000000-0000-4130-8000-0000000014a1",
  tenantB: "00000000-0000-4130-8000-0000000014b1",
  svcA1: "00000000-0000-4130-8002-0000000014a1",
  resA1: "00000000-0000-4130-8004-0000000014a1",
  resA2: "00000000-0000-413d-8004-0000000014a2",
};
const RES_A1 = FIXED.resA1;
const RES_A2 = FIXED.resA2;
let TENANT_A = FIXED.tenantA;
let TENANT_B = FIXED.tenantB;
let SVC_A1 = FIXED.svcA1;
let SLUG_A = "f14d-tenant-alpha";

/* ============================================================
   AUTH helpers — MODELLO A: login UI REALE tramite /login form.
   Usa server action Next.js che chiama createSupabaseServerClient
   (GoTrue Supabase reale). Cookie gestiti dal browser normalmente.
   Fallback MODELLO B: signInWithPassword diretto client anonimo.
   ============================================================ */
async function ensureAuthUser(email) {
  const c = await newPg();
  try {
    const displayName = `F14D ${email}`;
    const meta = { full_name: displayName, display_name: displayName };
    const email_lc = email.toLowerCase().trim();

    /* Strategy A: use service role admin.createUser (properly creates identities,
       validates schema, sets encrypted_password — matches what signInWithPassword expects).
       Falls back to direct SQL insert if service role unavailable (legacy). */
    const SUPABASE_URL = dbEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SRK = dbEnv("SUPABASE_SERVICE_ROLE_KEY");
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
          password: PASSWORD,
          email_confirm: true,
        });
        if (resetRes.error) {
          const cr = await c.query(`SELECT public.crypt($1::text, public.gen_salt('bf')) AS pw`, [
            PASSWORD,
          ]);
          await c.query(
            `UPDATE auth.users SET encrypted_password=$1::text, email_confirmed_at=COALESCE(email_confirmed_at, NOW()), updated_at=NOW() WHERE id=$2::uuid`,
            [cr.rows[0].pw, uid],
          );
        }
      } else {
        const { data, error } = await svc.auth.admin.createUser({
          email: email_lc,
          password: PASSWORD,
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

    /* Fallback: direct SQL insert (legacy path) */
    const cr = await c.query(`SELECT public.crypt($1::text, public.gen_salt('bf')) AS pw`, [
      PASSWORD,
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

async function setSession(page, email) {
  /* Provisioning minimo: garantisce che l'utente esista e pw=PASSWORD */
  const userId = await ensureAuthUser(email);

  // ---------- MODELLO A: login UI REALE tramite form ----------
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 20000 });
    const emailInput = page.locator('input[name="email"]');
    const passInput = page.locator('input[name="password"]');
    const submitBtn = page.getByRole("button", { name: /Accedi/i });
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(passInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await emailInput.fill(email);
    await passInput.fill(PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    const finalUrl = page.url();
    const badLogin =
      finalUrl.includes("/login") ||
      (await page
        .getByRole("alert")
        .count()
        .catch(() => 0)) > 0;
    if (!badLogin) {
      return { userId, mode: "A" };
    }

    console.warn(
      `[setSession] Modello A fallito o redirected a login url=${finalUrl}. Fallback a modello B signInWithPassword diretto.`,
    );
  } catch (e) {
    console.warn(`[setSession] Modello A eccezione: ${String(e)}. Fallback B.`);
  }

  // ---------- MODELLO B (fallback): signInWithPassword diretto client Supabase REALE ----------
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const client = createSupabaseClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) {
    throw new Error(
      `[setSession MODELLO B FALLITO] signInWithPassword per ${email}: ${error?.name ?? "unknown"} ${error?.message ?? ""} (status=${error?.status ?? "?"})`,
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
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(200);
  return { userId: user.id, mode: "B", realAuth: true };
}

/* ============================================================
   DB PROVISIONING (prima di tutti i test)
   Provisioning AUTONOMO: crea tenant, utenti, servizi e risorse
   se non esistono. Non dipende dall'aver eseguito prima Vitest.
   ============================================================ */
test.beforeAll(async () => {
  /* Assicura che gli utenti auth esistano (prima di qualsiasi DB transaction) */
  const _uOa = await ensureAuthUser(OWNER_A);
  const _uMa = await ensureAuthUser(MANAGER_A);
  const _uSa = await ensureAuthUser(STAFF_A);
  const _uOb = await ensureAuthUser(OWNER_B);

  const c = await newPg();
  try {
    await c.query("BEGIN");

    /* --- TENANT_A: crea se non esiste (fixture autonome) --- */
    const tA = await c.query(`SELECT id, slug FROM public.tenants WHERE id=$1::uuid LIMIT 1`, [
      TENANT_A,
    ]);
    if (!tA.rows[0]) {
      await c.query(
        `INSERT INTO public.tenants (id, name, slug, status, published, plan_id, created_at, updated_at)
         VALUES ($1::uuid, 'Studio Aurora F14D A', 'f14d-tenant-alpha', 'active', true, 'internal_test', NOW(), NOW())`,
        [TENANT_A],
      );
      SLUG_A = "f14d-tenant-alpha";
    } else {
      SLUG_A = String(tA.rows[0].slug);
      await c.query(
        `UPDATE public.tenants SET published=true, status='active', plan_id=COALESCE(plan_id,'internal_test') WHERE id=$1::uuid`,
        [TENANT_A],
      );
    }

    /* --- TENANT_B: per cross-tenant; usa FIXED se disponibile, altrimenti primo esistente, altrimenti CREA --- */
    const tB_fixed = await c.query(`SELECT id FROM public.tenants WHERE id=$1::uuid LIMIT 1`, [
      FIXED.tenantB,
    ]);
    if (tB_fixed.rows[0]) {
      TENANT_B = FIXED.tenantB;
    } else {
      const tB_any = await c.query(
        `SELECT id FROM public.tenants WHERE id!=$1::uuid ORDER BY created_at ASC LIMIT 1`,
        [TENANT_A],
      );
      if (tB_any.rows[0]) {
        TENANT_B = String(tB_any.rows[0].id);
      } else {
        await c.query(
          `INSERT INTO public.tenants (id, name, slug, status, published, plan_id, created_at, updated_at)
           VALUES ($1::uuid, 'Studio Aurora F14D B', 'f14d-tenant-beta', 'active', true, 'internal_test', NOW(), NOW())`,
          [FIXED.tenantB],
        );
        TENANT_B = FIXED.tenantB;
      }
    }
    await c.query(
      `INSERT INTO public.business_profiles (tenant_id, display_name, category, description, city, timezone, locale)
       VALUES ($1::uuid, 'Studio Aurora F14D B', 'hair_salon', 'BP Tenant B', 'Roma', 'Europe/Rome', 'it-IT')
       ON CONFLICT (tenant_id) DO UPDATE SET timezone='Europe/Rome', locale='it-IT'`,
      [TENANT_B],
    );

    /* --- SERVIZIO SVC_A1: crea se non esiste (eligibility endpoint pubblico) --- */
    const svc = await c.query(`SELECT id FROM public.services WHERE id=$1::uuid LIMIT 1`, [SVC_A1]);
    if (!svc.rows[0]) {
      await c.query(
        `INSERT INTO public.services (id, tenant_id, name, description, price_from, currency, duration_minutes, active, position, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'Taglio uomo F14D', 'Taglio standard', 2500, 'EUR', 30, true, 0, NOW(), NOW())`,
        [SVC_A1, TENANT_A],
      );
    }

    /* --- BUSINESS PROFILE: necessario per non andare in redirect /onboarding --- */
    await c.query(
      `INSERT INTO public.business_profiles (tenant_id, display_name, category, description, city, province, address_line1, phone, email, timezone, locale)
       VALUES ($1::uuid, 'Studio Aurora F14D', 'hair_salon', 'Salone di prova FASE14D', 'Roma', 'RM', 'Via Prova 1', '+390612345678', 'info-aurora-f14d@velora.test', 'Europe/Rome', 'it-IT')
       ON CONFLICT (tenant_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         updated_at = NOW()`,
      [TENANT_A],
    );

    /* Utenti auth: ricavo id dopo ensureAuthUser */
    const uRows = await c.query(
      `SELECT lower(email::text) AS e, id FROM auth.users WHERE lower(email::text) IN ($1,$2,$3,$4)`,
      [OWNER_A, MANAGER_A, STAFF_A, OWNER_B].map((s) => s.toLowerCase()),
    );
    const byEmail = Object.fromEntries(uRows.rows.map((r) => [String(r.e), String(r.id)]));
    const uOa = byEmail[OWNER_A.toLowerCase()];
    const uMa = byEmail[MANAGER_A.toLowerCase()];
    const uSa = byEmail[STAFF_A.toLowerCase()];
    const uOb = byEmail[OWNER_B.toLowerCase()];
    if (!uOa || !uMa || !uSa || !uOb) {
      throw new Error(`[fase14d] utenti auth non creati (impossibile dopo ensureAuthUser)`);
    }

    /* Membership: GARANTISCE prima che OWNER_B esista su TENANT_B (altrimenti
       se TENANT_B era nuovo, non c'era ancora owner). Poi upsert membership A+B.
       NESSUN DELETE cross-tenant: non si toccano altri tenants (evita
       guard_last_active_owner). */
    const bOwnerExists = await c.query(
      `SELECT 1 FROM public.tenant_memberships WHERE tenant_id=$1::uuid AND role='owner' AND status='active' LIMIT 1`,
      [TENANT_B],
    );
    if (!bOwnerExists.rows[0]) {
      await c.query(
        `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status)
         VALUES ($1::uuid, $2::uuid, 'owner', 'active')
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [TENANT_B, uOb],
      );
    }
    await c.query(
      `INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status)
       VALUES ($1::uuid, $2::uuid, 'owner', 'active'),
              ($1::uuid, $3::uuid, 'manager', 'active'),
              ($1::uuid, $4::uuid, 'staff', 'active'),
              ($5::uuid, $6::uuid, 'owner', 'active')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status='active'`,
      [TENANT_A, uOa, uMa, uSa, TENANT_B, uOb],
    );

    /* CLEANUP cross-run stato residuo (SOLO TENANT_A) */
    await c.query(
      `UPDATE public.bookings SET status='cancelled' WHERE tenant_id=$1::uuid AND status='confirmed'`,
      [TENANT_A],
    );
    await c.query(`DELETE FROM public.resource_time_off WHERE tenant_id=$1::uuid`, [TENANT_A]);
    await c.query(`DELETE FROM public.resource_availability WHERE tenant_id=$1::uuid`, [TENANT_A]);
    await c.query(
      `DELETE FROM public.staff_resource_services WHERE tenant_id=$1::uuid AND resource_id IN ($2::uuid,$3::uuid)`,
      [TENANT_A, RES_A1, RES_A2],
    );
    await c.query(
      `UPDATE public.staff_resources SET slug = ('old-' || slug || '-' || substr(md5(random()::text),1,6)) WHERE tenant_id=$1::uuid AND slug IN ('maria-f14d','luca-f14d')`,
      [TENANT_A],
    );
    /* Reset availability version a 0 per deterministic save */
    await c.query(
      `UPDATE public.staff_resources SET availability_version=0 WHERE tenant_id=$1::uuid AND id IN ($2::uuid,$3::uuid)`,
      [TENANT_A, RES_A1, RES_A2],
    );
    /* Business availability: forza 09-19 mon-sat (match DB tests) */
    for (let wd = 1; wd <= 6; wd++) {
      await c.query(
        `INSERT INTO public.business_availability (tenant_id, weekday, enabled, start_time, end_time)
         VALUES ($1::uuid, $2, TRUE, '09:00', '19:00')
         ON CONFLICT (tenant_id, weekday) DO UPDATE SET
           enabled=TRUE, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time`,
        [TENANT_A, wd],
      );
    }
    /* Assicura esistenza staff resources con ON CONFLICT update (RIIMPOSTA slug!) */
    await c.query(
      `INSERT INTO public.staff_resources (id, tenant_id, slug, display_name, color_hex, active, bookable, sort_order, availability_version)
       VALUES ($1::uuid, $2::uuid, 'maria-f14d', 'Maria F14D', '#EC4899', true, true, 10, 0),
              ($3::uuid, $2::uuid, 'luca-f14d', 'Luca F14D', '#3B82F6', true, true, 11, 0)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         display_name = EXCLUDED.display_name,
         active = true,
         bookable = true,
         availability_version = 0`,
      [RES_A1, TENANT_A, RES_A2],
    );
    /* Staff resource services eligibility */
    await c.query(
      `INSERT INTO public.staff_resource_services (tenant_id, resource_id, service_id, active)
       VALUES ($1::uuid, $2::uuid, $3::uuid, TRUE),
              ($1::uuid, $4::uuid, $3::uuid, TRUE)
       ON CONFLICT (tenant_id, resource_id, service_id) DO UPDATE SET active=TRUE`,
      [TENANT_A, RES_A1, SVC_A1, RES_A2],
    );
    await c.query("COMMIT");
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
});

/* ============================================================
   HELPERS UI
   ============================================================ */

async function openMariaSchedule(page) {
  await page.goto("/app/team", { waitUntil: "domcontentloaded" });
  await expect(page.locator(`text=Maria F14D`).first()).toBeVisible({ timeout: 15000 });
  const btn = page.getByRole("button", { name: /Orari settimanali di Maria/i });
  await expect(btn).toBeVisible({ timeout: 8000 });
  await btn.click();
  const dialog = page
    .locator(`[role="dialog"]`)
    .filter({ has: page.locator("#rwd-title").filter({ hasText: "Maria" }) });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  for (let retry = 0; retry < 3; retry++) {
    await expect(dialog.locator("text=Caricamento…")).toHaveCount(0, { timeout: 15000 });
    const hasErr = await dialog
      .getByText(/Errore caricamento:/)
      .isVisible()
      .catch(() => false);
    if (!hasErr) break;
    const reloadBtn = dialog.getByRole("button", { name: /Ricarica/i });
    if (await reloadBtn.isVisible().catch(() => false)) {
      await reloadBtn.click();
      await page.waitForTimeout(300);
      continue;
    }
    break;
  }
  await expect(dialog.locator("fieldset").first()).toBeVisible({ timeout: 10000 });
  const db = await queryOne(
    `SELECT availability_version AS v FROM public.staff_resources WHERE id=$1::uuid`,
    [RES_A1],
  );
  const target = `versione #${db?.v ?? 0}`;
  try {
    await expect(dialog.getByText(target)).toBeVisible({ timeout: 5000 });
  } catch (e) {
    const footerText = await dialog
      .locator("div")
      .filter({ has: page.getByText(/versione #/) })
      .first()
      .textContent()
      .catch(() => "NULL");
    const loadErrText = await dialog
      .locator("text=Errore caricamento")
      .first()
      .textContent()
      .catch(() => "NULL");
    const rId = await dialog
      .locator('input[name="resource_id"]')
      .inputValue()
      .catch(() => "NULL");
    const eV = await dialog
      .locator('input[name="expected_version"]')
      .inputValue()
      .catch(() => "NULL");
    console.warn(
      `[OPENMARIA DIAG] expected RES_A1=${RES_A1} | dialog resource_id="${rId}" | dbV=${db?.v} target="${target}" | form expected_version="${eV}" | footer="${footerText}" | loadErr="${loadErrText}"`,
    );
    throw e;
  }
}

function fieldsetForDay(page, wdLabel) {
  return page.locator("fieldset").filter({ has: page.locator(`legend:has-text("${wdLabel}")`) });
}

async function setDayInterval(page, wdLabel, idx, start, end) {
  const fs = fieldsetForDay(page, wdLabel);
  const addBtn = fs.getByRole("button", { name: /Aggiungi fascia/i });
  while ((await fs.locator("li").count()) <= idx) {
    await addBtn.click();
  }
  const li = fs.locator("li").nth(idx);
  const startInput = li.locator(`input[type="time"]`).first();
  const endInput = li.locator(`input[type="time"]`).nth(1);
  await startInput.fill(start);
  await endInput.fill(end);
}

async function setDayOFF(page, wdLabel) {
  const fs = fieldsetForDay(page, wdLabel);
  const offBtn = fs.getByRole("button", { name: /Riposo/i });
  await offBtn.click();
}

async function saveWeekly(page) {
  await page.getByRole("button", { name: /Salva settimana/i }).click();
}

function drawerBanner(page) {
  return page.locator('[role="dialog"]').locator('[role="status"], [role="alert"]').first();
}

/* ============================================================
   TESTS SERIALI
   ============================================================ */
test.describe.serial("FASE14D Resource Weekly Availability — TEAM DASHBOARD", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("T1 — anon deny → non mostra contenuto team", async ({ page }) => {
    await page.goto("/app/team", { waitUntil: "domcontentloaded" });
    const path = new URL(page.url()).pathname;
    const onLoginPath = path === "/login" || path.startsWith("/login");
    const onOnboarding = path === "/onboarding" || path.startsWith("/onboarding");
    const hasMaria = await page
      .locator(`text=Maria F14D`)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(onLoginPath || onOnboarding || !hasMaria).toBe(true);
  });

  test("T2 — owner login → vede Team page con Maria/Luca", async ({ page }) => {
    await setSession(page, OWNER_A);
    await page.goto("/app/team", { waitUntil: "domcontentloaded" });
    await expect(page.locator(`text=Maria F14D`).first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`text=Luca F14D`).first()).toBeVisible();
  });

  test("T3 — load schedule fallback 'eredita orari'", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    const fsLun = fieldsetForDay(page, "Lunedì");
    await expect(fsLun.locator(`text=eredita orari`).first()).toBeVisible({ timeout: 10000 });
  });

  test("T4 — split shift Lun 09-13 / 14-18 save success", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    await setDayInterval(page, "Lunedì", 0, "09:00", "13:00");
    await setDayInterval(page, "Lunedì", 1, "14:00", "18:00");
    await saveWeekly(page);
    await expect(drawerBanner(page)).toBeVisible({ timeout: 20000 });
    const role = await drawerBanner(page).evaluate((el) => el.getAttribute("role"));
    expect(role).toBe("status");
    const row = await queryOne(
      `SELECT count(*)::int AS c FROM public.resource_availability
       WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=1`,
      [TENANT_A, RES_A1],
    );
    expect(row.c).toBe(2);
  });

  test("T5 — Mercoledì OFF (Riposo) save", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    // Diagnostica: versione hidden nel form vs versione DB (dopo T4 save dovrebbe essere 1)
    const expectedV = await page
      .locator('[role="dialog"] input[name="expected_version"]')
      .inputValue();
    const dbV = await queryOne(
      `SELECT availability_version AS v FROM public.staff_resources WHERE id=$1::uuid`,
      [RES_A1],
    );
    console.warn(
      `[T5] before save: form expected_version=${expectedV} DB availability_version=${dbV?.v}`,
    );
    await setDayOFF(page, "Mercoledì");
    await saveWeekly(page);
    const statusOrAlert = drawerBanner(page);
    await expect(statusOrAlert).toBeVisible({ timeout: 20000 });
    const bannerText = await statusOrAlert.textContent();
    const role = await statusOrAlert.evaluate((el) => el.getAttribute("role"));
    if (role === "alert") {
      const html = await statusOrAlert.evaluate((el) => el.innerHTML);
      throw new Error(`[T5] ALERT invece di status. text="${bannerText}" html=${html}`);
    }
    expect(role).toBe("status");
    expect(bannerText && bannerText.length > 0).toBe(true);
    const row = await queryOne(
      `SELECT count(*)::int AS c FROM public.resource_availability
       WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=3`,
      [TENANT_A, RES_A1],
    );
    expect(row.c).toBe(0);
    const mask = await queryOne(
      `SELECT (inherit_weekdays_bitmask >> 3) & 1 AS inherit
       FROM public.dashboard_get_resource_weekly_schedule($1::uuid)`,
      [RES_A1],
    );
    expect(Number(mask.inherit)).toBe(0);
  });

  test("T6 — reload persistence: riapri drawer, check Lun/Mer invariati", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    const fsMer = fieldsetForDay(page, "Mercoledì");
    await expect(fsMer.locator(`text=Riposo`).first()).toBeVisible({ timeout: 10000 });
    const fsLun = fieldsetForDay(page, "Lunedì");
    expect(await fsLun.locator("li").count()).toBe(2);
  });

  test("T7 — client validation end<=start → errore inline", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    await setDayInterval(page, "Martedì", 0, "12:00", "10:00");
    await saveWeekly(page);
    const err = page.locator("text=inizio deve precedere la fine").first();
    await expect(err).toBeVisible({ timeout: 8000 });
  });

  test("T8 — sovrapposizione intervalli → errore", async ({ page }) => {
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    await setDayInterval(page, "Giovedì", 0, "10:00", "14:00");
    await setDayInterval(page, "Giovedì", 1, "13:00", "17:00");
    await saveWeekly(page);
    const err = page.locator("text=sovrapposti");
    await expect(err.first()).toBeVisible({ timeout: 10000 });
  });

  test("T9 — staff role deny su action save (DB-side enforcement)", async ({ page }) => {
    await setSession(page, STAFF_A);
    await page.goto("/app/team", { waitUntil: "domcontentloaded" });
    /* Attendiamo caricamento; se non vede risorse è OK. Oppure proviamo save diretto e vediamo response dalla action. */
    const hasMaria = await page
      .locator(`text=Maria F14D`)
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    if (hasMaria) {
      try {
        await openMariaSchedule(page);
        await setDayInterval(page, "Venerdì", 0, "10:00", "11:00");
        await saveWeekly(page);
        const banner = drawerBanner(page);
        if (await banner.isVisible({ timeout: 10000 }).catch(() => false)) {
          await expect(banner).toBeVisible();
        }
      } catch {}
    }
    /* Comunque DB-side: staff non dovrebbe aver scritto nulla */
    const row = await queryOne(
      `SELECT count(*)::int AS c FROM public.resource_availability
       WHERE tenant_id=$1::uuid AND resource_id=$2::uuid AND weekday=5`,
      [TENANT_A, RES_A1],
    );
    expect(row.c).toBe(0);
  });

  test("T10 — cross-tenant: Owner B su team page non vede risorse A", async ({ page }) => {
    await setSession(page, OWNER_B);
    await page.goto("/app/team", { waitUntil: "domcontentloaded" });
    const hasMaria = await page
      .locator(`text=Maria F14D`)
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    expect(hasMaria).toBe(false);
    /* Nessun RA di A deve mai essere letto da B tramite policy */
    const n = await queryOne(
      `SELECT count(*)::int AS c FROM public.resource_availability
       WHERE tenant_id=$1::uuid AND resource_id=$2::uuid`,
      [TENANT_B, RES_A1],
    );
    expect(n.c).toBe(0);
  });

  test("T11 — existing booking preserved when schedule shrinks + conflicting count banner", async ({
    page,
  }) => {
    /* Setup booking Lun 17:30 (dentro 14-18 attuale) */
    const today = new Date();
    const wd = today.getUTCDay();
    let delta = (1 - wd + 7) % 7;
    if (delta === 0) delta = 7;
    delta += 14;
    const nextMon = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + delta),
    );
    const iso = `${nextMon.getUTCFullYear()}-${String(nextMon.getUTCMonth() + 1).padStart(2, "0")}-${String(nextMon.getUTCDate()).padStart(2, "0")}`;
    const phone = "+390" + (Date.now() % 1000000).toString().padStart(6, "0");
    const startsAtISO = `${iso}T15:30:00.000Z`;
    const c = await newPg();
    try {
      await c.query(`BEGIN`);
      await c.query(`SET LOCAL ROLE anon`);
      await c.query(
        `SELECT * FROM public.public_booking_create_v3($1::text, $2::uuid, $3::timestamptz, $4::text, $5::text, $6::text, $7::text, $8::text)`,
        [
          SLUG_A,
          SVC_A1,
          startsAtISO,
          "maria-f14d",
          "Mario R.",
          "mario-f14d-11@velora.test",
          phone,
          null,
        ],
      );
      await c.query(`COMMIT`);
    } catch (e) {
      try {
        await c.query(`ROLLBACK`);
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      await c.end().catch(() => {});
    }
    /* Ora: owner save shrinks Lun 09-16 (prima era 09-13 / 14-18 -> nuovo solo 09-16) */
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    const fsLun = fieldsetForDay(page, "Lunedì");
    /* Puliamo gli esistenti col Riposo, poi nuovo intervallo */
    await fsLun.getByRole("button", { name: /Riposo/i }).click();
    await setDayInterval(page, "Lunedì", 0, "09:00", "14:00");
    await saveWeekly(page);
    const banner = drawerBanner(page);
    await expect(banner).toBeVisible({ timeout: 20000 });
    /* Contiamo booking esistente ancora DB (preserved) */
    const booking = await queryOne(
      `SELECT count(*)::int AS c FROM public.bookings
       WHERE tenant_id=$1::uuid AND service_id=$2::uuid
         AND status='confirmed' AND customer_email=$3
         AND starts_at AT TIME ZONE 'Europe/Rome' >= $4::date
         AND starts_at AT TIME ZONE 'Europe/Rome'  < ($4::date + INTERVAL '1 day')`,
      [TENANT_A, SVC_A1, "mario-f14d-11@velora.test", iso],
    );
    expect(booking.c).toBe(1);
    const text = await banner.textContent();
    expect(text && text.length > 0).toBe(true);
    expect(banner).toHaveAttribute("role", "status");
  });

  for (const [vp, dims] of Object.entries(VIEWPORTS)) {
    test(`T12-r — ${vp} ${dims.width}x${dims.height} drawer OK`, async ({ page }) => {
      await page.setViewportSize(dims);
      await setSession(page, OWNER_A);
      await openMariaSchedule(page);
      const dialog = page.locator(`[role="dialog"]`).first();
      await expect(dialog).toBeVisible({ timeout: 15000 });
      const saveBtn = dialog.getByRole("button", { name: /Salva settimana/i });
      await saveBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await expect(saveBtn).toBeInViewport();
      await expect(fieldsetForDay(page, "Lunedì")).toBeVisible();
    });
  }

  test("T13 — axe drawer critical=0 serious=0", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await setSession(page, OWNER_A);
    await openMariaSchedule(page);
    await setDayInterval(page, "Martedì", 0, "09:00", "13:00");
    await page.waitForTimeout(300);
    const res = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .disableRules(["color-contrast-enhanced", "meta-viewport"])
      .analyze();
    const critical = res.violations.filter((v) => v.impact === "critical");
    const serious = res.violations.filter((v) => v.impact === "serious");
    expect(critical).toEqual([]);
    expect(serious).toEqual([]);
  });
});
