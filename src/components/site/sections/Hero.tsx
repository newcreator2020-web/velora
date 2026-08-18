import type { HeroSection } from "@/lib/server/content-engine";
import { normalizePublicLink } from "@/lib/server/content-engine";

export function HeroSectionComponent(section: HeroSection) {
  const businessName = section.data.businessName;
  const headline =
    (section.settings.headlineOverride &&
      section.settings.headlineOverride.trim().length > 0 &&
      section.settings.headlineOverride) ||
    businessName;
  const subheadline = section.settings.subheadline ?? null;
  const eyebrow = section.settings.eyebrow ?? null;
  const ctaLabel = section.settings.ctaLabel ?? null;
  const ctaRaw = section.settings.ctaTarget ?? null;
  const cta = ctaRaw ? normalizePublicLink(ctaRaw) : "";
  const align = section.settings.alignment || "center";

  const justify =
    align === "left"
      ? "text-left items-start"
      : align === "right"
        ? "text-right items-end"
        : "text-center items-center";

  return (
    <section aria-labelledby="site-hero-title" className="w-full py-16 md:py-24 px-6 bg-white">
      <div className={`max-w-4xl mx-auto flex flex-col gap-6 ${justify}`}>
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80">
            {eyebrow}
          </p>
        ) : null}
        <h1
          id="site-hero-title"
          className="text-4xl md:text-6xl font-bold tracking-tight text-foreground break-words"
        >
          {headline}
        </h1>
        {subheadline ? (
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl break-words whitespace-pre-wrap">
            {subheadline}
          </p>
        ) : null}
        {cta && ctaLabel ? (
          <div className="flex justify-inherit mt-2">
            <a
              href={cta}
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition"
            >
              {ctaLabel}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
