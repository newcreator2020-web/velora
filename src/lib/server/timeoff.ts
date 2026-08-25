import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantMembership, requireTenantRole } from "@/lib/server/auth";
import { TIME_OFF_TYPES } from "@/lib/timeoff-shared";
import type {
  TimeOffType,
  PreviewConflictBooking,
  ResourceTimeOffVM,
  TimeOffErrorCode,
  TimeOffActionResult,
} from "@/lib/timeoff-shared";
export { TIME_OFF_TYPES, TIME_OFF_TYPE_LABELS } from "@/lib/timeoff-shared";
export type {
  TimeOffType,
  PreviewConflictBooking,
  ResourceTimeOffVM,
  TimeOffErrorCode,
  TimeOffActionResult,
} from "@/lib/timeoff-shared";

export const ResourceTimeOffPreviewSchema = z.object({
  resource_id: z.string().uuid(),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
});

export const ResourceTimeOffCreateSchema = z
  .object({
    resource_id: z.string().uuid(),
    type: z.enum(TIME_OFF_TYPES),
    starts_at: z.string().min(1),
    ends_at: z.string().min(1),
    title: z.string().max(200).optional().or(z.literal("")),
    expected_conflict_count: z.coerce.number().int().nonnegative().optional().nullable(),
  })
  .refine(
    (d) => {
      try {
        const s = new Date(d.starts_at).getTime();
        const e = new Date(d.ends_at).getTime();
        return Number.isFinite(s) && Number.isFinite(e) && s < e;
      } catch {
        return false;
      }
    },
    {
      message: "Data/ora inizio deve essere precedente alla fine.",
      path: ["starts_at"],
    },
  );

export const ResourceTimeOffDeleteSchema = z.object({
  time_off_id: z.string().uuid(),
});

function toFieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of err.issues) {
    const k = i.path.join(".") || "_";
    out[k] ??= [];
    out[k].push(i.message);
  }
  return out;
}

function mapCode(c: string): TimeOffErrorCode {
  switch (c) {
    case "AUTHZ_DENIED":
    case "RESOURCE_NOT_FOUND":
    case "INVALID_INTERVAL":
    case "RANGE_TOO_LARGE":
    case "CONFLICT_PREVIEW_STALE":
    case "VALIDATION_ERROR":
    case "TIME_OFF_NOT_FOUND":
      return c;
    default:
      return "UNKNOWN_ERROR";
  }
}

type SupabaseRpcLike = {
  rpc: (n: string, a: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }>;
};

export async function previewResourceTimeOff(input: unknown): Promise<
  TimeOffActionResult<{
    conflicts: PreviewConflictBooking[];
    conflict_count: number;
  }>
> {
  await requireTenantRole("manager");
  const parsed = ResourceTimeOffPreviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Dati non validi.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  try {
    const r = await (supabase as unknown as SupabaseRpcLike).rpc(
      "dashboard_resource_time_off_preview",
      {
        p_resource_id: d.resource_id,
        p_starts_at: d.starts_at,
        p_ends_at: d.ends_at,
      },
    );
    if (r.error) {
      const err = r.error as unknown as { code?: string; message?: string };
      return {
        ok: false,
        code: mapCode(err.code ?? "UNKNOWN_ERROR"),
        message: err.message ?? "Errore durante l'anteprima.",
      };
    }
    const rows = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
    if (rows.length > 0) {
      const code = String(rows[0]?.["code"] ?? "");
      const message = String(rows[0]?.["message"] ?? "");
      if (code !== "" && code !== "OK") {
        return {
          ok: false,
          code: mapCode(code),
          message: message || "Anteprima fallita.",
        };
      }
    }
    const conflicts: PreviewConflictBooking[] = rows
      .filter((row) => String(row["booking_id"] ?? "").length === 36)
      .map((row) => ({
        booking_id: String(row["booking_id"] ?? ""),
        starts_at: String(row["starts_at"] ?? ""),
        ends_at: String(row["ends_at"] ?? ""),
        service_id: String(row["service_id"] ?? ""),
        service_name: String(row["service_name"] ?? ""),
        resource_id: String(row["resource_id"] ?? ""),
        status: String(row["status"] ?? ""),
      }));
    return {
      ok: true,
      code: "OK",
      data: { conflicts, conflict_count: conflicts.length },
    };
  } catch {
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "Errore durante l'anteprima.",
    };
  }
}

function iso16(s: string | Date): string {
  const d = typeof s === "string" ? new Date(s) : s;
  return d.toISOString().slice(0, 16);
}

export async function createResourceTimeOff(input: unknown): Promise<
  TimeOffActionResult<{
    id: string;
    resource_id: string;
    conflict_count: number;
    read_back: ResourceTimeOffVM;
  }>
> {
  await requireTenantRole("manager");
  const parsed = ResourceTimeOffCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Dati non validi.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  try {
    const r = await (supabase as unknown as SupabaseRpcLike).rpc(
      "dashboard_resource_time_off_create",
      {
        p_resource_id: d.resource_id,
        p_type: d.type,
        p_starts_at: d.starts_at,
        p_ends_at: d.ends_at,
        p_title: d.title && d.title.length > 0 ? d.title : null,
        p_expected_conflict_count:
          d.expected_conflict_count === undefined || d.expected_conflict_count === null
            ? null
            : Number(d.expected_conflict_count),
      },
    );
    if (r.error) {
      const err = r.error as unknown as { code?: string; message?: string };
      return {
        ok: false,
        code: mapCode(err.code ?? "UNKNOWN_ERROR"),
        message: err.message ?? "Errore durante la creazione.",
      };
    }
    const rows = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
    const row = rows[0] ?? null;
    if (!row) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "Nessuna risposta dal server.",
      };
    }
    const code = String(row["code"] ?? "");
    const message = String(row["message"] ?? "");
    if (code !== "OK") {
      return {
        ok: false,
        code: mapCode(code),
        message: message || "Creazione fallita.",
      };
    }
    const id = String(row["time_off_id"] ?? "");
    const resource_id = String(row["resource_id"] ?? "");
    const conflict_count = Number(row["conflict_count"] ?? 0);

    const ctx = await requireTenantMembership();
    const rb = await supabase
      .from("resource_time_off")
      .select(`id,tenant_id,resource_id,time_off_type,starts_at,ends_at,title,created_at`)
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .limit(1);
    if (rb.error || !rb.data || rb.data.length === 0) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "Read-back persistito non riuscito dopo creazione.",
      };
    }
    const rowRb = rb.data[0] as unknown as Record<string, unknown>;
    if (
      String(rowRb["resource_id"]) !== resource_id ||
      String(rowRb["time_off_type"]) !== d.type ||
      iso16(String(rowRb["starts_at"])) !== iso16(d.starts_at) ||
      iso16(String(rowRb["ends_at"])) !== iso16(d.ends_at)
    ) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "Read-back ha restituito dati inconsistenti.",
      };
    }
    revalidatePath("/app/team");
    revalidatePath("/app/calendar");
    return {
      ok: true,
      code: "OK",
      message: "Assenza salvata.",
      data: {
        id,
        resource_id,
        conflict_count,
        read_back: {
          id: String(rowRb["id"]),
          tenant_id: String(rowRb["tenant_id"]),
          resource_id: String(rowRb["resource_id"]),
          type: String(rowRb["type"]) as TimeOffType,
          starts_at: String(rowRb["starts_at"]),
          ends_at: String(rowRb["ends_at"]),
          title: rowRb["title"] ? String(rowRb["title"]) : null,
          created_at: String(rowRb["created_at"]),
        },
      },
    };
  } catch {
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "Errore durante la creazione dell'assenza.",
    };
  }
}

export async function deleteResourceTimeOff(
  input: unknown,
): Promise<TimeOffActionResult<{ id: string; resource_id: string }>> {
  await requireTenantRole("manager");
  const parsed = ResourceTimeOffDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Dati non validi.",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const d = parsed.data;
  const supabase = await createSupabaseServerClient();
  try {
    const r = await (supabase as unknown as SupabaseRpcLike).rpc(
      "dashboard_resource_time_off_delete",
      { p_time_off_id: d.time_off_id },
    );
    if (r.error) {
      const err = r.error as unknown as { code?: string; message?: string };
      return {
        ok: false,
        code: mapCode(err.code ?? "UNKNOWN_ERROR"),
        message: err.message ?? "Errore durante l'eliminazione.",
      };
    }
    const rows = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
    const row = rows[0] ?? null;
    if (!row) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "Nessuna risposta dal server.",
      };
    }
    const code = String(row["code"] ?? "");
    const message = String(row["message"] ?? "");
    if (code !== "OK") {
      return {
        ok: false,
        code: mapCode(code),
        message: message || "Eliminazione fallita.",
      };
    }
    const id = String(row["time_off_id"] ?? "");
    const resource_id = String(row["resource_id"] ?? "");
    const ctx = await requireTenantMembership();
    const rb = await supabase
      .from("resource_time_off")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .limit(1);
    if (rb.error) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "Errore verifica eliminazione.",
      };
    }
    if (rb.data && rb.data.length !== 0) {
      return {
        ok: false,
        code: "UNKNOWN_ERROR",
        message: "L'assenza risulta ancora presente dopo eliminazione.",
      };
    }
    revalidatePath("/app/team");
    revalidatePath("/app/calendar");
    return {
      ok: true,
      code: "OK",
      message: "Assenza eliminata.",
      data: { id, resource_id },
    };
  } catch {
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "Errore durante l'eliminazione.",
    };
  }
}

export async function listResourceTimeOff(options?: {
  resource_id?: unknown;
  start_from?: Date;
}): Promise<ResourceTimeOffVM[]> {
  const ctx = await requireTenantMembership();
  const resource_id = options?.resource_id
    ? z.string().uuid().safeParse(options.resource_id)
    : null;
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("resource_time_off")
    .select(`id,tenant_id,resource_id,time_off_type,starts_at,ends_at,title,created_at`)
    .eq("tenant_id", ctx.tenant.id);
  if (resource_id?.success) {
    q = q.eq("resource_id", resource_id.data);
  }
  if (options?.start_from) {
    q = q.gt("ends_at", options.start_from.toISOString());
  }
  q = q.order("starts_at", { ascending: true });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row["id"]),
      tenant_id: String(row["tenant_id"]),
      resource_id: String(row["resource_id"]),
      type: String(row["time_off_type"]) as TimeOffType,
      starts_at: String(row["starts_at"]),
      ends_at: String(row["ends_at"]),
      title: row["title"] ? String(row["title"]) : null,
      created_at: String(row["created_at"]),
    };
  });
}
