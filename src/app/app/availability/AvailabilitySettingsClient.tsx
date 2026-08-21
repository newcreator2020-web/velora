"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { saveAvailabilityAction } from "./actions";

type Row = {
  weekday: number;
  label: string;
  enabled: boolean;
  start_time: string;
  end_time: string;
};

export default function AvailabilitySettingsClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [state, formAction] = useFormState(saveAvailabilityAction, undefined);

  const payload = useMemo(
    () =>
      JSON.stringify(
        rows
          .slice()
          .sort((a, b) => a.weekday - b.weekday)
          .map(({ weekday, enabled, start_time, end_time }) => ({
            weekday,
            enabled,
            start_time,
            end_time,
          })),
      ),
    [rows],
  );

  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="payload" value={payload} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {rows.map((r, idx) => {
          const err =
            r.enabled && r.start_time >= r.end_time
              ? "L'orario di fine deve essere successivo all'inizio."
              : null;
          return (
            <div key={r.weekday} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label className="text-sm font-semibold" htmlFor={`e-${r.weekday}`}>
                    {r.label}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">Chiuso</span>
                  <button
                    id={`e-${r.weekday}`}
                    type="button"
                    role="switch"
                    aria-checked={r.enabled}
                    onClick={() =>
                      setRows((curr) =>
                        curr.map((x, i) => (i === idx ? { ...x, enabled: !x.enabled } : x)),
                      )
                    }
                    className={
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
                      (r.enabled ? "bg-neutral-900" : "bg-neutral-300")
                    }
                  >
                    <span
                      className={
                        "inline-block h-5 w-5 transform rounded-full bg-white transition-transform " +
                        (r.enabled ? "translate-x-5" : "translate-x-0.5")
                      }
                    />
                  </button>
                  <span className="text-xs text-neutral-500">Aperto</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-500" htmlFor={`s-${r.weekday}`}>
                    Dalle
                  </label>
                  <input
                    id={`s-${r.weekday}`}
                    type="time"
                    value={r.start_time}
                    disabled={!r.enabled}
                    onChange={(e) =>
                      setRows((curr) =>
                        curr.map((x, i) =>
                          i === idx ? { ...x, start_time: e.target.value || "09:00" } : x,
                        ),
                      )
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-500" htmlFor={`t-${r.weekday}`}>
                    Alle
                  </label>
                  <input
                    id={`t-${r.weekday}`}
                    type="time"
                    value={r.end_time}
                    disabled={!r.enabled}
                    onChange={(e) =>
                      setRows((curr) =>
                        curr.map((x, i) =>
                          i === idx ? { ...x, end_time: e.target.value || "18:00" } : x,
                        ),
                      )
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
                  />
                </div>
              </div>
              {err ? (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {err}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div role="status" aria-live="polite" className="min-h-[24px] text-sm">
        {state?.ok ? (
          <span className="text-emerald-700">Orari salvati correttamente.</span>
        ) : state?.ok === false ? (
          <span className="text-red-700">{state.error}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
    >
      {pending ? "Salvataggio…" : "Salva orari"}
    </button>
  );
}
