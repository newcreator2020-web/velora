import type { FeaturesCtaSection } from "@/lib/server/content-engine";

type FeatureItem = Exclude<FeaturesCtaSection["data"]["features"], null>[number];

const DEFAULT_FEATURES: readonly FeatureItem[] = [
  {
    icon: "⚡",
    title: "Veloce e semplice",
    description: "Prenota in pochi clic, senza attese o chiamate telefoniche.",
  },
  {
    icon: "🎯",
    title: "Qualità garantita",
    description: "Servizi selezionati e professionisti qualificati per te.",
  },
  {
    icon: "💎",
    title: "Prezzi trasparenti",
    description: "Nessuna sorpresa: il prezzo che vedi è quello che paghi.",
  },
  {
    icon: "✅",
    title: "Flessibile e sicuro",
    description: "Modifica o cancella senza penali fino a 24h prima.",
  },
] as const;

export function FeaturesCtaSectionComponent(section: FeaturesCtaSection) {
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Perché sceglierci";
  const subheadline = section.settings.subheadline ?? null;
  const ctaPrimaryLabel = section.settings.ctaPrimaryLabel ?? "Prenota ora";
  const ctaPrimaryTarget = section.settings.ctaPrimaryTarget ?? "";
  const ctaSecondaryLabel = section.settings.ctaSecondaryLabel ?? "Scopri di più";
  const ctaSecondaryTarget = section.settings.ctaSecondaryTarget ?? "";
  const variant = section.variant === "split" ? "split" : "minimal";
  const features =
    section.data.features && section.data.features.length > 0
      ? section.data.features
      : (DEFAULT_FEATURES as readonly FeatureItem[] as FeatureItem[]);

  if (variant === "split") {
    return (
      <section
        data-section="features_cta"
        data-variant="split"
        aria-labelledby="site-features-cta-title"
        className="section w-full py-16 md:py-24 px-6 bg-background"
      >
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div className="flex flex-col gap-5 text-left">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-features-cta-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground break-words leading-[1.1]"
            >
              {headline}
            </h2>
            {subheadline ? (
              <p className="text-base md:text-lg text-muted-foreground break-words leading-relaxed">
                {subheadline}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 pt-4">
              {ctaPrimaryLabel ? (
                <a
                  href={ctaPrimaryTarget || "#booking"}
                  className="inline-flex items-center justify-center rounded-xl bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 min-h-[48px] transition shadow"
                >
                  {ctaPrimaryLabel}
                </a>
              ) : null}
              {ctaSecondaryLabel ? (
                <a
                  href={ctaSecondaryTarget || "#services"}
                  className="inline-flex items-center justify-center rounded-xl bg-transparent px-7 py-3.5 text-sm font-semibold text-foreground border-2 border-border hover:bg-muted min-h-[48px] transition"
                >
                  {ctaSecondaryLabel}
                </a>
              ) : null}
            </div>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
            {features.slice(0, 4).map((f, idx) => {
              return (
                <li
                  key={`feat-split-${idx}-${f.title}`}
                  className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-2 shadow-sm"
                >
                  <span className="text-3xl mb-1" aria-hidden="true">
                    {f.icon ?? "✅"}
                  </span>
                  <h3 className="text-base font-bold text-foreground break-words">{f.title}</h3>
                  {f.description ? (
                    <p className="text-xs md:text-sm text-muted-foreground break-words leading-relaxed">
                      {f.description}
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

  return (
    <section
      data-section="features_cta"
      data-variant="minimal"
      aria-labelledby="site-features-cta-title"
      className="section w-full py-14 md:py-20 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="max-w-2xl mb-10 md:mb-12">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-features-cta-title"
            className="font-bold tracking-tight text-foreground break-words text-3xl md:text-4xl mb-4"
          >
            {headline}
          </h2>
          {subheadline ? (
            <p className="text-base md:text-lg text-muted-foreground break-words">{subheadline}</p>
          ) : null}
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 md:mb-12">
          {features.slice(0, 4).map((f, idx) => {
            return (
              <li
                key={`feat-min-${idx}-${f.title}`}
                className="flex flex-col gap-2 p-4 rounded-xl hover:bg-card transition-colors border border-transparent hover:border-border"
              >
                <span className="text-2xl" aria-hidden="true">
                  {f.icon ?? "✅"}
                </span>
                <h3 className="text-base font-semibold text-foreground break-words">{f.title}</h3>
                {f.description ? (
                  <p className="text-sm text-muted-foreground break-words">{f.description}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3">
          {ctaPrimaryLabel ? (
            <a
              href={ctaPrimaryTarget || "#booking"}
              className="inline-flex items-center justify-center rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90 min-h-[40px] transition"
            >
              {ctaPrimaryLabel}
            </a>
          ) : null}
          {ctaSecondaryLabel ? (
            <a
              href={ctaSecondaryTarget || "#services"}
              className="inline-flex items-center justify-center rounded-lg bg-transparent px-5 py-2.5 text-sm font-medium text-foreground border border-border hover:bg-background min-h-[40px] transition"
            >
              {ctaSecondaryLabel}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
