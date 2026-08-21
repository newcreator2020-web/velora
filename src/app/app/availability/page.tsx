import { redirect } from "next/navigation";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AvailabilitySettingsClient from "./AvailabilitySettingsClient";

const WEEKDAYS = [
  { n: 1, label: "Lunedì" },
  { n: 2, label: "Martedì" },
  { n: 3, label: "Mercoledì" },
  { n: 4, label: "Giovedì" },
  { n: 5, label: "Venerdì" },
  { n: 6, label: "Sabato" },
  { n: 0, label: "Domenica" },
] as const;

export default async function AvailabilityPage() {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  const authz = await requireTenantRole("manager");
  const supabase = await createSupabaseServerClient();
  const rows = await supabase
    .from("business_availability")
    .select("weekday,enabled,start_time,end_time")
    .eq("tenant_id", authz.tenant.id)
    .order("weekday");
  if (rows.error)
    return (
      <main id="main-content" className="p-6">
        Errore.
      </main>
    );
  type AvRow = NonNullable<typeof rows.data>[number];
  const byDay = new Map<number, AvRow>();
  (rows.data ?? []).forEach((r: AvRow) => byDay.set(r.weekday, r));
  const initial = WEEKDAYS.map((w) => {
    const r = byDay.get(w.n);
    return {
      weekday: w.n,
      label: w.label,
      enabled: r?.enabled ?? (w.n >= 1 && w.n <= 5),
      start_time: r?.start_time ?? "09:00",
      end_time: r?.end_time ?? (w.n === 6 ? "13:00" : "18:00"),
    };
  });
  return (
    <main id="main-content" className="mx-auto max-w-4xl p-4 sm:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Orari apertura</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Configura gli orari settimanali. I nuovi slot di prenotazione saranno calcolati in base
            a questa configurazione.
          </p>
        </div>
        <a
          href="/app/bookings"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          ← Appuntamenti
        </a>
      </header>
      <AvailabilitySettingsClient initialRows={initial} />
    </main>
  );
}
