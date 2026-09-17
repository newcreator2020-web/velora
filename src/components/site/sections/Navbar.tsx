"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { PublicSection, NavbarSection, PublicTheme } from "@/lib/server/content-engine";

export function NavbarSectionComponent(s: PublicSection) {
  const sec = s as NavbarSection;
  const extras = sec as unknown as { slug?: string; theme?: PublicTheme };
  const variant = sec.variant === "transparent" ? "transparent" : "default";
  const settings = sec.settings ?? {};
  const theme = extras.theme ?? {};
  const slug = extras.slug ?? "";

  const showLogo = settings.showLogo !== false;
  const showBookingButton = settings.showBookingButton !== false;
  const showPhone = settings.showPhone !== false;
  const ctaLabel = settings.ctaLabel ?? "Prenota";

  const logoUrl = theme.logo_url ?? null;
  const businessName = sec.data?.businessName ?? "Nome Attività";
  const phone = sec.data?.phone ?? null;

  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const links = [
    { href: `/s/${slug}/#services`, label: "Servizi" },
    { href: `/s/${slug}/#about`, label: "Chi Siamo" },
    { href: `/s/${slug}/#gallery`, label: "Galleria" },
    { href: `/s/${slug}/#reviews`, label: "Recensioni" },
    { href: `/s/${slug}/#staff`, label: "Team" },
    { href: `/s/${slug}/#contact`, label: "Contatti" },
  ];

  const bookingHref = slug ? `/s/${encodeURIComponent(slug)}/booking` : "/booking";

  const scrollTo = (href: string) => (e: React.MouseEvent) => {
    setOpen(false);
    const hashIdx = href.indexOf("#");
    if (hashIdx === -1) return;
    const id = href.slice(hashIdx + 1);
    if (!id) return;
    if (typeof document === "undefined") return;
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const NavContent = (
    <>
      <div className="flex items-center gap-3 shrink-0">
        {showLogo && logoUrl ? (
          <div className="relative h-9 w-9">
            <Image src={logoUrl} alt={businessName} fill sizes="36px" className="object-contain" />
          </div>
        ) : showLogo ? (
          <span
            className={`text-2xl font-black tracking-tight ${
              variant === "transparent" ? "text-white" : "text-foreground"
            }`}
          >
            {businessName.charAt(0)}
          </span>
        ) : null}
        {showLogo ? (
          <span
            className={`font-bold tracking-tight hidden sm:block ${
              variant === "transparent" ? "text-white" : "text-foreground"
            }`}
            style={{ fontWeight: "var(--theme-font-weight-heading)" }}
          >
            {businessName}
          </span>
        ) : null}
      </div>

      <ul
        className={`hidden md:flex items-center gap-7 text-sm font-medium ${
          variant === "transparent" ? "text-white/90" : "text-muted-foreground"
        }`}
      >
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              onClick={scrollTo(l.href)}
              className={`transition duration-[var(--theme-motion-duration)] ${
                variant === "transparent" ? "hover:text-white" : "hover:text-foreground"
              }`}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 shrink-0">
        {showPhone && phone ? (
          <a
            href={`tel:${phone}`}
            className={`hidden sm:inline-flex items-center gap-2 text-sm font-semibold transition duration-[var(--theme-motion-duration)] ${
              variant === "transparent"
                ? "text-white/90 hover:text-white"
                : "text-foreground/80 hover:text-foreground"
            }`}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="hidden lg:inline">{phone}</span>
          </a>
        ) : null}
        {showBookingButton ? (
          <a
            href={bookingHref}
            className={`hidden md:inline-flex h-11 items-center justify-center rounded-[var(--radius)] px-5 text-sm font-semibold shadow-sm hover:opacity-90 transition duration-[var(--theme-motion-duration)] ${
              variant === "transparent"
                ? "bg-white text-foreground"
                : "bg-[var(--p)] text-[var(--p-foreground)]"
            }`}
          >
            {ctaLabel}
          </a>
        ) : null}

        <button
          type="button"
          aria-label={open ? "Chiudi menu di navigazione" : "Apri menu di navigazione"}
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          onClick={() => setOpen((v) => !v)}
          className={`md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border transition ${
            variant === "transparent"
              ? "border-white/20 text-white hover:bg-white/10"
              : "border-border text-foreground hover:bg-muted"
          }`}
        >
          <span className="sr-only">Menu</span>
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7H20M4 12H20M4 17H20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>
    </>
  );

  return (
    <>
      <header
        data-section="navbar"
        data-variant={variant}
        className={`sticky top-0 z-40 w-full transition-colors duration-200 ${
          variant === "transparent"
            ? scrolled
              ? "bg-background/85 backdrop-blur-md border-b border-border"
              : "bg-transparent border-b border-transparent"
            : "border-b border-border bg-background/80 backdrop-blur-md"
        }`}
      >
        <nav
          className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6"
          style={{ height: scrolled || variant === "default" ? "68px" : "84px" }}
        >
          {NavContent}
        </nav>
      </header>

      <div
        id="mobile-nav-drawer"
        className={`fixed inset-0 z-[90] md:hidden transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!open}
      >
        <button
          type="button"
          aria-label="Chiudi menu"
          className="absolute inset-0 bg-black/55 backdrop-blur-sm cursor-pointer"
          onClick={() => setOpen(false)}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menu di navigazione"
          className={`absolute right-0 top-0 h-full w-[86%] max-w-sm bg-card border-l border-border shadow-2xl flex flex-col transform transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-5 py-5 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              {showLogo && logoUrl ? (
                <div className="relative h-8 w-8 shrink-0">
                  <Image
                    src={logoUrl}
                    alt={businessName}
                    fill
                    sizes="32px"
                    className="object-contain"
                  />
                </div>
              ) : showLogo ? (
                <span className="h-8 w-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-black">
                  {businessName.charAt(0)}
                </span>
              ) : null}
              <span
                className="font-bold text-foreground truncate"
                style={{ fontFamily: "var(--theme-font-family-heading)" }}
              >
                {businessName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi menu"
              className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted transition"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M6 6L18 18M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <ul className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={(e) => {
                    scrollTo(l.href)(e);
                  }}
                  className="flex items-center justify-between px-3 py-3.5 rounded-xl text-base font-semibold text-foreground hover:bg-muted transition"
                >
                  <span>{l.label}</span>
                  <svg
                    className="text-muted-foreground"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M9 6L15 12L9 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </li>
            ))}
          </ul>

          <div className="border-t border-border px-5 py-5 flex flex-col gap-3">
            {showPhone && phone ? (
              <a href={`tel:${phone}`} className="btn btn-outline justify-between">
                <span className="inline-flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Chiama
                </span>
                <span className="tabular-nums text-xs font-semibold text-muted-foreground">
                  {phone}
                </span>
              </a>
            ) : null}
            {showBookingButton ? (
              <a
                href={bookingHref}
                onClick={() => setOpen(false)}
                className="btn btn-primary btn-lg btn-full justify-center"
              >
                {ctaLabel}
              </a>
            ) : null}
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              © {new Date().getFullYear()} {businessName}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
