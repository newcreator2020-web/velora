"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { GallerySection, PublicGalleryAsset } from "@/lib/server/content-engine";

export function GallerySectionComponent(section: GallerySection) {
  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Galleria";
  const cols = Math.min(4, Math.max(1, section.settings.columns ?? 3));
  const variant = section.variant === "masonry" ? "masonry" : "grid";
  const assets = section.data.assets ?? [];
  const hasAssets = assets.length > 0;

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const close = useCallback(() => setLightboxIdx(null), []);
  const prev = useCallback(() => {
    setLightboxIdx((i) => (i == null || !hasAssets ? i : (i - 1 + assets.length) % assets.length));
  }, [assets.length, hasAssets]);
  const next = useCallback(() => {
    setLightboxIdx((i) => (i == null || !hasAssets ? i : (i + 1) % assets.length));
  }, [assets.length, hasAssets]);

  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxIdx, close, prev, next]);

  const openAt = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setLightboxIdx(i);
  };

  const lightboxAsset = lightboxIdx != null ? assets[lightboxIdx] : null;

  if (!hasAssets) return null;

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
            {assets.map((a, i) => {
              const hClass =
                i % 5 === 0
                  ? "aspect-[3/4]"
                  : i % 3 === 0
                    ? "aspect-[4/5]"
                    : i % 4 === 0
                      ? "aspect-[1/1]"
                      : "aspect-[4/3]";
              return (
                <button
                  key={a.url + "-" + i}
                  type="button"
                  onClick={openAt(i)}
                  aria-label={`Apri immagine ${i + 1}: ${a.alt ?? ""}`}
                  className={`mb-3 md:mb-5 break-inside-avoid overflow-hidden rounded-xl ${hClass} relative group w-full text-left bg-muted`}
                >
                  <Image
                    src={a.url}
                    alt={a.alt ?? ""}
                    fill
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 47vw, 31vw"
                    className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.05] group-hover:brightness-[0.85]"
                    loading={i < 6 ? "eager" : "lazy"}
                    priority={i < 3}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-white/0 group-hover:text-white transition-colors duration-300 pointer-events-none">
                    <span className="bg-black/55 rounded-full p-3">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M21 21L16 16M10 18V12M10 12H4M10 12L6 8M14 6V12M14 12H20M14 12L18 16"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <LightboxModal
          asset={lightboxAsset ?? null}
          index={lightboxIdx}
          total={assets.length}
          onClose={close}
          onPrev={prev}
          onNext={next}
        />
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
          {assets.map((a, i) => {
            const isFirstRow = i < cols;
            return (
              <li key={a.url + "-" + i}>
                <button
                  type="button"
                  onClick={openAt(i)}
                  aria-label={`Apri immagine ${i + 1}: ${a.alt ?? ""}`}
                  className="aspect-square overflow-hidden rounded-lg bg-border/50 relative block w-full text-left group"
                >
                  <Image
                    src={a.url}
                    alt={a.alt ?? ""}
                    fill
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 47vw, 31vw"
                    className="aspect-square w-full h-full object-cover rounded-[var(--radius)] transition-all duration-400 group-hover:scale-105 group-hover:brightness-90"
                    priority={isFirstRow}
                    loading={isFirstRow ? "eager" : "lazy"}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <LightboxModal
        asset={lightboxAsset ?? null}
        index={lightboxIdx}
        total={assets.length}
        onClose={close}
        onPrev={prev}
        onNext={next}
      />
    </section>
  );
}

function LightboxModal(props: {
  asset: PublicGalleryAsset | null;
  index: number | null;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (props.asset == null || props.index == null) return null;
  const { asset, index, total, onClose, onPrev, onNext } = props;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10">
      <button
        type="button"
        aria-label={`Chiudi galleria, immagine ${index + 1} di ${total}`}
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm cursor-zoom-out"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Galleria, immagine ${index + 1} di ${total}`}
        className="relative w-full h-full max-w-[1100px] max-h-[1000px] md:h-[88vh] md:w-[92vw]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="absolute top-4 right-4 md:top-6 md:right-6 z-10 h-11 w-11 rounded-full bg-white/10 hover:bg-white/15 text-white inline-flex items-center justify-center transition"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6L18 18M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Immagine precedente"
          className="absolute left-3 md:left-6 top-1/2 z-10 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/15 text-white inline-flex items-center justify-center transition"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M15 6L9 12L15 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Immagine successiva"
          className="absolute right-3 md:right-6 top-1/2 z-10 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/15 text-white inline-flex items-center justify-center transition"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M9 6L15 12L9 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <figure className="relative w-full h-full">
          <Image
            src={asset.url}
            alt={asset.alt ?? `Immagine ${index + 1}`}
            fill
            sizes="92vw"
            className="object-contain"
            priority
          />
        </figure>
        <div className="absolute bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-xs md:text-sm text-white/80 tabular-nums select-none pointer-events-none">
          {index + 1} / {total}
        </div>
      </div>
    </div>
  );
}
