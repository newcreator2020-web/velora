import ClientsClient from "./components/ClientsClient";
import { listCustomersAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }> | { q?: string };
}) {
  const resolved = searchParams ? await Promise.resolve(searchParams) : {};
  const q = resolved && typeof resolved === "object" && "q" in resolved ? resolved.q : undefined;
  const rows = await listCustomersAction(q);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">Clienti</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Gestisci il provisioning dei nuovi tenant Velora.
        </p>
      </div>
      <ClientsClient initialRows={rows} />
    </div>
  );
}
