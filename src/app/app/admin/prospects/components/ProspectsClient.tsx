"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createProspectAction,
  updateProspectAction,
  type ProspectActionState,
  type ProspectRow,
} from "../actions";

const PROSPECT_STATUSES = [
  "mai_contattato",
  "da_chiamare",
  "chiamato",
  "richiamare",
  "interessato",
  "cliente",
  "non_interessato",
  "non_contattare",
] as const;

type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

const STATUS_LABEL: Record<ProspectStatus, string> = {
  mai_contattato: "Mai contattato",
  da_chiamare: "Da chiamare",
  chiamato: "Chiamato",
  richiamare: "Richiamare",
  interessato: "Interessato",
  cliente: "Cliente",
  non_interessato: "Non interessato",
  non_contattare: "Non contattare",
};

const STATUS_STYLES: Record<ProspectStatus, string> = {
  mai_contattato: "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200",
  da_chiamare: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  chiamato: "bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200",
  richiamare: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  interessato: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  cliente: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
  non_interessato: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-300",
  non_contattare: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
};

const STATUS_DOT: Record<ProspectStatus, string> = {
  mai_contattato: "bg-zinc-400",
  da_chiamare: "bg-sky-500",
  chiamato: "bg-slate-400",
  richiamare: "bg-amber-500",
  interessato: "bg-emerald-500",
  cliente: "bg-purple-600",
  non_interessato: "bg-neutral-500",
  non_contattare: "bg-rose-600",
};

function StatusBadge({ status }: { status: string }) {
  const s = (PROSPECT_STATUSES as ReadonlyArray<string>).includes(status)
    ? (status as ProspectStatus)
    : "mai_contattato";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s]}`}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />
      {STATUS_LABEL[s]}
    </span>
  );
}

function Input(props: {
  id: string;
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  error?: string[];
}) {
  const { id, label, error, ...rest } = props;
  const invalid = Boolean(error?.length);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
        {rest.required && (
          <span aria-hidden className="ml-1 text-rose-600">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:bg-zinc-50 disabled:text-zinc-500"
        {...rest}
      />
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-rose-600">
          {error!.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function Textarea(props: {
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="block text-sm font-medium text-zinc-800">
        {props.label}
        {props.required && (
          <span aria-hidden className="ml-1 text-rose-600">
            *
          </span>
        )}
      </label>
      <textarea
        id={props.id}
        name={props.name}
        rows={props.rows ?? 3}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        required={props.required}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-y"
      />
    </div>
  );
}

function NewProspectDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (id: string) => void;
}) {
  const [state, dispatch, pending] = useActionState<ProspectActionState | null, FormData>(
    createProspectAction as unknown as (
      state: ProspectActionState | null,
      payload: FormData,
    ) => ProspectActionState | Promise<ProspectActionState>,
    null,
  );

  useEffect(() => {
    if (state && state.ok && state.prospect_id) {
      onSuccess(state.prospect_id);
    }
  }, [state, onSuccess]);

  if (!open) return null;

  const hasDuplicate = state && !state.ok && state.duplicate;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-prospect-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 py-6"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        <form action={dispatch as never} className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="new-prospect-title" className="text-base font-semibold text-zinc-900">
                Nuovo prospetto
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Inserisci i dati dell&apos;attività locale da aggiungere al CRM.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Chiudi"
            >
              ×
            </button>
          </div>

          <Input
            id="p-business_name"
            label="Nome attività"
            name="business_name"
            placeholder="es. Parco Bellezza srl"
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="p-business_category"
                className="block text-sm font-medium text-zinc-800"
              >
                Categoria
              </label>
              <input
                id="p-business_category"
                name="business_category"
                type="text"
                placeholder="es. Parrucchiere"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>
            <Input id="p-comune" label="Comune" name="comune" placeholder="es. Milano" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="p-telefono"
              label="Telefono"
              name="telefono"
              type="tel"
              placeholder="+39 02 1234567"
            />
            <Input
              id="p-email"
              label="Email"
              name="email"
              type="email"
              placeholder="info@example.test"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 pt-6">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="sito_web"
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-zinc-800">Ha già un sito web</span>
              </label>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="p-sito_quality_score"
                className="block text-sm font-medium text-zinc-800"
              >
                Qualità sito (0-10)
              </label>
              <select
                id="p-sito_quality_score"
                name="sito_quality_score"
                defaultValue=""
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Non valutato</option>
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            id="p-gmb_url"
            label="URL Google Business"
            name="gmb_url"
            type="url"
            placeholder="https://maps.google.com/..."
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="p-status" className="block text-sm font-medium text-zinc-800">
                Stato iniziale
              </label>
              <select
                id="p-status"
                name="status"
                defaultValue="mai_contattato"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {PROSPECT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="p-assigned_to" className="block text-sm font-medium text-zinc-800">
                Assegnato a
              </label>
              <select
                id="p-assigned_to"
                name="assigned_to"
                defaultValue=""
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Non assegnato</option>
              </select>
            </div>
          </div>

          <Textarea
            id="p-note"
            label="Note"
            name="note"
            rows={3}
            placeholder="Appunti, fonti, dettagli utili…"
          />

          {hasDuplicate ? (
            <div
              role="alert"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            >
              <div className="font-medium">Prospetto già presente</div>
              <div className="mt-1">
                Esiste già un prospetto con lo stesso nome attività e telefono. Prova a modificare
                quello esistente.
              </div>
            </div>
          ) : null}

          {state && !state.ok && !state.duplicate ? (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
            >
              <div className="font-medium">Errore durante la creazione</div>
              <div className="mt-1">{state.error}</div>
            </div>
          ) : null}

          {state && state.ok ? (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              <div className="font-medium">Prospetto creato.</div>
              <div className="mt-1">
                <Link
                  href={`/app/admin/prospects/${state.prospect_id}`}
                  className="underline underline-offset-2 hover:text-emerald-900"
                >
                  Apri dettaglio
                </Link>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              disabled={pending}
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? "Creazione in corso…" : "Crea prospetto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type FilterFormState = {
  q: string;
  status: string;
  categoria: string;
  comune: string;
  assigned_to: string;
  solo_prossimi_7gg: boolean;
};

function formatDateShort(it: string | null | undefined): string {
  if (!it) return "—";
  try {
    const d = new Date(it);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function InlineStatusSelect({
  prospectId,
  currentStatus,
  onChanged,
}: {
  prospectId: string;
  currentStatus: string;
  onChanged: () => void;
}) {
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setOptimisticStatus(next);
    setLoading(true);
    let ok = false;
    try {
      const res = await updateProspectAction(prospectId, { status: next as ProspectStatus });
      ok = res.ok;
      if (ok) {
        onChanged();
      }
    } catch {
      ok = false;
    } finally {
      setOptimisticStatus(null);
      setLoading(false);
      if (!ok) {
        // ensure reset to server state
        void 0;
      }
    }
  }

  return (
    <select
      value={optimisticStatus ?? currentStatus}
      onChange={handleChange}
      disabled={loading}
      className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-800 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
    >
      {PROSPECT_STATUSES.map((st) => (
        <option key={st} value={st}>
          {STATUS_LABEL[st]}
        </option>
      ))}
    </select>
  );
}

export default function ProspectsClient({
  initialRows,
  count,
}: {
  initialRows: ProspectRow[];
  count: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialFilters: FilterFormState = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      categoria: searchParams.get("categoria") ?? "",
      comune: searchParams.get("comune") ?? "",
      assigned_to: searchParams.get("assigned_to") ?? "",
      solo_prossimi_7gg:
        searchParams.get("solo_prossimi_7gg") === "1" ||
        searchParams.get("solo_prossimi_7gg") === "true",
    }),
    [searchParams],
  );

  const [filters, setFilters] = useState<FilterFormState>(initialFilters);
  const rows = initialRows;
  const totalCount = count;
  const [dialogOpen, setDialogOpen] = useState(false);

  const uniqueCategorie = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.business_category && r.business_category.trim()) {
        set.add(r.business_category.trim());
      }
    });
    return Array.from(set).sort();
  }, [rows]);

  const uniqueComuni = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.comune && r.comune.trim()) {
        set.add(r.comune.trim());
      }
    });
    return Array.from(set).sort();
  }, [rows]);

  function applyFilters() {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.status) params.set("status", filters.status);
    if (filters.categoria) params.set("categoria", filters.categoria);
    if (filters.comune) params.set("comune", filters.comune);
    if (filters.assigned_to) params.set("assigned_to", filters.assigned_to);
    if (filters.solo_prossimi_7gg) params.set("solo_prossimi_7gg", "1");
    const qs = params.toString();
    router.push(qs ? `/app/admin/prospects?${qs}` : "/app/admin/prospects");
    router.refresh();
  }

  function resetFilters() {
    setFilters({
      q: "",
      status: "",
      categoria: "",
      comune: "",
      assigned_to: "",
      solo_prossimi_7gg: false,
    });
    router.push("/app/admin/prospects");
    router.refresh();
  }

  function onStatusChanged() {
    router.refresh();
  }

  function onProspectCreated(_id: string) {
    setDialogOpen(false);
    setFilters({
      q: "",
      status: "",
      categoria: "",
      comune: "",
      assigned_to: "",
      solo_prossimi_7gg: false,
    });
    setTimeout(() => {
      router.push("/app/admin/prospects");
      router.refresh();
    }, 100);
  }

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
                {totalCount} prospetti
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Nuovo prospetto
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5 lg:col-span-2">
              <label htmlFor="f-q" className="block text-xs font-medium text-zinc-700">
                Cerca
              </label>
              <input
                id="f-q"
                type="search"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Nome, telefono, email, comune…"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="f-status" className="block text-xs font-medium text-zinc-700">
                Stato
              </label>
              <select
                id="f-status"
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Tutti gli stati</option>
                {PROSPECT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="f-categoria" className="block text-xs font-medium text-zinc-700">
                Categoria
              </label>
              <input
                id="f-categoria"
                type="text"
                value={filters.categoria}
                onChange={(e) => setFilters({ ...filters, categoria: e.target.value })}
                placeholder="es. Parrucchiere"
                list="cat-list"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
              <datalist id="cat-list">
                {uniqueCategorie.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="f-comune" className="block text-xs font-medium text-zinc-700">
                Comune
              </label>
              <input
                id="f-comune"
                type="text"
                value={filters.comune}
                onChange={(e) => setFilters({ ...filters, comune: e.target.value })}
                placeholder="es. Roma"
                list="com-list"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
              <datalist id="com-list">
                {uniqueComuni.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="space-y-1.5">
              <label htmlFor="f-assigned" className="block text-xs font-medium text-zinc-700">
                Assegnato a
              </label>
              <select
                id="f-assigned"
                value={filters.assigned_to}
                onChange={(e) => setFilters({ ...filters, assigned_to: e.target.value })}
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="">Tutti</option>
                <option value="">Non assegnato</option>
              </select>
            </div>

            <div className="lg:col-span-2 sm:col-span-1">
              <label className="inline-flex items-center gap-2 cursor-pointer h-10">
                <input
                  type="checkbox"
                  checked={filters.solo_prossimi_7gg}
                  onChange={(e) => setFilters({ ...filters, solo_prossimi_7gg: e.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-zinc-800">
                  Solo prossimi 7 giorni (prossimo contatto)
                </span>
              </label>
            </div>

            <div className="flex gap-2 lg:col-span-2 sm:col-span-2 justify-start sm:justify-end">
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
        </div>
      </section>

      <section
        aria-label="Lista prospetti"
        className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Nome Attività
                </th>
                <th
                  scope="col"
                  className="hidden sm:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Categoria
                </th>
                <th
                  scope="col"
                  className="hidden md:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Comune
                </th>
                <th
                  scope="col"
                  className="hidden lg:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Telefono
                </th>
                <th
                  scope="col"
                  className="hidden xl:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Email
                </th>
                <th
                  scope="col"
                  className="hidden xl:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Sito
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold whitespace-nowrap">
                  Stato
                </th>
                <th
                  scope="col"
                  className="hidden md:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Prossimo contatto
                </th>
                <th
                  scope="col"
                  className="hidden lg:table-cell px-4 py-3 text-left font-semibold whitespace-nowrap"
                >
                  Promosso
                </th>
                <th
                  scope="col"
                  className="px-4 sm:px-6 py-3 text-right font-semibold whitespace-nowrap"
                >
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-10 text-center text-sm text-zinc-500">
                    Nessun prospetto trovato.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/70">
                    <td className="px-4 sm:px-6 py-3">
                      <div className="font-medium text-zinc-900">{r.business_name}</div>
                      <div className="sm:hidden mt-1 flex flex-wrap gap-1.5 text-xs text-zinc-500">
                        {r.business_category ? (
                          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
                            {r.business_category}
                          </span>
                        ) : null}
                        {r.comune ? <span>📍 {r.comune}</span> : null}
                        {r.telefono ? <span>📞 {r.telefono}</span> : null}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-zinc-700">
                      {r.business_category ? (
                        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                          {r.business_category}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-zinc-700">
                      {r.comune || <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-zinc-700">
                      {r.telefono ? (
                        <a
                          href={`tel:${r.telefono}`}
                          className="text-zinc-700 hover:text-indigo-600 hover:underline"
                        >
                          {r.telefono}
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 text-zinc-700">
                      {r.email ? (
                        <a
                          href={`mailto:${r.email}`}
                          className="text-zinc-700 hover:text-indigo-600 hover:underline truncate max-w-[180px] inline-block align-bottom"
                        >
                          {r.email}
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 text-zinc-700">
                      {r.sito_web ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-emerald-600 text-xs font-medium">Sì</span>
                          {typeof r.sito_quality_score === "number" ? (
                            <span className="text-xs text-zinc-500">
                              QS: {r.sito_quality_score}/10
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={r.status} />
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-zinc-600 text-xs">
                      {formatDateShort(r.prossimo_contatto_at)}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3">
                      {r.promoted_to_tenant_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <span
                            aria-hidden
                            className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                          />
                          Sì
                        </span>
                      ) : (
                        <span className="text-zinc-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-right">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                        <InlineStatusSelect
                          prospectId={r.id}
                          currentStatus={r.status}
                          onChanged={onStatusChanged}
                        />
                        <Link
                          href={`/app/admin/prospects/${r.id}`}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          Dettaglio
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <NewProspectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={onProspectCreated}
      />
    </div>
  );
}
