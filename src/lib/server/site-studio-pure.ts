import { z } from "zod";
import {
  SECTION_TYPES,
  ALLOWED_VARIANTS,
  SINGLETON_TYPES,
  SECTION_SETTINGS_SCHEMAS,
  FONT_HEADING_ALLOWED,
  FONT_BODY_ALLOWED,
  RADIUS_ALLOWED,
  DESIGN_PRESET_ALLOWED,
  validateHexColor,
  type SectionType,
  type PublicTheme,
} from "./content-engine";

export const CURRENCY_ALLOWED = ["EUR", "USD", "GBP", "CHF"] as const;
export type Currency = (typeof CURRENCY_ALLOWED)[number];

const HEX_COLOR = z.string().refine(validateHexColor, "colore hex invalido");

const NON_NEG_PRICE = z.number().nonnegative().finite().lte(999999);
const POS_INT = z.number().int().nonnegative().lte(1440);

const posIntFromString = z.union([
  z.number().int().nonnegative().lte(10000),
  z.preprocess(
    (v) => (typeof v === "string" ? Number(v) : NaN),
    z.number().int().nonnegative().lte(10000),
  ),
]);

export const studioSectionSchema = z.object({
  id: z.string().uuid().nullish(),
  section_type: z.enum(SECTION_TYPES),
  enabled: z.boolean(),
  position: posIntFromString,
  variant: z.enum(ALLOWED_VARIANTS).optional().or(z.literal("")),
  settings: z.record(z.string(), z.unknown()).default({}).or(z.object({}).passthrough()),
});

export const studioServiceSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, "Nome obbligatorio").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.union([
    z.preprocess(
      (v) =>
        v === null || v === undefined || v === "" ? null : typeof v === "string" ? Number(v) : v,
      NON_NEG_PRICE.nullable().optional(),
    ),
    z.null(),
  ]),
  price_from: z.union([
    z.preprocess(
      (v) =>
        v === null || v === undefined || v === "" ? null : typeof v === "string" ? Number(v) : v,
      NON_NEG_PRICE.nullable().optional(),
    ),
    z.null(),
  ]),
  currency: z.enum(CURRENCY_ALLOWED).optional().default("EUR"),
  duration_minutes: z.union([
    z.preprocess(
      (v) =>
        v === null || v === undefined || v === "" ? null : typeof v === "string" ? Number(v) : v,
      POS_INT.nullable().optional(),
    ),
    z.null(),
  ]),
  position: posIntFromString,
  active: z.boolean(),
});

export type StudioDraftSection = z.infer<typeof studioSectionSchema> & { id?: string | null };
export type StudioDraftService = z.infer<typeof studioServiceSchema> & { id?: string | null };

export const studioThemeSchema = z.object({
  primary: HEX_COLOR.nullish(),
  background: HEX_COLOR.nullish(),
  foreground: HEX_COLOR.nullish(),
  muted: HEX_COLOR.nullish(),
  radius: z.enum(RADIUS_ALLOWED).nullish(),
  headingFont: z.enum(FONT_HEADING_ALLOWED).nullish(),
  bodyFont: z.enum(FONT_BODY_ALLOWED).nullish(),
  preset: z.enum(DESIGN_PRESET_ALLOWED).nullish(),
  logo_url: z.string().max(2000).nullish(),
  logo_alt: z.string().max(200).nullish(),
});

export type StudioDraftTheme = PublicTheme;

export const editorialDraftInputSchema = z.object({
  sections: z.array(z.unknown()).transform((arr) => {
    const out: unknown[] = [];
    for (const raw of arr) {
      const parsed = studioSectionSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
    return out as StudioDraftSection[];
  }),
  services: z.array(z.unknown()).transform((arr) => {
    const out: unknown[] = [];
    for (const raw of arr) {
      const parsed = studioServiceSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
    return out as StudioDraftService[];
  }),
  theme: studioThemeSchema.default({}),
  revision: z.string().uuid().optional().nullable(),
});

export type EditorialDraftInput = {
  sections: StudioDraftSection[];
  services: StudioDraftService[];
  theme: StudioDraftTheme;
  revision?: string | null;
};

export const STUDIO_DRAFT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "sections",
  "services",
  "theme",
  "revision",
]);

export function stripEditorialTamperedFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (STUDIO_DRAFT_ALLOWED_KEYS.has(k)) out[k] = raw[k];
  }
  return out;
}

export function maskEditorialAudit(input: {
  sections: unknown[];
  services: unknown[];
  theme: Record<string, unknown>;
}) {
  const meta: Record<string, unknown> = {};
  meta["sections_count"] = Array.isArray(input.sections) ? input.sections.length : 0;
  meta["services_count"] = Array.isArray(input.services) ? input.services.length : 0;
  const themeKeys: string[] = [];
  if (input.theme && typeof input.theme === "object" && !Array.isArray(input.theme)) {
    for (const k of Object.keys(input.theme)) {
      const val = (input.theme as Record<string, unknown>)[k];
      if (val !== undefined && val !== null) themeKeys.push(k);
    }
  }
  meta["theme_fields"] = themeKeys;
  return meta;
}

export function validateSectionSettings(
  type: SectionType,
  raw: unknown,
): { ok: boolean; value: unknown } {
  const schema = SECTION_SETTINGS_SCHEMAS[type];
  const safe = schema.safeParse(raw ?? {});
  if (!safe.success) return { ok: false, value: {} };
  return { ok: true, value: safe.data };
}

export function normalizeSectionsForDb(sections: StudioDraftSection[]): Array<{
  id?: string | null;
  section_type: SectionType;
  enabled: boolean;
  position: number;
  variant: (typeof ALLOWED_VARIANTS)[number] | "default";
  settings: unknown;
}> {
  const seen = new Set<SectionType>();
  let cursor = 0;
  const out: Array<{
    id?: string | null;
    section_type: SectionType;
    enabled: boolean;
    position: number;
    variant: (typeof ALLOWED_VARIANTS)[number] | "default";
    settings: unknown;
  }> = [];

  const sorted = [...sections].sort((a, b) => {
    const pa = typeof a.position === "number" ? a.position : Number(a.position);
    const pb = typeof b.position === "number" ? b.position : Number(b.position);
    return pa - pb || String(a.section_type).localeCompare(String(b.section_type));
  });

  for (const s of sorted) {
    const ty = s.section_type;
    if (!SECTION_TYPES.includes(ty as SectionType)) continue;
    const asTy = ty as SectionType;
    if (SINGLETON_TYPES.includes(asTy)) {
      if (seen.has(asTy)) continue;
      seen.add(asTy);
    }
    const variant =
      typeof s.variant === "string" &&
      ALLOWED_VARIANTS.includes(s.variant as (typeof ALLOWED_VARIANTS)[number])
        ? (s.variant as (typeof ALLOWED_VARIANTS)[number])
        : "default";
    const settings = validateSectionSettings(asTy, s.settings).value;
    const idVal = s.id ?? null;
    out.push({
      id: idVal,
      section_type: asTy,
      enabled: Boolean(s.enabled),
      position: cursor,
      variant,
      settings,
    });
    cursor += 1;
  }
  return out;
}

export function normalizeServicesForDb(services: StudioDraftService[]): Array<{
  id?: string | null;
  name: string;
  description: string | null;
  price: number | null;
  price_from: number | null;
  currency: Currency;
  duration_minutes: number | null;
  position: number;
  active: boolean;
}> {
  let cursor = 0;
  const out: Array<{
    id?: string | null;
    name: string;
    description: string | null;
    price: number | null;
    price_from: number | null;
    currency: Currency;
    duration_minutes: number | null;
    position: number;
    active: boolean;
  }> = [];
  const sorted = [...services].sort((a, b) => {
    const pa = typeof a.position === "number" ? a.position : Number(a.position);
    const pb = typeof b.position === "number" ? b.position : Number(b.position);
    return pa - pb || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
  for (const s of sorted) {
    const name = s.name?.trim?.() ?? "";
    if (name.length === 0) continue;
    let priceFixed: number | null = null;
    if (s.price !== null && s.price !== undefined) {
      const p = typeof s.price === "number" ? s.price : Number(s.price);
      if (Number.isFinite(p) && p >= 0) priceFixed = Math.round(p * 100) / 100;
    }
    let priceFrom: number | null = null;
    if (s.price_from !== null && s.price_from !== undefined) {
      const p = typeof s.price_from === "number" ? s.price_from : Number(s.price_from);
      if (Number.isFinite(p) && p >= 0) priceFrom = Math.round(p * 100) / 100;
    }
    const currency =
      typeof s.currency === "string" &&
      CURRENCY_ALLOWED.includes(s.currency as (typeof CURRENCY_ALLOWED)[number])
        ? (s.currency as Currency)
        : "EUR";
    let duration: number | null = null;
    if (s.duration_minutes !== null && s.duration_minutes !== undefined) {
      const d =
        typeof s.duration_minutes === "number" ? s.duration_minutes : Number(s.duration_minutes);
      if (Number.isFinite(d) && d >= 1 && d <= 1440) duration = Math.round(d);
    }
    const idVal = s.id ?? null;
    out.push({
      id: idVal,
      name: name.slice(0, 120),
      description: s.description ? String(s.description).slice(0, 1000) : null,
      price: priceFixed,
      price_from: priceFrom,
      currency,
      duration_minutes: duration,
      position: cursor,
      active: Boolean(s.active),
    });
    cursor += 1;
  }
  return out;
}

export interface AltTextIssue {
  breadcrumb: string;
  imageUrl: string | null;
  issue: "missing_alt" | "empty_alt";
}

const IMAGE_KEY_RE =
  /(image|photo|picture|src|thumb|banner|cover|logo|icon|gallery|media|avatar|portrait)(?:url|uri|src|path|link)?$/i;
const ALT_KEY_RE = /^(alt|alt_text|altText|caption|description_text|alt_desc|testo_alt)$/i;
const IMAGE_URL_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:\?|#|$)/i;

function isLikelyImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (IMAGE_URL_EXT_RE.test(trimmed)) return trimmed;
  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:")
  ) {
    if (/\/storage\//.test(trimmed) || /velora/.test(trimmed.toLowerCase())) return trimmed;
    if (trimmed.length < 1200 && IMAGE_URL_EXT_RE.test(trimmed.split("?")[0] ?? "")) return trimmed;
    if (trimmed.length < 40 && /\/img|\/images|\/media\//.test(trimmed)) return trimmed;
  }
  return null;
}

export function findImagesMissingAlt(sections: StudioDraftSection[]): AltTextIssue[] {
  const issues: AltTextIssue[] = [];
  const stack: Array<{ value: unknown; breadcrumb: string }> = sections.map((s, i) => ({
    value: s,
    breadcrumb: `sections[${i}]${s.section_type ? `(${String(s.section_type)})` : ""}`,
  }));

  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const v = frame.value;

    if (v == null) continue;
    if (typeof v !== "object") continue;

    if (seen.has(v as object)) continue;
    seen.add(v as object);

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        stack.push({ value: v[i], breadcrumb: `${frame.breadcrumb}[${i}]` });
      }
      continue;
    }

    const keys = Object.keys(v as Record<string, unknown>);
    let imageUrl: string | null = null;
    let hasImageKey = false;
    let hasAltKey = false;
    let altValue: unknown = null;

    for (const k of keys) {
      const child = (v as Record<string, unknown>)[k];
      stack.push({ value: child, breadcrumb: `${frame.breadcrumb}.${k}` });

      if (!hasImageKey) {
        if (IMAGE_KEY_RE.test(k)) {
          const url = isLikelyImageUrl(child);
          if (url) {
            imageUrl = url;
            hasImageKey = true;
          }
        }
        if (!imageUrl) {
          const direct = isLikelyImageUrl(child);
          if (
            direct &&
            typeof k === "string" &&
            (k.toLowerCase().includes("url") ||
              k.toLowerCase().includes("src") ||
              k.toLowerCase() === "image" ||
              k.toLowerCase() === "photo" ||
              k.toLowerCase() === "picture")
          ) {
            imageUrl = direct;
            hasImageKey = true;
          }
        }
      }

      if (ALT_KEY_RE.test(k)) {
        hasAltKey = true;
        altValue = child;
      }
    }

    if (hasImageKey && imageUrl) {
      if (!hasAltKey) issues.push({ breadcrumb: frame.breadcrumb, imageUrl, issue: "missing_alt" });
      else if (typeof altValue !== "string" || altValue.trim().length === 0)
        issues.push({ breadcrumb: frame.breadcrumb, imageUrl, issue: "empty_alt" });
    }
  }

  return issues;
}
