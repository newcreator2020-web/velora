"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);

    if (typeof error.digest === "string") {
      if (error.digest.startsWith("NEXT_REDIRECT")) {
        const digestLower = error.digest.toLowerCase();
        const target = digestLower.includes("onboarding")
          ? "/onboarding"
          : digestLower.includes("login")
            ? "/login"
            : "/";
        console.error("[GlobalError] NEXT_REDIRECT detected, client-side redirect to", target);
        window.location.replace(target);
        return;
      }
      if (error.digest.startsWith("NEXT_NOT_FOUND")) {
        console.error("[GlobalError] NEXT_NOT_FOUND detected, client-side redirect to /404");
        window.location.replace("/404");
        return;
      }
    }
  }, [error]);

  return (
    <div className="error-page">
      <div className="error-code" data-testid="error-code">
        500
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Si è verificato un errore</h1>
      <p className="error-message">
        Qualcosa è andato storto. Riprova o contatta l&apos;assistenza se il problema persiste.
      </p>
      <button type="button" onClick={reset} className="retry-btn">
        Riprova
      </button>
    </div>
  );
}
