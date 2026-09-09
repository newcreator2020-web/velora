import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProspectDetailAction,
  addProspectActivityAction,
  promoteProspectToTenantAction,
  type ProspectActivityRow,
} from "../actions";
import { AddActivityForm } from "./AddActivityForm";
import { PromoteForm } from "./PromoteForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROSPECT_STATUSES = [
  "mai_contattato",
  "da_chiamare",
  "chiamato",
  "richiamare",
  "interessato",
  "cliente",
  "non_interessato",
  "non_contattare",
] as const;

type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

const STATUS_LABEL: Record<ProspectStatus, string> = {
  mai_contattato: "Mai contattato",
  da_chiamare: "Da chiamare",
  chiamato: "Chiamato",
  richiamare: "Richiamare",
  interessato: "Interessato",
  cliente: "Cliente",
  non_interessato: "Non interessato",
  non_contattare: "Non contattare",
};

const STATUS_STYLES: Record<ProspectStatus, string> = {
  mai_contattato: "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200",
  da_chiamare: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  chiamato: "bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200",
  richiamare: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  interessato: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  cliente: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
  non_interessato: "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-300",
  non_contattare: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
};

const STATUS_DOT: Record<ProspectStatus, string> = {
  mai_contattato: "bg-zinc-400",
  da_chiamare: "bg-sky-500",
  chiamato: "bg-slate-400",
  richiamare: "bg-amber-500",
  interessato: "bg-emerald-500",
  cliente: "bg-purple-600",
  non_interessato: "bg-neutral-500",
  non_contattare: "bg-rose-600",
};

const ACTIVITY_KINDS = [
  "chiamata",
  "sms",
  "email",
  "appuntamento",
  "nota_interna",
  "cambio_stato",
  "cambio_assegnazione",
  "promosso_tenant",
] as const;

type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  chiamata: "Chiamata",
  sms: "SMS",
  email: "Email",
  appuntamento: "Appuntamento",
  nota_interna: "Nota interna",
  cambio_stato: "Cambio stato",
  cambio_assegnazione: "Cambio assegnazione",
  promosso_tenant: "Promosso a cliente",
};

const ACTIVITY_STYLES: Record<ActivityKind, string> = {
  chiamata: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  sms: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  email: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
  appuntamento: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  nota_interna: "bg-zinc-50 text-zinc-700 ring-1 ring-inset ring-zinc-200",
  cambio_stato: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  cambio_assegnazione: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200",
  promosso_tenant: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
};

function StatusBadge({ status }: { status: string }) {
  const s = (PROSPECT_STATUSES as ReadonlyArray<string>).includes(status)
    ? (status as ProspectStatus)
    : "mai_contattato";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[s]}`}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />
      {STATUS_LABEL[s]}
    </span>
  );
}

function ActivityBadge({ kind }: { kind: string }) {
  const k = (ACTIVITY_KINDS as ReadonlyArray<string>).includes(kind)
    ? (kind as ActivityKind)
    : "nota_interna";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTIVITY_STYLES[k]}`}
    >
      {ACTIVITY_LABEL[k]}
    </span>
  );
}

function formatDate(it: string | null | undefined): string {
  if (!it) return "—";
  try {
    const d = new Date(it);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export const metadata = {
  title: "Dettaglio prospetto — Velora Platform Admin",
};

export default async function AdminProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;

  const detail = await getProspectDetailAction(id);
  if (!detail) {
    notFound();
  }

  const { prospect, activities } = detail;

  async function wrappedAddActivity(
    _prev: { ok: boolean; error: string | null; id?: string } | null,
    formData: FormData,
  ) {
    "use server";
    formData.set("prospect_id", id);
    return addProspectActivityAction(_prev, formData);
  }

  async function wrappedPromote(
    _prev: { ok: boolean; error: string | null; tenantId?: string; slug?: string } | null,
    formData: FormData,
  ) {
    "use server";
    const raw = Object.fromEntries(formData.entries());

    const plan =
      typeof raw["plan"] === "string" && raw["plan"].trim() ? raw["plan"].trim() : "base";
    const ownerEmail = typeof raw["owner_email"] === "string" ? raw["owner_email"].trim() : "";
    const slug = typeof raw["slug"] === "string" ? raw["slug"].trim() : "";
    const category = typeof raw["category"] === "string" ? raw["category"].trim() : "";
    const city = typeof raw["city"] === "string" ? raw["city"].trim() : "";
    const province = typeof raw["province"] === "string" ? raw["province"].trim() : "";
    const timezone = typeof raw["timezone"] === "string" ? raw["timezone"].trim() : "Europe/Rome";
    const phone = typeof raw["phone"] === "string" ? raw["phone"].trim() : "";
    const businessEmail =
      typeof raw["businessEmail"] === "string" ? raw["businessEmail"].trim() : "";

    if (!ownerEmail) {
      return { ok: false, error: "Email titolare obbligatoria" };
    }

    const planLower = plan.toLowerCase();
    const normalizedPlan =
      planLower === "base" || planLower === "pro" || planLower === "internal_test"
        ? planLower
        : "base";

    try {
      const result = await promoteProspectToTenantAction(id, {
        plan: normalizedPlan as "base" | "pro" | "internal_test",
        ownerEmail,
        businessName: prospect.business_name,
        ...(slug ? { slug } : {}),
        ...(category || prospect.business_category
          ? { category: (category || prospect.business_category) as string }
          : {}),
        ...(city || prospect.comune ? { city: (city || prospect.comune) as string } : {}),
        ...(province ? { province } : {}),
        ...(timezone ? { timezone } : {}),
        ...(phone || prospect.telefono ? { phone: (phone || prospect.telefono) as string } : {}),
        ...(businessEmail || prospect.email
          ? { businessEmail: (businessEmail || prospect.email) as string }
          : {}),
      });
      if (!result.ok) {
        return { ok: false, error: "Errore provisioning" };
      }
      return {
        ok: true as const,
        error: null,
        tenantId: result.tenantId,
        slug: result.slug,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let error = msg;
      if (msg.includes("PROSPECT_ALREADY_PROMOTED")) {
        error = "Prospetto già promosso a cliente.";
      } else if (msg.includes("PROSPECT_NOT_FOUND")) {
        error = "Prospetto non trovato.";
      } else if (msg.includes("PROVISION_FAILED")) {
        error = msg.replace("PROVISION_FAILED: ", "");
      }
      return { ok: false, error };
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link
            href="/app/admin/prospects"
            className="inline-flex items-center gap-1 hover:text-indigo-600 hover:underline"
          >
            ← Torna alla lista prospetti
          </Link>
          <span aria-hidden>/</span>
          <span className="text-zinc-600 font-medium">Dettaglio prospetto</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
                {prospect.business_name}
              </h1>
              <StatusBadge status={prospect.status} />
              {prospect.promoted_to_tenant_id ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-200">
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500"
                  />
                  Promosso a cliente
                </span>
              ) : null}
            </div>
            <div className="text-sm text-zinc-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              {prospect.business_category ? (
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {prospect.business_category}
                </span>
              ) : null}
              {prospect.comune ? <span>📍 {prospect.comune}</span> : null}
              {prospect.telefono ? (
                <a
                  href={`tel:${prospect.telefono}`}
                  className="text-zinc-600 hover:text-indigo-600 hover:underline"
                >
                  📞 {prospect.telefono}
                </a>
              ) : null}
              {prospect.email ? (
                <a
                  href={`mailto:${prospect.email}`}
                  className="text-zinc-600 hover:text-indigo-600 hover:underline"
                >
                  ✉ {prospect.email}
                </a>
              ) : null}
            </div>
          </div>
          <div className="text-xs text-zinc-500 space-y-1 text-left sm:text-right">
            <div>Creato: {formatDate(prospect.created_at)}</div>
            {prospect.ultimo_contatto_at ? (
              <div>Ultimo contatto: {formatDate(prospect.ultimo_contatto_at)}</div>
            ) : null}
            {prospect.prossimo_contatto_at ? (
              <div>Prossimo contatto: {formatDate(prospect.prossimo_contatto_at)}</div>
            ) : null}
          </div>
        </div>
      </header>

      <section
        aria-labelledby="prospect-data"
        className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm space-y-4"
      >
        <h2
          id="prospect-data"
          className="text-sm font-semibold text-zinc-900 border-b border-zinc-100 pb-3"
        >
          Dati prospetto
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Nome attività
            </div>
            <div className="text-zinc-900 font-medium">{prospect.business_name}</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Categoria
            </div>
            <div className="text-zinc-700">
              {prospect.business_category || <span className="text-zinc-400">Non specificata</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Comune</div>
            <div className="text-zinc-700">
              {prospect.comune || <span className="text-zinc-400">—</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Telefono
            </div>
            <div className="text-zinc-700">
              {prospect.telefono ? (
                <a
                  href={`tel:${prospect.telefono}`}
                  className="hover:text-indigo-600 hover:underline"
                >
                  {prospect.telefono}
                </a>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Email</div>
            <div className="text-zinc-700 truncate">
              {prospect.email ? (
                <a
                  href={`mailto:${prospect.email}`}
                  className="hover:text-indigo-600 hover:underline"
                >
                  {prospect.email}
                </a>
              ) : (
                <span className="text-zinc-400">—</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Sito web
            </div>
            <div className="text-zinc-700">
              {prospect.sito_web ? (
                <div className="space-y-0.5">
                  <span className="text-emerald-600 font-medium">Sì</span>
                  {typeof prospect.sito_quality_score === "number" ? (
                    <div className="text-xs text-zinc-500">
                      Quality score: {prospect.sito_quality_score}/10
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className="text-zinc-500">No</span>
              )}
            </div>
          </div>
          {prospect.gmb_url ? (
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Google Business
              </div>
              <div className="text-zinc-700 truncate">
                <a
                  href={prospect.gmb_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  Apri scheda GMB ↗
                </a>
              </div>
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Assegnato a
            </div>
            <div className="text-zinc-700">
              {prospect.assigned_to || <span className="text-zinc-400">Non assegnato</span>}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Prossimo contatto
            </div>
            <div className="text-zinc-700">
              {prospect.prossimo_contatto_at ? (
                formatDate(prospect.prossimo_contatto_at)
              ) : (
                <span className="text-zinc-400">Non pianificato</span>
              )}
            </div>
          </div>
          {prospect.note ? (
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <div className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Note</div>
              <div className="text-zinc-700 whitespace-pre-wrap rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm">
                {prospect.note}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <PromoteForm
        wrappedPromoteAction={wrappedPromote}
        prospect={prospect}
        alreadyPromoted={!!prospect.promoted_to_tenant_id}
      />

      <AddActivityForm wrappedAction={wrappedAddActivity} />

      <section
        aria-labelledby="prospect-activities"
        className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="border-b border-zinc-100 px-5 py-4 flex items-center justify-between">
          <h2 id="prospect-activities" className="text-sm font-semibold text-zinc-900">
            Storico attività
            <span className="ml-2 text-xs font-normal text-zinc-500">({activities.length})</span>
          </h2>
        </div>
        {activities.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-500">
            Nessuna attività registrata.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {activities.map((a: ProspectActivityRow) => (
              <li key={a.id} className="px-5 py-4 hover:bg-zinc-50/60 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <ActivityBadge kind={a.activity_kind} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm text-zinc-900 whitespace-pre-wrap break-words">
                      {a.summary}
                    </p>
                    {a.outcome ? (
                      <p className="text-sm text-zinc-600 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 border border-zinc-100 p-2.5">
                        <span className="text-xs font-medium text-zinc-500 block mb-1">
                          Esito / dettagli:
                        </span>
                        {a.outcome}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-zinc-500 font-medium">
                      {formatDate(a.created_at)}
                    </div>
                    {a.author_user_id ? (
                      <div className="text-[10px] text-zinc-400 mt-0.5">operatore</div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
