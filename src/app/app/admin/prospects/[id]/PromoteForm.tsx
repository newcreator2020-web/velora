"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { slugFromBusinessName } from "@/lib/utils";
import { PLAN_IDS, planLabel } from "@/lib/platform-constants";
import type { ProspectRow } from "../actions";

type PromoteState = {
  ok: boolean;
  error: string | null;
  tenantId?: string;
  slug?: string;
};

type PromoteAction = (_prev: PromoteState | null, formData: FormData) => Promise<PromoteState>;

function Input(props: {
  id: string;
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
      <input
        id={props.id}
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        required={props.required}
        onChange={props.onChange}
        className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:bg-zinc-50 disabled:text-zinc-500"
      />
    </div>
  );
}

export function PromoteForm({
  wrappedPromoteAction,
  prospect,
  alreadyPromoted,
}: {
  wrappedPromoteAction: PromoteAction;
  prospect: ProspectRow;
  alreadyPromoted: boolean;
}) {
  const [state, dispatch, pending] = useActionState<PromoteState | null, FormData>(
    wrappedPromoteAction as never,
    null,
  );
  const router = useRouter();
  const [slug, setSlug] = useState<string>(
    slugFromBusinessName(`${prospect.business_name || ""} ${prospect.comune || ""}`.trim()),
  );
  const [slugEdited, setSlugEdited] = useState(false);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (state && state.ok) {
      router.refresh();
    }
  }, [state, router]);

  if (alreadyPromoted) {
    return (
      <section
        aria-labelledby="prospect-promote"
        className="rounded-xl border border-purple-200 bg-purple-50/50 p-5 shadow-sm"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700"
            >
              ✓
            </div>
            <div>
              <h2 id="prospect-promote" className="text-sm font-semibold text-purple-900">
                Promozione a cliente completata
              </h2>
              <p className="mt-1 text-sm text-purple-700/90">
                Questo prospetto è stato già promosso a tenant Velora con stato{" "}
                <span className="font-medium">&quot;Cliente&quot;</span>.
              </p>
            </div>
          </div>
          {state?.slug ? (
            <Link
              href={`/app/admin/clients/${state.slug}`}
              className="inline-flex h-10 items-center justify-center rounded-md bg-purple-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 whitespace-nowrap"
            >
              Apri cliente →
            </Link>
          ) : (
            <Link
              href="/app/admin/clients"
              className="inline-flex h-10 items-center justify-center rounded-md border border-purple-300 bg-white px-4 text-sm font-medium text-purple-800 hover:bg-purple-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 whitespace-nowrap"
            >
              Vai a clienti
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="prospect-promote"
      className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-3 mb-5 border-b border-indigo-100 pb-4">
        <div
          aria-hidden
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700"
        >
          ↑
        </div>
        <div>
          <h2 id="prospect-promote" className="text-sm font-semibold text-zinc-900">
            Promuovi a cliente Velora
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Crea un tenant vero con provisioning completo (profilo business + owner + membership). I
            campi sono pre-popolati dai dati del prospetto.
          </p>
        </div>
      </div>

      <form action={dispatch as never} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            id="pr-owner_email"
            label="Email titolare"
            name="owner_email"
            type="email"
            placeholder="titolarestudio@example.test"
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="pr-plan" className="block text-sm font-medium text-zinc-800">
              Piano
              <span aria-hidden className="ml-1 text-rose-600">
                *
              </span>
            </label>
            <select
              id="pr-plan"
              name="plan"
              defaultValue="base"
              className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  {planLabel(p)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="pr-slug" className="block text-sm font-medium text-zinc-800">
              Slug cliente
              <span aria-hidden className="ml-1 text-rose-600">
                *
              </span>
            </label>
            <input
              id="pr-slug"
              name="slug"
              type="text"
              value={slug}
              required
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              placeholder="studio-aurora-milano"
              className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-mono text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            {!slugEdited ? (
              <p className="text-[11px] text-zinc-500">
                Auto-generato da nome e comune — puoi modificare manualmente.
              </p>
            ) : null}
          </div>
          <Input
            id="pr-ownerName"
            label="Nome titolare (opzionale)"
            name="ownerName"
            placeholder="Mario Rossi"
            defaultValue={""}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            id="pr-category"
            label="Categoria business"
            name="category"
            placeholder={prospect.business_category || "es. Parrucchiere"}
            defaultValue={prospect.business_category ?? ""}
          />
          <Input
            id="pr-city"
            label="Città"
            name="city"
            placeholder="es. Milano"
            defaultValue={prospect.comune ?? ""}
            required
          />
          <Input
            id="pr-province"
            label="Provincia (opzionale)"
            name="province"
            placeholder="es. MI"
            defaultValue={""}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="pr-timezone" className="block text-sm font-medium text-zinc-800">
              Timezone
            </label>
            <select
              id="pr-timezone"
              name="timezone"
              defaultValue="Europe/Rome"
              className="block w-full h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="Europe/Rome">Europe/Rome</option>
              <option value="Europe/Milan">Europe/Milan</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <Input
            id="pr-phone"
            label="Telefono attività"
            name="phone"
            type="tel"
            defaultValue={prospect.telefono ?? ""}
            placeholder="+39 02 1234567"
          />
          <Input
            id="pr-businessEmail"
            label="Email PEC / attività"
            name="businessEmail"
            type="email"
            defaultValue={prospect.email ?? ""}
            placeholder="pec@attivita.test"
          />
        </div>

        <input name="idempotencyKey" type="hidden" aria-hidden defaultValue={idempotencyKey} />

        {state && !state.ok ? (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            <div className="font-medium">Promozione fallita</div>
            <div className="mt-1">{state.error}</div>
          </div>
        ) : null}
        {state && state.ok ? (
          <div
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <div className="font-medium">
              Cliente creato con successo
              {state.slug ? ` (slug: ${state.slug})` : null}
            </div>
            <div className="mt-1">
              <Link
                href={`/app/admin/clients/${state.slug ?? ""}`}
                className="underline underline-offset-2 hover:text-emerald-900 font-medium"
              >
                Apri dashboard cliente →
              </Link>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
          <Link
            href="/app/admin/clients"
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Annulla
          </Link>
          <button
            type="submit"
            disabled={pending || (!!state && state.ok)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Provisioning in corso…" : state?.ok ? "Promosso ✓" : "Promuovi a cliente"}
          </button>
        </div>
      </form>
    </section>
  );
}
