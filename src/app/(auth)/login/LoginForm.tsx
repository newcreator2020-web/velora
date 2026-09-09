"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginActionResult } from "./actions";

const initial: LoginActionResult = { ok: false };

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      style={{
        padding: "10px 16px",
        background: "#2563eb",
        color: "white",
        border: "none",
        borderRadius: 8,
        fontWeight: 600,
        cursor: pending || disabled ? "not-allowed" : "pointer",
        opacity: pending || disabled ? 0.65 : 1,
        minWidth: 120,
      }}
    >
      {pending ? "Accesso in corso..." : "Accedi"}
    </button>
  );
}

export function LoginForm({ csrfToken }: { csrfToken: string }) {
  const [state, action] = useActionState(loginAction, initial);

  return (
    <form
      action={action}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}
    >
      <input type="hidden" name="_csrf" value={csrfToken} />
      <div>
        <label
          htmlFor="login-email"
          style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
        >
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          aria-invalid={!!(state.fieldErrors && state.fieldErrors["email"])}
          aria-describedby="login-email-err"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${state.fieldErrors && state.fieldErrors["email"] ? "#dc2626" : "#d4d4d8"}`,
            fontSize: 15,
          }}
          placeholder="tu@esempio.it"
        />
        {state.fieldErrors && state.fieldErrors["email"] ? (
          <p
            id="login-email-err"
            role="alert"
            style={{ color: "#dc2626", fontSize: 13, marginTop: 4 }}
          >
            {state.fieldErrors["email"]}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="login-password"
          style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}
        >
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!(state.fieldErrors && state.fieldErrors["password"])}
          aria-describedby="login-password-err"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${state.fieldErrors && state.fieldErrors["password"] ? "#dc2626" : "#d4d4d8"}`,
            fontSize: 15,
          }}
          placeholder="••••••••"
        />
        {state.fieldErrors && state.fieldErrors["password"] ? (
          <p
            id="login-password-err"
            role="alert"
            style={{ color: "#dc2626", fontSize: 13, marginTop: 4 }}
          >
            {state.fieldErrors["password"]}
          </p>
        ) : null}
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
        <SubmitButton />
      </div>
    </form>
  );
}
