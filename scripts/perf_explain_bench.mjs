import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p)));
  return s[idx];
}
function fmt(ns) {
  return Math.round(ns / 1000) + "μs";
}
async function bench(label, fn, N) {
  // warm
  for (let i = 0; i < Math.min(5, N); i++) await fn(i);
  const t0 = process.hrtime.bigint();
  const lat = [];
  for (let i = 0; i < N; i++) {
    const s = process.hrtime.bigint();
    await fn(i);
    lat.push(Number(process.hrtime.bigint() - s));
  }
  const dur = Number(process.hrtime.bigint() - t0);
  const min = Math.min(...lat),
    max = Math.max(...lat);
  console.log(
    "[PERF] %s N=%s total=%sms min=%s p50=%s p95=%s max=%s qps=%s",
    label,
    N,
    Math.round(dur / 1e6),
    fmt(min),
    fmt(pct(lat, 0.5)),
    fmt(pct(lat, 0.95)),
    fmt(max),
    Math.round((1e9 * N) / dur),
  );
}
async function main() {
  const c = await pool.connect();
  try {
    const t = (
      await c.query(`
      SELECT t.id AS tid, t.slug AS tslug, bp.timezone AS tz,
             sr.id AS rid, sr.slug AS rslug, sr.availability_version AS v,
             s.id AS sid, au.id AS uid, tm.role
      FROM public.tenants t
      JOIN public.staff_resources sr ON sr.tenant_id=t.id
      JOIN public.services s ON s.tenant_id=t.id
      JOIN public.business_profiles bp ON bp.tenant_id=t.id
      JOIN public.tenant_memberships tm ON tm.tenant_id=t.id AND tm.role='owner'
      JOIN auth.users au ON au.id=tm.user_id
      WHERE t.status='active' ORDER BY t.id LIMIT 1`)
    ).rows[0];
    console.log("[PERF] ctx tid=%s rid=%s sid=%s uid=%s", t.tid, t.rid, t.sid, t.uid);
    // save baseline schedule (Mon 09-13/14-18, Wed OFF, inherit rest)
    const ctx = `SET ROLE authenticated; SET request.jwt.claim.sub='${t.uid}'; SET request.jwt.claim.role='authenticated'; SET app.current_tenant='${t.tid}';`;
    await c.query(`BEGIN; ${ctx}; SELECT * FROM public.dashboard_save_resource_weekly_schedule(
      '${t.rid}'::uuid, ${t.v}::int,
      ARRAY[1,1,2,4,5,6]::smallint[],
      ARRAY['09:00','14:00','09:00','09:00','09:00','09:00']::time[],
      ARRAY['13:00','18:00','17:00','17:00','17:00','17:00']::time[],
      TRUE
    ); COMMIT;`);
    // 1. READ weekly schedule (dashboard_get_resource_weekly_schedule)
    await bench(
      "READ weekly schedule (explicit resource)",
      async () => {
        await c.query(`SELECT public.dashboard_get_resource_weekly_schedule($1::uuid)`, [t.rid]);
      },
      50,
    );
    // 2. SAVE weekly (no change → version bump anyway)
    await bench(
      "SAVE weekly schedule (no-op write, version bump)",
      async () => {
        const cur = (
          await c.query(`SELECT availability_version v FROM public.staff_resources WHERE id=$1`, [
            t.rid,
          ])
        ).rows[0].v;
        await c.query(
          `BEGIN; ${ctx}; SELECT * FROM public.dashboard_save_resource_weekly_schedule($1::uuid,$2::int,
        ARRAY[1,1,2,4,5,6]::smallint[],
        ARRAY['09:00','14:00','09:00','09:00','09:00','09:00']::time[],
        ARRAY['13:00','18:00','17:00','17:00','17:00','17:00']::time[],TRUE); COMMIT;`,
          [t.rid, cur],
        );
      },
      30,
    );
    // 3. SLOT generation (slot_engine_v3 public)
    const monday = new Date();
    const iso = monday.getDay();
    monday.setDate(monday.getDate() + ((7 + 1 - iso) % 7 || 7));
    const mondayISO = monday.toISOString().slice(0, 10);
    const nextISO = new Date(monday);
    nextISO.setDate(nextISO.getDate() + 28);
    const nextISO2 = nextISO.toISOString().slice(0, 10);
    await bench(
      "SLOT generation (explicit resource, 28d range)",
      async () => {
        await c.query(
          `SELECT COUNT(*) FROM public.slot_engine_v3($1::text,$2::uuid,$3::uuid,$4::date,$5::date,$6::text)`,
          [t.tslug, t.tid, t.sid, mondayISO, nextISO2, t.tz],
        );
      },
      50,
    );
    // 4. INHERIT business (no RA explicit → fallback BA): delete RA rows for resource first
    await c.query(
      `BEGIN; ${ctx}; SELECT * FROM public.dashboard_save_resource_weekly_schedule($1::uuid,(SELECT availability_version FROM public.staff_resources WHERE id=$1),
      ARRAY[]::smallint[], ARRAY[]::time[], ARRAY[]::time[],TRUE); COMMIT;`,
      [t.rid],
    );
    await bench(
      "READ weekly schedule (inherit business fallback)",
      async () => {
        await c.query(`SELECT public.dashboard_get_resource_weekly_schedule($1::uuid)`, [t.rid]);
      },
      50,
    );
    console.log("\n--- EXPLAIN ANALYZE BUFFERS ---");
    const explain = async (label, q, params = []) => {
      console.log("\nQUERY:", label, "\nparams:", JSON.stringify(params));
      const r = (await c.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + q, params)).rows;
      for (const row of r.rows) {
        console.log("  ", Object.values(row)[0]);
      }
    };
    await explain(
      "RA resource/day lookup enabled intervals",
      `SELECT weekday, start_time, end_time FROM public.resource_availability WHERE tenant_id=$1 AND resource_id=$2 AND enabled=TRUE ORDER BY weekday, start_time`,
      [t.tid, t.rid],
    );
    await explain(
      "staff_resources version lookup + row lock",
      `SELECT availability_version FROM public.staff_resources WHERE tenant_id=$1 AND id=$2`,
      [t.tid, t.rid],
    );
    await explain(
      "slot path: slot_engine_v3 count 1 resource 7 days",
      `SELECT COUNT(*) FROM public.slot_engine_v3($1::text,$2::uuid,$3::uuid,$4::date,$5::date,$6::text)`,
      [
        t.tslug,
        t.tid,
        t.sid,
        mondayISO,
        new Date(monday.getTime() + 6 * 864e5).toISOString().slice(0, 10),
        t.tz,
      ],
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
