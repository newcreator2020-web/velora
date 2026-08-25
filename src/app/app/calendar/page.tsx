import { redirect } from "next/navigation";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCalendarContext } from "@/lib/server/calendar";
import CalendarClient from "./CalendarClient";

type SearchParams = {
  view?: string;
  date?: string;
  resource?: string;
  status?: string;
};

type CalendarPageProps = {
  searchParams?: Promise<SearchParams>;
};

export default async function AppCalendarPage(props: CalendarPageProps) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantRole("staff");

  const sp: SearchParams = (await (props.searchParams ?? Promise.resolve({}))) ?? {};
  const raw: Record<string, string | string[] | undefined> = {
    view: sp.view,
    date: sp.date,
    resource: sp.resource,
    status: sp.status,
  };
  const cal = await resolveCalendarContext(raw);

  const supabase = await createSupabaseServerClient();
  const resourcesRows = await supabase
    .from("staff_resources")
    .select("id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at")
    .eq("tenant_id", ctx.tenant!.id)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("display_name");
  const resources = (resourcesRows.data ?? []) as unknown[];

  const servicesRows = await supabase
    .from("services")
    .select("id,name,active,duration_minutes,currency,price_from")
    .eq("tenant_id", ctx.tenant!.id)
    .eq("active", true)
    .order("position")
    .order("name");
  const services = (servicesRows.data ?? []) as unknown[];

  const initialStatuses = cal.window.statuses;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Calendario</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Visualizza le prenotazioni, chiusure e ferie operative.
          </p>
        </div>
      </header>

      <CalendarClient
        timezone={cal.window.tz}
        initialView={cal.window.view}
        initialAnchor={cal.window.anchor_date}
        initialRangeStart={cal.window.range.iso_start}
        initialRangeEnd={cal.window.range.iso_end}
        initialStatuses={initialStatuses}
        initialResourceIds={cal.window.resource_ids}
        initialResources={
          resources as Array<{
            id: string;
            slug: string | null;
            display_name: string | null;
            active: boolean | null;
            bookable: boolean | null;
            sort_order: number | null;
            color_hex: string | null;
            created_at: string | null;
            updated_at: string | null;
          }>
        }
        initialServices={
          services as Array<{
            id: string;
            name: string;
            active: boolean;
            duration_minutes: number | null;
            currency: string;
            price_from: number | null;
          }>
        }
        membershipRole={cal.membership_role}
      />
    </div>
  );
}
