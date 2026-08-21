"use client";

import { useFormState } from "react-dom";
import { cancelBookingAction } from "./actions";

type BookingRow = {
  id: string;
  tenant_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  services: { name: string; duration_minutes: number | null } | null;
};

type Props = {
  bookings: BookingRow[];
  timezone: string;
  canCancel: boolean;
};

function fmt(iso: string, tz: string): string {
  try {
    const dt = new Date(iso);
    const dtf = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return dtf.format(dt);
  } catch {
    return String(iso);
  }
}

export default function BookingsListClient(props: Props) {
  const rows = props.bookings;
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Data/Orario</th>
              <th className="px-4 py-3 font-medium">Servizio</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Stato</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-500">
                  Nessuna prenotazione al momento.
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <CancelRow key={b.id} b={b} tz={props.timezone} canCancel={props.canCancel} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CancelRow({ b, tz, canCancel }: { b: BookingRow; tz: string; canCancel: boolean }) {
  const [state, formAction] = useFormState(cancelBookingAction, undefined);
  const confirmed = b.status === "confirmed";
  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-neutral-900">{fmt(b.starts_at, tz)}</div>
        <div className="text-xs text-neutral-500">Fine: {fmt(b.ends_at, tz)}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{b.services?.name ?? "Servizio"}</div>
        <div className="text-xs text-neutral-500">
          {b.services?.duration_minutes ? `${b.services.duration_minutes} min` : ""}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{b.customer_name}</div>
        <div className="text-xs text-neutral-500 break-all">
          {b.customer_email || "-"}
          {b.customer_phone ? ` · ${b.customer_phone}` : ""}
        </div>
        {b.notes ? (
          <div className="mt-1 rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs text-neutral-600 max-w-sm whitespace-pre-wrap break-words">
            Note: {b.notes}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        {confirmed ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Confermato
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
            Cancellato
          </span>
        )}
        {state && state.ok === false ? (
          <div className="mt-1 text-xs text-red-700" role="alert">
            {state.error}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top text-right">
        {canCancel && confirmed ? (
          <form action={formAction}>
            <input type="hidden" name="booking_id" value={b.id} />
            <button
              type="submit"
              className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
            >
              Annulla
            </button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}
