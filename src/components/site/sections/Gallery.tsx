import Image from "next/image";
import type { GallerySection } from "@/lib/server/content-engine";

export function GallerySectionComponent(section: GallerySection) {
  if (!section.data.assets || section.data.assets.length === 0) return null;
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Galleria";
  const cols = Math.min(4, Math.max(1, section.settings.columns ?? 3));
  const variant = section.variant === "masonry" ? "masonry" : "grid";

  if (variant === "masonry") {
    return (
      <section
        aria-labelledby="site-gallery-title"
        data-section="gallery"
        data-variant="masonry"
        className="w-full py-16 md:py-24 px-6 bg-background"
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-10 md:mb-14 text-center">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-gallery-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground break-words"
            >
              {headline}
            </h2>
          </div>
          <div
            className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-3 md:gap-5 [column-fill:_balance]"
            style={{ columnCount: cols === 1 ? 1 : cols === 2 ? 2 : cols === 4 ? 4 : 3 }}
          >
            {section.data.assets.map((a, i) => {
              const hClass =
                i % 5 === 0
                  ? "aspect-[3/4]"
                  : i % 3 === 0
                    ? "aspect-[4/5]"
                    : i % 4 === 0
                      ? "aspect-[1/1]"
                      : "aspect-[4/3]";
              return (
                <div
                  key={a.url + "-" + i}
                  className={`mb-3 md:mb-5 break-inside-avoid overflow-hidden rounded-xl ${hClass} relative group`}
                >
                  <Image
                    src={a.url}
                    alt={a.alt ?? ""}
                    fill
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 47vw, 31vw"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading={i < 6 ? "eager" : "lazy"}
                    priority={i < 3}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  const gridCols =
    cols === 1
      ? "grid-cols-1"
      : cols === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : cols === 4
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-3";

  return (
    <section
      aria-labelledby="site-gallery-title"
      data-section="gallery"
      data-variant="grid"
      className="w-full py-16 md:py-20 px-6 bg-muted/40"
    >
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 md:mb-12">
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
        </div>
        <ul className={`grid gap-4 md:gap-5 ${gridCols}`}>
          {section.data.assets.map((a, i) => {
            const isFirstRow = i < cols;
            return (
              <li
                key={a.url + "-" + i}
                className="aspect-square overflow-hidden rounded-lg bg-border/50 relative"
              >
                <Image
                  src={a.url}
                  alt={a.alt ?? ""}
                  fill
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 47vw, 31vw"
                  className="aspect-square w-full h-full object-cover rounded-[var(--radius)]"
                  priority={isFirstRow}
                  loading={isFirstRow ? "eager" : "lazy"}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
