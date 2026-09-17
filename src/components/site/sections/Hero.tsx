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

  if (variant === "editorial") {
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant="editorial"
        className="w-full bg-background relative overflow-hidden"
      >
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-32 grid md:grid-cols-12 gap-10 md:gap-14 items-start">
          <div className="md:col-span-7 flex flex-col gap-6">
            {eyebrow ? (
              <div className="flex items-center gap-3">
                <span className="h-px w-10 bg-primary" aria-hidden />
                <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                  {eyebrow}
                </p>
              </div>
            ) : null}
            <h1
              id="site-hero-title"
              className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tight text-foreground leading-[0.95] break-words"
              style={{ fontFamily: "var(--theme-font-family-heading)" }}
            >
              {headline}
            </h1>
            {subheadline ? (
              <p
                className="text-lg md:text-xl text-muted-foreground max-w-xl break-words whitespace-pre-wrap leading-relaxed"
                style={{ fontFamily: "var(--theme-font-family-body)" }}
              >
                {subheadline}
              </p>
            ) : null}
            {cta && ctaLabel ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <a href={cta} className="btn btn-primary">
                  {ctaLabel}
                </a>
              </div>
            ) : null}
          </div>
          {coverUrl ? (
            <div className="md:col-span-5 md:pt-16">
              <div className="relative aspect-[3/4] overflow-hidden rounded-sm shadow-xl md:rounded-sm">
                <Image
                  src={coverUrl}
                  alt={coverAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 40vw"
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "asymmetric") {
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant="asymmetric"
        className="relative w-full bg-foreground text-background overflow-hidden"
      >
        <div className="grid md:grid-cols-12 min-h-[85vh]">
          <div className="md:col-span-7 relative z-10 px-6 py-20 md:py-28 md:px-12 flex flex-col justify-between md:justify-end gap-10">
            <div className="flex flex-col gap-5 max-w-xl">
              {eyebrow ? (
                <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.24em] text-background/70">
                  {eyebrow}
                </p>
              ) : null}
              <h1
                id="site-hero-title"
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black tracking-tight break-words leading-[1]"
                style={{ fontFamily: "var(--theme-font-family-heading)" }}
              >
                {headline}
              </h1>
              {subheadline ? (
                <p className="text-base md:text-lg text-background/75 max-w-lg break-words whitespace-pre-wrap leading-relaxed">
                  {subheadline}
                </p>
              ) : null}
            </div>
            {cta && ctaLabel ? (
              <div className="flex flex-wrap gap-3">
                <a
                  href={cta}
                  className="inline-flex h-14 items-center justify-center rounded-full bg-primary px-8 text-sm md:text-base font-bold text-primary-foreground shadow-2xl hover:opacity-95 transition"
                >
                  {ctaLabel}
                </a>
              </div>
            ) : null}
          </div>
          {coverUrl ? (
            <div className="md:col-span-5 relative min-h-[320px] md:min-h-full">
              <div className="absolute inset-0 md:-left-20 md:top-12 md:bottom-12 rounded-none md:rounded-l-3xl overflow-hidden shadow-2xl">
                <Image
                  src={coverUrl}
                  alt={coverAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 44vw"
                  className="object-cover"
                  priority
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "image_cards") {
    return (
      <section
        aria-labelledby="site-hero-title"
        data-section="hero"
        data-variant="image_cards"
        className="w-full bg-background py-16 md:py-28 px-6"
      >
        <div className="max-w-6xl mx-auto grid md:grid-cols-12 gap-10 md:gap-14 items-center">
          <div className="md:col-span-5 flex flex-col gap-5 md:gap-6">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/85">
                {eyebrow}
              </p>
            ) : null}
            <h1
              id="site-hero-title"
              className="text-4xl md:text-6xl font-bold tracking-tight text-foreground break-words leading-[1.05]"
              style={{ fontFamily: "var(--theme-font-family-heading)" }}
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
                <a href={cta} className="btn btn-primary btn-lg">
                  {ctaLabel}
                </a>
              </div>
            ) : null}
          </div>
          <div className="md:col-span-7 relative">
            {coverUrl ? (
              <div className="relative grid grid-cols-5 auto-rows-[120px] md:auto-rows-[150px] gap-3 md:gap-4">
                <div className="col-span-3 row-span-3 relative overflow-hidden rounded-2xl shadow-lg">
                  <Image
                    src={coverUrl}
                    alt={coverAlt}
                    fill
                    sizes="(max-width: 768px) 60vw, 32vw"
                    className="object-cover"
                    priority
                  />
                </div>
                <div
                  className="col-span-2 row-span-2 relative overflow-hidden rounded-2xl shadow-md bg-muted"
                  aria-hidden
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--background)), color-mix(in srgb, var(--accent, var(--primary)) 20%, var(--muted)))",
                    }}
                  />
                  <div className="absolute inset-6 md:inset-8 flex flex-col justify-between text-primary">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                      Quality
                    </span>
                    <span className="text-4xl md:text-5xl font-black leading-none">✦</span>
                  </div>
                </div>
                <div className="col-span-2 row-span-1 relative overflow-hidden rounded-2xl shadow-md bg-card border border-border flex items-center justify-center">
                  <div className="text-center px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/80">
                      Made with
                    </p>
                    <p className="text-lg md:text-xl font-black text-foreground mt-1">
                      ♥ &amp; Cura
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative rounded-3xl bg-gradient-to-br from-primary/15 via-muted to-accent/10 aspect-[4/3] shadow-inner border border-border/60" />
            )}
          </div>
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
