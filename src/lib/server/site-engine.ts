import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeSlug } from "@/lib/server/auth-pure";

const SLUG_MAX_LEN = 60;

export const PUBLIC_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const slugSchema = z.preprocess(
  (v) => (typeof v === "string" ? normalizeSlug(v).slice(0, SLUG_MAX_LEN) : ""),
  z.string().min(2).max(SLUG_MAX_LEN).regex(PUBLIC_SLUG_PATTERN, "slug non valido"),
);

export function normalizeHostname(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let h = raw.trim().toLowerCase();
  const colonIdx = h.indexOf(":");
  if (colonIdx >= 0) h = h.slice(0, colonIdx);
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.length === 0) return null;
  if (h.length > 253) return null;
  const strict = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
  if (!strict.test(h)) return null;
  return h;
}

export interface PublicSiteData {
  slug: string;
  businessName: string;
  category: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  countryCode: string | null;
  locale: string;
  timezone: string;
  canonicalPath: string;
}

export interface PublicTenantNotFound {
  readonly _tag: "NotFound";
  reason: "INVALID_SLUG" | "NO_TENANT" | "NOT_PUBLISHED";
}
export interface PublicTenantFound {
  readonly _tag: "Found";
  site: PublicSiteData;
}

export type PublicTenantResult = PublicTenantFound | PublicTenantNotFound;

const TENANT_PUBLIC_SELECT_COLS = [
  "public.tenants:slug",
  "public.tenants:status",
  "public.tenants:published",
  "public.tenants:locale",
  "public.tenants:timezone",
] as const;
void TENANT_PUBLIC_SELECT_COLS;

function buildNotFound(reason: PublicTenantNotFound["reason"]): PublicTenantNotFound {
  return { _tag: "NotFound", reason };
}

export async function resolvePublicTenant(params: {
  slug?: unknown;
  hostname?: unknown;
}): Promise<PublicTenantResult> {
  const supabase = await createSupabaseServerClient();
  const hasSlug = typeof params.slug === "string" && params.slug.length > 0;
  const hasHost = typeof params.hostname === "string" && params.hostname.length > 0;

  let slugNormalized: string | null = null;
  if (hasSlug) {
    const parsed = slugSchema.safeParse(params.slug);
    if (!parsed.success) return buildNotFound("INVALID_SLUG");
    slugNormalized = parsed.data;
  }
  const hostnameNormalized = hasHost ? normalizeHostname(params.hostname) : null;

  let query = supabase
    .from("tenants")
    .select(
      `slug,
       name,
       status,
       published,
       business_profiles (
         display_name,
         category,
         description,
         phone,
         email,
         website_url,
         address_line1,
         city,
         province,
         postal_code,
         country_code,
         locale,
         timezone
       )`,
    )
    .limit(1);

  if (slugNormalized) {
    query = query.eq("slug", slugNormalized);
  } else if (hostnameNormalized) {
    query = query.or(
      `temporary_domain.eq.${hostnameNormalized},custom_domain.eq.${hostnameNormalized}`,
    );
  } else {
    return buildNotFound("INVALID_SLUG");
  }

  const { data, error } = await query.single();
  if (error || !data) {
    return buildNotFound("NO_TENANT");
  }
  if (data.status !== "active" || data.published !== true) {
    return buildNotFound("NOT_PUBLISHED");
  }

  const bpRaw = (data as { business_profiles?: unknown }).business_profiles ?? null;
  const bp = (
    Array.isArray(bpRaw) ? (bpRaw[0] ?? null) : bpRaw && typeof bpRaw === "object" ? bpRaw : null
  ) as null | {
    display_name: string | null;
    category: string | null;
    description: string | null;
    phone: string | null;
    email: string | null;
    website_url: string | null;
    address_line1: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    country_code: string | null;
    locale: string | null;
    timezone: string | null;
  } | null;

  const businessName =
    bp?.display_name && typeof bp.display_name === "string" && bp.display_name.length > 0
      ? bp.display_name
      : typeof data.name === "string" && data.name.length > 0
        ? data.name
        : data.slug;

  const site: PublicSiteData = {
    slug: data.slug,
    businessName,
    category: bp?.category ?? null,
    description: bp?.description ?? null,
    phone: bp?.phone ?? null,
    email: bp?.email ?? null,
    websiteUrl: bp?.website_url ?? null,
    address: bp?.address_line1 ?? null,
    city: bp?.city ?? null,
    province: bp?.province ?? null,
    postalCode: bp?.postal_code ?? null,
    countryCode: bp?.country_code ?? null,
    locale: bp?.locale && typeof bp.locale === "string" && bp.locale.length > 0 ? bp.locale : "it",
    timezone:
      bp?.timezone && typeof bp.timezone === "string" && bp.timezone.length > 0
        ? bp.timezone
        : "Europe/Rome",
    canonicalPath: `/s/${data.slug}`,
  };

  return { _tag: "Found", site };
}
