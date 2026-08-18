import { redirect } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import { getCurrentTenantContext, requireAuthenticatedUser } from "@/lib/server/auth";

export const metadata = { title: "Dashboard — VELORA" };

export default async function DashboardPage() {
  await requireAuthenticatedUser();
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
          maxWidth: 960,
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
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>VELORA DASHBOARD</div>
            <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 600 }}>
              Ciao {user.display_name ?? user.auth_email.split("@")[0]} 👋
            </h1>
          </div>
          <LogoutButton />
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
          <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>La tua attività</h2>
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
            <Info label="Stato tenant" value={tenant.status} />
            <Info label="Il tuo ruolo" value={membership.role} capitalize />
            <Info label="Slug" value={tenant.slug} mono />
            <Info label="Email account" value={user.auth_email} />
          </dl>
        </section>

        <footer
          style={{
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13,
            padding: 10,
          }}
        >
          Dati recuperati in tempo reale dal database tramite RLS · Fase 2 · Auth + Onboarding
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
