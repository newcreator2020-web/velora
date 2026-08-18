import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PublicSiteNotFound() {
  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-6 px-4 py-20 text-center sm:px-6">
        <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">404</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sito non disponibile</h1>
        <p className="text-base leading-relaxed text-neutral-600">
          Il sito richiesto non esiste o non è al momento pubblico. Verifica l&apos;indirizzo oppure
          torna alla pagina principale.
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
