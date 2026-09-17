/* eslint-disable */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseAnonReadonlyClient } from "@/lib/supabase/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const env = process.env as Record<string, string | undefined>;

const SECRET = env["B1_TEMP_SECRET"] || crypto.randomUUID();
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function check(req: NextRequest) {
  const h = req.headers.get("x-b1-secret");
  if (!h || h !== SECRET) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action =
    url.searchParams.get("a") ||
    (url.pathname.includes("/migrate")
      ? "migrate"
      : url.pathname.includes("/seed")
        ? "seed"
        : url.pathname.includes("/readback")
          ? "readback"
          : "health");
  const err = check(req);
  if (err) return err;
  const svc: any = getSupabaseServiceClient();

  if (action === "health") {
    try {
      const counts: Record<string, number> = {};
      for (const t of [
        "tenants",
        "business_profiles",
        "services",
        "staff_resources",
        "bookings",
        "audit_logs",
        "site_sections",
        "business_availability",
        "service_staff_links",
        "tenant_memberships",
      ]) {
        try {
          const r = await svc.from(t).select("*", { count: "exact", head: true });
          counts[t] = r.count ?? -2;
        } catch {
          counts[t] = -1;
        }
      }
      let applied: string[] = [];
      try {
        const sm = await svc
          .schema("supabase_migrations")
          .from("schema_migrations")
          .select("version")
          .order("version");
        applied = (sm.data || []).map((r: any) => String(r.version));
      } catch {}
      return NextResponse.json(
        {
          ok: true,
          counts,
          applied_migrations: applied,
          applied_count: applied.length,
          env: {
            url_masked:
              (env["NEXT_PUBLIC_SUPABASE_URL"] || "").slice(0, 8) +
              "...len=" +
              (env["NEXT_PUBLIC_SUPABASE_URL"] || "").length,
            service_role_len: (env["SUPABASE_SERVICE_ROLE_KEY"] || "").length,
            B1_SECRET_len: SECRET.length,
          },
          ts: new Date().toISOString(),
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  if (action === "migrate") {
    try {
      const useBody = url.searchParams.get("useBody") === "1";
      let migrationsSQL: Array<{ version: string; sql: string }> = [];
      if (useBody) {
        const body = (await req.json()) as { migrations: Array<{ version: string; sql: string }> };
        migrationsSQL = body.migrations || [];
      } else {
        try {
          const dir = path.resolve(process.cwd(), "supabase", "migrations");
          const files = readdirSync(dir).sort();
          for (const f of files) {
            const m = /^(\d{14})_(.+)\.sql$/.exec(f);
            if (m)
              migrationsSQL.push({
                version: m[1] + "_" + m[2],
                sql: readFileSync(path.join(dir, f), "utf8"),
              });
          }
        } catch {}
      }
      let applied: string[] = [];
      try {
        const sm = await svc
          .schema("supabase_migrations")
          .from("schema_migrations")
          .select("version")
          .order("version");
        applied = (sm.data || []).map((r: any) => String(r.version));
      } catch {}
      const missing = migrationsSQL.filter((m) => !applied.includes(m.version));
      const results = missing.map((m) => {
        const verbsDDL =
          /\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMENT ON|CREATE EXTENSION|CREATE OR REPLACE FUNCTION)\b/i.test(
            m.sql,
          )
            ? "DDL"
            : "DML";
        return {
          version: m.version,
          len: m.sql.length,
          verbs: verbsDDL,
          can_run_via_service_role_rest:
            verbsDDL === "DML"
              ? "maybe"
              : "NO (PostgREST NON accetta DDL via REST; service role supabase-js non supporta query raw arbitrari)",
        };
      });
      return NextResponse.json(
        {
          ok: true,
          mode: "workaround via Vercel service role REST",
          warning:
            "⚠️ I WORKAROUND VERCEL ROUTE NON possono eseguire DDL arbitrari. Per applicare migration DDL mancanti serve: (a) SUPABASE_ACCESS_TOKEN personale + Management API v1 https://api.supabase.com/v1/projects/{ref}/database/query, oppure (b) Connessione pg pg_dump locale funzionante.",
          applied_count: applied.length,
          missing_count: missing.length,
          missing_versions: missing.map((m) => m.version),
          results,
          ts: new Date().toISOString(),
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  if (action === "seed") {
    try {
      const TENANT_ID = "27934ee0-da53-4e8b-b5f6-46258f6d156c";
      const OWNER_AUTH_SUB = "c531985b-fabc-46f3-8781-1a9395677162";
      const SLUG = "tonino-finalgate";
      const SVC_ID = "e7d1af8a-1111-4b5b-992a-aaaaaaaaaaaa";
      const STAFF_ID = "bb498a72-2222-4138-9155-bbbbbbbbbbbb";
      const NOW = new Date("2026-09-16T10:00:00Z").toISOString();

      // 1. Tenant UPSERT (cloud columns: id,slug,name,plan_id,status,published,published_at,created_at,updated_at,custom_domain,temporary_domain
      const t1 = await svc
        .from("tenants")
        .upsert(
          [
            {
              id: TENANT_ID,
              slug: SLUG,
              name: "Tonino Final Gate Barbershop",
              plan_id: "pro",
              status: "active",
              published: true,
              published_at: NOW,
              created_at: NOW,
              updated_at: NOW,
              custom_domain: null,
              temporary_domain: `${SLUG}.velora.app`,
            },
          ],
          { onConflict: "id", ignoreDuplicates: false },
        )
        .select("id,slug,name,status,published,plan_id");

      // 2. Business Profile UPSERT (cloud cols: tenant_id,display_name,legal_name,category,city,province,country_code,address_line1,postal_code,timezone,locale,phone,email,whatsapp,website_url,latitude,longitude
      const bp = await svc
        .from("business_profiles")
        .upsert(
          [
            {
              tenant_id: TENANT_ID,
              display_name: "Tonino Final Gate Barbershop",
              legal_name: "Tonino SRL",
              category: "barber",
              city: "Milano",
              province: "MI",
              country_code: "IT",
              address_line1: "Via Manzoni 1",
              address_line2: null,
              postal_code: "20121",
              timezone: "Europe/Rome",
              locale: "it-IT",
              phone: "+39 02 87654321",
              email: "tonino.owner-finalgate@velora.local",
              whatsapp: "+393339876543",
              website_url: null,
              latitude: 45.4809,
              longitude: 9.1906,
              description: "Barbershop Tonino Final Gate",
              created_at: NOW,
              updated_at: NOW,
            },
          ],
          { onConflict: "tenant_id", ignoreDuplicates: false },
        )
        .select("tenant_id,display_name,phone,email,city,latitude,longitude");

      // 3. Services UPSERT (cloud cols: id,tenant_id,name,description,duration_minutes,position,active,currency,price_from,...
      const svcRow = await svc
        .from("services")
        .upsert(
          [
            {
              id: SVC_ID,
              tenant_id: TENANT_ID,
              name: "Taglio Uomo Race",
              duration_minutes: 30,
              price_from: 1000,
              currency: "EUR",
              position: 1,
              active: true,
              description: "Taglio uomo standard 30 minuti",
              created_at: NOW,
              updated_at: NOW,
            },
          ],
          { onConflict: "id", ignoreDuplicates: false },
        )
        .select("id,name,duration_minutes,price_from,active,position,currency");

      // 4. Staff UPSERT (cloud cols: id,tenant_id,display_name,slug,color_hex,active,bookable,sort_order,linked_membership_id,...
      let staffRow: any = null;
      try {
        staffRow = await svc
          .from("staff_resources")
          .upsert(
            [
              {
                id: STAFF_ID,
                tenant_id: TENANT_ID,
                display_name: "Tonino",
                slug: "tonino",
                color_hex: "#000000",
                active: true,
                bookable: true,
                sort_order: 0,
                linked_membership_id: null,
                created_at: NOW,
                updated_at: NOW,
              },
            ],
            { onConflict: "id", ignoreDuplicates: false },
          )
          .select("id,display_name,active,slug");
      } catch (e) {
        staffRow = { error: String(e) };
      }

      // 5. Availability (cloud cols: tenant_id,weekday,start_time,end_time,enabled,created_at,updated_at)
      let availRows: any = null;
      const availPayloads = [1, 2, 3, 4, 5, 6].map((wd) => ({
        tenant_id: TENANT_ID,
        weekday: wd,
        enabled: true,
        start_time: "09:00",
        end_time: "18:00",
        created_at: NOW,
        updated_at: NOW,
      }));
      try {
        await svc.from("business_availability").delete().eq("tenant_id", TENANT_ID);
      } catch {}
      try {
        availRows = await svc
          .from("business_availability")
          .insert(availPayloads)
          .select("weekday,start_time,end_time,enabled");
      } catch (e1) {
        try {
          await svc.from("resource_availability").delete().eq("tenant_id", TENANT_ID);
          const raPayloads = [1, 2, 3, 4, 5, 6].map((wd) => ({
            tenant_id: TENANT_ID,
            resource_id: STAFF_ID,
            weekday: wd,
            enabled: true,
            start_time: "09:00",
            end_time: "18:00",
            created_at: NOW,
            updated_at: NOW,
          }));
          availRows = await svc
            .from("resource_availability")
            .insert(raPayloads)
            .select("weekday,start_time,end_time,resource_id");
        } catch (e2) {
          availRows = { error: String(e2) };
        }
      }

      // 6. Site sections (id=UUID reale, section_type,position,enabled,variant,settings,...
      let secRows: any = null;
      const secDefs: Array<[string, string, number]> = [
        ["hero", "Home hero + CTA", 1],
        ["about", "Chi siamo", 2],
        ["services", "I nostri servizi", 3],
        ["staff", "Il team", 4],
        ["gallery", "Galleria", 5],
        ["reviews", "Recensioni", 6],
        ["contact", "Contatti e prenotazioni", 7],
      ];
      try {
        await svc.from("site_sections").delete().eq("tenant_id", TENANT_ID);
      } catch {}
      try {
        secRows = await svc
          .from("site_sections")
          .insert(
            secDefs.map(([type, title, pos]) => ({
              id: crypto.randomUUID(),
              tenant_id: TENANT_ID,
              section_type: type,
              position: pos,
              enabled: true,
              variant: "default",
              settings: { title } as any,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })),
          )
          .select("section_type,position,enabled,variant");
      } catch (e) {
        secRows = { error: String(e) };
      }

      // 7. Staff resource services links (staff_resource_services, resource_id = staff_id
      let linksRow: any = null;
      const linkPayload = {
        tenant_id: TENANT_ID,
        service_id: SVC_ID,
        resource_id: STAFF_ID,
        active: true,
        duration_override_minutes: null,
        created_at: NOW,
        updated_at: NOW,
      };
      try {
        await svc
          .from("staff_resource_services")
          .delete()
          .match({ tenant_id: TENANT_ID, service_id: SVC_ID, resource_id: STAFF_ID });
        linksRow = await svc
          .from("staff_resource_services")
          .insert(linkPayload)
          .select("resource_id,service_id,active");
      } catch (e1) {
        try {
          await svc
            .from("staff_service_links")
            .delete()
            .match({ tenant_id: TENANT_ID, service_id: SVC_ID, resource_id: STAFF_ID });
          linksRow = await svc
            .from("staff_service_links")
            .insert(linkPayload)
            .select("resource_id,service_id,active");
        } catch (e2) {
          linksRow = { error: String(e2) };
        }
      }

      // 8. Owner membership
      let ownerStatus = "skipped";
      try {
        const ex = await svc
          .from("tenant_memberships")
          .select("id,role")
          .match({ user_id: OWNER_AUTH_SUB, tenant_id: TENANT_ID })
          .maybeSingle();
        if (ex.data) {
          ownerStatus = "already_exists: " + ex.data.role;
        } else {
          await svc.from("tenant_memberships").insert({
            tenant_id: TENANT_ID,
            user_id: OWNER_AUTH_SUB,
            role: "owner",
            status: "active",
          });
          ownerStatus = "inserted_owner";
        }
      } catch (e) {
        ownerStatus = "error: " + String(e);
      }

      return NextResponse.json(
        {
          ok: true,
          ts: new Date().toISOString(),
          tenant: t1.data,
          bp: bp.data,
          services: svcRow.data,
          staff: staffRow?.data ?? staffRow,
          availability: availRows?.data ?? availRows,
          sections: secRows?.data ?? secRows,
          service_staff_links: linksRow?.data ?? linksRow,
          owner_membership: ownerStatus,
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: String(e?.message || e),
          stack: e?.stack ? e.stack.slice(0, 500) : undefined,
        },
        { status: 500 },
      );
    }
  }

  if (action === "readback") {
    try {
      const slug = url.searchParams.get("slug") || "tonino-finalgate";
      const t = await svc
        .from("tenants")
        .select("id,slug,name,status,published,plan_id")
        .eq("slug", slug)
        .maybeSingle();
      let bp: any = null,
        srv: any = null,
        stf: any = null,
        avl: any = null,
        sct: any = null,
        links: any = null,
        bookings:
          | {
              data?: unknown[] | null;
              error?: unknown;
            }
          | null = null;
      if (t.data) {
        bp = await svc
          .from("business_profiles")
          .select(
            "display_name,legal_name,phone,email,city,province,country_code,latitude,longitude,whatsapp,address_line1,timezone,locale",
          )
          .eq("tenant_id", t.data.id)
          .maybeSingle();
        srv = await svc
          .from("services")
          .select("id,name,duration_minutes,price_from,currency,active,position")
          .eq("tenant_id", t.data.id)
          .order("position");
        stf = await svc
          .from("staff_resources")
          .select("id,display_name,slug,active,bookable,color_hex,sort_order")
          .eq("tenant_id", t.data.id);
        avl = await svc
          .from("business_availability")
          .select("weekday,start_time,end_time,enabled")
          .eq("tenant_id", t.data.id)
          .order("weekday");
        if (!avl.data || avl.data.length === 0) {
          try {
            avl = await svc
              .from("resource_availability")
              .select("weekday,start_time,end_time,enabled,resource_id")
              .eq("tenant_id", t.data.id)
              .order("weekday");
          } catch {}
        }
        sct = await svc
          .from("site_sections")
          .select("id,section_type,position,enabled,variant,settings")
          .eq("tenant_id", t.data.id)
          .order("position");
        try {
          links = await svc
            .from("staff_resource_services")
            .select("resource_id,service_id,active")
            .eq("tenant_id", t.data.id);
        } catch (e1) {
          try {
            links = await svc
              .from("staff_service_links")
              .select("resource_id,service_id,active")
              .eq("tenant_id", t.data.id);
          } catch {}
        }
        try {
          bookings = await svc
            .from("bookings")
            .select("*")
            .eq("tenant_id", t.data!.id)
            .order("created_at", { ascending: false })
            .limit(10);
        } catch (_e) {
          bookings = { data: [] };
        }
      }
      return NextResponse.json(
        {
          ok: true,
          ts: new Date().toISOString(),
          slug,
          tenant: t.data,
          bp: bp?.data,
          services: srv?.data,
          staff: stf?.data,
          availability: avl?.data,
          sections: sct?.data,
          staff_service_links: links?.data,
          bookings: bookings?.data,
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  if (action === "test-anon") {
    try {
      const slug = url.searchParams.get("slug") || "tonino-finalgate";
      const tid = url.searchParams.get("tenant_id") || "27934ee0-da53-4e8b-b5f6-46258f6d156c";
      const an: any = createSupabaseAnonReadonlyClient();
      const t = await an
        .from("tenants")
        .select("id,slug,name,status,published,plan_id")
        .eq("id", tid)
        .maybeSingle();
      const srv = await an
        .from("services")
        .select("id,name,duration_minutes,price_from,currency,active,position")
        .eq("tenant_id", tid)
        .order("position");
      const sec = await an
        .from("site_sections")
        .select("section_type,enabled,position")
        .eq("tenant_id", tid)
        .order("position");
      const cnt = await an.from("tenants").select("id", { count: "exact", head: true });
      const sec_count = cnt.count;
      return NextResponse.json(
        {
          ok: true,
          ts: new Date().toISOString(),
          slug_param: slug,
          tenant_id: tid,
          tenant: t.data,
          tenant_error: t.error ? String(t.error.message || t.error) : null,
          services_count: srv.data?.length ?? 0,
          services_error: srv.error ? String(srv.error.message || srv.error) : null,
          services: srv.data,
          sections_count: sec.data?.length ?? 0,
          sections_error: sec.error ? String(sec.error.message || sec.error) : null,
          sections: sec.data,
          total_tenants_visible_count: sec_count ?? -1,
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: String(e?.message || e),
          stack: e?.stack ? String(e.stack).slice(0, 500) : undefined,
        },
        { status: 500 },
      );
    }
  }

  if (action === "debug-compare") {
    try {
      const slug = url.searchParams.get("slug") || "tonino-finalgate";
      let resolveResult: any = null;
      let tenantId = url.searchParams.get("tenant_id") || "";
      try {
        const mod = await import("@/lib/server/site-engine");
        const parsed = mod.slugSchema.safeParse(slug);
        if (parsed.success) {
          const r: any = await mod.resolvePublicTenant({ slug: parsed.data });
          resolveResult = {
            _tag: r._tag,
            ...("site" in r
              ? {
                  tenantId: r.tenantId,
                  siteSlug: r.site.slug,
                  businessName: r.site.businessName,
                  canonicalPath: r.site.canonicalPath,
                  status: r.site.status,
                  published: r.site.published,
                }
              : {}),
          };
          if ("tenantId" in r && r.tenantId) tenantId = String(r.tenantId);
        }
      } catch (e) {
        resolveResult = { error: String(e) };
      }
      if (!tenantId) tenantId = "27934ee0-da53-4e8b-b5f6-46258f6d156c";

      const selectFields = "id,name,duration_minutes,price_from,currency,active";
      const sampleOf = (arr: any[]) =>
        arr.slice(0, 3).map((s: any) => ({
          id: s.id,
          name: s.name,
          active: s.active,
          dur: s.duration_minutes,
          price: s.price_from,
          cur: s.currency,
        }));

      const clA: any = createSupabaseAnonReadonlyClient();
      const qA = await clA
        .from("services")
        .select(selectFields)
        .eq("tenant_id", tenantId)
        .order("position")
        .order("name");

      let qB: any = { data: null, error: null };
      try {
        const srvMod = await import("@/lib/supabase/server");
        const clB = await srvMod.createSupabaseServerClient();
        qB = await (clB as any)
          .from("services")
          .select(selectFields)
          .eq("tenant_id", tenantId)
          .order("position")
          .order("name");
      } catch (eB) {
        qB = { data: null, error: String(eB) };
      }

      const clC: any = svc;
      const qC = await clC
        .from("services")
        .select(selectFields)
        .eq("tenant_id", tenantId)
        .order("position")
        .order("name");

      const qATen = await clA
        .from("tenants")
        .select("id,slug,name,status,published,plan_id")
        .eq("id", tenantId)
        .maybeSingle();
      const qBTen: any = { data: null, error: null };
      try {
        const srvMod = await import("@/lib/supabase/server");
        const clB = await srvMod.createSupabaseServerClient();
        qBTen.data = await (clB as any)
          .from("tenants")
          .select("id,slug,name,status,published,plan_id")
          .eq("id", tenantId)
          .maybeSingle()
          .then((r: any) => r.data);
      } catch (eB) {
        qBTen.error = String(eB);
      }

      return NextResponse.json(
        {
          ok: true,
          ts: new Date().toISOString(),
          slug,
          resolveResult,
          tenantId_used: tenantId,
          tenant_anon: qATen.data ?? null,
          tenant_server: qBTen.data ?? null,
          tenant_server_error: qBTen.error ?? null,
          clientA_anon_readonly: {
            count: qA.data?.length ?? 0,
            error: qA.error ? String(qA.error.message || qA.error) : null,
            sample: sampleOf(qA.data ?? []),
          },
          clientB_server_cookie: {
            count: Array.isArray(qB.data) ? qB.data.length : 0,
            error:
              !Array.isArray(qB.data) && qB.error
                ? typeof qB.error === "string"
                  ? qB.error
                  : String(qB.error.message || qB.error)
                : null,
            sample: Array.isArray(qB.data) ? sampleOf(qB.data) : null,
          },
          clientC_service_role: {
            count: qC.data?.length ?? 0,
            error: qC.error ? String(qC.error.message || qC.error) : null,
            sample: sampleOf(qC.data ?? []),
          },
        },
        { status: 200 },
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: String(e?.message || e),
          stack: e?.stack ? String(e.stack).slice(0, 500) : undefined,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "unknown action. use ?a=health|migrate|seed|readback|test-anon|debug-compare" },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
