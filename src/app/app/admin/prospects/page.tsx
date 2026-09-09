import ProspectsClient from "./components/ProspectsClient";
import { listProspectsAction } from "./actions";
import type { ProspectRow } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Prospetti CRM — Velora Platform Admin",
};

type ProspectsSearchParams = {
  q?: string;
  status?: string;
  categoria?: string;
  comune?: string;
  assigned_to?: string;
  solo_prossimi_7gg?: string;
};

export default async function AdminProspectsPage({
  searchParams,
}: {
  searchParams?: Promise<ProspectsSearchParams> | ProspectsSearchParams;
}) {
  const resolved = searchParams ? await Promise.resolve(searchParams) : {};
  const q = resolved.q;
  const status = resolved.status;
  const categoria = resolved.categoria;
  const comune = resolved.comune;
  const assigned_to = resolved.assigned_to;
  const solo_prossimi_7gg =
    resolved.solo_prossimi_7gg === "1" || resolved.solo_prossimi_7gg === "true";

  const validStatuses = [
    "mai_contattato",
    "da_chiamare",
    "chiamato",
    "richiamare",
    "interessato",
    "cliente",
    "non_interessato",
    "non_contattare",
  ] as const;

  const normalizedStatus =
    status && validStatuses.includes(status as (typeof validStatuses)[number])
      ? (status as (typeof validStatuses)[number])
      : undefined;

  const result = await listProspectsAction({
    ...(q ? { q } : {}),
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    ...(categoria ? { categoria } : {}),
    ...(comune ? { comune } : {}),
    ...(assigned_to ? { assigned_to } : {}),
    ...(solo_prossimi_7gg ? { solo_prossimi_7gg } : {}),
  });

  const rows = result.rows as ProspectRow[];
  const count = result.count;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">Prospetti</h1>
        <p className="mt-1 text-sm text-zinc-600">
          CRM interno Velora — gestione attività locali da acquisire come clienti.
        </p>
      </div>
      <ProspectsClient initialRows={rows} count={count} />
    </div>
  );
}
