"use client";

import Link from "next/link";
import { useMemo, useState, useActionState } from "react";
import {
  cancelBookingAction,
  completeBookingAction,
  noShowBookingAction,
  markDepositPaidAction,
  markDepositUnpaidAction,
} from "./actions";

type BookingRow = {
  id: string;
  service_id: string;
  customer_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  notes: string | null;
  payment_status?: string | null;
  deposit_amount?: number | null;
  deposit_paid_at?: string | null;
  deposit_requested_at?: string | null;
  deposit_payment_method?: string | null;
  deposit_payment_ref?: string | null;
  deposit_payment_note?: string | null;
  services: { name: string; duration_minutes: number | null } | null;
  customers?: { id: string; display_name: string } | null;
};

type Props = {
  bookings: BookingRow[];
  services: Array<{ id: string; name: string }>;
  timezone: string;
  canOperate: boolean;
  role: string;
  view: "today" | "upcoming" | "past" | "all";
  initialFilters: {
    status: string;
    service: string;
    q: string;
    dateFrom: string;
    dateTo: string;
  };
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

function fmtEuroCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const eur = Number(cents) / 100;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(eur);
}

function timeOnly(iso: string, tz: string): string {
  try {
    const dt = new Date(iso);
    const dtf = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return dtf.format(dt);
  } catch {
    return "";
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    confirmed: {
      label: "Confermato",
      className: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    },
    completed: {
      label: "Completato",
      className: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    },
    no_show: {
      label: "No show",
      className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
    },
    cancelled: {
      label: "Cancellato",
      className: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
    },
  };
  const entry = map[status] ?? {
    label: status,
    className: "bg-neutral-100 text-neutral-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

function PaymentStatusBadge({
  payment_status,
  deposit_amount,
  booking,
}: {
  payment_status?: string | null | undefined;
  deposit_amount?: number | null | undefined;
  booking?: BookingRow | null | undefined;
}) {
  if (!payment_status) return null;
  type Entry = { label: string; className: string };
  const map: Record<string, Entry> = {
    unpaid: {
      label: "IN ATTESA CAPARRA",
      className: "bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20",
    },
    deposit_pending_bank: {
      label: "BONIFICO IN ATTESA",
      className: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600/20",
    },
    deposit_paid: {
      label: "CAPARRA PAGATA",
      className: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    },
    paid: {
      label: "SALDATA",
      className: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
    },
    failed: {
      label: "FALLITO",
      className: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
    },
    refunded: {
      label: "RIMBORSATO",
      className: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
    },
    partially_refunded: {
      label: "RIMBORSATO PARZ.",
      className: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
    },
    disputed: {
      label: "CONTESTATO",
      className: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
    },
  };
  const entry = map[payment_status] ?? null;
  if (!entry) return null;
  const showAmount =
    (payment_status === "deposit_pending_bank" ||
      payment_status === "deposit_paid" ||
      payment_status === "paid") &&
    deposit_amount != null &&
    Number.isFinite(deposit_amount) &&
    deposit_amount > 0;
  const tip = showAmount
    ? `Caparra: ${fmtEuroCents(deposit_amount)}${
        booking?.deposit_payment_ref ? " · Riferimento: " + booking.deposit_payment_ref : ""
      }${
        booking?.deposit_paid_at
          ? " · Data accredito: " + safeFormatShort(booking.deposit_paid_at)
          : ""
      }`
    : undefined;
  return (
    <span
      title={tip}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

function safeFormatShort(iso: string): string {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return String(iso);
    const dtf = new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
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
  const [q, setQ] = useState(props.initialFilters.q);
  const [status, setStatus] = useState(props.initialFilters.status);
  const [service, setService] = useState(props.initialFilters.service);

  const rows = useMemo(() => {
    let r = props.bookings.slice();
    if (status) r = r.filter((b) => b.status === status);
    if (service) r = r.filter((b) => b.service_id === service);
    if (q) {
      const needle = q.toLowerCase().trim();
      if (needle.length > 0) {
        r = r.filter(
          (b) =>
            (b.customer_name ?? "").toLowerCase().includes(needle) ||
            (b.customer_email ?? "").toLowerCase().includes(needle) ||
            (b.customer_phone ?? "").toLowerCase().includes(needle) ||
            (b.services?.name ?? "").toLowerCase().includes(needle),
        );
      }
    }
    return r;
  }, [props.bookings, status, service, q]);

  const views: Array<{ key: Props["view"]; label: string }> = [
    { key: "today", label: "Oggi" },
    { key: "upcoming", label: "Prossimi" },
    { key: "past", label: "Passati" },
    { key: "all", label: "Tutti" },
  ];

  const queryParams = (patch: { view?: string }) => {
    const sp = new URLSearchParams();
    if (patch.view) sp.set("view", patch.view);
    if (props.initialFilters.dateFrom) sp.set("dateFrom", props.initialFilters.dateFrom);
    if (props.initialFilters.dateTo) sp.set("dateTo", props.initialFilters.dateTo);
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Viste prenotazioni"
        className="flex flex-wrap gap-2 border-b border-neutral-200 pb-2"
      >
        {views.map((v) => {
          const active = props.view === v.key;
          return (
            <Link
              key={v.key}
              role="tab"
              aria-selected={active}
              href={`/app/bookings${queryParams({ view: v.key })}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition ${
                active
                  ? "bg-neutral-900 text-white ring-neutral-900"
                  : "bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {v.label}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="text-sm text-neutral-600 sm:col-span-2">
          <span className="mb-1 block text-xs font-medium">Cerca cliente</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, email, telefono..."
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            aria-label="Cerca cliente o servizio"
          />
        </label>
        <label className="text-sm text-neutral-600">
          <span className="mb-1 block text-xs font-medium">Stato</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            aria-label="Filtro stato"
          >
            <option value="">Tutti gli stati</option>
            <option value="confirmed">Confermati</option>
            <option value="completed">Completati</option>
            <option value="no_show">No show</option>
            <option value="cancelled">Cancellati</option>
          </select>
        </label>
        <label className="text-sm text-neutral-600">
          <span className="mb-1 block text-xs font-medium">Servizio</span>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            aria-label="Filtro servizio"
          >
            <option value="">Tutti i servizi</option>
            {props.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500"
        >
          Nessuna prenotazione. Modifica i filtri o torna più tardi.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:hidden" aria-label="Lista prenotazioni mobile">
          {rows.map((b) => (
            <li key={b.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">
                    {fmt(b.starts_at, props.timezone)}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Fine {timeOnly(b.ends_at, props.timezone)} · {b.services?.name ?? "Servizio"}
                    {b.services?.duration_minutes ? ` · ${b.services.duration_minutes} min` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={b.status} />
                  <PaymentStatusBadge
                    payment_status={b.payment_status}
                    deposit_amount={b.deposit_amount}
                  />
                </div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div className="font-medium text-neutral-800">
                  {b.customers ? (
                    <Link className="hover:underline" href={`/app/customers/${b.customers.id}`}>
                      {b.customer_name}
                    </Link>
                  ) : (
                    b.customer_name
                  )}
                </div>
                {b.customer_email ? (
                  <div className="text-xs text-neutral-500 break-all">{b.customer_email}</div>
                ) : null}
                {b.customer_phone ? (
                  <div className="text-xs text-neutral-500 break-all">{b.customer_phone}</div>
                ) : null}
                {b.notes ? (
                  <div className="mt-2 whitespace-pre-wrap break-words rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                    Note: {b.notes}
                  </div>
                ) : null}
              </div>
              {props.canOperate ? (
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  role="group"
                  aria-label={`Azioni prenotazione ${b.id}`}
                >
                  {b.status === "confirmed" ? (
                    <>
                      <CompleteRow booking={b} />
                      <NoShowRow booking={b} />
                      <CancelRow booking={b} />
                    </>
                  ) : null}
                  <MarkDepositPaidRow booking={b} />
                  <MarkDepositUnpaidRow booking={b} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div
          className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:block"
          aria-label="Tabella prenotazioni desktop"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Data/Orario
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Servizio
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Cliente
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Stato
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-neutral-900">
                        {fmt(b.starts_at, props.timezone)}
                      </div>
                      <div className="text-xs text-neutral-500">
                        Fine: {timeOnly(b.ends_at, props.timezone)}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{b.services?.name ?? "Servizio"}</div>
                      <div className="text-xs text-neutral-500">
                        {b.services?.duration_minutes ? `${b.services.duration_minutes} min` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">
                        {b.customers ? (
                          <Link
                            className="hover:underline"
                            href={`/app/customers/${b.customers.id}`}
                          >
                            {b.customer_name}
                          </Link>
                        ) : (
                          b.customer_name
                        )}
                      </div>
                      <div className="break-all text-xs text-neutral-500">
                        {b.customer_email || "-"}
                        {b.customer_phone ? ` · ${b.customer_phone}` : ""}
                      </div>
                      {b.notes ? (
                        <div className="mt-1 max-w-sm whitespace-pre-wrap break-words rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                          Note: {b.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusBadge status={b.status} />
                        <PaymentStatusBadge
                          payment_status={b.payment_status}
                          deposit_amount={b.deposit_amount}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        {props.canOperate && b.status === "confirmed" ? (
                          <>
                            <CompleteRow booking={b} compact />
                            <NoShowRow booking={b} compact />
                            <CancelRow booking={b} compact />
                          </>
                        ) : null}
                        {props.canOperate ? (
                          <>
                            <MarkDepositPaidRow booking={b} compact />
                            <MarkDepositUnpaidRow booking={b} compact />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CancelRow({ booking, compact }: { booking: BookingRow; compact?: boolean }) {
  const [state, formAction, isPending] = useActionState(cancelBookingAction, undefined);
  return (
    <form action={formAction}>
      <input type="hidden" name="booking_id" value={booking.id} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-60 ${
          compact ? "" : ""
        }`}
        aria-label={`Cancella prenotazione ${booking.id}`}
      >
        Annulla
      </button>
      {state && state.ok === false ? (
        <div className="mt-1 text-xs text-red-700" role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function CompleteRow({ booking, compact }: { booking: BookingRow; compact?: boolean }) {
  const [state, formAction, isPending] = useActionState(completeBookingAction, undefined);
  return (
    <form action={formAction}>
      <input type="hidden" name="booking_id" value={booking.id} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md border border-sky-300 bg-sky-50 px-3 py-1 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-60 ${
          compact ? "" : ""
        }`}
        aria-label={`Segna come completato prenotazione ${booking.id}`}
      >
        Completato
      </button>
      {state && state.ok === false ? (
        <div className="mt-1 text-xs text-red-700" role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function NoShowRow({ booking, compact }: { booking: BookingRow; compact?: boolean }) {
  const [state, formAction, isPending] = useActionState(noShowBookingAction, undefined);
  return (
    <form action={formAction}>
      <input type="hidden" name="booking_id" value={booking.id} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-700 hover:bg-amber-100 disabled:opacity-60 ${
          compact ? "" : ""
        }`}
        aria-label={`Segna no-show prenotazione ${booking.id}`}
      >
        No show
      </button>
      {state && state.ok === false ? (
        <div className="mt-1 text-xs text-red-700" role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function MarkDepositPaidRow({ booking, compact }: { booking: BookingRow; compact?: boolean }) {
  const [state, formAction, isPending] = useActionState(markDepositPaidAction, undefined);
  const showBtn =
    booking.deposit_amount != null &&
    Number.isFinite(booking.deposit_amount) &&
    booking.deposit_amount > 0 &&
    booking.payment_status !== "deposit_paid" &&
    booking.payment_status !== "paid";
  if (!showBtn) return null;
  return (
    <form action={formAction}>
      <input type="hidden" name="booking_id" value={booking.id} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 ${
          compact ? "" : ""
        }`}
        aria-label={`Segna caparra pagata prenotazione ${booking.id}`}
      >
        Segna caparra pagata
      </button>
      {state && state.ok === false ? (
        <div className="mt-1 text-xs text-red-700" role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function MarkDepositUnpaidRow({ booking, compact }: { booking: BookingRow; compact?: boolean }) {
  const [state, formAction, isPending] = useActionState(markDepositUnpaidAction, undefined);
  const showBtn =
    booking.deposit_amount != null &&
    Number.isFinite(booking.deposit_amount) &&
    booking.deposit_amount > 0 &&
    booking.payment_status === "deposit_paid";
  if (!showBtn) return null;
  return (
    <form action={formAction}>
      <input type="hidden" name="booking_id" value={booking.id} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 ${
          compact ? "" : ""
        }`}
        aria-label={`Reimposta caparra non pagata prenotazione ${booking.id}`}
      >
        Reimposta non pagata
      </button>
      {state && state.ok === false ? (
        <div className="mt-1 text-xs text-red-700" role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}
