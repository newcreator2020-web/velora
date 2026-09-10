import type { PublicSection, BookingCtaSection } from "@/lib/server/content-engine";

export function BookingCtaSectionComponent(s: PublicSection) {
  const sec = s as BookingCtaSection;
  const variant = sec.variant === "split" ? "split" : "default";
  const settings = sec.settings ?? {};
  const slug = (sec as unknown as { slug?: string }).slug ?? "";

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Prenota il tuo appuntamento";
  const subheadline = settings.subheadline ?? null;
  const ctaPrimaryLabel = settings.ctaPrimaryLabel ?? "Prenota Ora";
  const ctaSecondaryLabel = settings.ctaSecondaryLabel ?? "Scopri i Servizi";

  const bookUrl = `/s/${slug}/book`;
  const servicesUrl = `/s/${slug}/#services`;

  if (variant === "split") {
    return (
      <section
        data-section="booking-cta"
        data-variant="split"
        className="w-full py-14 md:py-20 px-6 bg-muted/30"
      >
        <div className="max-w-6xl mx-auto">
          <div className="relative rounded-[var(--radius)] overflow-hidden border border-border bg-[var(--p)] shadow-xl">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-[var(--p-foreground)] blur-3xl" />
              <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-[var(--p-foreground)] blur-3xl" />
            </div>

            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 p-8 md:p-12 lg:p-14">
              <div className="flex flex-col gap-4 justify-center">
                {eyebrow ? (
                  <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-[var(--p-foreground)]/80">
                    {eyebrow}
                  </p>
                ) : null}
                <h2
                  className="text-3xl md:text-4xl lg:text-5xl text-[var(--p-foreground)] tracking-tight leading-[1.1]"
                  style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                >
                  {headline}
                </h2>
                {subheadline ? (
                  <p className="text-base md:text-lg text-[var(--p-foreground)]/85 leading-relaxed whitespace-pre-wrap max-w-xl">
                    {subheadline}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col sm:flex-row lg:flex-col lg:items-end items-start justify-center gap-4 lg:gap-5 lg:justify-center">
                <a
                  href={bookUrl}
                  className="inline-flex h-12 md:h-14 items-center justify-center rounded-[var(--radius)] bg-[var(--p-foreground)] px-7 md:px-8 text-sm md:text-base font-semibold text-[var(--p)] shadow-lg hover:bg-[var(--p-foreground)]/90 transition duration-[var(--theme-motion-duration)] w-full sm:w-auto"
                >
                  <svg
                    className="w-4 h-4 md:w-5 md:h-5 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4" />
                    <path d="M8 2v4" />
                    <path d="M3 10h18" />
                  </svg>
                  {ctaPrimaryLabel}
                </a>
                <a
                  href={servicesUrl}
                  className="inline-flex h-12 md:h-14 items-center justify-center rounded-[var(--radius)] border-2 border-[var(--p-foreground)]/30 bg-transparent px-7 md:px-8 text-sm md:text-base font-semibold text-[var(--p-foreground)] hover:bg-[var(--p-foreground)]/10 transition duration-[var(--theme-motion-duration)] w-full sm:w-auto"
                >
                  {ctaSecondaryLabel}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="booking-cta"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-background"
    >
      <div className="max-w-4xl mx-auto">
        <div className="relative rounded-[var(--radius)] border border-border bg-card p-8 md:p-12 lg:p-14 shadow-lg text-center overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[var(--p)] to-transparent" />

          <div className="flex flex-col items-center gap-4 md:gap-5">
            {eyebrow ? (
              <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-[var(--p)]">
                {eyebrow}
              </p>
            ) : null}
            <h2
              className="text-3xl md:text-5xl text-foreground tracking-tight leading-[1.1] max-w-2xl"
              style={{ fontWeight: "var(--theme-font-weight-heading)" }}
            >
              {headline}
            </h2>
            {subheadline ? (
              <p className="text-base md:text-lg text-muted-foreground leading-relaxed whitespace-pre-wrap max-w-xl">
                {subheadline}
              </p>
            ) : null}

            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
              <a
                href={bookUrl}
                className="inline-flex h-12 md:h-14 items-center justify-center rounded-[var(--radius)] bg-[var(--p)] px-7 md:px-8 text-sm md:text-base font-semibold text-[var(--p-foreground)] shadow-md hover:opacity-90 transition duration-[var(--theme-motion-duration)] w-full sm:w-auto"
              >
                <svg
                  className="w-4 h-4 md:w-5 md:h-5 mr-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                </svg>
                {ctaPrimaryLabel}
              </a>
              <a
                href={servicesUrl}
                className="inline-flex h-12 md:h-14 items-center justify-center rounded-[var(--radius)] border border-border bg-background px-7 md:px-8 text-sm md:text-base font-semibold text-foreground hover:bg-muted/50 transition duration-[var(--theme-motion-duration)] w-full sm:w-auto"
              >
                {ctaSecondaryLabel}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
