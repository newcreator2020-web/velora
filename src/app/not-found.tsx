import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="error-page">
        <div className="error-code" data-testid="not-found-code">
          404
        </div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Pagina non trovata</h1>
        <p className="error-message">La risorsa richiesta non esiste o è stata spostata.</p>
        <Link
          href="/"
          style={{
            padding: "0.625rem 1.25rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
