"use server";

import "server-only";
import { CreatePublicBookingSchema, createPublicBooking } from "@/lib/server/booking";

export async function createBookingAction(_prevState: unknown, form: FormData) {
  const payload = {
    slug: form.get("slug")?.toString(),
    service_id: form.get("service_id")?.toString(),
    starts_at: form.get("starts_at")?.toString(),
    customer_name: form.get("customer_name")?.toString(),
    customer_email: form.get("customer_email")?.toString(),
    customer_phone: form.get("customer_phone")?.toString(),
    notes: form.get("notes")?.toString(),
  };
  const parsed = CreatePublicBookingSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  try {
    const booking = await createPublicBooking(parsed.data);
    return { ok: true as const, booking };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Impossibile prenotare. Riprova.",
    };
  }
}
