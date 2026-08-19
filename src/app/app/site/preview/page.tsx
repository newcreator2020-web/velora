import { notFound } from "next/navigation";
import { resolveDraftSiteForPreview } from "@/lib/server/site-studio";
import { SiteShell } from "@/components/site/SiteShell";
import { SiteRenderer } from "@/components/site/SectionRegistry";

export const metadata = {
  title: "Anteprima privata — VELORA",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SitePreviewPage() {
  const res = await resolveDraftSiteForPreview();
  if (res._tag !== "Found") notFound();
  const { publicSite } = res;
  return (
    <div className="min-h-screen">
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-50 w-full border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-sm"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2">
          <strong>Anteprima privata</strong>
          <span className="opacity-80">
            Questa pagina è visibile solo agli utenti autorizzati di questa attività. Non è il sito
            pubblico.
          </span>
          <a
            href="/app/site"
            className="rounded-md bg-amber-800 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Torna allo Studio
          </a>
        </div>
      </div>
      <main id="main-content" className="min-h-screen antialiased">
        <SiteShell theme={publicSite.theme}>
          <SiteRenderer sections={publicSite.sections} />
        </SiteShell>
      </main>
    </div>
  );
}
