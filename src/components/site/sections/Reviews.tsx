import type { ReviewsSection } from "@/lib/server/content-engine";

const FIXTURE_SLUGS = new Set(["slugo-mtu30v76-1fon", "barbieri-luca", "giulia-hair"]);

type ReviewsSettingsExtra = ReviewsSection["settings"] & {
  isFixtureDemo?: boolean | null | undefined;
  fixtureSlug?: string | null | undefined;
};

function isFixture(section: ReviewsSection): boolean {
  const settings = section.settings as ReviewsSettingsExtra;
  if (settings.isFixtureDemo === true) return true;
  if (settings.fixtureSlug && FIXTURE_SLUGS.has(settings.fixtureSlug)) return true;
  return false;
}

function FixtureDemoBadge() {
  return (
    <div
      role="note"
      className="mb-6 md:mb-10 mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs md:text-sm text-amber-800 dark:text-amber-200"
    >
      <span aria-hidden className="mr-1.5 font-bold">
        ⚠️
      </span>
      <span className="font-semibold">Valutazioni dimostrative interne.</span>{" "}
      <span className="opacity-90">
        Questo sito utilizza dati di esempio per mostrare la funzionalità. Nel tuo sito reale
        compariranno solo le recensioni vere dei tuoi clienti.
      </span>
    </div>
  );
}

function EmptyFixtureState({ headline }: { headline: string }) {
  return (
    <section
      aria-labelledby="site-reviews-empty-title"
      data-section="reviews"
      data-empty="fixture-demo"
      className="w-full py-16 md:py-20 px-6 bg-muted/20"
    >
      <div className="max-w-3xl mx-auto text-center">
        <h2
          id="site-reviews-empty-title"
          className="text-2xl md:text-3xl font-bold text-foreground mb-3 break-words"
        >
          {headline}
        </h2>
        <FixtureDemoBadge />
        <p className="text-sm md:text-base text-muted-foreground mt-2">
          ⚠️ Nessuna recensione di esempio caricata. Compariranno qui quando disponibili.
        </p>
      </div>
    </section>
  );
}

export function ReviewsSectionComponent(section: ReviewsSection) {
  const reviews = (section.data.reviews ?? []).filter(
    (r) => r && typeof r.author === "string" && r.author.length > 0,
  );
  const fixture = isFixture(section);

  if (reviews.length === 0 && !fixture) {
    return null;
  }

  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Recensioni";
  const variant = section.variant === "carousel" ? "carousel" : "cards";

  const avgRatingRaw =
    reviews.length > 0
      ? reviews.reduce(
          (acc, r) =>
            acc + (isFinite(r.rating) ? Math.max(1, Math.min(5, Math.round(r.rating))) : 0),
          0,
        ) / reviews.length
      : NaN;
  const avgDisplay = isFinite(avgRatingRaw) ? avgRatingRaw.toFixed(1) : null;

  if (reviews.length === 0 && fixture) {
    return <EmptyFixtureState headline={headline} />;
  }

  if (variant === "carousel") {
    return (
      <section
        aria-labelledby="site-reviews-title"
        data-section="reviews"
        data-variant="carousel"
        data-fixture={fixture ? "true" : "false"}
        className="w-full py-16 md:py-24 px-6 bg-primary/5"
      >
        <div className="max-w-4xl mx-auto">
          {fixture ? <FixtureDemoBadge /> : null}
          <div className="mb-10 md:mb-14 text-center">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80 mb-3">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-reviews-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-4 break-words"
            >
              {headline}
            </h2>
            {avgDisplay ? (
              <div className="inline-flex items-center gap-3 bg-card px-5 py-3 rounded-full shadow-sm border border-border">
                <div
                  className="text-amber-500 text-xl leading-none"
                  aria-label={`Valutazione media ${avgDisplay} su 5`}
                  role="img"
                >
                  <span aria-hidden>{"★".repeat(5)}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-black text-foreground text-xl leading-none tabular-nums">
                    {avgDisplay}
                  </span>
                  <span className="text-xs text-muted-foreground">/ 5</span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {reviews.length} {reviews.length === 1 ? "recensione" : "recensioni"}
                </span>
              </div>
            ) : null}
          </div>
          <div className="relative">
            <div className="overflow-x-auto pb-6 -mx-6 px-6 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-4 md:gap-6 min-w-max">
                {reviews.map((r, i) => {
                  const safeRating = isFinite(r.rating)
                    ? Math.max(1, Math.min(5, Math.round(r.rating)))
                    : 0;
                  return (
                    <article
                      key={r.author + "-" + i}
                      className="snap-center snap-always w-[85%] sm:w-[60%] md:w-[50%] shrink-0 rounded-2xl border border-border bg-card p-6 md:p-7 shadow-md flex flex-col gap-4"
                    >
                      {safeRating > 0 ? (
                        <div
                          aria-label={`Valutazione ${safeRating} su 5`}
                          role="img"
                          className="text-primary text-xl"
                        >
                          <span aria-hidden="true">
                            {"★".repeat(safeRating)}
                            <span className="text-muted-foreground">
                              {"★".repeat(5 - safeRating)}
                            </span>
                          </span>
                        </div>
                      ) : null}
                      {r.body ? (
                        <p className="text-sm md:text-base text-foreground/90 whitespace-pre-wrap break-words leading-relaxed italic">
                          &ldquo;{r.body}&rdquo;
                        </p>
                      ) : null}
                      <div className="pt-3 mt-auto border-t border-border/60 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {r.author.charAt(0).toUpperCase()}
                        </div>
                        <p className="text-sm font-semibold text-foreground break-words">
                          — {r.author}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="site-reviews-title"
      data-section="reviews"
      data-variant="cards"
      data-fixture={fixture ? "true" : "false"}
      className="w-full py-16 md:py-20 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        {fixture ? <FixtureDemoBadge /> : null}
        <div className="mb-10 md:mb-12">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-reviews-title"
            className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-6 break-words"
          >
            {headline}
          </h2>
          {avgDisplay ? (
            <div className="inline-flex items-center gap-3 bg-card px-4 py-2 rounded-full shadow-sm border border-border mb-4">
              <div
                className="text-amber-500 text-base leading-none"
                aria-label={`Valutazione media ${avgDisplay} su 5`}
                role="img"
              >
                <span aria-hidden>{"★".repeat(5)}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-black text-foreground text-lg leading-none tabular-nums">
                  {avgDisplay}
                </span>
                <span className="text-[11px] text-muted-foreground">/ 5</span>
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {reviews.length} {reviews.length === 1 ? "recensione" : "recensioni"}
              </span>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6" data-reviews>
          {reviews.map((r, i) => {
            const safeRating = isFinite(r.rating)
              ? Math.max(1, Math.min(5, Math.round(r.rating)))
              : 0;
            const headingId = `site-review-${i}-heading`;
            return (
              <article
                key={r.author + "-" + i}
                aria-labelledby={headingId}
                className="rounded-xl border border-border bg-background p-5 md:p-6 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow"
              >
                {safeRating > 0 ? (
                  <div
                    aria-label={`Valutazione ${safeRating} su 5`}
                    role="img"
                    className="text-primary text-lg"
                  >
                    <span aria-hidden="true">
                      {"★".repeat(safeRating)}
                      <span className="text-muted-foreground">{"★".repeat(5 - safeRating)}</span>
                    </span>
                  </div>
                ) : null}
                {r.body ? (
                  <p className="text-sm md:text-[15px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                    {r.body}
                  </p>
                ) : null}
                <h3
                  id={headingId}
                  className="text-xs md:text-sm font-semibold text-foreground mt-2 break-words pt-2 border-t border-border/50"
                >
                  — {r.author}
                </h3>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
