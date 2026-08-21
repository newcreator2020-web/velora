import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  resolvePublicTenant,
  slugSchema,
  resolvePublicSiteContent,
} from "@/lib/server/site-engine";
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
  const description =
    s.description ?? `${s.businessName}. ${[s.city, s.province].filter(Boolean).join(", ")}`;
  const canonical = s.canonicalPath;
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
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <nav aria-label="Azioni rapide" className="flex justify-end">
          <a
            href={`/s/${encodeURIComponent(site.slug)}/booking`}
            className="inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-900"
          >
            Prenota
          </a>
        </nav>
      </div>
      <SiteShell theme={publicSite.theme}>
        <SiteRenderer sections={publicSite.sections} />
      </SiteShell>
    </main>
  );
}
