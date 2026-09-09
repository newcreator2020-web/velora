"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenantRole } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyBookingStatusChanged } from "@/lib/server/booking-email-hooks";
import {
  changeBookingStatus,
  updateCustomer,
  searchCustomers,
  getCustomerDetail,
  type BookingStatus,
  type CustomerUpdateInput,
  type CustomerSearchInput,
} from "@/lib/server/customers";

const CancelSchema = z.object({
  booking_id: z.string().uuid(),
});

export async function cancelBookingAction(_prevState: unknown, form: FormData) {
  await requireTenantRole("manager");
  const parsed = CancelSchema.safeParse({ booking_id: form.get("booking_id")?.toString() });
  if (!parsed.success) {
    return { ok: false as const, error: "Dati non validi.", code: "VALIDATION_ERROR" };
  }
  const res = await changeBookingStatus({
    booking_id: parsed.data.booking_id,
    to_status: "cancelled",
  });
  if (res.ok) {
    notifyBookingStatusChanged({ booking_id: parsed.data.booking_id, to_status: "cancelled" });
    return { ok: true as const, code: "OK" };
  }
  return { ok: false as const, error: res.message, code: res.code };
}

export async function completeBookingAction(_prevState: unknown, form: FormData) {
  await requireTenantRole("manager");
  const parsed = CancelSchema.safeParse({ booking_id: form.get("booking_id")?.toString() });
  if (!parsed.success) {
    return { ok: false as const, error: "Dati non validi.", code: "VALIDATION_ERROR" };
  }
  const res = await changeBookingStatus({
    booking_id: parsed.data.booking_id,
    to_status: "completed",
  });
  if (res.ok) return { ok: true as const, code: "OK" };
  return { ok: false as const, error: res.message, code: res.code };
}

export async function noShowBookingAction(_prevState: unknown, form: FormData) {
  await requireTenantRole("manager");
  const parsed = CancelSchema.safeParse({ booking_id: form.get("booking_id")?.toString() });
  if (!parsed.success) {
    return { ok: false as const, error: "Dati non validi.", code: "VALIDATION_ERROR" };
  }
  const res = await changeBookingStatus({
    booking_id: parsed.data.booking_id,
    to_status: "no_show",
  });
  if (res.ok) return { ok: true as const, code: "OK" };
  return { ok: false as const, error: res.message, code: res.code };
}

export async function setBookingStatusAction(input: { booking_id: unknown; to_status: unknown }) {
  const res = await changeBookingStatus({
    booking_id: String(input.booking_id ?? ""),
    to_status: String(input.to_status ?? "") as BookingStatus,
  });
  if (res.ok) return { ok: true as const, code: "OK" };
  return { ok: false as const, error: res.message, code: res.code };
}

const CustomerUpdateActionSchema = z.object({
  customer_id: z.string().uuid(),
  display_name: z.string().min(1).max(120).optional(),
  email: z.string().max(254).optional().or(z.literal("")),
  phone: z.string().max(32).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export async function updateCustomerAction(_prevState: unknown, form: FormData) {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) raw[k] = v?.toString();
  const parsed = CustomerUpdateActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "Dati non validi.", code: "VALIDATION_ERROR" };
  }
  const res = await updateCustomer(parsed.data as CustomerUpdateInput);
  if (res.ok) return { ok: true as const, code: "OK" };
  return { ok: false as const, error: res.message, code: res.code };
}

export async function listCustomersAction(input: CustomerSearchInput) {
  return searchCustomers(input);
}

export async function getCustomerDetailAction(id: unknown) {
  return getCustomerDetail(id);
}

const ManualBookingSchema = z
  .object({
    customer_id: z.string().uuid().optional().or(z.literal("")),
    customer_name: z.string().min(1).max(120).optional().or(z.literal("")),
    customer_email: z.string().max(254).optional().or(z.literal("")),
    customer_phone: z.string().max(32).optional().or(z.literal("")),
    service_id: z.string().uuid(),
    starts_at: z.string().min(1),
    resource_slug: z.string().min(1),
    notes: z.string().max(500).optional().or(z.literal("")),
  })
  .refine(
    (d) => {
      if (d.customer_id && d.customer_id.length > 0) return true;
      if (!d.customer_name || d.customer_name.length === 0) return false;
      const hasEmail = d.customer_email && d.customer_email.trim().length > 0;
      const hasPhone = d.customer_phone && d.customer_phone.trim().length > 0;
      return hasEmail || hasPhone;
    },
    {
      message:
        "Seleziona un cliente esistente oppure inserisci nome e almeno uno tra email e telefono.",
    },
  );

type ManualBookingResult =
  | {
      ok: true;
      code: "OK";
      booking: {
        id: string;
        revision: number;
        resource_id: string | null;
        starts_at: string;
        ends_at: string;
      };
    }
  | { ok: false; code: string; error: string };

export async function manualBookingAction(
  _prevState: unknown,
  form: FormData,
): Promise<ManualBookingResult> {
  await requireTenantRole("staff");
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) raw[k] = v?.toString();
  const parsed = ManualBookingSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: firstIssue?.message ?? "Dati non validi.",
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  try {
    const r = await (
      supabase as unknown as {
        rpc: (
          n: string,
          a: Record<string, unknown>,
        ) => Promise<{ data?: unknown; error?: unknown }>;
      }
    ).rpc("dashboard_booking_manual_create", {
      p_customer_id: d.customer_id && d.customer_id.length > 0 ? d.customer_id : null,
      p_customer_name: d.customer_name ?? "",
      p_customer_email: d.customer_email ?? "",
      p_customer_phone: d.customer_phone ?? "",
      p_service_id: d.service_id,
      p_starts_at: d.starts_at,
      p_resource_slug: d.resource_slug,
      p_notes: d.notes && d.notes.length > 0 ? d.notes : null,
    });
    if (r.error) {
      const err = r.error as unknown as { code?: string; message?: string };
      return {
        ok: false,
        code: err.code ?? "RPC_ERROR",
        error: err.message ?? "Errore durante la creazione dell'appuntamento.",
      };
    }
    const arr = r.data as unknown[] | null;
    const row =
      (Array.isArray(arr) && arr.length > 0 ? (arr[0] as Record<string, unknown>) : null) ??
      (r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null) ??
      {};
    const code = String(row["code"] ?? "");
    const message = String(row["message"] ?? "");
    if (code !== "OK") {
      return { ok: false, code: code || "RPC_ERROR", error: message || "Creazione fallita." };
    }
    revalidatePath("/app/calendar");
    return {
      ok: true,
      code: "OK",
      booking: {
        id: String(row["booking_id"] ?? ""),
        revision: Number(row["revision"] ?? 0),
        resource_id: (row["resource_id"] as string | null) ?? null,
        starts_at: String(row["starts_at_out"] ?? d.starts_at),
        ends_at: String(row["ends_at_out"] ?? d.starts_at),
      },
    };
  } catch (e: unknown) {
    const err = (e ?? {}) as { message?: string; code?: string };
    return {
      ok: false,
      code: err.code ?? "INTERNAL",
      error: err.message ?? "Errore imprevisto.",
    };
  }
}

const RescheduleBookingSchema = z.object({
  booking_id: z.string().uuid(),
  expected_revision: z.coerce.number().int(),
  new_starts_at: z.string().optional().or(z.literal("")),
  new_resource_slug: z.string().optional().or(z.literal("")),
  new_service_id: z.string().uuid().optional().or(z.literal("")),
});

type RescheduleBookingResult =
  | {
      ok: true;
      code: "OK";
      booking?: {
        id: string;
        revision: number;
        resource_id: string | null;
        starts_at: string;
        ends_at: string;
      };
    }
  | { ok: false; code: string; error: string };

export async function rescheduleBookingAction(
  _prevState: unknown,
  form: FormData,
): Promise<RescheduleBookingResult> {
  await requireTenantRole("manager");
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) raw[k] = v?.toString();
  const parsed = RescheduleBookingSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: firstIssue?.message ?? "Dati non validi.",
    };
  }
  const d = parsed.data;
  const newStartsAt = d.new_starts_at && d.new_starts_at.length > 0 ? d.new_starts_at : null;
  const newResourceSlug =
    d.new_resource_slug && d.new_resource_slug.length > 0 && d.new_resource_slug !== "same"
      ? d.new_resource_slug
      : null;
  const newServiceId = d.new_service_id && d.new_service_id.length > 0 ? d.new_service_id : null;
  if (!newStartsAt && !newResourceSlug && !newServiceId) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Specifica almeno una modifica (data, operatore o servizio).",
    };
  }
  const supabase = await createSupabaseServerClient();
  try {
    const r = await (
      supabase as unknown as {
        rpc: (
          n: string,
          a: Record<string, unknown>,
        ) => Promise<{ data?: unknown; error?: unknown }>;
      }
    ).rpc("dashboard_booking_reschedule", {
      p_booking_id: d.booking_id,
      p_expected_revision: d.expected_revision,
      p_new_starts_at: newStartsAt,
      p_new_resource_slug: newResourceSlug,
      p_new_service_id: newServiceId,
    });
    if (r.error) {
      const err = r.error as unknown as { code?: string; message?: string };
      return {
        ok: false,
        code: err.code ?? "RPC_ERROR",
        error: err.message ?? "Errore durante lo spostamento dell'appuntamento.",
      };
    }
    const arr = r.data as unknown[] | null;
    const row =
      (Array.isArray(arr) && arr.length > 0 ? (arr[0] as Record<string, unknown>) : null) ??
      (r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null) ??
      {};
    const code = String(row["code"] ?? "");
    const message = String(row["message"] ?? "");
    if (code !== "OK") {
      return { ok: false, code: code || "RPC_ERROR", error: message || "Spostamento fallito." };
    }
    const bookingIdOut = String(row["booking_id_out"] ?? d.booking_id);
    notifyBookingStatusChanged({ booking_id: bookingIdOut, to_status: "rescheduled" });
    revalidatePath("/app/calendar");
    return {
      ok: true,
      code: "OK",
      booking: {
        id: String(row["booking_id_out"] ?? d.booking_id),
        revision: Number(row["revision_out"] ?? d.expected_revision + 1),
        resource_id: (row["resource_id_out"] as string | null) ?? null,
        starts_at: String(row["starts_at_out"] ?? ""),
        ends_at: String(row["ends_at_out"] ?? ""),
      },
    };
  } catch (e: unknown) {
    const err = (e ?? {}) as { message?: string; code?: string };
    return {
      ok: false,
      code: err.code ?? "INTERNAL",
      error: err.message ?? "Errore imprevisto.",
    };
  }
}

export async function searchCustomersAction(q: string) {
  return searchCustomers({ q } as CustomerSearchInput);
}
