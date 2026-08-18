import { z } from "zod";
import { createSupabaseAnonReadonlyClient } from "@/lib/supabase/server";
import { normalizeSlug } from "@/lib/server/auth-pure";
import {
  buildDefaultDeterministicSections,
  isSingletonSection,
  parseSectionSettings,
  themeTokensSchema,
  normalizePublicLink,
  SECTION_TYPES,
  ALLOWED_VARIANTS,
  heroSettingsSchema,
  aboutSettingsSchema,
  servicesSettingsSchema,
  gallerySettingsSchema,
  staffSettingsSchema,
  reviewsSettingsSchema,
  contactSettingsSchema,
} from "@/lib/server/content-engine";
import type {
  PublicSite,
  PublicSection,
  PublicService,
  PublicTheme,
  SectionType,
} from "@/lib/server/content-engine";

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

/**
 * SOURCE OF TRUTH (Regola 49):
 *  businessName    ← business_profiles.display_name  (Structured, NOT JSONB)
 *  slug            ← tenants.slug
 *  publication     ← tenants.status = 'active' AND tenants.published = true
 *  section config  ← site_sections (position ASC, enabled, variant, settings JSONB presentation-only)
 *  section order   ← site_sections.position (deterministico, UNIQUE per tenant)
 *  contacts        ← business_profiles.phone/email/address/city/...
 *  services        ← services table (active=true, tenant_scoped RLS)
 *  staff public    ← dedicated public staff model IN FUTURO (oggi: []. MAI memberships!)
 *  reviews         ← dedicated review model IN FUTURO (oggi: []. MAI nomi fake!)
 *  theme tokens    ← business_profiles.theme_primary / theme_* (structured columns, non JSONB)
 */

type ThemeColumnsRaw = {
  theme_primary: string | null;
  theme_background: string | null;
  theme_foreground: string | null;
  theme_muted: string | null;
  theme_radius: string | null;
  theme_heading_font_preset: string | null;
  theme_body_font_preset: string | null;
};

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
  reason: "INVALID_SLUG" | "NO_TENANT" | "NOT_PUBLISHED" | "INCOMPLETE_PUBLIC_DATA";
}
export interface PublicTenantFound {
  readonly _tag: "Found";
  site: PublicSiteData;
  tenantId: string;
  theme: ThemeColumnsRaw;
}

export type PublicTenantResult = PublicTenantFound | PublicTenantNotFound;

export function truncateForLog(v: string | undefined | null, max: number): string {
  if (typeof v !== "string" || v.length === 0) return "none";
  if (v.length <= max) return v;
  return v.slice(0, max);
}

function buildNotFound(
  reason: PublicTenantNotFound["reason"],
  meta: { slug?: string | null; host?: string | null } = {},
): PublicTenantNotFound {
  const slug = truncateForLog(meta.slug, 60);
  const host = truncateForLog(meta.host, 80);
  console.warn(`[site-engine] public_not_found reason=${reason} slug=${slug} host=${host}`);
  return { _tag: "NotFound", reason };
}

export async function resolvePublicTenant(params: {
  slug?: unknown;
  hostname?: unknown;
}): Promise<PublicTenantResult> {
  let slugForLog: string | null = null;
  let hostForLog: string | null = null;
  try {
    const hasSlug = typeof params.slug === "string" && params.slug.length > 0;
    const hasHost = typeof params.hostname === "string" && params.hostname.length > 0;
    slugForLog = hasSlug ? (params.slug as string).slice(0, 200) : null;
    hostForLog = hasHost ? (params.hostname as string).slice(0, 253) : null;

    if (!hasSlug && !hasHost) {
      return buildNotFound("INVALID_SLUG", { slug: slugForLog, host: hostForLog });
    }

    let slugNormalized: string | null = null;
    if (hasSlug) {
      const parsed = slugSchema.safeParse(params.slug);
      if (!parsed.success) {
        return buildNotFound("INVALID_SLUG", {
          slug: typeof params.slug === "string" ? params.slug.slice(0, 60) : null,
        });
      }
      slugNormalized = parsed.data;
      slugForLog = slugNormalized;
    }
    const hostnameNormalized = hasHost ? normalizeHostname(params.hostname) : null;
    if (hasHost && !hostnameNormalized) {
      return buildNotFound("INVALID_SLUG", { host: hostForLog, slug: slugForLog });
    }
    if (hostnameNormalized) hostForLog = hostnameNormalized;

    const supabase = createSupabaseAnonReadonlyClient();
    let query = supabase
      .from("tenants")
      .select(
        `id,
       slug,
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
         timezone,
         theme_primary,
         theme_background,
         theme_foreground,
         theme_muted,
         theme_radius,
         theme_heading_font_preset,
         theme_body_font_preset
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
      return buildNotFound("INVALID_SLUG", { slug: slugForLog, host: hostForLog });
    }

    const { data, error } = await query.single();
    if (error || !data) {
      return buildNotFound("NO_TENANT", { slug: slugForLog, host: hostForLog });
    }
    if (data.status !== "active" || data.published !== true) {
      return buildNotFound("NOT_PUBLISHED", { slug: slugForLog, host: hostForLog });
    }

    const bpRaw = (data as { business_profiles?: unknown }).business_profiles ?? null;
    type BpFull = ThemeColumnsRaw & {
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
    };
    const bp = (
      Array.isArray(bpRaw) ? (bpRaw[0] ?? null) : bpRaw && typeof bpRaw === "object" ? bpRaw : null
    ) as BpFull | null;

    const businessName =
      bp?.display_name && typeof bp.display_name === "string" && bp.display_name.trim().length > 0
        ? bp.display_name.trim()
        : null;

    if (!businessName) {
      return buildNotFound("INCOMPLETE_PUBLIC_DATA", {
        slug: slugForLog,
        host: hostForLog,
      });
    }

    const theme: ThemeColumnsRaw = {
      theme_primary: bp?.theme_primary ?? null,
      theme_background: bp?.theme_background ?? null,
      theme_foreground: bp?.theme_foreground ?? null,
      theme_muted: bp?.theme_muted ?? null,
      theme_radius: bp?.theme_radius ?? null,
      theme_heading_font_preset: bp?.theme_heading_font_preset ?? null,
      theme_body_font_preset: bp?.theme_body_font_preset ?? null,
    };

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
      locale:
        bp?.locale && typeof bp.locale === "string" && bp.locale.length > 0 ? bp.locale : "it",
      timezone:
        bp?.timezone && typeof bp.timezone === "string" && bp.timezone.length > 0
          ? bp.timezone
          : "Europe/Rome",
      canonicalPath: `/s/${data.slug}`,
    };

    return { _tag: "Found", site, tenantId: data.id, theme };
  } catch (err) {
    const msg = err instanceof Error ? truncateForLog(err.message, 80) : "unexpected";
    console.error(`[site-engine] public_resolver_error kind=${msg}`);
    return buildNotFound("NO_TENANT", { slug: slugForLog, host: hostForLog });
  }
}

function mapTheme(bp: ThemeColumnsRaw): PublicTheme {
  const parsed = themeTokensSchema.safeParse({
    primary: bp.theme_primary,
    background: bp.theme_background,
    foreground: bp.theme_foreground,
    muted: bp.theme_muted,
    radius: bp.theme_radius,
    headingFont: bp.theme_heading_font_preset,
    bodyFont: bp.theme_body_font_preset,
  });
  return parsed.success ? parsed.data : {};
}

type SectionRow = {
  section_type: string;
  position: number;
  enabled: boolean;
  variant: string;
  settings: unknown;
};

type ServiceRow = {
  name: string;
  description: string | null;
  price_from: string | number | null;
  currency: string;
  duration_minutes: number | null;
};

function safeVariant(v: string): (typeof ALLOWED_VARIANTS)[number] {
  return ALLOWED_VARIANTS.includes(v as (typeof ALLOWED_VARIANTS)[number])
    ? (v as (typeof ALLOWED_VARIANTS)[number])
    : "default";
}

function mapServices(rows: ServiceRow[]): PublicService[] {
  const out: PublicService[] = [];
  for (const r of rows) {
    if (typeof r.name !== "string" || r.name.trim().length === 0) continue;
    const pf = r.price_from;
    const priceNum =
      pf == null ? null : typeof pf === "number" ? pf : typeof pf === "string" ? Number(pf) : null;
    out.push({
      name: r.name.trim().slice(0, 120),
      description: typeof r.description === "string" ? r.description.slice(0, 1000) : null,
      priceFrom: priceNum != null && isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
      currency:
        typeof r.currency === "string" && ["EUR", "USD", "GBP", "CHF"].includes(r.currency)
          ? r.currency
          : "EUR",
      durationMinutes:
        r.duration_minutes != null &&
        isFinite(r.duration_minutes) &&
        r.duration_minutes >= 1 &&
        r.duration_minutes <= 1440
          ? Math.round(r.duration_minutes)
          : null,
    });
  }
  return out;
}

export async function resolvePublicSiteContent(params: {
  slug?: unknown;
  hostname?: unknown;
}): Promise<
  | { readonly _tag: "NotFound"; reason: PublicTenantNotFound["reason"] }
  | { readonly _tag: "Found"; publicSite: PublicSite }
> {
  const base = await resolvePublicTenant(params);
  if (base._tag !== "Found") {
    return { _tag: "NotFound", reason: base.reason };
  }
  const site = base.site;
  const slugForLog = site.slug;
  const themeRaw = base.theme;
  const tenantId: string | null = base.tenantId ?? null;
  const supabase = createSupabaseAnonReadonlyClient();

  let rows: SectionRow[] = [];
  const services: PublicService[] = [];

  if (tenantId) {
    const [sectionsRes, servicesRes] = await Promise.all([
      supabase
        .from("site_sections")
        .select("section_type,position,enabled,variant,settings")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      supabase
        .from("services")
        .select("name,description,price_from,currency,duration_minutes")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("position", { ascending: true }),
    ]);
    if (!sectionsRes.error && sectionsRes.data) {
      rows = sectionsRes.data.map((r) => ({
        section_type: String(r.section_type),
        position: Number(r.position ?? 0),
        enabled: Boolean(r.enabled),
        variant: String(r.variant ?? "default"),
        settings: r.settings ?? {},
      }));
    }
    if (!servicesRes.error && servicesRes.data) {
      services.push(...mapServices(servicesRes.data as ServiceRow[]));
    }
  }

  const skipped: Array<{ type: string; pos: number; reason: string }> = [];

  if (rows.length === 0) {
    rows = buildDefaultDeterministicSections(
      { description: site.description },
      services.length,
    ).map((r) => ({
      section_type: r.section_type,
      position: r.position,
      enabled: r.enabled,
      variant: r.variant,
      settings: r.settings,
    }));
  } else {
    const rowsSorted = [...rows]
      .filter((r) => r.enabled)
      .sort((a, b) => a.position - b.position || a.section_type.localeCompare(b.section_type));
    const seen = new Set<SectionType>();
    rows = rowsSorted.filter((r) => {
      if (!SECTION_TYPES.includes(r.section_type as SectionType)) {
        skipped.push({ type: r.section_type, pos: r.position, reason: "unknown_type" });
        return false;
      }
      const ty = r.section_type as SectionType;
      if (isSingletonSection(ty)) {
        if (seen.has(ty)) {
          skipped.push({ type: ty, pos: r.position, reason: "duplicate_singleton" });
          return false;
        }
        seen.add(ty);
      }
      return true;
    });
  }

  const sections: PublicSection[] = [];
  const seenSingletons = new Set<SectionType>();

  for (const r of rows) {
    const ty = r.section_type as SectionType;
    if (!SECTION_TYPES.includes(ty)) {
      skipped.push({ type: ty, pos: r.position, reason: "unknown_type_filter" });
      continue;
    }
    if (isSingletonSection(ty)) {
      if (seenSingletons.has(ty)) {
        skipped.push({ type: ty, pos: r.position, reason: "dup_singleton_filter" });
        continue;
      }
      seenSingletons.add(ty);
    }
    const parsed = parseSectionSettings(ty, r.settings);
    if (!parsed.ok) {
      skipped.push({ type: ty, pos: r.position, reason: "invalid_settings" });
      continue;
    }

    const variant = safeVariant(r.variant);

    switch (ty) {
      case "hero":
        sections.push({
          type: "hero",
          variant,
          settings: parsed.value as z.infer<typeof heroSettingsSchema>,
          data: { businessName: site.businessName },
        });
        break;
      case "about":
        if (site.description && site.description.trim().length > 0) {
          sections.push({
            type: "about",
            variant,
            settings: parsed.value as z.infer<typeof aboutSettingsSchema>,
            data: { description: site.description, businessName: site.businessName },
          });
        }
        break;
      case "services":
        if (services.length > 0) {
          sections.push({
            type: "services",
            variant,
            settings: parsed.value as z.infer<typeof servicesSettingsSchema>,
            data: { services },
          });
        }
        break;
      case "gallery":
        sections.push({
          type: "gallery",
          variant,
          settings: parsed.value as z.infer<typeof gallerySettingsSchema>,
          data: { assets: [] },
        });
        break;
      case "staff":
        sections.push({
          type: "staff",
          variant,
          settings: parsed.value as z.infer<typeof staffSettingsSchema>,
          data: { members: [] },
        });
        break;
      case "reviews":
        sections.push({
          type: "reviews",
          variant,
          settings: parsed.value as z.infer<typeof reviewsSettingsSchema>,
          data: { reviews: [] },
        });
        break;
      case "contact": {
        const hasAny = site.phone || site.email || site.address || site.city;
        if (hasAny) {
          sections.push({
            type: "contact",
            variant,
            settings: parsed.value as z.infer<typeof contactSettingsSchema>,
            data: {
              phone: site.phone,
              email: site.email,
              address: site.address,
              city: site.city,
              province: site.province,
              postalCode: site.postalCode,
              countryCode: site.countryCode,
            },
          });
        }
        break;
      }
    }
  }

  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const s of skipped) {
      reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    }
    const summary = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    console.warn(
      `[site-engine] section_skipped slug=${slugForLog} total=${skipped.length} reasons=${summary}`,
    );
  }

  const theme = mapTheme(themeRaw);
  return { _tag: "Found", publicSite: { business: site, theme, sections } };
}

export { normalizePublicLink };
