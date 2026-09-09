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
import { createBookingAction } from "./actions";
import type { BookingActionState } from "./actions";
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
  const { slug, csrfToken: csrfTokenProp, services, availability, timezone, slotsApiBase } = props;
  const csrfToken =
    (csrfTokenProp && csrfTokenProp.length >= 16 ? csrfTokenProp : null) ??
    readCookie(CSRF_COOKIE_NAME) ??
    safeRandomToken();
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
  const [isPending, startTransition] = useTransition();
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
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

  useEffect(() => {
    let cancelled = false;
    if (!serviceId) {
      queueMicrotask(() => setSlots([]));
      return;
    }
    const svc = activeServices.find((s) => s.id === serviceId);
    if (!svc) {
      queueMicrotask(() => setSlots([]));
      return;
    }
    queueMicrotask(() => setLoading(true));
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
          if (!cancelled) setSlots((data?.slots ?? []) as Slot[]);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt === 0) {
            setTimeout(() => doFetch(1), 500);
            return;
          }
          setSlots([]);
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

  return (
    <section
      aria-labelledby="booking-heading"
      className="mx-auto my-10 max-w-3xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-6">
        <h1 id="booking-heading" className="text-2xl font-semibold">
          Prenota un appuntamento
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Scegli servizio, professionista, giorno e orario disponibile. Conferma con i tuoi dati.
        </p>
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

        <div role="status" aria-live="polite" className="sm:col-span-2 sticky top-3 z-30">
          {formState && !formState.ok && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {fieldErrors?.booking && (
                <div className="mb-1 font-medium">{fieldErrors.booking}</div>
              )}
              <div>
                {formState.error ??
                  fieldErrors?.booking ??
                  "Errore durante la prenotazione. Riprova tra qualche secondo."}
              </div>
              {formState.error_code && (
                <div className="mt-1 text-xs text-red-500/80">codice: {formState.error_code}</div>
              )}
            </div>
          )}
          {formState?.ok && !formState.redirectToCheckout && (
            <div
              className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              data-testid="booking-created"
            >
              Prenotazione confermata. Ti aspettiamo!
              <br />
              <span className="text-xs text-emerald-700">
                <ClientFormattedDate
                  iso={formState.booking?.starts_at}
                  tz={timezone}
                  placeholder="data e ora appuntamento"
                />
                {" · "}
                codice: {(formState.booking?.booking_id ?? "").substring(0, 8)}
                {formState.booking?.resource_display_name
                  ? ` · con ${formState.booking.resource_display_name}`
                  : ""}
              </span>
            </div>
          )}
          {formState?.ok && formState.redirectToCheckout && (
            <div
              className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800"
              role="status"
              aria-live="polite"
            >
              Reindirizzamento al pagamento sicuro in corso…
              <br />
              <span className="text-xs text-sky-700">
                Stiamo per aprirti la pagina di pagamento della caparra.
              </span>
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="service" className="mb-1 block text-sm font-medium">
            Servizio
          </label>
          <select
            id="service"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
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
          <div className="sm:col-span-2">
            <label htmlFor="operator" className="mb-1 block text-sm font-medium">
              Operatore
            </label>
            <select
              id="operator"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
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

        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            Giorno
          </label>
          <input
            id="date"
            name="date_unused"
            type="date"
            min={minDate}
            max={maxDate}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSlot(null);
            }}
          />
          <p className="mt-1 text-xs text-neutral-500">
            {avSelected && avSelected.enabled
              ? `${WEEKDAYS[weekdayOfSelected]} · orario ${avSelected.start_time.substring(0, 5)}–${avSelected.end_time.substring(0, 5)}`
              : `${WEEKDAYS[weekdayOfSelected]} · chiuso`}
          </p>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">Slot disponibili</span>
          <div className="min-h-[110px] rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
            {loading ? (
              <p className="text-sm text-neutral-500">Caricamento slot…</p>
            ) : !serviceId ? (
              <p className="text-sm text-neutral-500">Seleziona un servizio.</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Nessuno slot disponibile per la giornata. Prova un altro giorno o servizio.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
                        "rounded-md border px-2 py-1 text-sm transition " +
                        (s.available
                          ? sel
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-300 bg-white hover:bg-neutral-100"
                          : "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400 line-through")
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
          <div>
            <label htmlFor="customer_name" className="mb-1 block text-sm font-medium">
              Nome e cognome <span aria-hidden="true">*</span>
            </label>
            <input
              id="customer_name"
              name="customer_name"
              required
              maxLength={120}
              autoComplete="name"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="customer_email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="customer_email"
              name="customer_email"
              type="email"
              maxLength={254}
              autoComplete="email"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="customer_phone" className="mb-1 block text-sm font-medium">
              Telefono
            </label>
            <input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              maxLength={32}
              autoComplete="tel"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="notes" className="mb-1 block text-sm font-medium">
              Note (opzionale, max 500 caratteri)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Almeno un contatto tra email e telefono è richiesto.
            </p>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition has-[:checked]:border-neutral-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-neutral-300 accent-neutral-900"
              checked={privacyAccepted}
              onChange={(e) => {
                markStarted();
                setPrivacyAccepted(e.target.checked);
              }}
              required
              aria-describedby="privacy-hint"
            />
            <span id="privacy-hint" className="text-sm text-neutral-700">
              Dichiaro di aver letto e accettato la{" "}
              <a
                href={privacyPolicyHref}
                className="font-medium underline decoration-neutral-400 underline-offset-2 hover:text-neutral-900"
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy Policy
              </a>{" "}
              ai sensi dell&apos;art. 13 GDPR
              {fieldErrors?.booking ? (
                <>
                  {" · "}
                  <span className="font-medium text-red-700">{fieldErrors.booking}</span>
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

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Conferma in corso…" : "Conferma prenotazione"}
    </button>
  );
}
