"use server";

import "server-only";
import { z } from "zod";
import { requireTenantRole } from "@/lib/server/auth";
import {
  changeBookingStatus,
  updateCustomer,
  searchCustomers,
  getCustomerDetail,
  BOOKING_LEGAL_TRANSITIONS,
  BOOKING_STATUS,
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
  if (res.ok) return { ok: true as const, code: "OK" };
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

export { BOOKING_LEGAL_TRANSITIONS, BOOKING_STATUS };
export type { BookingStatus };
