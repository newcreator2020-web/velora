import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  slugSchema,
  resolvePublicTenant,
  resolvePublicSiteContent,
} from "@/lib/server/site-engine";
import {
  buildAggregateRatingJsonLd,
  buildBreadcrumbListJsonLd,
  buildFAQJsonLd,
  buildLocalBusinessJsonLd,
  buildProductOfferPriceListJsonLd,
  buildServiceJsonLd,
} from "@/lib/server/seo";
import CookieBanner from "./components/CookieBanner";
import MobileStickyCta from "./components/MobileStickyCta";

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { title: "Sito non trovato" };
  const tenantResult = await resolvePublicTenant({ slug: parsed.data });
  if (tenantResult._tag !== "Found") return { title: "Sito non trovato" };

  const tenantRecord = tenantResult as unknown as Record<string, unknown>;
  const tenantSite =
    tenantRecord["site"] && typeof tenantRecord["site"] === "object"
      ? (tenantRecord["site"] as Record<string, unknown>)
      : null;
  const businessName = String(tenantSite?.["businessName"] ?? parsed.data);
  const description =
    typeof tenantSite?.["description"] === "string" && tenantSite["description"].length > 0
      ? tenantSite["description"]
      : `${businessName}: servizi professionali e prenotazioni online.`;
  const canonicalPath =
    typeof tenantSite?.["canonicalPath"] === "string" && tenantSite["canonicalPath"].length > 0
      ? tenantSite["canonicalPath"]
      : `/s/${encodeURIComponent(parsed.data)}`;
  const logoUrl =
    typeof tenantSite?.["logoUrl"] === "string" && tenantSite["logoUrl"].length > 0
      ? tenantSite["logoUrl"]
      : undefined;
  const businessProfile =
    tenantSite?.["businessProfile"] && typeof tenantSite["businessProfile"] === "object"
      ? (tenantSite["businessProfile"] as Record<string, unknown>)
      : null;
  const city =
    businessProfile && typeof businessProfile["city"] === "string" ? businessProfile["city"] : null;
  const province =
    businessProfile && typeof businessProfile["province"] === "string"
      ? businessProfile["province"]
      : null;
  const locationPart = [city, province].filter(Boolean).join(", ");
  const title = locationPart ? `${businessName} — ${locationPart}` : businessName;
  const ogImage = logoUrl
    ? [{ url: logoUrl, width: 1200, height: 630, alt: businessName }]
    : undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonicalPath,
      siteName: businessName,
      images: ogImage,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: logoUrl ? [logoUrl] : undefined,
    },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  };
}

interface PublicSiteLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

interface WeeklyHoursRow {
  day: string;
  closed?: boolean;
  open?: string;
  close?: string;
}

function toWeeklyHours(rawSource: unknown): WeeklyHoursRow[] | null {
  if (!rawSource || typeof rawSource !== "object") return null;
  const raw = rawSource as Record<string, unknown>;
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const out: WeeklyHoursRow[] = [];
  for (const d of days) {
    const cell = raw[d] as { closed?: unknown; open?: unknown; close?: unknown } | undefined;
    if (!cell) {
      out.push({ day: d, closed: true });
      continue;
    }
    const closed = Boolean(cell.closed);
    const row: WeeklyHoursRow = { day: d, closed };
    if (!closed && typeof cell.open === "string" && typeof cell.close === "string") {
      row.open = cell.open;
      row.close = cell.close;
    }
    out.push(row);
  }
  return out;
}

export default async function PublicSiteLayout({ children, params }: PublicSiteLayoutProps) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const tenantResult = await resolvePublicTenant({ slug: parsed.data });
  if (tenantResult._tag !== "Found") notFound();
  const tenantId = (tenantResult as unknown as { tenantId: string }).tenantId;
  const tenantRecord = tenantResult as unknown as Record<string, unknown>;
  const tenantSite =
    tenantRecord["site"] && typeof tenantRecord["site"] === "object"
      ? (tenantRecord["site"] as Record<string, unknown>)
      : null;
  const businessName = String(tenantSite?.["businessName"] ?? "Attività locale");
  const description =
    typeof tenantSite?.["description"] === "string" ? tenantSite["description"] : undefined;
  const canonicalPath =
    typeof tenantSite?.["canonicalPath"] === "string" ? tenantSite["canonicalPath"] : undefined;
  const businessProfile =
    tenantSite?.["businessProfile"] && typeof tenantSite["businessProfile"] === "object"
      ? (tenantSite["businessProfile"] as Record<string, unknown>)
      : null;
  const logoUrl =
    typeof tenantSite?.["logoUrl"] === "string" && tenantSite["logoUrl"].length > 0
      ? tenantSite["logoUrl"]
      : undefined;
  const phone =
    typeof tenantSite?.["phone"] === "string" && tenantSite["phone"].length > 0
      ? tenantSite["phone"]
      : undefined;
  const email =
    typeof tenantSite?.["email"] === "string" && tenantSite["email"].length > 0
      ? tenantSite["email"]
      : undefined;
  const priceRange =
    typeof tenantSite?.["priceRange"] === "string" && tenantSite["priceRange"].length > 0
      ? tenantSite["priceRange"]
      : undefined;
  const weeklyHours = toWeeklyHours(tenantSite?.["weeklyHours"]);
  const socialLinks = Array.isArray(tenantSite?.["socialLinks"])
    ? (tenantSite["socialLinks"] as unknown[])
    : null;

  type ServiceItem = {
    id?: string;
    name: string;
    description?: string;
    price_from?: number | null;
    duration_minutes?: number | null;
  };
  const services: ServiceItem[] = [];
  const faqs: Array<{ question: string; answer: string }> = [];
  const reviews: Array<{ rating?: number | null }> = [];
  const prices: Array<{ name: string; description?: string | null; price?: number | null }> = [];

  try {
    const contentResult = await resolvePublicSiteContent({ slug: parsed.data });
    if (contentResult._tag === "Found") {
      const contentRecord = contentResult as Record<string, unknown>;
      const publicSite =
        contentRecord["publicSite"] && typeof contentRecord["publicSite"] === "object"
          ? (contentRecord["publicSite"] as Record<string, unknown>)
          : null;
      const sections: unknown[] = Array.isArray(publicSite?.["sections"])
        ? publicSite["sections"]
        : [];
      const serviceList: unknown[] = Array.isArray(publicSite?.["services"])
        ? publicSite["services"]
        : [];

      for (const raw of serviceList) {
        const s = (raw ?? {}) as Record<string, unknown>;
        const name = typeof s["name"] === "string" ? s["name"].trim() : "";
        if (name.length === 0) continue;
        const item: ServiceItem = { name };
        if (typeof s["id"] === "string" && s["id"].length > 0) item.id = s["id"];
        if (typeof s["description"] === "string" && s["description"].trim().length > 0)
          item.description = s["description"].trim();
        if (typeof s["price_from"] === "number" && Number.isFinite(s["price_from"]))
          item.price_from = s["price_from"];
        if (typeof s["duration_minutes"] === "number" && Number.isFinite(s["duration_minutes"]))
          item.duration_minutes = s["duration_minutes"];
        services.push(item);
      }

      for (const secRaw of sections) {
        const sec = (secRaw ?? {}) as Record<string, unknown>;
        const secType = String(sec["type"] ?? sec["section_type"] ?? "").toLowerCase();
        const data =
          sec["data"] && typeof sec["data"] === "object"
            ? (sec["data"] as Record<string, unknown>)
            : null;
        const content =
          sec["content"] && typeof sec["content"] === "object"
            ? (sec["content"] as Record<string, unknown>)
            : null;

        if (secType === "faq") {
          const items = Array.isArray(content?.["items"]) ? (content["items"] as unknown[]) : [];
          for (const itRaw of items) {
            const it = (itRaw ?? {}) as Record<string, unknown>;
            const q = typeof it["question"] === "string" ? it["question"].trim() : "";
            const a = typeof it["answer"] === "string" ? it["answer"].trim() : "";
            if (q && a) faqs.push({ question: q, answer: a });
          }
        }

        if (secType === "reviews") {
          const reviewItems = Array.isArray(data?.["reviews"])
            ? (data["reviews"] as unknown[])
            : [];
          for (const rRaw of reviewItems) {
            const r = (rRaw ?? {}) as Record<string, unknown>;
            const rating =
              typeof r["rating"] === "number" && Number.isFinite(r["rating"]) ? r["rating"] : null;
            reviews.push({ rating });
          }
        }

        if (secType === "price_list") {
          const priceItems = Array.isArray(data?.["items"]) ? (data["items"] as unknown[]) : [];
          for (const pRaw of priceItems) {
            const p = (pRaw ?? {}) as Record<string, unknown>;
            const name = typeof p["name"] === "string" ? p["name"].trim() : "";
            if (name.length === 0) continue;
            const price =
              typeof p["price"] === "number" && Number.isFinite(p["price"]) ? p["price"] : null;
            const desc = typeof p["description"] === "string" ? p["description"].trim() : null;
            prices.push({ name, description: desc, price });
          }
        }
      }
    }
  } catch {
    // no-op: JSON-LD enhancement can degrade gracefully.
  }

  const socialLinksTyped = Array.isArray(socialLinks)
    ? (socialLinks as unknown as Array<{ platform: string; url: string }>)
    : null;
  const lb = buildLocalBusinessJsonLd({
    businessName,
    ...(description ? { description } : {}),
    ...(canonicalPath ? { canonicalUrl: canonicalPath } : {}),
    ...(logoUrl ? { logoOrImage: logoUrl } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(businessProfile ? { businessProfile } : {}),
    ...(weeklyHours ? { weeklyHours } : {}),
    ...(socialLinksTyped ? { socialLinks: socialLinksTyped } : {}),
  });

  const city =
    businessProfile && typeof businessProfile["city"] === "string" ? businessProfile["city"] : null;
  const province =
    businessProfile && typeof businessProfile["province"] === "string"
      ? businessProfile["province"]
      : null;
  const areaFiltered = [city, province].filter(Boolean).join(", ");

  const svcArgs: Parameters<typeof buildServiceJsonLd>[0] = {
    businessName,
    services,
    ...(areaFiltered.length > 0 ? { area: areaFiltered } : {}),
  };
  const svc = buildServiceJsonLd(svcArgs);
  const faq = buildFAQJsonLd(faqs);
  const aggRating = buildAggregateRatingJsonLd({ businessName, reviews });
  const breadcrumb = buildBreadcrumbListJsonLd([
    { name: "Home", url: canonicalPath || `/s/${encodeURIComponent(parsed.data)}` },
    { name: businessName },
  ]);
  const priceOffer = buildProductOfferPriceListJsonLd({
    businessName,
    prices,
    canonicalUrl: canonicalPath || `/s/${encodeURIComponent(parsed.data)}`,
  });

  const bpWhatsapp =
    businessProfile && typeof businessProfile["whatsapp"] === "string"
      ? businessProfile["whatsapp"]
      : null;
  const bpLat =
    businessProfile && typeof businessProfile["latitude"] === "number"
      ? businessProfile["latitude"]
      : null;
  const bpLng =
    businessProfile && typeof businessProfile["longitude"] === "number"
      ? businessProfile["longitude"]
      : null;
  const bpBusinessName =
    businessProfile && typeof businessProfile["business_name"] === "string"
      ? businessProfile["business_name"]
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(lb) }}
        key="velora-jsonld-localbusiness"
      />
      {svc ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(svc) }}
          key="velora-jsonld-service"
        />
      ) : null}
      {faq ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
          key="velora-jsonld-faq"
        />
      ) : null}
      {aggRating ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(aggRating) }}
          key="velora-jsonld-aggregate-rating"
        />
      ) : null}
      {breadcrumb ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
          key="velora-jsonld-breadcrumb"
        />
      ) : null}
      {priceOffer ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(priceOffer) }}
          key="velora-jsonld-price-offer"
        />
      ) : null}
      <div className="public-site-wrapper">{children}</div>
      <CookieBanner
        slug={parsed.data}
        tenantId={tenantId}
        privacyHref={`/s/${encodeURIComponent(parsed.data)}/privacy-policy`}
        cookieHref={`/s/${encodeURIComponent(parsed.data)}/cookie-policy`}
      />
      <MobileStickyCta
        slug={parsed.data}
        phone={
          businessProfile && typeof businessProfile["phone"] === "string"
            ? businessProfile["phone"]
            : null
        }
        whatsapp={bpWhatsapp}
        latitude={bpLat}
        longitude={bpLng}
        businessName={bpBusinessName ?? parsed.data}
      />
    </>
  );
}
