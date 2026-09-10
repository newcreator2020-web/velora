import type { PublicSection, TrustSection } from "@/lib/server/content-engine";

export function TrustSectionComponent(s: PublicSection) {
  const sec = s as TrustSection;
  const variant = sec.variant === "minimal" ? "minimal" : "default";
  const settings = sec.settings ?? {};

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Perché sceglierci";

  const items = [
    { label: settings.itemsLabel1, sub: settings.itemsSub1 },
    { label: settings.itemsLabel2, sub: settings.itemsSub2 },
    { label: settings.itemsLabel3, sub: settings.itemsSub3 },
    { label: settings.itemsLabel4, sub: settings.itemsSub4 },
  ].filter((i) => i.label && i.label.trim().length > 0);

  if (items.length === 0) return null;

  const icons = [
    <svg
      key="shield"
      className="w-6 h-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>,
    <svg
      key="clock"
      className="w-6 h-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>,
    <svg
      key="star"
      className="w-6 h-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>,
    <svg
      key="users"
      className="w-6 h-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>,
  ];

  if (variant === "minimal") {
    return (
      <section
        data-section="trust"
        data-variant="minimal"
        className="w-full py-10 md:py-14 px-6 bg-muted/30"
      >
        <div className="max-w-6xl mx-auto">
          {eyebrow || headline ? (
            <div className="text-center mb-8">
              {eyebrow ? (
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--p)] mb-2">
                  {eyebrow}
                </p>
              ) : null}
              <h2
                className="text-xl md:text-2xl text-foreground"
                style={{ fontWeight: "var(--theme-font-weight-heading)" }}
              >
                {headline}
              </h2>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-5">
            {items.map((item, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 md:px-5 py-2 text-sm md:text-base font-medium text-foreground"
              >
                <span className="text-[var(--p)]">{icons[idx % icons.length]}</span>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="trust"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-background"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-14">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--p)]/80 mb-3">
              {eyebrow}
            </p>
          ) : null}
          <h2
            className="text-3xl md:text-5xl text-foreground tracking-tight"
            style={{ fontWeight: "var(--theme-font-weight-heading)" }}
          >
            {headline}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-7">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex flex-col items-start gap-4 rounded-[var(--radius)] border border-border bg-card p-6 md:p-7 shadow-sm hover:shadow-md transition-all duration-[var(--theme-motion-duration)]"
            >
              <div className="inline-flex items-center justify-center rounded-xl bg-[var(--p)]/10 text-[var(--p)] p-3">
                {icons[idx % icons.length]}
              </div>
              <div className="flex flex-col gap-1">
                <h3
                  className="text-base md:text-lg text-foreground"
                  style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                >
                  {item.label}
                </h3>
                {item.sub ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.sub}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
