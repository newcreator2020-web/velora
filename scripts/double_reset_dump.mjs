/* eslint-disable no-console */
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

async function dumpSchema() {
  const c = await pool.connect();
  try {
    const out = [];
    const nameRe = /_[0-9a-f]{6,}$/i;
    // Migration history (strip timestamp columns)
    out.push("=== MIGRATIONS ===");
    const mhColsInfo = (
      await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' ORDER BY ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    const mhCols = mhColsInfo.filter(
      (cn) => !/installed_on|started_at|finished_at|created_at|updated_at/i.test(cn),
    );
    const mhSelect = mhCols.length ? mhCols.join(", ") : "1 AS col";
    const mhQ = await c.query(
      `SELECT ${mhSelect} FROM supabase_migrations.schema_migrations ORDER BY version`,
    );
    out.push(JSON.stringify(mhQ.rows, null, 0));
    // Functions (name, args, volatility, security definer, body hash exclude comments/whitespace?)
    out.push("=== FUNCTIONS ===");
    const fn = await c.query(`
      SELECT p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS args,
             p.provolatile AS volatility,
             p.prosecdef AS is_security_definer,
             l.lanname AS lang
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname IN ('public','auth','extensions')
      ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)`);
    out.push(JSON.stringify(fn.rows, null, 0));
    // Tables (schema + table + owner + row count)
    out.push("=== TABLES ===");
    const tbl = await c.query(`
      SELECT t.table_schema, t.table_name, t.table_type,
             (SELECT COUNT(*)::bigint FROM pg_class c WHERE c.relname=t.table_name AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=t.table_schema)) AS exists_int,
             CASE WHEN t.table_type='BASE TABLE' THEN (xpath('/row/c/text()', query_to_xml(format('SELECT COUNT(*) AS c FROM %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text::bigint ELSE NULL::bigint END AS n_rows
      FROM information_schema.tables t
      WHERE t.table_schema IN ('public','auth')
      ORDER BY t.table_schema, t.table_name`);
    out.push(
      JSON.stringify(
        tbl.rows.map((r) => ({
          schema: r.table_schema,
          name: r.table_name,
          type: r.table_type,
          rows: r.n_rows,
        })),
        null,
        0,
      ),
    );
    // Constraints (PK, FK, UNIQUE, CHECK)
    out.push("=== CONSTRAINTS ===");
    const coRaw = (
      await c.query(`
      SELECT tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
             (SELECT string_agg(kcu.column_name,',' ORDER BY kcu.ordinal_position) FROM information_schema.key_column_usage kcu WHERE kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema AND kcu.table_name=tc.table_name) AS cols
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema IN ('public','auth')
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name`)
    ).rows;
    const co = coRaw.map((r) => ({
      ...r,
      constraint_name: r.constraint_name.replace(nameRe, "_<ID>"),
    }));
    out.push(JSON.stringify(co, null, 0));
    // Indexes
    out.push("=== INDEXES ===");
    const ixRaw = (
      await c.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname IN ('public','auth')
      ORDER BY schemaname, tablename, indexname`)
    ).rows;
    const ix = ixRaw.map((r) => ({ ...r, indexname: r.indexname.replace(nameRe, "_<ID>") }));
    out.push(JSON.stringify(ix, null, 0));
    // Triggers
    out.push("=== TRIGGERS ===");
    const trRaw = (
      await c.query(`
      SELECT event_object_schema AS table_schema, event_object_table AS table_name, trigger_name, action_timing, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema IN ('public','auth')
      ORDER BY event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement`)
    ).rows;
    const trNameRe = /_[0-9a-f]{6,}$/i;
    const tr = trRaw.map((r) => ({
      ...r,
      trigger_name: r.trigger_name.replace(trNameRe, "_<ID>"),
    }));
    out.push(JSON.stringify(tr, null, 0));
    // RLS (enable + policies)
    out.push("=== RLS ===");
    const rls = await c.query(`
      SELECT t.schemaname, t.tablename, t.rowsecurity AS rls_enabled,
             p.policyname AS polname, p.cmd AS polcmd, p.roles AS polroles, p.qual AS polqual, p.with_check AS polwithcheck
      FROM pg_tables t
      LEFT JOIN pg_policies p ON p.schemaname=t.schemaname AND p.tablename=t.tablename
      WHERE t.schemaname IN ('public','auth')
      ORDER BY t.schemaname, t.tablename, p.policyname`);
    out.push(JSON.stringify(rls.rows, null, 0));
    // Grants (role privileges)
    out.push("=== GRANTS ===");
    const gr = await c.query(`
      SELECT table_schema, table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema IN ('public','auth') AND grantee IN ('anon','authenticated','service_role','postgres','dashboard_user','supabase_auth_admin','supabase_storage_admin')
      ORDER BY table_schema, table_name, grantee, privilege_type`);
    out.push(JSON.stringify(gr.rows, null, 0));
    // Fixture structural state: tables that are populated by fixture deterministic seed
    out.push("=== FIXTURE STATE HASH ===");
    const fixtureTables = [
      { schema: "public", name: "tenants" },
      { schema: "public", name: "business_profiles" },
      { schema: "public", name: "business_availability" },
      { schema: "public", name: "services" },
      { schema: "public", name: "staff_resources" },
      { schema: "public", name: "staff_resource_services" },
      { schema: "public", name: "resource_availability" },
      { schema: "public", name: "resource_time_off" },
      { schema: "public", name: "bookings" },
      { schema: "public", name: "tenant_memberships" },
      { schema: "public", name: "profiles" },
      { schema: "auth", name: "users" },
    ];
    const BLACKLIST_NAME_RE =
      /(^id$|_(at|token)$|_sent_at$|_confirmed_at$|_until$|_verified_at$|_checked_at$|_routing_verified_at$|_ownership_verified_at$|_synced_at$)/i;
    const BLACKLIST_EXACT = new Set([
      "raw_app_meta_data",
      "raw_user_meta_data",
      "recovery_token",
      "confirmation_token",
      "email_change_token_new",
      "email_change_token_current",
      "phone_change_token",
      "reauthentication_token",
      "instance_id",
      "avatar_url",
      "encrypted_password",
      "password_hash",
      "cookie_token",
      "signed_at",
    ]);
    const fixtureState = [];
    for (const t of fixtureTables) {
      try {
        const colInfo = (
          await c.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
            [t.schema, t.name],
          )
        ).rows;
        const cols = colInfo
          .filter((c) => {
            if (BLACKLIST_EXACT.has(c.column_name.toLowerCase())) return false;
            if (BLACKLIST_NAME_RE.test(c.column_name)) return false;
            if (/^(timestamp|date|time)/i.test(c.data_type)) return false;
            if (/^(jsonb?|uuid)$/i.test(c.data_type) && /^(raw_|metadata)$/i.test(c.column_name))
              return false;
            return true;
          })
          .map((c) => c.column_name);
        // PKs
        const pkQ = await c.query(
          `
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
           AND kcu.table_schema = tc.table_schema
           AND kcu.table_name = tc.table_name
          WHERE tc.table_schema=$1 AND tc.table_name=$2 AND tc.constraint_type='PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
          [t.schema, t.name],
        );
        const pkCols = pkQ.rows
          .map((r) => r.column_name)
          .filter((pkc) => !BLACKLIST_NAME_RE.test(pkc) && !BLACKLIST_EXACT.has(pkc.toLowerCase()));
        if (!pkCols.length && cols.length) pkCols.push(cols[0]);
        const orderCols = pkCols.slice(0, Math.min(3, pkCols.length));
        const selectExpr = cols.length ? cols : ["1 AS dummy"];
        const orderExpr = orderCols.length ? orderCols : ["1"];
        const sql = `SELECT ${selectExpr.map((c, i) => `to_jsonb("${c.replace(/"/g, "")}")::text AS v_${i}`).join(",")} FROM ${t.schema}.${t.name} x ORDER BY ${orderExpr.map((c, i) => `v_${i}`).join(",")}`;
        const rows = cols.length ? (await c.query(sql)).rows : [];
        const uuidRe = /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}"/gi;
        const tsRe =
          /"[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:?[0-9]{2}|Z)?"/gi;
        const tokenRe = /"[A-Za-z0-9_-]{24,}"/g;
        const concat = rows
          .map((r) => {
            const s = Object.values(r)
              .map((v) => String(v ?? ""))
              .join("|||");
            return s
              .replace(uuidRe, '"<UUID>"')
              .replace(tsRe, '"<TS>"')
              .replace(tokenRe, '"<TOKEN>"');
          })
          .join("\n");
        fixtureState.push({
          schema: t.schema,
          name: t.name,
          cols,
          count: rows.length,
          hash: md5(concat),
        });
      } catch (e) {
        fixtureState.push({
          schema: t.schema,
          name: t.name,
          error: String(e.message).slice(0, 200),
        });
      }
    }
    out.push(JSON.stringify(fixtureState, null, 0));
    return out.join("\n");
  } finally {
    c.release();
  }
}

async function main() {
  const label = process.argv[2] || "A";
  const out = await dumpSchema();
  const fp = `scripts/_double_reset_${label}.txt`;
  fs.writeFileSync(fp, out, "utf8");
  console.log(`[DOUBLE RESET ${label}] wrote ${fp} (size=${out.length}) hash=${md5(out)}`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
