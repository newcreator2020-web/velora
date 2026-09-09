import "server-only";
import Link from "next/link";
import {
  extractServerSession,
  requireTenantRole,
  getCurrentTenantContext,
} from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";

export const metadata = { title: "Audit log — VELORA" };

type AuditRow = Database["public"]["Tables"]["audit_logs"]["Row"] & {
  tenants?: { slug: string | null; name: string | null } | null;
  profiles?: { display_name: string | null; email?: string | null } | null;
};

type SearchParams = Promise<{
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  tenant?: string;
  actor?: string;
  format?: string;
}>;

type AuditPageProps = {
  searchParams?: SearchParams;
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

function safeParseIsoDay(raw: string | undefined | null): Date | null {
  if (!raw || typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatItIso(iso: string | null, tz: string): string {
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
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.substring(0, n) + "…";
}

export default async function AuditPage(props: AuditPageProps) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) {
    return (
      <main style={{ padding: 24 }}>
        <p>Sessione non valida. Accedi nuovamente.</p>
      </main>
    );
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
  if (!isPlatformAdmin) {
    const ownerCtx = await requireTenantRole("owner");
    scopedTenantId = ownerCtx.business_profile.tenant_id;
  }

  const spRaw = (await (props.searchParams ?? Promise.resolve({}))) ?? {};
  const sp = spRaw as Record<string, unknown>;
  const actionRaw = sp["action"];
  const actionFilter =
    typeof actionRaw === "string" && KNOWN_ACTIONS.includes(actionRaw) ? actionRaw : "";
  const actorRaw = sp["actor"];
  const actorFilter =
    typeof actorRaw === "string" && actorRaw.trim().length > 0 ? actorRaw.trim() : "";
  const dateFromRaw = sp["dateFrom"];
  const dateFrom = safeParseIsoDay(typeof dateFromRaw === "string" ? dateFromRaw : null);
  const dateToRaw = sp["dateTo"];
  const dateTo = safeParseIsoDay(typeof dateToRaw === "string" ? dateToRaw : null);
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
    .limit(500);

  if (!isPlatformAdmin && scopedTenantId) {
    q = q.eq("tenant_id", scopedTenantId);
  } else if (isPlatformAdmin && tenantFilter.length > 0) {
    q = q.eq("tenant_id", tenantFilter);
  }

  if (actionFilter.length > 0) {
    q = q.eq("action", actionFilter);
  }
  if (dateFrom) {
    q = q.gte("created_at", dateFrom.toISOString());
  }
  if (dateTo) {
    const end = new Date(dateTo.getTime());
    end.setUTCHours(23, 59, 59, 999);
    q = q.lte("created_at", end.toISOString());
  }
  if (actorFilter.length > 0) {
    const like = `%${actorFilter.replace(/%/g, "")}%`;
    q = q.or(
      `profiles.display_name.ilike.${like},profiles.email.ilike.${like},actor_user_id.eq.${actorFilter}`,
    );
  }

  const rows = (await q) as { data: AuditRow[] | null; error: unknown };

  const tenantsForFilter = isPlatformAdmin
    ? (
        await svc
          .from("tenants")
          .select("id,slug,name")
          .order("name", { nullsFirst: false })
          .limit(200)
      ).data
    : null;

  const rowsData = (rows.data ?? []) as AuditRow[];

  const currentQs = new URLSearchParams();
  if (actionFilter) currentQs.set("action", actionFilter);
  if (actorFilter) currentQs.set("actor", actorFilter);
  if (typeof dateFromRaw === "string" && dateFromRaw.length > 0)
    currentQs.set("dateFrom", dateFromRaw);
  if (typeof dateToRaw === "string" && dateToRaw.length > 0) currentQs.set("dateTo", dateToRaw);
  if (isPlatformAdmin && tenantFilter) currentQs.set("tenant", tenantFilter);
  const qsStr = currentQs.toString();
  const csvHref = `/app/audit/export${qsStr.length > 0 ? `?${qsStr}` : ""}`;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f8fafc",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <header
          style={{
            marginBottom: 20,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", margin: 0 }}>
              Audit log
            </h1>
            <p style={{ marginTop: 4, fontSize: 14, color: "#6b7280", margin: 0 }}>
              {isPlatformAdmin
                ? "Vista SUPER_ADMIN: tutti i tenant sono visibili. Massimo 500 righe per query."
                : `Vista OWNER: solo eventi del tenant ${ctx.business_profile?.display_name ?? ctx.tenant?.slug ?? ""}. Massimo 500 righe.`}
            </p>
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/app/analytics"
              style={{
                fontSize: 13,
                padding: "6px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "white",
                color: "#111827",
                textDecoration: "none",
              }}
            >
              Analytics
            </Link>
            <a
              href={csvHref}
              style={{
                fontSize: 13,
                padding: "6px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                background: "#111827",
                color: "white",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Esporta CSV
            </a>
          </nav>
        </header>

        <section
          style={{
            marginBottom: 20,
            padding: 16,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
          }}
        >
          <form
            method="GET"
            action="/app/audit"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              alignItems: "flex-end",
            }}
          >
            <div>
              <label
                htmlFor="audit-filter-action"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                Azione
              </label>
              <select
                id="audit-filter-action"
                name="action"
                defaultValue={actionFilter}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                  width: "100%",
                }}
              >
                <option value="">Tutte le azioni</option>
                {KNOWN_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="audit-filter-datefrom"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                Da
              </label>
              <input
                id="audit-filter-datefrom"
                name="dateFrom"
                type="date"
                defaultValue={typeof dateFromRaw === "string" ? dateFromRaw : ""}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                  width: "100%",
                }}
              />
            </div>
            <div>
              <label
                htmlFor="audit-filter-dateto"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                A
              </label>
              <input
                id="audit-filter-dateto"
                name="dateTo"
                type="date"
                defaultValue={typeof dateToRaw === "string" ? dateToRaw : ""}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                  width: "100%",
                }}
              />
            </div>

            {isPlatformAdmin ? (
              <div>
                <label
                  htmlFor="audit-filter-tenant"
                  style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
                >
                  Tenant
                </label>
                <select
                  id="audit-filter-tenant"
                  name="tenant"
                  defaultValue={tenantFilter}
                  style={{
                    marginTop: 4,
                    padding: "6px 10px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 14,
                    background: "white",
                    width: "100%",
                  }}
                >
                  <option value="">Tutti i tenant</option>
                  {(tenantsForFilter ?? []).map((t) => {
                    const r = t as { id: string; slug: string | null; name: string | null };
                    return (
                      <option key={r.id} value={r.id}>
                        {r.name ?? r.slug ?? r.id.substring(0, 8)}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="audit-filter-actor"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                Attore (nome o email)
              </label>
              <input
                id="audit-filter-actor"
                name="actor"
                type="text"
                defaultValue={actorFilter}
                placeholder="Cerca Mario o mario@..."
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                  width: "100%",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: "7px 14px",
                  borderRadius: 8,
                  background: "#111827",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Applica
              </button>
              <a
                href="/app/audit"
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  background: "white",
                  color: "#374151",
                  fontSize: 14,
                  border: "1px solid #d1d5db",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Reset
              </a>
            </div>
          </form>
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#6b7280",
              padding: "12px 16px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              Righe restituite: <strong style={{ color: "#111827" }}>{rowsData.length}</strong>
              {rowsData.length >= 500 ? (
                <span style={{ marginLeft: 10, color: "#b91c1c" }}>(limite 500 raggiunto)</span>
              ) : null}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {[
                    "Timestamp",
                    "Azione",
                    "Tenant",
                    "Attore",
                    "Target",
                    "Detail",
                    "Correlation",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 12px",
                        textAlign: "left",
                        borderBottom: "1px solid #e5e7eb",
                        fontWeight: 600,
                        fontSize: 12,
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: 40,
                        textAlign: "center",
                        color: "#6b7280",
                        fontSize: 14,
                      }}
                    >
                      Nessun evento audit trovato con i filtri selezionati.
                    </td>
                  </tr>
                ) : (
                  rowsData.map((r) => {
                    const t = (r.tenants ?? {}) as { slug?: string | null; name?: string | null };
                    const p = (r.profiles ?? {}) as {
                      display_name?: string | null;
                      email?: string | null;
                    };
                    const actionBadgeBg = r.action.startsWith("platform_admin")
                      ? "#fef3c7"
                      : r.action.startsWith("membership") || r.action.startsWith("tenant")
                        ? "#dbeafe"
                        : r.action.startsWith("booking")
                          ? "#dcfce7"
                          : r.action.startsWith("system")
                            ? "#fee2e2"
                            : "#f3f4f6";
                    const actionBadgeFg = r.action.startsWith("platform_admin")
                      ? "#92400e"
                      : r.action.startsWith("membership") || r.action.startsWith("tenant")
                        ? "#1e40af"
                        : r.action.startsWith("booking")
                          ? "#166534"
                          : r.action.startsWith("system")
                            ? "#991b1b"
                            : "#111827";
                    const metadataStr =
                      r.metadata && typeof r.metadata === "object"
                        ? JSON.stringify(r.metadata)
                        : String(r.metadata ?? "");
                    const mdRow = r.metadata as Record<string, unknown> | null;
                    const corrId =
                      mdRow &&
                      typeof mdRow === "object" &&
                      !Array.isArray(mdRow) &&
                      "correlation_id" in mdRow
                        ? String(mdRow["correlation_id"] ?? "")
                        : "";
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td
                          style={{
                            padding: "10px 12px",
                            whiteSpace: "nowrap",
                            color: "#374151",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            fontSize: 12,
                          }}
                        >
                          {formatItIso(r.created_at, tz)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              background: actionBadgeBg,
                              color: actionBadgeFg,
                            }}
                          >
                            {r.action}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#374151" }}>
                          <div style={{ fontWeight: 500 }}>{t.name ?? "-"}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>
                            {t.slug ?? r.tenant_id?.substring(0, 8)}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#374151" }}>
                          <div style={{ fontWeight: 500 }}>{p.display_name ?? "— sistema"}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>
                            {p.email ?? r.actor_user_id?.substring(0, 8)}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#374151", fontSize: 12 }}>
                          <div>{r.entity_type ?? "-"}</div>
                          <div
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              color: "#6b7280",
                              fontSize: 11,
                            }}
                          >
                            {r.entity_id ? r.entity_id.substring(0, 10) : "-"}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            maxWidth: 360,
                            fontSize: 12,
                            color: "#374151",
                          }}
                          title={metadataStr}
                        >
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 11,
                              background: "#f8fafc",
                              padding: "6px 8px",
                              borderRadius: 6,
                              maxHeight: 120,
                              overflow: "auto",
                            }}
                          >
                            {truncate(metadataStr, 300)}
                          </pre>
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            fontSize: 11,
                            color: corrId ? "#1d4ed8" : "#9ca3af",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {corrId ? corrId.substring(0, 13) + "…" : "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
