import Image from "next/image";
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

  if (variant === "transparent") {
    return (
      <header
        data-section="navbar"
        data-variant="transparent"
        className="absolute top-0 left-0 right-0 z-40 w-full bg-transparent"
      >
        <nav className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-5">
          <div className="flex items-center gap-3 shrink-0">
            {showLogo && logoUrl ? (
              <div className="relative h-9 w-9">
                <Image
                  src={logoUrl}
                  alt={businessName}
                  fill
                  sizes="36px"
                  className="object-contain"
                />
              </div>
            ) : showLogo ? (
              <span className="text-2xl font-black text-white tracking-tight">
                {businessName.charAt(0)}
              </span>
            ) : null}
            {showLogo ? (
              <span className="text-white font-bold tracking-tight hidden sm:block">
                {businessName}
              </span>
            ) : null}
          </div>

          <ul className="hidden md:flex items-center gap-8 text-sm font-medium text-white/90">
            <li>
              <a
                href={`/s/${slug}/#services`}
                className="hover:text-white transition duration-[var(--theme-motion-duration)]"
              >
                Servizi
              </a>
            </li>
            <li>
              <a
                href={`/s/${slug}/#about`}
                className="hover:text-white transition duration-[var(--theme-motion-duration)]"
              >
                Chi Siamo
              </a>
            </li>
            <li>
              <a
                href={`/s/${slug}/#reviews`}
                className="hover:text-white transition duration-[var(--theme-motion-duration)]"
              >
                Recensioni
              </a>
            </li>
            <li>
              <a
                href={`/s/${slug}/#contact`}
                className="hover:text-white transition duration-[var(--theme-motion-duration)]"
              >
                Contatti
              </a>
            </li>
          </ul>

          <div className="flex items-center gap-3 shrink-0">
            {showPhone && sec.data?.phone ? (
              <a
                href={`tel:${sec.data.phone}`}
                className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-white transition duration-[var(--theme-motion-duration)]"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span className="hidden lg:inline">{sec.data.phone}</span>
              </a>
            ) : null}
            {showBookingButton ? (
              <a
                href={`/s/${slug}/book`}
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius)] bg-white px-5 text-sm font-semibold text-foreground shadow hover:bg-white/90 transition duration-[var(--theme-motion-duration)]"
              >
                {ctaLabel}
              </a>
            ) : null}
          </div>
        </nav>
      </header>
    );
  }

  return (
    <header
      data-section="navbar"
      data-variant="default"
      className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md"
    >
      <nav className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-3 shrink-0">
          {showLogo && logoUrl ? (
            <div className="relative h-9 w-9">
              <Image
                src={logoUrl}
                alt={businessName}
                fill
                sizes="36px"
                className="object-contain"
              />
            </div>
          ) : showLogo ? (
            <span className="text-2xl font-black text-foreground tracking-tight">
              {businessName.charAt(0)}
            </span>
          ) : null}
          {showLogo ? (
            <span
              className="font-bold tracking-tight text-foreground hidden sm:block"
              style={{ fontWeight: "var(--theme-font-weight-heading)" }}
            >
              {businessName}
            </span>
          ) : null}
        </div>

        <ul className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <li>
            <a
              href={`/s/${slug}/#services`}
              className="text-foreground/80 hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Servizi
            </a>
          </li>
          <li>
            <a
              href={`/s/${slug}/#about`}
              className="text-foreground/80 hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Chi Siamo
            </a>
          </li>
          <li>
            <a
              href={`/s/${slug}/#reviews`}
              className="text-foreground/80 hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Recensioni
            </a>
          </li>
          <li>
            <a
              href={`/s/${slug}/#contact`}
              className="text-foreground/80 hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Contatti
            </a>
          </li>
        </ul>

        <div className="flex items-center gap-3 shrink-0">
          {showPhone && sec.data?.phone ? (
            <a
              href={`tel:${sec.data.phone}`}
              className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold text-foreground/80 hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span className="hidden lg:inline">{sec.data.phone}</span>
            </a>
          ) : null}
          {showBookingButton ? (
            <a
              href={`/s/${slug}/book`}
              className="inline-flex h-10 items-center justify-center rounded-[var(--radius)] bg-[var(--p)] px-5 text-sm font-semibold text-[var(--p-foreground)] shadow-sm hover:opacity-90 transition duration-[var(--theme-motion-duration)]"
            >
              {ctaLabel}
            </a>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
