import { redirect } from "next/navigation";
import Link from "next/link";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { searchCustomers } from "@/lib/server/customers";

export const metadata = {
  title: "Clienti",
};

type CSearchParams = {
  q?: string;
  page?: string;
  pageSize?: string;
};

type PageProps = {
  searchParams?: Promise<CSearchParams>;
};

export default async function AppCustomersPage(props: PageProps) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantRole("staff");
  const sp: CSearchParams = (await (props.searchParams ?? Promise.resolve({}))) ?? {};
  const pageRaw = sp.page ? Number(sp.page) : 1;
  const pageSizeRaw = sp.pageSize ? Number(sp.pageSize) : 25;
  const res = await searchCustomers({
    q: sp.q ?? "",
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    pageSize:
      Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 && pageSizeRaw <= 100 ? pageSizeRaw : 25,
  });

  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "manager";
  const qp = sp.q ?? "";

  return (
    <main id="main-content" className="mx-auto max-w-6xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clienti</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Anagrafica di {ctx.business_profile?.display_name ?? ctx.tenant.slug ?? "l'attività"}.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <a
            href="/app/bookings"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Appuntamenti
          </a>
        </nav>
      </header>

      <form
        role="search"
        method="get"
        action="/app/customers"
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4"
      >
        <label className="text-sm text-neutral-600 sm:col-span-3">
          <span className="mb-1 block text-xs font-medium">Cerca cliente</span>
          <input
            type="search"
            name="q"
            defaultValue={qp}
            placeholder="Nome, email, telefono..."
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500/20"
            aria-label="Cerca cliente"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500/30"
          >
            Cerca
          </button>
        </div>
      </form>

      {res.ok === false ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {res.message}
        </div>
      ) : res.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          Nessun cliente trovato.
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="grid grid-cols-1 gap-3 lg:hidden" aria-label="Lista clienti mobile">
            {res.items.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <Link
                  className="block"
                  href={`/app/customers/${c.id}`}
                  aria-label={`Dettaglio cliente ${c.display_name}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-base font-semibold text-neutral-900">
                        {c.display_name}
                      </div>
                      <div className="mt-1 space-y-0.5 break-all text-xs text-neutral-500">
                        {c.email ? <div>{c.email}</div> : null}
                        {c.phone ? <div>{c.phone}</div> : null}
                      </div>
                    </div>
                    <div className="text-right text-xs text-neutral-500">
                      <div>
                        <span className="font-semibold text-neutral-700">{c.booking_count}</span>{" "}
                        appuntamenti
                      </div>
                      {c.last_booking_at ? (
                        <div className="mt-1">
                          Ultimo: {new Date(c.last_booking_at).toLocaleDateString("it-IT")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {!canWrite ? (
                    <div
                      className="mt-2 text-[11px] text-neutral-400"
                      role="note"
                      aria-label="Sola lettura"
                    >
                      Sola lettura
                    </div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Nome
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Contatti
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">
                      Appuntamenti
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">
                      Ultimo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {res.items.map((c) => (
                    <tr key={c.id} className="hover:bg-neutral-50/60">
                      <td className="px-4 py-3 align-top">
                        <Link
                          className="font-medium text-neutral-900 hover:underline"
                          href={`/app/customers/${c.id}`}
                        >
                          {c.display_name}
                        </Link>
                        {!canWrite ? (
                          <div className="mt-1 text-[11px] text-neutral-400">Sola lettura</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top break-all text-xs text-neutral-500">
                        {c.email ? <div>{c.email}</div> : null}
                        {c.phone ? <div>{c.phone}</div> : null}
                      </td>
                      <td className="px-4 py-3 align-top text-right font-medium text-neutral-800">
                        {c.booking_count}
                      </td>
                      <td className="px-4 py-3 align-top text-right text-xs text-neutral-500">
                        {c.last_booking_at
                          ? new Date(c.last_booking_at).toLocaleDateString("it-IT")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <nav
            aria-label="Paginazione clienti"
            className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm text-neutral-600"
          >
            <div>
              Pagina {res.page} · {res.total} risultati
            </div>
            <div className="flex gap-2">
              {res.page > 1 ? (
                <Link
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
                  href={`/app/customers?q=${encodeURIComponent(qp)}&page=${res.page - 1}`}
                >
                  Precedente
                </Link>
              ) : null}
              {res.items.length >= res.pageSize ? (
                <Link
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
                  href={`/app/customers?q=${encodeURIComponent(qp)}&page=${res.page + 1}`}
                >
                  Successiva
                </Link>
              ) : null}
            </div>
          </nav>
        </div>
      )}
    </main>
  );
}
