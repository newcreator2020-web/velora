import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantMembership, requireTenantRole, type TenantContext } from "@/lib/server/auth";
import type { AuditMetadata } from "@/lib/server/auth-pure";
import {
  normalizeSectionsForDb,
  normalizeServicesForDb,
  editorialDraftInputSchema,
  stripEditorialTamperedFields,
  maskEditorialAudit,
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
  type SectionType,
  type PublicSite,
  type PublicSection,
  type PublicService,
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

export type SaveDraftResult =
  | { ok: true; revision: string; updated_at: string }
  | {
      ok: false;
      code: "VALIDATION" | "AUTH" | "INTERNAL" | "CONCURRENT";
      message: string;
      fieldErrors?: Partial<Record<string, string[]>>;
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
      code: "AUTH" | "AUTHZ" | "NO_DRAFT" | "CONCURRENT" | "INTERNAL";
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
  const supabaseAny = (await createSupabaseServerClient()) as any;
  const { data, error } = await supabaseAny
    .from("site_editorial_state")
    .select("sections,services,theme,draft_revision,updated_at")
    .eq("tenant_id", tid)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    const d = data as any;
    return {
      sections: Array.isArray(d["sections"]) ? (d["sections"] as StudioDraftSection[]) : [],
      services: Array.isArray(d["services"]) ? (d["services"] as StudioDraftService[]) : [],
      theme:
        d["theme"] && typeof d["theme"] === "object" && !Array.isArray(d["theme"])
          ? (d["theme"] as StudioDraftTheme)
          : {},
      revision: (d["draft_revision"] as string | null) ?? null,
      updated_at: (d["updated_at"] as string | null) ?? null,
    };
  }

  const supabase = await createSupabaseServerClient();
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
      ? sectionsRes.data.map((r: any) => ({
          id: (r.id ?? null) as string | null,
          section_type: r.section_type as SectionType,
          enabled: Boolean(r.enabled),
          position: Number(r.position ?? 0),
          variant: String(r.variant ?? "default") as StudioDraftSection["variant"],
          settings: (r.settings && typeof r.settings === "object" ? r.settings : {}) as Record<
            string,
            unknown
          >,
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
      ? servicesRes.data.map((r: any) => ({
          id: (r.id ?? null) as string | null,
          name: String(r.name ?? ""),
          description: typeof r.description === "string" ? r.description : null,
          price_from:
            r.price_from !== null && r.price_from !== undefined ? Number(r.price_from) : null,
          currency: CURRENCY_ALLOWED.includes(String(r.currency) as any)
            ? (String(r.currency) as any)
            : "EUR",
          duration_minutes:
            r.duration_minutes !== null && r.duration_minutes !== undefined
              ? Number(r.duration_minutes)
              : null,
          position: Number(r.position ?? 0),
          active: Boolean(r.active),
        }))
      : [];

  const bp = ctx.business_profile as Tables<"business_profiles">;
  const theme: StudioDraftTheme = {
    primary: validateHexColorStr(bp.theme_primary) ? bp.theme_primary : null,
    background: validateHexColorStr(bp.theme_background) ? bp.theme_background : null,
    foreground: validateHexColorStr(bp.theme_foreground) ? bp.theme_foreground : null,
    muted: validateHexColorStr(bp.theme_muted) ? bp.theme_muted : null,
    radius: RADIUS_ALLOWED.includes(bp.theme_radius as any) ? (bp.theme_radius as any) : null,
    headingFont: FONT_HEADING_ALLOWED.includes(bp.theme_heading_font_preset as any)
      ? (bp.theme_heading_font_preset as any)
      : null,
    bodyFont: FONT_BODY_ALLOWED.includes(bp.theme_body_font_preset as any)
      ? (bp.theme_body_font_preset as any)
      : null,
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
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const iss of parsed.error.issues) {
      const path = iss.path.join(".") || "_";
      const arr = fieldErrors[path] ?? (fieldErrors[path] = []);
      arr.push(iss.message);
    }
    return {
      ok: false,
      code: "VALIDATION",
      message: "Controlla i dati inseriti.",
      fieldErrors,
    };
  }

  const sectionsDb = normalizeSectionsForDb(parsed.data.sections);
  const servicesDb = normalizeServicesForDb(parsed.data.services);

  const tid = ctx.tenant.id;
  const actor = ctx.user.id;
  const now = new Date().toISOString();
  const newRev = crypto.randomUUID();

  const supabaseAny = (await createSupabaseServerClient()) as any;

  try {
    const row: Record<string, unknown> = {
      tenant_id: tid,
      sections: sectionsDb as any,
      services: servicesDb as any,
      theme: parsed.data.theme as any,
      draft_revision: newRev,
      updated_at: now,
    };
    const { error } = await supabaseAny.from("site_editorial_state").upsert(row, {
      onConflict: "tenant_id",
    });

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

  const supabaseAny = (await createSupabaseServerClient()) as any;
  try {
    const args: Record<string, unknown> = { p_tenant_id: tid };
    if (typeof expected_revision === "string" && expected_revision.length > 0) {
      args["p_expected_revision"] = expected_revision;
    }
    const { data, error } = await supabaseAny.rpc("publish_site_draft", args);

    if (error || !data || (Array.isArray(data) && data.length === 0)) {
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
    const row = Array.isArray(data) ? (data[0] as any) : (data as any);
    if (!row.ok) {
      type RpcCode = Exclude<Extract<PublishResult, { ok: false }>["code"], undefined>;
      const codeMap: Record<string, RpcCode> = {
        AUTH: "AUTH",
        AUTHZ: "AUTHZ",
        NO_DRAFT: "NO_DRAFT",
        CONCURRENT: "CONCURRENT",
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

  const draft = await loadEditorialDraft(ctx as any);

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
          settings: parsedSet.value as any,
          data: { businessName: site.businessName },
        });
        break;
      case "about":
        if (site.description && site.description.trim().length > 0) {
          sections.push({
            type: "about",
            variant,
            settings: parsedSet.value as any,
            data: { description: site.description, businessName: site.businessName },
          });
        }
        break;
      case "services":
        if (services.length > 0) {
          sections.push({
            type: "services",
            variant,
            settings: parsedSet.value as any,
            data: { services },
          });
        }
        break;
      case "gallery":
        sections.push({
          type: "gallery",
          variant,
          settings: parsedSet.value as any,
          data: { assets: [] },
        });
        break;
      case "staff":
        sections.push({
          type: "staff",
          variant,
          settings: parsedSet.value as any,
          data: { members: [] },
        });
        break;
      case "reviews":
        sections.push({
          type: "reviews",
          variant,
          settings: parsedSet.value as any,
          data: { reviews: [] },
        });
        break;
      case "contact": {
        const hasAny = site.phone || site.email || site.address || site.city;
        if (hasAny) {
          sections.push({
            type: "contact",
            variant,
            settings: parsedSet.value as any,
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

  return {
    _tag: "Found",
    publicSite: {
      business: site,
      theme,
      sections,
    },
  };
}
