"use client";

import { useEffect, useState } from "react";
import { updateMediaMetadataAction, deleteMediaAction, associateMediaAction } from "../actions";
import { bytesToSize, isImageMime, MEDIA_STATUSES, MEDIA_ASSOCIATION_TYPES } from "../lib";
import type { MediaLibraryRow, MediaCategory, MediaStatus, MediaAssociationType } from "../lib";

const CATEGORY_LABEL: Record<string, string> = {
  immagine_generica: "Immagine generica",
  servizio: "Servizio",
  staff: "Staff",
  gallery: "Gallery",
  hero: "Hero",
  logo: "Logo",
  sfondo: "Sfondo",
  documento: "Documento",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Bozza",
  published: "Pubblicato",
  archived: "Archiviato",
};

const ASSOC_LABEL: Record<string, string> = {
  servizio: "Servizio",
  staff: "Staff",
  gallery_item: "Gallery Item",
  hero_slide: "Hero Slide",
  sezione_sito: "Sezione Sito",
  business_logo: "Logo Business",
  business_sfondo: "Sfondo Business",
  prospetto_foto: "Foto Prospetto",
};

type TabKey = "dettagli" | "associazioni";

function PlaceholderPreview({ mime }: { mime: string }) {
  const isPdf = mime === "application/pdf";
  const label = isPdf ? "PDF" : "IMG";
  const gradient = isPdf
    ? "from-rose-400 via-rose-500 to-red-600"
    : "from-indigo-400 via-purple-500 to-pink-500";
  return (
    <div
      className={`w-full min-h-[300px] h-full flex items-center justify-center bg-gradient-to-br ${gradient} rounded-lg`}
    >
      <span className="text-white text-5xl font-bold tracking-widest drop-shadow-lg">{label}</span>
    </div>
  );
}

function ImagePreview({ media }: { media: MediaLibraryRow }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <PlaceholderPreview mime={media.mime_type} />;
  const short = media.stored_path;
  const url = `https://media.velora.test/placeholder/${encodeURIComponent(short)}`;
  return (
    <div className="w-full min-h-[300px] flex items-center justify-center bg-zinc-100 rounded-lg overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={media.alt_text ?? media.filename_orig}
        onError={() => setErrored(true)}
        className="max-w-full max-h-[500px] object-contain"
      />
    </div>
  );
}

type FakeAssoc = {
  id: string;
  association_type: string;
  assoc_key_id: string;
  tenant_id: string | null;
  ordine: number;
};

function initStr(v: string | null | undefined): string {
  return v ?? "";
}

export default function MediaDetailDialog({
  open,
  media,
  onClose,
  onRefresh,
  categories,
}: {
  open: boolean;
  media: MediaLibraryRow | null;
  onClose: () => void;
  onRefresh: () => void;
  categories: readonly string[];
}) {
  const [tab, setTab] = useState<TabKey>("dettagli");
  const [altText, setAltText] = useState<string>(() => initStr(media?.alt_text));
  const [caption, setCaption] = useState<string>(() => initStr(media?.caption));
  const [category, setCategory] = useState<string>(() => initStr(media?.category));
  const [status, setStatus] = useState<string>(() => initStr(media?.status));
  const [ownerTenant, setOwnerTenant] = useState<string>(() => initStr(media?.owner_tenant_id));
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [assocs, setAssocs] = useState<FakeAssoc[]>([]);
  const [newAssocType, setNewAssocType] = useState<string>(MEDIA_ASSOCIATION_TYPES[0]);
  const [newAssocKeyId, setNewAssocKeyId] = useState<string>("");
  const [newAssocTenant, setNewAssocTenant] = useState<string>("");
  const [assocPending, setAssocPending] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    if (open) {
      window.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  async function handleSave() {
    if (!media) return;
    setSavePending(true);
    setBanner(null);
    try {
      const patch: {
        alt_text: string | null;
        caption: string | null;
        category?: MediaCategory;
        status?: MediaStatus;
        owner_tenant_id: string | null;
      } = {
        alt_text: altText.trim() || null,
        caption: caption.trim() || null,
        owner_tenant_id: ownerTenant.trim() || null,
      };
      if (categories.includes(category)) patch.category = category as MediaCategory;
      if (status === "draft" || status === "published" || status === "archived") {
        patch.status = status as MediaStatus;
      }
      const res = await updateMediaMetadataAction(media.id, patch);
      if (res.ok) {
        setBanner({ type: "success", message: "Modifiche salvate con successo." });
        setTimeout(() => onRefresh(), 300);
      } else {
        setBanner({ type: "error", message: res.error ?? "Errore durante il salvataggio." });
      }
    } catch (e) {
      setBanner({
        type: "error",
        message: e instanceof Error ? e.message : "Errore sconosciuto.",
      });
    } finally {
      setSavePending(false);
    }
  }

  async function handleDelete() {
    if (!media) return;
    setDeletePending(true);
    setBanner(null);
    try {
      const res = await deleteMediaAction(media.id);
      if (res.ok) {
        setBanner({ type: "success", message: "File eliminato." });
        setTimeout(() => {
          onClose();
          onRefresh();
        }, 500);
      } else {
        setBanner({ type: "error", message: res.error ?? "Errore durante l'eliminazione." });
      }
    } catch (e) {
      setBanner({
        type: "error",
        message: e instanceof Error ? e.message : "Errore sconosciuto.",
      });
    } finally {
      setDeletePending(false);
      setConfirmDelete(false);
    }
  }

  async function handleAddAssoc() {
    if (!media) return;
    if (!newAssocKeyId.trim()) {
      setBanner({ type: "error", message: "Inserisci assoc_key_id." });
      return;
    }
    setAssocPending(true);
    setBanner(null);
    try {
      const assocType = newAssocType as MediaAssociationType;
      const res = await associateMediaAction({
        media_id: media.id,
        association_type: assocType,
        assoc_key_id: newAssocKeyId.trim(),
        tenant_id: newAssocTenant.trim() || null,
        ordine: assocs.length,
      });
      if (res.ok) {
        setAssocs((prev) => [
          {
            id: res.id ?? `local-${Date.now()}`,
            association_type: newAssocType,
            assoc_key_id: newAssocKeyId.trim(),
            tenant_id: newAssocTenant.trim() || null,
            ordine: assocs.length,
          },
          ...prev,
        ]);
        setNewAssocKeyId("");
        setBanner({ type: "success", message: "Associazione aggiunta." });
      } else {
        setBanner({ type: "error", message: res.error ?? "Errore associazione." });
      }
    } catch (e) {
      setBanner({
        type: "error",
        message: e instanceof Error ? e.message : "Errore sconosciuto.",
      });
    } finally {
      setAssocPending(false);
    }
  }

  if (!open || !media) return null;

  const checksumShort = media.checksum_sha256
    ? `${media.checksum_sha256.slice(0, 8)}…${media.checksum_sha256.slice(-6)}`
    : "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4 py-6"
    >
      <div className="w-full max-w-5xl rounded-xl border border-zinc-200 bg-white shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="border-b border-zinc-100 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="media-detail-title"
              className="text-base font-semibold text-zinc-900 truncate"
              title={media.filename_orig}
            >
              {media.filename_orig}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px]">ID: {media.id.slice(0, 8)}…</span>
              {media.owner_tenant_id ? (
                <span title={media.owner_tenant_id} className="font-mono text-[11px]">
                  owner: {media.owner_tenant_id.slice(0, 8)}…
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 flex-shrink-0"
            aria-label="Chiudi"
          >
            <span aria-hidden className="text-xl leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="border-b border-zinc-100 px-6 flex gap-1">
          <button
            type="button"
            onClick={() => setTab("dettagli")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "dettagli"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-zinc-600 hover:text-zinc-900"
            }`}
          >
            Dettagli
          </button>
          <button
            type="button"
            onClick={() => setTab("associazioni")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "associazioni"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-zinc-600 hover:text-zinc-900"
            }`}
          >
            Associazioni ({assocs.length})
          </button>
        </div>

        {banner ? (
          <div
            role="alert"
            className={`mx-6 mt-4 rounded-md border p-3 text-sm ${
              banner.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            <div className="font-medium">
              {banner.type === "success" ? "Operazione completata" : "Errore"}
            </div>
            <div className="mt-0.5 text-xs opacity-90">{banner.message}</div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "dettagli" ? (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-5">
                <div>
                  <p className="block text-xs font-medium text-zinc-700 mb-1.5">Anteprima</p>
                  {isImageMime(media.mime_type) ? (
                    <ImagePreview media={media} />
                  ) : (
                    <PlaceholderPreview mime={media.mime_type} />
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="md-alt" className="block text-sm font-medium text-zinc-800">
                      Alt text (accessibilità)
                    </label>
                    <input
                      id="md-alt"
                      type="text"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      placeholder="Descrizione breve per screen reader..."
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="md-caption" className="block text-sm font-medium text-zinc-800">
                      Caption / didascalia
                    </label>
                    <textarea
                      id="md-caption"
                      rows={3}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Didascalia estesa opzionale..."
                      className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-y"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                <dl className="rounded-lg border border-zinc-200 bg-zinc-50/50 divide-y divide-zinc-100">
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      MIME
                    </dt>
                    <dd className="text-xs font-mono text-zinc-800 break-all">{media.mime_type}</dd>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Dimensione
                    </dt>
                    <dd className="text-sm font-medium text-zinc-800">
                      {bytesToSize(media.file_size_bytes)}
                    </dd>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Risoluzione
                    </dt>
                    <dd className="text-sm font-mono text-zinc-800">
                      {media.width_px && media.height_px
                        ? `${media.width_px} × ${media.height_px} px`
                        : "—"}
                    </dd>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      SHA-256
                    </dt>
                    <dd
                      className="text-xs font-mono text-zinc-800 break-all"
                      title={media.checksum_sha256 ?? ""}
                    >
                      {checksumShort}
                    </dd>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Created By
                    </dt>
                    <dd
                      className="text-xs font-mono text-zinc-800 break-all"
                      title={media.created_by}
                    >
                      {media.created_by.slice(0, 8)}…
                    </dd>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2">
                    <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Caricato il
                    </dt>
                    <dd className="text-sm text-zinc-800">
                      {new Date(media.created_at).toLocaleString("it-IT", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                </dl>

                <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="md-category"
                      className="block text-sm font-medium text-zinc-800"
                    >
                      Categoria
                    </label>
                    <select
                      id="md-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c] ?? c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="md-status" className="block text-sm font-medium text-zinc-800">
                      Stato
                    </label>
                    <select
                      id="md-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {MEDIA_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s] ?? s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="md-owner" className="block text-sm font-medium text-zinc-800">
                      Owner Tenant ID
                    </label>
                    <input
                      id="md-owner"
                      type="text"
                      value={ownerTenant}
                      onChange={(e) => setOwnerTenant(e.target.value)}
                      placeholder="UUID (opzionale)"
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-xs font-mono text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900">Aggiungi nuova associazione</h3>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4 space-y-1.5">
                    <label htmlFor="ma-type" className="block text-xs font-medium text-zinc-700">
                      Tipo
                    </label>
                    <select
                      id="ma-type"
                      value={newAssocType}
                      onChange={(e) => setNewAssocType(e.target.value)}
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {MEDIA_ASSOCIATION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ASSOC_LABEL[t] ?? t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-6 space-y-1.5">
                    <label htmlFor="ma-keyid" className="block text-xs font-medium text-zinc-700">
                      Assoc Key ID
                    </label>
                    <input
                      id="ma-keyid"
                      type="text"
                      value={newAssocKeyId}
                      onChange={(e) => setNewAssocKeyId(e.target.value)}
                      placeholder="UUID o chiave..."
                      className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1.5 flex items-end">
                    <button
                      type="button"
                      onClick={handleAddAssoc}
                      disabled={assocPending}
                      className="w-full h-10 inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
                    >
                      {assocPending ? "…" : "Aggiungi"}
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-12 space-y-1.5">
                  <label htmlFor="ma-tenant" className="block text-xs font-medium text-zinc-700">
                    Tenant ID (opzionale)
                  </label>
                  <input
                    id="ma-tenant"
                    type="text"
                    value={newAssocTenant}
                    onChange={(e) => setNewAssocTenant(e.target.value)}
                    placeholder="UUID tenant proprietario..."
                    className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-xs font-mono text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                </div>
              </div>

              <div
                aria-label="Lista associazioni"
                className="rounded-xl border border-zinc-200 bg-white overflow-hidden"
              >
                {assocs.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm text-zinc-500">
                      Nessuna associazione. Aggiungi la prima dal form sopra.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 text-sm">
                      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
                            Tipo
                          </th>
                          <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">
                            Key ID
                          </th>
                          <th className="hidden sm:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap">
                            Tenant
                          </th>
                          <th className="hidden md:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap">
                            Ordine
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {assocs.map((a) => (
                          <tr key={a.id} className="hover:bg-zinc-50/70">
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                                {ASSOC_LABEL[a.association_type] ?? a.association_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-zinc-800 break-all">
                              {a.assoc_key_id}
                            </td>
                            <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-zinc-500">
                              {a.tenant_id ? `${a.tenant_id.slice(0, 8)}…` : "—"}
                            </td>
                            <td className="hidden md:table-cell px-4 py-3 text-zinc-600">
                              #{a.ordine}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 bg-zinc-50/50 px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1">
            {tab === "dettagli" && confirmDelete ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <div className="font-medium">Conferma eliminazione?</div>
                <div className="mt-0.5 text-xs opacity-90">
                  Il file verrà rimosso dallo storage e dal database. Azione irreversibile.
                </div>
              </div>
            ) : tab === "dettagli" ? (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 h-10 w-full sm:w-auto"
                onClick={() => alert("Picker multiuso non ancora disponibile (T12).")}
              >
                Usa come…
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            {tab === "dettagli" ? (
              confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deletePending}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-60"
                  >
                    {deletePending ? "Eliminazione…" : "Sì, elimina"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={deletePending}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-rose-200 bg-white px-4 text-sm font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    Elimina
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={savePending}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
                  >
                    {savePending ? "Salvataggio…" : "Salva modifiche"}
                  </button>
                </>
              )
            ) : null}
            {tab !== "dettagli" ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Chiudi
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
