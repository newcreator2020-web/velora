import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";
import Link from "next/link";

export const metadata = {
  title: "Velora Platform Admin",
  robots: { index: false, follow: false },
};

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformAdmin({ hardFail: true });
  } catch {
    notFound();
  }
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-white text-sm font-bold"
            >
              PA
            </span>
            <div>
              <div className="text-sm font-semibold">Velora Platform Admin</div>
              <div className="text-xs text-zinc-500">Amministrazione clienti</div>
            </div>
          </div>
          <nav aria-label="Platform Admin" className="flex flex-wrap items-center gap-1 text-sm">
            <Link
              href="/app/admin/clients"
              className="rounded-md px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Clienti
            </Link>
            <Link
              href="/app/admin/prospects"
              className="rounded-md px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Prospetti
            </Link>
            <Link
              href="/app/admin/media"
              className="rounded-md px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Media
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
