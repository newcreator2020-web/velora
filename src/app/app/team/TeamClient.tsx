"use client";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createResourceAction,
  listResourceServicesAction,
  listResourcesAction,
  setResourceServicesAction,
  toggleResourceActiveAction,
  updateResourceAction,
  type TeamResource,
} from "./actions";
import type { ResourceActionResult } from "@/lib/server/resources";
import { ResourceTimeOffDrawer } from "@/app/app/calendar/components/ResourceTimeOffDrawer";
import { deleteResourceTimeOffAction, listResourceTimeOffAction } from "@/app/app/timeoff.actions";
import { TIME_OFF_TYPE_LABELS, type ResourceTimeOffVM } from "@/lib/timeoff-shared";

type Service = { id: string; name: string; duration_minutes: number; active: boolean };

const card =
  "rounded-2xl border bg-white shadow-sm p-4 sm:p-5 dark:bg-neutral-900 dark:border-neutral-800";
const input =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 dark:text-white";
const btn =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnPrimary =
  btn +
  " bg-sky-600 text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-950";
const btnSecondary =
  btn +
  " bg-neutral-100 text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700";
const btnGhost =
  btn + " text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800";
const label = "block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {children}
    </button>
  );
}

function ErrorBadge({ err }: { err?: ResourceActionResult }) {
  if (!err) return null;
  if (err.ok) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-xs text-emerald-700 dark:text-emerald-400 mt-2"
      >
        {err.message}
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="text-xs text-rose-700 dark:text-rose-400 mt-2"
    >
      {err.message}
      {err.fieldErrors ? (
        <ul className="mt-1 list-disc pl-4">
          {Object.entries(err.fieldErrors).map(([k, msgs]) => (
            <li key={k}>
              {k}: {msgs?.join("; ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CreateForm() {
  const [state, formAction] = useFormState(
    createResourceAction,
    undefined as unknown as ResourceActionResult,
  );
  return (
    <form action={formAction} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
      <div className="md:col-span-4">
        <label htmlFor="new-display-name" className={label}>
          Nome operatore*
        </label>
        <input
          id="new-display-name"
          name="display_name"
          required
          maxLength={80}
          minLength={1}
          className={input}
          placeholder="es. Maria"
        />
      </div>
      <div className="md:col-span-3">
        <label htmlFor="new-slug" className={label}>
          Slug (opzionale)
        </label>
        <input id="new-slug" name="slug" maxLength={60} className={input} placeholder="maria" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="new-color" className={label}>
          Colore
        </label>
        <input
          id="new-color"
          name="color_hex"
          maxLength={7}
          className={input}
          placeholder="#3B82F6"
        />
      </div>
      <div className="md:col-span-1 flex items-center gap-2 pb-2">
        <input
          id="new-bookable"
          name="bookable"
          type="checkbox"
          defaultChecked
          className="h-4 w-4"
        />
        <label htmlFor="new-bookable" className="text-xs font-medium">
          Prenotabile
        </label>
      </div>
      <div className="md:col-span-2">
        <SubmitButton>Aggiungi</SubmitButton>
      </div>
      <div className="md:col-span-12">
        <ErrorBadge err={state} />
      </div>
    </form>
  );
}

type EligibilityState = Record<string, boolean>;

function ResourceRow({
  r,
  services,
  refresh,
  canWrite,
  timezone,
}: {
  r: TeamResource;
  services: Service[];
  refresh: () => void;
  canWrite: boolean;
  timezone?: string;
}) {
  const [updState, updAction] = useFormState(
    updateResourceAction,
    undefined as unknown as ResourceActionResult,
  );
  const [servicesState, setServicesState] = useState<EligibilityState>(() => ({}));
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [timeOffs, setTimeOffs] = useState<ResourceTimeOffVM[]>([]);
  const [timeOffsLoading, setTimeOffsLoading] = useState(false);
  const [tofMsg, setTofMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listResourceServicesAction(r.id).then((rows) => {
      if (cancelled) return;
      const next: EligibilityState = {};
      rows.forEach((row) => {
        if (row.active) next[row.service_id] = true;
      });
      setServicesState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [r.id]);

  const onToggleActive = async () => {
    if (!canWrite) return;
    const res = await toggleResourceActiveAction({ resource_id: r.id, active: !r.active });
    setSaveMsg({ ok: res.ok, text: res.message });
    if (res.ok) setTimeout(refresh, 100);
  };

  const onSaveServices = async () => {
    if (!canWrite) return;
    const ids: string[] = Object.keys(servicesState).filter((k) => servicesState[k]);
    const res = await setResourceServicesAction({ resource_id: r.id, service_ids: ids });
    setSaveMsg({ ok: res.ok, text: res.message });
  };

  const loadTimeOffs = async () => {
    setTimeOffsLoading(true);
    try {
      const rows = await listResourceTimeOffAction({ resource_id: r.id });
      setTimeOffs(rows);
    } finally {
      setTimeOffsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void loadTimeOffs().then(() => cancelled);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  const onDeleteTimeOff = async (id: string) => {
    if (!canWrite) return;
    const res = await deleteResourceTimeOffAction({ time_off_id: id });
    setTofMsg({ ok: res.ok, text: res.message ?? "" });
    if (res.ok) {
      setTimeOffs((prev) => prev.filter((t) => t.id !== id));
      setTimeout(loadTimeOffs, 50);
    }
  };

  function fmtRangeShort(isoStart: string, isoEnd: string) {
    const s = new Date(isoStart);
    const e = new Date(isoEnd);
    try {
      const it = new Intl.DateTimeFormat("it-IT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: timezone,
      });
      return `${it.format(s)} → ${it.format(e)}`;
    } catch {
      return `${isoStart.slice(0, 16)} → ${isoEnd.slice(0, 16)}`;
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="h-9 w-9 rounded-full shrink-0"
              style={{ backgroundColor: r.color_hex ?? "#94a3b8" }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="font-semibold truncate">{r.display_name}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                slug: {r.slug} · ordine {r.sort_order}
                {r.bookable ? "" : " · non prenotabile"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              disabled={!canWrite}
              className={btnSecondary + " gap-2"}
              aria-label={`Assenze di ${r.display_name}`}
            >
              <span aria-hidden>🗓</span> Assenze
            </button>
            <button
              type="button"
              onClick={onToggleActive}
              disabled={!canWrite}
              className={
                r.active
                  ? btnSecondary
                  : btnGhost + " ring-1 ring-neutral-200 dark:ring-neutral-700"
              }
              aria-pressed={r.active}
            >
              {r.active ? "Attivo" : "Inattivo"}
            </button>
          </div>
        </div>

        <form action={updAction} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <input type="hidden" name="resource_id" value={r.id} />
          <div className="md:col-span-3">
            <label htmlFor={`r-${r.id}-name`} className={label}>
              Nome
            </label>
            <input
              id={`r-${r.id}-name`}
              name="display_name"
              defaultValue={r.display_name}
              maxLength={80}
              className={input}
              disabled={!canWrite}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={`r-${r.id}-slug`} className={label}>
              Slug
            </label>
            <input
              id={`r-${r.id}-slug`}
              name="slug"
              defaultValue={r.slug}
              maxLength={60}
              className={input}
              disabled={!canWrite}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor={`r-${r.id}-color`} className={label}>
              Colore
            </label>
            <input
              id={`r-${r.id}-color`}
              name="color_hex"
              defaultValue={r.color_hex ?? ""}
              maxLength={7}
              className={input}
              disabled={!canWrite}
              placeholder="#RRGGBB"
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor={`r-${r.id}-order`} className={label}>
              Ordine
            </label>
            <input
              id={`r-${r.id}-order`}
              name="sort_order"
              type="number"
              min={0}
              max={10000}
              defaultValue={r.sort_order}
              className={input}
              disabled={!canWrite}
            />
          </div>
          <div className="md:col-span-1 flex items-center gap-2 pb-2">
            <input
              id={`r-${r.id}-bookable`}
              name="bookable"
              type="checkbox"
              defaultChecked={r.bookable}
              disabled={!canWrite}
              className="h-4 w-4"
            />
            <label htmlFor={`r-${r.id}-bookable`} className="text-xs font-medium">
              Prenotabile
            </label>
          </div>
          <div className="md:col-span-3">
            <SubmitButton>Salva</SubmitButton>
          </div>
          <div className="md:col-span-12">
            <ErrorBadge err={updState} />
          </div>
        </form>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-10">
            <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-2">
              Servizi effettuati
            </div>
            <div className="flex flex-wrap gap-2">
              {services.length === 0 ? (
                <div className="text-xs text-neutral-500">Nessun servizio configurato</div>
              ) : (
                services.map((s) => {
                  const checked = !!servicesState[s.id];
                  return (
                    <label
                      key={s.id}
                      className={
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs " +
                        (checked
                          ? "border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-100"
                          : "border-neutral-200 dark:border-neutral-700")
                      }
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        disabled={!canWrite}
                        checked={checked}
                        onChange={(e) =>
                          setServicesState((prev) => ({ ...prev, [s.id]: e.target.checked }))
                        }
                      />
                      <span className="truncate max-w-[12rem]">{s.name}</span>
                      <span className="text-neutral-500">· {s.duration_minutes}m</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="lg:col-span-2 flex items-start lg:justify-end">
            <button
              type="button"
              onClick={onSaveServices}
              className={btnPrimary}
              disabled={!canWrite}
            >
              Salva servizi
            </button>
          </div>
          {saveMsg ? (
            <div
              role="status"
              aria-live="polite"
              className={
                "lg:col-span-12 text-xs " +
                (saveMsg.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400")
              }
            >
              {saveMsg.text}
            </div>
          ) : null}
        </div>

        <section
          aria-labelledby={`tof-${r.id}-title`}
          className="border-t border-neutral-100 pt-4 dark:border-neutral-800"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3
              id={`tof-${r.id}-title`}
              className="text-xs font-semibold text-neutral-600 dark:text-neutral-400"
            >
              Assenze / ferie
            </h3>
            <button
              type="button"
              onClick={loadTimeOffs}
              className="text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              Aggiorna
            </button>
          </div>
          {timeOffsLoading ? (
            <div className="text-xs text-neutral-500">Caricamento…</div>
          ) : timeOffs.length === 0 ? (
            <div className="text-xs text-neutral-500">Nessuna assenza futura programmata.</div>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-neutral-50/40 dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950/50">
              {timeOffs.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {TIME_OFF_TYPE_LABELS[t.type as keyof typeof TIME_OFF_TYPE_LABELS] ?? t.type}
                      {t.title ? (
                        <span className="ml-2 text-xs text-neutral-500">· {t.title}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                      {fmtRangeShort(t.starts_at, t.ends_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteTimeOff(t.id)}
                    disabled={!canWrite}
                    className={
                      btnGhost +
                      " text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    }
                    aria-label={`Elimina assenza ${t.id}`}
                  >
                    Elimina
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tofMsg ? (
            <div
              role="status"
              aria-live="polite"
              className={
                "mt-2 text-xs " +
                (tofMsg.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400")
              }
            >
              {tofMsg.text}
            </div>
          ) : null}
        </section>

        <ResourceTimeOffDrawer
          open={drawerOpen}
          onOpenChange={(o) => {
            setDrawerOpen(o);
            if (!o) setTimeout(loadTimeOffs, 50);
          }}
          resource={{ id: r.id, display_name: r.display_name, slug: r.slug }}
          resources={[{ id: r.id, display_name: r.display_name, slug: r.slug }]}
          timezone={timezone}
          canWrite={canWrite}
          onChanged={() => {
            setTimeout(loadTimeOffs, 50);
          }}
        />
      </div>
    </li>
  );
}

export function TeamClient({
  initial,
  canWrite,
  timezone,
}: {
  initial: Awaited<ReturnType<typeof listResourcesAction>>;
  canWrite: boolean;
  timezone?: string;
}) {
  const [data, setData] = useState(initial);
  const refresh = async () => {
    const next = await listResourcesAction();
    setData(next);
  };

  const singleMode = data.resources.length <= 1;

  const headerSub = useMemo(() => {
    if (singleMode)
      return "Modalità singolo operatore: aggiungi una risorsa per abilitare la selezione multipla nel booking pubblico.";
    return `${data.resources.length} operatori. Nel booking pubblico i clienti possono scegliere “Qualsiasi operatore” o un professionista specifico.`;
  }, [singleMode, data.resources.length]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Team e operatori</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{headerSub}</p>
      </header>

      {canWrite ? (
        <section aria-labelledby="new-resource-title" className={card + " mb-6"}>
          <h2 id="new-resource-title" className="text-sm font-semibold mb-3">
            Aggiungi operatore
          </h2>
          <CreateForm />
        </section>
      ) : null}

      <section aria-labelledby="resources-title">
        <h2 id="resources-title" className="sr-only">
          Elenco operatori
        </h2>
        <ul className="grid grid-cols-1 gap-4">
          {data.resources.length === 0 ? (
            <li className={card}>
              <div className="text-sm text-neutral-600 dark:text-neutral-400">Nessuna risorsa.</div>
            </li>
          ) : (
            data.resources.map((r) => (
              <ResourceRow
                key={r.id}
                r={r}
                services={data.services.filter((s) => s.active)}
                refresh={refresh}
                canWrite={canWrite}
                {...(timezone ? { timezone } : {})}
              />
            ))
          )}
        </ul>
      </section>

      {canWrite ? (
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={refresh} className={btnGhost}>
            Aggiorna
          </button>
        </div>
      ) : null}
    </div>
  );
}
