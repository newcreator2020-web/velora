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
    const fixture = await c.query(`
      SELECT t.id AS t, sr.id AS r, s.id AS sv
      FROM public.tenants t
      JOIN public.staff_resources sr ON sr.tenant_id=t.id
      JOIN public.services s ON s.tenant_id=t.id
      WHERE t.status='active'
      ORDER BY t.id, sr.id, s.id LIMIT 1`);
    let tenant, res, svc;
    if (fixture.rows[0]) {
      tenant = fixture.rows[0].t;
      res = fixture.rows[0].r;
      svc = fixture.rows[0].sv;
    } else {
      tenant = crypto.randomUUID();
      res = crypto.randomUUID();
      svc = crypto.randomUUID();
      await c.query(
        `INSERT INTO public.tenants(id,name,slug,status,published,plan_id) VALUES ($1,'t1','t-schd01-'||substr(md5(random()::text),1,5),'active',true,'internal_test')`,
        [tenant],
      );
      await c.query(
        `INSERT INTO public.business_profiles(tenant_id,display_name,timezone,locale,category) VALUES ($1,'x','Europe/Rome','it-IT','x')`,
        [tenant],
      );
      for (let w = 1; w <= 6; w++) {
        await c.query(
          `INSERT INTO public.business_availability(tenant_id,weekday,enabled,start_time,end_time) VALUES ($1,$2,true,'09:00','19:00') ON CONFLICT DO NOTHING`,
          [tenant, w],
        );
      }
      await c.query(
        `INSERT INTO public.services(id,tenant_id,name,duration_minutes,active) VALUES ($1,$2,'s1',30,true)`,
        [svc, tenant],
      );
      await c.query(
        `INSERT INTO public.staff_resources(id,tenant_id,slug,display_name,active,bookable,availability_version) VALUES ($1,$2,'r1','R1',true,true,0)`,
        [res, tenant],
      );
      await c.query(
        `INSERT INTO public.staff_resource_services(tenant_id,resource_id,service_id,active) VALUES ($1,$2,$3,true)`,
        [tenant, res, svc],
      );
    }
    const vres = await c.query(
      `SELECT availability_version FROM public.staff_resources WHERE id=$1`,
      [res],
    );
    const v0 = vres.rows[0].availability_version;
    console.log("[SCHD01 proof] tenant=%s res=%s baseline version=%s", tenant, res, v0);

    // VALID SAVE (split shift Monday)
    try {
      await c.query(
        `SELECT public.rpc_save_resource_weekly_schedule(
        $1::uuid, $2::int,
        $3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb
      )`,
        [
          res,
          v0,
          JSON.stringify({
            enabled: true,
            intervals: [
              { start: "09:00", end: "13:00" },
              { start: "14:00", end: "18:00" },
            ],
          }),
          JSON.stringify({ enabled: true, intervals: [{ start: "09:00", end: "13:00" }] }),
          JSON.stringify({ enabled: false, intervals: [] }),
          JSON.stringify({ enabled: true, intervals: [{ start: "09:00", end: "13:00" }] }),
          JSON.stringify({ enabled: true, intervals: [{ start: "09:00", end: "13:00" }] }),
          JSON.stringify({ enabled: true, intervals: [{ start: "09:00", end: "13:00" }] }),
          JSON.stringify({ enabled: false, intervals: [] }),
        ],
      );
      const v1 = (
        await c.query(`SELECT availability_version FROM public.staff_resources WHERE id=$1`, [res])
      ).rows[0].availability_version;
      console.log("[SCHD01 proof] VALID SAVE OK. version %s -> %s (expected bump)", v0, v1);
    } catch (e) {
      console.log(
        "[SCHD01 proof] VALID SAVE FAIL SQLSTATE=%s ERR=%s",
        e.code,
        e.message.split("\n")[0],
      );
    }

    // INVALID OVERLAP
    try {
      const vu = (
        await c.query(`SELECT availability_version FROM public.staff_resources WHERE id=$1`, [res])
      ).rows[0].availability_version;
      await c.query(
        `SELECT public.rpc_save_resource_weekly_schedule(
        $1::uuid, $2::int,
        $3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb
      )`,
        [
          res,
          vu,
          JSON.stringify({
            enabled: true,
            intervals: [
              { start: "10:00", end: "14:00" },
              { start: "11:00", end: "15:00" },
            ],
          }),
          JSON.stringify({ enabled: false }),
          JSON.stringify({ enabled: false }),
          JSON.stringify({ enabled: false }),
          JSON.stringify({ enabled: false }),
          JSON.stringify({ enabled: false }),
          JSON.stringify({ enabled: false }),
        ],
      );
      console.log(
        "[SCHD01 proof] INVALID overlap -> UNEXPECTED success (should throw SCHD01/SCHD02)",
      );
    } catch (e) {
      console.log(
        "[SCHD01 proof] INVALID overlap -> CORRECTLY DENIED. SQLSTATE=%s ERR=%s",
        e.code,
        e.message.split("\n")[0],
      );
    }

    // STABLE volatility proof
    console.log(
      "\n[STABLE proof] volatility for key scheduling funcs (provolatile v=VOLATILE s=STABLE i=IMMUTABLE):",
    );
    const vol = await c.query(`
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
             p.provolatile, p.proleakproof,
             (CASE WHEN p.provolatile='v' THEN 'VOLATILE' WHEN p.provolatile='s' THEN 'STABLE' WHEN p.provolatile='i' THEN 'IMMUTABLE' END) AS volatility
      FROM pg_proc p
      WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
        AND (p.proname IN ('rpc_save_resource_weekly_schedule','__f14d_validate_intervals','__f14d_count_row_for_weekday','__f14d_merge_business_clip','__ra_norm','__ra_merge_adjacent','__ra_detect_overlap')
          OR p.proname LIKE '%weekly_schedule%'
          OR p.proname LIKE '%resource_day%'
          OR p.proname LIKE '%resource_week%'
          OR p.proname LIKE '%_slot_v3%')
      ORDER BY 1, 2
    `);
    console.table(vol.rows);
    // semantic check: is there any STABLE function that performs writes / uses random / uses sequences?
    const suspect = await c.query(`
      SELECT proname, volatility, writes_sql::text AS contains_writes,
             uses_clock_rand_seq::text AS uses_clock_or_seq
      FROM (
        SELECT p.proname,
               CASE p.provolatile WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' WHEN 'i' THEN 'IMMUTABLE' END volatility,
               pg_get_functiondef(p.oid) ~* 'insert|update|delete|drop|truncate|create|alter|nextval|setval|lock table|begin|commit|rollback|perform pg_' AS writes_sql,
               pg_get_functiondef(p.oid) ~* 'clock_timestamp|timeofday|random\\(\\)|gen_random_uuid\\(\\)|uuid_generate_v4|nextval|currval|lastval|setval' AS uses_clock_rand_seq
        FROM pg_proc p
        WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
          AND p.provolatile='s'
          AND (pg_get_functiondef(p.oid) ~* 'resource|schedule|ra_|slot|booking' OR p.proname LIKE '%schedule%' OR p.proname LIKE '%resource%' OR p.proname LIKE '%slot%')
      ) x
      ORDER BY 1
    `);
    console.log("\n[STABLE proof] semantic side-effect check on STABLE scheduling funcs:");
    console.table(suspect.rows);
    console.log(
      "\n[STABLE proof] note: rpc_save_resource_weekly_schedule MUST be VOLATILE (it writes). read-only helpers CAN be STABLE (safe).",
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
