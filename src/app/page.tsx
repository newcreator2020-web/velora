import { publicEnv } from "@/config/env";
import { formatUptime } from "@/lib/utils";
import { buildHealthResponse } from "@/lib/server/health";

export default function HomePage() {
  const health = buildHealthResponse();

  return (
    <main id="velora-main" role="main">
      <div className="container">
        <div className="badge" data-testid="status-badge">
          <span className="badge-dot" aria-hidden="true" />
          <span>Sistema operativo</span>
        </div>

        <h1 className="title" data-testid="app-title">
          {publicEnv.NEXT_PUBLIC_APP_NAME}
        </h1>

        <p className="subtitle" data-testid="app-subtitle">
          Fondazione tecnica — Fase 0
        </p>

        <div
          style={{
            display: "inline-grid",
            gridTemplateColumns: "auto auto",
            gap: "0.5rem 1.5rem",
            padding: "1rem 1.5rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
            color: "var(--muted)",
            textAlign: "left",
          }}
          data-testid="system-info"
        >
          <div>Stato</div>
          <div style={{ color: health.status === "ok" ? "#22c55e" : "var(--fg)" }}>
            {health.status.toUpperCase()}
          </div>
          <div>Versione</div>
          <div>{health.version}</div>
          <div>Ambiente</div>
          <div>{publicEnv.NEXT_PUBLIC_APP_ENV}</div>
          <div>Uptime</div>
          <div>{formatUptime(health.checks.uptime_ms)}</div>
        </div>
      </div>

      <footer className="footer" role="contentinfo">
        <p>
          © {new Date().getFullYear()} {publicEnv.NEXT_PUBLIC_APP_NAME}. Fase 0 — Fondazione.
        </p>
      </footer>
    </main>
  );
}
