"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createBookingAction } from "./actions";
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
  services: ServiceOption[];
  availability: BusinessAvailabilityRow[];
  timezone: string;
  horizonDays?: number;
};

function isoDateDmy(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] as const;

export default function PublicBookingForm(props: PublicBookingFormProps) {
  const { slug, services, availability, timezone } = props;
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
  const [formState, formAction] = useFormState(createBookingAction, undefined);

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
    const url = `/s/${encodeURIComponent(slug)}/booking/slots?${params.toString()}`;
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
  }, [serviceId, date, slug, resourceSlug, activeServices]);

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

  const canSubmit = Boolean(slot && slot.available && serviceId);
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

      <form action={formAction} noValidate className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="service_id" value={serviceId} />
        <input type="hidden" name="starts_at" value={slot?.iso ?? ""} />
        <input type="hidden" name="resource_slug" value={resourceSlug || "any"} />

        <div className="sm:col-span-2">
          <label htmlFor="service" className="mb-1 block text-sm font-medium">
            Servizio
          </label>
          <select
            id="service"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={serviceId}
            onChange={(e) => {
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

        <div role="status" aria-live="polite" className="sm:col-span-2">
          {formState && !formState.ok && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formState.error ?? "Errore durante la prenotazione."}
            </div>
          )}
          {formState?.ok && (
            <div
              className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              data-testid="booking-created"
            >
              Prenotazione confermata. Ti aspettiamo!
              <br />
              <span className="text-xs text-emerald-700">
                {new Date(formState.booking!.starts_at).toLocaleString("it-IT", {
                  timeZone: timezone,
                })}
                {" · "}
                codice: {formState.booking!.booking_id.substring(0, 8)}
                {formState.booking!.resource_display_name
                  ? ` · con ${formState.booking!.resource_display_name}`
                  : ""}
              </span>
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <SubmitButton disabled={!canSubmit} />
        </div>
      </form>
    </section>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
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
