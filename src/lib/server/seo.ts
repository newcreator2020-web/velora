import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";

type BusinessProfile = Database["public"]["Tables"]["business_profiles"]["Row"];

export const JSON_LD_CONTEXT = "https://schema.org";

export interface LocalBusinessJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "LocalBusiness" | "BeautySalon" | "HairSalon" | "HealthAndBeautyBusiness" | "BarberShop";
  name: string;
  description?: string;
  url?: string;
  image?: string;
  telephone?: string;
  email?: string;
  priceRange?: string;
  address?: {
    "@type": "PostalAddress";
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  geo?: {
    "@type": "GeoCoordinates";
    latitude?: number;
    longitude?: number;
  };
  openingHoursSpecification?: Array<{
    "@type": "OpeningHoursSpecification";
    dayOfWeek: string[];
    opens?: string;
    closes?: string;
  }>;
  areaServed?: string;
  sameAs?: string[];
}

export interface ServiceJsonLdItem {
  "@type": "Offer" | "Service";
  name: string;
  description?: string;
  price?: number;
  priceCurrency?: string;
  duration?: string;
  provider?: {
    "@type": "LocalBusiness";
    name: string;
  };
}

export interface ServiceJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "Service";
  serviceType: string;
  areaServed?: string;
  provider?: {
    "@type": "LocalBusiness";
    name: string;
  };
  hasOfferCatalog?: {
    "@type": "OfferCatalog";
    name: string;
    itemListElement: ServiceJsonLdItem[];
  };
}

export interface FAQJsonLdItem {
  "@type": "Question";
  name: string;
  acceptedAnswer: {
    "@type": "Answer";
    text: string;
  };
}

export interface FAQJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "FAQPage";
  mainEntity: FAQJsonLdItem[];
}

export interface AggregateRatingJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "AggregateRating";
  ratingValue: string;
  reviewCount: number;
  bestRating?: string;
  worstRating?: string;
  itemReviewed?: {
    "@type": "LocalBusiness";
    name: string;
  };
}

export interface BreadcrumbListJsonLdItem {
  "@type": "ListItem";
  position: number;
  name: string;
  item?: string;
}

export interface BreadcrumbListJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "BreadcrumbList";
  itemListElement: BreadcrumbListJsonLdItem[];
}

export interface PriceListOfferItem {
  "@type": "Offer";
  name: string;
  price: number;
  priceCurrency: string;
  description?: string;
  sku?: string;
  availability?: string;
  url?: string;
}

export interface ProductPriceListJsonLd {
  "@context": typeof JSON_LD_CONTEXT;
  "@type": "Product";
  name: string;
  description?: string;
  brand?: {
    "@type": "Brand";
    name: string;
  };
  offers?: {
    "@type": "OfferCatalog";
    name: string;
    itemListElement: PriceListOfferItem[];
  };
}

const DEFAULT_COUNTRY = "IT";
const DEFAULT_CURRENCY = "EUR";

function sanitizeText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim();
}

function detectLocalBusinessSubtype(
  bp: Partial<BusinessProfile> | null,
): LocalBusinessJsonLd["@type"] {
  const cat = String(bp?.category ?? "").toLowerCase();
  if (cat.includes("barber") || cat.includes("barbiere")) return "BarberShop";
  if (cat.includes("parrucchier") || cat.includes("hair") || cat.includes("capell"))
    return "HairSalon";
  if (
    cat.includes("estet") ||
    cat.includes("beauty") ||
    cat.includes("benesser") ||
    cat.includes("solarium") ||
    cat.includes("massagg")
  ) {
    return "HealthAndBeautyBusiness";
  }
  if (
    cat.includes("nail") ||
    cat.includes("ungh") ||
    cat.includes("makeup") ||
    cat.includes("trucco")
  ) {
    return "BeautySalon";
  }
  return "LocalBusiness";
}

export function buildLocalBusinessJsonLd(params: {
  businessName: string;
  description?: string;
  canonicalUrl?: string;
  logoOrImage?: string;
  phone?: string;
  email?: string;
  priceRange?: string;
  businessProfile?: Partial<BusinessProfile> | null;
  weeklyHours?: Array<{ day: string; open?: string; close?: string; closed?: boolean }> | null;
  socialLinks?: Array<{ platform: string; url: string }> | null;
}): LocalBusinessJsonLd {
  const bp = params.businessProfile ?? null;
  const type = detectLocalBusinessSubtype(bp);

  const out: LocalBusinessJsonLd = {
    "@context": JSON_LD_CONTEXT,
    "@type": type,
    name: sanitizeText(params.businessName) || "Attività locale",
  };
  if (params.description) out.description = sanitizeText(params.description);
  if (params.canonicalUrl) out.url = params.canonicalUrl;
  if (params.logoOrImage) out.image = params.logoOrImage;
  if (params.phone) out.telephone = sanitizeText(params.phone);
  if (params.email) out.email = sanitizeText(params.email);
  out.priceRange = sanitizeText(params.priceRange) || "€€€";

  const street = sanitizeText(bp?.address_line1);
  const city = sanitizeText(bp?.city);
  const province = sanitizeText(bp?.province);
  const cap = sanitizeText(bp?.postal_code);
  if (street || city || province || cap) {
    out.address = {
      "@type": "PostalAddress",
      ...(street ? { streetAddress: street } : {}),
      ...(city ? { addressLocality: city } : {}),
      ...(province ? { addressRegion: province } : {}),
      ...(cap ? { postalCode: cap } : {}),
      addressCountry: DEFAULT_COUNTRY,
    };
  }

  const lat = typeof bp?.latitude === "number" ? bp.latitude : null;
  const lng = typeof bp?.longitude === "number" ? bp.longitude : null;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    out.geo = {
      "@type": "GeoCoordinates",
      latitude: lat,
      longitude: lng,
    };
  }

  const weekMap: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  if (params.weeklyHours && params.weeklyHours.length > 0) {
    const list: NonNullable<LocalBusinessJsonLd["openingHoursSpecification"]> = [];
    for (const d of params.weeklyHours) {
      if (d.closed || !d.open || !d.close) continue;
      const item: NonNullable<LocalBusinessJsonLd["openingHoursSpecification"]>[number] = {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [weekMap[d.day] ?? d.day],
      };
      if (typeof d.open === "string" && d.open.length > 0) item.opens = d.open;
      if (typeof d.close === "string" && d.close.length > 0) item.closes = d.close;
      list.push(item);
    }
    if (list.length > 0) out.openingHoursSpecification = list;
  }

  const served = [city, province].filter(Boolean).join(", ");
  if (served) out.areaServed = served;

  if (params.socialLinks && params.socialLinks.length > 0) {
    out.sameAs = params.socialLinks.map((s) => s.url).filter(Boolean);
    if (out.sameAs.length === 0) delete out.sameAs;
  }

  return out;
}

export function buildServiceJsonLd(params: {
  businessName: string;
  services: Array<{
    id?: string;
    name: string;
    description?: string;
    price_from?: number | null;
    duration_minutes?: number | null;
  }>;
  area?: string;
}): ServiceJsonLd | null {
  const list = (params.services ?? [])
    .filter((s) => sanitizeText(s.name))
    .map<ServiceJsonLdItem>((s) => {
      const durationStr =
        typeof s.duration_minutes === "number" && s.duration_minutes > 0
          ? `PT${Math.floor(s.duration_minutes / 60)}H${s.duration_minutes % 60 > 0 ? `${s.duration_minutes % 60}M` : ""}`
          : undefined;
      const base: ServiceJsonLdItem = {
        "@type": "Service",
        name: sanitizeText(s.name),
      };
      if (s.description) base.description = sanitizeText(s.description);
      if (typeof s.price_from === "number" && Number.isFinite(s.price_from)) {
        base.price = Number(s.price_from.toFixed(2));
        base.priceCurrency = DEFAULT_CURRENCY;
      }
      if (durationStr) base.duration = durationStr;
      return base;
    });

  if (list.length === 0) return null;

  return {
    "@context": JSON_LD_CONTEXT,
    "@type": "Service",
    serviceType: "Servizi locali",
    ...(params.area ? { areaServed: params.area } : {}),
    provider: { "@type": "LocalBusiness", name: sanitizeText(params.businessName) },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `Listino servizi — ${sanitizeText(params.businessName)}`,
      itemListElement: list,
    },
  };
}

export function buildFAQJsonLd(
  faqs: Array<{ question: string; answer: string }>,
): FAQJsonLd | null {
  const items = (faqs ?? [])
    .filter((f) => sanitizeText(f.question) && sanitizeText(f.answer))
    .map<FAQJsonLdItem>((f) => ({
      "@type": "Question",
      name: sanitizeText(f.question),
      acceptedAnswer: { "@type": "Answer", text: sanitizeText(f.answer) },
    }));
  if (items.length === 0) return null;
  return { "@context": JSON_LD_CONTEXT, "@type": "FAQPage", mainEntity: items };
}

export function buildAggregateRatingJsonLd(params: {
  businessName: string;
  reviews: Array<{ rating?: number | null }>;
}): AggregateRatingJsonLd | null {
  const reviews = (params.reviews ?? []).filter(
    (r) => typeof r.rating === "number" && Number.isFinite(r.rating),
  ) as Array<{ rating: number }>;
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  const avg = sum / reviews.length;
  const avgStr = (Math.round(avg * 10) / 10).toFixed(1);
  return {
    "@context": JSON_LD_CONTEXT,
    "@type": "AggregateRating",
    ratingValue: avgStr,
    reviewCount: reviews.length,
    bestRating: "5",
    worstRating: "1",
    itemReviewed: {
      "@type": "LocalBusiness",
      name: sanitizeText(params.businessName) || "Attività locale",
    },
  };
}

export function buildBreadcrumbListJsonLd(
  items: Array<{ name: string; url?: string }>,
): BreadcrumbListJsonLd | null {
  const list = (items ?? [])
    .filter((it) => sanitizeText(it.name))
    .map<BreadcrumbListJsonLdItem>((it, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: sanitizeText(it.name),
      ...(it.url ? { item: it.url } : {}),
    }));
  if (list.length === 0) return null;
  return {
    "@context": JSON_LD_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: list,
  };
}

export function buildProductOfferPriceListJsonLd(params: {
  businessName: string;
  prices: Array<{
    name: string;
    description?: string | null;
    price?: number | null;
  }>;
  canonicalUrl?: string;
}): ProductPriceListJsonLd | null {
  const rows = (params.prices ?? [])
    .filter((p) => sanitizeText(p.name))
    .filter((p) => typeof p.price === "number" && Number.isFinite(p.price))
    .map<PriceListOfferItem>((p, i) => ({
      "@type": "Offer",
      name: sanitizeText(p.name),
      price: Number(Number(p.price).toFixed(2)),
      priceCurrency: DEFAULT_CURRENCY,
      ...(p.description ? { description: sanitizeText(p.description) } : {}),
      sku: `PRC-${i + 1}`,
      availability: "https://schema.org/InStock",
      ...(params.canonicalUrl ? { url: params.canonicalUrl + "#price_list" } : {}),
    }));
  if (rows.length === 0) return null;
  return {
    "@context": JSON_LD_CONTEXT,
    "@type": "Product",
    name: `Servizi — ${sanitizeText(params.businessName)}`,
    description: `Listino prezzi dei servizi offerti da ${sanitizeText(params.businessName)}`,
    brand: { "@type": "Brand", name: sanitizeText(params.businessName) },
    offers: {
      "@type": "OfferCatalog",
      name: `Listino prezzi — ${sanitizeText(params.businessName)}`,
      itemListElement: rows,
    },
  };
}

export interface PublishedSiteSitemapEntry {
  slug: string;
  lastModified: Date;
  canonicalUrl: string | null;
}

export async function listPublishedSitesForSitemap(): Promise<PublishedSiteSitemapEntry[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tenants")
    .select("slug, updated_at, published_at, custom_domain, temporary_domain")
    .eq("published", true)
    .eq("status", "active")
    .not("slug", "is", null)
    .order("updated_at", { ascending: false });

  if (!data) return [];

  const basePublicUrl = sanitizeText(process.env["NEXT_PUBLIC_APP_URL"]).replace(/\/$/, "") || null;

  return data
    .filter((row) => row.slug && row.slug.length >= 3)
    .map((row) => {
      const last =
        (row.published_at && new Date(row.published_at) > new Date(row.updated_at)
          ? new Date(row.published_at)
          : new Date(row.updated_at)) ?? new Date();
      const canonicalFromCustom =
        row.custom_domain && /^[a-z0-9.-]+$/i.test(row.custom_domain)
          ? `https://${row.custom_domain}/`
          : null;
      const canonicalFromTemp =
        !canonicalFromCustom && row.temporary_domain
          ? `https://${row.temporary_domain}/`
          : basePublicUrl
            ? `${basePublicUrl}/s/${row.slug}`
            : null;
      return {
        slug: row.slug,
        lastModified: last,
        canonicalUrl: canonicalFromCustom ?? canonicalFromTemp,
      };
    });
}
