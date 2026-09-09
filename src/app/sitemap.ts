import { headers } from "next/headers";
import type { MetadataRoute } from "next";
import { listPublishedSitesForSitemap } from "@/lib/server/seo";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

function isLocalhostHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function getHostOrigin(host: string | null, protocolHint: string): string | null {
  if (!host || host.trim().length === 0) return null;
  const hostname = host.split(":")[0] ?? "";
  if (!hostname) return null;
  const proto =
    isLocalhostHostname(hostname) || hostname.includes("localhost")
      ? "http"
      : protocolHint.startsWith("https")
        ? "https"
        : "http";
  let origin = `${proto}://${hostname}`;
  if (host.includes(":")) {
    const port = host.split(":")[1];
    if (port && port !== "443" && port !== "80") origin += `:${port}`;
  }
  return origin;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const rawHost =
    (process.env.NODE_ENV !== "production" ? (h.get("x-velora-host") ?? undefined) : undefined) ??
    h.get("host") ??
    "";
  const forwardedProto = h.get("x-forwarded-proto") || "https";
  const origin =
    getHostOrigin(rawHost, forwardedProto) ||
    String(process.env["NEXT_PUBLIC_APP_URL"] || "").replace(/\/$/, "");
  const currentHostname = origin
    ? (() => {
        try {
          return new URL(origin).hostname;
        } catch {
          return null;
        }
      })()
    : null;

  const base = String(process.env["NEXT_PUBLIC_APP_URL"] || "").replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = [];

  if (origin) {
    entries.push({
      url: `${origin}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    });
  } else if (base) {
    entries.push({
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    });
  }

  try {
    const sites = await listPublishedSitesForSitemap();
    for (const s of sites) {
      const hasCanonical = typeof s.canonicalUrl === "string" && s.canonicalUrl.trim().length > 0;
      const canonicalOrigin = hasCanonical
        ? s.canonicalUrl!.replace(/\/+$/, "")
        : base
          ? `${base}/s/${s.slug}`
          : null;
      if (!canonicalOrigin) continue;

      let siteHostname: string | null = null;
      try {
        siteHostname = new URL(canonicalOrigin).hostname;
      } catch {
        siteHostname = null;
      }

      if (currentHostname && siteHostname && currentHostname !== siteHostname) {
        continue;
      }

      entries.push({
        url: canonicalOrigin + "/",
        lastModified: s.lastModified,
        changeFrequency: "weekly",
        priority: 0.8,
      });
      entries.push({
        url: `${canonicalOrigin}/booking`,
        lastModified: s.lastModified,
        changeFrequency: "weekly",
        priority: 0.7,
      });
      entries.push({
        url: `${canonicalOrigin}/privacy-policy`,
        lastModified: s.lastModified,
        changeFrequency: "monthly",
        priority: 0.3,
      });
      entries.push({
        url: `${canonicalOrigin}/cookie-policy`,
        lastModified: s.lastModified,
        changeFrequency: "monthly",
        priority: 0.3,
      });
    }
  } catch {
    // Sitemap must not fail even if DB is unreachable.
  }

  if (currentHostname) {
    return entries.filter((e) => {
      try {
        const u = new URL(e.url);
        return u.hostname === currentHostname;
      } catch {
        return true;
      }
    });
  }
  return entries;
}
