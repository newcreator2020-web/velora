import type { PublicTheme } from "@/lib/server/content-engine";
import { applyTheme } from "@/lib/design-tokens/apply";
import { SectionRevealObserver } from "./SectionRevealObserver";

export function SiteShell(props: {
  theme: PublicTheme;
  children: React.ReactNode;
  siteSlug?: string | null;
}) {
  const slugProp = typeof props.siteSlug === "string" ? props.siteSlug : null;
  const t = props.theme;

  const presetId = (t as unknown as { preset?: string | null | undefined })?.preset ?? null;
  const applied = applyTheme(t, presetId ?? undefined);

  const styleVars = applied.cssVars;
  const fonts = {
    bodyClass: applied.bodyFontClass,
    headingClass: applied.headingFontClass,
  };
  const radiusClass = applied.radiusClass;

  const trackingInline = `
(function () {
  try {
    if (typeof window === 'undefined') return;
    var slugFromProps = ${slugProp ? JSON.stringify(slugProp) : "null"};
    var detected = null;
    if (slugFromProps) {
      detected = slugFromProps;
    } else if (typeof location !== 'undefined' && location.pathname) {
      var m = location.pathname.match(/^\\/s\\/([a-z0-9][a-z0-9-]{0,59})(?:\\/|$)/);
      if (m && m[1]) detected = m[1];
    }
    window.__VELORA_TRACK_SLUG__ = detected;

    function setCookie(name, value, days) {
      try {
        var exp = new Date();
        exp.setTime(exp.getTime() + (days || 365) * 24 * 60 * 60 * 1000);
        document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp.toUTCString() + '; path=/; SameSite=Lax';
      } catch (e) { /* noop */ }
    }
    function readCookie(name) {
      try {
        var nameEq = name + '=';
        var ca = document.cookie ? document.cookie.split('; ') : [];
        for (var i = 0; i < ca.length; i++) {
          var c = ca[i];
          if (c.substring(0, nameEq.length) === nameEq) return decodeURIComponent(c.substring(nameEq.length));
        }
      } catch (e) { /* noop */ }
      return null;
    }
    function genUUID() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        var h = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          var v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        return h;
      } catch (e) {
        return '00000000-0000-4000-8000-' + (Date.now().toString(16).slice(0, 12));
      }
    }
    var anonId = readCookie('velora_anon_id');
    if (!anonId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonId)) {
      anonId = genUUID();
      setCookie('velora_anon_id', anonId, 365);
    }
    window.__VELORA_ANON_ID__ = anonId;

    window.trackEvent = function (action, opts) {
      try {
        if (!window.__VELORA_TRACK_SLUG__) return;
        if (!action || typeof action !== 'string') return;
        var o = opts || {};
        var body = {
          action: action,
          label: typeof o.label === 'string' ? o.label.slice(0, 500) : undefined,
          page_slug: typeof o.page_slug === 'string' ? o.page_slug.slice(0, 120) : (typeof location !== 'undefined' ? location.pathname.slice(0, 120) : undefined),
          referer: typeof o.referer === 'string' ? o.referer.slice(0, 500) : (typeof document !== 'undefined' ? (document.referrer || '').slice(0, 500) : undefined),
          user_anon_id: window.__VELORA_ANON_ID__ || null,
          meta: o.meta && typeof o.meta === 'object' ? o.meta : undefined,
          correlation_id: typeof o.correlation_id === 'string' ? o.correlation_id : undefined,
        };
        if (typeof fetch === 'function') {
          fetch('/api/events/track', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-velora-slug': window.__VELORA_TRACK_SLUG__,
            },
            body: JSON.stringify(body),
            credentials: 'same-origin',
            keepalive: typeof navigator !== 'undefined' && typeof navigator.sendBeacon !== 'function' ? true : false,
          }).catch(function () { /* fire-and-forget */ });
        } else if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          try {
            var blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
            navigator.sendBeacon('/api/events/track?slug=' + encodeURIComponent(window.__VELORA_TRACK_SLUG__), blob);
          } catch (e) { /* noop */ }
        }
      } catch (e) { /* fire-and-forget, ignore errors */ }
    };

    // Click delegation handler
    function onClickDelegated(ev) {
      try {
        if (!ev || !(ev.target instanceof Element)) return;
        var a = ev.target.closest && ev.target.closest('a');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (href.length === 0) return;
        var track = a.getAttribute && a.getAttribute('data-track');
        var label = (a.textContent || '').trim().slice(0, 120) || href;
        if (track === 'click_book' || /\\/booking(?:\\/|$|\\?|#)/i.test(href)) {
          window.trackEvent('click_book', { label: label });
          return;
        }
        if (/^tel:/i.test(href)) {
          window.trackEvent('click_call', { label: href.replace(/^tel:/i, '').replace(/[^0-9+]/g, '') || label });
          return;
        }
        if (/whatsapp|wa\\.me/i.test(href)) {
          window.trackEvent('click_whatsapp', { label: href.slice(0, 120) || label });
          return;
        }
        if (/maps\\.(google|apple)\\.com|google\\.com\\/maps|openstreetmap\\.org|osm\\.org/i.test(href)) {
          window.trackEvent('click_maps', { label: label });
          return;
        }
        if (track === 'click_call') {
          window.trackEvent('click_call', { label: label });
          return;
        }
        if (track === 'click_whatsapp') {
          window.trackEvent('click_whatsapp', { label: label });
          return;
        }
        if (track === 'click_maps') {
          window.trackEvent('click_maps', { label: label });
          return;
        }
      } catch (e) { /* noop */ }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', function () {
          document.addEventListener('click', onClickDelegated, true);
          try { window.trackEvent('page_view', {}); } catch (e) {}
        });
      } else {
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('click', onClickDelegated, true);
        }
        // fire page_view soon, debounce
        setTimeout(function () { try { window.trackEvent('page_view', {}); } catch (e) {} }, 150);
      }
    }
  } catch (e) { /* tracking è best-effort */ }
})();
`;

  return (
    <div
      className={`site-shell min-h-screen w-full ${fonts.bodyClass} bg-background text-foreground ${radiusClass}`}
      style={styleVars}
    >
      <SectionRevealObserver />
      <div className={`${fonts.headingClass}`} data-site-heading-font>
        {props.children}
      </div>
      <footer className="w-full py-10 px-6 border-t border-border text-sm text-muted-foreground">
        <div className="max-w-5xl mx-auto text-center">
          <p>Sito realizzato con Velora</p>
        </div>
      </footer>
      <script
        key="velora-events-tracker-v1"
        dangerouslySetInnerHTML={{ __html: trackingInline }}
        defer
      />
    </div>
  );
}
