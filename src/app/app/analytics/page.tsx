import { requireTenantRole } from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import Link from "next/link";

export const metadata = { title: "Analytics — VELORA" };

type SearchParams = Promise<{
  dateFrom?: string;
  dateTo?: string;
}>;

type AnalyticsPageProps = {
  searchParams?: SearchParams;
};

function safeParseIsoDay(raw: string | undefined | null): Date | null {
  if (!raw || typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIsoDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysUtc(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function formatShortIt(rawIsoDay: string): string {
  const [y, m, d] = rawIsoDay.split("-");
  if (!y || !m || !d) return rawIsoDay;
  return `${d}/${m}`;
}

function KpiCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent ?? "#6b7280",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1.1,
          color: "#111827",
        }}
      >
        {value}
      </div>
      {subtitle ? (
        <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>{subtitle}</div>
      ) : null}
    </div>
  );
}

export default async function AnalyticsPage(props: AnalyticsPageProps) {
  const ctx = await requireTenantRole("manager");
  const tenantId = ctx.business_profile.tenant_id;
  const spRaw = (await (props.searchParams ?? Promise.resolve({}))) ?? {};
  const sp = spRaw as Record<string, unknown>;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const defaultFrom = addDaysUtc(todayUtc, -29);

  const dfRaw = sp["dateFrom"];
  const dtRaw = sp["dateTo"];
  const fromParsed = safeParseIsoDay(typeof dfRaw === "string" ? dfRaw : null);
  const toParsed = safeParseIsoDay(typeof dtRaw === "string" ? dtRaw : null);
  const fromDate = fromParsed ?? defaultFrom;
  const toDate = toParsed ?? todayUtc;

  const fromIso = toIsoDay(fromDate) + "T00:00:00Z";
  const toIso = toIsoDay(toDate) + "T23:59:59Z";

  const svc = getSupabaseServiceClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: unknown,
        ) => {
          gte: (
            col: string,
            val: unknown,
          ) => {
            lte: (
              col: string,
              val: unknown,
            ) => {
              order: (
                col: string,
                opts?: Record<string, unknown>,
              ) => {
                limit: (n: number) => Promise<{ data?: unknown[] | null }>;
              } & Promise<{ data?: unknown[] | null }>;
            } & {
              in: (col: string, vals: readonly string[]) => Promise<{ data?: unknown[] | null }>;
            } & Promise<{ data?: unknown[] | null }>;
          } & Promise<{ data?: unknown[] | null }>;
        } & Promise<{ data?: unknown[] | null }>;
      } & Promise<{ data?: unknown[] | null }>;
    } & Promise<{ data?: unknown[] | null }>;
  };

  const actionCountsPromise = (async () =>
    (
      (await (svc
        .from("interaction_events")
        .select("action")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso) as unknown as Promise<{ data?: unknown[] | null }>)) as {
        data?: unknown[] | null;
      }
    ).data ?? [])() as Promise<Array<{ action: string }>>;

  const dailyPromise = (async () =>
    (
      (await (svc
        .from("interaction_events")
        .select("occurred_at,action")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso) as unknown as Promise<{ data?: unknown[] | null }>)) as {
        data?: unknown[] | null;
      }
    ).data ?? [])() as Promise<Array<{ occurred_at: string; action: string }>>;

  const topServicesPromise = (async () =>
    (
      (await (svc
        .from("interaction_events")
        .select("label,action,meta")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso) as unknown as Promise<{ data?: unknown[] | null }>)) as {
        data?: unknown[] | null;
      }
    ).data ?? [])() as Promise<Array<{ label: string | null; action: string; meta: unknown }>>;

  const [actionRows, dailyRows, topRows] = await Promise.all([
    actionCountsPromise,
    dailyPromise,
    topServicesPromise,
  ]);

  function countAction(a: string): number {
    let c = 0;
    for (const r of actionRows) if (r.action === a) c++;
    return c;
  }

  const visits = countAction("page_view");
  const clickBook = countAction("click_book");
  const clickCall = countAction("click_call");
  const clickWa = countAction("click_whatsapp");
  const clickMaps = countAction("click_maps");
  const bookingStarted = countAction("booking_started");
  const bookingConfirmed = countAction("booking_confirmed");
  const bookingCancelled = countAction("booking_cancelled");

  const conversionRate =
    clickBook > 0 ? Math.round((bookingConfirmed / clickBook) * 10_000) / 100 : 0;

  const dailyBuckets = new Map<string, { label: string; total: number; book: number }>();
  const cursor = new Date(fromDate.getTime());
  while (cursor <= toDate) {
    const key = toIsoDay(cursor);
    dailyBuckets.set(key, { label: formatShortIt(key), total: 0, book: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  let maxDaily = 1;
  for (const r of dailyRows) {
    const isoR = r.occurred_at ? r.occurred_at.substring(0, 10) : "";
    const b = dailyBuckets.get(isoR);
    if (!b) continue;
    b.total += 1;
    if (r.action === "click_book" || r.action.startsWith("booking_")) b.book += 1;
    if (b.total > maxDaily) maxDaily = b.total;
  }
  const dailyOrdered = Array.from(dailyBuckets.values());

  const svcAgg = new Map<string, number>();
  for (const r of topRows) {
    const meta = r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : null;
    const fromMeta =
      meta && typeof meta["service_name"] === "string" ? meta["service_name"].trim() : "";
    const fromLabel = typeof r.label === "string" ? r.label.trim() : "";
    const key = fromMeta.length > 0 ? fromMeta : fromLabel.length > 0 ? fromLabel : null;
    if (!key) continue;
    svcAgg.set(key, (svcAgg.get(key) ?? 0) + 1);
  }
  const topServices = Array.from(svcAgg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const fromDayQ = toIsoDay(fromDate);
  const toDayQ = toIsoDay(toDate);

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
          maxWidth: 1120,
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
              Analytics
            </h1>
            <p style={{ marginTop: 4, fontSize: 14, color: "#6b7280", margin: 0 }}>
              Prestazioni sito pubblico e funnel prenotazioni di{" "}
              <strong>{ctx.business_profile.display_name ?? ctx.tenant.slug}</strong>.
            </p>
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/app/audit"
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
              Audit log
            </Link>
            <Link
              href="/app/bookings"
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
              Appuntamenti
            </Link>
          </nav>
        </header>

        <section
          style={{
            marginBottom: 20,
            padding: 16,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <form
            method="GET"
            action="/app/analytics"
            style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
          >
            <div>
              <label
                htmlFor="dateFrom"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                Da
              </label>
              <input
                id="dateFrom"
                name="dateFrom"
                type="date"
                defaultValue={fromDayQ}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                }}
              />
            </div>
            <div>
              <label
                htmlFor="dateTo"
                style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block" }}
              >
                A
              </label>
              <input
                id="dateTo"
                name="dateTo"
                type="date"
                defaultValue={toDayQ}
                style={{
                  marginTop: 4,
                  padding: "6px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "white",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
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
            <button
              type="button"
              onClick={(e) => {
                const f = (e.currentTarget as HTMLButtonElement).form;
                if (!f) return;
                const a = f.elements.namedItem("dateFrom") as HTMLInputElement | null;
                const b = f.elements.namedItem("dateTo") as HTMLInputElement | null;
                if (a && b) {
                  a.value = "";
                  b.value = "";
                  f.submit();
                }
              }}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                background: "white",
                color: "#374151",
                fontSize: 14,
                border: "1px solid #d1d5db",
                cursor: "pointer",
              }}
            >
              Ultimi 30 giorni
            </button>
          </form>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
            marginBottom: 22,
          }}
        >
          <KpiCard title="Visite (30d)" value={visits} subtitle="page_view" accent="#2563eb" />
          <KpiCard title="Click Prenota" value={clickBook} subtitle="click_book" accent="#16a34a" />
          <KpiCard
            title="Click Telefono"
            value={clickCall}
            subtitle="click_call"
            accent="#ca8a04"
          />
          <KpiCard
            title="Conversion booking"
            value={`${conversionRate.toFixed(1)}%`}
            subtitle={`${bookingConfirmed} confermate / ${clickBook} click`}
            accent="#7c3aed"
          />
          <KpiCard
            title="Click WhatsApp"
            value={clickWa}
            subtitle="click_whatsapp"
            accent="#15803d"
          />
          <KpiCard title="Click Mappe" value={clickMaps} subtitle="click_maps" accent="#0369a1" />
          <KpiCard
            title="Booking started"
            value={bookingStarted}
            subtitle="inizio compilazione"
            accent="#0ea5e9"
          />
          <KpiCard
            title="Cancellazioni"
            value={bookingCancelled}
            subtitle="booking_cancelled"
            accent="#dc2626"
          />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: 16,
          }}
        >
          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 20,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#111827" }}>
                Eventi per giorno
              </h2>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: "#111827",
                      display: "inline-block",
                      borderRadius: 2,
                    }}
                  />
                  Totale
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: 14,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: "#16a34a",
                      display: "inline-block",
                      borderRadius: 2,
                    }}
                  />
                  Prenotazioni
                </span>
              </div>
            </div>
            <div
              style={{
                height: 240,
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                borderBottom: "1px solid #e5e7eb",
                paddingBottom: 4,
                overflow: "hidden",
              }}
              aria-label="Grafico eventi per giorno"
              role="img"
            >
              {dailyOrdered.map((b, i) => {
                const hTotal = Math.max(2, Math.round((b.total / maxDaily) * 220));
                const hBook = Math.max(0, Math.round((b.book / maxDaily) * 220));
                const hBase = Math.max(0, hTotal - hBook);
                return (
                  <div
                    key={i}
                    title={`${b.label}: ${b.total} eventi (${b.book} pren.)`}
                    style={{
                      flex: "1 1 0",
                      minWidth: 4,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "stretch",
                    }}
                  >
                    <div
                      style={{
                        height: hBase,
                        background: "#111827",
                        width: "100%",
                        borderTopLeftRadius: 2,
                        borderTopRightRadius: 2,
                        minHeight: b.total > 0 ? 2 : 0,
                      }}
                    />
                    {hBook > 0 ? (
                      <div
                        style={{
                          height: hBook,
                          background: "#16a34a",
                          width: "100%",
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 11,
                color: "#6b7280",
                paddingLeft: 0,
                paddingRight: 0,
              }}
            >
              <span>{dailyOrdered[0]?.label ?? ""}</span>
              <span>{dailyOrdered[Math.floor(dailyOrdered.length / 2)]?.label ?? ""}</span>
              <span>{dailyOrdered[dailyOrdered.length - 1]?.label ?? ""}</span>
            </div>
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 20,
              minWidth: 0,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#111827" }}>
              Top 5 servizi per click
            </h2>
            <p style={{ marginTop: 4, fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
              click_book + booking_confirmed raggruppati per nome.
            </p>
            {topServices.length === 0 ? (
              <p style={{ fontSize: 14, color: "#6b7280" }}>Nessun dato in questo intervallo.</p>
            ) : (
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                {topServices.map(([name, count], idx) => {
                  const topFirst = topServices[0];
                  const maxCount = topFirst ? topFirst[1] || 1 : 1;
                  const pct = Math.max(8, Math.round((count / maxCount) * 100));
                  return (
                    <li key={name}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 14, color: "#111827", fontWeight: 500 }}>
                          <span
                            style={{
                              color: "#6b7280",
                              display: "inline-block",
                              width: 20,
                              fontSize: 12,
                            }}
                          >
                            {idx + 1}.
                          </span>
                          {name}
                        </span>
                        <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>
                          {count}
                        </span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: 8,
                          background: "#f1f5f9",
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background:
                              idx === 0
                                ? "#111827"
                                : idx === 1
                                  ? "#374151"
                                  : idx === 2
                                    ? "#6b7280"
                                    : idx === 3
                                      ? "#9ca3af"
                                      : "#d1d5db",
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
