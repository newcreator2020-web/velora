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
