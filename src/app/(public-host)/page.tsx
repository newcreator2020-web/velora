import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  normalizeHostname,
  resolvePublicTenant,
  resolvePublicSiteContent,
} from "@/lib/server/site-engine";
import type { PublicSection } from "@/lib/server/content-engine";
import { SiteShell } from "@/components/site/SiteShell";
import { SiteRenderer } from "@/components/site/SectionRegistry";
import { publicEnv } from "@/config/env";
import { formatUptime } from "@/lib/utils";
import { buildHealthResponse } from "@/lib/server/health";

export const dynamic = "force-dynamic";

function isLocalhostHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

async function getHostTenant() {
  const h = await headers();
  const rawHost =
    (process.env.NODE_ENV !== "production" || process.env["PLAYWRIGHT_USE_PRODUCTION"] === "1"
      ? (h.get("x-velora-host") ?? undefined)
      : undefined) ??
    h.get("host") ??
    "";
  const hostname = rawHost.split(":")[0] ?? "";
  if (!hostname) return null;
  const normalized = normalizeHostname(hostname);
  if (!normalized) return null;
  const result = await resolvePublicTenant({ hostname: normalized });
  if (result._tag !== "Found") return null;
  return { hostname: normalized, result };
}

export async function generateMetadata(): Promise<Metadata> {
  const info = await getHostTenant();
  if (!info) {
    const h = await headers();
    const rawHost =
      (process.env.NODE_ENV !== "production" || process.env["PLAYWRIGHT_USE_PRODUCTION"] === "1"
        ? (h.get("x-velora-host") ?? undefined)
        : undefined) ??
      h.get("host") ??
      "";
    const hostname = rawHost.split(":")[0] ?? "";
    if (isLocalhostHostname(hostname)) {
      const localBase = `http://${rawHost || "localhost:3000"}`.replace(/\/+$/, "");
      const ogLocal = `${localBase}/og-default.png`;
      return {
        title: publicEnv.NEXT_PUBLIC_APP_NAME,
        description: "VELORA — Piattaforma SaaS multi-tenant",
        openGraph: {
          type: "website",
          title: publicEnv.NEXT_PUBLIC_APP_NAME,
          description: "VELORA — Piattaforma SaaS multi-tenant",
          url: localBase + "/",
          siteName: publicEnv.NEXT_PUBLIC_APP_NAME,
          images: [{ url: ogLocal, width: 1200, height: 630, alt: publicEnv.NEXT_PUBLIC_APP_NAME }],
        },
        twitter: {
          card: "summary_large_image",
          title: publicEnv.NEXT_PUBLIC_APP_NAME,
          description: "VELORA — Piattaforma SaaS multi-tenant",
          creator: "@velora",
          images: [ogLocal],
        },
      };
    }
    return notFoundMetadata();
  }
  const { hostname, result } = info;
  const s = result.site;
  const title = s.description ? `${s.businessName} — ${s.description}` : s.businessName;
  const description =
    s.description ?? `${s.businessName}. ${[s.city, s.province].filter(Boolean).join(", ")}`;
  const canonical = `https://${hostname}/`;
  const defaultBase = `https://${hostname}`;
  const ogFallback = `${defaultBase}/og-default.png`;
  const ogImageUrl =
    ((s as unknown as Record<string, unknown>)["ogImageUrl"] as string | undefined) || ogFallback;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: s.businessName,
      description: description,
      url: canonical,
      locale: s.locale,
      siteName: s.businessName,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: s.businessName ?? hostname,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: s.businessName,
      description: description,
      creator: "@velora",
      images: [ogImageUrl],
    },
  };
}

function notFoundMetadata(): Metadata {
  return {
    title: "Sito non disponibile",
    robots: { index: false, follow: false },
  };
}

function VeloraHealthLanding() {
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

export default async function HostPublicSitePage() {
  const info = await getHostTenant();
  if (!info) {
    const h = await headers();
    const rawHost =
      (process.env.NODE_ENV !== "production" || process.env["PLAYWRIGHT_USE_PRODUCTION"] === "1"
        ? (h.get("x-velora-host") ?? undefined)
        : undefined) ??
      h.get("host") ??
      "";
    const hostname = rawHost.split(":")[0] ?? "";
    if (isLocalhostHostname(hostname)) return <VeloraHealthLanding />;
    notFound();
  }
  const { result } = info;
  const { site } = result;
  const contentResult = await resolvePublicSiteContent({ slug: site.slug });
  if (contentResult._tag !== "Found") {
    const h = await headers();
    const rawHost =
      (process.env.NODE_ENV !== "production" || process.env["PLAYWRIGHT_USE_PRODUCTION"] === "1"
        ? (h.get("x-velora-host") ?? undefined)
        : undefined) ??
      h.get("host") ??
      "";
    const hostname = rawHost.split(":")[0] ?? "";
    if (isLocalhostHostname(hostname)) return <VeloraHealthLanding />;
    notFound();
  }
  const { publicSite } = contentResult;
  return (
    <main id="main-content" className="min-h-screen antialiased">
      <a
        href="#main-content"
        id="skip-to-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded-md focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Salta al contenuto principale
      </a>
      <div id="site-content-start" aria-hidden="true"></div>
      {publicSite.sections.every((s: PublicSection) => s.type !== "hero") ? (
        <h1 id="site-hero-title" className="sr-only">
          {site.businessName ?? site.slug}
        </h1>
      ) : null}
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <nav aria-label="Azioni rapide" className="flex justify-end">
          <a
            href="/booking"
            className="inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900"
          >
            Prenota
          </a>
        </nav>
      </div>
      <SiteShell theme={publicSite.theme} siteSlug={site.slug}>
        <SiteRenderer sections={publicSite.sections} />
      </SiteShell>
    </main>
  );
}
