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
  const telHref = d.phone ? normalizePublicLink(`tel:${d.phone.replace(/\s+/g, "")}`) : "";
  const mailto = d.email ? normalizePublicLink(`mailto:${d.email}`) : "";
  const addr = formatAddress(d);

  return (
    <section aria-labelledby="site-contact-title" className="w-full py-16 px-6 bg-white">
      <div className="max-w-4xl mx-auto">
        {eyebrow ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary/80 mb-3">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id="site-contact-title"
          className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-10 break-words"
        >
          {headline}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {telHref ? (
            <li className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Telefono
              </p>
              <a href={telHref} className="text-primary font-semibold hover:underline break-all">
                {d.phone}
              </a>
            </li>
          ) : null}
          {mailto ? (
            <li className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Email
              </p>
              <a href={mailto} className="text-primary font-semibold hover:underline break-all">
                {d.email}
              </a>
            </li>
          ) : null}
          {addr ? (
            <li className="rounded-lg border border-border bg-background p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                Indirizzo
              </p>
              <p className="text-foreground break-words whitespace-pre-wrap">{addr}</p>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
