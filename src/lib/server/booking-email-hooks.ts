import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  sendBookingCancelled,
  sendBookingModified,
  type EmailBookingContext,
} from "@/lib/server/email";
import type { Database } from "@/types/supabase";

type BookingStatus = "confirmed" | "completed" | "no_show" | "cancelled";

type EmailJoinRow = Database["public"]["Tables"]["bookings"]["Row"] & {
  services: Pick<
    Database["public"]["Tables"]["services"]["Row"],
    "name" | "duration_minutes" | "price_from" | "currency"
  > | null;
  staff_resources: { display_name: string | null } | null;
  tenants: Pick<Database["public"]["Tables"]["tenants"]["Row"], "id" | "name" | "slug"> | null;
  business_profiles: Pick<
    Database["public"]["Tables"]["business_profiles"]["Row"],
    | "display_name"
    | "legal_name"
    | "theme_primary"
    | "address_line1"
    | "city"
    | "postal_code"
    | "province"
    | "country_code"
    | "timezone"
    | "email"
    | "phone"
  > | null;
};

async function loadBookingContext(bookingId: string): Promise<EmailBookingContext | null> {
  try {
    const svc = getSupabaseServiceClient();
    const base = await svc.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (base.error || !base.data) return null;
    const booking = base.data as Database["public"]["Tables"]["bookings"]["Row"];
    const [svcRes, staffRes, tenantRes, bpRes] = await Promise.all([
      svc
        .from("services")
        .select("name, duration_minutes, price_from, currency")
        .eq("id", booking.service_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("staff_resources")
        .select("display_name")
        .eq("id", booking.resource_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("tenants")
        .select("id, name, slug")
        .eq("id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("business_profiles")
        .select(
          "display_name, legal_name, theme_primary, address_line1, city, postal_code, province, country_code, timezone, email, phone",
        )
        .eq("tenant_id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!tenantRes.data || !bpRes.data) return null;
    const email = booking.customer_email?.trim?.() ?? "";
    if (!email) return null;
    const row: EmailJoinRow = {
      ...booking,
      services: svcRes.data ?? null,
      staff_resources: staffRes.data ?? null,
      tenants: tenantRes.data ?? null,
      business_profiles: bpRes.data ?? null,
    };
    return {
      booking: row,
      customer: {
        display_name: booking.customer_name ?? "Cliente",
        email,
        phone: booking.customer_phone ?? null,
      },
      tenant: row.tenants!,
      businessProfile: row.business_profiles!,
    };
  } catch {
    return null;
  }
}

export function notifyBookingStatusChanged(params: {
  booking_id: string;
  to_status: BookingStatus | "rescheduled";
}): void {
  void (async () => {
    const ctx = await loadBookingContext(params.booking_id);
    if (!ctx) return;
    try {
      switch (params.to_status) {
        case "cancelled":
          await sendBookingCancelled(ctx);
          break;
        case "rescheduled":
          await sendBookingModified(ctx);
          break;
        case "completed":
        case "no_show":
        case "confirmed":
        default:
          break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[booking-email-hooks] notifyBookingStatusChanged fallita booking=${params.booking_id} status=${params.to_status}: ${msg}`,
      );
    }
  })();
}
