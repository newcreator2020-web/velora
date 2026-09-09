import type { ContactSection } from "@/lib/server/content-engine";
import { normalizePublicLink } from "@/lib/server/content-engine";

function formatAddress(d: ContactSection["data"]): string | null {
  const parts = [d.address, d.postalCode, d.city, d.province, d.countryCode].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function ContactSectionComponent(section: ContactSection) {
  const d = section.data;
  const hasAny =
    (d.phone && d.phone.trim().length > 0) ||
    (d.email && d.email.trim().length > 0) ||
    !!formatAddress(d);
  if (!hasAny) return null;

  const eyebrow = section.settings.eyebrow ?? null;
  const headline = section.settings.headline ?? "Contatti";
  const variant = section.variant === "split" ? "split" : "minimal";
  const telHref = d.phone ? normalizePublicLink(`tel:${d.phone.replace(/\s+/g, "")}`) : "";
  const mailto = d.email ? normalizePublicLink(`mailto:${d.email}`) : "";
  const addr = formatAddress(d);

  if (variant === "split") {
    return (
      <section
        aria-labelledby="site-contact-title"
        data-section="contact"
        data-variant="split"
        className="w-full py-16 md:py-24 px-6 bg-muted/30"
      >
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 md:gap-16 items-start">
          <div className="flex flex-col gap-5 text-left">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id="site-contact-title"
              className="text-3xl md:text-5xl font-bold tracking-tight text-foreground mb-2 break-words leading-[1.1]"
            >
              {headline}
            </h2>
            <p className="text-base md:text-lg text-muted-foreground">
              Siamo a disposizione per rispondere a ogni domanda o prenotazione.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {telHref ? (
              <a
                href={telHref}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-all flex items-center gap-5"
              >
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl">
                  📞
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Telefono
                  </span>
                  <span className="text-lg font-bold text-foreground group-hover:text-primary transition break-all">
                    {d.phone}
                  </span>
                </div>
              </a>
            ) : null}
            {mailto ? (
              <a
                href={mailto}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-all flex items-center gap-5"
              >
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl">
                  ✉️
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Email
                  </span>
                  <span className="text-lg font-bold text-foreground group-hover:text-primary transition break-all">
                    {d.email}
                  </span>
                </div>
              </a>
            ) : null}
            {addr ? (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex items-start gap-5">
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl">
                  📍
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Indirizzo
                  </span>
                  <p className="text-base md:text-lg font-semibold text-foreground break-words whitespace-pre-wrap">
                    {addr}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="site-contact-title"
      data-section="contact"
      data-variant="minimal"
      className="w-full py-12 md:py-16 px-6 bg-background"
    >
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 md:mb-10">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground mb-2">
              {eyebrow}
            </p>
          ) : null}
          <h2
            id="site-contact-title"
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground break-words"
          >
            {headline}
          </h2>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          {telHref ? (
            <li className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Telefono
              </h3>
              <a
                href={telHref}
                className="text-primary font-semibold hover:underline break-all text-sm md:text-base"
              >
                {d.phone}
              </a>
            </li>
          ) : null}
          {mailto ? (
            <li className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Email
              </h3>
              <a
                href={mailto}
                className="text-primary font-semibold hover:underline break-all text-sm md:text-base"
              >
                {d.email}
              </a>
            </li>
          ) : null}
          {addr ? (
            <li className="flex flex-col gap-1 rounded-xl border border-border bg-card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Indirizzo
              </h3>
              <p className="text-foreground break-words whitespace-pre-wrap text-sm md:text-base font-medium">
                {addr}
              </p>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
