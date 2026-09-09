import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { sendBookingReminder24h, type EmailBookingContext } from "@/lib/server/email";
import type { Database } from "@/types/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "auto";

type ReminderBookingRow = Database["public"]["Tables"]["bookings"]["Row"] & {
  reminder_sent?: boolean | null;
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

function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function runRemindersJob(req: NextRequest) {
  const cronKey = serverEnv.CRON_API_KEY;
  if (!cronKey || cronKey.length < 16) {
    return NextResponse.json(
      { error: "CRON_API_KEY non configurato", sent: 0, total: 0 },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqualStr(provided, cronKey)) {
    return NextResponse.json(
      { error: "Unauthorized", sent: 0, total: 0 },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const svc = getSupabaseServiceClient();
  const now = new Date();
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  const { data: rawRows, error: qErr } = await svc
    .from("bookings")
    .select("*")
    .gte("starts_at", from)
    .lte("starts_at", to)
    .eq("status", "confirmed")
    .is("reminder_sent", false)
    .order("starts_at", { ascending: true });

  if (qErr) {
    return NextResponse.json(
      { error: `DB query failed: ${qErr.message}`, sent: 0, total: 0 },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const baseRows = (rawRows ?? []) as Database["public"]["Tables"]["bookings"]["Row"][];
  const candidatesWithJoins: ReminderBookingRow[] = [];
  for (const row of baseRows) {
    try {
      const [svcRes, staffRes, tenantRes, bpRes] = await Promise.all([
        svc
          .from("services")
          .select("name, duration_minutes, price_from, currency")
          .eq("id", row.service_id!)
          .limit(1)
          .maybeSingle(),
        svc
          .from("staff_resources")
          .select("display_name")
          .eq("id", row.resource_id!)
          .limit(1)
          .maybeSingle(),
        svc
          .from("tenants")
          .select("id, name, slug")
          .eq("id", row.tenant_id!)
          .limit(1)
          .maybeSingle(),
        svc
          .from("business_profiles")
          .select(
            "display_name, legal_name, theme_primary, address_line1, city, postal_code, province, country_code, timezone, email, phone",
          )
          .eq("tenant_id", row.tenant_id!)
          .limit(1)
          .maybeSingle(),
      ]);
      candidatesWithJoins.push({
        ...row,
        services: svcRes.data ?? null,
        staff_resources: staffRes.data ?? null,
        tenants: tenantRes.data ?? null,
        business_profiles: bpRes.data ?? null,
      });
    } catch {
      // skip row on join failure
    }
  }

  const candidates = candidatesWithJoins.filter(
    (r) => r && r.tenants && r.business_profiles && r.customer_email && r.customer_email.length > 0,
  );

  let sent = 0;
  const total = candidates.length;
  const markIds: string[] = [];

  for (const row of candidates) {
    try {
      const customer = {
        display_name: row.customer_name,
        email: row.customer_email,
        phone: row.customer_phone,
      };
      const ctx: EmailBookingContext = {
        booking: row,
        customer,
        tenant: row.tenants!,
        businessProfile: row.business_profiles!,
      };
      const res = await sendBookingReminder24h(ctx);
      if (res.sent) {
        sent += 1;
        markIds.push(row.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[cron-reminders] processing booking=${row.id} failed: ${msg}`);
    }
  }

  if (markIds.length > 0) {
    try {
      const { error: updErr } = await svc
        .from("bookings")
        .update({ reminder_sent: true } as never)
        .in("id", markIds);
      if (updErr) {
        console.warn(`[cron-reminders] UPDATE reminder_sent failed: ${updErr.message}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[cron-reminders] UPDATE exception: ${msg}`);
    }
  }

  return NextResponse.json(
    { sent, total, from, to },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  return runRemindersJob(req);
}

export async function POST(req: NextRequest) {
  return runRemindersJob(req);
}
