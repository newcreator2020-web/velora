import "dotenv/config";
import { Client } from "pg";
import { writeFileSync } from "node:fs";

const client = new Client({
  host: process.env.SUPABASE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT || 54322),
  user: "postgres",
  password: process.env.SUPABASE_DB_PASSWORD || "postgres",
  database: "postgres",
});

await client.connect();

const results = {};

results.migrations = (
  await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")
).rows.map((r) => r.version);

results.tables = (
  await client.query(
    `SELECT schemaname, tablename FROM pg_tables
     WHERE schemaname IN ('public','auth','storage','supabase_migrations','extensions','graphql','graphql_public','pgsodium','realtime','vault')
     ORDER BY schemaname, tablename`,
  )
).rows.map((r) => `${r.schemaname}.${r.tablename}`);

results.functions_public = (
  await client.query(
    `SELECT proname, oidvectortypes(proargtypes) AS args FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace ORDER BY proname, args`,
  )
).rows.map((r) => `${r.proname}(${r.args})`);

results.rls = (
  await client.query(
    `SELECT schemaname, tablename, rowsecurity FROM pg_tables
     WHERE schemaname='public' AND rowsecurity=true ORDER BY tablename`,
  )
).rows.map((r) => `${r.schemaname}.${r.tablename}`);

results.grants = (
  await client.query(
    `SELECT table_schema, table_name, grantee, privilege_type
     FROM information_schema.role_table_grants
     WHERE table_schema='public' ORDER BY table_name, grantee, privilege_type`,
  )
).rows.map((r) => `${r.table_schema}.${r.table_name} → ${r.grantee}:${r.privilege_type}`);

results.triggers = (
  await client.query(
    `SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
     FROM information_schema.triggers WHERE event_object_schema='public'
     ORDER BY event_object_table, trigger_name`,
  )
).rows.map(
  (r) =>
    `${r.event_object_schema}.${r.event_object_table} [${r.trigger_name}] ${r.action_timing} ${r.event_manipulation}`,
);

try {
  results.audit_whitelist = (
    await client.query(`SELECT action FROM public.audit_action_whitelist ORDER BY action`)
  ).rows.map((r) => r.action);
} catch (err) {
  results.audit_whitelist = [`TABLE_MISSING: ${String(err.message || err).slice(0, 120)}`];
}

try {
  results.time_off_types =
    (await client.query(`SELECT enum_range(NULL::public.time_off_type)::text AS rng`)).rows[0]
      ?.rng || "NO_ENUM";
} catch (err) {
  results.time_off_types = `ENUM_MISSING: ${String(err.message || err).slice(0, 120)}`;
}

const snap = JSON.stringify(results, null, 2);
const outFile = process.argv[2] || "schema-snapshot.json";
writeFileSync(outFile, snap, "utf-8");
console.warn(
  `migrations=${results.migrations.length}, tables=${results.tables.length}, funcs=${results.functions_public.length}, rls=${results.rls.length}, grants=${results.grants.length}, triggers=${results.triggers.length}`,
);
console.warn(`Written ${outFile}: ${snap.length} chars`);

await client.end();
