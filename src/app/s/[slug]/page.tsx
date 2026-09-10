import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  resolvePublicTenant,
  slugSchema,
  resolvePublicSiteContent,
} from "@/lib/server/site-engine";
import type { PublicSection } from "@/lib/server/content-engine";
import { SiteShell } from "@/components/site/SiteShell";
import { SiteRenderer } from "@/components/site/SectionRegistry";

export const revalidate = 300;

interface PublicSitePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: PublicSitePageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return notFoundMetadata();
  const result = await resolvePublicTenant({ slug: parsed.data });
  if (result._tag !== "Found") return notFoundMetadata();
  const s = result.site;
  const title = s.description ? `${s.businessName} — ${s.description}` : s.businessName;
  const rawDescription =
    s.description ?? `${s.businessName}. ${[s.city, s.province].filter(Boolean).join(", ")}`;
  const description =
    rawDescription && rawDescription.trim().length >= 50
      ? rawDescription.trim()
      : `${s.businessName || "Studio"}. Servizi professionali a ${
          s.city || "dove ti trovi"
        }. Prenota online 24/7, consulta orari e prezzi trasparenti. Qualità e affidabilità garantite.`;
  const canonicalPath = s.canonicalPath || `/s/${encodeURIComponent(slug)}`;
  const defaultBase =
    process.env["NEXT_PUBLIC_APP_URL"] && process.env["NEXT_PUBLIC_APP_URL"].length > 0
      ? process.env["NEXT_PUBLIC_APP_URL"].replace(/\/+$/, "")
      : "http://localhost:3000";
  const canonical = `${defaultBase}${canonicalPath}`;
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
          alt: s.businessName ?? slug,
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

export default async function PublicSitePage(props: PublicSitePageProps) {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const tenantResult = await resolvePublicTenant({ slug: parsed.data });
  if (tenantResult._tag !== "Found") notFound();
  const { site } = tenantResult;
  const contentResult = await resolvePublicSiteContent({ slug: parsed.data });
  if (contentResult._tag !== "Found") notFound();
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
            href={(() => {
              const base = site.canonicalPath || `/s/${encodeURIComponent(site.slug)}`;
              return base.endsWith("/") ? `${base}booking` : `${base}/booking`;
            })()}
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
