"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useRef,
  useTransition,
} from "react";
import { createBookingAction, declareBankTransferAction } from "./actions";
import type { BookingActionState, BankInfo, BookingPaymentInfo } from "./actions";
import type { BusinessAvailabilityRow, PublicResourceOption, Slot } from "@/lib/server/booking";

type ServiceOption = {
  id: string;
  name: string;
  duration_minutes: number | null;
  price_from: number | null;
  currency: string;
  active: boolean;
};

type PublicBookingFormProps = {
  slug: string;
  csrfToken?: string;
  services: ServiceOption[];
  availability: BusinessAvailabilityRow[];
  timezone: string;
  horizonDays?: number;
  slotsApiBase?: string;
  businessName?: string;
  businessAddress?: string;
};

const CSRF_COOKIE_NAME = "velora_csrf_token";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function safeRandomToken(): string {
  const arr = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isoDateDmy(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function robustParseIso(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    const asStr = Object.prototype.toString.call(dt);
    if (asStr !== "[object Date]") return null;
    return dt;
  } catch {
    return null;
  }
}

function formatDateRawFallback(iso: string): string {
  try {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
    if (iso.length >= 16) return iso.replace("T", " ").substring(0, 16);
    return iso;
  } catch {
    return "data e ora richieste";
  }
}

function safeFormatDateTime(iso: string | undefined | null, tz: string): string {
  if (!iso) return "";
  const dt = robustParseIso(iso);
  if (!dt) return formatDateRawFallback(String(iso));
  try {
    const fmt = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const formatted = fmt.format(dt);
    if (!formatted || /invalid date/i.test(formatted)) {
      return formatDateRawFallback(String(iso));
    }
    return formatted;
  } catch {
    return formatDateRawFallback(String(iso));
  }
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function ClientFormattedDate({
  iso,
  tz,
  placeholder,
}: {
  iso: string | undefined | null;
  tz: string;
  placeholder?: string;
}) {
  const isClient = useIsClient();
  if (!isClient) {
    const fallback = iso ? formatDateRawFallback(String(iso)) : (placeholder ?? "");
    return <>{fallback}</>;
  }
  return <>{safeFormatDateTime(iso, tz)}</>;
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] as const;

declare global {
  interface Window {
    trackEvent?: (
      action: string,
      opts?: {
        label?: string;
        page_slug?: string;
        referer?: string;
        meta?: Record<string, unknown>;
        correlation_id?: string;
      },
    ) => void;
  }
}

export default function PublicBookingForm(props: PublicBookingFormProps) {
  const {
    slug,
    csrfToken: csrfTokenProp,
    services,
    availability,
    timezone,
    slotsApiBase,
    businessName: businessNameProp,
    businessAddress: businessAddressProp,
  } = props;
  const businessName = businessNameProp && businessNameProp.length > 0 ? businessNameProp : slug;
  const businessAddress = businessAddressProp ?? "";
  const csrfToken =
    (csrfTokenProp && csrfTokenProp.length >= 16 ? csrfTokenProp : null) ??
    readCookie(CSRF_COOKIE_NAME) ??
    safeRandomToken();

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!csrfToken || csrfToken.length < 16) return;
    const existing = readCookie(CSRF_COOKIE_NAME);
    if (existing === csrfToken) return;
    const secure = typeof window !== "undefined" && window.location.protocol === "https:";
    const parts = [
      `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
      "path=/",
      "SameSite=Lax",
      `max-age=${60 * 60}`,
    ];
    if (secure) parts.push("Secure");
    document.cookie = parts.join("; ");
  }, [csrfToken]);

  const slotsBase = slotsApiBase ?? `/s/${encodeURIComponent(slug)}/booking/slots`;
  const activeServices = useMemo(
    () => services.filter((s) => s.active && s.duration_minutes && s.duration_minutes > 0),
    [services],
  );
  const [serviceId, setServiceId] = useState<string>(activeServices[0]?.id ?? "");
  const [resourceSlug, setResourceSlug] = useState<string>("any");
  const [resources, setResources] = useState<PublicResourceOption[]>([]);
  const [date, setDate] = useState<string>(() => {
    const n = new Date();
    return isoDateDmy(n);
  });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [formState, setFormState] = useState<BookingActionState | undefined>(undefined);
  const [declareFormState, setDeclareFormState] = useState<BookingActionState | undefined>(
    undefined,
  );
  const [isPending, startTransition] = useTransition();
  const [declarePending, startDeclareTransition] = useTransition();
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const declareFormRef = useRef<HTMLFormElement>(null);
  const startedRef = useRef(false);
  const confirmedRef = useRef(false);

  const emitTrack = useCallback(
    (
      action: "booking_started" | "booking_confirmed" | "booking_cancelled",
      extraMeta?: Record<string, unknown>,
    ) => {
      try {
        if (typeof window === "undefined") return;
        if (typeof window.trackEvent !== "function") return;
        const svcName = activeServices.find((s) => s.id === serviceId)?.name ?? null;
        const meta: Record<string, unknown> = {
          service_id: serviceId || null,
          service_name: svcName,
          resource_slug: resourceSlug || null,
          slot_iso: slot?.iso ?? null,
          ...(extraMeta ?? {}),
        };
        const trackOpts: {
          label?: string;
          meta?: Record<string, unknown>;
          page_slug?: string;
          referer?: string;
          correlation_id?: string;
        } = {
          label: svcName ? `Booking ${svcName}` : `Booking ${slug}`,
          meta,
        };
        if (
          typeof window !== "undefined" &&
          typeof window.location === "object" &&
          window.location.pathname
        ) {
          trackOpts.page_slug = window.location.pathname;
        }
        window.trackEvent(action, trackOpts);
      } catch {
        /* fire-and-forget */
      }
    },
    [activeServices, serviceId, resourceSlug, slot, slug],
  );

  function markStarted() {
    if (startedRef.current) return;
    startedRef.current = true;
    emitTrack("booking_started");
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    markStarted();
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    fd.set("privacy_accepted", privacyAccepted ? "1" : "0");
    fd.set("slug", slug);
    if (serviceId) fd.set("service_id", serviceId);
    if (resourceSlug) fd.set("resource_slug", resourceSlug);
    if (slot?.iso) fd.set("starts_at", slot.iso);
    startTransition(async () => {
      const result = await createBookingAction(fd);
      setFormState(result);
    });
  };

  useEffect(() => {
    if (formState && formState.ok && !confirmedRef.current) {
      confirmedRef.current = true;
      const extra: Record<string, unknown> = {};
      if (formState.booking) {
        const b = formState.booking as unknown as Record<string, unknown>;
        extra["booking_id"] = b["booking_id"] ?? null;
        extra["starts_at"] = b["starts_at"] ?? null;
        extra["resource_display_name"] = b["resource_display_name"] ?? null;
      }
      emitTrack("booking_confirmed", extra);
    }
    if (formState && formState.ok && formState.redirectToCheckout) {
      const url = formState.redirectToCheckout;
      if (typeof window !== "undefined") {
        window.location.href = url;
      }
    }
    if (formState && typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [formState, emitTrack]);

  const multiMode = resources.length >= 2;

  useEffect(() => {
    let cancelled = false;
    if (!serviceId) {
      queueMicrotask(() => {
        setResources([]);
        setResourceSlug("any");
      });
      return;
    }
    const url = `/api/res?slug=${encodeURIComponent(slug)}&service_id=${encodeURIComponent(serviceId)}`;
    const doFetch = (attempt: number) => {
      if (cancelled) return;
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          if (!cancelled) {
            const arr = (data?.resources ?? []) as PublicResourceOption[];
            setResources(arr);
            setResourceSlug("any");
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt === 0) {
            setTimeout(() => doFetch(1), 500);
            return;
          }
          setResources([]);
          setResourceSlug("any");
        });
    };
    doFetch(0);
    return () => {
      cancelled = true;
    };
  }, [serviceId, slug]);

  const weekdayOfSelected = useMemo(() => {
    const parts = date.split("-");
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    return new Date(y, m - 1, d).getDay();
  }, [date]);
  const avSelected = availability.find((a) => a.weekday === weekdayOfSelected);

  const horizon = props.horizonDays ?? 45;
  const minDate = isoDateDmy(new Date());
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + horizon);
  const maxDate = isoDateDmy(maxDateObj);

  const privacyPolicyHref = `/s/${encodeURIComponent(slug)}/privacy-policy`;
  const canSubmit = Boolean(slot && slot.available && serviceId && privacyAccepted);
  const fieldErrors = (formState as BookingActionState)?.fieldErrors;

  function fmtEuro(cents: number | null | undefined): string {
    if (cents == null || !Number.isFinite(cents)) return "—";
    const eur = Number(cents) / 100;
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(eur);
  }

  function shortBookingCode(bookingId?: string): string {
    if (!bookingId) return "";
    return String(bookingId).slice(0, 8);
  }

  function buildCausale(paymentInfo: BookingPaymentInfo | undefined, bookingId?: string): string {
    const bank = paymentInfo?.bank_info;
    const tmpl = bank?.payment_note_template;
    const code = shortBookingCode(bookingId);
    if (tmpl && tmpl.length > 0) {
      return tmpl.replaceAll("{{booking_code}}", code || "");
    }
    const parts: string[] = ["Caparra prenotazione"];
    if (paymentInfo?.service_name) parts.push(paymentInfo.service_name);
    if (code) parts.push(`cod. ${code}`);
    return parts.join(" · ");
  }

  function handleDeclareSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = declareFormRef.current;
    if (!form || !formState?.booking?.booking_id) return;
    const fd = new FormData(form);
    fd.set("booking_id", formState.booking.booking_id);
    const prev = declareFormState ?? { ok: false };
    startDeclareTransition(async () => {
      const res = await declareBankTransferAction(prev as BookingActionState, fd);
      setDeclareFormState(res);
    });
  }

  const paymentInfo = formState?.payment;
  const bankInfo: BankInfo | null | undefined = paymentInfo?.bank_info;
  const depositCents = paymentInfo?.deposit_amount_cents ?? null;
  const needDeposit = depositCents != null && depositCents > 0 && bankInfo;
  const declareError = declareFormState?.declare_error ?? declareFormState?.fieldErrors?.declare;
  const declareOk = declareFormState?.bank_declared?.ok === true;

  const selectedService = activeServices.find((s) => s.id === serviceId) || null;
  const slotsFetchFailedRef = useRef(false);
  const [slotsFetchFailed, setSlotsFetchFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!serviceId) {
      queueMicrotask(() => {
        setSlots([]);
        setSlotsFetchFailed(false);
        slotsFetchFailedRef.current = false;
      });
      return;
    }
    const svc = activeServices.find((s) => s.id === serviceId);
    if (!svc) {
      queueMicrotask(() => {
        setSlots([]);
        setSlotsFetchFailed(false);
        slotsFetchFailedRef.current = false;
      });
      return;
    }
    slotsFetchFailedRef.current = false;
    queueMicrotask(() => {
      setLoading(true);
      setSlotsFetchFailed(false);
    });
    const params = new URLSearchParams({
      service_id: serviceId,
      date,
      resource_slug: resourceSlug || "any",
    });
    const url = `${slotsBase}?${params.toString()}`;
    const doFetch = (attempt: number) => {
      if (cancelled) return;
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
        .then((data) => {
          if (cancelled) return;
          setSlots((data?.slots ?? []) as Slot[]);
          slotsFetchFailedRef.current = false;
          setSlotsFetchFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt === 0) {
            setTimeout(() => doFetch(1), 500);
            return;
          }
          setSlots([]);
          slotsFetchFailedRef.current = true;
          setSlotsFetchFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    doFetch(0);
    return () => {
      cancelled = true;
    };
  }, [serviceId, date, slug, resourceSlug, activeServices, slotsBase]);

  return (
    <section
      aria-labelledby="booking-heading"
      className="booking-card rounded-2xl border border-border bg-background p-5 sm:p-7 shadow-sm reveal"
    >
      <header className="mb-6">
        {selectedService || slot ? (
          <div
            role="region"
            aria-label="Riepilogo prenotazione"
            className={
              "booking-summary sticky top-2 z-20 mb-5 rounded-xl border border-border bg-background/70 backdrop-blur p-3 sm:p-4 shadow-[0_2px_20px_rgba(0,0,0,0.06)] transition " +
              (selectedService || slot
                ? "opacity-100 translate-y-0"
                : "opacity-0 pointer-events-none -translate-y-2")
            }
            data-visible={!!(selectedService || slot)}
          >
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-0.5">
                  Riepilogo
                </div>
                <div className="typo-body font-medium text-foreground truncate">
                  {selectedService?.name || "Scegli servizio"}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted">
                  {selectedService?.duration_minutes ? (
                    <span className="inline-flex items-center gap-1">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {selectedService.duration_minutes} min
                    </span>
                  ) : null}
                  {slot ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {slot.label}
                    </span>
                  ) : null}
                  {multiMode && resourceSlug !== "any" ? (
                    <span className="text-muted">
                      {resources.find((r) => r.resource_slug === resourceSlug)
                        ?.resource_display_name || null}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                  Prezzo
                </div>
                <div className="typo-display-h4 font-bold text-primary">
                  {selectedService && selectedService.price_from != null
                    ? `${selectedService.price_from.toFixed(2)} ${selectedService.currency ?? "€"}`
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <h1 id="booking-heading" className="typo-display-h2 text-foreground">
              Prenota un appuntamento
            </h1>
            <p className="typo-body text-muted mt-2">
              Scegli servizio, professionista, giorno e orario disponibile. Conferma con i tuoi
              dati.
            </p>
          </>
        )}
      </header>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="grid grid-cols-1 gap-5 sm:grid-cols-2"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="service_id" value={serviceId} />
        <input type="hidden" name="starts_at" value={slot?.iso ?? ""} />
        <input type="hidden" name="resource_slug" value={resourceSlug || "any"} />
        <input type="hidden" name="privacy_accepted" value={privacyAccepted ? "1" : "0"} />

        <div role="status" aria-live="polite" className="sm:col-span-2">
          {formState && !formState.ok && (
            <div
              className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
              role="alert"
            >
              {fieldErrors?.booking && (
                <div className="mb-1 font-semibold">{fieldErrors.booking}</div>
              )}
              <div>
                {formState.error ??
                  fieldErrors?.booking ??
                  "Errore durante la prenotazione. Riprova tra qualche secondo."}
              </div>
              {formState.error_code && (
                <div className="mt-1 text-[11px] text-destructive/70">
                  codice: {formState.error_code}
                </div>
              )}
            </div>
          )}
          {formState?.ok && formState.redirectToCheckout && (
            <div
              className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"
              role="status"
              aria-live="polite"
            >
              Reindirizzamento al pagamento sicuro in corso…
              <br />
              <span className="text-[11px] uppercase tracking-wide opacity-80">
                Stiamo per aprirti la pagina di pagamento della caparra.
              </span>
            </div>
          )}
        </div>

        {formState?.ok && !formState.redirectToCheckout && (
          <div
            className="sm:col-span-2 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
            data-testid="booking-created"
            role="status"
            aria-live="polite"
          >
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-background to-background p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 rounded-full bg-primary/15 p-3 text-primary"
                  aria-hidden="true"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="typo-h3 text-foreground mb-1">Prenotazione confermata!</h2>
                  <p className="typo-body text-muted-foreground">
                    Ti aspettiamo. Riceverai a breve una email con tutti i dettagli.
                  </p>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg bg-background p-3 ring-1 ring-primary/15">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                        Data e ora
                      </div>
                      <div className="font-semibold text-foreground">
                        <ClientFormattedDate
                          iso={formState.booking?.starts_at}
                          tz={timezone}
                          placeholder="data e ora appuntamento"
                        />
                      </div>
                    </div>
                    <div className="rounded-lg bg-background p-3 ring-1 ring-primary/15">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                        Codice
                      </div>
                      <div className="font-mono font-bold text-foreground">
                        {(formState.booking?.booking_id ?? "").substring(0, 8).toUpperCase()}
                      </div>
                    </div>
                    {formState.booking?.resource_display_name ? (
                      <div className="rounded-lg bg-background p-3 ring-1 ring-primary/15">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                          Operatore
                        </div>
                        <div className="font-semibold text-foreground">
                          {formState.booking.resource_display_name}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <BookingCalendarIcsLink
                      startsAt={formState.booking?.starts_at ?? null}
                      endsAt={formState.booking?.ends_at ?? null}
                      serviceName={
                        activeServices.find((s) => s.id === serviceId)?.name ?? "Appuntamento"
                      }
                      businessName={businessName}
                      location={businessAddress}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {formState?.ok && needDeposit && (
          <div className="sm:col-span-2">
            <div
              aria-labelledby="deposit-heading"
              className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background p-5 sm:p-6 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2
                    id="deposit-heading"
                    className="typo-h3 text-primary-foreground/90 bg-primary/90 inline-block px-3 py-1 rounded-md text-white text-sm font-semibold mb-2"
                  >
                    Caparra di conferma
                  </h2>
                  <p className="typo-body text-muted">
                    Per confermare definitivamente l&apos;appuntamento, effettua un bonifico
                    bancario con la caparra indicata entro 24 ore.
                  </p>
                </div>
                <div className="mt-2 sm:mt-0 rounded-xl bg-background px-5 py-3 text-right ring-1 ring-border">
                  <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
                    Caparra
                  </div>
                  <div className="text-3xl font-bold text-primary tabular-nums">
                    {fmtEuro(depositCents)}
                  </div>
                  <div className="text-xs text-muted">
                    su importo totale {fmtEuro(paymentInfo?.total_price_cents ?? null)}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-background p-5 ring-1 ring-border">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Coordinate bancarie
                  </div>
                  <dl className="space-y-2 text-sm">
                    {bankInfo?.bank_name ? (
                      <>
                        <dt className="inline text-muted">Banca: </dt>
                        <dd className="inline font-semibold text-foreground">
                          {bankInfo.bank_name}
                        </dd>
                        <br />
                      </>
                    ) : null}
                    {bankInfo?.account_holder ? (
                      <>
                        <dt className="inline text-muted">Intestatario: </dt>
                        <dd className="inline font-semibold text-foreground break-all">
                          {bankInfo.account_holder}
                        </dd>
                        <br />
                      </>
                    ) : null}
                    {bankInfo?.iban ? (
                      <>
                        <dt className="inline text-muted">IBAN: </dt>
                        <dd className="inline font-mono text-[13px] font-bold text-foreground break-all select-all">
                          {bankInfo.iban}
                        </dd>
                        <br />
                      </>
                    ) : null}
                    {bankInfo?.bic_swift ? (
                      <>
                        <dt className="inline text-muted">BIC / SWIFT: </dt>
                        <dd className="inline font-mono text-[13px] font-semibold text-foreground select-all">
                          {bankInfo.bic_swift}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </div>
                <div className="rounded-xl bg-background p-5 ring-1 ring-border">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Causale bonifico
                  </div>
                  <div className="rounded-lg bg-primary/10 p-3 font-semibold text-primary/90 break-all select-all ring-1 ring-primary/20">
                    {buildCausale(paymentInfo, formState.booking?.booking_id)}
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Scadenza: entro 24 ore. In caso di mancato ricevimento l&apos;appuntamento
                    potrebbe essere annullato.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                {declareOk ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800"
                  >
                    <div className="font-semibold text-base mb-1">Grazie! Conferma ricevuta.</div>
                    <p className="text-emerald-700/90">
                      Abbiamo registrato la tua segnalazione di bonifico effettuato.
                      {declareFormState?.bank_declared?.deposit_payment_ref ? (
                        <>
                          <br />
                          <span className="font-mono text-[12px] mt-1 inline-block bg-white/60 px-2 py-0.5 rounded">
                            Riferimento: {declareFormState.bank_declared.deposit_payment_ref}
                          </span>
                        </>
                      ) : null}
                      <br />
                      Non appena la struttura confermerà l&apos;accredito, riceverai conferma.
                    </p>
                  </div>
                ) : (
                  <form
                    ref={declareFormRef}
                    onSubmit={handleDeclareSubmit}
                    noValidate
                    className="space-y-3"
                  >
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Ho già effettuato il bonifico
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="hidden"
                        name="customer_email"
                        value={
                          formState.booking?.booking_id
                            ? ((formState as BookingActionState).booking?.customer_email ?? "")
                            : ""
                        }
                      />
                      <div>
                        <label
                          htmlFor="deposit_payment_ref"
                          className="mb-1.5 block text-sm font-medium text-foreground"
                        >
                          CRO / Codice riferimento{" "}
                          <span aria-hidden="true" className="text-destructive">
                            *
                          </span>
                        </label>
                        <input
                          id="deposit_payment_ref"
                          name="deposit_payment_ref"
                          required
                          minLength={5}
                          maxLength={64}
                          placeholder="es. 12345678901234"
                          autoComplete="off"
                          className="form-input w-full"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="deposit_payment_note"
                          className="mb-1.5 block text-sm font-medium text-foreground"
                        >
                          Note opzionali
                        </label>
                        <input
                          id="deposit_payment_note"
                          name="deposit_payment_note"
                          maxLength={400}
                          placeholder="Data bonifico, nome ordinante..."
                          className="form-input w-full"
                        />
                      </div>
                    </div>
                    {declareError ? (
                      <div
                        role="alert"
                        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
                      >
                        {declareError}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={declarePending}
                        className="btn btn-primary btn-motion"
                      >
                        {declarePending ? "Invio in corso…" : "Ho effettuato il bonifico"}
                      </button>
                      <p className="text-xs text-muted">
                        Oppure contatta direttamente la struttura per telefono o WhatsApp.
                      </p>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="sm:col-span-2 form-field">
          <label htmlFor="service" className="form-label">
            Servizio
          </label>
          <select
            id="service"
            className="form-input w-full"
            value={serviceId}
            onChange={(e) => {
              markStarted();
              setServiceId(e.target.value);
              setSlot(null);
            }}
          >
            <option value="" disabled>
              Seleziona un servizio
            </option>
            {activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                {s.price_from != null ? ` · ${s.price_from.toFixed(2)} ${s.currency ?? "€"}` : ""}
              </option>
            ))}
          </select>
        </div>

        {multiMode ? (
          <div className="sm:col-span-2 form-field">
            <label htmlFor="operator" className="form-label">
              Operatore
            </label>
            <select
              id="operator"
              className="form-input w-full"
              value={resourceSlug || "any"}
              onChange={(e) => {
                setResourceSlug(e.target.value);
                setSlot(null);
              }}
            >
              <option value="any">Qualsiasi operatore</option>
              {resources.map((r) => (
                <option key={r.resource_slug} value={r.resource_slug}>
                  {r.resource_display_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor="date" className="form-label">
            Giorno
          </label>
          <input
            id="date"
            name="date_unused"
            type="date"
            min={minDate}
            max={maxDate}
            className="form-input w-full"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSlot(null);
            }}
          />
          <p className="form-hint">
            {avSelected && avSelected.enabled ? (
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                {WEEKDAYS[weekdayOfSelected]} · orario {avSelected.start_time.substring(0, 5)}–
                {avSelected.end_time.substring(0, 5)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-destructive/70"
                  aria-hidden="true"
                />
                {WEEKDAYS[weekdayOfSelected]} · chiuso
              </span>
            )}
          </p>
        </div>

        <div className="form-field">
          <span className="form-label">Slot disponibili</span>
          <div className="min-h-[128px] rounded-xl border border-dashed border-border bg-muted/25 p-3 sm:p-4">
            {loading ? (
              <div aria-label="Caricamento slot" role="status">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="img-skeleton h-11 rounded-md" aria-hidden="true" />
                  ))}
                </div>
                <p className="sr-only">Caricamento slot…</p>
              </div>
            ) : !serviceId ? (
              <EmptyState
                icon="service"
                title="Seleziona un servizio"
                subtitle="Scegli un servizio per vedere gli orari disponibili."
              />
            ) : slotsFetchFailed ? (
              <EmptyState
                icon="error"
                title="Impossibile caricare gli slot"
                subtitle="Riprova selezionando un altro giorno o servizio."
              />
            ) : slots.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Nessuno slot disponibile"
                subtitle="Prova un altro giorno o servizio, oppure contatta la struttura telefonicamente."
              />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {slots.map((s) => {
                  const sel = slot?.iso === s.iso;
                  return (
                    <button
                      key={s.iso}
                      type="button"
                      disabled={!s.available}
                      onClick={() => setSlot(s.available ? s : null)}
                      aria-pressed={sel && s.available}
                      className={
                        "slot-btn rounded-md border px-2 py-2.5 text-sm font-medium min-h-11 motion-safe:transition motion-safe:duration-150 motion-safe:ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                        (s.available
                          ? sel
                            ? "border-primary bg-primary text-primary-foreground shadow-sm motion-safe:active:scale-[0.98]"
                            : "border-border bg-background text-foreground hover:bg-muted hover:border-muted-foreground/20 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-sm"
                          : "cursor-not-allowed border-border bg-muted text-muted line-through opacity-60")
                      }
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="form-field">
            <label htmlFor="customer_name" className="form-label">
              Nome e cognome{" "}
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </label>
            <input
              id="customer_name"
              name="customer_name"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className="form-input w-full"
            />
          </div>
          <div className="form-field">
            <label htmlFor="customer_email" className="form-label">
              Email
            </label>
            <input
              id="customer_email"
              name="customer_email"
              type="email"
              maxLength={254}
              autoComplete="email"
              className="form-input w-full"
            />
          </div>
          <div className="form-field">
            <label htmlFor="customer_phone" className="form-label">
              Telefono
            </label>
            <input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              maxLength={32}
              autoComplete="tel"
              className="form-input w-full"
            />
          </div>
          <div className="sm:col-span-2 form-field">
            <label htmlFor="notes" className="form-label">
              Note <span className="text-muted font-normal">(opzionale, max 500 caratteri)</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              maxLength={500}
              className="form-input w-full"
            />
            <p className="form-hint">Almeno un contatto tra email e telefono è richiesto.</p>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="form-checkbox">
            <input
              type="checkbox"
              className="form-checkbox-input"
              checked={privacyAccepted}
              onChange={(e) => {
                markStarted();
                setPrivacyAccepted(e.target.checked);
              }}
              required
              aria-describedby="privacy-hint"
            />
            <span id="privacy-hint" className="form-checkbox-label">
              Dichiaro di aver letto e accettato la{" "}
              <a
                href={privacyPolicyHref}
                className="font-medium underline decoration-primary/50 underline-offset-2 hover:text-primary hover:decoration-primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy Policy
              </a>{" "}
              ai sensi dell&apos;art. 13 GDPR
              {fieldErrors?.booking ? (
                <>
                  {" · "}
                  <span className="font-semibold text-destructive">{fieldErrors.booking}</span>
                </>
              ) : null}
            </span>
          </label>
        </div>

        <div className="sm:col-span-2">
          <SubmitButton disabled={!canSubmit || isPending} pending={isPending} />
        </div>
      </form>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: "calendar" | "service" | "error";
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-4 text-center gap-2">
      <div className="text-muted mb-1" aria-hidden="true">
        {icon === "calendar" ? (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="9" y1="16" x2="15" y2="16" />
          </svg>
        ) : icon === "error" ? (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        )}
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {subtitle ? <div className="text-xs text-muted max-w-sm">{subtitle}</div> : null}
    </div>
  );
}

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn btn-primary btn-lg w-full btn-motion justify-center"
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span
            className="h-4 w-4 shrink-0 rounded-full border-2 border-white/40 border-t-white animate-spin"
            aria-hidden="true"
          />
          Conferma in corso…
        </span>
      ) : (
        "Conferma prenotazione"
      )}
    </button>
  );
}

function toIcsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function buildIcsString(
  startsAt: string | undefined | null,
  endsAt: string | undefined | null,
  summary: string,
  description: string,
  location: string,
): string | null {
  const start = robustParseIso(startsAt);
  if (!start) return null;
  const end = robustParseIso(endsAt) ?? new Date(start.getTime() + 30 * 60 * 1000);
  const uid =
    "velora-" + (startsAt ?? "t") + "-" + Math.random().toString(36).slice(2, 10) + "@velora.local";
  const stamp = toIcsUtc(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VELORA//Booking Calendar 1.0//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${summary.replace(/\n/g, " ")}`,
    `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
    `LOCATION:${location.replace(/\n/g, " ")}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

function BookingCalendarIcsLink(props: {
  startsAt?: string | null;
  endsAt?: string | null;
  serviceName: string;
  businessName: string;
  location?: string;
}) {
  const { startsAt, endsAt, serviceName, businessName, location } = props;
  const href = useMemo(() => {
    if (typeof window === "undefined") return null;
    const ics = buildIcsString(
      startsAt,
      endsAt,
      `${serviceName} da ${businessName}`,
      `Appuntamento: ${serviceName}\nPresso: ${businessName}`,
      location ?? "",
    );
    if (!ics) return null;
    try {
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [startsAt, endsAt, serviceName, businessName, location]);

  useEffect(() => {
    return () => {
      if (href && typeof URL !== "undefined" && URL.revokeObjectURL) {
        try {
          URL.revokeObjectURL(href);
        } catch {
          /* noop */
        }
      }
    };
  }, [href]);

  if (!href) return null;
  return (
    <a
      href={href}
      download={`prenotazione-${businessName.replace(/\s+/g, "-").toLowerCase()}.ics`}
      className="btn btn-outline btn-sm inline-flex items-center gap-2"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      Aggiungi a calendario (.ics)
    </a>
  );
}
