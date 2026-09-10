import type { PublicSection, LegalLinksSection } from "@/lib/server/content-engine";

export function LegalLinksSectionComponent(s: PublicSection) {
  const sec = s as LegalLinksSection;
  const variant = sec.variant === "inline" ? "inline" : "default";
  const settings = sec.settings ?? {};
  const slug = (sec as unknown as { slug?: string }).slug ?? "";

  const privacyLabel = settings.privacyLabel ?? "Privacy Policy";
  const cookieLabel = settings.cookieLabel ?? "Cookie Policy";
  const termsLabel = settings.termsLabel ?? "Termini e Condizioni";

  const legalLinks = [
    { label: privacyLabel, href: `/s/${slug}/privacy`, key: "privacy" },
    { label: cookieLabel, href: `/s/${slug}/cookie`, key: "cookie" },
    { label: termsLabel, href: `/s/${slug}/terms`, key: "terms" },
  ].filter((l) => l.label && l.label.trim().length > 0);

  if (legalLinks.length === 0) return null;

  if (variant === "inline") {
    return (
      <section
        data-section="legal-links"
        data-variant="inline"
        className="w-full py-6 md:py-8 px-6 bg-background"
      >
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {legalLinks.map((link, idx) => (
              <span key={link.key} className="flex items-center">
                <a
                  href={link.href}
                  className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                >
                  {link.label}
                </a>
                {idx < legalLinks.length - 1 ? (
                  <span className="mx-4 text-foreground/20 font-light">|</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="legal-links"
      data-variant="default"
      className="w-full py-12 md:py-16 px-6 bg-muted/30"
    >
      <div className="max-w-2xl mx-auto">
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-3 mb-5 md:mb-7">
            <div className="inline-flex items-center justify-center rounded-xl bg-[var(--p)]/10 text-[var(--p)] p-2.5 shrink-0">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 3h7v7h-7z" />
                <rect x="10" y="10" width="11" height="11" rx="2" />
                <path d="M18 8V5h-3" />
                <path d="M7 7H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
              </svg>
            </div>
            <div>
              <h2
                className="text-lg md:text-xl text-foreground"
                style={{ fontWeight: "var(--theme-font-weight-heading)" }}
              >
                Informazioni Legali
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Documenti ufficiali e policy del sito
              </p>
            </div>
          </div>

          <ul className="flex flex-col divide-y divide-border/80 rounded-lg border border-border/60 overflow-hidden">
            {legalLinks.map((link) => (
              <li key={link.key}>
                <a
                  href={link.href}
                  className="group flex items-center justify-between gap-4 px-4 md:px-5 py-4 hover:bg-muted/50 transition duration-[var(--theme-motion-duration)]"
                >
                  <span className="flex items-center gap-3.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[var(--p)] shrink-0" />
                    <span
                      className="text-sm md:text-base text-foreground"
                      style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                    >
                      {link.label}
                    </span>
                  </span>
                  <svg
                    className="w-4 h-4 text-muted-foreground group-hover:text-[var(--p)] group-hover:translate-x-0.5 transition-all duration-[var(--theme-motion-duration)] shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
