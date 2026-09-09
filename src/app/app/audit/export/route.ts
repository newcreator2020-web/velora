import "server-only";
import { NextResponse } from "next/server";
import {
  extractServerSession,
  requireTenantRole,
  getCurrentTenantContext,
} from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";

type AuditRow = Database["public"]["Tables"]["audit_logs"]["Row"] & {
  tenants?: { slug: string | null; name: string | null } | null;
  profiles?: { display_name: string | null; email?: string | null } | null;
};

const KNOWN_ACTIONS = [
  "tenant.created",
  "tenant.updated",
  "tenant.status_changed",
  "membership.created",
  "membership.updated",
  "membership.revoked",
  "profile.updated",
  "business_profile.updated",
  "platform_admin.granted",
  "platform_admin.revoked",
  "plan.changed",
  "system.seed",
  "system.migration",
  "booking.created",
  "booking.updated",
  "booking.cancelled",
  "booking.completed",
  "media.uploaded",
  "prospect.created",
  "prospect.updated",
  "customer.created",
  "timeoff.created",
  "timeoff.updated",
  "timeoff.deleted",
  "resource.created",
  "resource.updated",
];

function safeParseIsoDay(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object") {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await getCurrentTenantContext();
    if (!ctx.user) {
      return NextResponse.json({ ok: false, code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const sess = await extractServerSession();
    let isPlatformAdmin = false;
    if (sess && sess.user.id === ctx.user.id) {
      const svcCheck = getSupabaseServiceClient();
      const paRow = await svcCheck
        .from("platform_admins")
        .select("status")
        .eq("user_id", sess.user.id)
        .limit(1)
        .maybeSingle();
      isPlatformAdmin = paRow.data?.status === "active";
    }

    let scopedTenantId: string | null = null;
    if (isPlatformAdmin) {
      scopedTenantId = null;
    } else {
      const ownerCtx = await requireTenantRole("owner");
      scopedTenantId = ownerCtx.business_profile.tenant_id;
    }

    const url = new URL(req.url);
    const sp: Record<string, unknown> = {};
    url.searchParams.forEach((v, k) => {
      sp[k] = v;
    });
    const actionRaw = sp["action"];
    const actionFilter =
      typeof actionRaw === "string" && KNOWN_ACTIONS.includes(actionRaw) ? actionRaw : "";
    const actorRaw = sp["actor"];
    const actorFilter =
      typeof actorRaw === "string" && actorRaw.trim().length > 0 ? actorRaw.trim() : "";
    const dateFromRaw = sp["dateFrom"];
    const dateFrom = safeParseIsoDay(dateFromRaw);
    const dateToRaw = sp["dateTo"];
    const dateTo = safeParseIsoDay(dateToRaw);
    const tenantRaw = sp["tenant"];
    const tenantFilter = isPlatformAdmin && typeof tenantRaw === "string" ? tenantRaw.trim() : "";

    const tz = ctx.business_profile?.timezone ?? "Europe/Rome";
    const svc = getSupabaseServiceClient();

    let q = svc
      .from("audit_logs")
      .select(
        "id,tenant_id,actor_user_id,action,entity_type,entity_id,metadata,created_at,tenants:tenant_id(id,slug,name),profiles:actor_user_id(id,display_name,email)",
      )
      .order("created_at", { ascending: false })
      .limit(10_000);

    if (!isPlatformAdmin && scopedTenantId) {
      q = q.eq("tenant_id", scopedTenantId);
    } else if (isPlatformAdmin && tenantFilter.length > 0) {
      q = q.eq("tenant_id", tenantFilter);
    }

    if (actionFilter.length > 0) {
      q = q.eq("action", actionFilter);
    }
    if (dateFrom) {
      q = q.gte("created_at", dateFrom.toISOString().replace(/T00:00:00\.000Z$/, "T00:00:00Z"));
    }
    if (dateTo) {
      q = q.lte("created_at", dateTo.toISOString().replace(/T00:00:00\.000Z$/, "T23:59:59Z"));
    }
    if (actorFilter.length > 0) {
      const svcInner = getSupabaseServiceClient() as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            or: (filters: string) => {
              limit: (n: number) => Promise<{ data?: unknown[] | null }>;
            };
          };
        };
      };
      const actorP = (await (svcInner
        .from("profiles")
        .select("id")
        .or(`display_name.ilike.%${actorFilter}%,email.ilike.%${actorFilter}%,id.eq.${actorFilter}`)
        .limit(50) as unknown as Promise<{ data?: unknown[] | null }>)) as {
        data?: unknown[] | null;
      };
      const ids = (actorP.data ?? []) as Array<{ id: string }>;
      if (ids.length === 0) {
        q = q.eq("actor_user_id", "00000000-0000-0000-0000-000000000000");
      } else if (ids.length === 1) {
        q = q.eq("actor_user_id", ids[0]!.id);
      } else {
        q = q.in(
          "actor_user_id",
          ids.map((r) => r.id),
        );
      }
    }

    const { data, error } = (await q) as {
      data?: AuditRow[] | null;
      error?: { message: string } | null;
    };
    if (error) {
      return NextResponse.json(
        { ok: false, code: "DB_ERROR", message: error.message },
        { status: 500 },
      );
    }
    const rowsData = (data ?? []) as AuditRow[];

    const headers = [
      "timestamp_utc",
      "timestamp_local",
      "action",
      "tenant_id",
      "tenant_slug",
      "tenant_name",
      "actor_user_id",
      "actor_display",
      "actor_email",
      "target_type",
      "target_id",
      "correlation_id",
      "detail_json",
    ];
    const lines: string[] = [headers.map(escapeCsv).join(",")];
    for (const r of rowsData) {
      const t = (r.tenants ?? {}) as { slug?: string | null; name?: string | null };
      const p = (r.profiles ?? {}) as { display_name?: string | null; email?: string | null };
      const md = r.metadata as Record<string, unknown> | null;
      const corrId =
        md && typeof md === "object" && !Array.isArray(md) && "correlation_id" in md
          ? String(md["correlation_id"] ?? "")
          : "";
      const tsLocal = (() => {
        const iso = r.created_at;
        if (!iso) return "";
        try {
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return iso;
          const fmt = new Intl.DateTimeFormat("it-IT", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          });
          return fmt.format(d);
        } catch {
          return iso;
        }
      })();
      lines.push(
        [
          r.created_at,
          tsLocal,
          r.action,
          r.tenant_id ?? "",
          t.slug ?? "",
          t.name ?? "",
          r.actor_user_id ?? "",
          p.display_name ?? "",
          p.email ?? "",
          r.entity_type ?? "",
          r.entity_id ?? "",
          corrId,
          r.metadata && typeof r.metadata === "object"
            ? JSON.stringify(r.metadata)
            : String(r.metadata ?? ""),
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().substring(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message: err instanceof Error ? String(err.message) : "unexpected error",
      },
      { status: 500 },
    );
  }
}
