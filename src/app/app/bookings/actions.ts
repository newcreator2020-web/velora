"use server";

import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantRole } from "@/lib/server/auth";

const CancelSchema = z.object({
  booking_id: z.string().uuid(),
});

export async function cancelBookingAction(_prevState: unknown, form: FormData) {
  const ctx = await requireTenantRole("manager");
  const parsed = CancelSchema.safeParse({ booking_id: form.get("booking_id")?.toString() });
  if (!parsed.success) {
    return { ok: false as const, error: "Dati non validi." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.booking_id)
    .eq("status", "confirmed")
    .eq("tenant_id", ctx.tenant.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false as const, error: error.message || "Cancellazione fallita." };
  }
  return { ok: true as const };
}
