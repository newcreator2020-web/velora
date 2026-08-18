import { redirect } from "next/navigation";
import { getCurrentTenantContext } from "@/lib/server/auth";
import { LogoutButton } from "@/app/(app)/dashboard/LogoutButton";
import Link from "next/link";

export const metadata = { title: "Dashboard — VELORA" };

export default async function AppDashboardPage() {
  const ctx = await getCurrentTenantContext();
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }

  const { tenant, business_profile, membership, user } = ctx;

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
            <Info label="Timezone" value={business_profile.timezone} />
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
          Dati recuperati in tempo reale tramite RLS · FASE 3 · App + Settings
        </footer>
      </div>
    </main>
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
