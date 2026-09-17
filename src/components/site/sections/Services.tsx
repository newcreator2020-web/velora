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
  const rawVariant = String(section.variant ?? "");
  const variant:
    "list" | "editorial_list" | "category_tabs" | "image_services" | "compact_list" | "cards" =
    rawVariant === "list" ||
    rawVariant === "editorial_list" ||
    rawVariant === "category_tabs" ||
    rawVariant === "image_services" ||
    rawVariant === "compact_list"
      ? rawVariant
      : "cards";

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
          <ul className="flex flex-col divide-y divide-border list-none pl-0">
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

  if (variant === "editorial_list") {
    return (
      <section
        id="services"
        data-section="services"
        data-variant="editorial_list"
        aria-labelledby="site-services-title"
        className="w-full py-16 md:py-28 px-6 bg-background"
      >
        <div className="max-w-5xl mx-auto grid md:grid-cols-12 gap-10 md:gap-16">
          <header className="md:col-span-4 md:sticky md:top-24 self-start">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/85 mb-4">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-services-title"
              className="text-3xl md:text-5xl font-light tracking-tight text-foreground leading-[1.02] break-words"
              style={{ fontFamily: "var(--theme-font-family-heading)" }}
            >
              {headline}
            </h2>
          </header>
          <ol className="md:col-span-8 flex flex-col list-none pl-0">
            {section.data.services.map((svc, idx) => {
              const price = formatPrice(svc.priceFrom, svc.currency);
              const num = String(idx + 1).padStart(2, "0");
              return (
                <li
                  key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                  className="group grid grid-cols-12 gap-4 md:gap-6 py-6 md:py-7 border-t border-border first:border-t-0 last:border-b border-border/60"
                >
                  <div className="col-span-2 md:col-span-1 flex items-start">
                    <span
                      className="text-xs md:text-sm font-semibold tracking-wider text-primary/80 tabular-nums"
                      aria-hidden
                    >
                      {num}
                    </span>
                  </div>
                  <div className="col-span-10 md:col-span-8 flex flex-col gap-2">
                    <h3 className="text-lg md:text-xl font-semibold text-foreground break-words">
                      {svc.name}
                    </h3>
                    {svc.description ? (
                      <p className="text-sm md:text-[15px] text-muted-foreground break-words whitespace-pre-wrap leading-relaxed">
                        {svc.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="col-span-12 md:col-span-3 flex md:flex-col items-start md:items-end justify-between gap-2 md:gap-1">
                    {price ? (
                      <span className="text-base md:text-lg font-bold text-foreground whitespace-nowrap tabular-nums">
                        {price}
                      </span>
                    ) : null}
                    {svc.durationMinutes ? (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {svc.durationMinutes} min
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    );
  }

  if (variant === "category_tabs") {
    const buckets = new Map<string, typeof section.data.services>();
    for (const svc of section.data.services) {
      const key = "Tutti i servizi";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(svc);
    }
    return (
      <section
        id="services"
        data-section="services"
        data-variant="category_tabs"
        aria-labelledby="site-services-title"
        className="w-full py-16 md:py-24 px-6 bg-muted/20"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 md:mb-14">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/85 mb-3">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-services-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <div className="space-y-10">
            {Array.from(buckets.entries()).map(([cat, list]) => (
              <div
                key={cat}
                className="rounded-3xl bg-card border border-border p-6 md:p-9 shadow-sm"
              >
                <div className="mb-6 md:mb-8 flex items-end justify-between gap-4">
                  <h3
                    className="text-xl md:text-2xl font-bold text-foreground tracking-tight"
                    style={{ fontFamily: "var(--theme-font-family-heading)" }}
                  >
                    {cat}
                  </h3>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {list.length} trattamenti
                  </span>
                </div>
                <ul className="divide-y divide-border/80 rounded-xl border border-border/70 bg-background overflow-hidden list-none pl-0">
                  {list.map((svc) => {
                    const price = formatPrice(svc.priceFrom, svc.currency);
                    return (
                      <li
                        key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                        className="px-4 md:px-6 py-4 md:py-5 flex flex-col md:flex-row md:items-center gap-3 md:gap-6"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm md:text-base font-semibold text-foreground break-words">
                            {svc.name}
                          </h4>
                          {svc.description ? (
                            <p className="text-xs md:text-sm text-muted-foreground mt-1 break-words whitespace-pre-wrap">
                              {svc.description}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center md:justify-end gap-2 md:gap-4 shrink-0">
                          {svc.durationMinutes ? (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              Durata · {svc.durationMinutes} min
                            </span>
                          ) : null}
                          {price ? (
                            <span className="text-sm md:text-base font-bold text-primary whitespace-nowrap tabular-nums">
                              · {price}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === "image_services") {
    return (
      <section
        id="services"
        data-section="services"
        data-variant="image_services"
        aria-labelledby="site-services-title"
        className="w-full py-16 md:py-24 px-6 bg-background"
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-10 md:mb-14 text-center">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/85 mb-3">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-services-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7 list-none pl-0">
            {section.data.services.map((svc, i) => {
              const price = formatPrice(svc.priceFrom, svc.currency);
              return (
                <li
                  key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                  className="group rounded-3xl border border-border bg-card shadow-sm overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                >
                  <div
                    className="relative aspect-[4/3] overflow-hidden"
                    aria-hidden
                    style={{
                      background: `linear-gradient(${135 + ((i * 27) % 180)}deg, color-mix(in srgb, var(--primary) 38%, var(--background)), color-mix(in srgb, var(--primary) 14%, var(--muted)))`,
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-5xl md:text-6xl font-black text-background/90 tracking-tighter drop-shadow-sm">
                        {String.fromCodePoint(0x2728)}
                      </span>
                    </div>
                  </div>
                  <div className="p-6 md:p-7 flex flex-col gap-4 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3
                        className="text-lg md:text-xl font-bold text-foreground break-words"
                        style={{ fontFamily: "var(--theme-font-family-heading)" }}
                      >
                        {svc.name}
                      </h3>
                      {price ? (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-background border border-border px-3 py-1 text-xs md:text-sm font-bold text-foreground tabular-nums">
                          {price}
                        </span>
                      ) : null}
                    </div>
                    {svc.description ? (
                      <p className="text-sm md:text-[15px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed flex-1">
                        {svc.description}
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between pt-3 mt-auto border-t border-border/60">
                      {svc.durationMinutes ? (
                        <span className="text-xs font-semibold text-muted-foreground">
                          Durata · {svc.durationMinutes} min
                        </span>
                      ) : (
                        <span />
                      )}
                      <a
                        href="#booking"
                        className="text-xs md:text-sm font-bold text-primary hover:opacity-80 transition inline-flex items-center gap-1"
                      >
                        Prenota
                        <span aria-hidden>→</span>
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    );
  }

  if (variant === "compact_list") {
    return (
      <section
        id="services"
        data-section="services"
        data-variant="compact_list"
        aria-labelledby="site-services-title"
        className="w-full py-12 md:py-20 px-6 bg-muted/30"
      >
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 md:mb-10 text-center">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/85 mb-2">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-services-title"
              className="text-2xl md:text-4xl font-bold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <ul className="rounded-2xl border border-border bg-card shadow-sm divide-y divide-border/70 overflow-hidden list-none pl-0">
            {section.data.services.map((svc) => {
              const price = formatPrice(svc.priceFrom, svc.currency);
              return (
                <li
                  key={svc.name + "-" + (svc.durationMinutes ?? "0")}
                  className="flex items-center gap-4 md:gap-6 px-4 md:px-6 py-3.5 md:py-4 hover:bg-muted/40 transition"
                >
                  <span className="h-2 w-2 rounded-full bg-primary/70 shrink-0" aria-hidden />
                  <div className="flex-1 min-w-0 flex items-baseline gap-3">
                    <h3 className="text-sm md:text-base font-semibold text-foreground truncate">
                      {svc.name}
                    </h3>
                    <div
                      className="min-w-0 flex-1 border-b border-dotted border-border/80 translate-y-[-4px]"
                      aria-hidden
                    />
                    <div className="flex items-center gap-3 md:gap-4 shrink-0">
                      {svc.durationMinutes ? (
                        <span className="text-[11px] md:text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {svc.durationMinutes}m
                        </span>
                      ) : null}
                      {price ? (
                        <span className="text-sm md:text-base font-bold text-foreground whitespace-nowrap tabular-nums">
                          {price}
                        </span>
                      ) : null}
                    </div>
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-7 list-none pl-0">
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
