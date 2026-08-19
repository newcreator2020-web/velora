import "server-only";
import { getCurrentTenantContext, type TenantContext } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

export const PLAN_TIER = ["base", "pro", "internal_test"] as const;
export type PlanTier = (typeof PLAN_TIER)[number];

export const KNOWN_CAPABILITIES = [
  "site_studio",
  "site_publish",
  "services_management",
  "theme_customization",
  "preview",
] as const;
export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

export const PLAN_CATALOG: Record<
  Exclude<PlanTier, "internal_test">,
  {
    capabilities: Record<KnownCapability, boolean>;
    limits: {
      maxServices: number | null;
      maxSections: number | null;
    };
  }
> = {
  base: {
    capabilities: {
      site_studio: true,
      site_publish: true,
      services_management: true,
      theme_customization: true,
      preview: true,
    },
    limits: {
      maxServices: 3,
      maxSections: 5,
    },
  },
  pro: {
    capabilities: {
      site_studio: true,
      site_publish: true,
      services_management: true,
      theme_customization: true,
      preview: true,
    },
    limits: {
      maxServices: null,
      maxSections: null,
    },
  },
};

export type EntitlementLimits = {
  maxServices: number | null;
  maxSections: number | null;
};

export type EntitlementsSnapshot = {
  tenantId: string;
  planId: PlanTier;
  capabilities: Record<KnownCapability, boolean>;
  limits: EntitlementLimits;
  computedAt: string;
};

export type EntitlementError =
  | { code: "ENTITLEMENT_DENIED"; capability: string; message: string }
  | {
      code: "LIMIT_REACHED";
      limit: keyof EntitlementLimits;
      max: number;
      actual: number;
      message: string;
    };

function isKnownPlanId(v: string): v is PlanTier {
  return (PLAN_TIER as readonly string[]).includes(v);
}

function buildSnapshot(tenantId: string, rawPlan: string, now: string): EntitlementsSnapshot {
  const base = PLAN_CATALOG.base;
  if (rawPlan === "internal_test") {
    return {
      tenantId,
      planId: "internal_test",
      capabilities: { ...PLAN_CATALOG.pro.capabilities },
      limits: { ...PLAN_CATALOG.pro.limits },
      computedAt: now,
    };
  }
  const plan = rawPlan === "pro" ? PLAN_CATALOG.pro : base;
  return {
    tenantId,
    planId: (isKnownPlanId(rawPlan) ? rawPlan : "base") as PlanTier,
    capabilities: { ...plan.capabilities },
    limits: { ...plan.limits },
    computedAt: now,
  };
}

export async function resolveTenantEntitlements(
  ctx: Pick<TenantContext, "tenant" | "membership" | "user">,
): Promise<EntitlementsSnapshot> {
  if (!ctx.tenant) {
    throw new Error("ENTITLEMENT_CTX_MISSING_TENANT");
  }
  const tid = ctx.tenant.id;
  let rawPlan: string | undefined = (ctx.tenant as { plan_id?: unknown }).plan_id as
    string | undefined;
  if (!rawPlan || !isKnownPlanId(rawPlan)) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("tenants")
      .select("plan_id")
      .eq("id", tid)
      .limit(1)
      .maybeSingle();
    rawPlan = data && typeof data.plan_id === "string" ? data.plan_id : "base";
  }
  return buildSnapshot(tid, rawPlan, new Date().toISOString());
}

export async function resolveCurrentEntitlements(): Promise<EntitlementsSnapshot> {
  const ctx = await getCurrentTenantContext();
  if (!ctx.tenant) {
    throw new Error("ENTITLEMENT_NO_TENANT");
  }
  return resolveTenantEntitlements(ctx);
}

export function hasCapability(snap: EntitlementsSnapshot, cap: KnownCapability): boolean {
  return snap.capabilities[cap] === true;
}

export function assertCapability(
  snap: EntitlementsSnapshot,
  cap: KnownCapability,
): EntitlementError | null {
  if (!KNOWN_CAPABILITIES.includes(cap)) {
    return {
      code: "ENTITLEMENT_DENIED",
      capability: cap as string,
      message: `Capabilità sconosciuta: ${String(cap)}`,
    };
  }
  if (snap.capabilities[cap] !== true) {
    return {
      code: "ENTITLEMENT_DENIED",
      capability: cap as string,
      message: `Piano ${snap.planId} non include la funzionalità richiesta.`,
    };
  }
  return null;
}

export function assertLimit(
  snap: EntitlementsSnapshot,
  limit: keyof EntitlementLimits,
  actualCount: number,
): EntitlementError | null {
  if (actualCount < 0) actualCount = 0;
  const max = snap.limits[limit];
  if (max === null) return null;
  if (actualCount > max) {
    const label =
      limit === "maxServices" ? "Servizi" : limit === "maxSections" ? "Sezioni" : String(limit);
    return {
      code: "LIMIT_REACHED",
      limit,
      max,
      actual: actualCount,
      message: `Limite raggiunto per ${label} (${actualCount}/${max}). Passa a PRO per rimuovere i limiti.`,
    };
  }
  return null;
}

export const planIdSchema = z.enum(["base", "pro", "internal_test"]);
