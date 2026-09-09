import type { AboutSection } from "@/lib/server/content-engine";
import Image from "next/image";

export function AboutSectionComponent(section: AboutSection) {
  if (!section.data.description || section.data.description.trim().length === 0) {
    return null;
  }
  const eyebrow = section.settings.eyebrow ?? null;
  const variant = section.variant === "split" ? "split" : "centered";
  const align = section.settings.alignment || "center";

  const imageUrl =
    typeof section.settings.about_image_url === "string" &&
    section.settings.about_image_url.length > 0
      ? section.settings.about_image_url
      : null;
  const imageAlt =
    typeof section.settings.about_image_alt === "string" &&
    section.settings.about_image_alt.length > 0
      ? section.settings.about_image_alt
      : section.data.businessName;

  if (variant === "split") {
    return (
      <section
        aria-labelledby="site-about-title"
        data-section="about"
        data-variant="split"
        className="w-full py-16 md:py-24 px-6 bg-background"
      >
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div className="aspect-[4/5] md:aspect-square md:min-h-[380px] relative overflow-hidden rounded-2xl shadow-md bg-muted/50">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={imageAlt}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                priority={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-5xl font-black">
                {section.data.businessName.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-5 text-left">
            {eyebrow ? (
              <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-about-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-2 break-words leading-[1.1]"
            >
              {section.data.businessName}
            </h2>
            <p className="text-base md:text-lg leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
              {section.data.description}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const textJustify =
    align === "left"
      ? "text-left items-start"
      : align === "right"
        ? "text-right items-end"
        : "text-center items-center";

  return (
    <section
      aria-labelledby="site-about-title"
      data-section="about"
      data-variant="centered"
      className="w-full py-16 md:py-20 px-6 bg-muted/30"
    >
      <div className={`max-w-3xl mx-auto flex flex-col gap-5 ${textJustify}`}>
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-1">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-about-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3 break-words"
        >
          {section.data.businessName}
        </h2>
        <p className="text-base md:text-lg leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
          {section.data.description}
        </p>
      </div>
    </section>
  );
}
