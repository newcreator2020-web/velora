import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Weekday mapping: Postgres availability weekday 0..6 = Sun..Sat
// JS Date.getDay(): same 0..6 Sun..Sat
export const WEEKDAY_JS_TO_PG = (jsDay: number): number => jsDay;
export const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] as const;

export const SlotStepMinutes = 15;
export const BookingHorizonDays = 45;

export const CreatePublicBookingSchema = z.object({
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
});

export type PublicBookingInput = z.infer<typeof CreatePublicBookingSchema>;

export async function createPublicBooking(input: PublicBookingInput) {
  const validated = CreatePublicBookingSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const email =
    validated.customer_email && validated.customer_email.length > 0
      ? validated.customer_email
      : null;
  const phone =
    validated.customer_phone && validated.customer_phone.length > 0
      ? validated.customer_phone
      : null;
  const notes = validated.notes && validated.notes.length > 0 ? validated.notes : null;
  const rpcArgs: Record<string, unknown> = {
    p_slug: validated.slug,
    p_service_id: validated.service_id,
    p_starts_at: validated.starts_at.toISOString(),
    p_customer_name: validated.customer_name,
  };
  if (email) rpcArgs["p_customer_email"] = email;
  if (phone) rpcArgs["p_customer_phone"] = phone;
  if (notes) rpcArgs["p_notes"] = notes;
  const { data, error } = await supabase.rpc(
    "public_booking_create_slug",
    rpcArgs as {
      p_slug: string;
      p_service_id: string;
      p_starts_at: string;
      p_customer_name: string;
      p_customer_email?: string;
      p_customer_phone?: string;
      p_notes?: string;
    },
  );
  if (error) {
    throw new Error(error.message || "BOOKING_ERROR");
  }
  const rows = data as unknown as Array<{
    booking_id: string;
    booking_status: string;
    starts_at: string;
    ends_at: string;
    customer_id?: string | null;
  }> | null;
  if (!rows || rows.length === 0) throw new Error("BOOKING_EMPTY");
  return rows[0];
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
  const supabase = await createSupabaseServerClient();
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
  const { data, error } = await supabase
    .from("bookings")
    .select("starts_at,ends_at")
    .eq("tenant_id", tenantId)
    .eq("service_id", serviceId)
    .eq("status", "confirmed")
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ starts_at: string; ends_at: string }>).map((b) => [
    new Date(b.starts_at),
    new Date(b.ends_at),
  ]);
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
