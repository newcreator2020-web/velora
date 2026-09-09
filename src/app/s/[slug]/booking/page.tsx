import type { Metadata } from "next";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";
import { getBusinessAvailability } from "@/lib/server/booking";
import BookingClientForm from "./BookingClientForm";
import type { Database } from "@/types/supabase";

type ServiceRow = Database["public"]["Tables"]["services"]["Row"] & {
  duration_minutes: number | null;
};

interface PublicBookingPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const revalidate = 0;

const CSRF_COOKIE_NAME = "velora_csrf_token";

function safeToken(v: string | undefined): string {
  if (v && v.length >= 16) return v;
  return randomUUID().replace(/-/g, "");
}

export async function generateMetadata(props: PublicBookingPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { title: "Prenotazione non disponibile" };
  const result = await resolvePublicTenant({ slug: parsed.data });
  if (result._tag !== "Found") return { title: "Prenotazione non disponibile" };
  const s = result.site;
  const base = s.canonicalPath || `/s/${encodeURIComponent(s.slug)}`;
  const bookingCanonical = base.endsWith("/") ? `${base}booking` : `${base}/booking`;
  return {
    title: `Prenota — ${s.businessName}`,
    description: `Prenota un appuntamento online da ${s.businessName}.`,
    alternates: { canonical: bookingCanonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: `Prenota — ${s.businessName}`,
      description: `Prenota un appuntamento online da ${s.businessName}.`,
      url: bookingCanonical,
      locale: s.locale,
      siteName: s.businessName,
    },
  };
}

export default async function PublicBookingPage(props: PublicBookingPageProps) {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const result = await resolvePublicTenant({ slug: parsed.data });
  if (result._tag !== "Found") notFound();
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
  const ck = await cookies();
  const csrfToken = safeToken(ck.get(CSRF_COOKIE_NAME)?.value);
  const sp = (await props.searchParams) ?? {};
  const existing = sp["_csrf"] as string | undefined;
  if (!existing || existing.length < 16 || existing !== csrfToken) {
    redirect(`/s/${encodeURIComponent(site.slug)}/booking?_csrf=${encodeURIComponent(csrfToken)}`);
  }
  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 pb-20 pt-12">
      <div className="mx-auto max-w-3xl px-4">
        <nav className="mb-6 text-sm text-neutral-600">
          <a
            className="underline underline-offset-4 hover:text-neutral-900"
            href={site.canonicalPath || `/s/${encodeURIComponent(site.slug)}`}
          >
            ← Torna a {site.businessName}
          </a>
        </nav>
      </div>
      <BookingClientForm
        slug={site.slug}
        csrfToken={csrfToken}
        services={(services.data ?? []) as ServiceRow[]}
        availability={availability}
        timezone={site.timezone || "Europe/Rome"}
      />
    </main>
  );
}
