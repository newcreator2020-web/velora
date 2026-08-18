import type { ReviewsSection } from "@/lib/server/content-engine";

export function ReviewsSectionComponent(section: ReviewsSection) {
  if (!section.data.reviews || section.data.reviews.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Recensioni";
  return (
    <section aria-labelledby="site-reviews-title" className="w-full py-16 px-6 bg-muted/30">
      <div className="max-w-5xl mx-auto">
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {section.data.reviews.map((r, i) => {
            const safeRating = isFinite(r.rating)
              ? Math.max(1, Math.min(5, Math.round(r.rating)))
              : 0;
            return (
              <li
                key={r.author + "-" + i}
                className="rounded-lg border border-border bg-background p-5 shadow-sm flex flex-col gap-2"
              >
                {safeRating > 0 ? (
                  <div aria-label={`Valutazione ${safeRating} su 5`} className="text-primary">
                    {"★".repeat(safeRating)}
                    <span aria-hidden className="text-muted-foreground">
                      {"★".repeat(5 - safeRating)}
                    </span>
                  </div>
                ) : null}
                {r.body ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                    {r.body}
                  </p>
                ) : null}
                <p className="text-xs font-semibold text-foreground mt-2 break-words">
                  — {r.author}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
