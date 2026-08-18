"use client";

import { useFormStatus } from "react-dom";
import { logoutAction } from "@/app/actions/logout";

export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "white",
          color: "#0f172a",
          fontWeight: 500,
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.65 : 1,
          fontSize: 14,
        }}
      >
        {pending ? "Uscita in corso..." : "Esci"}
      </button>
    </form>
  );
}
