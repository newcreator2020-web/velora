import CookieBanner from "@/app/s/[slug]/components/CookieBanner";

interface WeeklyHoursRow {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  closed?: boolean;
  open?: string;
  close?: string;
}
import MobileStickyCta from "@/app/s/[slug]/components/MobileStickyCta";
import {
  buildAggregateRatingJsonLd,
  buildBreadcrumbListJsonLd,
  buildFAQJsonLd,
  buildLocalBusinessJsonLd,
  buildProductOfferPriceListJsonLd,
  buildServiceJsonLd,
} from "@/lib/server/seo";
import { resolvePublicSiteContent, resolvePublicTenant } from "@/lib/server/site-engine";

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

interface HostPublicLayoutProps {
  children: React.ReactNode;
}

export async function HostTenantContext({ children }: HostPublicLayoutProps) {
  const headersList = await import("next/headers").then((m) => m.headers());
  const rawHost =
    (process.env.NODE_ENV !== "production" || process.env["PLAYWRIGHT_USE_PRODUCTION"] === "1"
      ? (headersList.get("x-velora-host") ?? undefined)
      : undefined) ??
    headersList.get("host") ??
    "";
  const hostname = rawHost.split(":")[0] ?? "";
  let slug: string | null = null;
  let tenantId: string | null = null;
  let businessProfile: Record<string, unknown> | null = null;
  let businessName: string | null = null;
  let description: string | undefined;
  let canonicalPath: string | undefined;
  let logoUrl: string | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  let priceRange: string | undefined;
  let weeklyHours: WeeklyHoursRow[] | null = null;
  let socialLinks: Array<{ platform: string; url: string }> | null = null;
  let bpWhatsapp: string | null = null;
  let bpLat: number | null = null;
  let bpLng: number | null = null;
  let bpBusinessName: string | null = null;
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
    const normalized = hostname?.length
      ? (await import("@/lib/server/site-engine")).normalizeHostname(hostname)
      : null;
    if (normalized) {
      const result = await resolvePublicTenant({ hostname: normalized });
      if (result._tag === "Found") {
        const tenantRecord = result as unknown as Record<string, unknown>;
        tenantId = typeof tenantRecord["tenantId"] === "string" ? tenantRecord["tenantId"] : null;
        const site =
          tenantRecord["site"] && typeof tenantRecord["site"] === "object"
            ? (tenantRecord["site"] as Record<string, unknown>)
            : null;
        if (site) {
          businessName = String(site["businessName"] ?? hostname ?? "Attività locale");
          if (typeof site["slug"] === "string") slug = site["slug"];
          if (typeof site["description"] === "string") description = site["description"];
          if (typeof site["canonicalPath"] === "string") canonicalPath = site["canonicalPath"];
          businessProfile =
            site["businessProfile"] && typeof site["businessProfile"] === "object"
              ? (site["businessProfile"] as Record<string, unknown>)
              : null;
          if (typeof site["logoUrl"] === "string" && site["logoUrl"].length > 0)
            logoUrl = site["logoUrl"];
          if (typeof site["phone"] === "string" && site["phone"].length > 0) phone = site["phone"];
          if (typeof site["email"] === "string" && site["email"].length > 0) email = site["email"];
          if (typeof site["priceRange"] === "string" && site["priceRange"].length > 0)
            priceRange = site["priceRange"];
          weeklyHours = toWeeklyHours(site["weeklyHours"]);
          socialLinks = Array.isArray(site["socialLinks"])
            ? (site["socialLinks"] as Array<{ platform: string; url: string }>)
            : null;
          if (businessProfile && typeof businessProfile["whatsapp"] === "string") {
            bpWhatsapp = businessProfile["whatsapp"];
          }
          if (businessProfile && typeof businessProfile["latitude"] === "number") {
            bpLat = businessProfile["latitude"];
          }
          if (businessProfile && typeof businessProfile["longitude"] === "number") {
            bpLng = businessProfile["longitude"];
          }
          if (businessProfile && typeof businessProfile["business_name"] === "string") {
            bpBusinessName = businessProfile["business_name"];
          }
        }
        if (slug) {
          const contentResult = await resolvePublicSiteContent({ slug });
          if (contentResult._tag === "Found") {
            const rec = contentResult as unknown as Record<string, unknown>;
            const publicSite =
              rec["publicSite"] && typeof rec["publicSite"] === "object"
                ? (rec["publicSite"] as Record<string, unknown>)
                : null;
            const serviceList: unknown[] = Array.isArray(publicSite?.["services"])
              ? publicSite["services"]
              : [];
            for (const raw of serviceList) {
              const s = (raw ?? {}) as Record<string, unknown>;
              const name = typeof s["name"] === "string" ? s["name"].trim() : "";
              if (!name) continue;
              const item: ServiceItem = { name };
              if (typeof s["id"] === "string" && s["id"].length > 0) item.id = s["id"];
              if (typeof s["description"] === "string" && s["description"].trim().length > 0) {
                item.description = s["description"].trim();
              }
              if (typeof s["price_from"] === "number" && Number.isFinite(s["price_from"])) {
                item.price_from = s["price_from"];
              }
              if (
                typeof s["duration_minutes"] === "number" &&
                Number.isFinite(s["duration_minutes"])
              ) {
                item.duration_minutes = s["duration_minutes"];
              }
              services.push(item);
            }
            const sections: unknown[] = Array.isArray(publicSite?.["sections"])
              ? publicSite["sections"]
              : [];
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
                const items = Array.isArray(content?.["items"])
                  ? (content["items"] as unknown[])
                  : [];
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
                    typeof r["rating"] === "number" && Number.isFinite(r["rating"])
                      ? r["rating"]
                      : null;
                  reviews.push({ rating });
                }
              }

              if (secType === "price_list") {
                const priceItems = Array.isArray(data?.["items"])
                  ? (data["items"] as unknown[])
                  : [];
                for (const pRaw of priceItems) {
                  const p = (pRaw ?? {}) as Record<string, unknown>;
                  const name = typeof p["name"] === "string" ? p["name"].trim() : "";
                  if (!name) continue;
                  const price =
                    typeof p["price"] === "number" && Number.isFinite(p["price"])
                      ? p["price"]
                      : null;
                  const desc =
                    typeof p["description"] === "string" ? p["description"].trim() : null;
                  prices.push({ name, description: desc, price });
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // degrade silently: JSON-LD / UI enhancements are non-fatal.
  }

  if (!slug || !tenantId) {
    return <>{children}</>;
  }

  const city =
    businessProfile && typeof businessProfile["city"] === "string" ? businessProfile["city"] : null;
  const province =
    businessProfile && typeof businessProfile["province"] === "string"
      ? businessProfile["province"]
      : null;
  const areaFiltered = [city, province].filter(Boolean).join(", ");
  const businessTyped = businessName ?? slug;

  const lb = buildLocalBusinessJsonLd({
    businessName: businessTyped,
    ...(description ? { description } : {}),
    ...(canonicalPath ? { canonicalUrl: canonicalPath } : {}),
    ...(logoUrl ? { logoOrImage: logoUrl } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(businessProfile ? { businessProfile } : {}),
    ...(weeklyHours ? { weeklyHours } : {}),
    ...(socialLinks ? { socialLinks } : {}),
  });
  const svc = buildServiceJsonLd({
    businessName: businessTyped,
    services,
    ...(areaFiltered.length > 0 ? { area: areaFiltered } : {}),
  });
  const faq = buildFAQJsonLd(faqs);
  const aggRating = buildAggregateRatingJsonLd({ businessName: businessTyped, reviews });
  const breadcrumb = buildBreadcrumbListJsonLd([
    { name: "Home", url: canonicalPath || `https://${hostname}` },
    { name: businessTyped },
  ]);
  const priceOffer = buildProductOfferPriceListJsonLd({
    businessName: businessTyped,
    prices,
    canonicalUrl: canonicalPath || `https://${hostname}`,
  });

  const bpPhone =
    businessProfile && typeof businessProfile["phone"] === "string"
      ? businessProfile["phone"]
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
        slug={slug}
        tenantId={tenantId}
        privacyHref="/privacy-policy"
        cookieHref="/cookie-policy"
      />
      <MobileStickyCta
        slug={slug}
        phone={bpPhone}
        whatsapp={bpWhatsapp}
        latitude={bpLat}
        longitude={bpLng}
        businessName={bpBusinessName ?? slug}
        bookingBasePath="/"
      />
    </>
  );
}

export default function PublicHostLayout({ children }: HostPublicLayoutProps) {
  return <HostTenantContext>{children}</HostTenantContext>;
}
