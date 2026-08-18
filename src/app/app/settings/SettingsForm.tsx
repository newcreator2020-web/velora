"use client";

import Link from "next/link";
import { useFormState as useActionStateCompat, useFormStatus } from "react-dom";
import { initialSettingsResult, settingsAction, type SettingsActionResult } from "./actions";

type Props = {
  initialPromise: ReturnType<typeof initialSettingsResult>;
};

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
      {pending ? "Salvataggio..." : "Salva modifiche"}
    </button>
  );
}

function Field({
  id,
  label,
  name,
  type = "text",
  value,
  placeholder,
  err,
  required,
  maxLength,
  as = "input",
  rows,
}: {
  id: string;
  label: string;
  name: string;
  type?: string;
  value?: string | null | undefined;
  placeholder?: string;
  err?: string | string[] | undefined;
  required?: boolean;
  maxLength?: number;
  as?: "input" | "textarea";
  rows?: number;
}) {
  const actualValue = value === undefined ? null : value;
  const showErr = Array.isArray(err) ? err.join(" ") : (err ?? undefined);
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
      >
        {label}
        {required ? (
          <span style={{ color: "#dc2626" }} aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </label>
      {as === "textarea" ? (
        <textarea
          id={id}
          name={name}
          rows={rows ?? 5}
          maxLength={maxLength}
          defaultValue={actualValue ?? undefined}
          aria-invalid={showErr !== undefined}
          aria-describedby={showErr !== undefined ? `${id}-err` : undefined}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${showErr !== undefined ? "#dc2626" : "#d4d4d8"}`,
            fontSize: 15,
            resize: "vertical",
            minHeight: 96,
            fontFamily: "inherit",
          }}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          maxLength={maxLength}
          defaultValue={actualValue ?? undefined}
          required={required}
          aria-invalid={showErr !== undefined}
          aria-describedby={showErr !== undefined ? `${id}-err` : undefined}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${showErr !== undefined ? "#dc2626" : "#d4d4d8"}`,
            fontSize: 15,
          }}
          placeholder={placeholder}
        />
      )}
      {showErr !== undefined ? (
        <p id={`${id}-err`} role="alert" style={{ color: "#dc2626", fontSize: 13, marginTop: 4 }}>
          {showErr}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsForm({ initialPromise }: Props) {
  const initial = useInitialResult(initialPromise);
  const [state, action] = useActionStateCompat(settingsAction, initial as SettingsActionResult);

  const values = (state.values ?? initial.values ?? {}) as Partial<Record<string, string | null>>;
  const fe = state.fieldErrors ?? ({} as Record<string, string[]>);
  const showSuccess = state.ok;
  function errOf(name: string): string | string[] | undefined {
    const raw = fe[name];
    return raw === undefined || raw === null ? undefined : raw;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>IMPOSTAZIONI</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 600 }}>
            Dati dell&apos;attività
          </h1>
        </div>
        <Link
          href="/app"
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
          ← Torna alla dashboard
        </Link>
      </div>

      {showSuccess ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "11px 14px",
            borderRadius: 10,
            background: "#ecfdf5",
            color: "#047857",
            border: "1px solid #a7f3d0",
            fontSize: 14,
          }}
        >
          ✅ Modifiche salvate correttamente.
        </div>
      ) : null}

      {state.ok === false && state.error ? (
        <div
          role="alert"
          aria-live="polite"
          style={{
            padding: "11px 14px",
            borderRadius: 10,
            background: "#fef2f2",
            color: "#b91c1c",
            border: "1px solid #fecaca",
            fontSize: 14,
          }}
        >
          {state.error}
        </div>
      ) : null}

      <form
        action={action}
        noValidate
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          columnGap: 18,
          rowGap: 16,
        }}
      >
        <Field
          id="s-business_name"
          label="Nome attività"
          name="business_name"
          value={values["business_name"]}
          placeholder="Mario Hair Salon"
          required
          maxLength={120}
          err={errOf("business_name")}
        />
        <Field
          id="s-phone"
          label="Telefono"
          name="phone"
          value={values["phone"]}
          placeholder="+39 02 1234567"
          maxLength={32}
          err={errOf("phone")}
        />
        <Field
          id="s-email"
          label="Email attività"
          name="email"
          type="email"
          value={values["email"]}
          placeholder="info@esempio.it"
          maxLength={160}
          err={errOf("email")}
        />
        <Field
          id="s-address"
          label="Indirizzo"
          name="address"
          value={values["address"]}
          placeholder="Via Roma 12"
          maxLength={190}
          err={errOf("address")}
        />
        <Field
          id="s-city"
          label="Città"
          name="city"
          value={values["city"]}
          placeholder="Milano"
          maxLength={80}
          err={errOf("city")}
        />
        <Field
          id="s-province"
          label="Provincia"
          name="province"
          value={values["province"]}
          placeholder="MI"
          maxLength={4}
          err={errOf("province")}
        />
        <Field
          id="s-postal_code"
          label="CAP"
          name="postal_code"
          value={values["postal_code"]}
          placeholder="20100"
          maxLength={16}
          err={errOf("postal_code")}
        />
        <div style={{ gridColumn: "1 / -1" }}>
          <Field
            as="textarea"
            id="s-description"
            label="Descrizione attività"
            name="description"
            value={values["description"]}
            rows={5}
            maxLength={1000}
            placeholder="Parla brevemente della tua attività, dei servizi che offri, ecc."
            err={errOf("description")}
          />
        </div>
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <Submit />
        </div>
      </form>
    </div>
  );
}

import { use } from "react";
function useInitialResult(p: ReturnType<typeof initialSettingsResult>) {
  const safePromise = p.then(
    (value) => value,
    () =>
      ({
        ok: false,
        error: "",
        values: {},
      }) as SettingsActionResult & { values: Partial<Record<string, string | null>> },
  );
  return use(safePromise);
}
