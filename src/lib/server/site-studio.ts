import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantMembership, requireTenantRole, type TenantContext } from "@/lib/server/auth";
import type { AuditMetadata } from "@/lib/server/auth-pure";
import {
  resolveTenantEntitlements,
  assertCapability,
  assertLimit,
  type EntitlementError,
} from "@/lib/server/entitlements";
import {
  normalizeSectionsForDb,
  normalizeServicesForDb,
  editorialDraftInputSchema,
  stripEditorialTamperedFields,
  maskEditorialAudit,
  studioSectionSchema,
  studioServiceSchema,
  type StudioDraftSection,
  type StudioDraftService,
  type StudioDraftTheme,
} from "./site-studio-pure";
import {
  buildDefaultDeterministicSections,
  parseSectionSettings,
  isSingletonSection,
  SECTION_TYPES,
  safeVariant,
  FONT_HEADING_ALLOWED,
  FONT_BODY_ALLOWED,
  RADIUS_ALLOWED,
  priceListSettingsSchema,
  featuresCtaSettingsSchema,
  bookingWidgetSettingsSchema,
  type SectionType,
  type PublicSite,
  type PublicSection,
  type PublicService,
  type BookingWidgetServiceOption,
  type BookingAvailabilityRow,
} from "./content-engine";
import type { Tables } from "@/types/supabase";
import type { PublicSiteData } from "./site-engine";
import { z } from "zod";

export type EditorialState = {
  sections: StudioDraftSection[];
  services: StudioDraftService[];
  theme: StudioDraftTheme;
  revision: string | null;
  updated_at: string | null;
};

type EditorialStateRow = {
  tenant_id: string;
  sections: unknown;
  services: unknown;
  theme: unknown;
  draft_revision: string;
  updated_at: string;
};

type PublishSiteDraftRow = {
  ok: boolean;
  code: string | null;
  message: string | null;
  new_published_at: string | null;
  sections_applied: number;
  services_applied: number;
  theme_applied: boolean;
};

type BusinessProfileThemeRow = {
  theme_primary: unknown;
  theme_background: unknown;
  theme_foreground: unknown;
  theme_muted: unknown;
  theme_radius: unknown;
  theme_heading_font_preset: unknown;
  theme_body_font_preset: unknown;
};

export type SaveDraftResult =
  | { ok: true; revision: string; updated_at: string }
  | {
      ok: false;
      code:
        "VALIDATION" | "AUTH" | "INTERNAL" | "CONCURRENT" | "ENTITLEMENT_DENIED" | "LIMIT_REACHED";
      message: string;
      fieldErrors?: Partial<Record<string, string[]>>;
      entitlement?: EntitlementError;
    };

export type PublishResult =
  | {
      ok: true;
      published_at: string;
      sections_applied: number;
      services_applied: number;
      theme_applied: boolean;
    }
  | {
      ok: false;
      code:
        | "AUTH"
        | "AUTHZ"
        | "NO_DRAFT"
        | "CONCURRENT"
        | "INTERNAL"
        | "ENTITLEMENT_DENIED"
        | "CROSS_TENANT";
      message: string;
    };

async function insertAudit(
  tenant_id: string,
  actor_user_id: string,
  action: string,
  entity_type: string,
  entity_id: string,
  metadata: AuditMetadata,
) {
  try {
    const { getSupabaseServiceClient } = await import("@/lib/supabase/service");
    const s = getSupabaseServiceClient();
    await s.from("audit_logs").insert({
      tenant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata: metadata as unknown as import("@/types/supabase").Json,
    });
  } catch {
    // Audit non bloccante
  }
}

export async function loadEditorialDraft(
  ctx: TenantContext & {
    membership: NonNullable<TenantContext["membership"]>;
    tenant: NonNullable<TenantContext["tenant"]>;
    business_profile: NonNullable<TenantContext["business_profile"]>;
  },
): Promise<EditorialState> {
  const tid = ctx.tenant.id;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("site_editorial_state" as never)
    .select("sections,services,theme,draft_revision,updated_at")
    .eq("tenant_id" as never, tid)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    const d: EditorialStateRow = data as unknown as EditorialStateRow;
    return {
      sections: Array.isArray(d.sections) ? (d.sections as StudioDraftSection[]) : [],
      services: Array.isArray(d.services) ? (d.services as StudioDraftService[]) : [],
      theme:
        d.theme && typeof d.theme === "object" && !Array.isArray(d.theme)
          ? (d.theme as StudioDraftTheme)
          : {},
      revision: (d.draft_revision as string | null) ?? null,
      updated_at: (d.updated_at as string | null) ?? null,
    };
  }

  const [sectionsRes, servicesRes] = await Promise.all([
    supabase
      .from("site_sections")
      .select("id,section_type,enabled,position,variant,settings")
      .eq("tenant_id", tid)
      .order("position", { ascending: true }),
    supabase
      .from("services")
      .select("id,name,description,price_from,currency,duration_minutes,position,active")
      .eq("tenant_id", tid)
      .order("position", { ascending: true }),
  ]);

  const sectionsDraft: StudioDraftSection[] =
    !sectionsRes.error && sectionsRes.data
      ? sectionsRes.data.map((r) => ({
          id: (r.id ?? null) as string | null,
          section_type: r.section_type as SectionType,
          enabled: Boolean(r.enabled),
          position: Number(r.position ?? 0),
          variant: String(r.variant ?? "default") as StudioDraftSection["variant"],
          settings:
            r.settings && typeof r.settings === "object"
              ? (r.settings as Record<string, unknown>)
              : {},
        }))
      : buildDefaultDeterministicSections(
          { description: ctx.business_profile.description ?? null },
          0,
        ).map((r) => ({
          section_type: r.section_type,
          enabled: r.enabled,
          position: r.position,
          variant: r.variant,
          settings: r.settings as Record<string, unknown>,
        }));

  const servicesDraft: StudioDraftService[] =
    !servicesRes.error && servicesRes.data
      ? servicesRes.data.map((r) => {
          const cur = String(r.currency ?? "EUR") as StudioDraftService["currency"];
          return {
            id: (r.id ?? null) as string | null,
            name: String(r.name ?? ""),
            description: typeof r.description === "string" ? r.description : null,
            price_from:
              r.price_from !== null && r.price_from !== undefined ? Number(r.price_from) : null,
            currency: CURRENCY_ALLOWED.includes(cur) ? cur : "EUR",
            duration_minutes:
              r.duration_minutes !== null && r.duration_minutes !== undefined
                ? Number(r.duration_minutes)
                : null,
            position: Number(r.position ?? 0),
            active: Boolean(r.active),
          };
        })
      : [];

  const bp = ctx.business_profile as Tables<"business_profiles">;
  const bpt = bp as unknown as BusinessProfileThemeRow;
  const radiusVal = (
    typeof bpt.theme_radius === "string" ? bpt.theme_radius : null
  ) as StudioDraftTheme["radius"];
  const headingVal = (
    typeof bpt.theme_heading_font_preset === "string" ? bpt.theme_heading_font_preset : null
  ) as StudioDraftTheme["headingFont"];
  const bodyVal = (
    typeof bpt.theme_body_font_preset === "string" ? bpt.theme_body_font_preset : null
  ) as StudioDraftTheme["bodyFont"];
  const theme: StudioDraftTheme = {
    primary: validateHexColorStr(bp.theme_primary) ? bp.theme_primary : null,
    background: validateHexColorStr(bp.theme_background) ? bp.theme_background : null,
    foreground: validateHexColorStr(bp.theme_foreground) ? bp.theme_foreground : null,
    muted: validateHexColorStr(bp.theme_muted) ? bp.theme_muted : null,
    radius: typeof radiusVal === "string" && RADIUS_ALLOWED.includes(radiusVal) ? radiusVal : null,
    headingFont:
      typeof headingVal === "string" && FONT_HEADING_ALLOWED.includes(headingVal)
        ? headingVal
        : null,
    bodyFont: typeof bodyVal === "string" && FONT_BODY_ALLOWED.includes(bodyVal) ? bodyVal : null,
  };

  return {
    sections: sectionsDraft,
    services: servicesDraft,
    theme,
    revision: null,
    updated_at: null,
  };
}

const CURRENCY_ALLOWED = ["EUR", "USD", "GBP", "CHF"] as const;

function validateHexColorStr(v: string | null | undefined): v is string {
  return typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

export async function saveEditorialDraft(
  raw: FormData | Record<string, unknown>,
): Promise<SaveDraftResult> {
  const ctx = await requireTenantRole("manager");
  const input: Record<string, unknown> =
    raw instanceof FormData ? Object.fromEntries((raw as FormData).entries()) : raw;

  if (typeof input["sections"] === "string") {
    try {
      input["sections"] = JSON.parse(input["sections"] as string) as unknown;
    } catch {
      input["sections"] = [];
    }
  }
  if (typeof input["services"] === "string") {
    try {
      input["services"] = JSON.parse(input["services"] as string) as unknown;
    } catch {
      input["services"] = [];
    }
  }
  if (typeof input["theme"] === "string") {
    try {
      input["theme"] = JSON.parse(input["theme"] as string) as unknown;
    } catch {
      input["theme"] = {};
    }
  }

  const sanitized = stripEditorialTamperedFields(input);
  const parsed = editorialDraftInputSchema.safeParse(sanitized);
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) {
    for (const iss of parsed.error.issues) {
      const path = iss.path.join(".") || "_";
      const arr = fieldErrors[path] ?? (fieldErrors[path] = []);
      arr.push(iss.message);
    }
  }

  const rawSectionsArr = Array.isArray(sanitized["sections"]) ? sanitized["sections"] : [];
  const rawServicesArr = Array.isArray(sanitized["services"]) ? sanitized["services"] : [];

  for (let i = 0; i < rawSectionsArr.length; i += 1) {
    const raw = rawSectionsArr[i];
    const r = studioSectionSchema.safeParse(raw);
    if (!r.success) {
      for (const iss of r.error.issues) {
        const path = `sections.${i}${iss.path.length ? `.${iss.path.join(".")}` : ""}`;
        const arr = fieldErrors[path] ?? (fieldErrors[path] = []);
        arr.push(iss.message);
      }
    }
  }

  for (let i = 0; i < rawServicesArr.length; i += 1) {
    const raw = rawServicesArr[i];
    const r = studioServiceSchema.safeParse(raw);
    if (!r.success) {
      for (const iss of r.error.issues) {
        const path = `services.${i}${iss.path.length ? `.${iss.path.join(".")}` : ""}`;
        const arr = fieldErrors[path] ?? (fieldErrors[path] = []);
        arr.push(iss.message);
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Controlla i dati inseriti.",
      fieldErrors,
    };
  }

  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "Controlla i dati inseriti.",
      fieldErrors,
    };
  }

  const sectionsDb = normalizeSectionsForDb(parsed.data.sections);
  const servicesDbRaw = normalizeServicesForDb(parsed.data.services);
  const uuidPattern =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const servicesDb = servicesDbRaw.map((s) => {
    if (typeof s.id === "string" && uuidPattern.test(s.id)) return s;
    return { ...s, id: crypto.randomUUID() };
  });

  const tid = ctx.tenant.id;
  const actor = ctx.user.id;
  const now = new Date().toISOString();
  const newRev = crypto.randomUUID();

  const snap = await resolveTenantEntitlements(ctx);
  const capStudio = assertCapability(snap, "site_studio");
  if (capStudio) {
    return {
      ok: false,
      code: "ENTITLEMENT_DENIED",
      message: capStudio.message,
      entitlement: capStudio,
    };
  }
  const capMgmt = assertCapability(snap, "services_management");
  if (capMgmt) {
    return {
      ok: false,
      code: "ENTITLEMENT_DENIED",
      message: capMgmt.message,
      entitlement: capMgmt,
    };
  }
  const capTheme = assertCapability(snap, "theme_customization");
  if (capTheme) {
    return {
      ok: false,
      code: "ENTITLEMENT_DENIED",
      message: capTheme.message,
      entitlement: capTheme,
    };
  }
  const limitServices = assertLimit(snap, "maxServices", parsed.data.services.length);
  if (limitServices) {
    return {
      ok: false,
      code: "LIMIT_REACHED",
      message: limitServices.message,
      entitlement: limitServices,
    };
  }
  const limitSections = assertLimit(snap, "maxSections", parsed.data.sections.length);
  if (limitSections) {
    return {
      ok: false,
      code: "LIMIT_REACHED",
      message: limitSections.message,
      entitlement: limitSections,
    };
  }

  const supabase = await createSupabaseServerClient();

  try {
    const row: EditorialStateRow = {
      tenant_id: tid,
      sections: sectionsDb,
      services: servicesDb,
      theme: parsed.data.theme,
      draft_revision: newRev,
      updated_at: now,
    };
    const { error } = await supabase
      .from("site_editorial_state" as never)
      .upsert(row as never, { onConflict: "tenant_id" } as never);

    if (error) {
      if ((error.code ?? "") === "42501") {
        return {
          ok: false,
          code: "AUTH",
          message: "Non sei autorizzato a salvare la bozza.",
        };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Non siamo riusciti a salvare la bozza. Riprova tra un momento.",
      };
    }

    await insertAudit(
      tid,
      actor,
      "site_editorial_draft_saved",
      "site_editorial_state",
      tid,
      maskEditorialAudit({
        sections: sectionsDb,
        services: servicesDb,
        theme: parsed.data.theme,
      }),
    );

    return { ok: true, revision: newRev, updated_at: now };
  } catch {
    return {
      ok: false,
      code: "INTERNAL",
      message: "Si è verificato un errore imprevisto. Riprova.",
    };
  }
}

export async function publishSiteDraft(expected_revision?: string | null): Promise<PublishResult> {
  const ctx = await requireTenantRole("manager");
  const tid = ctx.tenant.id;
  const slug = ctx.tenant.slug;
  const actor = ctx.user.id;

  const snap = await resolveTenantEntitlements(ctx);
  const pub = assertCapability(snap, "site_publish");
  if (pub) {
    return { ok: false, code: "ENTITLEMENT_DENIED", message: pub.message };
  }

  const supabase = await createSupabaseServerClient();
  try {
    const args: Record<string, unknown> = { p_tenant_id: tid, p_actor_id: actor };
    if (typeof expected_revision === "string" && expected_revision.length > 0) {
      args["p_expected_revision"] = expected_revision;
    }
    const { data, error } = await supabase.rpc("publish_site_draft" as never, args as never);

    const raw = data as unknown as PublishSiteDraftRow | PublishSiteDraftRow[] | null;
    if (error || !raw || (Array.isArray(raw) && raw.length === 0)) {
      const c = (error as { code?: string } | undefined)?.code ?? "";
      if (c === "42501") {
        return { ok: false, code: "AUTHZ", message: "Non autorizzato." };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Pubblicazione fallita. Riprova tra un momento.",
      };
    }
    const row: PublishSiteDraftRow = (
      Array.isArray(raw) ? (raw[0] as unknown) : (raw as unknown)
    ) as PublishSiteDraftRow;
    if (!row.ok) {
      type RpcCode = Exclude<Extract<PublishResult, { ok: false }>["code"], undefined>;
      const codeMap: Record<string, RpcCode> = {
        AUTH: "AUTH",
        AUTHZ: "AUTHZ",
        NO_DRAFT: "NO_DRAFT",
        CONCURRENT: "CONCURRENT",
        CROSS_TENANT: "CROSS_TENANT",
      };
      const rpcCode = String((row as { code?: unknown }).code ?? "");
      return {
        ok: false,
        code: codeMap[rpcCode] ?? "INTERNAL",
        message: String(row.message),
      };
    }

    if (slug) {
      try {
        revalidatePath(`/s/${slug}`);
      } catch {
        // invalidazione cache non bloccante
      }
    }

    await insertAudit(tid, actor, "site_published", "tenants", tid, {
      sections_applied: Number(row.sections_applied) || 0,
      services_applied: Number(row.services_applied) || 0,
      theme_applied: Boolean(row.theme_applied),
      published_at: row.new_published_at,
    });

    return {
      ok: true,
      published_at: (row.new_published_at as string) ?? new Date().toISOString(),
      sections_applied: Number(row.sections_applied) || 0,
      services_applied: Number(row.services_applied) || 0,
      theme_applied: Boolean(row.theme_applied),
    };
  } catch {
    return {
      ok: false,
      code: "INTERNAL",
      message: "Si è verificato un errore imprevisto in fase di pubblicazione.",
    };
  }
}

export type UnpublishResult =
  | { ok: true; unpublished_at: string }
  | {
      ok: false;
      code: "AUTHZ" | "INTERNAL";
      message: string;
    };

export async function unpublishSite(): Promise<UnpublishResult> {
  const ctx = await requireTenantRole("owner");
  const tid = ctx.tenant.id;
  const slug = ctx.tenant.slug;
  const actor = ctx.user.id;

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("tenants")
    .update({ published: false, updated_at: new Date().toISOString() })
    .eq("id", tid);

  if (error) {
    if ((error.code ?? "") === "42501") {
      return { ok: false, code: "AUTHZ", message: "Non autorizzato a ritirare la pubblicazione." };
    }
    return {
      ok: false,
      code: "INTERNAL",
      message: "Non siamo riusciti a ritirare la pubblicazione.",
    };
  }

  const unpublishedAt = new Date().toISOString();

  if (slug) {
    try {
      revalidatePath(`/s/${slug}`);
    } catch {
      // cache invalidation non bloccante
    }
  }

  await insertAudit(tid, actor, "site_unpublished", "tenants", tid, {});

  return { ok: true, unpublished_at: unpublishedAt };
}

export async function resolveDraftSiteForPreview(): Promise<
  { _tag: "NotFound"; reason: string } | { _tag: "Found"; publicSite: PublicSite }
> {
  const ctx = await requireTenantMembership();
  const { tenant, business_profile: bp } = ctx;

  if (!bp?.display_name || bp.display_name.trim().length === 0) {
    return { _tag: "NotFound", reason: "INCOMPLETE_PUBLIC_DATA" };
  }

  const draft = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);

  const site: PublicSiteData = {
    slug: tenant.slug,
    businessName: bp.display_name.trim(),
    category: bp.category ?? null,
    description: bp.description ?? null,
    phone: bp.phone ?? null,
    email: bp.email ?? null,
    websiteUrl: bp.website_url ?? null,
    address: bp.address_line1 ?? null,
    city: bp.city ?? null,
    province: bp.province ?? null,
    postalCode: bp.postal_code ?? null,
    countryCode: bp.country_code ?? null,
    whatsapp: (bp as { whatsapp?: string | null }).whatsapp ?? null,
    latitude: (bp as { latitude?: number | null }).latitude ?? null,
    longitude: (bp as { longitude?: number | null }).longitude ?? null,
    locale: bp.locale || "it",
    timezone: bp.timezone || "Europe/Rome",
    canonicalPath: `/s/${tenant.slug}`,
  };

  const parsed = z
    .object({
      primary: z.string().nullish(),
      background: z.string().nullish(),
      foreground: z.string().nullish(),
      muted: z.string().nullish(),
      radius: z.enum(["none", "sm", "md", "lg", "xl", "full"] as const).nullish(),
      headingFont: z.enum(["sans", "serif", "mono", "display"] as const).nullish(),
      bodyFont: z.enum(["sans", "serif", "mono"] as const).nullish(),
    })
    .safeParse(draft.theme);
  const theme = parsed.success ? parsed.data : {};

  const sectionRows = draft.sections
    .filter((r) => Boolean(r.enabled))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

  const sections: PublicSection[] = [];
  const seen = new Set<SectionType>();

  const services: PublicService[] = draft.services
    .filter((s) => Boolean(s.active))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((r) => ({
      name: String(r.name ?? "")
        .trim()
        .slice(0, 120),
      description: typeof r.description === "string" ? r.description.slice(0, 1000) : null,
      price:
        (r as { price?: unknown }).price !== null && (r as { price?: unknown }).price !== undefined
          ? Number.isFinite(Number((r as { price?: unknown }).price)) &&
            Number((r as { price?: unknown }).price) >= 0
            ? Number((r as { price?: unknown }).price)
            : null
          : null,
      priceFrom:
        r.price_from !== null && r.price_from !== undefined
          ? Number.isFinite(Number(r.price_from)) && Number(r.price_from) >= 0
            ? Number(r.price_from)
            : null
          : null,
      currency:
        typeof r.currency === "string" && ["EUR", "USD", "GBP", "CHF"].includes(r.currency)
          ? (r.currency as "EUR" | "USD" | "GBP" | "CHF")
          : "EUR",
      durationMinutes:
        r.duration_minutes !== null && r.duration_minutes !== undefined
          ? Number.isFinite(Number(r.duration_minutes)) &&
            Number(r.duration_minutes) >= 1 &&
            Number(r.duration_minutes) <= 1440
            ? Math.round(Number(r.duration_minutes))
            : null
          : null,
    }))
    .filter((s) => s.name.length > 0);

  for (const r of sectionRows) {
    const ty = r.section_type as SectionType;
    if (!SECTION_TYPES.includes(ty)) continue;
    if (isSingletonSection(ty)) {
      if (seen.has(ty)) continue;
      seen.add(ty);
    }
    const parsedSet = parseSectionSettings(ty, r.settings);
    if (!parsedSet.ok) continue;
    const variant = safeVariant(String(r.variant ?? "default"));
    switch (ty) {
      case "hero":
        sections.push({
          type: "hero",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { businessName: site.businessName },
        });
        break;
      case "about":
        if (site.description && site.description.trim().length > 0) {
          sections.push({
            type: "about",
            variant,
            settings: parsedSet.value as PublicSection["settings"],
            data: { description: site.description, businessName: site.businessName },
          });
        }
        break;
      case "services":
        if (services.length > 0) {
          sections.push({
            type: "services",
            variant,
            settings: parsedSet.value as PublicSection["settings"],
            data: { services },
          });
        }
        break;
      case "gallery":
        sections.push({
          type: "gallery",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            assets: [
              {
                url: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent("Modern elegant hair salon interior with stylish chairs and lighting")}&image_size=square_hd`,
                alt: "Interno del salone con postazioni styling",
              },
              {
                url: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent("Professional hairstylist doing haircut for female client")}&image_size=square_hd`,
                alt: "Parrucchiere durante un taglio cliente",
              },
              {
                url: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent("Luxury beauty salon display shelf with hair care products")}&image_size=square_hd`,
                alt: "Espositore prodotti per capelli professionali",
              },
            ],
          },
        });
        break;
      case "staff":
        sections.push({
          type: "staff",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            members: [
              {
                name: "Sofia Ricci",
                role: "Titolare & Hair Stylist Senior",
                bio: "15 anni di esperienza in tagli e colorazioni per ogni tipologia di capello.",
                photoUrl: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent("Professional smiling female hair stylist portrait in salon uniform")}&image_size=square_hd`,
              },
              {
                name: "Marco Moretti",
                role: "Barber & Men\u2019s Specialist",
                bio: "Specializzato in tagli uomo, barba e trattamenti tradizionali.",
                photoUrl: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent("Professional confident male barber portrait with scissors and apron")}&image_size=square_hd`,
              },
            ],
          },
        });
        break;
      case "reviews":
        sections.push({
          type: "reviews",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            reviews: [
              {
                author: "Giulia Bianchi",
                rating: 5,
                body: "Esperienza fantastica. Sofia ha capito esattamente cosa volevo e il risultato è andato oltre le aspettative. Ambiente pulito e accogliente.",
              },
              {
                author: "Luca Ferrari",
                rating: 5,
                body: "Marco è un barber eccezionale. Taglio e barba perfetti ogni volta, consiglio vivamente.",
              },
              {
                author: "Anna Romano",
                rating: 4,
                body: "Personale gentile e molto preparato. Prezzi onesti per la qualità offerta. Tornerò sicuramente.",
              },
            ],
          },
        });
        break;
      case "contact": {
        const hasAny = site.phone || site.email || site.address || site.city;
        if (hasAny) {
          sections.push({
            type: "contact",
            variant,
            settings: parsedSet.value as PublicSection["settings"],
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
      case "price_list":
        if (services.length > 0) {
          sections.push({
            type: "price_list",
            variant,
            settings: parsedSet.value as z.infer<typeof priceListSettingsSchema>,
            data: { services },
          });
        }
        break;
      case "features_cta": {
        const typedSettings = (parsedSet.value ?? {}) as Record<string, unknown>;
        const finalSettings: Record<string, unknown> = { ...typedSettings };
        if (!finalSettings["eyebrow"]) finalSettings["eyebrow"] = "Perché sceglierci";
        if (!finalSettings["headline"])
          finalSettings["headline"] = "Qualità, esperienza e rispetto del cliente";
        if (!finalSettings["subheadline"])
          finalSettings["subheadline"] =
            "Abbiamo costruito il nostro salone su principi semplici: ascolto, professionalità e risultati duraturi. Scopri perché le persone ci scelgono e tornano.";
        if (!finalSettings["ctaPrimaryLabel"]) finalSettings["ctaPrimaryLabel"] = "Prenota ora";
        if (!finalSettings["ctaPrimaryTarget"]) finalSettings["ctaPrimaryTarget"] = "#booking";
        if (!finalSettings["ctaSecondaryLabel"])
          finalSettings["ctaSecondaryLabel"] = "Scopri i servizi";
        if (!finalSettings["ctaSecondaryTarget"]) finalSettings["ctaSecondaryTarget"] = "#services";
        sections.push({
          type: "features_cta",
          variant,
          settings: finalSettings as z.infer<typeof featuresCtaSettingsSchema>,
          data: {
            features: [
              {
                icon: "⚡",
                title: "Veloce e semplice",
                description: "Prenota in pochi clic, senza attese o chiamate telefoniche.",
              },
              {
                icon: "🎯",
                title: "Qualità garantita",
                description: "Servizi selezionati e professionisti qualificati per te.",
              },
              {
                icon: "💎",
                title: "Prezzi trasparenti",
                description: "Nessuna sorpresa: il prezzo che vedi è quello che paghi.",
              },
              {
                icon: "✅",
                title: "Flessibile e sicuro",
                description: "Modifica o cancella senza penali fino a 24h prima.",
              },
            ],
          },
        });
        break;
      }
      case "booking_widget": {
        const bookingServices: BookingWidgetServiceOption[] = draft.services
          .filter((s) => Boolean(s.active) && s.id && typeof s.id === "string")
          .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
          .map((r) => ({
            id: String(r.id ?? ""),
            name: String(r.name ?? "")
              .trim()
              .slice(0, 120),
            duration_minutes:
              r.duration_minutes !== null && r.duration_minutes !== undefined
                ? Number.isFinite(Number(r.duration_minutes)) &&
                  Number(r.duration_minutes) >= 1 &&
                  Number(r.duration_minutes) <= 1440
                  ? Math.round(Number(r.duration_minutes))
                  : null
                : null,
            price_from:
              r.price_from !== null && r.price_from !== undefined
                ? Number.isFinite(Number(r.price_from)) && Number(r.price_from) >= 0
                  ? Number(r.price_from)
                  : null
                : null,
            currency:
              typeof r.currency === "string" && ["EUR", "USD", "GBP", "CHF"].includes(r.currency)
                ? r.currency
                : "EUR",
            active: Boolean(r.active),
          }))
          .filter((s) => s.name.length > 0 && s.id.length > 0);
        const defaultAvailability: BookingAvailabilityRow[] = Array.from({ length: 7 }, (_, i) => ({
          weekday: i,
          enabled: i >= 1 && i <= 5,
          start_time: i === 0 || i === 6 ? "00:00" : "09:00",
          end_time: i === 0 || i === 6 ? "00:00" : "18:00",
        }));
        sections.push({
          type: "booking_widget",
          variant,
          settings: parsedSet.value as z.infer<typeof bookingWidgetSettingsSchema>,
          data: {
            slug: site.slug ?? null,
            services: bookingServices,
            availability: defaultAvailability,
            timezone: site.timezone ?? "Europe/Rome",
          },
        });
        break;
      }
      case "navbar":
        sections.push({
          type: "navbar",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            businessName: site.businessName,
            logoUrl: null,
            phone: site.phone,
            slug: site.slug,
            navigation: [],
          },
        });
        break;
      case "footer":
        sections.push({
          type: "footer",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            businessName: site.businessName,
            logoUrl: null,
            phone: site.phone,
            email: site.email,
            address: site.address,
            copyrightOwner: site.businessName,
            slug: site.slug,
            navLinks: [],
            year: new Date().getFullYear(),
          },
        });
        break;
      case "trust":
        sections.push({
          type: "trust",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { items: [] },
        });
        break;
      case "hours":
        sections.push({
          type: "hours",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { weeklyHours: [], timezone: site.timezone ?? "Europe/Rome" },
        });
        break;
      case "faq":
        sections.push({
          type: "faq",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { items: [] },
        });
        break;
      case "location":
        sections.push({
          type: "location",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            address: site.address,
            city: site.city,
            province: site.province,
            postalCode: site.postalCode,
            countryCode: site.countryCode,
            latitude: site.latitude,
            longitude: site.longitude,
            googleMapsDirectionsUrl: null,
            googleMapsEmbed: null,
          },
        });
        break;
      case "booking_cta":
        sections.push({
          type: "booking_cta",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: {
            bookingUrl: `/s/${site.slug}/book`,
          },
        });
        break;
      case "whatsapp_cta":
        if (site.whatsapp && site.whatsapp.trim().length > 0) {
          const clean = site.whatsapp.replace(/[^0-9]/g, "");
          const waLink =
            clean.length > 0
              ? `https://wa.me/${clean}?text=${encodeURIComponent("Ciao, vorrei avere informazioni")}`
              : null;
          sections.push({
            type: "whatsapp_cta",
            variant,
            settings: parsedSet.value as PublicSection["settings"],
            data: {
              whatsapp: site.whatsapp,
              waMeLink: waLink,
            },
          });
        }
        break;
      case "social_links":
        sections.push({
          type: "social_links",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { links: [] },
        });
        break;
      case "legal_links":
        sections.push({
          type: "legal_links",
          variant,
          settings: parsedSet.value as PublicSection["settings"],
          data: { links: [] },
        });
        break;
    }
  }

  return {
    _tag: "Found",
    publicSite: {
      business: site,
      theme,
      sections,
    },
  };
}
