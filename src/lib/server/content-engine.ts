import { z } from "zod";
import type { PublicSiteData } from "./site-engine";

export const SECTION_TYPES = [
  "hero",
  "about",
  "services",
  "gallery",
  "staff",
  "reviews",
  "contact",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const ALLOWED_VARIANTS = [
  "default",
  "centered",
  "split",
  "minimal",
  "cards",
  "carousel",
] as const;

export const FONT_HEADING_ALLOWED = ["sans", "serif", "mono", "display"] as const;
export const FONT_BODY_ALLOWED = ["sans", "serif", "mono"] as const;
export const RADIUS_ALLOWED = ["none", "sm", "md", "lg", "xl", "full"] as const;

export const SINGLETON_TYPES: ReadonlyArray<SectionType> = ["hero", "about", "contact"];

export function safeVariant(v: string): (typeof ALLOWED_VARIANTS)[number] {
  return ALLOWED_VARIANTS.includes(v as (typeof ALLOWED_VARIANTS)[number])
    ? (v as (typeof ALLOWED_VARIANTS)[number])
    : "default";
}

export function isSingletonSection(t: unknown): t is "hero" | "about" | "contact" {
  return typeof t === "string" && SINGLETON_TYPES.includes(t as SectionType);
}

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "colore hex invalido");

export const themeTokensSchema = z.object({
  primary: hexColor.nullish(),
  background: hexColor.nullish(),
  foreground: hexColor.nullish(),
  muted: hexColor.nullish(),
  radius: z.enum(RADIUS_ALLOWED).nullish(),
  headingFont: z.enum(FONT_HEADING_ALLOWED).nullish(),
  bodyFont: z.enum(FONT_BODY_ALLOWED).nullish(),
});

export type PublicTheme = z.infer<typeof themeTokensSchema>;

const nonEmptyText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.slice(0, max) : v), z.string().max(max));

const headlineOverride = nonEmptyText(160).nullish();
const eyebrow = nonEmptyText(80).nullish();
const subheadline = nonEmptyText(320).nullish();
const ctaLabel = nonEmptyText(40).nullish();

export const ctaTarget = z.preprocess(
  (v) => normalizePublicLink(typeof v === "string" ? v : ""),
  z.union([z.literal(""), z.string().min(1).max(260)]).nullish(),
);

const alignment = z.enum(["left", "center", "right"]).nullish();
const variantAllowed = z.enum(ALLOWED_VARIANTS);

export const heroSettingsSchema = z.object({
  eyebrow,
  headlineOverride,
  subheadline,
  ctaLabel,
  ctaTarget,
  alignment,
  variant: variantAllowed.optional(),
});

export const aboutSettingsSchema = z.object({
  eyebrow,
  variant: variantAllowed.optional(),
  alignment,
});

export const servicesSettingsSchema = z.object({
  eyebrow,
  headline: nonEmptyText(120).nullish(),
  variant: variantAllowed.optional(),
});

export const gallerySettingsSchema = z.object({
  eyebrow,
  headline: nonEmptyText(120).nullish(),
  variant: variantAllowed.optional(),
  columns: z.number().int().min(1).max(4).nullish(),
});

export const staffSettingsSchema = z.object({
  eyebrow,
  headline: nonEmptyText(120).nullish(),
  variant: variantAllowed.optional(),
});

export const reviewsSettingsSchema = z.object({
  eyebrow,
  headline: nonEmptyText(120).nullish(),
  variant: variantAllowed.optional(),
});

export const contactSettingsSchema = z.object({
  eyebrow,
  headline: nonEmptyText(120).nullish(),
  variant: variantAllowed.optional(),
  showForm: z.boolean().nullish(),
});

export type SectionSettingsSchemaMap = {
  hero: typeof heroSettingsSchema;
  about: typeof aboutSettingsSchema;
  services: typeof servicesSettingsSchema;
  gallery: typeof gallerySettingsSchema;
  staff: typeof staffSettingsSchema;
  reviews: typeof reviewsSettingsSchema;
  contact: typeof contactSettingsSchema;
};

export const SECTION_SETTINGS_SCHEMAS: SectionSettingsSchemaMap = {
  hero: heroSettingsSchema,
  about: aboutSettingsSchema,
  services: servicesSettingsSchema,
  gallery: gallerySettingsSchema,
  staff: staffSettingsSchema,
  reviews: reviewsSettingsSchema,
  contact: contactSettingsSchema,
};

export function parseSectionSettings(
  type: unknown,
  settings: unknown,
): { ok: true; value: unknown } | { ok: false; issue: string } {
  if (typeof type !== "string" || !SECTION_TYPES.includes(type as SectionType)) {
    return { ok: false, issue: "invalid section_type" };
  }
  const schema = SECTION_SETTINGS_SCHEMAS[type as SectionType];
  const safe = schema.safeParse(settings ?? {});
  if (!safe.success) {
    return { ok: false, issue: "invalid settings" };
  }
  return { ok: true, value: safe.data };
}

const SAFE_PROTOCOLS = ["http:", "https:", "tel:", "mailto:"] as const;
function isSafeProtocol(raw: string): boolean {
  const m = /^([a-z][a-z0-9+\-.]*:)/i.exec(raw);
  if (!m) return true;
  const proto = m[1];
  if (!proto) return true;
  return (SAFE_PROTOCOLS as readonly string[]).includes(proto.toLowerCase());
}

export function normalizePublicLink(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (s.length === 0) return "";
  if (s.length > 260) return "";
  if (s.startsWith("//")) return "";
  if (s.startsWith("/\\")) return "";
  if (!isSafeProtocol(s)) return "";

  if (s.startsWith("/")) {
    const ok = /^\/[a-z0-9\-_~.%?=#&]+(?:\/[a-z0-9\-_~.%?=#&]*)*$/i.test(s) || s === "/";
    return ok ? s : "";
  }

  try {
    const u = new URL(s, "https://placeholder.local");
    if (u.origin !== "https://placeholder.local") {
      if (!(SAFE_PROTOCOLS as readonly string[]).includes(u.protocol)) return "";
      if (u.protocol === "http:" || u.protocol === "https:") {
        return s;
      }
      if (u.protocol === "tel:" || u.protocol === "mailto:") {
        return s;
      }
      return "";
    }
    return "";
  } catch {
    return "";
  }
}

export function validateHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

export function validateFontPreset(v: unknown, allowDisplay: boolean): boolean {
  const list: readonly string[] = allowDisplay ? FONT_HEADING_ALLOWED : FONT_BODY_ALLOWED;
  return typeof v === "string" && list.includes(v);
}

export function validateRadiusPreset(v: unknown): boolean {
  return typeof v === "string" && RADIUS_ALLOWED.includes(v as (typeof RADIUS_ALLOWED)[number]);
}

export function buildDefaultDeterministicSections(
  bp: { description: string | null },
  _servicesCount: number,
): Array<{
  section_type: SectionType;
  position: number;
  enabled: boolean;
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: unknown;
}> {
  const list: Array<{
    section_type: SectionType;
    position: number;
    enabled: boolean;
    variant: (typeof ALLOWED_VARIANTS)[number];
    settings: unknown;
  }> = [{ section_type: "hero", position: 0, enabled: true, variant: "centered", settings: {} }];
  if (bp.description && bp.description.trim().length > 0) {
    list.push({
      section_type: "about",
      position: list.length,
      enabled: true,
      variant: "default",
      settings: {},
    });
  }
  list.push({
    section_type: "contact",
    position: list.length,
    enabled: true,
    variant: "default",
    settings: {},
  });
  return list;
}

export type HeroSection = {
  type: "hero";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof heroSettingsSchema>;
  data: { businessName: string };
};

export type AboutSection = {
  type: "about";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof aboutSettingsSchema>;
  data: { description: string | null; businessName: string };
};

export type PublicService = {
  name: string;
  description: string | null;
  priceFrom: number | null;
  currency: string;
  durationMinutes: number | null;
};

export type ServicesSection = {
  type: "services";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof servicesSettingsSchema>;
  data: { services: PublicService[] };
};

export type PublicGalleryAsset = {
  url: string;
  alt: string | null;
};

export type GallerySection = {
  type: "gallery";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof gallerySettingsSchema>;
  data: { assets: PublicGalleryAsset[] };
};

export type PublicStaffMember = {
  name: string;
  role: string | null;
  bio: string | null;
  photoUrl: string | null;
};

export type StaffSection = {
  type: "staff";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof staffSettingsSchema>;
  data: { members: PublicStaffMember[] };
};

export type PublicReview = {
  author: string;
  rating: number;
  body: string | null;
};

export type ReviewsSection = {
  type: "reviews";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof reviewsSettingsSchema>;
  data: { reviews: PublicReview[] };
};

export type ContactSection = {
  type: "contact";
  variant: (typeof ALLOWED_VARIANTS)[number];
  settings: z.infer<typeof contactSettingsSchema>;
  data: {
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    countryCode: string | null;
  };
};

export type PublicSection =
  | HeroSection
  | AboutSection
  | ServicesSection
  | GallerySection
  | StaffSection
  | ReviewsSection
  | ContactSection;

export type PublicSite = {
  business: PublicSiteData;
  theme: PublicTheme;
  sections: PublicSection[];
};
