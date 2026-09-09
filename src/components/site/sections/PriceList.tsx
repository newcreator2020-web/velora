import type { PriceListSection } from "@/lib/server/content-engine";

function formatPrice(value: number | null, currency: string): string | null {
  if (value == null) return null;
  try {
    const nf = new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
    return nf.format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function PriceListSectionComponent(section: PriceListSection) {
  if (!section.data.services || section.data.services.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Listino Prezzi";
  const variant = section.variant === "table" ? "table" : "cards";
  const services = section.data.services;

  if (variant === "table") {
    return (
      <section
        data-section="price_list"
        data-variant="table"
        aria-labelledby="site-price-list-title"
        className="section w-full py-16 md:py-20 px-6 bg-background"
      >
        <div className="max-w-4xl mx-auto">
          <div className="mb-10 md:mb-12 text-left">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-price-list-title"
              className="text-2xl md:text-4xl font-bold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
            <table className="w-full text-sm md:text-base text-left">
              <thead className="bg-muted/60 border-b border-border">
                <tr>
                  <th className="px-5 md:px-6 py-4 font-semibold text-foreground">Servizio</th>
                  <th className="px-5 md:px-6 py-4 font-semibold text-foreground hidden sm:table-cell">
                    Durata
                  </th>
                  <th className="px-5 md:px-6 py-4 font-semibold text-foreground text-right">
                    Prezzo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {services.map((svc, idx) => {
                  const priceFixed =
                    svc.price != null ? formatPrice(svc.price, svc.currency) : null;
                  const priceFrom =
                    svc.priceFrom != null ? formatPrice(svc.priceFrom, svc.currency) : null;
                  const hasBadge = !priceFixed && priceFrom;
                  return (
                    <tr
                      key={`pl-${idx}-${svc.name}`}
                      className="bg-card hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 md:px-6 py-4 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground break-words">
                              {svc.name}
                            </span>
                            {hasBadge ? (
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                da
                              </span>
                            ) : null}
                          </div>
                          {svc.description ? (
                            <p className="text-xs md:text-sm text-muted-foreground break-words whitespace-pre-wrap">
                              {svc.description}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 md:px-6 py-4 align-top text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                        {svc.durationMinutes ? `${svc.durationMinutes} min` : "—"}
                      </td>
                      <td className="px-5 md:px-6 py-4 align-top text-right font-bold text-primary whitespace-nowrap">
                        {priceFixed ?? priceFrom ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="price_list"
      data-variant="cards"
      aria-labelledby="site-price-list-title"
      className="section w-full py-16 md:py-24 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 md:mb-14 text-center">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-price-list-title"
            className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 break-words"
          >
            {headline}
          </h2>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-7">
          {services.map((svc, idx) => {
            const priceFixed = svc.price != null ? formatPrice(svc.price, svc.currency) : null;
            const priceFrom =
              svc.priceFrom != null ? formatPrice(svc.priceFrom, svc.currency) : null;
            const hasBadge = !priceFixed && priceFrom;
            return (
              <li
                key={`pl-card-${idx}-${svc.name}`}
                className="rounded-2xl border border-border bg-card p-6 md:p-7 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg md:text-xl font-bold text-foreground break-words">
                        {svc.name}
                      </h3>
                      {hasBadge ? (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          da
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-lg md:text-xl font-black text-primary whitespace-nowrap shrink-0">
                    {priceFixed ?? priceFrom ?? "—"}
                  </span>
                </div>
                {svc.description ? (
                  <p className="text-sm md:text-[15px] text-muted-foreground break-words whitespace-pre-wrap leading-relaxed">
                    {svc.description}
                  </p>
                ) : null}
                {svc.durationMinutes ? (
                  <div className="mt-auto pt-3 border-t border-border/60 text-xs md:text-sm text-muted-foreground flex items-center justify-between">
                    <span>Durata ~ {svc.durationMinutes} min</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
