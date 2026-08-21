import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  getStripeOrNull,
  providerStatusToPlanAndStatus,
  resolveTenantFromStripeObject,
  getBillingEnvStatus,
} from "@/lib/server/billing";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "auto";

const PROVIDER = "stripe";

type SubscriptionRowInsert = {
  tenant_id: string;
  provider: "stripe";
  provider_customer_id: string;
  provider_subscription_id: string;
  provider_price_id: string;
  status: string;
  provider_created_at: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  ended_at?: string | null;
};

async function extractSubscriptionFromCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<Stripe.Subscription | null> {
  const subId = session.subscription;
  if (!subId) return null;
  if (typeof subId === "string") {
    try {
      return await stripe.subscriptions.retrieve(subId, { expand: ["customer"] });
    } catch {
      return null;
    }
  }
  return subId as unknown as Stripe.Subscription;
}

function customerIdFromAny(c: unknown): string | null {
  if (!c) return null;
  if (typeof c === "string") return c;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof c === "object" && c !== null && "id" in (c as any)) {
    return (c as { id?: string }).id ?? null;
  }
  return null;
}

function secondsToIso(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  try {
    return new Date(v * 1000).toISOString();
  } catch {
    return null;
  }
}

function buildSubscriptionInsertFromStripe(
  tenantId: string,
  sub: Stripe.Subscription,
): SubscriptionRowInsert {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sub as any;
  const providerCreated = secondsToIso(s.created);
  const firstPrice = s.items?.data?.[0]?.price?.id ?? s.items?.data?.[0]?.plan?.id ?? "unknown";
  return {
    tenant_id: tenantId,
    provider: PROVIDER,
    provider_customer_id: customerIdFromAny(s.customer) ?? "unknown",
    provider_subscription_id: String(s.id ?? ""),
    provider_price_id: firstPrice,
    status: String(s.status ?? "unknown"),
    provider_created_at: providerCreated ?? new Date().toISOString(),
    current_period_start: secondsToIso(s.current_period_start),
    current_period_end: secondsToIso(s.current_period_end),
    cancel_at_period_end: !!s.cancel_at_period_end,
    ended_at: secondsToIso(s.ended_at),
  };
}

async function upsertBillingCustomer(tenantId: string, providerCustomerId: string): Promise<void> {
  const sb = getSupabaseServiceClient();
  const existing = await sb
    .from("billing_customers")
    .select("tenant_id")
    .eq("provider", PROVIDER)
    .eq("provider_customer_id", providerCustomerId)
    .limit(1)
    .maybeSingle();
  if (existing.data) {
    // Tenant invariant: lo stesso customer non può migrare tra tenants diversi.
    if (existing.data.tenant_id !== tenantId) {
      throw new Error("Billing customer tenant mismatch");
    }
    return;
  }
  await sb
    .from("billing_customers")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      provider_customer_id: providerCustomerId,
    })
    .throwOnError();
}

async function upsertBillingSubscription(row: SubscriptionRowInsert): Promise<void> {
  const sb = getSupabaseServiceClient();
  const existing = await sb
    .from("billing_subscriptions")
    .select("tenant_id, provider_subscription_id")
    .eq("provider", PROVIDER)
    .eq("provider_subscription_id", row.provider_subscription_id)
    .limit(1)
    .maybeSingle();
  if (!existing.data) {
    await sb.from("billing_subscriptions").insert(row).throwOnError();
    return;
  }
  if (existing.data.tenant_id !== row.tenant_id) {
    throw new Error("Subscription tenant mismatch");
  }
  await sb
    .from("billing_subscriptions")
    .update({
      status: row.status,
      current_period_start: row.current_period_start ?? null,
      current_period_end: row.current_period_end ?? null,
      cancel_at_period_end: row.cancel_at_period_end,
      ended_at: row.ended_at ?? null,
      provider_price_id: row.provider_price_id,
      provider_created_at: row.provider_created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", PROVIDER)
    .eq("provider_subscription_id", row.provider_subscription_id)
    .throwOnError();
}

type BillingAuditAction =
  | "billing.checkout_created"
  | "billing.subscription_activated"
  | "billing.subscription_updated"
  | "billing.subscription_cancel_scheduled"
  | "billing.subscription_ended";

async function appendAudit(
  tenantId: string | null,
  action: BillingAuditAction,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!tenantId) return;
  try {
    const sb = getSupabaseServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { provider_event_id, provider_subscription_id, status, old_plan, new_plan } = meta as any;
    const clean: Record<string, unknown> = {};
    if (typeof provider_event_id === "string")
      clean["provider_event_id"] = provider_event_id.slice(0, 32);
    if (typeof provider_subscription_id === "string")
      clean["provider_subscription_id"] = provider_subscription_id.slice(0, 32);
    if (typeof status === "string") clean["status"] = status.slice(0, 32);
    if (typeof old_plan === "string") clean["old_plan"] = old_plan;
    if (typeof new_plan === "string") clean["new_plan"] = new_plan;
    clean["provider"] = PROVIDER;
    await sb
      .from("audit_logs")
      .insert({
        tenant_id: tenantId,
        actor_user_id: null,
        action,
        entity_type: "billing_subscription",
        entity_id:
          typeof provider_subscription_id === "string"
            ? provider_subscription_id.slice(0, 64)
            : action,
        metadata:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clean as any,
      })
      .then(() => {});
  } catch {
    // audit append failure: NON-ATOMIC BY DESIGN. We never drop webhook processing.
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const env = getBillingEnvStatus();
  const stripe = getStripeOrNull();
  // Anche se env manca: restituiamo errore strutturato (non 200 con side effect).
  if (!env.hasWebhookSecret || !stripe) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: "Stripe webhook or secret not available",
      },
      { status: 503 },
    );
  }
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!signature) {
    return NextResponse.json(
      { ok: false, code: "MISSING_SIGNATURE", message: "Stripe-Signature header missing" },
      { status: 400 },
    );
  }

  let payload: string;
  try {
    payload = await req.text();
  } catch {
    return NextResponse.json({ ok: false, code: "BODY_READ_FAILED" }, { status: 400 });
  }
  if (!payload || payload.length === 0) {
    return NextResponse.json({ ok: false, code: "EMPTY_BODY" }, { status: 400 });
  }

  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"]!;
  let event: Stripe.Event;
  try {
    // Official SDK verification (synchronous with tolerance).
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret, undefined);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_SIGNATURE",
        message: e instanceof Error ? e.message : "signature verify failed",
      },
      { status: 401 },
    );
  }

  const providerEventId = event.id;
  const providerCreated = new Date(event.created * 1000).toISOString();
  const type = event.type;

  // §8 Idempotenza: early check only. Duplicate event → idempotent 200 without any mutation.
  // L'insert definitivo e' delegato alla RPC trusted per evitare doppia transition.
  try {
    const sb = getSupabaseServiceClient();
    const already = await sb
      .from("billing_webhook_events")
      .select("provider_event_id", { head: true, count: "exact" })
      .eq("provider", PROVIDER)
      .eq("provider_event_id", providerEventId);
    if ((already.count ?? 0) > 0) {
      return NextResponse.json({
        ok: true,
        code: "DUPLICATE_EVENT",
        idempotent: true,
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "EVENT_RECORD_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // Scope permessi eventi.
  const ALLOWED = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ]);
  if (!ALLOWED.has(type)) {
    return NextResponse.json({ ok: true, code: "IGNORED_EVENT", type });
  }

  // eslint-disable-next-line no-useless-assignment
  let subscription: Stripe.Subscription | null = null;
  // eslint-disable-next-line no-useless-assignment
  let rawTenant: { tenant_id: string } | null = null;
  // eslint-disable-next-line no-useless-assignment
  let auditAction: BillingAuditAction = "billing.subscription_updated";
  // eslint-disable-next-line no-useless-assignment
  let providerCustomerId: string | null = null;

  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      subscription = await extractSubscriptionFromCheckout(stripe, session);
      if (!subscription) {
        return NextResponse.json({ ok: true, code: "NO_SUBSCRIPTION_YET" });
      }
      auditAction = "billing.subscription_activated";
      const custObj =
        (subscription.customer as
          { id: string; metadata?: Record<string, string> | null } | null | undefined) ?? null;
      rawTenant =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolveTenantFromStripeObject(session as any) ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolveTenantFromStripeObject(subscription as any) ??
        (custObj?.metadata ? resolveTenantFromStripeObject({ metadata: custObj.metadata }) : null);
      providerCustomerId = customerIdFromAny(subscription.customer);
    } else {
      subscription = event.data.object as Stripe.Subscription;
      auditAction =
        type === "customer.subscription.deleted"
          ? "billing.subscription_ended"
          : type === "customer.subscription.created"
            ? "billing.subscription_activated"
            : subscription.cancel_at_period_end && subscription.status === "active"
              ? "billing.subscription_cancel_scheduled"
              : "billing.subscription_updated";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawTenant = resolveTenantFromStripeObject(subscription as any);
      providerCustomerId = customerIdFromAny(subscription.customer);
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "EVENT_PARSE_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    );
  }

  // Fallback: resolve tenant da DB billing_customers se metadata mancante (sicuro per customer binding).
  let tenantId: string | null = rawTenant?.tenant_id ?? null;
  if (!tenantId && providerCustomerId) {
    try {
      const sb = getSupabaseServiceClient();
      const cust = await sb
        .from("billing_customers")
        .select("tenant_id")
        .eq("provider", PROVIDER)
        .eq("provider_customer_id", providerCustomerId)
        .limit(1)
        .maybeSingle();
      tenantId = cust.data?.tenant_id ?? null;
    } catch {
      tenantId = null;
    }
  }
  if (!tenantId || !subscription) {
    // FAIL-SAFE: no tenant chosen fallback.
    void appendAudit(null, auditAction, {
      provider_event_id: providerEventId,
      provider_subscription_id: subscription?.id,
      status: subscription?.status,
      old_plan: null,
      new_plan: null,
      failed: "NO_TENANT_RESOLVED",
    });
    return NextResponse.json({ ok: true, code: "NO_TENANT_ASSOCIATION" });
  }

  // 1. Billing customer bind.
  try {
    if (providerCustomerId) await upsertBillingCustomer(tenantId, providerCustomerId);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "CUSTOMER_BIND_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const row = buildSubscriptionInsertFromStripe(tenantId, subscription);
  try {
    await upsertBillingSubscription(row);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "SUBSCRIPTION_UPSERT_FAILED",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // Determina piano commerciale (conservativo).
  const { effectivePlan } = providerStatusToPlanAndStatus(row.status);
  const targetPlan: "base" | "pro" = effectivePlan === "pro" ? "pro" : "base";

  // Esegue trusted plan transition via service_role RPC (solo service_role puo' eseguire).
  let oldPlan: string | null = null;
  let newPlan: string | null = null;
  let transitionCode: string = "NOT_RUN";
  try {
    const sb = getSupabaseServiceClient();
    const r = await sb.rpc("billing_apply_subscription_plan", {
      p_tenant_id: tenantId,
      p_target_plan: targetPlan,
      p_provider_event_id: providerEventId,
      p_provider_subscription_id: row.provider_subscription_id,
      p_provider_event_created_at: providerCreated,
    });
    if (r.error) {
      return NextResponse.json(
        { ok: false, code: "PLAN_TRANSITION_FAILED", message: r.error.message },
        { status: 500 },
      );
    }
    const arr = r.data as Array<{ code: string; old_plan?: string; new_plan?: string }> | null;
    if (arr && Array.isArray(arr) && arr[0]) {
      transitionCode = arr[0].code;
      oldPlan = arr[0].old_plan ?? null;
      newPlan = arr[0].new_plan ?? null;
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "PLAN_TRANSITION_EXCEPTION",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  void appendAudit(tenantId, auditAction, {
    provider_event_id: providerEventId,
    provider_subscription_id: row.provider_subscription_id,
    status: row.status,
    old_plan: oldPlan,
    new_plan: newPlan,
    transition_code: transitionCode,
    transitioned_at: providerCreated,
  });

  return NextResponse.json({
    ok: true,
    code: transitionCode,
    type,
    old_plan: oldPlan,
    new_plan: newPlan,
  });
}
