import "server-only";
import { z } from "zod";
import { requireTenantMembership, requireTenantRole } from "@/lib/server/auth";

type TypedRpc = <T = unknown>(
  name: string,
  params: Record<string, unknown>,
) => Promise<{
  data: T | null;
  error: { message?: string; hint?: string; code?: string; details?: string } | null;
}>;

const WEEKDAY = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const TimeOnly = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: "Formato orario HH:MM" });

export const ResourceWeeklyIntervalSchema = z
  .object({
    weekday: WEEKDAY,
    start_time: TimeOnly,
    end_time: TimeOnly,
  })
  .refine((r) => r.start_time < r.end_time, {
    message: "L'inizio deve precedere la fine",
    path: ["start_time"],
  });

export const SaveResourceWeeklyScheduleSchema = z.object({
  resource_id: z.string().uuid(),
  expected_version: z.coerce.number().int().min(0),
  intervals: z.array(ResourceWeeklyIntervalSchema).max(42, {
    message: "Troppi intervalli (max 6 per giorno * 7 giorni = 42)",
  }),
});

export type ResourceWeeklyIntervalVM = z.infer<typeof ResourceWeeklyIntervalSchema>;

export type ResourceWeeklyScheduleGetResult = {
  ok: boolean;
  code: "OK" | "FORBIDDEN" | "NOT_FOUND" | "UNKNOWN_ERROR";
  message: string;
  data?: {
    availability_version: number;
    intervals: ResourceWeeklyIntervalVM[];
    inherit_weekdays_bitmask: number;
  };
};

export type ResourceWeeklyScheduleSaveResult = {
  ok: boolean;
  code:
    | "OK"
    | "VALIDATION_ERROR"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "STALE_VERSION"
    | "OVERLAPPING_INTERVAL"
    | "SCHEDULE_CONFLICT"
    | "UNKNOWN_ERROR";
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  data?: {
    new_version: number;
    inserted_count: number;
    deleted_count: number;
    conflicting_future_booking_count: number;
    changed_weekdays_bitmask: number;
    has_inherit_weekdays: boolean;
  };
};

const STALE = "RWA43";
const OVERLAP = "SCHD01";
const INVALID_WD = "RWA01";
const INVALID_TIME = "RWA02";
const START_AFTER = "RWA04";
const MISMATCH = "RWA03";
const UNAUTH = "RWA42";
const NO_RES = "RWA40";

function mapErr(
  msg: string,
  hint?: string,
): { code: ResourceWeeklyScheduleSaveResult["code"]; message: string } {
  const full = `${msg}${hint ? ` [${hint}]` : ""}`;
  switch (hint) {
    case STALE:
      return {
        code: "STALE_VERSION",
        message: "Le modifiche sono sovrapposte a un salvataggio recente. Ricarica e riprova.",
      };
    case OVERLAP:
      return {
        code: "OVERLAPPING_INTERVAL",
        message: "Sono presenti intervalli sovrapposti per lo stesso giorno.",
      };
    case INVALID_WD:
      return { code: "VALIDATION_ERROR", message: "Giorno della settimana non valido." };
    case INVALID_TIME:
      return { code: "VALIDATION_ERROR", message: "Orario non valido." };
    case START_AFTER:
      return { code: "VALIDATION_ERROR", message: "L'inizio deve precedere la fine." };
    case MISMATCH:
      return { code: "VALIDATION_ERROR", message: "Lunghezza vettori paralleli non corrisponde." };
    case UNAUTH:
      return { code: "FORBIDDEN", message: "Non disponi delle autorizzazioni necessarie." };
    case NO_RES:
      return { code: "NOT_FOUND", message: "Risorsa non trovata." };
    default:
      return { code: "UNKNOWN_ERROR", message: full };
  }
}

export async function getResourceWeeklySchedule(
  resourceId: unknown,
): Promise<ResourceWeeklyScheduleGetResult> {
  try {
    await requireTenantMembership();
    const rid = z.string().uuid().safeParse(resourceId);
    if (!rid.success) {
      return { ok: false, code: "NOT_FOUND", message: "ID risorsa non valido" };
    }
    const sb = await (await import("@/lib/supabase/server")).createSupabaseServerClient();
    const { data, error } = await (sb.rpc as unknown as TypedRpc)(
      "dashboard_get_resource_weekly_schedule",
      {
        p_resource_id: rid.data,
      },
    );
    if (error) throw new Error(error.message ?? String(error));
    const row = ((data as unknown) ?? null) as null | {
      availability_version: number;
      resource_exists: boolean;
      authorized: boolean;
      intervals: Array<{ weekday: number; start_time: string; end_time: string }>;
      inherit_weekdays_bitmask: number;
    };
    if (!row || !row.resource_exists) {
      return { ok: false, code: "NOT_FOUND", message: "Risorsa non trovata" };
    }
    if (!row.authorized) {
      return { ok: false, code: "FORBIDDEN", message: "Non autorizzato" };
    }
    return {
      ok: true,
      code: "OK",
      message: "OK",
      data: {
        availability_version: Number(row.availability_version) | 0,
        intervals: (row.intervals ?? [])
          .filter((r) => typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6)
          .map((r) => ({
            weekday: r.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            start_time: r.start_time,
            end_time: r.end_time,
          })),
        inherit_weekdays_bitmask: Number(row.inherit_weekdays_bitmask) | 0,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function saveResourceWeeklySchedule(
  input: unknown,
): Promise<ResourceWeeklyScheduleSaveResult> {
  try {
    await requireTenantRole("manager");
    const parsed = SaveResourceWeeklyScheduleSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.reduce<Record<string, string[]>>((acc, i) => {
        const k = i.path.map((p) => String(p)).join(".") || "_";
        (acc[k] ||= []).push(i.message);
        return acc;
      }, {});
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Verifica i dati inseriti",
        fieldErrors,
      };
    }

    const weekdays = parsed.data.intervals.map((i) => i.weekday);
    const starts = parsed.data.intervals.map((i) => i.start_time);
    const ends = parsed.data.intervals.map((i) => i.end_time);

    // Usiamo supabase regolare che usa auth cookie: RPC SEC DEFINER userà auth.uid() interno.
    const supabase = await (await import("@/lib/supabase/server")).createSupabaseServerClient();
    const { data, error } = await (supabase.rpc as unknown as TypedRpc)(
      "dashboard_save_resource_weekly_schedule",
      {
        p_resource_id: parsed.data.resource_id,
        p_expected_version: parsed.data.expected_version,
        p_weekdays: weekdays,
        p_start_times: starts,
        p_end_times: ends,
        p_force_reset_all: true,
      },
    );
    if (error) {
      const msg = error.message ?? "";
      const hintRaw = (error as unknown as { hint?: string; code?: string }).hint;
      const codeRaw = (error as unknown as { code?: string }).code;
      const hint: string | undefined =
        hintRaw ??
        (msg.includes("stale") ? STALE : undefined) ??
        (codeRaw === OVERLAP || msg.includes("Overlapping") ? OVERLAP : undefined) ??
        (msg.includes("weekday") ? INVALID_WD : undefined) ??
        (msg.includes("start must") ? START_AFTER : undefined) ??
        (msg.includes("authentication") ? UNAUTH : undefined) ??
        (msg.includes("resource not found") ? NO_RES : undefined);
      const mapped = mapErr(msg, hint);
      return { ok: false, code: mapped.code, message: mapped.message };
    }
    const row = data as unknown as {
      new_version: number;
      inserted_count: number;
      deleted_count: number;
      conflicting_future_bookings_cnt: number;
      changed_weekdays_bitmask: number;
      has_inherit_weekdays: boolean;
    };
    return {
      ok: true,
      code: "OK",
      message: "Orari settimanali salvati",
      data: {
        new_version: Number(row.new_version) | 0,
        inserted_count: Number(row.inserted_count) | 0,
        deleted_count: Number(row.deleted_count) | 0,
        conflicting_future_booking_count: Number(row.conflicting_future_bookings_cnt) | 0,
        changed_weekdays_bitmask: Number(row.changed_weekdays_bitmask) | 0,
        has_inherit_weekdays: !!row.has_inherit_weekdays,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
