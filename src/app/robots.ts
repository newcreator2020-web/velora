import { headers } from "next/headers";
import type { MetadataRoute } from "next";

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

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const rawHost =
    (process.env.NODE_ENV !== "production" ? (h.get("x-velora-host") ?? undefined) : undefined) ??
    h.get("host") ??
    "";
  const forwardedProto = h.get("x-forwarded-proto") || "https";
  const origin =
    getHostOrigin(rawHost, forwardedProto) ||
    String(process.env["NEXT_PUBLIC_APP_URL"] || "").replace(/\/$/, "");

  const base = String(process.env["NEXT_PUBLIC_APP_URL"] || "").replace(/\/$/, "");
  const sitemapUrl = origin
    ? `${origin}/sitemap.xml`
    : base
      ? `${base}/sitemap.xml`
      : "/sitemap.xml";
  const hostOrigin = origin || base || undefined;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/s/", "/booking", "/privacy-policy", "/cookie-policy"],
        disallow: [
          "/app",
          "/login",
          "/onboarding",
          "/dashboard",
          "/api/app",
          "/api/billing/stripe/webhook",
          "/api/res",
        ],
      },
      {
        userAgent: "GPTBot",
        disallow: ["/app", "/login", "/api/"],
      },
    ],
    sitemap: sitemapUrl,
    host: hostOrigin || undefined,
  };
}
