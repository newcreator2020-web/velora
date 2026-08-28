"use client";

import Link from "next/link";
import { useActionState } from "react";
import { clearAdminTenantAction, setAdminTenantAction } from "./actions";

function planLabel(p: string) {
  if (p === "internal_test") return "Internal Test";
  if (p === "pro") return "Pro";
  return "Base";
}
function statusLabel(s: string) {
  if (s === "active") return "Attivo";
  if (s === "onboarding") return "Onboarding";
  if (s === "suspended") return "Sospeso";
  return s || "Sconosciuto";
}

export default function AdminCustomerDetailClient({
  tenant,
  business_profile,
  owner,
}: {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_id: string;
    created_at: string;
  };
  business_profile: {
    category: string | null;
    city: string | null;
    province: string | null;
    email: string | null;
    phone: string | null;
    timezone: string;
    locale: string;
  } | null;
  owner: { user_id: string | null; display_name: string | null; email_hint: string | null } | null;
}) {
  const [_s, dispatch, pending] = useActionState(setAdminTenantAction as never, null);
  const [_c, clearDispatch, clearPending] = useActionState(clearAdminTenantAction as never, null);
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link
            href="/app/admin/clients"
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
          >
            ← Tutti i clienti
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{tenant.name}</h1>
          <p className="mt-1 text-sm text-zinc-500 font-mono text-xs">
            slug: {tenant.slug} · id: {tenant.id.slice(0, 12)}…
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={clearDispatch as never}>
            <button
              type="submit"
              disabled={clearPending}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              Esci contesto
            </button>
          </form>
          <form action={dispatch as never}>
            <input type="hidden" name="slug" value={tenant.slug} />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
            >
              {pending ? "Apertura in corso…" : "Apri Site Studio"}
            </button>
          </form>
        </div>
      </div>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Profilo attività</h2>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Nome</dt>
              <dd className="mt-0.5 font-medium text-zinc-900">{tenant.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Stato</dt>
              <dd className="mt-0.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tenant.status === "active" ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" : tenant.status === "onboarding" ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" : "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200"}`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full inline-block ${tenant.status === "active" ? "bg-emerald-500" : tenant.status === "onboarding" ? "bg-amber-500" : "bg-zinc-500"}`}
                  />
                  {statusLabel(tenant.status)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Categoria</dt>
              <dd className="mt-0.5 text-zinc-800">{business_profile?.category || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Città / Prov.</dt>
              <dd className="mt-0.5 text-zinc-800">
                {business_profile?.city || "—"}
                {business_profile?.province ? ` (${business_profile.province})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Email contatto</dt>
              <dd className="mt-0.5 text-zinc-800">{business_profile?.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Telefono</dt>
              <dd className="mt-0.5 text-zinc-800">{business_profile?.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Timezone</dt>
              <dd className="mt-0.5 text-zinc-800">
                {business_profile?.timezone || "Europe/Rome"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Locale</dt>
              <dd className="mt-0.5 text-zinc-800">{business_profile?.locale || "it-IT"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Piano</dt>
              <dd className="mt-0.5 text-zinc-800 font-medium">{planLabel(tenant.plan_id)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 uppercase tracking-wide">Creato il</dt>
              <dd className="mt-0.5 text-zinc-800">
                {new Date(tenant.created_at).toLocaleString("it-IT")}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Titolare (Owner)</h2>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide">Nome</div>
              <div className="mt-0.5 font-medium text-zinc-900">{owner?.display_name || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide">Email (hint)</div>
              <div className="mt-0.5 text-zinc-800 break-all">{owner?.email_hint || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide">User ID</div>
              <div className="mt-0.5 font-mono text-xs text-zinc-500 break-all">
                {owner?.user_id || "—"}
              </div>
            </div>
            <div className="pt-2 border-t border-zinc-100 text-xs text-zinc-500">
              L&apos;invito all&apos;owner è stato inviato tramite Supabase Auth se l&apos;utente
              non esisteva.
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Link rapidi</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/s/${tenant.slug}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
            target="_blank"
            rel="noreferrer"
          >
            Anteprima sito pubblico ↗
          </Link>
          <Link
            href="/app/site"
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Vai a Site Studio (se già aperto)
          </Link>
        </div>
      </section>
    </div>
  );
}
