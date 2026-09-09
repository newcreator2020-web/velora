import type { HeroSection } from "@/lib/server/content-engine";
import { normalizePublicLink } from "@/lib/server/content-engine";
import Image from "next/image";

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
  const variant = section.variant;

  const coverUrl =
    typeof section.settings.hero_cover_url === "string" &&
    section.settings.hero_cover_url.length > 0
      ? section.settings.hero_cover_url
      : null;
  const coverAlt =
    typeof section.settings.hero_cover_alt === "string" &&
    section.settings.hero_cover_alt.length > 0
      ? section.settings.hero_cover_alt
      : "Hero cover";

  if (variant === "split" || variant === "split_hero_left") {
    const imageFirst = variant === "split_hero_left";
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant={variant}
        className="w-full bg-background"
      >
        <div className="max-w-6xl mx-auto py-16 md:py-28 px-6 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          {imageFirst && coverUrl ? (
            <div className="order-1 md:order-1 aspect-[4/5] md:aspect-auto md:h-full min-h-[320px] md:min-h-[460px] relative overflow-hidden rounded-2xl shadow-lg">
              <Image
                src={coverUrl}
                alt={coverAlt}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                priority
              />
            </div>
          ) : null}
          <div
            className={`${imageFirst ? "order-2 md:order-2" : "order-1 md:order-1"} flex flex-col gap-5 ${
              align === "left"
                ? "text-left items-start"
                : align === "right"
                  ? "text-right items-end"
                  : "md:text-left md:items-start text-center items-center"
            }`}
          >
            {eyebrow ? (
              <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                {eyebrow}
              </p>
            ) : null}
            <h1
              id="site-hero-title"
              className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground break-words leading-[1.05]"
            >
              {headline}
            </h1>
            {subheadline ? (
              <p className="text-base md:text-lg text-muted-foreground max-w-xl break-words whitespace-pre-wrap leading-relaxed">
                {subheadline}
              </p>
            ) : null}
            {cta && ctaLabel ? (
              <div className="mt-2 flex flex-wrap gap-3">
                <a
                  href={cta}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow hover:opacity-90 transition"
                >
                  {ctaLabel}
                </a>
              </div>
            ) : null}
          </div>
          {!imageFirst && coverUrl ? (
            <div className="order-2 md:order-2 aspect-[4/5] md:aspect-auto md:h-full min-h-[320px] md:min-h-[460px] relative overflow-hidden rounded-2xl shadow-lg">
              <Image
                src={coverUrl}
                alt={coverAlt}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                priority
              />
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "fullscreen") {
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant="fullscreen"
        className="relative w-full min-h-[85vh] md:min-h-[92vh] flex items-center justify-center overflow-hidden"
      >
        {coverUrl ? (
          <div className="absolute inset-0 z-0">
            <Image
              src={coverUrl}
              alt={coverAlt}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-black/55" />
          </div>
        ) : (
          <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary/20 via-background to-accent/20" />
        )}
        <div className="relative z-10 w-full max-w-4xl mx-auto px-6 py-24 md:py-32 flex flex-col gap-6 items-center text-center">
          {eyebrow ? (
            <p className="text-sm md:text-base font-semibold uppercase tracking-[0.25em] text-white/80">
              {eyebrow}
            </p>
          ) : null}
          <h1
            id="site-hero-title"
            className={`${coverUrl ? "text-white" : "text-foreground"} text-5xl sm:text-6xl md:text-7xl font-black tracking-tight break-words leading-[1.02]`}
          >
            {headline}
          </h1>
          {subheadline ? (
            <p
              className={`${coverUrl ? "text-white/80" : "text-muted-foreground"} text-lg md:text-xl max-w-2xl break-words whitespace-pre-wrap leading-relaxed`}
            >
              {subheadline}
            </p>
          ) : null}
          {cta && ctaLabel ? (
            <div className="flex flex-wrap gap-3 pt-2 justify-center">
              <a
                href={cta}
                className={`inline-flex h-14 items-center justify-center px-8 text-base font-semibold rounded-full transition shadow-xl ${coverUrl ? "bg-white text-foreground hover:bg-white/90" : "bg-primary text-primary-foreground hover:opacity-90"}`}
              >
                {ctaLabel}
              </a>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "minimal") {
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant="minimal"
        className="w-full py-10 md:py-16 px-6 bg-background"
      >
        <div
          className={`max-w-3xl mx-auto flex flex-col gap-4 ${
            align === "left"
              ? "text-left items-start"
              : align === "right"
                ? "text-right items-end"
                : "text-center items-center"
          }`}
        >
          {eyebrow ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1
            id="site-hero-title"
            className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground break-words leading-tight"
          >
            {headline}
          </h1>
          {subheadline ? (
            <p className="text-sm md:text-base text-muted-foreground max-w-xl break-words whitespace-pre-wrap">
              {subheadline}
            </p>
          ) : null}
          {cta && ctaLabel ? (
            <div className="mt-1">
              <a
                href={cta}
                className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-5 text-xs font-semibold text-background hover:opacity-80 transition"
              >
                {ctaLabel}
              </a>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const justify =
    align === "left"
      ? "text-left items-start"
      : align === "right"
        ? "text-right items-end"
        : "text-center items-center";

  return (
    <section
      aria-labelledby="site-hero-title"
      data-section="hero"
      data-variant="centered"
      className="w-full py-16 md:py-24 px-6 bg-background"
    >
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
