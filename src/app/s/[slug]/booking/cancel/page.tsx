import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";
import { verifyBookingCancelToken } from "@/lib/server/email";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import CancelBookingClient from "./CancelBookingClient";
import type { Database } from "@/types/supabase";

interface CancelBookingPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const revalidate = 0;

export async function generateMetadata(props: CancelBookingPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { title: "Cancellazione prenotazione" };
  const res = await resolvePublicTenant({ slug: parsed.data });
  const businessName = res._tag === "Found" ? res.site.businessName : "Attività locale";
  return {
    title: `Cancella prenotazione — ${businessName}`,
    robots: { index: false, follow: false },
  };
}

export default async function CancelBookingPage(props: CancelBookingPageProps) {
  const { slug } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const token = typeof sp["token"] === "string" ? sp["token"] : null;

  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) notFound();

  const tenant = await resolvePublicTenant({ slug: parsedSlug.data });
  if (tenant._tag !== "Found") notFound();

  const site = tenant.site;
  const backHref = site.canonicalPath || `/s/${encodeURIComponent(site.slug)}`;
  const primaryHex =
    typeof tenant.theme?.theme_primary === "string" && tenant.theme.theme_primary.length > 0
      ? tenant.theme.theme_primary
      : "#0a0a0a";
  const timezone = site.timezone || "Europe/Rome";

  if (!token || token.length < 16) {
    return (
      <CancelBookingClient
        slug={parsedSlug.data}
        token={token ?? ""}
        summary={{
          businessName: site.businessName,
          customerName: null,
          serviceName: null,
          startsAtISO: new Date().toISOString(),
          timezone,
          backHref,
          primaryHex,
        }}
        initialError="TOKEN_INVALID"
      />
    );
  }

  const payload = verifyBookingCancelToken(token);
  if (!payload) {
    return (
      <CancelBookingClient
        slug={parsedSlug.data}
        token={token}
        summary={{
          businessName: site.businessName,
          customerName: null,
          serviceName: null,
          startsAtISO: new Date().toISOString(),
          timezone,
          backHref,
          primaryHex,
        }}
        initialError="TOKEN_INVALID"
      />
    );
  }

  const svc = getSupabaseServiceClient();
  const bQ = await svc
    .from("bookings")
    .select("id,tenant_id,customer_name,customer_email,customer_phone,starts_at,service_id")
    .eq("id", payload.booking_id)
    .maybeSingle();

  if (bQ.error || !bQ.data) {
    return (
      <CancelBookingClient
        slug={parsedSlug.data}
        token={token}
        summary={{
          businessName: site.businessName,
          customerName: null,
          serviceName: null,
          startsAtISO: new Date().toISOString(),
          timezone,
          backHref,
          primaryHex,
        }}
        initialError="NOT_FOUND"
      />
    );
  }

  const booking = bQ.data as Database["public"]["Tables"]["bookings"]["Row"] & {
    service_id?: string | null;
  };
  if (booking.tenant_id !== tenant.tenantId) {
    return (
      <CancelBookingClient
        slug={parsedSlug.data}
        token={token}
        summary={{
          businessName: site.businessName,
          customerName: null,
          serviceName: null,
          startsAtISO: new Date().toISOString(),
          timezone,
          backHref,
          primaryHex,
        }}
        initialError="CROSS_TENANT"
      />
    );
  }

  let serviceName: string | null = null;
  if (booking.service_id && booking.service_id.length > 0) {
    try {
      const svcQ = await svc
        .from("services")
        .select("name")
        .eq("id", booking.service_id)
        .limit(1)
        .maybeSingle();
      if (!svcQ.error && svcQ.data && typeof svcQ.data.name === "string") {
        serviceName = svcQ.data.name;
      }
    } catch {
      // ignore
    }
  }

  return (
    <CancelBookingClient
      slug={parsedSlug.data}
      token={token}
      summary={{
        businessName: site.businessName,
        customerName: booking.customer_name ?? null,
        serviceName,
        startsAtISO: String(booking.starts_at),
        timezone,
        backHref,
        primaryHex,
      }}
    />
  );
}
