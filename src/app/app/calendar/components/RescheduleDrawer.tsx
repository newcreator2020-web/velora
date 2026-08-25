"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { rescheduleBookingAction } from "@/app/app/bookings/actions";

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

export type BookingRowForReschedule = {
  booking_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  resource_id?: string | null;
  resource_slug?: string | null;
  revision?: number | null;
  status?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingRowForReschedule;
  onlyResource?: boolean;
  resources: ResourceOption[];
  services: ServiceOption[];
  onUpdated?: () => void;
};

type InnerRescheduleFormProps = Omit<Props, "open">;

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function RescheduleSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Aggiornamento…" : "Applica modifiche"}
    </button>
  );
}

function InnerRescheduleForm(props: InnerRescheduleFormProps) {
  const initialStartsLocal = useMemo(
    () => toDatetimeLocal(props.booking.starts_at),
    [props.booking.starts_at],
  );

  const initialResourceValue = useMemo(() => {
    if (props.booking.resource_slug) {
      const found = props.resources.find((r) => r.slug === props.booking.resource_slug);
      if (found) return found.slug ?? "same";
    }
    if (props.booking.resource_id) {
      const found = props.resources.find((r) => r.id === props.booking.resource_id);
      if (found) return found.slug ?? "same";
    }
    return "same";
  }, [props.booking, props.resources]);

  const initialServiceValue = props.booking.service_id ?? "";

  const [startsAtValue, setStartsAtValue] = useState<string>(initialStartsLocal);
  const [resourceValue, setResourceValue] = useState<string>(initialResourceValue);
  const [serviceValue, setServiceValue] = useState<string>(initialServiceValue);

  const firstFieldRef = useRef<HTMLSelectElement | HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, []);

  const expectedRevision = Number(props.booking.revision ?? 0);

  const [formState, formAction] = useActionState(rescheduleBookingAction, null);

  useEffect(() => {
    if (formState?.ok === true) {
      props.onOpenChange(false);
      props.onUpdated?.();
    }
  }, [formState, props]);

  const isOnlyResource = props.onlyResource === true;

  const showConcurrent =
    formState && formState.ok === false && formState.code === "CONCURRENT_UPDATE";
  const showSlotTaken = formState && formState.ok === false && formState.code === "SLOT_TAKEN";

  const drawerTitle = isOnlyResource ? "Cambia operatore" : "Sposta appuntamento";

  return (
    <div
      data-cal-reschedule-drawer="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-drawer-title"
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
              id="reschedule-drawer-title"
              className="truncate text-base font-semibold text-neutral-900"
            >
              {drawerTitle}
            </h2>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {props.booking.service_name ?? "Servizio"} · {props.booking.booking_id ?? ""}
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
          <input type="hidden" name="booking_id" value={props.booking.booking_id ?? ""} />
          <input type="hidden" name="expected_revision" value={String(expectedRevision)} />
          <input
            type="hidden"
            name="new_starts_at"
            value={(() => {
              if (isOnlyResource || !startsAtValue || startsAtValue.length < 16) return "";
              try {
                const d = new Date(startsAtValue);
                if (Number.isNaN(d.getTime())) return "";
                return d.toISOString();
              } catch {
                return "";
              }
            })()}
          />
          <input type="hidden" name="new_resource_slug" value={resourceValue} />
          <input type="hidden" name="new_service_id" value={isOnlyResource ? "" : serviceValue} />

          {!isOnlyResource ? (
            <div className="space-y-1">
              <label htmlFor="rs-service" className="block text-xs font-medium text-neutral-700">
                Servizio
              </label>
              <select
                ref={firstFieldRef as React.RefObject<HTMLSelectElement>}
                id="rs-service"
                value={serviceValue}
                onChange={(e) => setServiceValue(e.target.value)}
                disabled={props.services.length === 0}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20 disabled:opacity-60"
              >
                {props.services.length === 0 ? <option value="">Nessun servizio</option> : null}
                {props.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="rs-resource" className="block text-xs font-medium text-neutral-700">
              Operatore
            </label>
            <select
              ref={
                isOnlyResource ? (firstFieldRef as React.RefObject<HTMLSelectElement>) : undefined
              }
              id="rs-resource"
              value={resourceValue}
              onChange={(e) => setResourceValue(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            >
              <option value="same">Stesso operatore</option>
              <option value="any">Qualsiasi (ANY)</option>
              {props.resources.map((r) => (
                <option key={r.id} value={r.slug ?? "any"}>
                  {r.display_name ?? r.slug ?? r.id}
                </option>
              ))}
            </select>
          </div>

          {!isOnlyResource ? (
            <div className="space-y-1">
              <label htmlFor="rs-starts-at" className="block text-xs font-medium text-neutral-700">
                Data e ora
              </label>
              <input
                ref={
                  !isOnlyResource
                    ? (firstFieldRef as unknown as React.RefObject<HTMLInputElement>)
                    : undefined
                }
                id="rs-starts-at"
                type="datetime-local"
                value={startsAtValue}
                onChange={(e) => setStartsAtValue(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
              />
            </div>
          ) : null}

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
                    ? "Slot occupato."
                    : "Errore"}
              </div>
              <div className="mt-0.5 text-xs">
                {formState.code ? <span className="mr-2">[{formState.code}]</span> : null}
                {formState.error}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 pt-1">
            <RescheduleSubmitButton />
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

export default function RescheduleDrawer(props: Props) {
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

  return open ? <InnerRescheduleForm onOpenChange={onOpenChange} {...rest} /> : null;
}
