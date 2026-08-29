"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getResourceWeeklyScheduleAction,
  saveResourceWeeklyScheduleAction,
} from "@/app/app/team/actions";
import type {
  ResourceWeeklyScheduleSaveResult,
  ResourceWeeklyIntervalVM,
} from "@/lib/server/resource-schedule";

const WEEKDAYS: Array<{ n: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string; short: string }> = [
  { n: 1, label: "Lunedì", short: "Lun" },
  { n: 2, label: "Martedì", short: "Mar" },
  { n: 3, label: "Mercoledì", short: "Mer" },
  { n: 4, label: "Giovedì", short: "Gio" },
  { n: 5, label: "Venerdì", short: "Ven" },
  { n: 6, label: "Sabato", short: "Sab" },
  { n: 0, label: "Domenica", short: "Dom" },
];

const card =
  "rounded-2xl border bg-white shadow-sm p-4 sm:p-5 dark:bg-neutral-900 dark:border-neutral-800";
const input =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 dark:text-white";
const btn =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnPrimary =
  btn +
  " bg-sky-600 text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-950";
const btnSecondary =
  btn +
  " bg-neutral-100 text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700";
const btnGhost =
  btn + " text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800";
const btnDanger =
  btn + " text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40";

function SubmitBtn({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {children}
    </button>
  );
}

function ResultBanner({ result }: { result: ResourceWeeklyScheduleSaveResult | undefined }) {
  if (!result) return null;
  const cls = result.ok
    ? "text-xs text-emerald-700 dark:text-emerald-400"
    : "text-xs text-rose-700 dark:text-rose-400";
  const text =
    result.message && result.message.trim()
      ? result.message
      : result.ok
        ? "Operazione completata."
        : `Errore non specificato (${result.code ?? "UNKNOWN"}).`;
  return (
    <div
      role={result.ok ? "status" : "alert"}
      aria-live={result.ok ? "polite" : "assertive"}
      className={cls + " mt-2"}
    >
      {text}
      {result.ok && result.data?.conflicting_future_booking_count
        ? ` — Attenzione: ${result.data.conflicting_future_booking_count} prenotazioni future esistenti non rientrano più nel nuovo orario. Non verranno cancellate.`
        : ""}
      {result.fieldErrors ? (
        <ul className="mt-1 list-disc pl-4">
          {Object.entries(result.fieldErrors).map(([k, msgs]) => (
            <li key={k}>
              {k}: {(msgs ?? []).join("; ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type DayIntervals = Omit<ResourceWeeklyIntervalVM, "weekday">[];

function intervalsByDay(list: ResourceWeeklyIntervalVM[]): Record<number, DayIntervals> {
  const out: Record<number, DayIntervals> = {};
  for (const r of list) {
    (out[r.weekday] ||= []).push({ start_time: r.start_time, end_time: r.end_time });
  }
  for (const k of Object.keys(out)) {
    const arr = out[+k];
    if (!arr) continue;
    arr.sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
  }
  return out;
}

function intervalsFromByDay(byDay: Record<number, DayIntervals>): ResourceWeeklyIntervalVM[] {
  const out: ResourceWeeklyIntervalVM[] = [];
  for (const wd of Object.keys(byDay).map(Number)) {
    const rows = byDay[wd] ?? [];
    for (const r of rows) {
      out.push({
        weekday: wd as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        start_time: r.start_time,
        end_time: r.end_time,
      });
    }
  }
  return out;
}

function wdLabel(wd: number): string {
  return WEEKDAYS.find((w) => w.n === wd)?.label ?? `Giorno ${wd}`;
}

function validateIntervalsByDay(byDay: Record<number, DayIntervals>): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  for (const wd of Object.keys(byDay).map(Number)) {
    const list = [...(byDay[wd] ?? [])].sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start_time))
        errors.push(`${wdLabel(wd)}: inizio non valido`);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end_time))
        errors.push(`${wdLabel(wd)}: fine non valida`);
      if (r.start_time >= r.end_time) errors.push(`${wdLabel(wd)}: inizio deve precedere la fine`);
      if (i > 0) {
        const prev = list[i - 1];
        if (prev && prev.end_time > r.start_time)
          errors.push(`${wdLabel(wd)}: intervalli sovrapposti`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function ResourceScheduleDrawer({
  open,
  onOpenChange,
  resource,
  canWrite,
  inheritHint = "Se non configuri gli orari per una risorsa, vengono ereditati gli orari dell'attività.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: { id: string; display_name: string; slug: string };
  canWrite: boolean;
  inheritHint?: string;
}) {
  const [version, setVersion] = useState<number>(0);
  const [byDay, setByDay] = useState<Record<number, DayIntervals>>({});
  const [inheritMask, setInheritMask] = useState<number>(127);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<ResourceWeeklyScheduleSaveResult | undefined>(
    undefined,
  );
  const [saving, startSaveTransition] = useTransition();

  const load = async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await getResourceWeeklyScheduleAction(resource.id);
      if (!res.ok || !res.data) {
        setLoadErr(res.message);
        return;
      }
      setVersion(res.data.availability_version);
      setByDay(intervalsByDay(res.data.intervals));
      setInheritMask(res.data.inherit_weekdays_bitmask);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // react-hooks/set-state-in-effect: questi setState azzerano solo lo state locale del drawer
    // prima del caricamento remoto; non c'è subscribe a sistemi esterni da gestire.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveState(undefined);

    setLoadErr(null);

    setByDay({});

    setVersion(0);

    setInheritMask(127);

    setLoading(true);
    getResourceWeeklyScheduleAction(resource.id)
      .then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok || !res.data) {
          setLoadErr(res.message);
          return;
        }
        setVersion(res.data.availability_version);
        setInheritMask(res.data.inherit_weekdays_bitmask);
        const map: Record<number, DayIntervals> = {};
        for (const iv of res.data.intervals) {
          const arr = (map[iv.weekday] = map[iv.weekday] ?? []);
          arr.push({ start_time: iv.start_time, end_time: iv.end_time });
        }
        setByDay(map);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoading(false);
        setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, resource.id]);

  useEffect(() => {
    if (!saveState || !saveState.ok || !saveState.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVersion(saveState.data.new_version);
    setInheritMask((prev) => (saveState.data?.has_inherit_weekdays ? prev | 0 : 0));
    setTimeout(load, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  const intervalsList = useMemo(() => intervalsFromByDay(byDay), [byDay]);

  const setDay = (wd: number, rows: DayIntervals) => {
    setByDay((prev) => ({ ...prev, [wd]: rows }));
  };

  const addInterval = (wd: number) => {
    const existing = [...(byDay[wd] ?? [])];
    const candidateStart = existing.length
      ? (existing[existing.length - 1]?.end_time ?? "09:00")
      : "09:00";
    const hh = Number(candidateStart.slice(0, 2)) | 0;
    const mm = Number(candidateStart.slice(3, 5)) | 0;
    let eh = hh + 1;
    let em = mm;
    if (eh > 19) {
      eh = 18;
      em = 0;
    }
    if (eh > 23) eh = 23;
    const next: DayIntervals = [
      ...existing,
      {
        start_time: candidateStart,
        end_time: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
      },
    ];
    setDay(wd, next);
  };

  const removeInterval = (wd: number, idx: number) => {
    const cur = [...(byDay[wd] ?? [])];
    cur.splice(idx, 1);
    setDay(wd, cur);
  };

  const updateInterval = (wd: number, idx: number, field: "start_time" | "end_time", v: string) => {
    const cur = [...(byDay[wd] ?? [])];
    const base = cur[idx] ?? { start_time: "09:00", end_time: "10:00" };
    cur[idx] = { ...base, [field]: v };
    setDay(wd, cur);
  };

  const copyFromDay = (fromWd: number, toWd: number) => {
    setDay(toWd, [...(byDay[fromWd] ?? [])]);
  };

  const applyLunVen = (fromWd: number) => {
    const src = [...(byDay[fromWd] ?? [])];
    setByDay((prev) => {
      const next = { ...prev };
      for (const d of [1, 2, 3, 4, 5]) next[d] = [...src];
      return next;
    });
  };

  const resetDay = (wd: number) => setDay(wd, []);

  const weekdayHasAny = (wd: number) => (byDay[wd]?.length ?? 0) > 0;

  const clientValid = validateIntervalsByDay(byDay);

  if (!open) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rwd-title"
        className={card + " w-full max-w-4xl max-h-[92vh] overflow-y-auto"}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Orari settimanali</div>
            <h2 id="rwd-title" className="text-xl font-semibold">
              {resource.display_name}
              <span className="ml-2 text-sm text-neutral-500 font-normal">· {resource.slug}</span>
            </h2>
          </div>
          <button type="button" className={btnGhost} onClick={() => onOpenChange(false)}>
            Chiudi
          </button>
        </header>

        {loading ? (
          <div className="text-xs text-neutral-500">Caricamento…</div>
        ) : loadErr ? (
          <div className="text-xs text-rose-700 dark:text-rose-400">
            Errore caricamento: {loadErr}
          </div>
        ) : null}

        <div className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">{inheritHint}</div>

        <form
          action={() => {
            void 0;
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canWrite || saving) return;
            const v = clientValid;
            if (!v.ok) {
              setSaveState({
                ok: false,
                code: "VALIDATION_ERROR",
                message: v.errors.join("; "),
              });
              return;
            }
            setSaveState(undefined);
            startSaveTransition(async () => {
              const res = await saveResourceWeeklyScheduleAction(null, {
                resource_id: resource.id,
                expected_version: version,
                intervals: intervalsList,
              });
              setSaveState(res);
            });
          }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          <input type="hidden" name="resource_id" value={resource.id} />
          <input type="hidden" name="expected_version" value={String(version)} />
          <input
            type="hidden"
            name="intervals"
            value={canWrite ? JSON.stringify(intervalsList) : ""}
          />

          {WEEKDAYS.map((w) => {
            const rows = byDay[w.n] ?? [];
            const hasAny = weekdayHasAny(w.n);
            const inherit = ((inheritMask >> w.n) & 1) === 1;
            return (
              <fieldset
                key={w.n}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex flex-col gap-2"
              >
                <legend className="px-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {w.label}
                  {hasAny ? "" : inherit ? " (eredita)" : " (riposo)"}
                </legend>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canWrite}
                    className={btnSecondary + " text-xs"}
                    onClick={() => addInterval(w.n)}
                  >
                    + Aggiungi fascia
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite}
                    className={btnGhost + " text-xs"}
                    onClick={() => resetDay(w.n)}
                  >
                    Riposo
                  </button>
                  <div className="ml-auto flex gap-2">
                    <select
                      aria-label={`Copia orari nel giorno ${w.label} da un altro giorno della settimana`}
                      disabled={!canWrite}
                      className="rounded-lg border px-2 py-1 text-xs border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950"
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        copyFromDay(Number(e.target.value), w.n);
                        e.target.value = "";
                      }}
                    >
                      <option value="">Copia da…</option>
                      {WEEKDAYS.filter((x) => x.n !== w.n).map((x) => (
                        <option key={x.n} value={x.n}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                    {w.n === 1 ? (
                      <button
                        type="button"
                        disabled={!canWrite}
                        className={btnSecondary + " text-xs"}
                        onClick={() => applyLunVen(1)}
                      >
                        Applica Lun→Ven
                      </button>
                    ) : null}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="text-xs text-neutral-500">
                    {hasAny
                      ? ""
                      : inherit
                        ? "Nessuna fascia configurata: eredita orari attività."
                        : "Riposo."}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.map((r, idx) => (
                      <li key={idx} className="flex flex-wrap items-end gap-2">
                        <label className="w-[42%] block">
                          <span className="text-[10px] text-neutral-500 block mb-1">Inizio</span>
                          <input
                            type="time"
                            disabled={!canWrite}
                            className={input}
                            value={r.start_time}
                            onChange={(e) => updateInterval(w.n, idx, "start_time", e.target.value)}
                          />
                        </label>
                        <label className="w-[42%] block">
                          <span className="text-[10px] text-neutral-500 block mb-1">Fine</span>
                          <input
                            type="time"
                            disabled={!canWrite}
                            className={input}
                            value={r.end_time}
                            onChange={(e) => updateInterval(w.n, idx, "end_time", e.target.value)}
                          />
                        </label>
                        <div className="flex-1">
                          <button
                            type="button"
                            disabled={!canWrite}
                            className={btnDanger + " text-xs"}
                            onClick={() => removeInterval(w.n, idx)}
                          >
                            Rimuovi
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            );
          })}

          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <div>
              <button
                type="button"
                className={btnGhost + " text-xs"}
                disabled={loading || saving}
                onClick={load}
              >
                Ricarica
              </button>
              <span className="text-xs text-neutral-500 ml-3">versione #{version}</span>
              {!clientValid.ok ? (
                <div className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                  {clientValid.errors.join("; ")}
                </div>
              ) : null}
              <ResultBanner result={saveState} />
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => onOpenChange(false)}>
                Annulla
              </button>
              <SubmitBtn pending={saving}>Salva settimana</SubmitBtn>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
