"use client";

import Script from "next/script";
import { useEffect, useState, startTransition } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type CookiePreferences = {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  version: "v1";
  timestamp: number;
};

const STORAGE_KEY = "velora_gdpr_v1";
const DEFAULT_PREFS: CookiePreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
  version: "v1",
  timestamp: 0,
};

type CookieBannerProps = {
  slug: string;
  tenantId: string;
  privacyHref: string;
  cookieHref: string;
};

function readStoredPrefs(): CookiePreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
    if (parsed && parsed.version === "v1" && typeof parsed.timestamp === "number") {
      return {
        necessary: true,
        analytics: Boolean(parsed.analytics),
        marketing: Boolean(parsed.marketing),
        version: "v1",
        timestamp: parsed.timestamp,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function saveConsentDb(
  slug: string,
  tenantId: string,
  prefs: CookiePreferences,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const sb = getSupabaseBrowserClient();
    const payload = {
      site_slug: slug,
      preferences: {
        necessary: prefs.necessary,
        analytics: prefs.analytics,
        marketing: prefs.marketing,
      },
      version: prefs.version,
    };
    const row = {
      tenant_id: tenantId,
      type: "cookie_preferences_accepted",
      consent_url: window.location.href,
      payload,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb as any).from("gdpr_consents").insert(row);
  } catch {
    // no-op: non blocchiamo l'utente per un fallimento audit
  }
}

export default function CookieBanner({
  slug,
  tenantId,
  privacyHref,
  cookieHref,
}: CookieBannerProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>(DEFAULT_PREFS);
  const [savedPrefs, setSavedPrefs] = useState<CookiePreferences | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const stored = readStoredPrefs();
    startTransition(() => {
      if (stored) {
        setSavedPrefs(stored);
        setPrefs(stored);
        setShowBanner(false);
      } else {
        setShowBanner(true);
      }
    });
  }, []);

  useEffect(() => {
    if (showBanner) {
      document.documentElement.classList.add("gdpr-banner-visible");
      document.documentElement.style.setProperty("--gdpr-banner-height", "188px");
    } else {
      document.documentElement.classList.remove("gdpr-banner-visible");
      document.documentElement.style.setProperty("--gdpr-banner-height", "0px");
    }
    return () => {
      document.documentElement.classList.remove("gdpr-banner-visible");
      document.documentElement.style.setProperty("--gdpr-banner-height", "0px");
    };
  }, [showBanner]);

  useEffect(() => {
    if (!showModal) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowModal(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

  async function commitChoice(next: CookiePreferences) {
    setSubmitting(true);
    try {
      const stamped: CookiePreferences = { ...next, timestamp: Date.now() };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
      }
      setSavedPrefs(stamped);
      setPrefs(stamped);
      setShowBanner(false);
      setShowModal(false);
      await saveConsentDb(slug, tenantId, stamped);
    } finally {
      setSubmitting(false);
    }
  }

  function handleAcceptAll() {
    return commitChoice({
      necessary: true,
      analytics: true,
      marketing: true,
      version: "v1",
      timestamp: 0,
    });
  }

  function handleRejectNonNecessary() {
    return commitChoice({
      necessary: true,
      analytics: false,
      marketing: false,
      version: "v1",
      timestamp: 0,
    });
  }

  function handleSaveFromModal() {
    return commitChoice({ ...prefs, necessary: true });
  }

  const hasAnalytics = savedPrefs?.analytics === true;
  const hasMarketing = savedPrefs?.marketing === true;

  return (
    <>
      {hasAnalytics && (
        <>
          <Script
            id="velora-ga-stub"
            strategy="afterInteractive"
          >{`window.ga=window.ga||function(){(ga.q=ga.q||[]).push(arguments)};ga.l=+new Date;`}</Script>
        </>
      )}
      {hasMarketing && (
        <>
          <Script
            id="velora-meta-stub"
            strategy="afterInteractive"
          >{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');`}</Script>
        </>
      )}

      {showModal && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="gdpr-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            className="gdpr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gdpr-modal-title"
          >
            <div className="gdpr-modal-header">
              <h2 id="gdpr-modal-title" className="gdpr-modal-title">
                Preferenze dettagliate cookie
              </h2>
              <button
                type="button"
                className="gdpr-modal-close"
                aria-label="Chiudi preferenze cookie"
                onClick={() => setShowModal(false)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="gdpr-modal-body">
              <div className="gdpr-category">
                <div className="gdpr-category-header">
                  <div>
                    <div className="gdpr-category-name">Necessari</div>
                  </div>
                  <label className="gdpr-toggle" aria-label="Cookie necessari sempre attivi">
                    <input type="checkbox" checked disabled aria-disabled="true" />
                    <span className="gdpr-toggle-slider" />
                  </label>
                </div>
                <p className="gdpr-category-desc">
                  Cookie tecnici essenziali per il corretto funzionamento del sito (autenticazione,
                  sicurezza, preferenze). Non possono essere disattivati. Durata massima: 1 ora
                  (cookie di sessione Supabase, HttpOnly).
                </p>
              </div>

              <div className="gdpr-category">
                <div className="gdpr-category-header">
                  <div>
                    <div className="gdpr-category-name">Analytics</div>
                  </div>
                  <label className="gdpr-toggle" aria-label="Attiva cookie analytics">
                    <input
                      type="checkbox"
                      checked={prefs.analytics}
                      onChange={(e) => setPrefs((p) => ({ ...p, analytics: e.target.checked }))}
                    />
                    <span className="gdpr-toggle-slider" />
                  </label>
                </div>
                <p className="gdpr-category-desc">
                  Cookie anonimi per misurare l&apos;utilizzo del sito e migliorare
                  l&apos;esperienza utente. Cookie Google Analytics: <code>_ga</code>,{" "}
                  <code>_ga_*</code> — conservati per 14 mesi.
                </p>
              </div>

              <div className="gdpr-category">
                <div className="gdpr-category-header">
                  <div>
                    <div className="gdpr-category-name">Marketing</div>
                  </div>
                  <label className="gdpr-toggle" aria-label="Attiva cookie marketing">
                    <input
                      type="checkbox"
                      checked={prefs.marketing}
                      onChange={(e) => setPrefs((p) => ({ ...p, marketing: e.target.checked }))}
                    />
                    <span className="gdpr-toggle-slider" />
                  </label>
                </div>
                <p className="gdpr-category-desc">
                  Cookie di terze parti per mostrare annunci personalizzati e campagne di
                  remarketing. Meta/Facebook pixel: <code>_fbp</code>, <code>_fbc</code> —
                  conservati per 90 giorni.
                </p>
              </div>
            </div>
            <div className="gdpr-modal-footer">
              <button
                type="button"
                className="gdpr-btn gdpr-btn-secondary"
                onClick={handleRejectNonNecessary}
                disabled={submitting}
              >
                Rifiuta non necessari
              </button>
              <button
                type="button"
                className="gdpr-btn gdpr-btn-primary"
                onClick={handleSaveFromModal}
                disabled={submitting}
              >
                Salva preferenze
              </button>
            </div>
          </div>
        </div>
      )}

      {showBanner && (
        <div className="gdpr-banner" role="region" aria-label="Informativa cookie">
          <div className="gdpr-banner-inner">
            <div className="gdpr-banner-content">
              <div className="gdpr-banner-title">Cookie e privacy</div>
              <p className="gdpr-banner-text">
                Utilizziamo cookie per garantire il funzionamento del sito e, previo tuo consenso,
                per analisi del traffico e campagne marketing. Leggi la{" "}
                <a href={privacyHref}>Privacy Policy</a> e la <a href={cookieHref}>Cookie Policy</a>
                .
              </p>
            </div>
            <div className="gdpr-banner-actions">
              <button
                type="button"
                className="gdpr-btn gdpr-btn-ghost"
                onClick={() => setShowModal(true)}
                disabled={submitting}
              >
                Preferenze dettagliate
              </button>
              <button
                type="button"
                className="gdpr-btn gdpr-btn-secondary"
                onClick={handleRejectNonNecessary}
                disabled={submitting}
              >
                Rifiuta non necessari
              </button>
              <button
                type="button"
                className="gdpr-btn gdpr-btn-primary"
                onClick={handleAcceptAll}
                disabled={submitting}
              >
                Accetta tutto
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
