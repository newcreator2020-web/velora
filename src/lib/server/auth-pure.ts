import { z } from "zod";

export const SAFE_REDIRECT_PATH = /^\/(?!\/)[A-Za-z0-9_/?=&%.-]*$/;

export function safeRedirect(next: unknown, fallback = "/dashboard"): string {
  if (typeof next === "string" && SAFE_REDIRECT_PATH.test(next)) {
    return next;
  }
  return fallback;
}

export function normalizeSlug(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (base) return base;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `tenant-${rnd}`;
}

function asNonEmptyStringOrEmpty(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function asOptionalString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const trimmed = v;
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return undefined;
}

export const loginSchema = z
  .object({
    email: z.preprocess(
      asNonEmptyStringOrEmpty,
      z.string().trim().min(1, "Email obbligatoria").email("Formato email non valido"),
    ),
    password: z.preprocess(asNonEmptyStringOrEmpty, z.string().min(1, "Password obbligatoria")),
    next: z.preprocess(asOptionalString, z.string().optional()),
  })
  .refine(
    (d) => {
      if (d["next"] === undefined) return true;
      return SAFE_REDIRECT_PATH.test(d["next"] as string);
    },
    { path: ["next"], message: "Redirect non consentito" },
  )
  .transform((d) => ({
    email: (d["email"] as string).toLowerCase(),
    password: d["password"] as string,
    next: d["next"] as string | undefined,
  }));

export type LoginInput = z.infer<typeof loginSchema>;

function asEmptyOptional(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

export const onboardingSchema = z.object({
  business_name: z.preprocess(
    asEmptyOptional,
    z.string().trim().min(2, "Nome attività obbligatorio").max(120),
  ),
  category: z.preprocess(
    asEmptyOptional,
    z.string().trim().min(2, "Categoria obbligatoria").max(80),
  ),
  city: z.preprocess(asEmptyOptional, z.string().trim().min(1, "Città obbligatoria").max(80)),
  province: z.preprocess(
    asEmptyOptional,
    z.string().trim().min(1, "Provincia obbligatoria").max(4),
  ),
  phone: z.preprocess(
    (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v)),
    z.string().trim().max(32).optional().or(z.literal("")),
  ),
  business_email: z.preprocess(
    (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v)),
    z.string().trim().email("Formato email non valido").max(160).optional().or(z.literal("")),
  ),
  timezone: z.preprocess(
    asEmptyOptional,
    z.string().trim().min(1, "Timezone obbligatorio").max(64),
  ),
  locale: z.preprocess(asEmptyOptional, z.string().trim().min(2, "Locale obbligatorio").max(10)),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return String(v).trim() === "" ? null : String(v).trim();
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function emptyOrString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

export const businessProfileUpdateSchema = z
  .object({
    business_name: z.preprocess(
      emptyOrString,
      z.string().trim().min(2, "Nome attività obbligatorio").max(120),
    ),
    phone: z.preprocess(emptyToNull, z.string().trim().max(32).nullable().optional()),
    email: z.preprocess((v) => {
      const n = emptyToNull(v);
      return n === null ? undefined : n;
    }, z.string().trim().email("Formato email non valido").max(160).optional().or(z.null())),
    address: z.preprocess(emptyToNull, z.string().trim().max(190).nullable().optional()),
    city: z.preprocess(emptyToNull, z.string().trim().max(80).nullable().optional()),
    province: z.preprocess(emptyToNull, z.string().trim().max(4).nullable().optional()),
    postal_code: z.preprocess(emptyToNull, z.string().trim().max(16).nullable().optional()),
    description: z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
  })
  .transform((d) => ({
    business_name: (d["business_name"] as string).trim(),
    phone: d["phone"] as string | null | undefined,
    email: d["email"] as string | null | undefined,
    address_line1: d["address"] as string | null | undefined,
    city: d["city"] as string | null | undefined,
    province: d["province"] as string | null | undefined,
    postal_code: d["postal_code"] as string | null | undefined,
    description: d["description"] as string | null | undefined,
  }));

export type BusinessProfileUpdateInput = z.infer<typeof businessProfileUpdateSchema>;

export type BpWritePayloads = {
  tenantUpdate: { name?: string | undefined };
  bpUpdate: Partial<{
    display_name: string | null;
    phone: string | null;
    email: string | null;
    address_line1: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    description: string | null;
  }>;
};

export function buildBusinessUpdatePayloads(
  parsed: z.infer<typeof businessProfileUpdateSchema>,
): BpWritePayloads {
  const tenantUpdate: BpWritePayloads["tenantUpdate"] = {};
  const bpUpdate: BpWritePayloads["bpUpdate"] = {};

  if (parsed.business_name) tenantUpdate.name = parsed.business_name;

  const maybeSet = (key: keyof BpWritePayloads["bpUpdate"], value: unknown) => {
    if (
      Object.prototype.hasOwnProperty.call(parsed, key === "address_line1" ? "address_line1" : key)
    ) {
      bpUpdate[key] = (value as BpWritePayloads["bpUpdate"][typeof key]) ?? null;
    }
  };

  maybeSet("phone", parsed.phone);
  maybeSet("email", parsed.email);
  maybeSet("address_line1", parsed.address_line1);
  maybeSet("city", parsed.city);
  maybeSet("province", parsed.province);
  maybeSet("postal_code", parsed.postal_code);
  maybeSet("description", parsed.description);
  if (parsed.business_name) bpUpdate.display_name = parsed.business_name;

  return { tenantUpdate, bpUpdate };
}

export type AuditMetadata = Record<string, unknown>;

export function maskAuditMetadata(bp: BpWritePayloads["bpUpdate"]): AuditMetadata {
  const meta: AuditMetadata = {};
  if (Object.prototype.hasOwnProperty.call(bp, "display_name") && bp.display_name !== undefined) {
    meta["display_name"] = bp.display_name;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "phone")) {
    meta["phone"] = bp.phone ? "[phone masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "email")) {
    meta["email"] = bp.email ? "[email masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "city")) {
    meta["city"] = bp.city ? "[city masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "province")) {
    meta["province"] = bp.province ? "[province masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "postal_code")) {
    meta["postal_code"] = bp.postal_code ? "[postal masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "address_line1")) {
    meta["address_line1"] = bp.address_line1 ? "[address masked]" : null;
  }
  if (Object.prototype.hasOwnProperty.call(bp, "description")) {
    meta["description_len"] = (bp.description as string | null)?.length ?? 0;
  }
  return meta;
}

export const BUSINESS_PROFILE_ALLOWED_INPUT_KEYS: ReadonlySet<string> = new Set([
  "business_name",
  "phone",
  "email",
  "address",
  "city",
  "province",
  "postal_code",
  "description",
]);

export function stripTamperedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (BUSINESS_PROFILE_ALLOWED_INPUT_KEYS.has(k)) out[k] = raw[k];
  }
  return out;
}

export function loginErrorMessage(code?: string, details?: string): string {
  const c = code?.toLowerCase() ?? "";
  const d = details?.toLowerCase() ?? "";
  if (
    c.includes("invalid_credentials") ||
    c.includes("invalid_password") ||
    d.includes("invalid password") ||
    d.includes("email")
  ) {
    return "Credenziali non valide. Riprova.";
  }
  if (c.includes("email_not_confirmed") || d.includes("email not confirmed")) {
    return "Verifica l'indirizzo email prima di accedere.";
  }
  if (
    c.includes("over_request_rate_limit") ||
    c.includes("rate") ||
    c.includes("timeout") ||
    d.includes("rate")
  ) {
    return "Troppi tentativi. Attendi qualche istante e riprova.";
  }
  if (c.includes("network") || d.includes("network")) {
    return "Errore di connessione. Riprova.";
  }
  return "Non è stato possibile completare l'accesso. Riprova.";
}

export function slugUniqueFromName(name: string, existingSlugs: Set<string> = new Set()): string {
  const base = normalizeSlug(name) || "attivita";
  let slug = base;
  let n = 1;
  while (existingSlugs.has(slug)) {
    slug = `${base.slice(0, 42)}-${n++}`;
  }
  return slug;
}
