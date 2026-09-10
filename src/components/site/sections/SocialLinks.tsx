import type {
  PublicSection,
  SocialLinksSection,
  SocialLinkItem,
} from "@/lib/server/content-engine";

export function SocialLinksSectionComponent(s: PublicSection) {
  const sec = s as SocialLinksSection;
  const variant = sec.variant === "icons" ? "icons" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Seguici sui Social";

  const links =
    data.links && Array.isArray(data.links) && data.links.length > 0
      ? data.links.filter((l: SocialLinkItem) => l.url && l.url.trim().length > 0)
      : [];

  if (links.length === 0) return null;

  const getIcon = (platform: string) => {
    const p = (platform || "").toLowerCase();
    const className = "w-5 h-5";
    if (p.includes("instagram")) {
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    }
    if (p.includes("facebook")) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    }
    if (p.includes("tiktok")) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
        </svg>
      );
    }
    if (p.includes("linkedin")) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    }
    if (p.includes("youtube")) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    }
    if (p.includes("twitter") || p.includes("x.com")) {
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    }
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8" />
        <path d="m12 8-4 4 4 4" />
      </svg>
    );
  };

  if (variant === "icons") {
    return (
      <section
        data-section="social-links"
        data-variant="icons"
        className="w-full py-10 md:py-14 px-6 bg-background"
      >
        <div className="max-w-3xl mx-auto text-center">
          {eyebrow || headline ? (
            <div className="mb-8">
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

          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-5">
            {links.map((link: SocialLinkItem, idx: number) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label || link.platform || "Social"}
                className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full border border-border bg-card text-foreground hover:bg-[var(--p)] hover:text-[var(--p-foreground)] hover:border-[var(--p)] hover:scale-105 shadow-sm hover:shadow-md transition-all duration-[var(--theme-motion-duration)]"
              >
                {getIcon(link.platform)}
              </a>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="social-links"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-muted/30"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 md:mb-14">
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

        <div
          className={`grid gap-5 md:gap-6 ${links.length === 1 ? "grid-cols-1 max-w-md mx-auto" : links.length === 2 ? "grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto" : links.length === 3 ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-4"}`}
        >
          {links.map((link: SocialLinkItem, idx: number) => {
            const platformLabel = link.label || link.platform || "Social";
            return (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 rounded-[var(--radius)] border border-border bg-card p-5 md:p-6 shadow-sm hover:shadow-md hover:border-[var(--p)]/50 transition-all duration-[var(--theme-motion-duration)]"
              >
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[var(--p)]/10 text-[var(--p)] group-hover:bg-[var(--p)] group-hover:text-[var(--p-foreground)] transition-all duration-[var(--theme-motion-duration)] shrink-0">
                  {getIcon(link.platform)}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {link.platform || "Social"}
                  </span>
                  <span
                    className="text-sm md:text-base text-foreground truncate"
                    style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                  >
                    {platformLabel}
                  </span>
                </div>
                <svg
                  className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-[var(--p)] group-hover:translate-x-1 transition-all duration-[var(--theme-motion-duration)] shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
