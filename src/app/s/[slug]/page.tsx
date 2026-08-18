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
  const result = await resolvePublicSiteContent({ slug: parsed.data });
  if (result._tag !== "Found") notFound();
  const { publicSite } = result;
  return (
    <main id="main-content" className="min-h-screen antialiased">
      <SiteShell theme={publicSite.theme}>
        <SiteRenderer sections={publicSite.sections} />
      </SiteShell>
    </main>
  );
}
