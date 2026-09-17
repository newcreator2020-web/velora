import Image from "next/image";
import type { PublicSection, FooterSection, PublicTheme } from "@/lib/server/content-engine";

export function FooterSectionComponent(s: PublicSection) {
  const sec = s as FooterSection;
  const extras = sec as unknown as { slug?: string; theme?: PublicTheme };
  const variant = sec.variant === "minimal" ? "minimal" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};
  const theme = extras.theme ?? {};
  const slug = extras.slug ?? "";

  const businessName = data.businessName ?? "Nome Attività";
  const phone = data.phone ?? null;
  const email = data.email ?? null;
  const address = data.address ?? null;
  const showBrand = settings.showBrand !== false;
  const showNavLinks = settings.showNavLinks !== false;
  const showContactMini = settings.showContactMini !== false;
  const copyrightOwner = settings.copyrightOwner ?? businessName;
  const logoUrl = theme.logo_url ?? null;

  const currentYear = new Date().getFullYear();

  if (variant === "minimal") {
    return (
      <footer
        data-section="footer"
        data-variant="minimal"
        className="w-full border-t border-border bg-background"
      >
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {showBrand && logoUrl ? (
              <div className="relative h-7 w-7">
                <Image
                  src={logoUrl}
                  alt={businessName}
                  fill
                  sizes="28px"
                  className="object-contain"
                />
              </div>
            ) : showBrand ? (
              <span className="text-lg font-black text-foreground tracking-tight">
                {businessName.charAt(0)}
              </span>
            ) : null}
            {showBrand ? (
              <span
                className="font-bold text-foreground text-sm"
                style={{ fontWeight: "var(--theme-font-weight-heading)" }}
              >
                {businessName}
              </span>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            © {currentYear} {copyrightOwner}. Tutti i diritti riservati.
          </p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a
              href={`/s/${slug}/privacy`}
              className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Privacy
            </a>
            <span className="opacity-40">|</span>
            <a
              href={`/s/${slug}/cookie`}
              className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Cookie
            </a>
            <span className="opacity-40">|</span>
            <a
              href={`/s/${slug}/terms`}
              className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
            >
              Termini
            </a>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer
      data-section="footer"
      data-variant="default"
      className="w-full border-t border-border bg-background"
    >
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          <div className="flex flex-col gap-4">
            {showBrand ? (
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <div className="relative h-10 w-10">
                    <Image
                      src={logoUrl}
                      alt={businessName}
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <span className="text-3xl font-black text-foreground tracking-tight">
                    {businessName.charAt(0)}
                  </span>
                )}
                <span
                  className="font-bold text-foreground text-lg"
                  style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                >
                  {businessName}
                </span>
              </div>
            ) : null}
            {address ? (
              <p className="text-sm text-muted-foreground leading-relaxed">{address}</p>
            ) : null}
            {phone ? (
              <a
                href={`tel:${phone}`}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition duration-[var(--theme-motion-duration)] w-fit"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {phone}
              </a>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}`}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition duration-[var(--theme-motion-duration)] w-fit break-all"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-10 5L2 7" />
                </svg>
                {email}
              </a>
            ) : null}
          </div>

          {showNavLinks ? (
            <div className="flex flex-col gap-3">
              <h4
                className="text-sm font-semibold text-foreground uppercase tracking-wider"
                style={{ fontWeight: "var(--theme-font-weight-heading)" }}
              >
                Navigazione
              </h4>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                <li>
                  <a
                    href={`/s/${slug}/#services`}
                    className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                  >
                    Servizi
                  </a>
                </li>
                <li>
                  <a
                    href={`/s/${slug}/#about`}
                    className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                  >
                    Chi Siamo
                  </a>
                </li>
                <li>
                  <a
                    href={`/s/${slug}/#staff`}
                    className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                  >
                    Team
                  </a>
                </li>
                <li>
                  <a
                    href={`/s/${slug}/#reviews`}
                    className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                  >
                    Recensioni
                  </a>
                </li>
                <li>
                  <a
                    href={`/s/${slug}/book`}
                    className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                  >
                    Prenota
                  </a>
                </li>
              </ul>
            </div>
          ) : null}

          {showContactMini ? (
            <div className="flex flex-col gap-3">
              <h4
                className="text-sm font-semibold text-foreground uppercase tracking-wider"
                style={{ fontWeight: "var(--theme-font-weight-heading)" }}
              >
                Contatti
              </h4>
              <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                {address ? (
                  <li className="flex items-start gap-3">
                    <svg
                      className="w-4 h-4 mt-0.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="leading-relaxed">{address}</span>
                  </li>
                ) : null}
                {phone ? (
                  <li className="flex items-start gap-3">
                    <svg
                      className="w-4 h-4 mt-0.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <a
                      href={`tel:${phone}`}
                      className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                    >
                      {phone}
                    </a>
                  </li>
                ) : null}
                {email ? (
                  <li className="flex items-start gap-3">
                    <svg
                      className="w-4 h-4 mt-0.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-10 5L2 7" />
                    </svg>
                    <a
                      href={`mailto:${email}`}
                      className="hover:text-foreground transition duration-[var(--theme-motion-duration)] break-all"
                    >
                      {email}
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <h4
              className="text-sm font-semibold text-foreground uppercase tracking-wider"
              style={{ fontWeight: "var(--theme-font-weight-heading)" }}
            >
              Legale
            </h4>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>
                <a
                  href={`/s/${slug}/privacy`}
                  className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href={`/s/${slug}/cookie`}
                  className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                >
                  Cookie Policy
                </a>
              </li>
              <li>
                <a
                  href={`/s/${slug}/terms`}
                  className="hover:text-foreground transition duration-[var(--theme-motion-duration)]"
                >
                  Termini e Condizioni
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            © {currentYear} {copyrightOwner}. Tutti i diritti riservati.
          </p>
          <p className="text-xs text-muted-foreground">Made with ❤️ in Italia</p>
        </div>
      </div>
    </footer>
  );
}
