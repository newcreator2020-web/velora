import type { ServicesSection } from "@/lib/server/content-engine";

function formatPrice(from: number | null, currency: string): string | null {
  if (from == null) return null;
  try {
    const nf = new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
    return nf.format(from);
  } catch {
    return `${from.toFixed(2)} ${currency}`;
  }
}

export function ServicesSectionComponent(section: ServicesSection) {
  if (!section.data.services || section.data.services.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Servizi";
  const variant = section.variant === "list" ? "list" : "cards";

  if (variant === "list") {
    return (
      <section
        id="services"
        data-section="services"
        data-variant="list"
        aria-labelledby="site-services-title"
        className="w-full py-12 md:py-20 px-6 bg-background"
      >
        <div className="max-w-3xl mx-auto">
          <div className="mb-8 md:mb-12 text-left">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-services-title"
              className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {section.data.services.map((svc) => {
              const price = formatPrice(svc.priceFrom, svc.currency);
              return (
                <li
                  key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                  className="py-4 md:py-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-6"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base md:text-lg font-medium text-foreground break-words">
                      {svc.name}
                    </h3>
                    {svc.description ? (
                      <p className="text-xs md:text-sm text-muted-foreground mt-1 break-words whitespace-pre-wrap">
                        {svc.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex sm:flex-col items-end gap-3 shrink-0">
                    {price ? (
                      <span className="text-sm md:text-base font-semibold text-primary whitespace-nowrap">
                        {price}
                      </span>
                    ) : null}
                    {svc.durationMinutes ? (
                      <span className="text-[11px] md:text-xs text-muted-foreground whitespace-nowrap">
                        ~ {svc.durationMinutes} min
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section
      id="services"
      data-section="services"
      data-variant="cards"
      aria-labelledby="site-services-title"
      className="w-full py-16 md:py-24 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 md:mb-14 text-center">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-services-title"
            className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 break-words"
          >
            {headline}
          </h2>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-7">
          {section.data.services.map((svc) => {
            const price = formatPrice(svc.priceFrom, svc.currency);
            return (
              <li
                key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                className="group rounded-2xl border border-border p-6 md:p-7 shadow-sm bg-card hover:shadow-md transition-all duration-200 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h3 className="text-lg md:text-xl font-bold text-foreground break-words">
                    {svc.name}
                  </h3>
                  {price ? (
                    <span className="shrink-0 inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs md:text-sm font-semibold whitespace-nowrap">
                      da {price}
                    </span>
                  ) : null}
                </div>
                {svc.description ? (
                  <p className="text-sm md:text-[15px] text-muted-foreground break-words whitespace-pre-wrap leading-relaxed">
                    {svc.description}
                  </p>
                ) : null}
                {svc.durationMinutes ? (
                  <p className="text-xs text-muted-foreground pt-2 mt-auto border-t border-border/50">
                    Durata ~ {svc.durationMinutes} min
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
