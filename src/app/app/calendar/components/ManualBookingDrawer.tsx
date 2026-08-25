"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { manualBookingAction, searchCustomersAction } from "@/app/app/bookings/actions";
import type { CustomerRowVM } from "@/lib/server/customers";

type ResourceOption = {
  id: string;
  slug: string | null;
  display_name: string | null;
};

type ServiceOption = {
  id: string;
  name: string;
  duration_minutes: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startsAt?: Date | undefined;
  resourceSlug?: string | undefined;
  resources: ResourceOption[];
  services: ServiceOption[];
  onCreated?: () => void;
};

type InnerManualBookingFormProps = Omit<Props, "open">;

type CustomerSelection = { mode: "existing"; id: string; label: string } | { mode: "new" };

function toDatetimeLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function defaultStartsAt(): Date {
  const now = new Date();
  const plus1h = new Date(now.getTime() + 60 * 60 * 1000);
  const m = Math.ceil(plus1h.getMinutes() / 15) * 15;
  const d = new Date(plus1h);
  d.setMinutes(0, 0, 0);
  d.setMinutes(m);
  return d;
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Salvataggio…" : "Crea appuntamento"}
    </button>
  );
}

function InnerManualBookingForm(props: InnerManualBookingFormProps) {
  const initialDefault = useMemo(() => defaultStartsAt(), []);
  const initialStarts = props.startsAt ?? initialDefault;
  const initialStartsISO = useMemo(() => toDatetimeLocal(new Date(initialStarts)), [initialStarts]);

  const defaultResource = useMemo(() => {
    if (props.resourceSlug && props.resourceSlug !== "any") {
      const found = props.resources.find((r) => r.slug === props.resourceSlug);
      if (found) return found.slug ?? "any";
    }
    if (props.resources.length === 1) return props.resources[0]!.slug ?? "any";
    return "any";
  }, [props.resources, props.resourceSlug]);

  const [customerMode, setCustomerMode] = useState<CustomerSelection>({
    mode: "new",
  });
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerRowVM[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const [startsAtValue, setStartsAtValue] = useState<string>(initialStartsISO);
  const [resourceValue, setResourceValue] = useState<string>(defaultResource);
  const [serviceValue, setServiceValue] = useState<string>(props.services[0]?.id ?? "");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [notesValue, setNotesValue] = useState("");

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length === 0) {
      setCustomerResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await searchCustomersAction(q.trim());
      if (res.ok) {
        setCustomerResults(res.items.slice(0, 10));
      } else {
        setCustomerResults([]);
      }
    } catch {
      setCustomerResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onCustomerSearchChange = useCallback(
    (v: string) => {
      setCustomerSearch(v);
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => {
        void runSearch(v);
      }, 250);
    },
    [runSearch],
  );

  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, []);

  const [formState, formAction] = useActionState(manualBookingAction, null);

  useEffect(() => {
    if (formState?.ok === true) {
      props.onOpenChange(false);
      props.onCreated?.();
    }
  }, [formState, props]);

  const showSlotTaken = formState && formState.ok === false && formState.code === "SLOT_TAKEN";
  const showConcurrent =
    formState && formState.ok === false && formState.code === "CONCURRENT_UPDATE";

  return (
    <div
      data-cal-manual-drawer="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-booking-drawer-title"
      className="fixed inset-0 z-50 flex items-end justify-end bg-neutral-900/40 sm:items-center sm:justify-center"
    >
      <button
        type="button"
        aria-label="Chiudi pannello"
        onClick={() => props.onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default appearance-none bg-transparent"
      />
      <div className="relative w-full max-w-md rounded-t-2xl border border-neutral-200 bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id="manual-booking-drawer-title"
              className="truncate text-base font-semibold text-neutral-900"
            >
              Nuovo appuntamento
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Inserisci i dati per creare manualmente una prenotazione.
            </p>
          </div>
          <button
            type="button"
            aria-label="Chiudi pannello"
            onClick={() => props.onOpenChange(false)}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="space-y-4 px-4 py-4">
          {customerMode.mode === "existing" ? (
            <input type="hidden" name="customer_id" value={customerMode.id} />
          ) : (
            <>
              <input type="hidden" name="customer_name" value={newCustomerName} />
              <input type="hidden" name="customer_email" value={newCustomerEmail} />
              <input type="hidden" name="customer_phone" value={newCustomerPhone} />
            </>
          )}
          <input type="hidden" name="service_id" value={serviceValue} />
          <input
            type="hidden"
            name="starts_at"
            value={(() => {
              if (!startsAtValue || startsAtValue.length < 16) return "";
              try {
                const d = new Date(startsAtValue);
                if (Number.isNaN(d.getTime())) return "";
                return d.toISOString();
              } catch {
                return "";
              }
            })()}
          />
          <input type="hidden" name="resource_slug" value={resourceValue} />
          <input type="hidden" name="notes" value={notesValue} />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mb-customer-mode" className="text-xs font-medium text-neutral-700">
                Cliente
              </label>
              <button
                type="button"
                id="mb-customer-mode"
                onClick={() => {
                  setCustomerMode(
                    customerMode.mode === "existing"
                      ? { mode: "new" }
                      : { mode: "existing", id: "", label: "" },
                  );
                  setCustomerSearch("");
                  setCustomerResults([]);
                }}
                className="text-xs font-medium text-neutral-600 underline-offset-2 hover:underline"
              >
                {customerMode.mode === "existing"
                  ? "Passa a nuovo cliente"
                  : "Cerca cliente esistente"}
              </button>
            </div>
            {customerMode.mode === "existing" ? (
              <div className="space-y-2">
                <div>
                  <label htmlFor="mb-customer-search" className="sr-only">
                    Cerca cliente
                  </label>
                  <input
                    ref={firstFieldRef}
                    id="mb-customer-search"
                    type="text"
                    value={customerSearch}
                    onChange={(e) => onCustomerSearchChange(e.target.value)}
                    placeholder="Cerca per nome, email o telefono…"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
                    autoComplete="off"
                  />
                </div>
                {searchLoading ? (
                  <div className="text-xs text-neutral-500">Ricerca…</div>
                ) : customerResults.length > 0 ? (
                  <ul className="max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 bg-white">
                    {customerResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const label =
                              c.display_name +
                              (c.email ? ` · ${c.email}` : "") +
                              (c.phone ? ` · ${c.phone}` : "");
                            setCustomerMode({ mode: "existing", id: c.id, label });
                            setCustomerSearch(c.display_name);
                            setCustomerResults([]);
                          }}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-neutral-900 truncate">
                              {c.display_name}
                            </span>
                            <span className="block text-xs text-neutral-500 truncate">
                              {[c.email, c.phone].filter(Boolean).join(" · ") || "Nessun contatto"}
                              {c.booking_count ? ` · ${c.booking_count} app.` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : customerSearch.trim().length > 0 && !searchLoading ? (
                  <div className="text-xs text-neutral-500">Nessun risultato.</div>
                ) : null}
                {customerMode.mode === "existing" && customerMode.id ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <span className="font-semibold">Selezionato:</span>{" "}
                    <span className="truncate">{customerMode.label}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <label htmlFor="mb-customer-name" className="sr-only">
                    Nome cliente
                  </label>
                  <input
                    ref={firstFieldRef}
                    id="mb-customer-name"
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Nome e cognome *"
                    maxLength={120}
                    required
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="mb-customer-email" className="sr-only">
                    Email
                  </label>
                  <input
                    id="mb-customer-email"
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="Email (almeno uno tra email e telefono)"
                    maxLength={254}
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="mb-customer-phone" className="sr-only">
                    Telefono
                  </label>
                  <input
                    id="mb-customer-phone"
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="Telefono (almeno uno tra email e telefono)"
                    maxLength={32}
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="mb-service" className="block text-xs font-medium text-neutral-700">
              Servizio
            </label>
            {props.services.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Nessun servizio attivo disponibile.
              </div>
            ) : (
              <select
                id="mb-service"
                value={serviceValue}
                onChange={(e) => setServiceValue(e.target.value)}
                required
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
              >
                {props.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="mb-resource" className="block text-xs font-medium text-neutral-700">
              Operatore
            </label>
            <select
              id="mb-resource"
              value={resourceValue}
              onChange={(e) => setResourceValue(e.target.value)}
              required
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            >
              <option value="any">Qualsiasi (ANY)</option>
              {props.resources.map((r) => (
                <option key={r.id} value={r.slug ?? "any"}>
                  {r.display_name ?? r.slug ?? r.id}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="mb-starts-at" className="block text-xs font-medium text-neutral-700">
              Data e ora
            </label>
            <input
              id="mb-starts-at"
              type="datetime-local"
              value={startsAtValue}
              onChange={(e) => setStartsAtValue(e.target.value)}
              required
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="mb-notes" className="block text-xs font-medium text-neutral-700">
              Note (opzionale)
            </label>
            <textarea
              id="mb-notes"
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Note interne (massimo 500 caratteri)…"
              className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            />
            <div className="text-right text-[11px] text-neutral-500 tabular-nums">
              {notesValue.length}/500
            </div>
          </div>

          {formState && formState.ok === false ? (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              <div className="font-semibold">
                {showConcurrent
                  ? "Appuntamento modificato altrove. Ricarica i dati."
                  : showSlotTaken
                    ? "Slot occupato, scegli un altro orario."
                    : "Errore"}
              </div>
              <div className="mt-0.5 text-xs">
                {formState.code ? <span className="mr-2">[{formState.code}]</span> : null}
                {formState.error}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 pt-1">
            <SubmitButton
              disabled={
                props.services.length === 0 ||
                (customerMode.mode === "existing" && !customerMode.id)
              }
            />
            <button
              type="button"
              onClick={() => props.onOpenChange(false)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ManualBookingDrawer(props: Props) {
  const { open, onOpenChange, ...rest } = props;
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      triggerRef.current = active;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      triggerRef.current?.focus?.();
    };
  }, [open, onOpenChange]);

  return open ? <InnerManualBookingForm onOpenChange={onOpenChange} {...rest} /> : null;
}
