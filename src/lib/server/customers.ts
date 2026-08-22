import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantRole } from "@/lib/server/auth";
import type { Database } from "@/types/supabase";

export const BOOKING_STATUS = ["confirmed", "completed", "no_show", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const BOOKING_LEGAL_TRANSITIONS: Record<BookingStatus, ReadonlyArray<BookingStatus>> = {
  confirmed: ["cancelled", "completed", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const CUSTOMER_NOTES_MAX = 2000;
export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_PAGE_SIZE_MAX = 100;
export const BOOKING_PAGE_SIZE = 50;
export const BOOKING_PAGE_SIZE_MAX = 200;

export const CustomerSearchSchema = z.object({
  q: z.string().max(120).optional().or(z.literal("")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(CUSTOMER_PAGE_SIZE_MAX).default(CUSTOMER_PAGE_SIZE),
});

export type CustomerSearchInput = z.infer<typeof CustomerSearchSchema>;

export const CustomerUpdateSchema = z.object({
  customer_id: z.string().uuid(),
  display_name: z.string().min(1).max(120).optional(),
  email: z
    .string()
    .email()
    .max(254)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
  phone: z
    .string()
    .regex(/^[0-9+\s()-]{4,32}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
  notes: z
    .string()
    .max(CUSTOMER_NOTES_MAX)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? null : v)),
});

export type CustomerUpdateInput = z.infer<typeof CustomerUpdateSchema>;

export const BookingStatusChangeSchema = z.object({
  booking_id: z.string().uuid(),
  to_status: z.enum(BOOKING_STATUS),
});

export type BookingStatusChangeInput = z.infer<typeof BookingStatusChangeSchema>;

export type CustomerResultCode =
  | "OK"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type CustomerListResult =
  | {
      ok: true;
      code: "OK";
      items: Array<CustomerRowVM>;
      total: number;
      page: number;
      pageSize: number;
    }
  | { ok: false; code: Exclude<CustomerResultCode, "OK" | "INVALID_TRANSITION">; message: string };

export type CustomerRowVM = Database["public"]["Tables"]["customers"]["Row"] & {
  booking_count: number;
};

export type CustomerDetailVM = CustomerRowVM & {
  bookings: Array<
    Database["public"]["Tables"]["bookings"]["Row"] & {
      services: { name: string; duration_minutes: number | null } | null;
    }
  >;
};

export type CustomerUpdateResult =
  | { ok: true; code: "OK"; customer: Database["public"]["Tables"]["customers"]["Row"] }
  | { ok: false; code: Exclude<CustomerResultCode, "OK" | "INVALID_TRANSITION">; message: string };

export type BookingStatusChangeResult =
  | { ok: true; code: "OK"; booking_id: string; to_status: BookingStatus }
  | { ok: false; code: CustomerResultCode; message: string };

export async function searchCustomers(raw: CustomerSearchInput): Promise<CustomerListResult> {
  const ctx = await requireTenantRole("staff");
  const parsed = CustomerSearchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Parametri non validi." };
  }
  const tenantId = ctx.tenant.id;
  const supabase = await createSupabaseServerClient();
  const { q, page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;

  const qNorm = q ? q.trim().toLowerCase() : "";
  const emailNorm = qNorm && qNorm.includes("@") ? qNorm : null;
  const phoneNorm = qNorm ? qNorm.replace(/[^0-9]/g, "") : null;

  let query = supabase
    .from("customers")
    .select(
      "id,tenant_id,display_name,email,phone,notes,last_booking_at,created_at,updated_at,email_normalized,phone_normalized",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    .order("last_booking_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (qNorm.length > 0) {
    if (emailNorm) {
      query = query.eq("email_normalized", emailNorm);
    } else if (phoneNorm && phoneNorm.length >= 4) {
      query = query.eq("phone_normalized", phoneNorm);
    } else {
      query = query.ilike("display_name", `%${qNorm}%`);
    }
  }

  const { data, count, error } = await query.range(offset, offset + pageSize - 1);
  if (error) {
    return { ok: false, code: "INTERNAL_ERROR", message: "Caricamento clienti fallito." };
  }

  const rows = (data ?? []) as Array<Database["public"]["Tables"]["customers"]["Row"]>;
  const ids = rows.map((r) => r.id);
  const countsMap: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: bkData, error: bkErr } = await supabase
      .from("bookings")
      .select("customer_id,id")
      .eq("tenant_id", tenantId)
      .in("customer_id", ids);
    if (!bkErr && bkData) {
      for (const b of bkData) {
        if (b.customer_id) countsMap[b.customer_id] = (countsMap[b.customer_id] ?? 0) + 1;
      }
    }
  }
  const items: Array<CustomerRowVM> = rows.map((r) => ({
    ...r,
    booking_count: countsMap[r.id] ?? 0,
  }));
  return {
    ok: true,
    code: "OK",
    items,
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getCustomerDetail(customerIdRaw: unknown): Promise<
  | { ok: true; code: "OK"; customer: CustomerDetailVM }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR" | "VALIDATION_ERROR";
      message: string;
    }
> {
  const ctx = await requireTenantRole("staff");
  const idParsed = z.string().uuid().safeParse(customerIdRaw);
  if (!idParsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Cliente non valido." };
  }
  const tenantId = ctx.tenant.id;
  const supabase = await createSupabaseServerClient();
  const { data: cust, error: cErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", idParsed.data)
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  if (cErr) return { ok: false, code: "INTERNAL_ERROR", message: "Errore caricamento cliente." };
  if (!cust) return { ok: false, code: "NOT_FOUND", message: "Cliente inesistente." };

  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("*,services!bookings_service_id_fkey(name,duration_minutes)")
    .eq("tenant_id", tenantId)
    .eq("customer_id", cust.id)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (bErr) return { ok: false, code: "INTERNAL_ERROR", message: "Errore storico appuntamenti." };

  const booking_count = bookings?.length ?? 0;
  return {
    ok: true,
    code: "OK",
    customer: {
      ...cust,
      booking_count,
      bookings: (bookings ?? []) as CustomerDetailVM["bookings"],
    },
  };
}

export async function updateCustomer(raw: CustomerUpdateInput): Promise<CustomerUpdateResult> {
  const ctx = await requireTenantRole("manager");
  const parsed = CustomerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Dati non validi." };
  }
  const { customer_id, ...updates } = parsed.data;
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(updates) as Array<keyof typeof updates>) {
    const v = updates[k];
    if (v === undefined) continue;
    payload[k] = v;
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Nessuna modifica richiesta." };
  }
  const tenantId = ctx.tenant.id;
  const supabase = await createSupabaseServerClient();
  const { data: before, error: bErr } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customer_id)
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  if (bErr) return { ok: false, code: "INTERNAL_ERROR", message: "Errore verifica cliente." };
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Cliente inesistente." };

  const { data: after, error } = await supabase
    .from("customers")
    .update(payload as Partial<Database["public"]["Tables"]["customers"]["Update"]>)
    .eq("id", customer_id)
    .eq("tenant_id", tenantId)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) {
    const c = (error as { code?: string } | undefined)?.code ?? "";
    if (c === "42501") return { ok: false, code: "FORBIDDEN", message: "Non autorizzato." };
    if (c === "23505") return { ok: false, code: "CONFLICT", message: "Dati in conflitto." };
    return { ok: false, code: "INTERNAL_ERROR", message: "Salvataggio fallito." };
  }
  if (!after)
    return { ok: false, code: "NOT_FOUND", message: "Cliente non trovato dopo salvataggio." };
  return {
    ok: true,
    code: "OK",
    customer: after as Database["public"]["Tables"]["customers"]["Row"],
  };
}

export async function changeBookingStatus(
  raw: BookingStatusChangeInput,
): Promise<BookingStatusChangeResult> {
  const ctx = await requireTenantRole("manager");
  const parsed = BookingStatusChangeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Dati non validi." };
  }
  const tenantId = ctx.tenant.id;
  const supabase = await createSupabaseServerClient();
  const { data: before, error: bErr } = await supabase
    .from("bookings")
    .select("id,status")
    .eq("id", parsed.data.booking_id)
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  if (bErr) return { ok: false, code: "INTERNAL_ERROR", message: "Errore verifica prenotazione." };
  if (!before) return { ok: false, code: "NOT_FOUND", message: "Prenotazione inesistente." };
  const from = before.status as BookingStatus;
  const to = parsed.data.to_status;
  const allowed = BOOKING_LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Transizione ${from} → ${to} non consentita.`,
    };
  }
  if (from === to) {
    return { ok: true, code: "OK", booking_id: parsed.data.booking_id, to_status: to };
  }
  const { data: after, error } = await supabase
    .from("bookings")
    .update({ status: to })
    .eq("id", parsed.data.booking_id)
    .eq("tenant_id", tenantId)
    .eq("status", from)
    .select("id,status")
    .limit(1)
    .maybeSingle();
  if (error) {
    const c = (error as { code?: string; hint?: string; message?: string } | undefined)?.code ?? "";
    if (c === "VF400" || /invalid status transition/i.test(error.message || "")) {
      return { ok: false, code: "INVALID_TRANSITION", message: "Transizione di stato non valida." };
    }
    if (c === "42501") return { ok: false, code: "FORBIDDEN", message: "Non autorizzato." };
    return { ok: false, code: "INTERNAL_ERROR", message: "Aggiornamento fallito." };
  }
  if (!after) {
    return { ok: false, code: "CONFLICT", message: "Modifica concorrente: riprova." };
  }
  return {
    ok: true,
    code: "OK",
    booking_id: after.id,
    to_status: (after.status as BookingStatus) ?? to,
  };
}

export function customerBookingsBucketNow(tz = "Europe/Rome"): {
  todayStart: Date;
  todayEnd: Date;
  now: Date;
} {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const get = (src: Date, k: string) => {
    const parts = dtf.formatToParts(src);
    return Number(parts.find((p) => p.type === k)!.value);
  };
  const y = get(now, "year");
  const m = get(now, "month") - 1;
  const d = get(now, "day");
  const startLocal = new Date();
  startLocal.setFullYear(y, m, d);
  startLocal.setHours(0, 0, 0, 0);
  const asUtcStart = Date.UTC(y, m, d, 0, 0, 0);
  const offMinGuess = Math.round((startLocal.getTime() - asUtcStart) / 60_000);
  const utcStart = new Date(Date.UTC(y, m, d, 0, 0, 0) - offMinGuess * 60_000);
  const utcEnd = new Date(utcStart.getTime() + 24 * 3600 * 1000);
  return { now, todayStart: utcStart, todayEnd: utcEnd };
}
