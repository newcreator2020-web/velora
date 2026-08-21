import { redirect } from "next/navigation";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import BookingsListClient from "./BookingsListClient";
import type { Database } from "@/types/supabase";

type BookingWithService = Database["public"]["Tables"]["bookings"]["Row"] & {
  services: { name: string; duration_minutes: number | null } | null;
};

export default async function AppBookingsPage() {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantRole("staff");
  const tenant = ctx.tenant;
  const supabase = await createSupabaseServerClient();
  const bookings = await supabase
    .from("bookings")
    .select("*,services(name,duration_minutes)")
    .eq("tenant_id", tenant.id)
    .order("starts_at", { ascending: false });
  if (bookings.error) {
    return (
      <main id="main-content" className="p-6">
        Errore nel caricamento.
      </main>
    );
  }
  const canCancel = ctx.membership.role === "owner" || ctx.membership.role === "manager";
  return (
    <main id="main-content" className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Appuntamenti</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Prenotazioni di {ctx.business_profile?.display_name ?? tenant.slug ?? "la tua attività"}
            .
          </p>
        </div>
        <nav className="text-sm">
          <a
            href="/app/availability"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Orari apertura
          </a>
        </nav>
      </header>
      <BookingsListClient
        bookings={(bookings.data ?? []) as BookingWithService[]}
        timezone={ctx.business_profile?.timezone ?? "Europe/Rome"}
        canCancel={canCancel}
      />
    </main>
  );
}
