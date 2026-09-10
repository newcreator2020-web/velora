import type { PublicSection, LocationSection } from "@/lib/server/content-engine";

export function LocationSectionComponent(s: PublicSection) {
  const sec = s as LocationSection;
  const variant = sec.variant === "minimal" ? "minimal" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};

  const headline = settings.headline ?? "Dove Siamo";
  const showDirectionsButton = settings.showDirectionsButton !== false;
  const ctaLabel = settings.ctaLabel ?? "Indicazioni Stradali";

  const address = data.address ?? null;
  const city = data.city ?? null;
  const province = data.province ?? null;
  const postalCode = data.postalCode ?? null;
  const countryCode = data.countryCode ?? "IT";
  const latitude = data.latitude ?? null;
  const longitude = data.longitude ?? null;

  const fullAddress = [address, postalCode, city, province].filter(Boolean).join(", ");
  const mapQuery = encodeURIComponent(fullAddress || (city ?? ""));
  const directionsUrl =
    latitude && longitude
      ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;

  if (variant === "minimal") {
    if (!address && !city) return null;

    return (
      <section
        data-section="location"
        data-variant="minimal"
        className="w-full py-10 md:py-14 px-6 bg-muted/30"
      >
        <div className="max-w-4xl mx-auto">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="inline-flex items-center justify-center rounded-xl bg-[var(--p)]/10 text-[var(--p)] p-3 shrink-0">
                  <svg
                    className="w-6 h-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  <h3
                    className="text-sm md:text-base text-foreground uppercase tracking-wider"
                    style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                  >
                    {headline}
                  </h3>
                  <p className="text-base md:text-lg text-foreground leading-snug break-words">
                    {fullAddress}
                  </p>
                </div>
              </div>
              {showDirectionsButton ? (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] bg-[var(--p)] px-5 md:px-6 text-sm font-semibold text-[var(--p-foreground)] shadow-sm hover:opacity-90 transition duration-[var(--theme-motion-duration)] shrink-0 self-start md:self-center"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18.6 16.4c.8-.8.8-2 0-2.8l-5.9-5.9c-.8-.8-2-.8-2.8 0l-5.9 5.9c-.8.8-.8 2 0 2.8.8.8 2 .8 2.8 0L12 11.3l5.2 5.2c.7.7 2 .7 2.8-.2z" />
                  </svg>
                  {ctaLabel}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="location"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-background"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10 md:mb-12">
          <h2
            className="text-3xl md:text-5xl text-foreground tracking-tight"
            style={{ fontWeight: "var(--theme-font-weight-heading)" }}
          >
            {headline}
          </h2>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card overflow-hidden shadow-lg">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="relative aspect-[4/3] lg:aspect-auto min-h-[280px] md:min-h-[380px] bg-muted/50 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[var(--p)]/10 via-muted/20 to-muted/40">
                <div className="relative w-full h-full">
                  <div className="absolute inset-0 opacity-20">
                    <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                          <path
                            d="M 40 0 L 0 0 0 40"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="0.5"
                            className="text-foreground/30"
                          />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="relative">
                        <div
                          className="absolute inset-0 bg-[var(--p)]/20 rounded-full animate-ping opacity-60"
                          style={{ width: "80px", height: "80px" }}
                        />
                        <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--p)] text-[var(--p-foreground)] shadow-xl">
                          <svg
                            className="w-8 h-8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground font-medium">
                        {countryCode}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {latitude && longitude ? (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-auto inline-flex h-10 items-center justify-center rounded-[var(--radius)] bg-background/95 backdrop-blur px-4 text-xs font-semibold text-foreground shadow hover:bg-background transition duration-[var(--theme-motion-duration)] border border-border"
                >
                  <svg
                    className="w-3.5 h-3.5 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Apri Mappa
                </a>
              ) : null}
            </div>

            <div className="p-6 md:p-10 flex flex-col justify-center">
              <div className="flex flex-col gap-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex items-center justify-center rounded-xl bg-[var(--p)]/10 text-[var(--p)] p-3 shrink-0">
                    <svg
                      className="w-6 h-6"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                      Indirizzo
                    </span>
                    {address ? (
                      <p className="text-base md:text-lg text-foreground leading-snug break-words">
                        {address}
                      </p>
                    ) : null}
                    {[postalCode, city, province].filter(Boolean).length > 0 ? (
                      <p className="text-sm md:text-base text-muted-foreground">
                        {[postalCode, city, province].filter(Boolean).join(" ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                {latitude && longitude ? (
                  <div className="flex items-start gap-4">
                    <div className="inline-flex items-center justify-center rounded-xl bg-[var(--p)]/10 text-[var(--p)] p-3 shrink-0">
                      <svg
                        className="w-6 h-6"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                        Coordinate
                      </span>
                      <p className="text-sm md:text-base text-foreground font-mono tabular-nums">
                        {latitude.toFixed?.(6) ?? latitude}, {longitude.toFixed?.(6) ?? longitude}
                      </p>
                    </div>
                  </div>
                ) : null}

                {showDirectionsButton ? (
                  <div className="pt-2">
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-12 items-center justify-center rounded-[var(--radius)] bg-[var(--p)] px-7 text-sm md:text-base font-semibold text-[var(--p-foreground)] shadow-md hover:opacity-90 transition duration-[var(--theme-motion-duration)]"
                    >
                      <svg
                        className="w-4 h-4 mr-2"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18.6 16.4c.8-.8.8-2 0-2.8l-5.9-5.9c-.8-.8-2-.8-2.8 0l-5.9 5.9c-.8.8-.8 2 0 2.8.8.8 2 .8 2.8 0L12 11.3l5.2 5.2c.7.7 2 .7 2.8-.2z" />
                      </svg>
                      {ctaLabel}
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
