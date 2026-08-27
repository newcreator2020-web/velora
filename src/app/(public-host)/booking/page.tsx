import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePublicTenant } from "@/lib/server/site-engine";
import { getBusinessAvailability } from "@/lib/server/booking";
import BookingClientForm from "@/app/s/[slug]/booking/BookingClientForm";
import type { Database } from "@/types/supabase";

export const dynamic = "force-dynamic";

type ServiceRow = Database["public"]["Tables"]["services"]["Row"] & {
  duration_minutes: number | null;
};

async function getHostTenant() {
  const h = await headers();
  const rawHost =
    (process.env.NODE_ENV !== "production" ? (h.get("x-velora-host") ?? undefined) : undefined) ??
    h.get("host") ??
    "";
  const hostname = rawHost.split(":")[0] ?? "";
  if (!hostname) return null;
  const result = await resolvePublicTenant({ hostname });
  if (result._tag !== "Found") return null;
  return { hostname, result };
}

export async function generateMetadata(): Promise<Metadata> {
  const info = await getHostTenant();
  if (!info) return { title: "Prenotazione non disponibile" };
  return {
    title: `Prenota — ${info.result.site.businessName}`,
    description: `Prenota un appuntamento online da ${info.result.site.businessName}.`,
    robots: { index: true, follow: true },
  };
}

export default async function HostPublicBookingPage() {
  const info = await getHostTenant();
  if (!info) notFound();
  const { result } = info;
  const { site, tenantId } = result;
  const supabase = await createSupabaseServerClient();
  const services = await supabase
    .from("services")
    .select("id,name,duration_minutes,price_from,currency,active")
    .eq("tenant_id", tenantId)
    .order("position")
    .order("name");
  if (services.error) notFound();
  const availability = await getBusinessAvailability(tenantId);
  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 pb-20 pt-12">
      <div className="mx-auto max-w-3xl px-4">
        <nav className="mb-6 text-sm text-neutral-600">
          <Link className="underline underline-offset-4 hover:text-neutral-900" href="/">
            ← Torna a {site.businessName}
          </Link>
        </nav>
      </div>
      <BookingClientForm
        slug={site.slug}
        services={(services.data ?? []) as ServiceRow[]}
        availability={availability}
        timezone={site.timezone || "Europe/Rome"}
        slotsApiBase="/booking/slots"
      />
    </main>
  );
}
