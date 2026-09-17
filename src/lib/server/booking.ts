import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BookingErrorCode =
  | "tenant_not_found"
  | "service_invalid"
  | "past_or_lead_time"
  | "too_far_in_advance"
  | "resource_not_eligible"
  | "business_closed"
  | "timeoff_conflict"
  | "all_operators_unavailable"
  | "slot_taken"
  | "validation_error"
  | "unknown";

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly userMessage: string;
  constructor(code: BookingErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BookingError";
    this.code = code;
    this.userMessage = userMessageFor(code);
  }
}

function userMessageFor(code: BookingErrorCode): string {
  switch (code) {
    case "timeoff_conflict":
      return "L'operatore selezionato non è disponibile in questa fascia oraria (ferie, permesso o chiusura). Scegli un altro orario o un altro operatore.";
    case "all_operators_unavailable":
      return "Nessun operatore è disponibile in questa fascia oraria (chiusura o ferie). Prova un altro giorno.";
    case "business_closed":
      return "L'attività è chiusa in questo giorno o fascia oraria.";
    case "slot_taken":
      return "Questo orario è stato appena prenotato. Scegli un altro slot disponibile.";
    case "past_or_lead_time":
      return "Non è possibile prenotare un orario già passato o troppo ravvicinato.";
    case "too_far_in_advance":
      return "Non è possibile prenotare così in anticipo.";
    case "resource_not_eligible":
      return "L'operatore selezionato non può eseguire questo servizio.";
    case "service_invalid":
      return "Servizio non valido o non più disponibile.";
    case "tenant_not_found":
      return "Sito non trovato.";
    case "validation_error":
      return "Completa correttamente tutti i campi obbligatori.";
    default:
      return "Si è verificato un errore durante la prenotazione. Riprova tra qualche minuto.";
  }
}

type RpcErrorShape = {
  code?: string | number | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null;

function inferBookingCodeFromRpc(err: RpcErrorShape): BookingErrorCode {
  const pgSqlState =
    typeof (err as unknown as { code?: string })?.code === "string"
      ? (err as unknown as { code: string }).code.toUpperCase()
      : "";
  if (pgSqlState === "VLTO1") return "timeoff_conflict";
  if (pgSqlState === "VLTO2") return "all_operators_unavailable";
  if (pgSqlState === "VLTN1") return "tenant_not_found";
  if (pgSqlState === "VLTN2") return "service_invalid";
  if (pgSqlState === "VLTN3") return "past_or_lead_time";
  if (pgSqlState === "VLTN4") return "too_far_in_advance";
  if (pgSqlState === "VLTN5") return "resource_not_eligible";
  if (pgSqlState === "VLTN6") return "business_closed";
  if (pgSqlState === "VLTN7") return "slot_taken";
  const msg = (err?.message ?? "").toLowerCase();
  if (msg.includes("time off") || msg.includes("timeoff") || msg.includes("ferie")) {
    return "timeoff_conflict";
  }
  if (msg.includes("closed") || msg.includes("chius")) return "business_closed";
  if (msg.includes("slot taken") || msg.includes("unavailable")) return "slot_taken";
  return "unknown";
}

// Weekday mapping: Postgres availability weekday 0..6 = Sun..Sat
// JS Date.getDay(): same 0..6 Sun..Sat
export const WEEKDAY_JS_TO_PG = (jsDay: number): number => jsDay;
export const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] as const;

export const SlotStepMinutes = 15;
export const BookingHorizonDays = 45;

export const CreatePublicBookingSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$/),
    service_id: z.string().uuid(),
    starts_at: z.coerce.date(),
    customer_name: z.string().min(1).max(120),
    customer_email: z.string().email().max(254).optional().or(z.literal("")),
    customer_phone: z
      .string()
      .regex(/^[0-9+\s()-]{4,32}$/)
      .optional()
      .or(z.literal("")),
    notes: z.string().max(500).optional().or(z.literal("")),
    resource_slug: z
      .string()
      .regex(/^(any|[a-z0-9][a-z0-9-]{0,58}[a-z0-9])$/)
      .max(60)
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) => {
      const hasEmail = Boolean(data.customer_email && data.customer_email.length > 0);
      const hasPhone = Boolean(data.customer_phone && data.customer_phone.length > 0);
      return hasEmail || hasPhone;
    },
    { message: "Almeno un contatto tra email e telefono è richiesto.", path: ["customer_email"] },
  );

export type PublicBookingInput = z.infer<typeof CreatePublicBookingSchema>;

export type PublicBookingResult = {
  booking_id: string;
  booking_status: string;
  starts_at: string;
  ends_at: string;
  resource_slug?: string | null;
  resource_display_name?: string | null;
  total_price: number;
  deposit_amount: number | null;
  customer_email?: string | null;
};

export async function createPublicBooking(input: PublicBookingInput): Promise<PublicBookingResult> {
  const validated = CreatePublicBookingSchema.safeParse(input);
  if (!validated.success) {
    throw new BookingError(
      "validation_error",
      validated.error.issues.map((i) => i.message).join("; "),
    );
  }
  const data = validated.data;
  const supabase = await createSupabaseServerClient();
  const email = data.customer_email && data.customer_email.length > 0 ? data.customer_email : null;
  const phone = data.customer_phone && data.customer_phone.length > 0 ? data.customer_phone : null;
  const notes = data.notes && data.notes.length > 0 ? data.notes : null;
  const resource_slug =
    data.resource_slug && data.resource_slug.length > 0 ? data.resource_slug : "any";
  const rpcArgs = {
    p_tenant_slug: data.slug,
    p_service_id: data.service_id,
    p_starts_at: data.starts_at.toISOString(),
    p_resource_slug: resource_slug,
    p_customer_name: data.customer_name,
    p_customer_email: email,
    p_customer_phone: phone,
    p_notes: notes,
  };
  const { data: rpcData, error } = await supabase.rpc("public_booking_create_v3", rpcArgs as never);
  if (error) {
    const code = inferBookingCodeFromRpc(error as unknown as RpcErrorShape);
    throw new BookingError(code, error.message ?? code);
  }
  const rows = (rpcData as unknown as PublicBookingResult[] | null) ?? [];
  if (rows.length === 0) throw new BookingError("slot_taken", "RPC returned empty set");
  const result = rows[0];
  if (!result) throw new BookingError("slot_taken", "RPC returned empty set");
  return result;
}

export type PublicResourceOption = {
  resource_slug: string;
  resource_display_name: string;
  sort_order: number;
};

export async function listPublicResourcesForService(opts: {
  slug: string;
  service_id: string;
}): Promise<PublicResourceOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_booking_resources_list", {
    p_slug: opts.slug,
    p_service_id: opts.service_id,
  });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as PublicResourceOption[] | null) ?? [];
  return rows;
}

export type BusinessAvailabilityRow = {
  weekday: number;
  enabled: boolean;
  start_time: string;
  end_time: string;
};

export async function getBusinessAvailability(
  tenantId: string,
): Promise<BusinessAvailabilityRow[]> {
  const { getSupabaseServiceClient } = await import(
    /* webpackIgnore: false */ "@/lib/supabase/service"
  );
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("business_availability")
    .select("weekday,enabled,start_time,end_time")
    .eq("tenant_id", tenantId)
    .order("weekday");
  if (error) throw new Error(error.message);
  return (data as BusinessAvailabilityRow[]) ?? [];
}

export type Slot = {
  iso: string;
  label: string;
  available: boolean;
};

export function generateSlotsForDay(opts: {
  dateLocal: Date;
  availability: BusinessAvailabilityRow;
  durationMin: number;
  stepMin?: number;
  tz: string;
  bookedRanges: Array<[Date, Date]>;
  nowIso?: string;
}): Slot[] {
  const step = opts.stepMin ?? SlotStepMinutes;
  if (!opts.availability.enabled) return [];
  if (!opts.durationMin || opts.durationMin <= 0 || opts.durationMin > 480) return [];
  const sParts = (opts.availability.start_time || "09:00").split(":");
  const eParts = (opts.availability.end_time || "18:00").split(":");
  const sH = Number(sParts[0] ?? 9);
  const sM = Number(sParts[1] ?? 0);
  const eH = Number(eParts[0] ?? 18);
  const eM = Number(eParts[1] ?? 0);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  if (startMin >= endMin) return [];
  const slots: Slot[] = [];
  const now = opts.nowIso ? new Date(opts.nowIso) : new Date();
  for (let t = startMin; t + opts.durationMin <= endMin; t += step) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const local = new Date(opts.dateLocal.getTime());
    local.setHours(h, m, 0, 0);
    const iso = zonedToUtcIso(local, opts.tz);
    const end = new Date(new Date(iso).getTime() + opts.durationMin * 60_000);
    if (new Date(iso).getTime() <= now.getTime() + 60_000) continue;
    const conflict = opts.bookedRanges.some(
      ([bStart, bEnd]) =>
        new Date(iso).getTime() < bEnd.getTime() && end.getTime() > bStart.getTime(),
    );
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    slots.push({ iso, label: `${hh}:${mm}`, available: !conflict });
  }
  return slots;
}

export function zonedToUtcIso(localCivilDateInTz: Date, tz: string): string {
  const y = localCivilDateInTz.getFullYear();
  const mo = localCivilDateInTz.getMonth();
  const d = localCivilDateInTz.getDate();
  const h = localCivilDateInTz.getHours();
  const mi = localCivilDateInTz.getMinutes();
  const isoRefZ = new Date(Date.UTC(y, mo, d, h, mi, 0));
  const offset = guessOffsetMinutes(tz, isoRefZ);
  const utc = new Date(Date.UTC(y, mo, d, h, mi, 0) + offset * 60_000);
  return utc.toISOString();
}

export function guessOffsetMinutes(tz: string, at: Date): number {
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
  const asParts = (src: Date) => {
    const p = dtf.formatToParts(src);
    const get = (k: string) => Number(p.find((f) => f.type === k)!.value);
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
  };
  const epochAt = at.getTime();
  const asTz = asParts(at);
  const offMin = Math.round((epochAt - asTz) / 60_000);
  return offMin;
}

export async function getConfirmedBookingsRangesForService(
  tenantId: string,
  serviceId: string,
  fromIso: string,
  toIso: string,
): Promise<Array<[Date, Date]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_booking_get_confirmed_ranges", {
    p_tenant_id: tenantId,
    p_service_id: serviceId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{ starts_at: string; ends_at: string }> | null;
  return (rows ?? []).map((b) => [new Date(b.starts_at), new Date(b.ends_at)]);
}

export function formatDateTimeLocal(iso: string, tz: string): string {
  try {
    const dt = new Date(iso);
    const dtf = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return dtf.format(dt);
  } catch {
    return String(iso);
  }
}
