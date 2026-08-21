"use server";

import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantRole } from "@/lib/server/auth";

const AvRow = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  start_time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
});

const SaveSchema = z.object({
  rows: z
    .array(AvRow)
    .length(7)
    .superRefine((val, ctx) => {
      val.forEach((row, i) => {
        if (row.weekday !== i)
          ctx.addIssue({ code: "custom", path: [i, "weekday"], message: "weekday mismatch" });
        if (row.enabled && row.start_time >= row.end_time)
          ctx.addIssue({ code: "custom", path: [i, "start_time"], message: "start must be < end" });
      });
    }),
});

export async function saveAvailabilityAction(_prevState: unknown, form: FormData) {
  const ctx = await requireTenantRole("manager");
  const raw = form.get("payload")?.toString();
  if (!raw) return { ok: false as const, error: "Payload mancante." };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false as const, error: "Payload non valido." };
  }
  const parsed = SaveSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const supabase = await createSupabaseServerClient();
  const tenantId = ctx.tenant.id;
  // atomic UPSERT rows one-by-one or single bulk
  const { error } = await supabase.from("business_availability").upsert(
    parsed.data.rows.map((r) => ({
      tenant_id: tenantId,
      weekday: r.weekday,
      enabled: r.enabled,
      start_time: r.start_time,
      end_time: r.end_time,
    })),
    { onConflict: "tenant_id,weekday" },
  );
  if (error) return { ok: false as const, error: error.message || "Salvataggio fallito." };
  return { ok: true as const };
}
