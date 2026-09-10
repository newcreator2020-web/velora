"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import type { PublicationStatus, PublicationVersionRow, RollbackPublicationResult } from "../lib";

type VersionsState = Awaited<ReturnType<typeof import("../actions").loadPublicationVersions>>;

type Props = {
  initialVersions: VersionsState;
  rollbackAction: (
    prev: RollbackPublicationResult,
    form: FormData,
  ) => Promise<RollbackPublicationResult>;
  labelMap: Record<PublicationStatus, string>;
};

type InlineState = RollbackPublicationResult | null;

const initialRowState: InlineState = null;

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(v);
  }
}

function statusStyle(s: PublicationStatus): string {
  switch (s) {
    case "published":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20";
    case "validated":
      return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20";
    case "ready_for_qa":
      return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20";
    case "draft":
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20";
  }
}

function snapshotStats(snapshot: unknown): {
  sections: number;
  services: number;
  theme: boolean;
  hash: string;
} {
  const s =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as { [k: string]: unknown })
      : null;
  const sectionsVal = s?.["sections"];
  const servicesVal = s?.["services"];
  const themeVal = s?.["theme"];
  const sec = Array.isArray(sectionsVal) ? (sectionsVal as unknown[]).length : 0;
  const svc = Array.isArray(servicesVal) ? (servicesVal as unknown[]).length : 0;
  const theme =
    themeVal &&
    typeof themeVal === "object" &&
    !Array.isArray(themeVal) &&
    Object.keys(themeVal as Record<string, unknown>).length > 0;
  return { sections: sec, services: svc, theme: Boolean(theme), hash: "" };
}

function RowRollbackForm({
  version,
  isLatest,
  action,
  labelMap,
}: {
  version: PublicationVersionRow;
  isLatest: boolean;
  action: Props["rollbackAction"];
  labelMap: Props["labelMap"];
}) {
  const safeAction = action as unknown as (
    state: RollbackPublicationResult | null,
    payload: FormData,
  ) => Promise<RollbackPublicationResult | null>;
  const [state, formAction, pending] = useFormState(safeAction, initialRowState);
  const [open, setOpen] = useState(false);
  const err = state && !state.ok ? state.error : null;
  const ok = state && state.ok ? state : null;

  const latestLabel = isLatest ? "Versione attiva" : `Ripristina v${version.version_number}`;

  return (
    <div className="flex flex-col items-end gap-2">
      {isLatest ? (
        <span className="inline-flex items-center rounded-md bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white">
          Versione corrente
        </span>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2"
          aria-label={`Ripristina versione ${version.version_number}`}
        >
          Ripristina questa versione
        </button>
      ) : (
        <form action={formAction} className="flex w-full flex-col items-end gap-2">
          <input type="hidden" name="target_version" value={String(version.version_number)} />
          <div
            role="alert"
            className="w-full rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <p className="font-medium">
              Confermi il ripristino della versione v{version.version_number}?
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Stato: {labelMap[version.status]} · Pubblicata: {formatDate(version.published_at)}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              L&apos;operazione crea una nuova versione (rollback) e applica il contenuto al
              pubblico. Azione irreversibile (ma tracciata).
            </p>
          </div>
          <div className="flex w-full justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Ripristino in corso…" : "Sì, ripristina"}
            </button>
          </div>
          {err ? (
            <p
              role="alert"
              className="w-full rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
            >
              {err}
            </p>
          ) : null}
          {ok ? (
            <p
              role="status"
              className="w-full rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700"
            >
              <span className="font-medium">{ok.message}</span>{" "}
              <span className="opacity-80">
                (v{ok.from_version_number} → v{ok.new_version_number} · {ok.sections_applied}{" "}
                sezioni · {ok.services_applied} servizi)
              </span>{" "}
              <Link
                href="/app/site/preview"
                className="ml-1 underline underline-offset-2 hover:text-emerald-800"
              >
                Apri anteprima
              </Link>
            </p>
          ) : null}
        </form>
      )}
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{latestLabel}</span>
    </div>
  );
}

export function PublicationsClient({ initialVersions, rollbackAction, labelMap }: Props) {
  const latestVersionNumber = useMemo<number | null>(() => {
    if (!initialVersions.ok) return null;
    return initialVersions.latest;
  }, [initialVersions]);

  if (!initialVersions.ok) {
    return (
      <section
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"
      >
        <p className="font-semibold">Impossibile caricare le versioni di pubblicazione.</p>
        <p className="mt-1 text-rose-700">{initialVersions.error}</p>
      </section>
    );
  }

  const versions = initialVersions.versions;
  if (versions.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">Nessuna versione pubblicata salvata.</p>
        <p className="mt-1 text-xs text-slate-500">
          Pubblica il sito dall&apos;editor per creare la prima versione tracciabile.
        </p>
        <Link
          href="/app/site"
          className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Vai all&apos;editor
        </Link>
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden min-w-[980px] grid-cols-12 gap-4 border-b border-slate-200 bg-slate-50/60 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
        <div className="col-span-1">Versione</div>
        <div className="col-span-2">Stato · Pubblicata</div>
        <div className="col-span-3">Contenuto</div>
        <div className="col-span-3">Note / Changelog</div>
        <div className="col-span-3 text-right">Azioni</div>
      </div>
      <ul className="divide-y divide-slate-100">
        {versions.map((v) => {
          const stats = snapshotStats(v.snapshot);
          const latest = Number(v.version_number) === Number(latestVersionNumber);
          return (
            <li
              key={v.id}
              className={`grid grid-cols-1 gap-5 px-4 py-5 sm:px-6 md:grid-cols-12 md:gap-4 ${
                latest ? "bg-emerald-50/40" : ""
              }`}
            >
              <div className="md:col-span-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums text-slate-900">
                    v{v.version_number}
                  </span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
                  {latest ? "ATTIVA" : "Archivio"}
                </p>
              </div>
              <div className="md:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle(v.status)}`}
                  >
                    {labelMap[v.status]}
                  </span>
                </div>
                <dl className="mt-2 space-y-0.5 text-xs text-slate-500">
                  <div>
                    <dt className="sr-only">Pubblicata il</dt>
                    <dd>
                      <span className="font-medium text-slate-600">Pubblicata: </span>
                      {formatDate(v.published_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Creata il</dt>
                    <dd>
                      <span className="font-medium text-slate-600">Creata: </span>
                      {formatDate(v.created_at)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="md:col-span-3">
                <ul className="flex flex-wrap gap-2 text-xs">
                  <li className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                    Sezioni ·{" "}
                    <span className="ml-1 font-semibold tabular-nums">{stats.sections}</span>
                  </li>
                  <li className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-slate-700">
                    Servizi ·{" "}
                    <span className="ml-1 font-semibold tabular-nums">{stats.services}</span>
                  </li>
                  <li
                    className={`inline-flex items-center rounded-md px-2 py-1 ${
                      stats.theme ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    Tema ·{" "}
                    <span className="ml-1 font-semibold">
                      {stats.theme ? "Personalizzato" : "Default"}
                    </span>
                  </li>
                </ul>
                {v.hash_sha256 ? (
                  <p
                    className="mt-2 truncate font-mono text-[11px] text-slate-400"
                    title={v.hash_sha256}
                  >
                    hash {v.hash_sha256.slice(0, 16)}…
                  </p>
                ) : null}
              </div>
              <div className="md:col-span-3">
                {v.note ? (
                  <p className="text-sm text-slate-700 line-clamp-4">{v.note}</p>
                ) : (
                  <p className="text-sm italic text-slate-400">Nessuna nota per questa versione.</p>
                )}
                {v.created_by ? (
                  <p className="mt-2 text-[11px] text-slate-400">
                    Autore: {String(v.created_by).slice(0, 8)}…
                  </p>
                ) : null}
              </div>
              <div className="md:col-span-3">
                <RowRollbackForm
                  version={v}
                  isLatest={latest}
                  action={rollbackAction}
                  labelMap={labelMap}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
