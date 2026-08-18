import type { GallerySection } from "@/lib/server/content-engine";

export function GallerySectionComponent(section: GallerySection) {
  if (!section.data.assets || section.data.assets.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Galleria";
  const cols = Math.min(4, Math.max(1, section.settings.columns ?? 3));
  const gridCols =
    cols === 1
      ? "grid-cols-1"
      : cols === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : cols === 4
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-3";
  return (
    <section aria-labelledby="site-gallery-title" className="w-full py-16 px-6 bg-muted/30">
      <div className="max-w-6xl mx-auto">
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-gallery-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-10 break-words"
        >
          {headline}
        </h2>
        <ul className={`grid gap-4 ${gridCols}`}>
          {section.data.assets.map((a, i) => (
            <li
              key={a.url + "-" + i}
              className="aspect-square overflow-hidden rounded-lg bg-border/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.alt ?? ""}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
