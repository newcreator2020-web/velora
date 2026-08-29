import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
async function main() {
  const c = await pool.connect();
  try {
    const t = (
      await c.query(`
      SELECT t.id AS tid, sr.id AS rid, s.id AS sid, sr.availability_version AS v, au.id AS uid, tm.role
      FROM public.tenants t
      JOIN public.staff_resources sr ON sr.tenant_id=t.id
      JOIN public.services s ON s.tenant_id=t.id
      JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.role IN ('owner','manager','staff')
      JOIN auth.users au ON au.id=tm.user_id
      WHERE t.status='active'
      ORDER BY t.id LIMIT 1`)
    ).rows[0];
    console.log(
      "[SCHD01] uid=%s tid=%s rid=%s role=%s baseline V=%s",
      t.uid,
      t.tid,
      t.rid,
      t.role,
      t.v,
    );
    // Simulate authenticated user
    const setCtx = `SET ROLE authenticated; SET request.jwt.claim.sub = '${t.uid}'; SET request.jwt.claim.role = 'authenticated'; SET app.current_tenant = '${t.tid}';`;

    await c.query(`BEGIN; ${setCtx}`);
    // 1. VALID split shift
    try {
      const r = await c.query(
        `SELECT * FROM public.dashboard_save_resource_weekly_schedule(
        $1::uuid, $2::int,
        ARRAY[1,1,2,3,4,5,6]::smallint[],
        ARRAY['09:00'::time,'14:00'::time,'09:00'::time,'09:00'::time,'09:00'::time,'09:00'::time,'09:00'::time],
        ARRAY['13:00'::time,'18:00'::time,'17:00'::time,'17:00'::time,'17:00'::time,'17:00'::time,'17:00'::time],
        TRUE
      )`,
        [t.rid, t.v],
      );
      console.log("[SCHD01] VALID save rows:", JSON.stringify(r.rows));
      const ver = (
        await c.query(`SELECT availability_version FROM public.staff_resources WHERE id=$1`, [
          t.rid,
        ])
      ).rows[0].availability_version;
      console.log("[SCHD01] VALID version bump %s -> %s", t.v, ver);
    } catch (e) {
      console.log("[SCHD01] VALID FAIL SQLSTATE=%s MSG=%s", e.code, e.message.split("\n")[0]);
    }
    await c.query(`ROLLBACK`);

    // 2. INVALID overlap
    await c.query(`BEGIN; ${setCtx}`);
    try {
      const ver = (
        await c.query(`SELECT availability_version FROM public.staff_resources WHERE id=$1`, [
          t.rid,
        ])
      ).rows[0].availability_version;
      await c.query(
        `SELECT * FROM public.dashboard_save_resource_weekly_schedule(
        $1::uuid, $2::int,
        ARRAY[1,1]::smallint[],
        ARRAY['10:00'::time,'11:00'::time],
        ARRAY['14:00'::time,'15:00'::time],
        TRUE
      )`,
        [t.rid, ver],
      );
      console.log("[SCHD01] INVALID overlap -> UNEXPECTED success (SCHD01 not raised!)");
    } catch (e) {
      const match =
        e.code === "SCHD01" || e.code === "SCHD02" || e.code === "RWA05" || e.code === "23P01";
      console.log(
        "[SCHD01] INVALID overlap DENY: SQLSTATE=%s CONTRACT_MATCH=%s MSG=%s",
        e.code,
        match,
        e.message.split("\n")[0],
      );
    }
    await c.query(`ROLLBACK`);

    // --- STABLE semantic proof ---
    const rows = (
      await c.query(`
      SELECT proname, pg_get_functiondef(oid) AS def
      FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        AND provolatile='s' AND (proname LIKE '%schedule%' OR proname LIKE '%resource%' OR proname LIKE '%booking%' OR proname LIKE '%slot%' OR proname LIKE '%overlap%' OR proname LIKE '%weekly%')
      ORDER BY 1`)
    ).rows;
    const verdict = [];
    for (const r of rows) {
      const def = r.def;
      let body = def;
      const m = /\$\$([\s\S]*)\$\$\s*LANGUAGE/i.exec(def);
      if (m) body = m[1];
      body = body
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/'([^']|'')*'/g, "''");
      const w =
        /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE|CREATE\s+TABLE|ALTER\s+TABLE|LOCK\s+TABLE|NEXTVAL\(|SETVAL\(|SET_CONFIG\s*\()/i.exec(
          body,
        );
      const cr =
        /\b(CLOCK_TIMESTAMP\(|TIMEOFDAY\(|RANDOM\(|GEN_RANDOM_UUID\(|UUID_GENERATE_V4\(|NEXTVAL\(|CURRVAL\(|LASTVAL\(|SETVAL\(|NOW\(\)|CURRENT_TIMESTAMP|TRANSACTION_TIMESTAMP|STATEMENT_TIMESTAMP)/i.exec(
          body,
        );
      verdict.push({
        proname: r.proname,
        has_writes: !!w,
        write_op: w?.[0] ?? null,
        uses_clock_rand_seq: !!cr,
        cr_op: cr?.[0] ?? null,
        stable_semantically_correct: !w && !cr,
      });
    }
    console.log("\n[STABLE semantic proof] key scheduling STABLE functions:");
    console.table(verdict);
    // dashboard_get_resource_weekly_schedule body?
    const g = (
      await c.query(
        `SELECT proname, pg_get_functiondef(oid) d FROM pg_proc WHERE proname='dashboard_get_resource_weekly_schedule'`,
      )
    ).rows[0];
    console.log(
      "\n[STABLE semantic proof] dashboard_get_resource_weekly_schedule def (only write/volatile markers listed):",
    );
    const body = (/LANGUAGE\s+\w+\s+STABLE\s+.*?\$\$([\s\S]*?)\$\$/i.exec(g.d)?.[1] ?? "")
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/'([^']|'')*'/g, "''");
    console.log(
      "  has insert/update/delete/nextval? %s",
      /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|NEXTVAL|SETVAL)\b/i.test(body)
        ? "YES (WRONG)"
        : "NO (read-only CORRECT)",
    );
    console.log(
      "  uses clock/random/seq? %s",
      /\b(CLOCK_TIMESTAMP|RANDOM|GEN_RANDOM_UUID|NEXTVAL|CURRVAL|LASTVAL|SETVAL|NOW|CURRENT_TIMESTAMP|TRANSACTION_TIMESTAMP|STATEMENT_TIMESTAMP)\b/i.test(
        body,
      )
        ? "YES"
        : "NO",
    );
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
