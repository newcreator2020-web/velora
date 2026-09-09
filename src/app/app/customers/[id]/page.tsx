import { redirect } from "next/navigation";
import Link from "next/link";
import { requireTenantRole, getCurrentTenantContext } from "@/lib/server/auth";
import { getCustomerDetail } from "@/lib/server/customers";
import CustomerDetailClient from "./CustomerDetailClient";

export const metadata = {
  title: "Cliente",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AppCustomerDetailPage(props: PageProps) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantRole("staff");
  const tz = ctx.business_profile?.timezone ?? "Europe/Rome";
  const { id } = await props.params;
  const res = await getCustomerDetail(id);

  if (res.ok === false) {
    return (
      <main id="main-content" className="mx-auto max-w-5xl p-4 sm:p-8">
        <header className="mb-4">
          <Link href="/app/customers" className="text-sm text-neutral-600 hover:underline">
            &larr; Tutti i clienti
          </Link>
        </header>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {res.message}
        </div>
      </main>
    );
  }

  const c = res.customer;
  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "manager";

  return (
    <main id="main-content" className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-6">
        <Link href="/app/customers" className="text-sm text-neutral-600 hover:underline">
          &larr; Tutti i clienti
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{c.display_name}</h1>
            <dl className="mt-2 space-y-1 text-sm text-neutral-600 break-all">
              {c.email ? (
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd>{c.email}</dd>
                </div>
              ) : null}
              {c.phone ? (
                <div>
                  <dt className="sr-only">Telefono</dt>
                  <dd>{c.phone}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-neutral-500">
              <div>
                <span className="font-semibold text-neutral-700">{c.booking_count}</span>{" "}
                appuntamenti
              </div>
              {c.last_booking_at ? (
                <div>
                  Ultimo:{" "}
                  <time dateTime={c.last_booking_at}>
                    {new Date(c.last_booking_at).toLocaleDateString("it-IT")}
                  </time>
                </div>
              ) : null}
              <div>
                Creato:{" "}
                <time dateTime={c.created_at}>
                  {new Date(c.created_at).toLocaleDateString("it-IT")}
                </time>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/app/bookings"
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              Appuntamenti
            </Link>
          </div>
        </div>
      </header>

      <section className="space-y-6 lg:grid lg:grid-cols-3 lg:gap-6 lg:space-y-0">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-1">
          <h2 className="text-base font-semibold text-neutral-900">Note interne</h2>
          {canWrite ? (
            <CustomerDetailClient customer={c} />
          ) : (
            <div className="mt-3">
              {c.notes ? (
                <div className="whitespace-pre-wrap break-words rounded-md border border-neutral-100 bg-neutral-50 p-3 text-sm text-neutral-700">
                  {c.notes}
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">
                  Nessuna nota. Solo Manager e Proprietario possono scrivere.
                </p>
              )}
              <div className="mt-3 text-[11px] text-neutral-400">Sola lettura</div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-900">Storico appuntamenti</h2>
            <span className="text-xs text-neutral-500">{c.bookings.length} ultimi</span>
          </div>
          {c.bookings.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
              Nessun appuntamento per questo cliente.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {c.bookings.map(
                (b: {
                  id: string;
                  starts_at: string;
                  ends_at: string;
                  status: string;
                  notes: string | null;
                  payment_status?: string | null;
                  deposit_amount?: number | null;
                  services: { name: string; duration_minutes: number | null } | null;
                }) => {
                  const dt = new Date(b.starts_at);
                  const end = new Date(b.ends_at);
                  const fmt = new Intl.DateTimeFormat("it-IT", {
                    timeZone: tz,
                    dateStyle: "short",
                    timeStyle: "short",
                    hourCycle: "h23",
                  });
                  const dtFmt = new Intl.DateTimeFormat("it-IT", {
                    timeZone: tz,
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  });
                  const statusMap: Record<string, { label: string; className: string }> = {
                    confirmed: {
                      label: "Confermato",
                      className:
                        "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
                    },
                    completed: {
                      label: "Completato",
                      className: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
                    },
                    no_show: {
                      label: "No show",
                      className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
                    },
                    cancelled: {
                      label: "Cancellato",
                      className:
                        "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
                    },
                  };
                  const s = statusMap[b.status] ?? {
                    label: b.status,
                    className: "bg-neutral-100 text-neutral-700",
                  };
                  type PayEntry = { label: string; className: string };
                  const payMap: Record<string, PayEntry> = {
                    unpaid: {
                      label: "IN ATTESA CAPARRA",
                      className:
                        "bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20",
                    },
                    deposit_paid: {
                      label: "CAPARRA PAGATA",
                      className:
                        "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
                    },
                    paid: {
                      label: "SALDATA",
                      className: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
                    },
                    failed: {
                      label: "FALLITO",
                      className: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
                    },
                    refunded: {
                      label: "RIMBORSATO",
                      className:
                        "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
                    },
                    partially_refunded: {
                      label: "RIMBORSATO PARZ.",
                      className:
                        "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/20",
                    },
                  };
                  const payEntry = b.payment_status ? (payMap[b.payment_status] ?? null) : null;
                  return (
                    <li
                      key={b.id}
                      className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-12 sm:items-center"
                    >
                      <div className="sm:col-span-5">
                        <div className="text-sm font-medium text-neutral-900">
                          <time dateTime={b.starts_at}>{fmt.format(dt)}</time>
                        </div>
                        <div className="text-xs text-neutral-500">Fine {dtFmt.format(end)}</div>
                      </div>
                      <div className="sm:col-span-4">
                        <div className="text-sm text-neutral-800">
                          {b.services?.name ?? "Servizio"}
                        </div>
                        {b.services?.duration_minutes ? (
                          <div className="text-xs text-neutral-500">
                            {b.services.duration_minutes} min
                          </div>
                        ) : null}
                        {b.notes ? (
                          <div className="mt-1 whitespace-pre-wrap break-words rounded border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                            {b.notes}
                          </div>
                        ) : null}
                      </div>
                      <div className="sm:col-span-3 sm:text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
                          >
                            {s.label}
                          </span>
                          {payEntry ? (
                            <span
                              title={
                                (b.payment_status === "deposit_paid" ||
                                  b.payment_status === "paid") &&
                                b.deposit_amount != null &&
                                Number.isFinite(b.deposit_amount) &&
                                b.deposit_amount > 0
                                  ? `Caparra €${Number(b.deposit_amount).toFixed(2)}`
                                  : undefined
                              }
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${payEntry.className}`}
                            >
                              {payEntry.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
