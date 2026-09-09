"use server";

import { createHash, randomBytes } from "node:crypto";
import {
  loadEditorialDraft,
  saveEditorialDraft,
  publishSiteDraft,
  unpublishSite,
  type SaveDraftResult,
  type PublishResult,
} from "@/lib/server/site-studio";
import { requireTenantMembership } from "@/lib/server/auth";
import {
  editorialDraftInputSchema,
  findImagesMissingAlt,
  type AltTextIssue,
  type StudioDraftSection,
  type StudioDraftService,
  type StudioDraftTheme,
} from "@/lib/server/site-studio-pure";
import { resolveTenantEntitlements } from "@/lib/server/entitlements";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeHostname, slugSchema } from "@/lib/server/site-engine";
import { getDnsResolver } from "@/lib/server/dns-resolver";
import { revalidateTag } from "next/cache";
import {
  PUBLICATION_ALLOWED_TRANSITIONS,
  PUBLICATION_STATUS_LABEL,
  type DomainActionResult,
  type DomainStateResult,
  type DomainStatus,
  type EditorialActionResult,
  type EditorialInitialState,
  type PublicationStatus,
  type PublicationVersionRow,
  type PublicationWorkflowState,
  type TransitionPublicationResult,
} from "./lib";

function normalizePublicationStatus(raw: string | null | undefined): PublicationStatus {
  switch (raw) {
    case "ready_for_qa":
      return "ready_for_qa";
    case "validated":
      return "validated";
    case "published":
      return "published";
    default:
      return "draft";
  }
}

async function loadWorkflowState(ctx: {
  tenant: { id: string } | null;
}): Promise<PublicationWorkflowState> {
  const fallback: PublicationWorkflowState = {
    status: "draft",
    version_number: 1,
    latest_published_at: null,
    latest_published_version: null,
  };
  if (!ctx.tenant?.id) return fallback;
  try {
    const svc = getSupabaseServiceClient();
    const svcAny = svc as unknown as {
      from: (relation: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: unknown,
          ) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{
                data: Record<string, unknown> | null;
                error?: { message?: string; code?: string } | null;
              }>;
            };
          };
        };
      };
    };
    const q = await svcAny
      .from("site_publication_versions")
      .select(
        "id,tenant_id,version_number,status,snapshot,hash_sha256,published_at,created_by,note,created_at,updated_at",
      )
      .eq("tenant_id", ctx.tenant.id)
      .limit(1)
      .maybeSingle();
    const row = q.data as PublicationVersionRow | null | undefined;
    if (!row) {
      const fallbackStatus: PublicationStatus = (
        (ctx as { tenant?: { published?: unknown } | null }).tenant as
          { published?: unknown } | undefined
      )?.published
        ? "published"
        : "draft";
      return {
        ...fallback,
        status: fallbackStatus,
        latest_published_at:
          ((
            (ctx as { tenant?: { published_at?: string | null } | null }).tenant as
              { published_at?: string | null } | undefined
          )?.published_at as string | null) ?? null,
        latest_published_version: fallbackStatus === "published" ? 1 : null,
      };
    }
    const status = normalizePublicationStatus(row.status);
    return {
      status,
      version_number: Number(row.version_number) || 1,
      latest_published_at: status === "published" ? row.published_at : null,
      latest_published_version: status === "published" ? Number(row.version_number) || 1 : null,
    };
  } catch {
    return fallback;
  }
}

export async function initialEditorialState(): Promise<EditorialInitialState> {
  const ctx = await requireTenantMembership();
  const draft = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
  const entitlements = await resolveTenantEntitlements(ctx);
  const workflow = await loadWorkflowState(ctx as Parameters<typeof loadWorkflowState>[0]);

  const rawValues = {
    sections: draft.sections as StudioDraftSection[],
    services: draft.services as StudioDraftService[],
    theme: draft.theme as StudioDraftTheme,
  };
  void editorialDraftInputSchema.safeParse(rawValues);

  const tenantPublished = Boolean((ctx.tenant as { published?: unknown }).published ?? false);
  const derivedPublished = workflow.status === "published" ? true : tenantPublished;
  const derivedPublishedAt =
    workflow.status === "published"
      ? workflow.latest_published_at
      : (((ctx.tenant as { published_at?: string | null }).published_at as string | null) ?? null);

  return {
    ok: false,
    error: "",
    values: rawValues,
    state: {
      tenant_id: ctx.tenant!.id,
      slug: ctx.tenant!.slug,
      published: derivedPublished,
      published_at: derivedPublishedAt,
      revision: draft.revision,
      updated_at: draft.updated_at,
      business_name:
        (ctx.business_profile?.display_name as string) ?? (ctx.tenant?.name as string) ?? "",
      workflow,
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
  const ctx = await requireTenantMembership();
  const draft = await loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);

  const workflow = await loadWorkflowState(ctx as Parameters<typeof loadWorkflowState>[0]);

  const altIssues: AltTextIssue[] = findImagesMissingAlt(
    draft.sections as Parameters<typeof findImagesMissingAlt>[0],
  );
  if (altIssues.length > 0) {
    const snapshot = snapshotFromInput(formData);
    const details: string[] = altIssues.map((it) => {
      const kind = it.issue === "missing_alt" ? "CAMPO ALT MANCANTE" : "ALT VUOTO";
      return `${kind} — ${it.breadcrumb}`;
    });
    const shortMsg =
      altIssues.length === 1
        ? `1 immagine ha problemi SEO: aggiungi un testo descrittivo (alt text) prima di pubblicare.`
        : `${altIssues.length} immagini hanno problemi SEO: aggiungi testi descrittivi (alt text) prima di pubblicare.`;
    return {
      ok: false,
      error: shortMsg,
      code: "VALIDATION",
      fieldErrors: {
        publish: details,
      },
      values: snapshot,
    };
  }

  if (workflow.status !== "validated" && workflow.status !== "published") {
    const snapshot = snapshotFromInput(formData);
    return {
      ok: false,
      error: `Per pubblicare devi prima portare lo stato in "Validata" (attuale: ${PUBLICATION_STATUS_LABEL[workflow.status]}).`,
      code: "VALIDATION",
      fieldErrors: {
        publish: [
          `Workflow: passa per gli stati Bozza → Pronta per QA → Validata prima di Pubblica.`,
        ],
      },
      values: snapshot,
    };
  }

  const res = (await publishSiteDraft(revision)) as PublishResult;
  if (res.ok) {
    try {
      const svc = getSupabaseServiceClient();
      const svcAny = svc as unknown as {
        from: (relation: string) => {
          upsert: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => unknown;
        };
      };
      const nextVersion = (workflow.version_number || 0) + 1;
      const snapshotJSON = {
        sections: draft.sections,
        services: draft.services,
        theme: draft.theme,
        revision: draft.revision,
        generated_at: new Date().toISOString(),
      };
      let hash: string | null = null;
      try {
        hash = createHash("sha256").update(JSON.stringify(snapshotJSON)).digest("hex");
      } catch {
        hash = null;
      }
      void svcAny.from("site_publication_versions").upsert(
        {
          tenant_id: ctx.tenant!.id,
          status: "published",
          version_number: nextVersion,
          snapshot: snapshotJSON,
          hash_sha256: hash,
          published_at: res.published_at,
          created_by: (ctx.user as { id?: string } | undefined)?.id ?? null,
          note: "Pubblicazione diretta da SiteStudio",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );
      void svc.from("audit_logs").insert({
        tenant_id: ctx.tenant!.id,
        actor_user_id: (ctx.user as { id?: string } | undefined)?.id ?? null,
        action: "site.published",
        entity_type: "site_publication",
        entity_id: ctx.tenant!.id,
        metadata: {
          success: true,
          from: workflow.status,
          to: "published",
          version_number: nextVersion,
          published_at: res.published_at,
          sections_applied: res.sections_applied,
          services_applied: res.services_applied,
          theme_applied: res.theme_applied,
          version_hash: hash,
        } as unknown as import("@/types/supabase").Json,
      });
    } catch {
      // audit non bloccante
    }
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
  try {
    const s = getSupabaseServiceClient();
    void s.from("audit_logs").insert({
      tenant_id: ctx.tenant?.id ?? null,
      actor_user_id: (ctx.user as { id?: string } | undefined)?.id ?? null,
      action: "site.publish_attempt",
      entity_type: "site_publication",
      entity_id: ctx.tenant?.id ?? null,
      metadata: {
        success: false,
        code: res.code,
        message: res.message,
        revision_input: revision,
      } as unknown as import("@/types/supabase").Json,
    });
  } catch {
    // audit non bloccante
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
    try {
      const ctx = await requireTenantMembership();
      const svc = getSupabaseServiceClient();
      const svcAny = svc as unknown as {
        from: (relation: string) => {
          upsert: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => unknown;
        };
      };
      void svcAny.from("site_publication_versions").upsert(
        {
          tenant_id: ctx.tenant!.id,
          status: "draft",
          version_number: 1,
          snapshot: {} as Record<string, unknown>,
          hash_sha256: null,
          published_at: null,
          note: "Unpublish manuale da SiteStudio",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );
      void svc.from("audit_logs").insert({
        tenant_id: ctx.tenant!.id,
        actor_user_id: (ctx.user as { id?: string } | undefined)?.id ?? null,
        action: "site.state_changed",
        entity_type: "site_publication",
        entity_id: ctx.tenant!.id,
        metadata: {
          from: "published",
          to: "draft",
          reason: "unpublish_manual",
        } as unknown as import("@/types/supabase").Json,
      });
    } catch {
      // audit non bloccante
    }
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

export async function transitionPublicationAction(
  _prev: TransitionPublicationResult,
  formData: FormData,
): Promise<TransitionPublicationResult> {
  try {
    const ctx = await requireTenantMembership();
    if (!ctx.tenant?.id) {
      return { ok: false, error: "Autenticazione richiesta.", code: "AUTH" };
    }
    const fromRaw = (formData.get("from_status") as string | null) ?? "";
    const toRaw = (formData.get("to_status") as string | null) ?? "";
    const note = (formData.get("note") as string | null) ?? null;
    const from = normalizePublicationStatus(fromRaw || "draft");
    const to = normalizePublicationStatus(toRaw || "draft");
    if (from === to) {
      return {
        ok: false,
        error: "Stato di partenza e destinazione coincidono.",
        code: "VALIDATION",
        from,
        to,
      };
    }
    const allowed = PUBLICATION_ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      return {
        ok: false,
        error: `Transizione non consentita: ${PUBLICATION_STATUS_LABEL[from]} → ${PUBLICATION_STATUS_LABEL[to]}`,
        code: "INVALID_TRANSITION",
        from,
        to,
      };
    }

    const snapshotDraft = loadEditorialDraft(ctx as Parameters<typeof loadEditorialDraft>[0]);
    const svc = getSupabaseServiceClient();
    const svcAny = svc as unknown as {
      from: (relation: string) => {
        select: (cols: string) => {
          eq: (
            k: string,
            v: unknown,
          ) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{
                data: Record<string, unknown> | null;
                error?: { message?: string; code?: string } | null;
              }>;
            };
          };
        };
        upsert: (
          payload: Record<string, unknown>,
          opts?: { onConflict?: string },
        ) => {
          select: (cols: string) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{
                data: Record<string, unknown> | null;
                error?: { message?: string; code?: string } | null;
              }>;
            };
          };
        };
      };
    };

    const existingQ = await svcAny
      .from("site_publication_versions")
      .select(
        "id,tenant_id,version_number,status,snapshot,hash_sha256,published_at,created_by,note,created_at,updated_at",
      )
      .eq("tenant_id", ctx.tenant.id)
      .limit(1)
      .maybeSingle();
    const existing = existingQ.data as PublicationVersionRow | null | undefined;
    const currentStatus = existing ? normalizePublicationStatus(existing.status) : "draft";
    if (currentStatus !== from) {
      return {
        ok: false,
        error: `Stato corrente non corrisponde (atteso: ${from}, trovato: ${currentStatus}). Ricarica la pagina.`,
        code: "INVALID_TRANSITION",
        from: currentStatus,
        to,
      };
    }

    const draft = await snapshotDraft;
    const snapshotJSON = {
      sections: draft.sections,
      services: draft.services,
      theme: draft.theme,
      revision: draft.revision,
      generated_at: new Date().toISOString(),
    };
    const snapshotStr = JSON.stringify(snapshotJSON);
    let hash: string | null = null;
    try {
      hash = createHash("sha256").update(snapshotStr).digest("hex");
    } catch {
      hash = null;
    }

    let nextVersion = existing ? Number(existing.version_number) || 1 : 1;
    let publishedAt: string | null = existing?.published_at ?? null;
    let auditAction = "site.state_changed";
    let auditExtra: Record<string, unknown> = {};

    if (to === "published") {
      nextVersion = (existing?.version_number || 0) + 1;
      publishedAt = new Date().toISOString();
      auditAction = "site.published";
      auditExtra = {
        version_number: nextVersion,
        published_at: publishedAt,
        version_hash: hash,
      };
    } else if (from === "published" && to === "draft") {
      auditAction = "site.rolled_back";
      auditExtra = {
        previous_version_id: existing?.id ?? null,
        previous_version_number: existing?.version_number ?? null,
      };
    }

    const upsertPayload: Record<string, unknown> = {
      tenant_id: ctx.tenant.id,
      status: to,
      version_number: nextVersion,
      snapshot: snapshotJSON,
      hash_sha256: hash,
      published_at: publishedAt,
      created_by: (ctx.user as { id?: string } | undefined)?.id ?? null,
      note: note?.slice(0, 500) ?? existing?.note ?? null,
      updated_at: new Date().toISOString(),
    };

    const ups = await svcAny
      .from("site_publication_versions")
      .upsert(upsertPayload, { onConflict: "tenant_id" })
      .select("version_number,status,published_at")
      .limit(1)
      .maybeSingle();
    if (ups.error) {
      return {
        ok: false,
        error:
          process.env.NODE_ENV === "production" ? "Errore interno." : `DB: ${ups.error.message}`,
        code: "INTERNAL",
        from,
        to,
      };
    }

    if (to === "published") {
      const publishRes = await publishSiteDraft(draft.revision);
      if (!publishRes.ok) {
        type ErrCode = "AUTH" | "VALIDATION" | "INTERNAL" | "AUTHZ" | "INVALID_TRANSITION";
        const mapToErr: Record<string, ErrCode> = {
          AUTH: "AUTH",
          INTERNAL: "INTERNAL",
          AUTHZ: "AUTHZ",
        };
        const safeCode: ErrCode = mapToErr[publishRes.code as string] ?? "INTERNAL";
        return {
          ok: false,
          error: publishRes.message,
          code: safeCode,
          from,
          to,
        };
      }
    }
    if (from === "published" && to === "draft") {
      await unpublishSite();
    }

    try {
      void svc.from("audit_logs").insert({
        tenant_id: ctx.tenant.id,
        actor_user_id: (ctx.user as { id?: string } | undefined)?.id ?? null,
        action: auditAction,
        entity_type: "site_publication",
        entity_id: ctx.tenant.id,
        metadata: {
          from,
          to,
          note: note ?? null,
          ...auditExtra,
        } as unknown as import("@/types/supabase").Json,
      });
    } catch {
      // audit non bloccante
    }

    return {
      ok: true,
      from,
      to,
      version_number: Number(
        (ups.data as { version_number?: unknown } | null)?.version_number ?? nextVersion,
      ),
      info: `Stato aggiornato: ${PUBLICATION_STATUS_LABEL[from]} → ${PUBLICATION_STATUS_LABEL[to]}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}

function verificationTokenFor(tenantId: string): string {
  const base = (tenantId || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const prefix = base.length >= 12 ? base.slice(0, 12) : base.padEnd(12, "v");
  const suffix = randomBytes(8).toString("hex");
  return `velora-verify-${prefix}${suffix}`;
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
      .eq("id", ctx.tenantId)
      .select("id,custom_domain")
      .maybeSingle()) as {
      data: { id: string; custom_domain: string | null } | null;
      error?: { message?: string; code?: string } | null;
    };
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
    if (!up.data || !up.data.id) {
      return { ok: false, error: "Tenant non trovato o aggiornamento fallito.", code: "INTERNAL" };
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
      .eq("id", ctx.tenantId)
      .select("id")
      .maybeSingle()) as {
      data: { id: string } | null;
      error?: { message?: string } | null;
    };
    const error = up.error;
    if (error) {
      return {
        ok: false,
        error: "Impossibile rimuovere il dominio. Riprova più tardi.",
        code: "INTERNAL",
      };
    }
    if (!up.data || !up.data.id) {
      return { ok: false, error: "Tenant non trovato per rimozione dominio.", code: "INTERNAL" };
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
    const hostname = state.customDomain;
    const expectedToken = state.verificationToken;
    const resolver = getDnsResolver();
    const now = new Date().toISOString();

    let ownershipVerified = false;
    try {
      const ownershipHost = `_velora-verification.${hostname}`;
      const txtRecords = await resolver.resolveTxt(ownershipHost);
      const flat: string[] = [];
      for (const group of txtRecords) {
        for (const part of group) flat.push(part);
      }
      ownershipVerified = flat.includes(String(expectedToken));
    } catch {
      ownershipVerified = false;
    }

    let routingReady = false;
    const expectedCname = process.env["VELORA_PUBLIC_ROUTING_CNAME"] ?? "public.velora.local";
    const expectedIp = process.env["VELORA_PUBLIC_ROUTING_IP"] ?? "127.0.0.1";
    try {
      try {
        const cname = await resolver.resolveCname(hostname);
        const normalized = typeof cname === "string" ? cname.replace(/\.+$/, "").toLowerCase() : "";
        const expected = String(expectedCname).replace(/\.+$/, "").toLowerCase();
        if (normalized === expected) routingReady = true;
      } catch {
        routingReady = false;
      }
      if (!routingReady) {
        try {
          const a = await resolver.lookup(hostname);
          if (a && a.address === String(expectedIp)) routingReady = true;
        } catch {
          routingReady = false;
        }
      }
    } catch {
      routingReady = false;
    }

    const supabase = getSupabaseServiceClient();
    const patch: Record<string, unknown> = {
      custom_domain_ownership_verified_at: ownershipVerified ? now : null,
      custom_domain_routing_checked_at: now,
      custom_domain_routing_ready: routingReady,
      updated_at: now,
    };

    if (ownershipVerified && routingReady) {
      patch["custom_domain_status"] = "verified";
      patch["custom_domain_verified_at"] = now;
    } else if (ownershipVerified) {
      patch["custom_domain_status"] = "verification";
      patch["custom_domain_verified_at"] = null;
    } else {
      patch["custom_domain_status"] = "failed";
      patch["custom_domain_verified_at"] = null;
    }

    await supabase
      .from("tenants")
      .update(patch as never)
      .eq("id", ctx.tenantId);

    (revalidateTag as unknown as (t: string, o?: unknown) => void)("domain", { type: "max" });

    if (ownershipVerified && routingReady) {
      return { ok: true };
    }
    if (!ownershipVerified) {
      return {
        ok: false,
        error:
          "Record TXT di verifica non trovato. Attendi alcuni minuti dopo aver modificato i DNS e riprova. Il record deve trovarsi sul sottodominio _velora-verification del dominio configurato.",
        code: "VERIFICATION_FAILED",
      };
    }
    return {
      ok: false,
      error:
        "Record TXT di ownership trovato, ma il routing DNS non è ancora configurato correttamente. Aggiungi un record CNAME che punti al dominio di destinazione oppure un record A che punti all'indirizzo IP fornito.",
      code: "ROUTING_NOT_READY",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore interno";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}
