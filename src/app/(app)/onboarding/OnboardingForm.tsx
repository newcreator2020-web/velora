"use client";

import { useFormState as useActionStateCompat, useFormStatus } from "react-dom";
import { onboardingAction, type OnboardingActionResult } from "./actions";

const initial: OnboardingActionResult = { ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        padding: "10px 18px",
        background: "#2563eb",
        color: "white",
        border: "none",
        borderRadius: 8,
        fontWeight: 600,
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.65 : 1,
        minWidth: 180,
      }}
    >
      {pending ? "Creazione in corso..." : "Crea la tua attività"}
    </button>
  );
}

function Field({
  id,
  label,
  name,
  type = "text",
  autoComplete,
  required,
  value,
  placeholder,
  err,
  maxLen,
}: {
  id: string;
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  value?: string;
  placeholder?: string;
  err?: string | undefined;
  maxLen?: number;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
      >
        {label}
        {required ? " *" : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={value ?? ""}
        maxLength={maxLen}
        aria-invalid={!!err}
        aria-describedby={err ? `${id}-err` : undefined}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: `1px solid ${err ? "#dc2626" : "#d4d4d8"}`,
          fontSize: 15,
        }}
      />
      {err ? (
        <p id={`${id}-err`} role="alert" style={{ color: "#dc2626", fontSize: 13, marginTop: 4 }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

export function OnboardingForm() {
  const [state, action] = useActionStateCompat(onboardingAction, initial);
  const v: Record<string, unknown> = (state.values ?? {}) as Record<string, unknown>;
  const fe = state.fieldErrors ?? {};

  return (
    <form
      action={action}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}
    >
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr" }}>
        <Field
          id="onb-business_name"
          label="Nome attività"
          name="business_name"
          autoComplete="organization"
          required
          maxLen={120}
          placeholder="Es. Mario Hair Studio"
          value={String(v["business_name"] ?? "")}
          err={fe["business_name"] as string | undefined}
        />
        <Field
          id="onb-category"
          label="Categoria"
          name="category"
          autoComplete="organization-title"
          required
          maxLen={80}
          placeholder="Es. Parrucchiere, Bar, Ristorante"
          value={String(v["category"] ?? "")}
          err={fe["category"] as string | undefined}
        />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr" }}>
        <Field
          id="onb-city"
          label="Città"
          name="city"
          autoComplete="address-level2"
          required
          maxLen={80}
          placeholder="Es. Milano"
          value={String(v["city"] ?? "")}
          err={fe["city"] as string | undefined}
        />
        <Field
          id="onb-province"
          label="Provincia"
          name="province"
          autoComplete="address-level1"
          required
          maxLen={4}
          placeholder="MI"
          value={String(v["province"] ?? "")}
          err={fe["province"] as string | undefined}
        />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <Field
          id="onb-phone"
          label="Telefono (opzionale)"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLen={32}
          placeholder="+39 02 1234567"
          value={String(v["phone"] ?? "")}
          err={fe["phone"] as string | undefined}
        />
        <Field
          id="onb-business_email"
          label="Email attività (opzionale)"
          name="business_email"
          type="email"
          autoComplete="email"
          maxLen={160}
          placeholder="info@tuoattivita.it"
          value={String(v["business_email"] ?? "")}
          err={fe["business_email"] as string | undefined}
        />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <Field
          id="onb-timezone"
          label="Timezone"
          name="timezone"
          required
          maxLen={64}
          placeholder="Europe/Rome"
          value={String(v["timezone"] ?? "Europe/Rome")}
          err={fe["timezone"] as string | undefined}
        />
        <Field
          id="onb-locale"
          label="Lingua"
          name="locale"
          required
          maxLen={10}
          placeholder="it-IT"
          value={String(v["locale"] ?? "it-IT")}
          err={fe["locale"] as string | undefined}
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          aria-live="polite"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 14,
            border: "1px solid #fecaca",
          }}
        >
          {state.error}
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <Submit />
      </div>
    </form>
  );
}
