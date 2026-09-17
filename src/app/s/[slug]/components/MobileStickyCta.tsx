"use client";

import { useSyncExternalStore, useState } from "react";

type MobileStickyCtaProps = {
  slug: string;
  phone: string | null;
  whatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
  businessName: string;
  bookingBasePath?: string;
};

const STORAGE_KEY = "velora:mcta:dismissed:v1";

export default function MobileStickyCta({
  slug,
  phone,
  whatsapp,
  latitude,
  longitude,
  businessName,
  bookingBasePath,
}: MobileStickyCtaProps) {
  const [dismissed, setDismissed] = useState(false);

  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const effectiveDismissed = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage.getItem(STORAGE_KEY) === "1";
        }
      } catch {
        /* privacy */
      }
      return false;
    },
    () => false,
  );

  if (!hydrated) return null;
  if (effectiveDismissed || dismissed) return null;

  const dismiss = () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(STORAGE_KEY, "1");
      }
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

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
    <div className="md:hidden fixed inset-x-0 bottom-0 z-[80] pointer-events-none">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Nascondi la barra delle azioni rapide"
        className="pointer-events-auto absolute -top-8 right-2 h-7 w-7 rounded-full bg-background border border-border text-muted-foreground inline-flex items-center justify-center shadow-sm text-xs hover:text-foreground transition"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 6L18 18M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <nav
        className="mobile-sticky-cta pointer-events-auto"
        aria-label="Azioni rapide per dispositivi mobili"
      >
        <a
          className="mobile-sticky-cta__btn"
          href={bookingHref}
          onClick={handleBookingClick}
          aria-label="Prenota un appuntamento"
        >
          <span className="mobile-sticky-cta__icon" aria-hidden>
            📅
          </span>
          <span>Prenota</span>
        </a>

        {telHref ? (
          <a
            className="mobile-sticky-cta__btn"
            href={telHref}
            aria-label={`Chiama ${businessName}`}
          >
            <span className="mobile-sticky-cta__icon" aria-hidden>
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
            <span className="mobile-sticky-cta__icon" aria-hidden>
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
            <span className="mobile-sticky-cta__icon" aria-hidden>
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
            <span className="mobile-sticky-cta__icon" aria-hidden>
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
            <span className="mobile-sticky-cta__icon" aria-hidden>
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
            <span className="mobile-sticky-cta__icon" aria-hidden>
              🧭
            </span>
            <span>Indicazioni</span>
          </button>
        )}
      </nav>
    </div>
  );
}
