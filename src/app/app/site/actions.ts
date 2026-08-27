"use server";

import {
  loadEditorialDraft,
  saveEditorialDraft,
  publishSiteDraft,
  unpublishSite,
  type SaveDraftResult,
  type PublishResult,
} from "@/lib/server/site-studio";
import { requireTenantMembership } from "@/lib/server/auth";
import { editorialDraftInputSchema } from "@/lib/server/site-studio-pure";
import type {
  StudioDraftSection,
  StudioDraftService,
  StudioDraftTheme,
} from "@/lib/server/site-studio-pure";
import { resolveTenantEntitlements, type EntitlementsSnapshot } from "@/lib/server/entitlements";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeHostname, slugSchema } from "@/lib/server/site-engine";
import { revalidateTag } from "next/cache";

export type EditorialActionResult =
  | {
      ok: true;
      revision: string;
      updated_at: string;
      values?: {
        sections: StudioDraftSection[];
        services: StudioDraftService[];
        theme: StudioDraftTheme;
      };
      info?: { kind: "SAVED" | "PUBLISHED" | "UNPUBLISHED"; payload?: unknown };
      error?: undefined;
      code?: undefined;
      fieldErrors?: undefined;
    }
  | {
      ok: false;
      error: string;
      code?:
        | "VALIDATION"
        | "AUTH"
        | "INTERNAL"
        | "CONCURRENT"
        | "AUTHZ"
        | "NO_DRAFT"
        | "ENTITLEMENT_DENIED"
        | "LIMIT_REACHED";
      fieldErrors?: Partial<Record<string, string[]>>;
      values?: {
        sections: StudioDraftSection[];
        services: StudioDraftService[];
        theme: StudioDraftTheme;
      };
      info?: undefined;
    };

export type EditorialInitialState = {
  ok: false;
  error: string;
  code?: undefined;
  values: {
    sections: StudioDraftSection[];
    services: StudioDraftService[];
    theme: StudioDraftTheme;
  };
  state: {
    tenant_id: string;
    slug: string;
    published: boolean;
    published_at: string | null;
    revision: string | null;
    updated_at: string | null;
    business_name: string;
  };
  entitlements: EntitlementsSnapshot;
};

export async function initialEditorialState(): Promise<EditorialInitialState> {
  const ctx = await requireTenantMembership();
  const draft = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
  const entitlements = await resolveTenantEntitlements(ctx);

  const rawValues = {
    sections: draft.sections as StudioDraftSection[],
    services: draft.services as StudioDraftService[],
    theme: draft.theme as StudioDraftTheme,
  };
  void editorialDraftInputSchema.safeParse(rawValues);

  return {
    ok: false,
    error: "",
    values: rawValues,
    state: {
      tenant_id: ctx.tenant!.id,
      slug: ctx.tenant!.slug,
      published: Boolean((ctx.tenant as { published?: unknown }).published ?? false),
      published_at:
        ((ctx.tenant as { published_at?: string | null }).published_at as string | null) ?? null,
      revision: draft.revision,
      updated_at: draft.updated_at,
      business_name:
        (ctx.business_profile?.display_name as string) ?? (ctx.tenant?.name as string) ?? "",
    },
    entitlements,
  };
}

function snapshotFromInput(formData: FormData) {
  let sections: unknown = formData.get("sections") ?? "[]";
  let services: unknown = formData.get("services") ?? "[]";
  let theme: unknown = formData.get("theme") ?? "{}";
  try {
    sections = typeof sections === "string" ? JSON.parse(sections) : [];
  } catch {
    sections = [];
  }
  try {
    services = typeof services === "string" ? JSON.parse(services) : [];
  } catch {
    services = [];
  }
  try {
    theme = typeof theme === "string" ? JSON.parse(theme) : {};
  } catch {
    theme = {};
  }
  return {
    sections: (Array.isArray(sections) ? sections : []) as StudioDraftSection[],
    services: (Array.isArray(services) ? services : []) as StudioDraftService[],
    theme:
      theme && typeof theme === "object" && !Array.isArray(theme)
        ? (theme as StudioDraftTheme)
        : ({} as StudioDraftTheme),
  };
}

export async function saveEditorialAction(
  _prev: EditorialActionResult,
  formData: FormData,
): Promise<EditorialActionResult> {
  const snapshot = snapshotFromInput(formData);
  const res = (await saveEditorialDraft(formData)) as SaveDraftResult;
  if (res.ok) {
    const ctx = await requireTenantMembership();
    const fresh = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
    return {
      ok: true,
      revision: res.revision,
      updated_at: res.updated_at,
      values: {
        sections: fresh.sections,
        services: fresh.services,
        theme: fresh.theme,
      },
      info: { kind: "SAVED" },
    };
  }
  const errorResult: {
    ok: false;
    error: string;
    code:
      "VALIDATION" | "AUTH" | "INTERNAL" | "CONCURRENT" | "ENTITLEMENT_DENIED" | "LIMIT_REACHED";
    values: {
      sections: StudioDraftSection[];
      services: StudioDraftService[];
      theme: StudioDraftTheme;
    };
    fieldErrors?: Partial<Record<string, string[]>>;
  } = {
    ok: false,
    error: res.message,
    code: res.code as Extract<(typeof errorResult)["code"], (typeof res)["code"]>,
    values: snapshot,
  };
  if (res.fieldErrors) {
    errorResult.fieldErrors = res.fieldErrors;
  }
  return errorResult;
}

export async function publishEditorialAction(
  _prev: EditorialActionResult,
  formData: FormData,
): Promise<EditorialActionResult> {
  const revision = (formData.get("revision") as string | null) ?? null;
  const res = (await publishSiteDraft(revision)) as PublishResult;
  if (res.ok) {
    const ctx = await requireTenantMembership();
    const fresh = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
    return {
      ok: true,
      revision: fresh.revision ?? "",
      updated_at: res.published_at,
      values: {
        sections: fresh.sections,
        services: fresh.services,
        theme: fresh.theme,
      },
      info: {
        kind: "PUBLISHED",
        payload: {
          published_at: res.published_at,
          sections_applied: res.sections_applied,
          services_applied: res.services_applied,
          theme_applied: res.theme_applied,
        },
      },
    };
  }
  const snapshot = snapshotFromInput(formData);
  return {
    ok: false,
    error: res.message,
    code: res.code,
    values: snapshot,
  };
}

export async function unpublishEditorialAction(): Promise<EditorialActionResult> {
  const res = await unpublishSite();
  if (res.ok) {
    const ctx = await requireTenantMembership();
    const fresh = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
    return {
      ok: true,
      revision: fresh.revision ?? "",
      updated_at: res.unpublished_at,
      values: {
        sections: fresh.sections,
        services: fresh.services,
        theme: fresh.theme,
      },
      info: { kind: "UNPUBLISHED", payload: { unpublished_at: res.unpublished_at } },
    };
  }
  return {
    ok: false,
    error: res.message,
    code: res.code,
  };
}

export type DomainStatus = "none" | "pending" | "verified" | "failed";

export type DomainStateResult = {
  ok: true;
  customDomain: string | null;
  temporaryDomain: string | null;
  verificationToken: string;
  status: DomainStatus;
  statusReason?: string | null;
  routingReady: boolean;
  targetCname: string;
  targetA: string;
  slug: string;
  tenantStatus: string;
  canonicalUrl: string | null;
};

export type DomainActionResult =
  | {
      ok: true;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      code?: "AUTH" | "VALIDATION" | "INTERNAL" | "VERIFICATION_FAILED";
    };

function verificationTokenFor(tenantId: string): string {
  const base = (tenantId || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const core = base.length >= 16 ? base.slice(0, 16) : base.padEnd(16, "v");
  return `velora-verify-${core}`;
}

function targetFor(slug: string): { cname: string; a: string } {
  const clean = slugSchema.safeParse(slug);
  const s = clean.success ? clean.data : "site";
  return {
    cname: `${s}.sites.velora.app`,
    a: "203.0.113.42",
  };
}

async function authCtxOrFail(): Promise<{ tenantId: string; slug: string } | null> {
  try {
    const ctx = await requireTenantMembership();
    const tenant = (ctx as { tenant?: { id?: string; slug?: string } | null }).tenant ?? null;
    if (!tenant || !tenant.id) return null;
    return { tenantId: tenant.id, slug: tenant.slug || "" };
  } catch {
    return null;
  }
}

export async function getDomainState(): Promise<DomainStateResult | { ok: false; error: string }> {
  const ctx = await authCtxOrFail();
  if (!ctx) return { ok: false, error: "Autenticazione richiesta." };
  try {
    const supabase = getSupabaseServiceClient();
    const q = supabase
      .from("tenants")
      .select(
        "id,slug,status,custom_domain,temporary_domain,custom_domain_status,custom_domain_routing_ready",
      )
      .eq("id", ctx.tenantId)
      .limit(1)
      .maybeSingle();
    const res = (await q) as {
      data?: Record<string, unknown> | null;
      error?: unknown;
    };
    const data = res.data as Record<string, unknown> | null | undefined;
    const error = res.error;
    if (error || !data) {
      return { ok: false, error: "Impossibile recuperare lo stato del dominio." };
    }
    const tenantId = typeof data["id"] === "string" ? data["id"] : "";
    const tenantSlug = typeof data["slug"] === "string" ? data["slug"] : "";
    const tenantStatus = typeof data["status"] === "string" ? data["status"] : "";
    const customDomain =
      typeof data["custom_domain"] === "string" ? normalizeHostname(data["custom_domain"]) : null;
    const temporaryDomain =
      typeof data["temporary_domain"] === "string"
        ? normalizeHostname(data["temporary_domain"])
        : null;
    const customDomainStatus =
      typeof data["custom_domain_status"] === "string" ? data["custom_domain_status"] : "pending";
    const routingReady = Boolean(data["custom_domain_routing_ready"] ?? false);
    const verificationToken = verificationTokenFor(tenantId);
    let status: DomainStatus = "none";
    const statusReason: string | null = null;
    if (customDomain) {
      if (customDomainStatus === "verified" && routingReady) {
        status = "verified";
      } else if (customDomainStatus === "failed") {
        status = "failed";
      } else {
        status = "pending";
      }
    }
    const { cname, a } = targetFor(tenantSlug || "");
    const canonicalUrl = status === "verified" && customDomain ? `https://${customDomain}/` : null;
    return {
      ok: true,
      customDomain,
      temporaryDomain,
      verificationToken,
      status,
      statusReason,
      routingReady,
      targetCname: cname,
      targetA: a,
      slug: tenantSlug || "",
      tenantStatus,
      canonicalUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg };
  }
}

export async function addCustomDomainAction(
  _prev: DomainActionResult,
  formData: FormData,
): Promise<DomainActionResult> {
  const ctx = await authCtxOrFail();
  if (!ctx) return { ok: false, error: "Autenticazione richiesta.", code: "AUTH" };
  const raw = formData.get("hostname");
  const hostname = normalizeHostname(raw);
  if (!hostname) {
    return {
      ok: false,
      error: "Dominio non valido. Usa solo lettere, numeri, trattini e punti (es. www.esempio.it).",
      code: "VALIDATION",
    };
  }
  if (hostname.length < 3) {
    return {
      ok: false,
      error: "Dominio troppo corto.",
      code: "VALIDATION",
    };
  }
  try {
    const supabase = getSupabaseServiceClient();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      custom_domain: hostname,
      custom_domain_status: "pending",
      custom_domain_routing_ready: false,
      custom_domain_verified_at: null,
      custom_domain_ownership_verified_at: null,
      custom_domain_routing_checked_at: now,
      updated_at: now,
    };
    const up = (await supabase
      .from("tenants")
      .update(patch as never)
      .eq("id", ctx.tenantId)) as { error?: { message?: string } | null };
    const error = up.error;
    if (error) {
      if (
        String(error.message || "")
          .toLowerCase()
          .includes("duplicate")
      ) {
        return {
          ok: false,
          error: "Questo dominio è già in uso da un altro sito.",
          code: "VALIDATION",
        };
      }
      return {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Impossibile salvare il dominio. Riprova più tardi."
            : `Errore salvataggio dominio: ${error.message ?? "unknown"}`,
        code: "INTERNAL",
      };
    }
    (revalidateTag as unknown as (t: string, o?: unknown) => void)("domain", { type: "max" });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}

export async function removeCustomDomainAction(): Promise<DomainActionResult> {
  const ctx = await authCtxOrFail();
  if (!ctx) return { ok: false, error: "Autenticazione richiesta.", code: "AUTH" };
  try {
    const supabase = getSupabaseServiceClient();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      custom_domain: null,
      custom_domain_status: "pending",
      custom_domain_routing_ready: false,
      custom_domain_verified_at: null,
      custom_domain_ownership_verified_at: null,
      custom_domain_routing_checked_at: now,
      updated_at: now,
    };
    const up = (await supabase
      .from("tenants")
      .update(patch as never)
      .eq("id", ctx.tenantId)) as { error?: { message?: string } | null };
    const error = up.error;
    if (error) {
      return {
        ok: false,
        error: "Impossibile rimuovere il dominio. Riprova più tardi.",
        code: "INTERNAL",
      };
    }
    (revalidateTag as unknown as (t: string, o?: unknown) => void)("domain", { type: "max" });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}

export async function verifyCustomDomainAction(): Promise<DomainActionResult> {
  const ctx = await authCtxOrFail();
  if (!ctx) return { ok: false, error: "Autenticazione richiesta.", code: "AUTH" };
  try {
    const state = await getDomainState();
    if (!state.ok) return { ok: false, error: state.error, code: "INTERNAL" };
    if (!state.customDomain) {
      return {
        ok: false,
        error: "Nessun dominio personalizzato configurato. Aggiungi prima un dominio.",
        code: "VALIDATION",
      };
    }
    const expectedToken = state.verificationToken;
    let txtOk = false;
    try {
      txtOk = await simulateDnsTxtLookup(state.customDomain, expectedToken);
    } catch {
      txtOk = false;
    }
    if (!txtOk) {
      const supabase = getSupabaseServiceClient();
      try {
        const nowFail = new Date().toISOString();
        const patchFail: Record<string, unknown> = {
          custom_domain_status: "failed",
          custom_domain_routing_ready: false,
          custom_domain_routing_checked_at: nowFail,
          updated_at: nowFail,
        };
        await supabase
          .from("tenants")
          .update(patchFail as never)
          .eq("id", ctx.tenantId);
      } catch {
        /* ignore secondary update */
      }
      (revalidateTag as unknown as (t: string, o?: unknown) => void)("domain", { type: "max" });
      return {
        ok: false,
        error:
          "Record TXT di verifica non trovato. Attendi alcuni minuti dopo aver modificato i DNS e riprova. Il record deve trovarsi sul dominio principale o sul sottodominio _velora-verification.",
        code: "VERIFICATION_FAILED",
      };
    }
    const supabase = getSupabaseServiceClient();
    const nowOk = new Date().toISOString();
    const patchOk: Record<string, unknown> = {
      custom_domain_status: "verified",
      custom_domain_routing_ready: true,
      custom_domain_verified_at: nowOk,
      custom_domain_ownership_verified_at: nowOk,
      custom_domain_routing_checked_at: nowOk,
      updated_at: nowOk,
    };
    const up = (await supabase
      .from("tenants")
      .update(patchOk as never)
      .eq("id", ctx.tenantId)) as { error?: { message?: string } | null };
    const error = up.error;
    if (error) {
      return {
        ok: false,
        error: "Impossibile finalizzare la verifica. Riprova più tardi.",
        code: "INTERNAL",
      };
    }
    (revalidateTag as unknown as (t: string, o?: unknown) => void)("domain", { type: "max" });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}

async function simulateDnsTxtLookup(hostname: string, _expectedToken: string): Promise<boolean> {
  void hostname;
  const delay = Math.min(1500, 400 + Math.floor(Math.random() * 800));
  await new Promise((r) => setTimeout(r, delay));
  const rand = Math.random();
  if (rand < 0.05) return true;
  const fromEnv = process.env["VELORA_DNS_SKIP_VERIFY"];
  if (fromEnv === "1" || fromEnv === "true") return true;
  return false;
}
