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
