"use server";
import "server-only";
import { redirect } from "next/navigation";
import { getCurrentTenantContext } from "@/lib/server/auth";
import {
  createCheckoutSession,
  createBillingPortalSession,
  type TenantBillingState,
  getCurrentTenantBillingState,
} from "@/lib/server/billing";

export type BillingActionStatus = "idle" | "checkout_pending" | "portal_pending" | "ok" | "error";

export type BillingActionResult = {
  status: BillingActionStatus;
  message: string;
  error?: string;
  state?: TenantBillingState;
};

export async function initialBillingResult(): Promise<BillingActionResult> {
  try {
    const state = await getCurrentTenantBillingState();
    return {
      status: "idle",
      message: "",
      state,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unable to load billing state";
    return {
      status: "error",
      message,
      error: message,
    };
  }
}

export async function createCheckoutAction(): Promise<BillingActionResult> {
  try {
    const ctx = await getCurrentTenantContext();
    if (!ctx.membership || ctx.membership.role !== "owner") {
      return { status: "error", message: "Solo il proprietario può avviare l'abbonamento" };
    }
    if (!ctx.tenant) return { status: "error", message: "Tenant non trovato" };
    if (!ctx.user) return { status: "error", message: "Autenticazione mancante" };
    if (ctx.tenant.plan_id === "internal_test") {
      return { status: "error", message: "Piano non acquistabile" };
    }

    const { url } = await createCheckoutSession({
      tenantId: ctx.tenant.id,
      tenantDisplayName: ctx.business_profile?.display_name ?? ctx.tenant.name ?? "Tenant",
      ownerEmail: ctx.user.auth_email,
      successPath: "/app/billing?checkout=success",
      cancelPath: "/app/billing?checkout=cancel",
    });
    redirect(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Impossibile creare la sessione di pagamento";
    return { status: "error", message, error: message };
  }
}

export async function createPortalAction(): Promise<BillingActionResult> {
  try {
    const ctx = await getCurrentTenantContext();
    if (!ctx.membership || ctx.membership.role !== "owner") {
      return { status: "error", message: "Solo il proprietario può gestire l'abbonamento" };
    }
    if (!ctx.tenant) return { status: "error", message: "Tenant non trovato" };
    const { url } = await createBillingPortalSession({
      tenantId: ctx.tenant.id,
      returnPath: "/app/billing",
    });
    redirect(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Impossibile aprire il portale abbonamento";
    return { status: "error", message, error: message };
  }
}
