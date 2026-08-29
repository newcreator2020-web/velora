/* eslint-disable no-console */
import pg from "pg";
const { Client } = pg;
function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const idx = Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p)));
  return s[idx];
}
function fmt(ns) {
  return Math.round(ns / 1000) + "μs";
}
function mkClient() {
  return new Client({
    host: "127.0.0.1",
    port: 54322,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
}
async function bench(label, fn, N) {
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
async function ctxSet(c, uid, tid) {
  await c.query("SET ROLE authenticated");
  await c.query(`SET request.jwt.claim.sub = '${uid}'`);
  await c.query(`SET request.jwt.claim.role = 'authenticated'`);
  await c.query(`SET app.current_tenant = '${tid}'`);
}
async function main() {
  const probe = mkClient();
  await probe.connect();
  const t = (
    await probe.query(`
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
  await probe.end();
  console.log("[PERF] ctx tid=%s rid=%s sid=%s uid=%s", t.tid, t.rid, t.sid, t.uid);
  // Setup baseline schedule once
  const setup = mkClient();
  await setup.connect();
  await ctxSet(setup, t.uid, t.tid);
  const cur = (
    await setup.query(`SELECT availability_version v FROM public.staff_resources WHERE id=$1`, [
      t.rid,
    ])
  ).rows[0].v;
  await setup.query({
    text: `SELECT * FROM public.dashboard_save_resource_weekly_schedule($1::uuid,$2::int,
    ARRAY[1,1,2,4,5,6]::smallint[],
    ARRAY['09:00','14:00','09:00','09:00','09:00','09:00']::time[],
    ARRAY['13:00','18:00','17:00','17:00','17:00','17:00']::time[],TRUE)`,
    values: [t.rid, cur],
  });
  await setup.end();
  // 1. READ: open new client each N
  await bench(
    "READ weekly schedule (explicit resource schedule)",
    async () => {
      const c = mkClient();
      await c.connect();
      await c.query("SELECT public.dashboard_get_resource_weekly_schedule($1::uuid)", [t.rid]);
      await c.end();
    },
    50,
  );
  // 2. SAVE
  await bench(
    "SAVE weekly schedule (version bump)",
    async () => {
      const c = mkClient();
      await c.connect();
      await ctxSet(c, t.uid, t.tid);
      const cv = (
        await c.query(`SELECT availability_version v FROM public.staff_resources WHERE id=$1`, [
          t.rid,
        ])
      ).rows[0].v;
      await c.query({
        text: `SELECT * FROM public.dashboard_save_resource_weekly_schedule($1::uuid,$2::int,
      ARRAY[1,1,2,4,5,6]::smallint[],
      ARRAY['09:00','14:00','09:00','09:00','09:00','09:00']::time[],
      ARRAY['13:00','18:00','17:00','17:00','17:00','17:00']::time[],TRUE)`,
        values: [t.rid, cv],
      });
      await c.end();
    },
    30,
  );
  // 3. SLOT generation: 28 days
  const monday = new Date();
  const iso = monday.getDay();
  monday.setDate(monday.getDate() + ((7 + 1 - iso) % 7 || 7));
  const mondayISO = monday.toISOString().slice(0, 10);
  const next = new Date(monday);
  next.setDate(next.getDate() + 6);
  const nextISO = next.toISOString().slice(0, 10);
  await bench(
    "SLOT generation (explicit resource, 7-day window)",
    async () => {
      const c = mkClient();
      await c.connect();
      await c.query(
        `SELECT COUNT(*) FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,$5::text)`,
        [t.tslug, t.sid, mondayISO, nextISO, "any"],
      );
      await c.end();
    },
    50,
  );
  // 4. Inherit business (no explicit RA) schedule
  {
    const c = mkClient();
    await c.connect();
    await ctxSet(c, t.uid, t.tid);
    const cv = (
      await c.query(`SELECT availability_version v FROM public.staff_resources WHERE id=$1`, [
        t.rid,
      ])
    ).rows[0].v;
    await c.query({
      text: `SELECT * FROM public.dashboard_save_resource_weekly_schedule($1::uuid,$2::int,
      ARRAY[]::smallint[], ARRAY[]::time[], ARRAY[]::time[], TRUE)`,
      values: [t.rid, cv],
    });
    await c.end();
  }
  await bench(
    "READ weekly schedule (inherit business fallback BA)",
    async () => {
      const c = mkClient();
      await c.connect();
      await c.query("SELECT public.dashboard_get_resource_weekly_schedule($1::uuid)", [t.rid]);
      await c.end();
    },
    50,
  );

  console.log("\n--- EXPLAIN ANALYZE BUFFERS ---");
  const exp = mkClient();
  await exp.connect();
  async function explain(label, qtext, params) {
    console.log("\n[EXPLAIN] ", label);
    console.log("params:", JSON.stringify(params ?? []));
    const rs = await exp.query({
      text: "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + qtext,
      values: params,
    });
    for (const row of rs.rows) {
      const ln = Object.values(row)[0];
      console.log("  ", ln);
    }
  }
  await explain(
    "RA intervals lookup (resource+weekday+enabled) — primary index scan?",
    `SELECT weekday, start_time, end_time FROM public.resource_availability WHERE tenant_id=$1 AND resource_id=$2 AND enabled=TRUE ORDER BY weekday, start_time`,
    [t.tid, t.rid],
  );
  await explain(
    "staff_resources version lookup by (tenant,resource_id)",
    `SELECT availability_version FROM public.staff_resources WHERE tenant_id=$1 AND id=$2`,
    [t.tid, t.rid],
  );
  const next7 = new Date(monday);
  next7.setDate(next7.getDate() + 6);
  await explain(
    "slot_engine_v3 public: 1 service, 7 days, single resource → slot generation path",
    `SELECT COUNT(*) FROM public.public_slot_get_available_v3($1::text,$2::uuid,$3::date,$4::date,$5::text)`,
    [t.tslug, t.sid, mondayISO, next7.toISOString().slice(0, 10), "any"],
  );
  await exp.end();
  console.log("\n--- PERF END ---");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
