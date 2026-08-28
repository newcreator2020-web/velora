"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createCustomerAction } from "../actions";
import type { ProvisionCustomerResult } from "../actions";
import { slugFromBusinessName } from "@/lib/utils";
import { PLAN_IDS, planLabel, statusLabel } from "@/lib/platform-constants";

function Input(props: {
  id: string;
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  error?: string[];
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
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

function NewCustomerDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (slug: string) => void;
}) {
  const [state, dispatch, pending] = useActionState<ProvisionCustomerResult | null, FormData>(
    createCustomerAction as unknown as (
      state: ProvisionCustomerResult | null,
      payload: FormData,
    ) => ProvisionCustomerResult | Promise<ProvisionCustomerResult>,
    null,
  );
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (state && state.ok) {
      onSuccess(state.slug);
    }
  }, [state, onSuccess]);

  if (!open) return null;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-customer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 py-6"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl">
        <form action={dispatch as never} className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="new-customer-title" className="text-base font-semibold text-zinc-900">
                Nuovo cliente
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                I campi minimi per il provisioning iniziale.
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
            id="f-businessName"
            label="Nome attività"
            name="businessName"
            placeholder="es. Studio Aurora"
            defaultValue={businessName}
            required
            onChange={(e) => {
              const next = e.target.value;
              setBusinessName(next);
              if (!slugEdited) {
                setSlug(slugFromBusinessName(next || ""));
              }
            }}
            {...(fieldErrors?.["businessName"] ? { error: fieldErrors["businessName"] } : {})}
          />

          <Input
            id="f-ownerEmail"
            label="Email titolare"
            name="ownerEmail"
            type="email"
            placeholder="titolarestudio@example.test"
            required
            {...(fieldErrors?.["ownerEmail"] ? { error: fieldErrors["ownerEmail"] } : {})}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="f-slug"
              label="Slug"
              name="slug"
              placeholder="studio-aurora"
              defaultValue={slug}
              required
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              {...(fieldErrors?.["slug"] ? { error: fieldErrors["slug"] } : {})}
            />
            <div className="space-y-1.5">
              <label htmlFor="f-plan" className="block text-sm font-medium text-zinc-800">
                Piano
                <span aria-hidden className="ml-1 text-rose-600">
                  *
                </span>
              </label>
              <select
                id="f-plan"
                name="plan"
                defaultValue="base"
                className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {PLAN_IDS.map((p: (typeof PLAN_IDS)[number]) => (
                  <option key={p} value={p}>
                    {planLabel(p)}
                  </option>
                ))}
              </select>
              {fieldErrors?.["plan"] ? (
                <p role="alert" className="text-xs text-rose-600">
                  {fieldErrors["plan"]!.join(" ")}
                </p>
              ) : null}
            </div>
          </div>

          <input name="idempotencyKey" type="hidden" aria-hidden defaultValue={idempotencyKey} />

          {state && !state.ok ? (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
            >
              <div className="font-medium">Non siamo riusciti a creare il cliente.</div>
              <div className="mt-1">{state.message}</div>
            </div>
          ) : null}
          {state && state.ok ? (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              <div className="font-medium">Cliente creato.</div>
              <div className="mt-1">
                <Link
                  href={`/app/admin/clients/${state.slug}`}
                  className="underline underline-offset-2 hover:text-emerald-900"
                >
                  Apri {state.name || state.slug}
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
              {pending ? "Creazione in corso…" : "Crea cliente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClientsClient({
  initialRows,
}: {
  initialRows: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_id: string;
    created_at: string;
    owner: { profile_display_name: string | null; profile_email_hint: string | null } | null;
  }>;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL("/app/admin/clients/search", window.location.origin);
      url.searchParams.set("q", search);
      const r = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (cancelled || !r.ok) return;
      const json = (await r.json()) as typeof initialRows;
      setRows(json);
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex-1 max-w-md space-y-1.5">
            <label htmlFor="search" className="block text-sm font-medium text-zinc-800">
              Cerca clienti
            </label>
            <input
              id="search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome attività o slug…"
              className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Nuovo cliente
          </button>
        </div>
      </section>

      <section
        aria-label="Lista clienti"
        className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 sm:px-6 py-3 text-left font-semibold">
                  Attività
                </th>
                <th scope="col" className="hidden md:table-cell px-4 py-3 text-left font-semibold">
                  Slug
                </th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left font-semibold">
                  Stato
                </th>
                <th scope="col" className="hidden lg:table-cell px-4 py-3 text-left font-semibold">
                  Titolare
                </th>
                <th scope="col" className="hidden xl:table-cell px-4 py-3 text-left font-semibold">
                  Piano
                </th>
                <th scope="col" className="hidden xl:table-cell px-4 py-3 text-left font-semibold">
                  Creato
                </th>
                <th scope="col" className="px-4 sm:px-6 py-3 text-right font-semibold">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-zinc-500">
                    Nessun cliente trovato.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/70">
                    <td className="px-4 sm:px-6 py-3">
                      <div className="font-medium text-zinc-900">{r.name}</div>
                      <div className="md:hidden mt-0.5 text-xs text-zinc-500">slug: {r.slug}</div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-zinc-700 font-mono text-xs">
                      {r.slug}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.status === "active"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                            : r.status === "onboarding"
                              ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                              : r.status === "suspended"
                                ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200"
                                : "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            r.status === "active"
                              ? "bg-emerald-500"
                              : r.status === "onboarding"
                                ? "bg-amber-500"
                                : r.status === "suspended"
                                  ? "bg-rose-500"
                                  : "bg-zinc-500"
                          }`}
                        />
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-zinc-700">
                      {r.owner?.profile_display_name ? (
                        <span>{r.owner.profile_display_name}</span>
                      ) : r.owner?.profile_email_hint ? (
                        <span>{r.owner.profile_email_hint}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 text-zinc-700">
                      {planLabel(r.plan_id)}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-3 text-zinc-500 text-xs">
                      {new Date(r.created_at).toLocaleDateString("it-IT", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-right">
                      <Link
                        href={`/app/admin/clients/${r.slug}`}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        Apri
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <NewCustomerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => {
          setDialogOpen(false);
          setSearch("");
          (async () => {
            const u = new URL("/app/admin/clients/search", window.location.origin);
            const r = await fetch(u, { method: "GET", headers: { Accept: "application/json" } });
            if (r.ok) setRows(await r.json());
          })();
        }}
      />
    </div>
  );
}
