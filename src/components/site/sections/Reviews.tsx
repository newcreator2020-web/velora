import type { ReviewsSection } from "@/lib/server/content-engine";

export function ReviewsSectionComponent(section: ReviewsSection) {
  if (!section.data.reviews || section.data.reviews.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Recensioni";
  const variant = section.variant === "carousel" ? "carousel" : "cards";
  const reviews = section.data.reviews;

  if (variant === "carousel") {
    const avgRating =
      reviews.reduce(
        (acc, r) => acc + (isFinite(r.rating) ? Math.max(1, Math.min(5, Math.round(r.rating))) : 0),
        0,
      ) / reviews.length;
    const avgDisplay = isFinite(avgRating) ? avgRating.toFixed(1) : null;
    return (
      <section
        aria-labelledby="site-reviews-title"
        data-section="reviews"
        data-variant="carousel"
        className="w-full py-16 md:py-24 px-6 bg-primary/5"
      >
        <div className="max-w-4xl mx-auto">
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
              <div className="inline-flex items-center gap-3 bg-card px-5 py-2.5 rounded-full shadow-sm border border-border">
                <div
                  className="text-primary text-lg"
                  aria-label={`Valutazione media ${avgDisplay} su 5`}
                >
                  {"★★★★★"}
                </div>
                <span className="font-bold text-foreground text-lg">{avgDisplay}</span>
                <span className="text-xs text-muted-foreground">{reviews.length} recensioni</span>
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
      className="w-full py-16 md:py-20 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-10 md:mb-12">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-reviews-title"
            className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-10 break-words"
          >
            {headline}
          </h2>
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
