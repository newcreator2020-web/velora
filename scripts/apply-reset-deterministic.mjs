import "dotenv/config";
import { Client as PgClient } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resetSqlPath = resolve(__dirname, "..", "tests", "db", "fixtures", "reset_deterministic.sql");
const sql = readFileSync(resetSqlPath, "utf8");

const buildPgOpts = () => ({
  host: process.env.SUPABASE_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? "postgres",
  user: process.env.SUPABASE_DB_USER ?? "postgres",
  password: process.env.SUPABASE_DB_PASSWORD ?? "postgres",
});

const PRE_WIPE = `
BEGIN;
SET LOCAL session_replication_role = replica;
ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner;
TRUNCATE TABLE
  public.bookings,
  public.billing_subscriptions,
  public.billing_customers,
  public.staff_resources,
  public.business_availability,
  public.audit_logs,
  public.site_sections,
  public.services,
  public.site_editorial_state,
  public.tenant_memberships,
  public.platform_admins,
  public.business_profiles,
  public.tenants,
  public.resource_time_off,
  public.resource_availability,
  public.staff_resource_services
RESTART IDENTITY CASCADE;
DELETE FROM auth.mfa_challenges;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.mfa_amr_claims;
DELETE FROM auth.oauth_authorizations;
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.one_time_tokens;
DELETE FROM auth.flow_state;
DELETE FROM auth.saml_relay_states;
DELETE FROM auth.oauth_client_states;
DELETE FROM auth.oauth_consents;
DELETE FROM auth.webauthn_challenges;
DELETE FROM auth.webauthn_credentials;
DELETE FROM auth.identities;
DELETE FROM public.profiles;
DELETE FROM auth.users
  WHERE email NOT IN ('postgres@localhost','supabase_admin@local','authenticator@local','service_role@local','anon@local','dashboard_user@local');
SET LOCAL session_replication_role = DEFAULT;
ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner;
COMMIT;`;

async function main() {
  const pg = new PgClient(buildPgOpts());
  await pg.connect();
  try {
    await pg.query(PRE_WIPE);
    await pg.query(sql);
    console.warn(`[RESET DETERMINISTIC] OK pre-wipe + fixture applied (${resetSqlPath})`);
  } catch (e) {
    try {
      await pg.query("ROLLBACK;").catch(() => void 0);
    } catch {
      void 0;
    }
    console.error("[RESET DETERMINISTIC] FAIL", e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    await pg.end().catch(() => void 0);
  }
}
main();
