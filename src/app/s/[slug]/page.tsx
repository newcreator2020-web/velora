import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePublicTenant, slugSchema } from "@/lib/server/site-engine";

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
  const result = await resolvePublicTenant({ slug: parsed.data });
  if (result._tag !== "Found") notFound();
  const site = result.site;

  const contacts: Array<{ label: string; value: string; href?: string }> = [];
  if (site.phone)
    contacts.push({
      label: "Telefono",
      value: site.phone,
      href: `tel:${site.phone.replace(/\s+/g, "")}`,
    });
  if (site.email)
    contacts.push({ label: "Email", value: site.email, href: `mailto:${site.email}` });
  if (site.websiteUrl)
    contacts.push({ label: "Sito web", value: site.websiteUrl, href: site.websiteUrl });
  const locationParts = [
    site.address,
    site.postalCode,
    site.city,
    site.province,
    site.countryCode,
  ].filter(Boolean);

  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
      <div className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-12 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4">
          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-500">
            {site.category ?? "Attività commerciale"}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{site.businessName}</h1>
          {site.description ? (
            <p className="max-w-2xl text-base leading-relaxed text-neutral-700 sm:text-lg">
              {site.description}
            </p>
          ) : null}
        </header>

        <section aria-labelledby="contacts-heading" className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 id="contacts-heading" className="text-lg font-semibold">
              Contatti
            </h2>
            {contacts.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">Nessun contatto pubblico disponibile.</p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm">
                {contacts.map((c) => (
                  <li key={c.label} className="flex items-start justify-between gap-3">
                    <span className="font-medium text-neutral-500">{c.label}</span>
                    {c.href ? (
                      <a
                        href={c.href}
                        className="max-w-[60%] truncate text-right text-neutral-900 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                        target={c.href.startsWith("http") ? "_blank" : undefined}
                        rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      >
                        {c.value}
                      </a>
                    ) : (
                      <span className="max-w-[60%] truncate text-right">{c.value}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Dove siamo</h2>
            {locationParts.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                Nessun indirizzo pubblico disponibile.
              </p>
            ) : (
              <p className="mt-4 text-sm leading-relaxed text-neutral-700">
                {locationParts.join(", ")}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-8 text-center">
          <p className="text-sm text-neutral-500">
            Motore pubblico multi-tenant VELORA · Slug pubblico:{" "}
            <span className="font-mono text-neutral-700">{site.slug}</span>
          </p>
        </section>
      </div>
    </main>
  );
}
