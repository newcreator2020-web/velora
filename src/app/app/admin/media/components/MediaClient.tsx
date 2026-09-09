"use client";

import { useMemo, useRef, useState, useCallback, startTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadMediaAction, listMediaAction, type ListMediaFilters } from "../actions";
import { bytesToSize, isImageMime, MAX_FILE_BYTES } from "../lib";
import type { MediaLibraryRow } from "../lib";
import MediaDetailDialog from "./MediaDetailDialog";

const CATEGORY_LABEL: Record<string, string> = {
  immagine_generica: "Generica",
  servizio: "Servizio",
  staff: "Staff",
  gallery: "Gallery",
  hero: "Hero",
  logo: "Logo",
  sfondo: "Sfondo",
  documento: "Documento",
};

const CATEGORY_STYLES: Record<string, string> = {
  immagine_generica: "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200",
  servizio: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  staff: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  gallery: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
  hero: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  logo: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  sfondo: "bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200",
  documento: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
};

const MIME_OPTIONS = [
  { value: "", label: "Tutti i tipi" },
  { value: "image/", label: "Tutte immagini" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
  { value: "image/avif", label: "AVIF" },
  { value: "image/gif", label: "GIF" },
  { value: "application/pdf", label: "PDF" },
];

const SORT_OPTIONS = [
  { value: "created_desc", label: "Data (più recenti)" },
  { value: "size_desc", label: "Dimensione (più grandi)" },
  { value: "filename_asc", label: "Nome file (A-Z)" },
];

type FilterState = {
  category: string;
  mime: string;
  search: string;
  owner_tenant: string;
  sort: string;
};

type UploadItem = {
  id: string;
  fileName: string;
  fileSize: number;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string | undefined;
  media?: MediaLibraryRow | undefined;
  _timer?: ReturnType<typeof setInterval> | undefined;
};

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s fa`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m fa`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h fa`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay} giorni fa`;
    return new Date(iso).toLocaleDateString("it-IT");
  } catch {
    return "—";
  }
}

function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES["immagine_generica"];
  const label = CATEGORY_LABEL[category] ?? category;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function MimeBadge({ mime }: { mime: string }) {
  const short = mime.split("/")[1]?.toUpperCase() ?? mime.split("/")[0];
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
      {short}
    </span>
  );
}

function PlaceholderThumb({ mime }: { mime: string }) {
  const isPdf = mime === "application/pdf";
  const label = isPdf ? "PDF" : "IMG";
  const gradient = isPdf
    ? "from-rose-400 via-rose-500 to-red-600"
    : "from-indigo-400 via-purple-500 to-pink-500";
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${gradient}`}>
      <span className="text-white text-2xl font-bold tracking-wider drop-shadow">{label}</span>
    </div>
  );
}

function ImageThumb({ media }: { media: MediaLibraryRow }) {
  const [errored, setErrored] = useState(false);
  if (!isImageMime(media.mime_type) || errored) {
    return <PlaceholderThumb mime={media.mime_type} />;
  }
  const short = media.stored_path;
  const url = `https://media.velora.test/placeholder/${encodeURIComponent(short)}`;
  return (
    <div className="w-full h-full bg-zinc-100 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={media.alt_text ?? media.filename_orig}
        onError={() => setErrored(true)}
        loading="lazy"
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export default function MediaClient({
  initialRows,
  count,
  initialFilters,
  categories,
  mimeOptions,
}: {
  initialRows: MediaLibraryRow[];
  count: number;
  initialFilters: FilterState;
  categories: readonly string[];
  mimeOptions: readonly string[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [rows, setRows] = useState<MediaLibraryRow[]>(initialRows);
  const [totalCount, setTotalCount] = useState<number>(count);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaLibraryRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const currentCount = useMemo(() => {
    return totalCount;
  }, [totalCount]);

  function applyFilters() {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.category) params.set("category", filters.category);
    if (filters.mime) params.set("mime", filters.mime);
    if (filters.owner_tenant.trim()) params.set("owner_tenant", filters.owner_tenant.trim());
    if (filters.sort) params.set("sort", filters.sort);
    const qs = params.toString();
    router.push(qs ? `/app/admin/media?${qs}` : "/app/admin/media");
    router.refresh();
  }

  function resetFilters() {
    setFilters({
      category: "",
      mime: "",
      search: "",
      owner_tenant: "",
      sort: "created_desc",
    });
    router.push("/app/admin/media");
    router.refresh();
  }

  function openDetail(media: MediaLibraryRow) {
    setSelectedMedia(media);
    setDialogOpen(true);
  }

  function onDetailChanged() {
    setDialogOpen(false);
    setSelectedMedia(null);
    startTransition(async () => {
      const args: ListMediaFilters = { limit: 200 };
      if (filters.category) args.category = filters.category as ListMediaFilters["category"];
      if (filters.mime) args.mime = filters.mime;
      if (filters.search) args.search = filters.search;
      if (filters.owner_tenant) args.owner_tenant = filters.owner_tenant;
      if (
        filters.sort === "created_desc" ||
        filters.sort === "size_desc" ||
        filters.sort === "filename_asc"
      ) {
        args.sort = filters.sort;
      }
      const res = await listMediaAction(args);
      if (res.ok) {
        setRows(res.rows);
        setTotalCount(res.count);
      }
      router.refresh();
    });
  }

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      setInlineError(null);
      const files = Array.from(fileList);
      const newItems: UploadItem[] = [];
      for (const f of files) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (f.size > MAX_FILE_BYTES) {
          newItems.push({
            id,
            fileName: f.name,
            fileSize: f.size,
            status: "error",
            progress: 0,
            error: `File troppo grande (max ${MAX_FILE_BYTES / (1024 * 1024)} MB)`,
          });
          continue;
        }
        const item: UploadItem = {
          id,
          fileName: f.name,
          fileSize: f.size,
          status: "uploading",
          progress: 0,
        };
        newItems.push(item);

        const timer = setInterval(() => {
          setUploads((prev) => {
            const copy = prev.slice();
            const idx = copy.findIndex((u) => u.id === id);
            if (idx === -1) return prev;
            const cur = copy[idx];
            if (!cur || cur.status !== "uploading") return prev;
            const next = Math.min(cur.progress + Math.random() * 18 + 6, 90);
            copy[idx] = {
              id: cur.id,
              fileName: cur.fileName,
              fileSize: cur.fileSize,
              status: cur.status,
              progress: next,
              error: cur.error,
              media: cur.media,
              _timer: cur._timer,
            };
            return copy;
          });
        }, 220);
        item._timer = timer;

        void (async () => {
          try {
            const formData = new FormData();
            formData.append("file", f);
            if (filters.category) formData.append("category", filters.category);
            if (filters.owner_tenant) formData.append("owner_tenant_id", filters.owner_tenant);
            const res = await uploadMediaAction(null, formData);
            clearInterval(timer);
            setUploads((prev) => {
              const copy = prev.slice();
              const idx = copy.findIndex((u) => u.id === id);
              if (idx === -1) return prev;
              const cur = copy[idx];
              if (!cur) return prev;
              if (res.ok) {
                copy[idx] = {
                  id: cur.id,
                  fileName: cur.fileName,
                  fileSize: cur.fileSize,
                  status: "done",
                  progress: 100,
                  error: cur.error,
                  media: res.media,
                  _timer: undefined,
                };
              } else {
                copy[idx] = {
                  id: cur.id,
                  fileName: cur.fileName,
                  fileSize: cur.fileSize,
                  status: "error",
                  progress: 0,
                  error: res.error,
                  media: cur.media,
                  _timer: undefined,
                };
              }
              return copy;
            });
            if (res.ok) {
              setRows((prev) => [res.media, ...prev]);
              setTotalCount((c) => c + 1);
            }
          } catch (e) {
            clearInterval(timer);
            setUploads((prev) => {
              const copy = prev.slice();
              const idx = copy.findIndex((u) => u.id === id);
              if (idx === -1) return prev;
              const cur = copy[idx];
              if (!cur) return prev;
              copy[idx] = {
                id: cur.id,
                fileName: cur.fileName,
                fileSize: cur.fileSize,
                status: "error",
                progress: 0,
                error: e instanceof Error ? e.message : "Errore sconosciuto",
                media: cur.media,
                _timer: undefined,
              };
              return copy;
            });
          }
        })();
      }
      if (newItems.length > 0) {
        setUploads((prev) => [...prev, ...newItems]);
        setTimeout(() => {
          setUploads((prev) =>
            prev.filter((u) => {
              if (u.status !== "done" && u.status !== "error") return true;
              const createdTs = parseInt(u.id.split("-")[0] ?? "0", 10);
              return Date.now() - createdTs < 60000;
            }),
          );
        }, 15000);
      }
    },
    [filters.category, filters.owner_tenant],
  );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  }

  function triggerSelect() {
    fileInputRef.current?.click();
  }

  const sortedRows = useMemo(() => {
    const r = rows.slice();
    switch (filters.sort) {
      case "size_desc":
        r.sort((a, b) => b.file_size_bytes - a.file_size_bytes);
        break;
      case "filename_asc":
        r.sort((a, b) => a.filename_orig.localeCompare(b.filename_orig));
        break;
      case "created_desc":
      default:
        r.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
    }
    return r;
  }, [rows, filters.sort]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm sticky top-0 z-20">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
              >
                {currentCount} file
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5 lg:col-span-2">
              <label htmlFor="m-search" className="block text-xs font-medium text-zinc-700">
                Cerca
              </label>
              <input
                id="m-search"
                type="search"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Cerca per nome file o descrizione..."
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="m-category" className="block text-xs font-medium text-zinc-700">
                Categoria
              </label>
              <select
                id="m-category"
                value={filters.category}
                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Tutte le categorie</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="m-mime" className="block text-xs font-medium text-zinc-700">
                Tipo file
              </label>
              <select
                id="m-mime"
                value={filters.mime}
                onChange={(e) => setFilters({ ...filters, mime: e.target.value })}
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {MIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="m-sort" className="block text-xs font-medium text-zinc-700">
                Ordinamento
              </label>
              <select
                id="m-sort"
                value={filters.sort}
                onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="m-owner" className="block text-xs font-medium text-zinc-700">
                Owner Tenant ID (opzionale)
              </label>
              <input
                id="m-owner"
                type="text"
                value={filters.owner_tenant}
                onChange={(e) => setFilters({ ...filters, owner_tenant: e.target.value })}
                placeholder="UUID tenant (es. 550e8400-e29b-41d4-a716-446655440000)"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-start sm:justify-end">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Applica filtri
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div
          role="button"
          tabIndex={0}
          onClick={triggerSelect}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              triggerSelect();
            }
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`w-full min-h-[140px] flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-6 cursor-pointer transition-colors ${
            dragOver
              ? "border-indigo-400 bg-indigo-50/50"
              : "border-zinc-300 hover:border-indigo-300 hover:bg-zinc-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={Array.from(mimeOptions).join(",")}
            onChange={onInputChange}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Trascina file qui o clicca per selezionare
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                PNG, JPEG, WebP, AVIF, GIF, PDF · max {MAX_FILE_BYTES / (1024 * 1024)} MB per file
              </div>
            </div>
          </div>
        </div>

        {inlineError ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {inlineError}
          </div>
        ) : null}

        {uploads.length > 0 ? (
          <div className="mt-4 space-y-2">
            {uploads.map((u) => (
              <div
                key={u.id}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  u.status === "error"
                    ? "border-rose-200 bg-rose-50/50"
                    : u.status === "done"
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-zinc-200 bg-white"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 truncate">{u.fileName}</span>
                    <span className="text-xs text-zinc-500 flex-shrink-0">
                      {bytesToSize(u.fileSize)}
                    </span>
                    <span
                      className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        u.status === "uploading"
                          ? "bg-indigo-100 text-indigo-700"
                          : u.status === "done"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {u.status === "uploading"
                        ? "Uploading"
                        : u.status === "done"
                          ? "Fatto"
                          : "Errore"}
                    </span>
                  </div>
                  {u.status === "uploading" ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full bg-indigo-600 transition-all duration-200"
                        style={{ width: `${u.progress}%` }}
                      />
                    </div>
                  ) : null}
                  {u.status === "error" && u.error ? (
                    <p className="mt-1 text-xs text-rose-600">{u.error}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {sortedRows.length === 0 ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-10 sm:p-14 shadow-sm text-center">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 ring-1 ring-inset ring-zinc-200">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8 text-zinc-400"
              aria-hidden
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-zinc-900">Nessun file caricato</h3>
          <p className="mt-2 max-w-md mx-auto text-sm text-zinc-500">
            Trascina immagini o documenti sopra nell&apos;area tratteggiata, oppure clicca per
            selezionare i file dal tuo dispositivo.
          </p>
        </section>
      ) : (
        <section
          aria-label="Griglia media"
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3"
        >
          {sortedRows.map((media) => (
            <button
              key={media.id}
              type="button"
              onClick={() => openDetail(media)}
              aria-label={`Apri dettaglio ${media.filename_orig}`}
              className="appearance-none text-left group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm hover:shadow-md hover:border-zinc-300 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 p-0"
            >
              <div className="aspect-square w-full bg-zinc-100 overflow-hidden">
                {isImageMime(media.mime_type) ? (
                  <ImageThumb media={media} />
                ) : (
                  <PlaceholderThumb mime={media.mime_type} />
                )}
              </div>
              <div className="p-3 space-y-2">
                <div>
                  <div
                    className="text-sm font-medium text-zinc-900 line-clamp-2 break-all"
                    title={media.filename_orig}
                  >
                    {media.filename_orig}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <CategoryBadge category={media.category} />
                  <MimeBadge mime={media.mime_type} />
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <div className="flex items-center gap-2">
                    {media.width_px && media.height_px ? (
                      <span className="font-mono text-[11px]">
                        {media.width_px}×{media.height_px}
                      </span>
                    ) : null}
                    <span>{bytesToSize(media.file_size_bytes)}</span>
                  </div>
                  <span title={media.created_at}>{timeAgo(media.created_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </section>
      )}

      <MediaDetailDialog
        key={selectedMedia?.id ?? "empty"}
        open={dialogOpen}
        media={selectedMedia}
        onClose={() => {
          setDialogOpen(false);
          setSelectedMedia(null);
        }}
        onRefresh={onDetailChanged}
        categories={categories}
      />
    </div>
  );
}
