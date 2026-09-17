import { redirect } from "next/navigation";
import { getCurrentTenantContext } from "@/lib/server/auth";
import { LogoutButton } from "@/app/(app)/dashboard/LogoutButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = { title: "Dashboard — VELORA" };

type DashboardKpis = {
  bookingsThisWeek: number;
  bookingsPrevWeek: number;
  newCustomersThisMonth: number;
  revenueMonthEur: number;
  upcomingToday: Array<{
    booking_id: string;
    starts_at: string;
    ends_at: string;
    customer_name: string | null;
    service_id: string | null;
    service_name: string | null;
    status: string;
  }>;
  verifyingDomains: Array<{ id: string; domain: string; created_at: string }>;
};

function weekBoundaries(tz: string): {
  thisStart: Date;
  thisEnd: Date;
  prevStart: Date;
  prevEnd: Date;
} {
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("it-IT", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(todayLocal.find((p) => p.type === "year")?.value ?? now.getFullYear());
  const m = Number(todayLocal.find((p) => p.type === "month")?.value ?? now.getMonth() + 1) - 1;
  const d = Number(todayLocal.find((p) => p.type === "day")?.value ?? now.getDate());
  const localCivil = new Date(y, m, d, 0, 0, 0, 0);
  const wd = (localCivil.getDay() + 6) % 7;
  const thisMon = new Date(localCivil);
  thisMon.setDate(localCivil.getDate() - wd);
  const thisSun = new Date(thisMon);
  thisSun.setDate(thisMon.getDate() + 7);
  const prevMon = new Date(thisMon);
  prevMon.setDate(thisMon.getDate() - 7);
  const prevSun = new Date(thisMon);
  prevSun.setDate(thisMon.getDate());
  const toUtcIso = (civil: Date) =>
    new Date(Date.UTC(civil.getFullYear(), civil.getMonth(), civil.getDate(), 0, 0, 0));
  return {
    thisStart: toUtcIso(thisMon),
    thisEnd: toUtcIso(thisSun),
    prevStart: toUtcIso(prevMon),
    prevEnd: toUtcIso(prevSun),
  };
}

function monthBoundaries(tz: string): { monthStart: Date; todayEnd: Date } {
  const now = new Date();
  const todayLocal = new Intl.DateTimeFormat("it-IT", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(todayLocal.find((p) => p.type === "year")?.value ?? now.getFullYear());
  const m = Number(todayLocal.find((p) => p.type === "month")?.value ?? now.getMonth() + 1) - 1;
  const d = Number(todayLocal.find((p) => p.type === "day")?.value ?? now.getDate());
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const todayEnd = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
  return { monthStart, todayEnd };
}

async function loadDashboardKpis(tenantId: string, tz: string): Promise<DashboardKpis> {
  const supabase = await createSupabaseServerClient();
  const wb = weekBoundaries(tz);
  const mb = monthBoundaries(tz);

  const [
    { count: bookingsThisWeek },
    { count: bookingsPrevWeek },
    { count: newCustomersThisMonth },
    revenueRows,
    upcomingRaw,
    domainsRaw,
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("starts_at", wb.thisStart.toISOString())
      .lt("starts_at", wb.thisEnd.toISOString())
      .in("status", ["confirmed", "completed", "pending"]),
    supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("starts_at", wb.prevStart.toISOString())
      .lt("starts_at", wb.prevEnd.toISOString())
      .in("status", ["confirmed", "completed", "pending"]),
    supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", mb.monthStart.toISOString())
      .lt("created_at", mb.todayEnd.toISOString()),
    supabase
      .from("bookings")
      .select("price_from, status")
      .eq("tenant_id", tenantId)
      .gte("starts_at", mb.monthStart.toISOString())
      .lt("starts_at", mb.todayEnd.toISOString())
      .in("status", ["confirmed", "completed"]),
    supabase
      .from("bookings")
      .select(
        "id:booking_id, starts_at, ends_at, customer_name, service_id, status, service:service_id(name)",
      )
      .eq("tenant_id", tenantId)
      .gte("starts_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .lt("starts_at", new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
      .in("status", ["pending", "confirmed", "completed"])
      .order("starts_at", { ascending: true })
      .limit(5),
    supabase
      .from("tenants")
      .select("id, custom_domain, created_at, custom_domain_status")
      .eq("id", tenantId)
      .not("custom_domain", "is", null)
      .in("custom_domain_status", ["pending"]),
  ]);

  const revenueMonthEur =
    revenueRows.data?.reduce<number>((sum, r) => {
      const price = Number((r as unknown as { price_from?: number | null }).price_from ?? 0);
      return Number.isFinite(price) ? sum + price : sum;
    }, 0) ?? 0;

  const upcomingToday = (upcomingRaw.data ?? []).map((r) => ({
    booking_id: String((r as unknown as { id?: unknown }).id ?? ""),
    starts_at: String((r as unknown as { starts_at?: unknown }).starts_at ?? ""),
    ends_at: String((r as unknown as { ends_at?: unknown }).ends_at ?? ""),
    customer_name: (r as unknown as { customer_name?: string | null }).customer_name ?? null,
    service_id: (r as unknown as { service_id?: string | null }).service_id ?? null,
    service_name: ((
      (r as unknown as { service?: unknown }).service as { name?: string | null } | undefined
    )?.name ?? null) as string | null,
    status: String((r as unknown as { status?: unknown }).status ?? ""),
  }));

  const now = Date.now();
  const verifyingDomains = (domainsRaw.data ?? [])
    .filter((r) => {
      const ca = new Date(String((r as unknown as { created_at: string }).created_at)).getTime();
      return now - ca > 48 * 60 * 60 * 1000;
    })
    .map((r) => ({
      id: String((r as unknown as { id: string }).id),
      domain: String((r as unknown as { custom_domain: string }).custom_domain),
      created_at: String((r as unknown as { created_at: string }).created_at),
    }));

  return {
    bookingsThisWeek: bookingsThisWeek ?? 0,
    bookingsPrevWeek: bookingsPrevWeek ?? 0,
    newCustomersThisMonth: newCustomersThisMonth ?? 0,
    revenueMonthEur,
    upcomingToday,
    verifyingDomains,
  };
}

export default async function AppDashboardPage() {
  const ctx = await getCurrentTenantContext();
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  const tz = ctx.business_profile.timezone || "Europe/Rome";
  const kpis = await loadDashboardKpis(ctx.tenant.id, tz);

  const { tenant, business_profile, membership, user } = ctx;
  const deltaPct =
    kpis.bookingsPrevWeek === 0
      ? kpis.bookingsThisWeek > 0
        ? 100
        : 0
      : Math.round(((kpis.bookingsThisWeek - kpis.bookingsPrevWeek) / kpis.bookingsPrevWeek) * 100);
  const deltaClass = deltaPct >= 0 ? "#0f766e" : "#991b1b";
  const deltaLabel = deltaPct >= 0 ? `+${deltaPct}% vs scorsa` : `${deltaPct}% vs scorsa`;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "transparent",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "white",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>
              VELORA · AREA ATTIVITÀ
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 600 }}>
              Ciao {user.display_name ?? user.auth_email.split("@")[0]} 👋
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href="/app/settings"
              style={{
                padding: "9px 14px",
                background: "white",
                color: "#0f172a",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                fontWeight: 500,
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              Impostazioni attività
            </Link>
            <LogoutButton />
          </div>
        </header>

        {kpis.verifyingDomains.length > 0 ? (
          <section
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              padding: "12px 16px",
              borderRadius: 12,
              fontSize: 14,
            }}
          >
            <strong>Attenzione:</strong> {kpis.verifyingDomains.length} dominio/i in attesa verifica
            DNS da oltre 48h:
            <ul style={{ margin: "8px 0 0 20px", padding: 0 }}>
              {kpis.verifyingDomains.map((d) => (
                <li key={d.id}>
                  <Link href="/app/site" style={{ color: "#78350f", textDecoration: "underline" }}>
                    {d.domain}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          style={{
            background: "white",
            borderRadius: 12,
            padding: 20,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>Panoramica</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <KpiCard
              title="Prenotazioni questa settimana"
              value={String(kpis.bookingsThisWeek)}
              delta={deltaLabel}
              deltaColor={deltaClass}
              icon="📅"
            />
            <KpiCard
              title="Nuovi clienti nel mese"
              value={String(kpis.newCustomersThisMonth)}
              icon="👥"
            />
            <KpiCard
              title="Incasso stimato mese"
              value={`€${kpis.revenueMonthEur.toFixed(2)}`}
              icon="💶"
            />
            <KpiCard
              title="Appuntamenti oggi"
              value={String(kpis.upcomingToday.length)}
              icon="⏰"
            />
          </div>
        </section>

        <section
          style={{
            background: "white",
            borderRadius: 12,
            padding: 20,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Scorciatoie</h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <Shortcut href="/app/admin/clients" label="Clienti" icon="🧑‍💼" />
            <Shortcut href="/app/site" label="Sito & Studio" icon="🎨" />
            <Shortcut href="/app/calendar" label="Calendario" icon="🗓️" />
            <Shortcut href="/app/customers" label="CRM Clienti" icon="📖" />
            <Shortcut href="/app/billing" label="Billing" icon="💳" />
            <Shortcut href="/app/admin/prospects" label="Prospecting" icon="🎯" />
          </div>
        </section>

        <section
          style={{
            background: "white",
            borderRadius: 12,
            padding: 20,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600 }}>Prossimi 5 di oggi</h2>
          {kpis.upcomingToday.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
              Nessun appuntamento per oggi.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {kpis.upcomingToday.map((b) => (
                <li
                  key={b.booking_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {b.customer_name ?? "Cliente"}
                    </div>
                    <div style={{ color: "#475569", fontSize: 13 }}>
                      {b.service_name ?? "Servizio"} · stato: {b.status}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 13,
                      color: "#0f172a",
                    }}
                  >
                    {safeFormatDate(b.starts_at, tz)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>La tua attività</h2>
            <Link
              href="/app/settings"
              style={{
                fontSize: 13,
                color: "#2563eb",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Modifica dati →
            </Link>
          </div>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              margin: "16px 0 0",
            }}
          >
            <Info label="Nome attività" value={business_profile.display_name ?? tenant.name} />
            <Info label="Categoria" value={business_profile.category ?? "—"} />
            <Info label="Città" value={business_profile.city ?? "—"} />
            <Info label="Provincia" value={business_profile.province ?? "—"} />
            <Info label="CAP" value={business_profile.postal_code ?? "—"} />
            <Info label="Indirizzo" value={business_profile.address_line1 ?? "—"} />
            <Info label="Email" value={business_profile.email ?? "—"} />
            <Info label="Telefono" value={business_profile.phone ?? "—"} />
            <Info label="Stato account" value={tenant.status} />
            <Info label="Il tuo ruolo" value={membership.role} capitalize />
            <Info label="Slug" value={tenant.slug} mono />
            <Info label="Timezone" value={tz} />
          </dl>
          {business_profile.description ? (
            <div
              style={{
                marginTop: 20,
                padding: "14px 16px",
                borderRadius: 10,
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  fontWeight: 500,
                  marginBottom: 6,
                }}
              >
                Descrizione
              </div>
              <div
                style={{ fontSize: 14, color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.5 }}
              >
                {business_profile.description}
              </div>
            </div>
          ) : null}
        </section>

        <footer
          style={{
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
            padding: 10,
          }}
        >
          Dati recuperati in tempo reale tramite RLS · Dashboard KPI · VELORA MILESTONE A3
        </footer>
      </div>
    </div>
  );
}

function safeFormatDate(iso: string, tz: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return iso;
  }
}

function KpiCard({
  title,
  value,
  delta,
  deltaColor,
  icon,
}: {
  title: string;
  value: string;
  delta?: string;
  deltaColor?: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {icon ? <span style={{ fontSize: 18 }}>{icon}</span> : null}
        <span
          style={{
            fontSize: 12,
            color: "#64748b",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontWeight: 600,
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{value}</div>
      {delta ? (
        <div style={{ fontSize: 12, color: deltaColor ?? "#475569", marginTop: 4 }}>{delta}</div>
      ) : null}
    </div>
  );
}

function Shortcut({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        color: "#0f172a",
        textDecoration: "none",
        fontWeight: 600,
        fontSize: 14,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function Info({
  label,
  value,
  capitalize,
  mono,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "#f8fafc",
        border: "1px solid #e5e7eb",
      }}
    >
      <dt
        style={{
          fontSize: 12,
          color: "#64748b",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: "6px 0 0",
          fontSize: 15,
          fontWeight: 500,
          color: "#0f172a",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textTransform: capitalize ? "capitalize" : undefined,
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : undefined,
        }}
      >
        {value}
      </dd>
    </div>
  );
}
