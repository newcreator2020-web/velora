"use server";

import "server-only";
import { z } from "zod";
import {
  verifyBookingCancelToken,
  sendBookingCancelled,
  type EmailBookingContext,
} from "@/lib/server/email";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/supabase";

const CancelByTokenSchema = z.object({
  slug: z.string().min(1).max(80),
  token: z.string().min(16).max(800),
});

export type PublicCancelState =
  | { ok: true; kind: "CANCELLED"; cancelled_at: string }
  | { ok: true; kind: "ALREADY_CANCELLED"; cancelled_at: string | null }
  | {
      ok: false;
      code:
        | "TOKEN_INVALID"
        | "TOKEN_EXPIRED"
        | "NOT_FOUND"
        | "CROSS_TENANT"
        | "TOO_LATE"
        | "TERMINAL_STATE"
        | "VALIDATION"
        | "INTERNAL";
      message: string;
    };

type EmailJoinRow = Database["public"]["Tables"]["bookings"]["Row"] & {
  services: Pick<
    Database["public"]["Tables"]["services"]["Row"],
    "name" | "duration_minutes" | "price_from" | "currency"
  > | null;
  staff_resources: { display_name: string | null } | null;
  tenants: Pick<Database["public"]["Tables"]["tenants"]["Row"], "id" | "name" | "slug"> | null;
  business_profiles: Pick<
    Database["public"]["Tables"]["business_profiles"]["Row"],
    | "display_name"
    | "legal_name"
    | "theme_primary"
    | "address_line1"
    | "city"
    | "postal_code"
    | "province"
    | "country_code"
    | "timezone"
    | "email"
    | "phone"
  > | null;
};

function normalizeEmail(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

async function sendCancelledEmail(bookingId: string) {
  try {
    const svc = getSupabaseServiceClient();
    const rQ = await svc.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (rQ.error || !rQ.data) return;
    const booking = rQ.data as Database["public"]["Tables"]["bookings"]["Row"];
    const [svcRes, staffRes, tenantRes, bpRes] = await Promise.all([
      svc
        .from("services")
        .select("name, duration_minutes, price_from, currency")
        .eq("id", booking.service_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("staff_resources")
        .select("display_name")
        .eq("id", booking.resource_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("tenants")
        .select("id, name, slug")
        .eq("id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("business_profiles")
        .select(
          "display_name, legal_name, theme_primary, address_line1, city, postal_code, province, country_code, timezone, email, phone",
        )
        .eq("tenant_id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!tenantRes.data || !bpRes.data) return;
    const row: EmailJoinRow = {
      ...booking,
      services: svcRes.data ?? null,
      staff_resources: staffRes.data ?? null,
      tenants: tenantRes.data ?? null,
      business_profiles: bpRes.data ?? null,
    };
    if (!row.tenants || !row.business_profiles) return;
    const email = row.customer_email?.trim?.() ?? "";
    if (!email) return;
    const ctx: EmailBookingContext = {
      booking: row,
      customer: {
        display_name: row.customer_name ?? "Cliente",
        email,
        phone: row.customer_phone ?? null,
      },
      tenant: row.tenants,
      businessProfile: row.business_profiles,
    };
    void sendBookingCancelled(ctx);
  } catch {
    // email non bloccante
  }
}

export async function cancelBookingByTokenAction(
  raw: FormData | Record<string, unknown>,
): Promise<PublicCancelState> {
  const input: Record<string, unknown> =
    raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw;
  const parsed = CancelByTokenSchema.safeParse({ slug: input["slug"], token: input["token"] });
  if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Dati non validi." };

  const parsedSlug = slugSchema.safeParse(parsed.data.slug);
  if (!parsedSlug.success) return { ok: false, code: "VALIDATION", message: "Slug non valido." };

  const tenant = await resolvePublicTenant({ slug: parsedSlug.data });
  if (tenant._tag !== "Found")
    return { ok: false, code: "NOT_FOUND", message: "Attività non trovata." };
  const tenantId = tenant.tenantId;

  const payload = verifyBookingCancelToken(parsed.data.token);
  if (!payload) return { ok: false, code: "TOKEN_INVALID", message: "Link non valido o scaduto." };

  const svc = getSupabaseServiceClient();
  const bQ = await svc.from("bookings").select("*").eq("id", payload.booking_id).maybeSingle();
  if (bQ.error || !bQ.data)
    return { ok: false, code: "NOT_FOUND", message: "Prenotazione non trovata." };
  const booking = bQ.data as Database["public"]["Tables"]["bookings"]["Row"];

  if (booking.tenant_id !== tenantId)
    return { ok: false, code: "CROSS_TENANT", message: "Link non valido." };
  if (normalizeEmail(booking.customer_email) !== normalizeEmail(payload.sub)) {
    return { ok: false, code: "TOKEN_INVALID", message: "Link non valido." };
  }

  const TERMINAL = new Set(["completed", "no_show", "cancelled"]);
  if (TERMINAL.has(String(booking.status))) {
    const up: unknown = booking as unknown;
    const upRec = up as Record<string, unknown>;
    const updAt = typeof upRec["updated_at"] === "string" ? upRec["updated_at"] : null;
    return {
      ok: true,
      kind: booking.status === "cancelled" ? "ALREADY_CANCELLED" : "ALREADY_CANCELLED",
      cancelled_at: updAt as string | null,
    };
  }

  const startsAt = new Date(booking.starts_at).getTime();
  if (Number.isFinite(startsAt) && startsAt < Date.now()) {
    return {
      ok: false,
      code: "TOO_LATE",
      message: "Non è più possibile cancellare una prenotazione passata.",
    };
  }

  const upd = await svc
    .from("bookings")
    .update({ status: "cancelled" } as never)
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("updated_at")
    .maybeSingle();

  if (upd.error) {
    const msg = upd.error?.message ?? "Errore interno.";
    const errCode = (upd.error as unknown as { code?: string }).code;
    if (errCode === "23514" || msg.includes("trigger") || msg.includes("transition")) {
      const ref = await svc
        .from("bookings")
        .select("status,updated_at")
        .eq("id", booking.id)
        .maybeSingle();
      const refRec = ref.data as unknown as Record<string, unknown> | undefined;
      const s = typeof refRec?.["status"] === "string" ? refRec["status"] : "";
      if (s === "cancelled") {
        return {
          ok: true,
          kind: "ALREADY_CANCELLED",
          cancelled_at: typeof refRec?.["updated_at"] === "string" ? refRec["updated_at"] : null,
        };
      }
      return { ok: false, code: "TERMINAL_STATE", message: "Stato prenotazione non modificabile." };
    }
    return {
      ok: false,
      code: "INTERNAL",
      message: "Non siamo riusciti a cancellare la prenotazione. Riprova tra un minuto.",
    };
  }

  const updRow = upd.data as unknown as Record<string, unknown> | null | undefined;
  const cancelled_at =
    (typeof updRow?.["updated_at"] === "string" ? updRow["updated_at"] : null) ??
    new Date().toISOString();

  void sendCancelledEmail(booking.id);

  return { ok: true, kind: "CANCELLED", cancelled_at };
}
