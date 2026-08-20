import "server-only";
import Stripe from "stripe";
import { getCurrentTenantContext } from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";
import { PLAN_CATALOG, type PlanTier } from "@/lib/server/entitlements";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "past_due"
  | "canceled"
  | "deleted"
  | "ended"
  | "paused"
  | "unknown";

export type BillingCustomerRow = Database["public"]["Tables"]["billing_customers"]["Row"];
export type BillingSubscriptionRow = Database["public"]["Tables"]["billing_subscriptions"]["Row"];

const PROVIDER = "stripe" as const;

const SERVER_ENV = {
  get stripeSecret(): string | undefined {
    const v = process.env["STRIPE_SECRET_KEY"];
    return typeof v === "string" && v.length > 16 ? v : undefined;
  },
  get stripeWebhookSecret(): string | undefined {
    const v = process.env["STRIPE_WEBHOOK_SECRET"];
    return typeof v === "string" && v.startsWith("whsec_") ? v : undefined;
  },
  get stripeProPriceId(): string | undefined {
    const v = process.env["STRIPE_PRO_PRICE_ID"];
    if (typeof v !== "string") return undefined;
    if (v.length < 6) return undefined;
    if (/replaceme|changeme|placeholder|your-|^xx/i.test(v)) return undefined;
    return v;
  },
  get stripePublishableKey(): string | undefined {
    const v = process.env["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"];
    if (typeof v !== "string") return undefined;
    if (!/^pk_(test|live)_/.test(v)) return undefined;
    return v;
  },
  get canonicalBaseUrl(): string {
    const v = process.env["NEXT_PUBLIC_APP_URL"] ?? process.env["APP_URL"];
    if (typeof v === "string" && v.length > 0) return v.replace(/\/$/, "");
    return "http://127.0.0.1:3000";
  },
};

export type BillingEnvStatus = {
  hasSecret: boolean;
  hasPublishable: boolean;
  hasWebhookSecret: boolean;
  hasProPrice: boolean;
};

export function getBillingEnvStatus(): BillingEnvStatus {
  return {
    hasSecret: !!SERVER_ENV.stripeSecret,
    hasPublishable: !!SERVER_ENV.stripePublishableKey,
    hasWebhookSecret: !!SERVER_ENV.stripeWebhookSecret,
    hasProPrice: !!SERVER_ENV.stripeProPriceId,
  };
}

let stripeCache: Stripe | null | undefined = undefined;
export function getStripeOrNull(): Stripe | null {
  if (stripeCache !== undefined) return stripeCache;
  const secret = SERVER_ENV.stripeSecret;
  if (!secret) {
    stripeCache = null;
    return null;
  }
  try {
    stripeCache = new Stripe(secret, {
      appInfo: { name: "velora-platform" },
      typescript: true,
    });
  } catch {
    stripeCache = null;
  }
  return stripeCache;
}

// §7 STATUS MAPPING (single source of truth).
// Conservativa: fail-safe to base.
export function providerStatusToPlanAndStatus(status: string | null | undefined): {
  effectivePlan: Exclude<PlanTier, "internal_test">;
  normalized: SubscriptionStatus;
  isCancelAtPeriodEnd: boolean;
} {
  const raw =
    typeof status === "string" ? (status.trim().toLowerCase() as SubscriptionStatus) : "unknown";
  const unknownSafe = (() => {
    const allowlist: SubscriptionStatus[] = [
      "active",
      "trialing",
      "incomplete",
      "incomplete_expired",
      "unpaid",
      "past_due",
      "canceled",
      "deleted",
      "ended",
      "paused",
      "unknown",
    ];
    return (allowlist as string[]).includes(raw) ? raw : "unknown";
  })();
  const active: boolean = unknownSafe === "active" || unknownSafe === "trialing";
  // unknown status -> fail-safe base.
  return {
    effectivePlan: active ? "pro" : "base",
    normalized: unknownSafe,
    isCancelAtPeriodEnd: false, // separate field from subscription.cancel_at_period_end
  };
}

// §7 UI/status label helpers.
export function describeSubscriptionStatus(
  s: SubscriptionStatus,
  cancelAtPeriodEnd: boolean,
): string {
  if (cancelAtPeriodEnd && (s === "active" || s === "trialing")) {
    return s === "trialing"
      ? "Trial con annullamento programmato"
      : "Attivo, annullamento programmato";
  }
  switch (s) {
    case "active":
      return "Attivo";
    case "trialing":
      return "Trial";
    case "incomplete":
      return "Pagamento incompleto";
    case "incomplete_expired":
      return "Pagamento scaduto";
    case "unpaid":
      return "Non pagato";
    case "past_due":
      return "Pagamento in ritardo";
    case "canceled":
    case "deleted":
    case "ended":
      return "Annullato / terminato";
    case "paused":
      return "Sospeso";
    case "unknown":
    default:
      return "Stato non disponibile";
  }
}

type AuthUserResult = Awaited<ReturnType<typeof getCurrentTenantContext>>;

function requireRoleForBilling(ctx: AuthUserResult, mode: "read" | "write"): void {
  if (!ctx.tenant || !ctx.membership) throw new Error("Billing: no tenant/membership");
  const role = ctx.membership.role;
  if (mode === "write") {
    if (role !== "owner") {
      throw new Error("Billing: write mutation requires owner role");
    }
  }
  // read: owner/manager/staff ok (STAFF: se consentito, almeno read).
  if (!(role === "owner" || role === "manager" || role === "staff")) {
    throw new Error("Billing: insufficient role");
  }
}

export type TenantBillingState = {
  tenantId: string;
  planId: PlanTier;
  planLimits: { maxServices: number | null; maxSections: number | null };
  env: BillingEnvStatus;
  customer: BillingCustomerRow | null;
  subscription: BillingSubscriptionRow | null;
  subscriptionStatusLabel: string;
  effectivePlan: Exclude<PlanTier, "internal_test">;
  canUpgrade: boolean;
  canManage: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

export async function getCurrentTenantBillingState(): Promise<TenantBillingState> {
  const ctx = await getCurrentTenantContext();
  requireRoleForBilling(ctx, "read");
  if (!ctx.tenant) throw new Error("Missing tenant context");
  const tenantId = ctx.tenant.id;
  const sb = getSupabaseServiceClient();

  const cust = await sb
    .from("billing_customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .limit(1)
    .maybeSingle();

  const sub = await sb
    .from("billing_subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .order("provider_created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const customer = cust.data as BillingCustomerRow | null;
  const subscription = sub.data as BillingSubscriptionRow | null;

  const map = providerStatusToPlanAndStatus(subscription?.status ?? null);
  const cancelAtPeriodEnd =
    !!subscription?.cancel_at_period_end &&
    (map.normalized === "active" || map.normalized === "trialing");
  const effPlan: Exclude<PlanTier, "internal_test"> =
    ctx.tenant.plan_id === "internal_test" ? "base" : map.effectivePlan;

  const planForLimits =
    ctx.tenant.plan_id === "pro"
      ? PLAN_CATALOG.pro
      : ctx.tenant.plan_id === "internal_test"
        ? PLAN_CATALOG.pro
        : PLAN_CATALOG.base;

  const role = ctx.membership!.role;
  const canManage = role === "owner" && !!customer && !!SERVER_ENV.stripeSecret;
  const canUpgrade =
    role === "owner" &&
    effPlan !== "pro" &&
    !!SERVER_ENV.stripeSecret &&
    !!SERVER_ENV.stripeProPriceId;

  return {
    tenantId,
    planId: (ctx.tenant.plan_id === "internal_test" ? "base" : ctx.tenant.plan_id) as PlanTier,
    planLimits: planForLimits.limits,
    env: getBillingEnvStatus(),
    customer,
    subscription,
    subscriptionStatusLabel: describeSubscriptionStatus(map.normalized, cancelAtPeriodEnd),
    effectivePlan: effPlan,
    canUpgrade,
    canManage,
    cancelAtPeriodEnd,
    currentPeriodEnd: subscription?.current_period_end ?? null,
  };
}

// ---- Canonical customer idempotent create ----
export async function getOrCreateCanonicalCustomer(
  tenantId: string,
  tenantDisplayName: string,
  ownerEmail: string,
): Promise<{ id: string; created: boolean }> {
  if (!tenantId) throw new Error("tenantId required");
  const sb = getSupabaseServiceClient();

  // Fast path: DB already canonical.
  const exists = await sb
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .limit(1)
    .maybeSingle();
  if (exists.error) throw exists.error;
  if (exists.data?.provider_customer_id)
    return { id: exists.data.provider_customer_id, created: false };

  const stripe = getStripeOrNull();
  if (!stripe) {
    throw new Error("Stripe not configured: cannot create billing customer");
  }

  // Race-safe create Stripe customer.
  const name = tenantDisplayName || `Tenant ${tenantId.slice(0, 8)}`;
  const stripeCust = await stripe.customers.create({
    email: ownerEmail,
    name: name.length <= 120 ? name : name.slice(0, 120),
    metadata: {
      tenant_id: tenantId,
      source: "velora-platform",
    },
  });

  const id = stripeCust.id;

  // DB insert race-safe UNIQUE(tenant_id, provider)
  try {
    const ins = await sb
      .from("billing_customers")
      .insert({
        tenant_id: tenantId,
        provider: PROVIDER,
        provider_customer_id: id,
      })
      .select("provider_customer_id")
      .maybeSingle();
    if (ins.error) throw ins.error;
    const finalId =
      (ins.data as { provider_customer_id: string } | null)?.provider_customer_id ?? null;
    if (!finalId) throw new Error("Failed to persist canonical billing customer");
    return { id: finalId, created: finalId === id };
  } catch {
    // Uniqueness race: another request inserted concurrently; recover by reading existing.
    const recover = await sb
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .limit(1)
      .maybeSingle();
    if (recover.error) throw recover.error;
    const finalId =
      (recover.data as { provider_customer_id: string } | null)?.provider_customer_id ?? null;
    if (!finalId) throw new Error("Failed to recover canonical billing customer");
    return { id: finalId, created: false };
  }
}

export type CreateCheckoutOptions = {
  tenantId: string;
  tenantDisplayName: string;
  ownerEmail: string;
  successPath?: string;
  cancelPath?: string;
};

// §4 createCheckoutSession: server-side price selection authoritative.
// internal_test NON è acquistabile (lanciata eccezione).
export async function createCheckoutSession(opts: CreateCheckoutOptions): Promise<{ url: string }> {
  const priceId = SERVER_ENV.stripeProPriceId;
  if (!priceId) {
    throw new Error("Stripe PRO price not configured");
  }
  if (!opts.tenantId) throw new Error("tenantId required");
  const stripe = getStripeOrNull();
  if (!stripe) throw new Error("Stripe not configured");

  const { id: customerId } = await getOrCreateCanonicalCustomer(
    opts.tenantId,
    opts.tenantDisplayName ?? "Tenant",
    opts.ownerEmail,
  );

  const base = SERVER_ENV.canonicalBaseUrl;
  const success_url = `${base}${opts.successPath ?? "/app/billing?checkout=success"}`;
  const cancel_url = `${base}${opts.cancelPath ?? "/app/billing?checkout=cancel"}`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url,
    cancel_url,
    metadata: {
      tenant_id: opts.tenantId,
      plan: "pro",
    },
    subscription_data: {
      metadata: {
        tenant_id: opts.tenantId,
        plan: "pro",
      },
    },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
  });

  // Audit: billing.checkout_created (service role).
  try {
    const a = getSupabaseServiceClient();
    await a.from("audit_logs").insert({
      tenant_id: opts.tenantId,
      actor_user_id: null,
      action: "billing.checkout_created",
      entity_type: "billing_checkout",
      entity_id: session.id ? session.id.slice(0, 32) : "n/a",
      metadata: {
        provider: PROVIDER,
        mode: "subscription",
      },
    });
  } catch {
    // audit failure: NON-ATOMIC BY DESIGN. We never break customer flow for audit write.
  }

  if (!session.url) throw new Error("Stripe did not return checkout url");
  return { url: session.url };
}

export type CreatePortalOptions = {
  tenantId: string;
  returnPath?: string;
};

// §15 createBillingPortalSession: owner only; customer_id derived server-side.
export async function createBillingPortalSession(
  opts: CreatePortalOptions,
): Promise<{ url: string }> {
  if (!opts.tenantId) throw new Error("tenantId required");
  const stripe = getStripeOrNull();
  if (!stripe) throw new Error("Stripe not configured");
  const sb = getSupabaseServiceClient();
  const cust = await sb
    .from("billing_customers")
    .select("provider_customer_id")
    .eq("tenant_id", opts.tenantId)
    .eq("provider", PROVIDER)
    .limit(1)
    .maybeSingle();
  if (cust.error) throw cust.error;
  const cid = cust.data?.provider_customer_id;
  if (!cid) throw new Error("No billing customer exists for this tenant");

  const return_url = `${SERVER_ENV.canonicalBaseUrl}${opts.returnPath ?? "/app/billing"}`;
  const portal = await stripe.billingPortal.sessions.create({
    customer: cid,
    return_url,
    locale: "auto",
  });
  return { url: portal.url };
}

// ---- Helpers per webhook (§6, §9). ----

export type StripeTenantAssociation = { tenant_id: string } | null;

export function resolveTenantFromStripeObject(obj: {
  metadata?: Record<string, string> | null;
}): StripeTenantAssociation {
  const raw = obj?.metadata?.["tenant_id"];
  if (!raw || typeof raw !== "string" || raw.length < 5) return null;
  // Fail-safe: reject any tenant_id not UUID-like (basic, no parse).
  if (!/^[0-9a-fA-F-]{30,}$/.test(raw)) return null;
  return { tenant_id: raw };
}

// §8 Idempotency ordering rule: newer event cannot be overwritten by older when
// both reference same subscription. Provider created_at monotonic (Stripe secures).
// Utility per test/ordering.
export function subscriptionIsNewerOrEqual(
  existing: {
    provider_created_at?: string | Date | null;
    provider_updated_at?: string | Date | null;
  },
  incoming: {
    provider_created_at?: string | Date | null;
    provider_updated_at?: string | Date | null;
  },
): boolean {
  const a = toMs(existing.provider_updated_at ?? existing.provider_created_at);
  const b = toMs(incoming.provider_updated_at ?? incoming.provider_created_at);
  return b >= a;
}

function toMs(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  const t = new Date(d as Date | string).getTime();
  return Number.isFinite(t) ? t : 0;
}
