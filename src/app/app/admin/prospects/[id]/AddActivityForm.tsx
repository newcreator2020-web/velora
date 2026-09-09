"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const ACTIVITY_KINDS = [
  "chiamata",
  "sms",
  "email",
  "appuntamento",
  "nota_interna",
  "cambio_stato",
  "cambio_assegnazione",
] as const;

type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  chiamata: "Chiamata",
  sms: "SMS",
  email: "Email",
  appuntamento: "Appuntamento",
  nota_interna: "Nota interna",
  cambio_stato: "Cambio stato",
  cambio_assegnazione: "Cambio assegnazione",
};

type AddActivityAction = (
  _prev: { ok: boolean; error: string | null; id?: string } | null,
  formData: FormData,
) => Promise<{ ok: boolean; error: string | null; id?: string }>;

export function AddActivityForm({ wrappedAction }: { wrappedAction: AddActivityAction }) {
  const [state, dispatch, pending] = useActionState<
    { ok: boolean; error: string | null; id?: string } | null,
    FormData
  >(wrappedAction as never, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state && state.ok) {
      if (formRef.current) {
        formRef.current.reset();
      }
      router.refresh();
    }
  }, [state, router]);

  return (
    <section
      aria-labelledby="prospect-add-activity"
      className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="prospect-add-activity"
        className="text-sm font-semibold text-zinc-900 border-b border-zinc-100 pb-3 mb-4"
      >
        Aggiungi attività / nota
      </h2>
      <form ref={formRef} action={dispatch as never} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5 sm:col-span-1">
            <label htmlFor="a-activity_kind" className="block text-sm font-medium text-zinc-800">
              Tipo attività
              <span aria-hidden className="ml-1 text-rose-600">
                *
              </span>
            </label>
            <select
              id="a-activity_kind"
              name="activity_kind"
              defaultValue="nota_interna"
              required
              className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {ACTIVITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACTIVITY_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="a-summary" className="block text-sm font-medium text-zinc-800">
            Descrizione
            <span aria-hidden className="ml-1 text-rose-600">
              *
            </span>
          </label>
          <textarea
            id="a-summary"
            name="summary"
            rows={3}
            required
            placeholder="Cosa è successo / nota da salvare…"
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="a-outcome" className="block text-sm font-medium text-zinc-800">
            Esito / dettagli aggiuntivi
          </label>
          <textarea
            id="a-outcome"
            name="outcome"
            rows={2}
            placeholder="Esito della chiamata, dettagli dell'appuntamento, ecc."
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-y"
          />
        </div>

        {state && !state.ok ? (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            <div className="font-medium">Errore durante il salvataggio</div>
            <div className="mt-1">{state.error}</div>
          </div>
        ) : null}
        {state && state.ok ? (
          <div
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <div className="font-medium">Attività aggiunta.</div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Salvataggio…" : "Salva attività"}
          </button>
        </div>
      </form>
    </section>
  );
}
