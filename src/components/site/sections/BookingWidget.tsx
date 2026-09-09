"use client";

import type { BookingWidgetSection } from "@/lib/server/content-engine";
import dynamic from "next/dynamic";

const PublicBookingForm = dynamic(() => import("@/app/s/[slug]/booking/BookingClientForm"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500"
    >
      Caricamento form prenotazione…
    </div>
  ),
});

export function BookingWidgetSectionComponent(section: BookingWidgetSection) {
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Prenota un appuntamento";
  const subheadline = section.settings.subheadline ?? null;
  const variant = section.variant === "full" ? "full" : "compact";
  const slug = section.data.slug;
  const bookingHref = slug ? `/s/${encodeURIComponent(slug)}/booking` : "/booking";

  if (!slug) {
    return (
      <section
        id="booking"
        data-section="booking_widget"
        data-variant="fallback"
        aria-labelledby="site-booking-widget-title"
        className="section w-full py-16 px-6 bg-white"
      >
        <div className="max-w-3xl mx-auto">
          <h2 id="site-booking-widget-title" className="text-2xl font-bold text-foreground mb-3">
            {headline}
          </h2>
          <p className="text-muted-foreground">
            Sito non ancora pubblicato completamente. Torna più tardi.
          </p>
        </div>
      </section>
    );
  }

  if (variant === "compact") {
    return (
      <section
        id="booking"
        data-section="booking_widget"
        data-variant="compact"
        aria-labelledby="site-booking-widget-title"
        className="section w-full py-16 px-6 bg-gradient-to-br from-neutral-50 to-white"
      >
        <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-white p-8 md:p-10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex-1">
            {eyebrow ? (
              <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-booking-widget-title"
              className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-3 break-words"
            >
              {headline}
            </h2>
            {subheadline ? (
              <p className="text-sm md:text-base text-muted-foreground break-words">
                {subheadline}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 shrink-0 w-full md:w-auto">
            <a
              href={bookingHref}
              className="inline-flex items-center justify-center rounded-xl bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:bg-neutral-800 min-h-[48px] transition w-full md:w-auto"
            >
              Prenota ora
            </a>
            <a
              href={`${bookingHref}#services`}
              className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-neutral-900 border border-neutral-300 hover:bg-neutral-50 min-h-[48px] transition w-full md:w-auto"
            >
              Scopri i servizi
            </a>
          </div>
        </div>
      </section>
    );
  }

  const services = (section.data.services ?? []) as {
    id: string;
    name: string;
    duration_minutes: number | null;
    price_from: number | null;
    currency: string;
    active: boolean;
  }[];

  const availability = (section.data.availability ?? []) as {
    weekday: number;
    enabled: boolean;
    start_time: string;
    end_time: string;
  }[];

  const timezone = section.data.timezone ?? "Europe/Rome";

  return (
    <section
      id="booking"
      data-section="booking_widget"
      data-variant="full"
      aria-labelledby="site-booking-widget-title"
      className="section w-full py-16 px-6 bg-neutral-50"
    >
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-2">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-booking-widget-title"
            className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3 break-words"
          >
            {headline}
          </h2>
          {subheadline ? (
            <p className="text-base text-muted-foreground break-words">{subheadline}</p>
          ) : null}
        </div>
        <PublicBookingForm
          slug={slug}
          services={services}
          availability={availability}
          timezone={timezone}
        />
      </div>
    </section>
  );
}
