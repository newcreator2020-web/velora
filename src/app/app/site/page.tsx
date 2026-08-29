import { initialEditorialState } from "@/app/app/site/actions";
import { SiteStudio } from "@/components/studio/SiteStudio";
import { requireTenantRole } from "@/lib/server/auth";

export const metadata = {
  title: "Gestione Sito — VELORA",
  robots: { index: false, follow: false },
};

export default async function SiteManagementPage() {
  await requireTenantRole("manager");
  const initial = await initialEditorialState();
  return (
    <main id="main-content" className="min-h-screen bg-slate-50">
      <SiteStudio {...initial} />
    </main>
  );
}
