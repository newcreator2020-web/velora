"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listMediaAction, type ListMediaFilters } from "../actions";
import type { MediaLibraryRow } from "../lib";
import { bytesToSize, isImageMime, MEDIA_CATEGORIES } from "../lib";

export type MediaPickerProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (selected: MediaLibraryRow) => void;
  initialCategory?: string;
  ownerTenantId?: string;
  searchPlaceholder?: string;
  allowUpload?: boolean;
};

export function MediaPicker({
  open,
  onCancel,
  onConfirm,
  initialCategory = "",
  ownerTenantId,
  searchPlaceholder = "Cerca file per nome o descrizione...",
}: MediaPickerProps) {
  const [rows, setRows] = useState<MediaLibraryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListMediaFilters>({
    category:
      !initialCategory ||
      !MEDIA_CATEGORIES.includes(initialCategory as (typeof MEDIA_CATEGORIES)[number])
        ? undefined
        : (initialCategory as ListMediaFilters["category"]),
    owner_tenant: ownerTenantId,
    sort: "created_desc",
    limit: 120,
  });
  const [search, setSearch] = useState("");
  const [mime, setMime] = useState("");

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const merged: ListMediaFilters = {
        ...filters,
        search: search || undefined,
        mime: mime || undefined,
      };
      const res = await listMediaAction(merged);
      if (!res.ok) throw new Error(res.error ?? "Errore caricamento media");
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters, search, mime]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setSelectedId(null);
        void fetchMedia();
      });
    }
  }, [open, fetchMedia]);

  const categoryOpts = useMemo(
    () => [
      { value: "", label: "Tutte categorie" },
      ...MEDIA_CATEGORIES.map((k) => ({ value: k, label: labelCategory(k) })),
    ],
    [],
  );

  const setCategorySafe = (val: string) =>
    setFilters((f) => ({
      ...f,
      category:
        !val || !MEDIA_CATEGORIES.includes(val as (typeof MEDIA_CATEGORIES)[number])
          ? undefined
          : (val as ListMediaFilters["category"]),
    }));

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Seleziona media"
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">
              Seleziona un file dalla Media Library
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Caricamento: {loading ? "..." : `${rows.length} file trovati`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && onConfirm(selected)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {selected ? "Usa questo file" : "Seleziona un file"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/60 px-5 py-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchMedia();
            }}
            placeholder={searchPlaceholder}
            className="min-w-[220px] flex-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          />
          <select
            value={filters.category ?? ""}
            onChange={(e) => setCategorySafe(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          >
            {categoryOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={mime}
            onChange={(e) => setMime(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          >
            <option value="">Tutti i tipi</option>
            <option value="image/">Immagini</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WebP</option>
            <option value="image/avif">AVIF</option>
            <option value="image/gif">GIF</option>
            <option value="application/pdf">PDF</option>
          </select>
          <select
            value={filters.sort ?? "created_desc"}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                sort: (e.target.value || "created_desc") as ListMediaFilters["sort"],
              }))
            }
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          >
            <option value="created_desc">Data (recenti)</option>
            <option value="size_desc">Dimensione (grandi)</option>
            <option value="filename_asc">Nome (A-Z)</option>
          </select>
          <button
            type="button"
            onClick={() => void fetchMedia()}
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-200"
          >
            Aggiorna
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-14 w-14 rounded-full bg-zinc-100 p-3 text-zinc-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="9" cy="10" r="2" />
                  <path d="m21 16-5-5L5 21" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-800">Nessun file trovato</p>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Cambia i filtri oppure carica nuovi file dalla pagina Media principale.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {rows.map((r) => {
                const isSel = r.id === selectedId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition ${
                      isSel
                        ? "border-zinc-900 ring-2 ring-zinc-900/80"
                        : "border-zinc-200 hover:border-zinc-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-50">
                      <MediaThumbnail row={r} />
                    </div>
                    <div className="space-y-1.5 p-2.5">
                      <p
                        className="line-clamp-2 text-xs font-medium text-zinc-800"
                        title={r.filename_orig}
                      >
                        {r.filename_orig}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                        <span className="inline-flex items-center rounded-sm bg-zinc-100 px-1.5 py-0.5 capitalize">
                          {labelCategory(r.category)}
                        </span>
                        {r.width_px && r.height_px ? (
                          <span>
                            {r.width_px}×{r.height_px}
                          </span>
                        ) : null}
                        <span>{bytesToSize(Number(r.file_size_bytes))}</span>
                      </div>
                    </div>
                    {isSel ? (
                      <div className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-white shadow-md">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="h-3.5 w-3.5"
                        >
                          <path d="M5 12l5 5 9-11" />
                        </svg>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 bg-zinc-50/80 px-5 py-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <MediaThumbnail row={selected} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{selected.filename_orig}</p>
              <p className="truncate text-xs text-zinc-500">
                {selected.alt_text ?? "Nessun testo alternativo"} ·{" "}
                {bytesToSize(Number(selected.file_size_bytes))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onConfirm(selected)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              Conferma e usa
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function labelCategory(c: string): string {
  const map: Record<string, string> = {
    immagine_generica: "Generica",
    servizio: "Servizio",
    staff: "Staff",
    gallery: "Gallery",
    hero: "Hero",
    logo: "Logo",
    sfondo: "Sfondo",
    documento: "Documento",
  };
  return map[c] ?? c;
}

function MediaThumbnail({ row }: { row: MediaLibraryRow }) {
  const isImg = isImageMime(row.mime_type);
  void row;
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 via-zinc-50 to-zinc-200 p-2">
      {isImg ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="h-8 w-8 text-zinc-400"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="9" cy="10" r="2" />
          <path d="m21 16-5-5L5 21" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="h-9 w-9 text-zinc-400"
        >
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      )}
    </div>
  );
}

export default MediaPicker;
