"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { cancelBookingByTokenAction, type PublicCancelState } from "./actions";

interface CancelBookingClientProps {
  slug: string;
  token: string;
  summary: {
    businessName: string;
    customerName: string | null;
    serviceName: string | null;
    startsAtISO: string;
    timezone: string;
    backHref: string;
    primaryHex: string;
  };
  initialError?: "TOKEN_INVALID" | "NOT_FOUND" | "CROSS_TENANT" | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatLocal(iso: string, tz: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    const df = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz || "Europe/Rome",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const tf = new Intl.DateTimeFormat("it-IT", {
      timeZone: tz || "Europe/Rome",
      hour: "2-digit",
      minute: "2-digit",
    });
    return { date: df.format(d), time: tf.format(d) };
  } catch {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return { date: `${day}/${m}/${y}`, time: `${hh}:${mm}` };
  }
}

export default function CancelBookingClient(props: CancelBookingClientProps) {
  const { slug, token, summary, initialError } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (_: PublicCancelState | null, fd: FormData): Promise<PublicCancelState> => {
      fd.set("slug", slug);
      fd.set("token", token);
      return cancelBookingByTokenAction(fd);
    },
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok && state.kind === "CANCELLED") {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        // ignore
      }
    }
  }, [state]);

  if (initialError) {
    return (
      <main id="main-content" className="min-h-screen bg-neutral-50 pb-20 pt-12">
        <div className="mx-auto max-w-2xl px-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                aria-hidden
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                  Link non valido
                </h1>
                <p className="text-sm text-neutral-600">
                  Il link per cancellare la prenotazione non è valido o è scaduto.
                </p>
              </div>
            </div>
            <p className="mb-6 text-sm text-neutral-600">
              Il link dura 72 ore dal momento della prenotazione. Se è scaduto, contatta
              direttamente <strong>{summary.businessName}</strong> per chiedere aiuto.
            </p>
            <Link
              href={summary.backHref}
              className="inline-flex items-center justify-center rounded-xl border border-neutral-900 bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              Torna al sito di {summary.businessName}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { date: dataDate, time: dataTime } = formatLocal(summary.startsAtISO, summary.timezone);
  const success = state?.ok && state.kind === "CANCELLED";
  const already = state?.ok && state.kind === "ALREADY_CANCELLED";

  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 pb-20 pt-12">
      <div className="mx-auto max-w-2xl px-4">
        <nav className="mb-6 text-sm text-neutral-600">
          <a
            className="underline underline-offset-4 hover:text-neutral-900"
            href={summary.backHref}
          >
            ← Torna a {summary.businessName}
          </a>
        </nav>

        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          {success ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: summary.primaryHex || "#0a0a0a" }}
                  aria-hidden
                >
                  <svg
                    width="22"
                    height="22"
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
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                    Prenotazione cancellata
                  </h1>
                  <p className="text-sm text-neutral-600">
                    Riceverai una email di conferma all&apos;indirizzo che hai usato in fase di
                    prenotazione.
                  </p>
                </div>
              </div>
              <div className="my-6 rounded-xl bg-neutral-50 p-5 text-sm">
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Cliente</div>
                  <div className="col-span-2 font-medium text-neutral-900">
                    {summary.customerName || "—"}
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Servizio</div>
                  <div className="col-span-2 font-medium text-neutral-900">
                    {summary.serviceName || "—"}
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Data</div>
                  <div className="col-span-2 font-medium text-neutral-900">{dataDate}</div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Ora</div>
                  <div className="col-span-2 font-medium text-neutral-900">{dataTime}</div>
                </div>
              </div>
              <Link
                href={summary.backHref}
                className="inline-flex items-center justify-center rounded-xl border border-neutral-900 bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                Torna al sito
              </Link>
            </>
          ) : already ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                  aria-hidden
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 1 0 18 0A9 9 0 0 0 3 12z" />
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                    Prenotazione già cancellata
                  </h1>
                  <p className="text-sm text-neutral-600">
                    La prenotazione risulta già cancellata, non devi fare altro.
                  </p>
                </div>
              </div>
              <Link
                href={summary.backHref}
                className="inline-flex items-center justify-center rounded-xl border border-neutral-900 bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                Torna al sito
              </Link>
            </>
          ) : (
            <>
              <div className="mb-5 flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: summary.primaryHex || "#0a0a0a" }}
                  aria-hidden
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                    Conferma cancellazione
                  </h1>
                  <p className="text-sm text-neutral-600">
                    Sta per cancellare la seguente prenotazione da {summary.businessName}.
                  </p>
                </div>
              </div>

              <div className="my-6 rounded-xl bg-neutral-50 p-5 text-sm">
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Cliente</div>
                  <div className="col-span-2 font-medium text-neutral-900">
                    {summary.customerName || "—"}
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Servizio</div>
                  <div className="col-span-2 font-medium text-neutral-900">
                    {summary.serviceName || "—"}
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Data</div>
                  <div className="col-span-2 font-medium text-neutral-900">{dataDate}</div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1 text-neutral-500">Ora</div>
                  <div className="col-span-2 font-medium text-neutral-900">{dataTime}</div>
                </div>
              </div>

              {state && !state.ok && (
                <div
                  role="alert"
                  className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  {state.code === "TOO_LATE" && (
                    <>
                      Non è più possibile cancellare una prenotazione passata. Contatta direttamente{" "}
                      {summary.businessName}.
                    </>
                  )}
                  {state.code === "TERMINAL_STATE" && <>La prenotazione non è più modificabile.</>}
                  {state.code === "TOKEN_INVALID" && <>Link non valido o scaduto (72 ore).</>}
                  {state.code === "TOKEN_EXPIRED" && <>Link scaduto.</>}
                  {state.code === "NOT_FOUND" && <>Prenotazione non trovata.</>}
                  {state.code === "CROSS_TENANT" && <>Link non valido.</>}
                  {(state.code === "VALIDATION" || state.code === "INTERNAL") && (
                    <>{state.message}</>
                  )}
                </div>
              )}

              <form
                ref={formRef}
                action={formAction}
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end"
              >
                <Link
                  href={summary.backHref}
                  className="inline-flex items-center justify-center rounded-xl border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
                >
                  Annulla
                </Link>
                <button
                  type="submit"
                  disabled={isPending}
                  aria-disabled={isPending}
                  className="inline-flex items-center justify-center rounded-xl border border-red-600 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                >
                  {isPending ? "Cancellazione…" : "Conferma cancellazione"}
                </button>
              </form>
              <p className="mt-5 text-xs leading-relaxed text-neutral-500">
                Confermando, la prenotazione verrà contrassegnata come <strong>cancellata</strong> e
                lo slot verrà riaperto per nuovi clienti. Una email di conferma sarà inviata
                all&apos;indirizzo usato in fase di prenotazione.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
