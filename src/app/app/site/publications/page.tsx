import { requireTenantRole } from "@/lib/server/auth";
import { loadPublicationVersions, rollbackPublicationAction } from "@/app/app/site/actions";
import { PUBLICATION_STATUS_LABEL } from "@/app/app/site/lib";
import { PublicationsClient } from "./PublicationsClient";

export const metadata = {
  title: "Versioni Pubblicazione — VELORA",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PublicationsPage() {
  await requireTenantRole("manager");
  const initial = await loadPublicationVersions();

  return (
    <main id="main-content" className="min-h-screen w-full bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
              Gestione Sito
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              Versioni Pubblicazione
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Ogni pubblicazione crea una nuova versione immutabile. Puoi ripristinare una versione
              precedente in modo atomico: il contenuto (sezioni, servizi, tema) torna esattamente
              com&apos;era e viene creata una nuova versione di tipo &ldquo;Rollback&rdquo; con
              tracciatura audit completa.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/app/site"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              Torna all&apos;editor
            </a>
            <a
              href="/app/site/preview"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              Anteprima pubblica
            </a>
          </div>
        </div>

        <PublicationsClient
          initialVersions={initial}
          rollbackAction={rollbackPublicationAction}
          labelMap={PUBLICATION_STATUS_LABEL}
        />
      </div>
    </main>
  );
}
