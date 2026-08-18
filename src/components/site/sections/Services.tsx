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
  return (
    <section aria-labelledby="site-services-title" className="w-full py-16 px-6 bg-white">
      <div className="max-w-5xl mx-auto">
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-services-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-10 break-words"
        >
          {headline}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {section.data.services.map((svc) => {
            const price = formatPrice(svc.priceFrom, svc.currency);
            return (
              <li
                key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                className="rounded-lg border border-border p-5 shadow-sm bg-background flex flex-col gap-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground break-words">{svc.name}</h3>
                  {price ? (
                    <span className="text-sm font-semibold text-primary whitespace-nowrap">
                      da {price}
                    </span>
                  ) : null}
                </div>
                {svc.description ? (
                  <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                    {svc.description}
                  </p>
                ) : null}
                {svc.durationMinutes ? (
                  <p className="text-xs text-muted-foreground">
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
