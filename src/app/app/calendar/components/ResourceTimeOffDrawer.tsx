"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  previewResourceTimeOffAction,
  createResourceTimeOffAction,
} from "@/app/app/timeoff.actions";
import {
  TIME_OFF_TYPES,
  TIME_OFF_TYPE_LABELS,
  type TimeOffType,
  type ResourceTimeOffVM,
  type PreviewConflictBooking,
  type TimeOffActionResult,
} from "@/lib/timeoff-shared";

type ResourceOption = {
  id: string;
  display_name: string;
  slug: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: ResourceOption | undefined;
  resources: ResourceOption[];
  timezone?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  onChanged?: () => void;
  canWrite?: boolean;
};

type DrawerState =
  | { kind: "CLOSED" }
  | { kind: "EDITING" }
  | { kind: "PREVIEW_LOADING" }
  | {
      kind: "PREVIEW_READY_NO_CONFLICT";
      payload: { conflicts: PreviewConflictBooking[]; conflict_count: number };
    }
  | {
      kind: "PREVIEW_READY_WITH_CONFLICTS";
      payload: { conflicts: PreviewConflictBooking[]; conflict_count: number };
      ack: boolean;
    }
  | { kind: "SUBMITTING" }
  | { kind: "SUCCESS"; data: { read_back: ResourceTimeOffVM; conflict_count: number } }
  | { kind: "ERROR"; code: string; message: string; staleReload?: boolean };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toDatetimeLocal(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    "T" +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes())
  );
}
function fromLocal(s: string): Date | null {
  if (!s || s.length < 16) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}
function fmtDateTime(iso: string, tz?: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: tz,
    });
  } catch {
    return iso;
  }
}
function fmtRange(startsAt: Date, endsAt: Date, tz?: string) {
  const h = new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: tz,
  });
  return `${h.format(startsAt)} → ${h.format(endsAt)}`;
}

const card =
  "w-full max-w-lg rounded-t-2xl border border-neutral-200 bg-white shadow-xl sm:rounded-2xl";
const btnBase =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-neutral-950";
const btnPrimary =
  btnBase + " bg-sky-600 text-white hover:bg-sky-700 focus:ring-sky-500 disabled:hover:bg-sky-600";
const btnSecondary =
  btnBase +
  " bg-neutral-100 text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700";
const btnGhost =
  btnBase +
  " text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800";
const label = "block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1";
const input =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 dark:text-white";

function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={btnPrimary + " w-full"}
    >
      {pending ? "Invio…" : children}
    </button>
  );
}

function createBoundaries(initialStarts?: Date, _initialEnds?: Date) {
  const now = new Date();
  const start = initialStarts ?? new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const startStep = Math.ceil(start.getMinutes() / 15) * 15 - start.getMinutes();
  const base = new Date(start);
  base.setSeconds(0, 0);
  base.setMinutes(start.getMinutes() + startStep);
  const end = new Date(base.getTime() + 4 * 60 * 60 * 1000);
  return { base, end };
}

export function ResourceTimeOffDrawer(props: Props) {
  const open = props.open && (props.canWrite ?? true);
  const canWrite = props.canWrite ?? true;
  const { base, end: endDefault } = useMemo(
    () => createBoundaries(props.startsAt, props.endsAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.open, props.resource?.id],
  );

  const initial = props.resource ? props.resource.id : (props.resources[0]?.id ?? "");
  const [resourceId, setResourceId] = useState<string>(initial);
  const [type, setType] = useState<TimeOffType>("vacation");
  const [startsLocal, setStartsLocal] = useState<string>(toDatetimeLocal(base));
  const [endsLocal, setEndsLocal] = useState<string>(toDatetimeLocal(endDefault));
  const [title, setTitle] = useState<string>("");
  const [state, setState] = useState<DrawerState>({ kind: "CLOSED" });
  const [ackConflicts, setAckConflicts] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const effectiveResource = useMemo<ResourceOption | undefined>(() => {
    if (props.resource) return props.resource;
    return props.resources.find((r) => r.id === resourceId);
  }, [props.resource, props.resources, resourceId]);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      const t = window.setTimeout(() => {
        if (cancelled) return;
        setState({ kind: "EDITING" });
        setResourceId(
          props.resource ? props.resource.id : resourceId || props.resources[0]?.id || "",
        );
        if (props.startsAt) setStartsLocal(toDatetimeLocal(props.startsAt));
        else setStartsLocal(toDatetimeLocal(base));
        if (props.endsAt) setEndsLocal(toDatetimeLocal(props.endsAt));
        else setEndsLocal(toDatetimeLocal(endDefault));
        setTitle("");
        setType("vacation");
        setAckConflicts(false);
        window.setTimeout(() => {
          if (!cancelled) firstFieldRef.current?.focus();
        }, 30);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    } else {
      const t = window.setTimeout(() => {
        if (!cancelled) setState({ kind: "CLOSED" });
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        props.onOpenChange(false);
        triggerRef.current?.focus?.();
      }
    };
    return () => window.removeEventListener("keydown", onKey);
  }, [open, props]);

  const close = useCallback(() => {
    props.onOpenChange(false);
    triggerRef.current?.focus?.();
  }, [props]);

  const startDate = fromLocal(startsLocal);
  const endDate = fromLocal(endsLocal);
  const formInvalid =
    !resourceId ||
    !TIME_OFF_TYPES.includes(type) ||
    !startDate ||
    !endDate ||
    startDate.getTime() >= endDate.getTime() ||
    title.length > 200 ||
    (state.kind === "PREVIEW_READY_WITH_CONFLICTS" && !ackConflicts);

  const onPreview = useCallback(
    async (ev?: React.FormEvent) => {
      ev?.preventDefault();
      if (!startDate || !endDate || !resourceId || !canWrite) return;
      setState({ kind: "PREVIEW_LOADING" });
      const res = await previewResourceTimeOffAction({
        resource_id: resourceId,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
      });
      if (!res.ok) {
        setState({
          kind: "ERROR",
          code: res.code,
          message: res.message,
        });
        return;
      }
      if (res.data.conflict_count === 0) {
        setState({
          kind: "PREVIEW_READY_NO_CONFLICT",
          payload: res.data,
        });
      } else {
        setState({
          kind: "PREVIEW_READY_WITH_CONFLICTS",
          payload: res.data,
          ack: false,
        });
        setAckConflicts(false);
      }
    },
    [startDate, endDate, resourceId, canWrite],
  );

  const formAction = useCallback(
    async (_: unknown, _form: FormData) => {
      if (!startDate || !endDate || !resourceId || !canWrite) {
        return {
          ok: false as const,
          code: "VALIDATION_ERROR",
          message: "Compila i campi obbligatori.",
        };
      }
      if (state.kind === "PREVIEW_READY_WITH_CONFLICTS" && !ackConflicts) {
        return {
          ok: false as const,
          code: "VALIDATION_ERROR",
          message: "Conferma che le prenotazioni esistenti NON verranno cancellate o spostate.",
        };
      }
      const expected_count =
        state.kind === "PREVIEW_READY_NO_CONFLICT"
          ? 0
          : state.kind === "PREVIEW_READY_WITH_CONFLICTS"
            ? state.payload.conflict_count
            : undefined;
      setState({ kind: "SUBMITTING" });
      const res = await createResourceTimeOffAction(null, {
        resource_id: resourceId,
        type,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
        title,
        expected_conflict_count: expected_count,
      });
      if (!res.ok) {
        if (res.code === "CONFLICT_PREVIEW_STALE") {
          const retry = await previewResourceTimeOffAction({
            resource_id: resourceId,
            starts_at: startDate.toISOString(),
            ends_at: endDate.toISOString(),
          });
          if (retry.ok) {
            if (retry.data.conflict_count === 0) {
              setState({
                kind: "ERROR",
                code: "CONFLICT_PREVIEW_STALE",
                message:
                  "Nel frattempo sono cambiate le prenotazioni coinvolte. Controlla il nuovo riepilogo.",
                staleReload: true,
              });
              setTimeout(() => {
                setState({
                  kind: "PREVIEW_READY_NO_CONFLICT",
                  payload: retry.data,
                });
              }, 600);
            } else {
              setState({
                kind: "ERROR",
                code: "CONFLICT_PREVIEW_STALE",
                message:
                  "Nel frattempo sono cambiate le prenotazioni coinvolte. Controlla il nuovo riepilogo.",
                staleReload: true,
              });
              setTimeout(() => {
                setState({
                  kind: "PREVIEW_READY_WITH_CONFLICTS",
                  payload: retry.data,
                  ack: false,
                });
                setAckConflicts(false);
              }, 600);
            }
          } else {
            setState({
              kind: "ERROR",
              code: retry.code,
              message: retry.message,
            });
          }
        } else {
          setState({
            kind: "ERROR",
            code: res.code,
            message: res.message,
          });
        }
        return res as TimeOffActionResult;
      }
      setState({
        kind: "SUCCESS",
        data: {
          read_back: res.data.read_back,
          conflict_count: res.data.conflict_count,
        },
      });
      setTimeout(() => {
        props.onChanged?.();
        close();
      }, 1100);
      return res as TimeOffActionResult;
    },
    [startDate, endDate, resourceId, canWrite, state, ackConflicts, type, title, props, close],
  );

  const [formState, act] = useActionState(formAction, null);

  if (!open) return null;

  return (
    <div
      data-resource-time-off-drawer="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="timeoff-drawer-title"
      className="fixed inset-0 z-50 flex items-end justify-end bg-neutral-900/40 sm:items-center sm:justify-center"
    >
      <button
        type="button"
        aria-label="Chiudi pannello"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default appearance-none bg-transparent"
      />
      <div className={card}>
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id="timeoff-drawer-title"
              className="truncate text-base font-semibold text-neutral-900"
            >
              {effectiveResource?.display_name
                ? `Assenza · ${effectiveResource.display_name}`
                : "Nuova assenza"}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Blocca la disponibilità dell’operatore nel calendario pubblico.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Chiudi pannello"
            onClick={close}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>

        {state.kind === "SUCCESS" ? (
          <div role="status" aria-live="polite" className="px-4 py-6 text-sm">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
              <span aria-hidden>✓</span> Assenza salvata.
            </div>
            <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
              {fmtRange(
                new Date(state.data.read_back.starts_at),
                new Date(state.data.read_back.ends_at),
                props.timezone,
              )}
              {state.data.conflict_count > 0
                ? ` · ${state.data.conflict_count} prenotazioni da gestire.`
                : " Nessun conflitto."}
            </p>
          </div>
        ) : state.kind === "ERROR" ? (
          <div className="px-4 py-4 space-y-3">
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {state.staleReload ? "⚠ " : ""}
              {state.message}
              {state.code ? <span className="ml-2 opacity-60">[{state.code}]</span> : null}
            </div>
            {!state.staleReload && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setState({ kind: "EDITING" })}
                >
                  Modifica
                </button>
                <button type="button" className={btnGhost} onClick={close}>
                  Chiudi
                </button>
              </div>
            )}
          </div>
        ) : (
          <form
            action={act}
            onSubmit={(e) => {
              if (state.kind === "EDITING") {
                e.preventDefault();
                void onPreview(e);
              }
            }}
            className="space-y-4 px-4 py-4"
          >
            <input type="hidden" name="resource_id" value={resourceId} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="starts_at" value={startDate?.toISOString() ?? ""} />
            <input type="hidden" name="ends_at" value={endDate?.toISOString() ?? ""} />
            <input type="hidden" name="title" value={title} />

            {state.kind === "EDITING" || state.kind === "PREVIEW_LOADING" ? (
              <>
                <div>
                  <label htmlFor="tof-resource" className={label}>
                    Operatore*
                  </label>
                  <select
                    ref={firstFieldRef}
                    id="tof-resource"
                    disabled={!!props.resource || !canWrite}
                    className={input}
                    value={resourceId}
                    onChange={(e) => setResourceId(e.target.value)}
                    required
                  >
                    {props.resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tof-type" className={label}>
                    Tipo*
                  </label>
                  <select
                    id="tof-type"
                    className={input}
                    disabled={!canWrite}
                    value={type}
                    onChange={(e) => setType(e.target.value as TimeOffType)}
                    required
                  >
                    {TIME_OFF_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TIME_OFF_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="tof-start" className={label}>
                      Inizio*
                    </label>
                    <input
                      id="tof-start"
                      type="datetime-local"
                      className={input}
                      disabled={!canWrite}
                      value={startsLocal}
                      onChange={(e) => setStartsLocal(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="tof-end" className={label}>
                      Fine*
                    </label>
                    <input
                      id="tof-end"
                      type="datetime-local"
                      className={input}
                      disabled={!canWrite}
                      value={endsLocal}
                      onChange={(e) => setEndsLocal(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="tof-title" className={label}>
                    Note interne (opzionale, max 200)
                  </label>
                  <input
                    id="tof-title"
                    type="text"
                    maxLength={200}
                    className={input}
                    disabled={!canWrite}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="es. Chiusura estiva"
                  />
                </div>
              </>
            ) : state.kind === "PREVIEW_READY_NO_CONFLICT" ? (
              <PreviewPanel
                conflicts={state.payload.conflicts}
                count={state.payload.conflict_count}
                {...(props.timezone ? { tz: props.timezone } : {})}
              />
            ) : state.kind === "PREVIEW_READY_WITH_CONFLICTS" ? (
              <>
                <div
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <span className="font-semibold">
                    {state.payload.conflict_count} prenotazioni da gestire.
                  </span>{" "}
                  Le prenotazioni esistenti{" "}
                  <span className="font-semibold underline underline-offset-2">
                    NON verranno cancellate o spostate
                  </span>
                  .
                </div>
                <PreviewPanel
                  conflicts={state.payload.conflicts}
                  count={state.payload.conflict_count}
                  {...(props.timezone ? { tz: props.timezone } : {})}
                />
                <label className="flex items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                    checked={ackConflicts}
                    onChange={(e) => setAckConflicts(e.target.checked)}
                  />
                  <span>
                    Confermo di voler salvare l’assenza{" "}
                    <span className="font-semibold">
                      senza modificare le prenotazioni coinvolte
                    </span>
                    .
                  </span>
                </label>
              </>
            ) : null}

            {state.kind === "PREVIEW_READY_NO_CONFLICT" ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setState({ kind: "EDITING" })}
                >
                  Modifica
                </button>
                <SubmitButton disabled={formInvalid}>Conferma assenza</SubmitButton>
              </div>
            ) : state.kind === "PREVIEW_READY_WITH_CONFLICTS" ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setState({ kind: "EDITING" })}
                >
                  Modifica
                </button>
                <SubmitButton disabled={formInvalid}>
                  Conferma e mantieni le prenotazioni
                </SubmitButton>
              </div>
            ) : state.kind === "PREVIEW_LOADING" ? (
              <div className="flex justify-end">
                <button type="button" disabled className={btnPrimary + " w-full opacity-70"}>
                  Controllo prenotazioni…
                </button>
              </div>
            ) : (
              <>
                {formState && !formState.ok ? (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                  >
                    {formState.message}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" className={btnGhost} onClick={close} tabIndex={-1}>
                    Annulla
                  </button>
                  <button
                    type="submit"
                    disabled={formInvalid || state.kind !== "EDITING" || !canWrite}
                    className={btnPrimary + " w-full sm:w-auto"}
                  >
                    Continua
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({
  conflicts,
  count,
  tz,
}: {
  conflicts: PreviewConflictBooking[];
  count: number;
  tz?: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">
        Riepilogo assenza
        {count > 0 ? (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            {count} coinvolte
          </span>
        ) : (
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            0 conflitti
          </span>
        )}
      </div>
      {count === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-3 text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
          Nessuna prenotazione sovrapposta nel range selezionato.
        </div>
      ) : (
        <ul className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          {conflicts.map((b) => (
            <li key={b.booking_id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {b.service_name || "Servizio"}
                </span>
                <span className="shrink-0 text-[11px] font-mono text-neutral-500">
                  #{b.booking_id.slice(0, 8)}
                </span>
              </div>
              <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                {fmtDateTime(b.starts_at, tz)} — {fmtDateTime(b.ends_at, tz)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
