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
import type { Database } from "@/types/supabase";

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
    "charge.refunded",
    "payment_intent.payment_failed",
  ]);
  if (!ALLOWED.has(type)) {
    return NextResponse.json({ ok: true, code: "IGNORED_EVENT", type });
  }

  // ===== HANDLER PRIORITARI: BOOKING PAYMENTS =====
  // Distinguiamo booking_deposit / refund dal flusso billing subscription.
  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const isBookingFlow =
        session.metadata?.["flow"] === "booking_deposit" ||
        (typeof session.metadata?.["booking_id"] === "string" &&
          session.metadata["booking_id"].length > 0);
      if (isBookingFlow) {
        return handleBookingCheckoutCompleted(stripe, session, providerEventId);
      }
    } else if (type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      return handleChargeRefunded(charge, providerEventId);
    } else if (type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return handlePaymentIntentFailed(pi, providerEventId);
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "PAYMENT_EVENT_EXCEPTION",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
  // ===== FINE HANDLER PRIORITARI =====

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

type PaymentAuditAction =
  | "booking.deposit_paid"
  | "booking.deposit_refunded"
  | "booking.deposit_partially_refunded"
  | "booking.payment_failed";

async function appendPaymentAudit(
  tenantId: string | null,
  bookingId: string | null,
  paymentId: string | null,
  action: PaymentAuditAction,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!tenantId) return;
  try {
    const sb = getSupabaseServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { provider_event_id, stripe_session_id, amount, currency, status } = meta as any;
    const clean: Record<string, unknown> = {};
    if (typeof provider_event_id === "string")
      clean["provider_event_id"] = provider_event_id.slice(0, 32);
    if (typeof stripe_session_id === "string")
      clean["stripe_session_id"] = stripe_session_id.slice(0, 32);
    if (typeof amount === "number") clean["amount"] = amount;
    if (typeof currency === "string") clean["currency"] = currency;
    if (typeof status === "string") clean["status"] = status;
    clean["provider"] = PROVIDER;
    clean["flow"] = "booking_deposit";
    await sb
      .from("audit_logs")
      .insert({
        tenant_id: tenantId,
        actor_user_id: null,
        action,
        entity_type: "booking_payment",
        entity_id: paymentId ? paymentId.slice(0, 64) : bookingId ? bookingId.slice(0, 64) : action,
        metadata: clean as never,
      })
      .then(() => {});
  } catch {
    // audit append failure: NON-ATOMIC BY DESIGN. We never drop webhook processing.
  }
}

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"] & {
  failure_reason?: string | null;
  failure_code?: string | null;
};
type BookingPaymentStatusExtended =
  Database["public"]["Tables"]["bookings"]["Row"]["payment_status"] | "failed" | "refunded";
type BookingRow = Omit<Database["public"]["Tables"]["bookings"]["Row"], "payment_status"> & {
  payment_status: BookingPaymentStatusExtended;
};

async function markPaymentEventIdempotency(
  sb: ReturnType<typeof getSupabaseServiceClient>,
  paymentId: string,
  providerEventId: string,
): Promise<{ idempotent: boolean }> {
  try {
    const up = await sb
      .from("payments")
      .update({ idempotency_key: providerEventId })
      .eq("id", paymentId)
      .is("idempotency_key", null)
      .select("id")
      .limit(1)
      .maybeSingle();
    if (up.error) {
      const msg = (up.error?.message ?? "").toLowerCase();
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return { idempotent: true };
      }
      throw up.error;
    }
    if (!up.data) {
      return { idempotent: true };
    }
    return { idempotent: false };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).toLowerCase();
    if (msg.includes("23505") || msg.includes("unique") || msg.includes("duplicate")) {
      return { idempotent: true };
    }
    throw e;
  }
}

async function handleBookingCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  providerEventId: string,
): Promise<Response> {
  const sb = getSupabaseServiceClient();
  const sessionId = session.id;
  const metaTenant = session.metadata?.["tenant_id"] ?? null;
  const metaBooking = session.metadata?.["booking_id"] ?? null;
  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const customerIdRaw =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  const customerId = typeof customerIdRaw === "string" ? customerIdRaw : null;

  const sessionAmountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const amount =
    sessionAmountTotal != null
      ? Math.round(sessionAmountTotal) / 100
      : Number(session.amount_subtotal ?? 0) / 100;
  const currency = (session.currency ?? "eur").toLowerCase();

  void stripe;
  const existing = await sb
    .from("payments")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_LOOKUP_FAILED", message: existing.error.message },
      { status: 500 },
    );
  }
  let payment: PaymentRow | null = (existing.data as PaymentRow | null) ?? null;

  if (!payment) {
    if (!metaTenant) {
      return NextResponse.json({ ok: true, code: "NO_TENANT_IN_PAYMENT_METADATA" });
    }
    const insert = await sb
      .from("payments")
      .insert({
        tenant_id: metaTenant,
        booking_id: metaBooking,
        stripe_session_id: sessionId,
        stripe_payment_intent_id: piId,
        stripe_customer_id: customerId,
        amount,
        currency,
        status: "paid",
        idempotency_key: providerEventId,
      })
      .select("*")
      .limit(1)
      .maybeSingle();
    if (insert.error) {
      const msg = String(insert.error.message).toLowerCase();
      if (msg.includes("23505") || msg.includes("unique") || msg.includes("duplicate")) {
        return NextResponse.json({
          ok: true,
          code: "IDEMPOTENT_DUPLICATE",
          idempotent: true,
        });
      }
      return NextResponse.json(
        { ok: false, code: "PAYMENT_INSERT_FAILED", message: insert.error.message },
        { status: 500 },
      );
    }
    payment = (insert.data as PaymentRow | null) ?? null;
  }

  if (!payment) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_ROW_MISSING", message: "Unable to resolve payment row" },
      { status: 500 },
    );
  }

  if (payment.status === "paid") {
    return NextResponse.json({
      ok: true,
      code: "ALREADY_PAID_IDEMPOTENT",
      idempotent: true,
      payment_id: payment.id,
    });
  }

  const idem = await markPaymentEventIdempotency(sb, payment.id, providerEventId);
  if (idem.idempotent) {
    return NextResponse.json({
      ok: true,
      code: "IDEMPOTENT_DUPLICATE",
      idempotent: true,
      payment_id: payment.id,
    });
  }

  const update = await sb
    .from("payments")
    .update({
      status: "paid",
      stripe_payment_intent_id: piId ?? payment.stripe_payment_intent_id,
      stripe_customer_id: customerId ?? payment.stripe_customer_id,
    })
    .eq("id", payment.id);
  if (update.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_UPDATE_FAILED", message: update.error.message },
      { status: 500 },
    );
  }

  const bookingId = payment.booking_id ?? metaBooking;
  const tenantId = payment.tenant_id;
  let newBookingStatus: "unpaid" | "deposit_paid" | "paid" = "deposit_paid";
  if (bookingId) {
    const bk = await sb
      .from("bookings")
      .select("id, deposit_amount, service_id")
      .eq("id", bookingId)
      .limit(1)
      .maybeSingle();
    if (bk.data) {
      const booking = bk.data as BookingRow;
      const svc = booking.service_id
        ? await sb
            .from("services")
            .select("id, deposit_strategy, deposit_value, price_from, currency")
            .eq("id", booking.service_id)
            .limit(1)
            .maybeSingle()
        : null;
      const priceFrom = (svc?.data as { price_from: number | null } | null)?.price_from ?? null;
      const fullAmount = priceFrom != null && Number.isFinite(priceFrom) ? Number(priceFrom) : null;
      const dep =
        booking.deposit_amount != null && Number.isFinite(booking.deposit_amount)
          ? Number(booking.deposit_amount)
          : amount;
      if (fullAmount != null && Math.abs(amount - fullAmount) < 0.005) {
        newBookingStatus = "paid";
      } else if (dep > 0 && Math.abs(amount - dep) < 0.005) {
        newBookingStatus = "deposit_paid";
      } else {
        newBookingStatus = "deposit_paid";
      }
      const depAmtToSave =
        booking.deposit_amount != null && Number.isFinite(booking.deposit_amount)
          ? booking.deposit_amount
          : amount;
      await sb
        .from("bookings")
        .update({
          payment_status: newBookingStatus,
          deposit_amount: depAmtToSave,
        })
        .eq("id", bookingId)
        .throwOnError();
    } else {
      await sb
        .from("bookings")
        .update({
          payment_status: newBookingStatus,
          deposit_amount: amount,
        })
        .eq("id", bookingId)
        .throwOnError();
    }
  }

  void appendPaymentAudit(tenantId, bookingId, payment.id, "booking.deposit_paid", {
    provider_event_id: providerEventId,
    stripe_session_id: sessionId,
    amount,
    currency,
    status: newBookingStatus,
  });

  return NextResponse.json({
    ok: true,
    code: "BOOKING_DEPOSIT_PAID",
    idempotent: false,
    payment_id: payment.id,
    booking_id: bookingId,
    booking_payment_status: newBookingStatus,
  });
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  providerEventId: string,
): Promise<Response> {
  const sb = getSupabaseServiceClient();
  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : (charge.payment_intent?.id ?? null);
  if (!piId) {
    return NextResponse.json({ ok: true, code: "NO_PAYMENT_INTENT_IN_CHARGE" });
  }
  const q = await sb
    .from("payments")
    .select("*")
    .eq("stripe_payment_intent_id", piId)
    .limit(1)
    .maybeSingle();
  if (q.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_LOOKUP_FAILED", message: q.error.message },
      { status: 500 },
    );
  }
  const payment: PaymentRow | null = (q.data as PaymentRow | null) ?? null;
  if (!payment) {
    return NextResponse.json({ ok: true, code: "PAYMENT_NOT_FOUND_BY_PI" });
  }
  if (payment.status === "refunded" || payment.status === "partially_refunded") {
    const idemCheck = await markPaymentEventIdempotency(sb, payment.id, providerEventId);
    if (idemCheck.idempotent) {
      return NextResponse.json({
        ok: true,
        code: "IDEMPOTENT_DUPLICATE",
        idempotent: true,
        payment_id: payment.id,
      });
    }
  }
  const idem = await markPaymentEventIdempotency(sb, payment.id, providerEventId);
  if (idem.idempotent) {
    return NextResponse.json({
      ok: true,
      code: "IDEMPOTENT_DUPLICATE",
      idempotent: true,
      payment_id: payment.id,
    });
  }
  const refundedCents = typeof charge.amount_refunded === "number" ? charge.amount_refunded : 0;
  const totalCents = typeof charge.amount === "number" ? charge.amount : 0;
  const refundedAmount = Math.round(refundedCents) / 100;
  const fullyRefunded = totalCents > 0 && refundedCents >= totalCents && charge.refunded === true;
  const newStatus: "refunded" | "partially_refunded" = fullyRefunded
    ? "refunded"
    : "partially_refunded";
  const up = await sb.from("payments").update({ status: newStatus }).eq("id", payment.id);
  if (up.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_UPDATE_FAILED", message: up.error.message },
      { status: 500 },
    );
  }
  const bookingId = payment.booking_id;
  const tenantId = payment.tenant_id;
  if (bookingId) {
    await sb
      .from("bookings")
      .update({ payment_status: "unpaid" })
      .eq("id", bookingId)
      .throwOnError();
  }
  const action: "booking.deposit_refunded" | "booking.deposit_partially_refunded" = fullyRefunded
    ? "booking.deposit_refunded"
    : "booking.deposit_partially_refunded";
  void appendPaymentAudit(tenantId, bookingId, payment.id, action, {
    provider_event_id: providerEventId,
    stripe_session_id: payment.stripe_session_id,
    amount: refundedAmount,
    currency: payment.currency,
    status: newStatus,
    fully_refunded: fullyRefunded,
  });
  return NextResponse.json({
    ok: true,
    code: fullyRefunded ? "BOOKING_DEPOSIT_REFUNDED" : "BOOKING_DEPOSIT_PARTIALLY_REFUNDED",
    idempotent: false,
    payment_id: payment.id,
    booking_id: bookingId,
    refund_status: newStatus,
  });
}

async function handlePaymentIntentFailed(
  pi: Stripe.PaymentIntent,
  providerEventId: string,
): Promise<Response> {
  const sb = getSupabaseServiceClient();
  const piId =
    typeof pi === "string" || pi == null ? null : typeof pi.id === "string" ? pi.id : null;
  if (!piId) {
    return NextResponse.json({ ok: true, code: "NO_PAYMENT_INTENT_ID" });
  }
  const q = await sb
    .from("payments")
    .select("*")
    .eq("stripe_payment_intent_id", piId)
    .limit(1)
    .maybeSingle();
  if (q.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_LOOKUP_FAILED", message: q.error.message },
      { status: 500 },
    );
  }
  const payment: PaymentRow | null = (q.data as PaymentRow | null) ?? null;
  if (!payment) {
    return NextResponse.json({ ok: true, code: "PAYMENT_NOT_FOUND_BY_PI" });
  }
  if (payment.status === "failed" || payment.status === "disputed") {
    const idemCheck = await markPaymentEventIdempotency(sb, payment.id, providerEventId);
    if (idemCheck.idempotent) {
      return NextResponse.json({
        ok: true,
        code: "IDEMPOTENT_DUPLICATE",
        idempotent: true,
        payment_id: payment.id,
      });
    }
  }
  const idem = await markPaymentEventIdempotency(sb, payment.id, providerEventId);
  if (idem.idempotent) {
    return NextResponse.json({
      ok: true,
      code: "IDEMPOTENT_DUPLICATE",
      idempotent: true,
      payment_id: payment.id,
    });
  }
  const lastPiError =
    typeof pi.last_payment_error?.message === "string" && pi.last_payment_error.message.length > 0
      ? pi.last_payment_error.message.slice(0, 240)
      : null;
  const failureCode =
    typeof pi.last_payment_error?.code === "string"
      ? pi.last_payment_error.code.slice(0, 64)
      : null;
  const paymentUpdate = {
    status: "failed" as const,
    failure_reason: lastPiError,
    failure_code: failureCode,
  };
  const up = await sb
    .from("payments")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tipi Supabase non ancora rigenerati dopo migration #93 (failure_reason/failure_code)
    .update(paymentUpdate as any)
    .eq("id", payment.id);
  if (up.error) {
    return NextResponse.json(
      { ok: false, code: "PAYMENT_UPDATE_FAILED", message: up.error.message },
      { status: 500 },
    );
  }
  const bookingId = payment.booking_id;
  const tenantId = payment.tenant_id;
  if (bookingId) {
    const bookingUpdate = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tipi Supabase non ancora rigenerati dopo migration #93 (enum 'failed' aggiunto)
      payment_status: "failed" as any,
    };
    await sb.from("bookings").update(bookingUpdate).eq("id", bookingId).throwOnError();
  }
  void appendPaymentAudit(tenantId, bookingId, payment.id, "booking.payment_failed", {
    provider_event_id: providerEventId,
    stripe_session_id: payment.stripe_session_id,
    stripe_payment_intent_id: piId,
    amount: payment.amount,
    currency: payment.currency,
    status: "failed",
    failure_reason: lastPiError,
    failure_code: failureCode,
  });
  return NextResponse.json({
    ok: true,
    code: "BOOKING_DEPOSIT_FAILED",
    idempotent: false,
    payment_id: payment.id,
    booking_id: bookingId,
    booking_payment_status: "failed",
  });
}
