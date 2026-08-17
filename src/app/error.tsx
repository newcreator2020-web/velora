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
  }, [error]);

  return (
    <html lang="it">
      <body>
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
      </body>
    </html>
  );
}
