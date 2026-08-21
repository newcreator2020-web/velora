import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  generateSlotsForDay,
  getBusinessAvailability,
  getConfirmedBookingsRangesForService,
  WEEKDAY_LABELS,
} from "@/lib/server/booking";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return NextResponse.json({ slots: [] }, { status: 404 });
  const resolved = await resolvePublicTenant({ slug: parsed.data });
  if (resolved._tag !== "Found") return NextResponse.json({ slots: [] }, { status: 404 });
  const { tenantId, site } = resolved;
  const url = new URL(req.url);
  const service_id = url.searchParams.get("service_id");
  const dateStr = url.searchParams.get("date");
  if (!service_id || !dateStr) return NextResponse.json({ slots: [] }, { status: 400 });
  const dateRegex = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  if (!dateRegex.test(dateStr)) return NextResponse.json({ slots: [] }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const svc = await supabase
    .from("services")
    .select("id,duration_minutes,active,tenant_id")
    .eq("id", service_id)
    .limit(1)
    .maybeSingle();
  if (!svc.data || svc.data.tenant_id !== tenantId || !svc.data.active) {
    return NextResponse.json({ slots: [] }, { status: 404 });
  }
  const duration = svc.data.duration_minutes ?? 0;
  const tz = site.timezone || "Europe/Rome";
  const availability = await getBusinessAvailability(tenantId);
  const parts = dateStr.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dateLocal = new Date(y, m - 1, d, 0, 0, 0, 0);
  const weekday = dateLocal.getDay();
  const av = availability.find((a) => a.weekday === weekday);
  if (!av) return NextResponse.json({ slots: [] });
  const fromIso = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
  const toIso = new Date(Date.UTC(y, m - 1, d + 2, 0, 0, 0)).toISOString();
  const booked = await getConfirmedBookingsRangesForService(tenantId, svc.data.id, fromIso, toIso);
  const slots = generateSlotsForDay({
    dateLocal,
    availability: av,
    durationMin: duration,
    tz,
    bookedRanges: booked,
  });
  return NextResponse.json({
    slots,
    weekday_label: WEEKDAY_LABELS[weekday],
    available_count: slots.filter((s) => s.available).length,
  });
}
