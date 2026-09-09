"use client";

type MobileStickyCtaProps = {
  slug: string;
  phone: string | null;
  whatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
  businessName: string;
  bookingBasePath?: string;
};

export default function MobileStickyCta({
  slug,
  phone,
  whatsapp,
  latitude,
  longitude,
  businessName,
  bookingBasePath,
}: MobileStickyCtaProps) {
  const base =
    typeof bookingBasePath === "string" && bookingBasePath.length > 0
      ? bookingBasePath.replace(/\/+$/, "")
      : `/s/${encodeURIComponent(slug)}`;
  const bookingHref = `${base}/#booking`;
  const telHref = phone ? `tel:${phone}` : null;

  const whatsappDigitOnly = whatsapp ? whatsapp.replace(/[+\s-]/g, "") : null;
  const waText = encodeURIComponent(`Ciao ${businessName}, vorrei informazioni...`);
  const waHref = whatsappDigitOnly ? `https://wa.me/${whatsappDigitOnly}?text=${waText}` : null;

  const hasCoords =
    latitude !== null && longitude !== null && !Number.isNaN(latitude) && !Number.isNaN(longitude);
  const mapsHref = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`
    : null;

  function handleBookingClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (typeof document === "undefined") return;
    const target = document.getElementById("booking");
    if (!target) {
      e.preventDefault();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(bookingHref);
      return;
    }
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="mobile-sticky-cta md:hidden" aria-label="Azioni rapide per dispositivi mobili">
      <a
        className="mobile-sticky-cta__btn"
        href={bookingHref}
        onClick={handleBookingClick}
        aria-label="Prenota un appuntamento"
      >
        <span className="mobile-sticky-cta__icon" aria-hidden="true">
          📅
        </span>
        <span>Prenota</span>
      </a>

      {telHref ? (
        <a className="mobile-sticky-cta__btn" href={telHref} aria-label={`Chiama ${businessName}`}>
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            📞
          </span>
          <span>Chiama</span>
        </a>
      ) : (
        <button
          type="button"
          className="mobile-sticky-cta__btn mobile-sticky-cta__btn--muted"
          aria-disabled="true"
          aria-label="Numero di telefono non disponibile"
          disabled
        >
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            📞
          </span>
          <span>Chiama</span>
        </button>
      )}

      {waHref ? (
        <a
          className="mobile-sticky-cta__btn"
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Scrivi a ${businessName} su WhatsApp`}
        >
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            💬
          </span>
          <span>WhatsApp</span>
        </a>
      ) : (
        <button
          type="button"
          className="mobile-sticky-cta__btn mobile-sticky-cta__btn--muted"
          aria-disabled="true"
          aria-label="WhatsApp non disponibile"
          disabled
        >
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            💬
          </span>
          <span>WhatsApp</span>
        </button>
      )}

      {mapsHref ? (
        <a
          className="mobile-sticky-cta__btn"
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Apri indicazioni stradali su Google Maps"
        >
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            🧭
          </span>
          <span>Indicazioni</span>
        </a>
      ) : (
        <button
          type="button"
          className="mobile-sticky-cta__btn mobile-sticky-cta__btn--muted"
          aria-disabled="true"
          aria-label="Indirizzo non disponibile"
          disabled
        >
          <span className="mobile-sticky-cta__icon" aria-hidden="true">
            🧭
          </span>
          <span>Indicazioni</span>
        </button>
      )}
    </nav>
  );
}
