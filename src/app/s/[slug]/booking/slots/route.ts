import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WEEKDAY_LABELS } from "@/lib/server/booking";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function labelForIso(iso: string, tz?: string): string {
  try {
    const d = new Date(iso);
    if (tz) {
      const dtf = new Intl.DateTimeFormat("it-IT", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      return dtf.format(d);
    }
    return fmt.format(d);
  } catch {
    return iso.substring(11, 16);
  }
}

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
  const resource_slug = url.searchParams.get("resource_slug") ?? "any";
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
  const tz = site.timezone || "Europe/Rome";
  const parts = dateStr.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const weekday = new Date(y, m - 1, d).getDay();
  const windowStart = `${parts[0]}-${parts[1]}-${parts[2]}`;
  const windowEnd = windowStart;
  const { data, error } = await supabase.rpc("public_slot_get_available_v2", {
    p_slug: parsed.data,
    p_service_id: service_id,
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_resource_slug: resource_slug,
  });
  if (error) {
    return NextResponse.json({ slots: [] }, { status: 500 });
  }
  const rows = ((data as unknown[]) ?? []) as Array<{
    starts_at: string;
    ends_at: string;
    resource_slug: string | null;
    resource_display_name: string | null;
  }>;
  const slots = rows.map((r) => {
    const iso = new Date(r.starts_at).toISOString();
    return {
      iso,
      label: labelForIso(iso, tz),
      available: true,
      resource_slug: r.resource_slug ?? null,
      resource_display_name: r.resource_display_name ?? null,
    };
  });
  return NextResponse.json({
    slots,
    weekday_label: WEEKDAY_LABELS[weekday],
    available_count: slots.length,
  });
}
