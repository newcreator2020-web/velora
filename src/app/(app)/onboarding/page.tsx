import { redirect } from "next/navigation";
import { OnboardingForm } from "./OnboardingForm";
import { getCurrentTenantContext } from "@/lib/server/auth";

export const metadata = { title: "Onboarding — Crea la tua attività" };

export default async function OnboardingPage() {
  const ctx = await getCurrentTenantContext();

  if (ctx.membership && ctx.tenant && ctx.business_profile) {
    redirect("/dashboard");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8fafc",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 620,
          background: "white",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 10px 30px rgba(0,0,0,0.06)",
          border: "1px solid #e5e7eb",
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>PASSAGGIO 1 DI 1</div>
          <h1 style={{ marginTop: 4, marginBottom: 6, fontSize: 24, fontWeight: 600 }}>
            Crea la tua attività
          </h1>
          <p style={{ color: "#475569", margin: 0, fontSize: 15 }}>
            Bastano pochi dati. Potrai modificare tutto in seguito dalle impostazioni.
          </p>
        </header>

        <OnboardingForm />
      </section>
    </main>
  );
}
