"use client";

import type { BookingWidgetSection } from "@/lib/server/content-engine";
import dynamic from "next/dynamic";

const PublicBookingForm = dynamic(() => import("@/app/s/[slug]/booking/BookingClientForm"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="booking-card rounded-2xl border border-border bg-background p-6 text-sm text-muted"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin"
          aria-hidden="true"
        />
        <span>Caricamento form prenotazione…</span>
      </div>
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
        className="sec w-full bg-background"
      >
        <div className="container container-default">
          <div className="max-w-3xl mx-auto">
            <h2 id="site-booking-widget-title" className="typo-h2 mb-3">
              {headline}
            </h2>
            <p className="typo-body text-muted">
              Sito non ancora pubblicato completamente. Torna più tardi.
            </p>
          </div>
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
        className="sec w-full bg-muted/30"
      >
        <div className="container container-default">
          <div className="max-w-3xl mx-auto booking-card rounded-2xl border border-border bg-background shadow-sm p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 reveal">
            <div className="flex-1">
              {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
              <h2 id="site-booking-widget-title" className="typo-h2 mb-3 break-words">
                {headline}
              </h2>
              {subheadline ? (
                <p className="typo-body text-muted break-words">{subheadline}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 shrink-0 w-full md:w-auto">
              <a href={bookingHref} className="btn btn-primary btn-lg w-full md:w-auto btn-motion">
                Prenota ora
              </a>
              <a
                href={`${bookingHref}#services`}
                className="btn btn-outline btn-lg w-full md:w-auto btn-motion"
              >
                Scopri i servizi
              </a>
            </div>
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
      className="sec w-full bg-muted/20"
    >
      <div className="container container-default">
        <div className="max-w-3xl mx-auto">
          <header className="mb-8 reveal">
            {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
            <h2 id="site-booking-widget-title" className="typo-display-h2 mb-3 break-words">
              {headline}
            </h2>
            {subheadline ? <p className="typo-lead text-muted break-words">{subheadline}</p> : null}
          </header>
          <PublicBookingForm
            slug={slug}
            services={services}
            availability={availability}
            timezone={timezone}
          />
        </div>
      </div>
    </section>
  );
}
