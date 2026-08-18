import type { AboutSection } from "@/lib/server/content-engine";

export function AboutSectionComponent(section: AboutSection) {
  if (!section.data.description || section.data.description.trim().length === 0) {
    return null;
  }
  const eyebrow = section.settings.eyebrow ?? null;
  return (
    <section aria-labelledby="site-about-title" className="w-full py-16 px-6 bg-muted/30">
      <div className="max-w-4xl mx-auto">
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-about-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-6 break-words"
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
