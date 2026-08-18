import "dotenv/config";
import { Client } from "pg";

const buildPgOpts = () => ({
  host: process.env.SUPABASE_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? "postgres",
  user: process.env.SUPABASE_DB_USER ?? "postgres",
  password: process.env.SUPABASE_DB_PASSWORD ?? "postgres",
});

const pg = new Client(buildPgOpts());
await pg.connect();
const slugs = ["velora-e2e-pub-barber-a", "velora-e2e-pub-beauty-b", "velora-e2e-unpublished-c"];
await pg.query("ALTER TABLE public.tenant_memberships DISABLE TRIGGER tg_guard_last_active_owner");
for (const s of slugs) {
  const { rows: tids } = await pg.query("SELECT id FROM public.tenants WHERE slug = $1", [s]);
  for (const { id } of tids) {
    await pg.query("DELETE FROM public.site_sections WHERE tenant_id = $1", [id]);
    await pg.query("DELETE FROM public.services WHERE tenant_id = $1", [id]);
    await pg.query("DELETE FROM public.business_profiles WHERE tenant_id = $1", [id]);
    await pg.query("DELETE FROM public.tenant_memberships WHERE tenant_id = $1", [id]);
    await pg.query("DELETE FROM public.audit_logs WHERE tenant_id = $1", [id]);
  }
  await pg.query("DELETE FROM public.tenants WHERE slug = $1", [s]);
}
await pg.query("ALTER TABLE public.tenant_memberships ENABLE TRIGGER tg_guard_last_active_owner");
const { rows } = await pg.query("SELECT COUNT(*)::int FROM public.tenants");
console.warn("[cleanup] tenants post-cleanup:", rows[0].count);
await pg.end();
