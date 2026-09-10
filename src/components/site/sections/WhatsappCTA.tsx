import type { PublicSection, WhatsappCtaSection } from "@/lib/server/content-engine";

export function WhatsappCtaSectionComponent(s: PublicSection) {
  const sec = s as WhatsappCtaSection;
  const variant = sec.variant === "inline" ? "inline" : "default";
  const settings = sec.settings ?? {};
  const data = sec.data ?? {};

  const eyebrow = settings.eyebrow ?? null;
  const headline = settings.headline ?? "Scrivici su WhatsApp";
  const subheadline = settings.subheadline ?? null;
  const ctaLabel = settings.ctaLabel ?? "Inizia Chat";
  const prefilledMessage = settings.prefilledMessage ?? "Ciao, vorrei avere informazioni";

  const whatsappNumber = data.whatsapp ?? null;

  if (!whatsappNumber) return null;

  const cleanNumber = String(whatsappNumber).replace(/[^0-9]/g, "");
  const waUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(prefilledMessage)}`;

  const whatsappIcon = (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );

  if (variant === "inline") {
    return (
      <section
        data-section="whatsapp-cta"
        data-variant="inline"
        className="w-full py-8 md:py-12 px-6 bg-background"
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <p className="text-sm md:text-base font-medium text-foreground">{headline}</p>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-full bg-[#25D366] hover:bg-[#22c55e] px-5 md:px-6 py-3 text-sm md:text-base font-semibold text-white shadow-md hover:shadow-lg transition-all duration-[var(--theme-motion-duration)]"
            >
              <span className="text-white">{whatsappIcon}</span>
              {ctaLabel}
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-section="whatsapp-cta"
      data-variant="default"
      className="w-full py-14 md:py-20 px-6 bg-muted/30"
    >
      <div className="max-w-4xl mx-auto">
        <div className="relative rounded-[var(--radius)] border border-border overflow-hidden shadow-lg">
          <div className="bg-gradient-to-r from-[#25D366] via-[#128C7E] to-[#075E54] p-8 md:p-12 lg:p-14">
            <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-white/10 blur-3xl -translate-y-1/3 translate-x-1/3" />
            <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-black/10 blur-3xl translate-y-1/3 -translate-x-1/3" />

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-10">
              <div className="flex flex-col gap-3 md:gap-4 text-white">
                {eyebrow ? (
                  <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-white/80">
                    {eyebrow}
                  </p>
                ) : null}
                <div className="flex items-center gap-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full bg-white/15 backdrop-blur border border-white/20">
                    <span className="text-white" style={{ transform: "scale(1.4)" }}>
                      {whatsappIcon}
                    </span>
                  </div>
                  <h2
                    className="text-2xl md:text-4xl lg:text-5xl tracking-tight leading-tight"
                    style={{ fontWeight: "var(--theme-font-weight-heading)" }}
                  >
                    {headline}
                  </h2>
                </div>
                {subheadline ? (
                  <p className="text-sm md:text-lg text-white/90 leading-relaxed whitespace-pre-wrap max-w-xl">
                    {subheadline}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 shrink-0">
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 md:h-14 items-center justify-center rounded-full bg-white px-7 md:px-9 text-sm md:text-base font-semibold text-[#075E54] shadow-xl hover:bg-white/95 hover:scale-[1.02] transition-all duration-[var(--theme-motion-duration)]"
                >
                  <span className="text-[#25D366] mr-2.5">{whatsappIcon}</span>
                  {ctaLabel}
                </a>
                <p className="text-xs text-white/70 text-center">Risposta in meno di 24h</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
