import { redirect } from "next/navigation";
import Link from "next/link";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { customerBookingsBucketNow } from "@/lib/server/customers";
import BookingsListClient from "./BookingsListClient";
import type { Database } from "@/types/supabase";

type BookingWithService = Database["public"]["Tables"]["bookings"]["Row"] & {
  services: { name: string; duration_minutes: number | null } | null;
  customers?: { id: string; display_name: string } | null;
};

type SearchParams = {
  view?: string;
  status?: string;
  service?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
};

type BookingsPageProps = {
  searchParams?: Promise<SearchParams>;
};

type View = "today" | "upcoming" | "past" | "all";

export default async function AppBookingsPage(props: BookingsPageProps) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantRole("staff");
  const tenant = ctx.tenant;
  const tz = ctx.business_profile?.timezone ?? "Europe/Rome";
  const sp: SearchParams = (await (props.searchParams ?? Promise.resolve({}))) ?? {};
  const view: View =
    sp.view === "upcoming" || sp.view === "past" || sp.view === "all" ? sp.view : "today";

  const supabase = await createSupabaseServerClient();
  const baseQ = supabase
    .from("bookings")
    .select(
      "*,services!bookings_service_id_fkey(name,duration_minutes),customers!bookings_customer_id_fkey(id,display_name)",
    )
    .eq("tenant_id", tenant.id);

  const buckets = customerBookingsBucketNow(tz);
  let filteredQ = baseQ;

  switch (view) {
    case "today":
      filteredQ = filteredQ
        .gte("starts_at", buckets.todayStart.toISOString())
        .lt("starts_at", buckets.todayEnd.toISOString());
      break;
    case "upcoming":
      filteredQ = filteredQ.gte("starts_at", buckets.now.toISOString());
      break;
    case "past":
      filteredQ = filteredQ.lt("starts_at", buckets.now.toISOString());
      break;
    case "all":
    default:
      break;
  }

  if (sp.status) {
    filteredQ = filteredQ.eq("status", sp.status);
  }
  if (sp.service) {
    filteredQ = filteredQ.eq("service_id", sp.service);
  }
  if (sp.dateFrom) {
    filteredQ = filteredQ.gte("starts_at", new Date(sp.dateFrom).toISOString());
  }
  if (sp.dateTo) {
    const end = new Date(sp.dateTo);
    end.setHours(23, 59, 59, 999);
    filteredQ = filteredQ.lte("starts_at", end.toISOString());
  }
  if (sp.q && sp.q.trim().length > 0) {
    const q = `%${sp.q.trim().toLowerCase()}%`;
    filteredQ = filteredQ.or(
      `customer_name.ilike.${q},customer_email.ilike.${q},customer_phone.ilike.${q}`,
    );
  }

  let orderedQ = filteredQ
    .order("starts_at", { ascending: view === "past" ? false : true })
    .limit(200);
  let bookings = await orderedQ;
  if (!bookings.error && (bookings.data?.length ?? 0) === 0 && view === "today") {
    orderedQ = baseQ.order("starts_at", { ascending: true }).limit(200);
    bookings = await orderedQ;
  }
  if (bookings.error) {
    return (
      <main id="main-content" className="p-6">
        <h1>Appuntamenti</h1>
        <p role="alert">Errore nel caricamento. Riprova tra qualche istante.</p>
      </main>
    );
  }

  const services = await supabase
    .from("services")
    .select("id,name")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("name");

  const canOperate = ctx.membership.role === "owner" || ctx.membership.role === "manager";
  return (
    <main id="main-content" className="mx-auto max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Appuntamenti</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Prenotazioni di {ctx.business_profile?.display_name ?? tenant.slug ?? "la tua attività"}
            .
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/app/availability"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Orari apertura
          </Link>
          <Link
            href="/app/customers"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Clienti
          </Link>
        </nav>
      </header>
      <BookingsListClient
        bookings={(bookings.data ?? []) as BookingWithService[]}
        services={(services.data ?? []) as Array<{ id: string; name: string }>}
        timezone={tz}
        canOperate={canOperate}
        role={ctx.membership.role}
        view={view}
        initialFilters={{
          status: sp.status ?? "",
          service: sp.service ?? "",
          q: sp.q ?? "",
          dateFrom: sp.dateFrom ?? "",
          dateTo: sp.dateTo ?? "",
        }}
      />
    </main>
  );
}
