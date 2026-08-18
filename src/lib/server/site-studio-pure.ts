import { z } from "zod";
import {
  SECTION_TYPES,
  ALLOWED_VARIANTS,
  SINGLETON_TYPES,
  SECTION_SETTINGS_SCHEMAS,
  FONT_HEADING_ALLOWED,
  FONT_BODY_ALLOWED,
  RADIUS_ALLOWED,
  validateHexColor,
  type SectionType,
} from "./content-engine";
import type { PublicTheme } from "./content-engine";

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
    let price: number | null = null;
    if (s.price_from !== null && s.price_from !== undefined) {
      const p = typeof s.price_from === "number" ? s.price_from : Number(s.price_from);
      if (Number.isFinite(p) && p >= 0) price = Math.round(p * 100) / 100;
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
      price_from: price,
      currency,
      duration_minutes: duration,
      position: cursor,
      active: Boolean(s.active),
    });
    cursor += 1;
  }
  return out;
}
