"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { createCheckoutAction, createPortalAction, type BillingActionResult } from "./actions";

const stack: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
};
const pill: (label: string) => React.ReactElement = (label) => (
  <span
    key={label}
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "4px 10px",
      borderRadius: 999,
      border: "1px solid #e2e8f0",
      fontSize: 12,
      fontWeight: 600,
      color: "#0f172a",
      background: "#f1f5f9",
    }}
  >
    {label}
  </span>
);

function CTAUpgradeButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="action"
      value="checkout"
      disabled={disabled || pending}
      aria-disabled={disabled || pending || undefined}
      style={{
        appearance: "none",
        cursor: disabled || pending ? "not-allowed" : "pointer",
        background: disabled ? "#94a3b8" : "#0f172a",
        color: "white",
        fontWeight: 700,
        padding: "10px 16px",
        borderRadius: 10,
        border: "1px solid transparent",
        minWidth: 220,
      }}
    >
      {pending ? "Preparazione checkout…" : "Passa a PRO"}
    </button>
  );
}

function CTAManageButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="action"
      value="portal"
      disabled={disabled || pending}
      aria-disabled={disabled || pending || undefined}
      style={{
        appearance: "none",
        cursor: disabled || pending ? "not-allowed" : "pointer",
        background: "white",
        color: "#0f172a",
        fontWeight: 700,
        padding: "10px 16px",
        borderRadius: 10,
        border: "1px solid #cbd5e1",
        minWidth: 220,
      }}
    >
      {pending ? "Apertura portale…" : "Gestisci abbonamento"}
    </button>
  );
}

export function BillingPage({ initial }: { initial: BillingActionResult }) {
  const state = initial.state;
  const err = initial.status === "error";
  const planName =
    state?.planId === "pro" ? "PRO" : state?.planId === "internal_test" ? "Internal" : "BASE";
  const effectivePlan = state?.effectivePlan ?? "base";
  const limits = state?.planLimits ?? { maxServices: 3, maxSections: 5 };
  const env = state?.env ?? {
    hasSecret: false,
    hasPublishable: false,
    hasWebhookSecret: false,
    hasProPrice: false,
  };
  const canUpgrade = !!state?.canUpgrade && state.effectivePlan !== "pro";
  const canManage = !!state?.canManage;
  const providerReady = env.hasSecret && env.hasProPrice;

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div style={stack as any} aria-busy={false}>
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1
          id="billing-title"
          style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#0f172a" }}
        >
          Abbonamento
        </h1>
        <p style={{ margin: 0, color: "#475569" }}>
          Visualizza il piano attuale, i limiti e le azioni disponibili per la tua attività.
        </p>
      </header>

      <div
        aria-live="polite"
        role="status"
        style={{
          minHeight: 16,
          fontSize: 14,
          color: err ? "#991b1b" : "#065f46",
          fontWeight: 600,
        }}
      >
        {initial.message}
      </div>

      <section
        aria-labelledby="billing-title"
        style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 20,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(stack as any),
          gap: 16,
        }}
      >
        <div style={row}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              fontWeight: 800,
              fontSize: 14,
              background: planName === "PRO" ? "#ecfeff" : "#f8fafc",
              color: planName === "PRO" ? "#155e75" : "#0f172a",
            }}
            aria-label={`Piano attuale: ${planName}`}
          >
            PIANO {planName}
          </div>
          {pill(effectivePlan === "pro" ? "Diritti PRO" : "Diritti BASE")}
          {!providerReady && pill("Provider non configurato")}
          {state?.cancelAtPeriodEnd && pill("Annullamento programmato")}
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            margin: 0,
          }}
        >
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: 12,
              border: "1px solid #e2e8f0",
            }}
          >
            <dt style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
              STATO SOTTOSCRIZIONE
            </dt>
            <dd style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              {state?.subscriptionStatusLabel ?? "Nessuna sottoscrizione"}
            </dd>
          </div>
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: 12,
              border: "1px solid #e2e8f0",
            }}
          >
            <dt style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>MAX SERVIZI</dt>
            <dd style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              {limits.maxServices == null ? "Illimitato" : String(limits.maxServices)}
            </dd>
          </div>
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: 12,
              border: "1px solid #e2e8f0",
            }}
          >
            <dt style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>MAX SEZIONI</dt>
            <dd style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              {limits.maxSections == null ? "Illimitato" : String(limits.maxSections)}
            </dd>
          </div>
          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: 12,
              border: "1px solid #e2e8f0",
            }}
          >
            <dt style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
              FINE PERIODO ATTUALE
            </dt>
            <dd style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
              {state?.currentPeriodEnd
                ? new Date(state.currentPeriodEnd).toLocaleString("it-IT", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "—"}
            </dd>
          </div>
        </dl>

        <form
          action={async (_f: FormData) => {
            const action = String(_f.get("action") ?? "");
            if (action === "checkout") {
              await createCheckoutAction();
              return;
            }
            if (action === "portal") {
              await createPortalAction();
              return;
            }
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style={row as any}
        >
          <CTAUpgradeButton disabled={!providerReady || !canUpgrade} />
          <CTAManageButton disabled={!providerReady || !canManage} />
          <Link
            href="/app/dashboard"
            style={{
              color: "#0f172a",
              fontWeight: 700,
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "white",
              textDecoration: "none",
              minWidth: 220,
              textAlign: "center",
            }}
          >
            Torna alla Dashboard
          </Link>
        </form>

        <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
          Nota: i provider di pagamento non sono configurati in locale. I pulsanti di azione sono
          disattivati finché le chiavi Stripe TEST reali non saranno disponibili.
        </p>
      </section>
    </div>
  );
}
