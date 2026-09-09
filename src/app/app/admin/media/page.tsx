import MediaClient from "./components/MediaClient";
import { listMediaAction } from "./actions";
import { MEDIA_CATEGORIES, ALLOWED_MIMES } from "./lib";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Media Manager — Velora Platform Admin",
};

type MediaSearchParams = {
  category?: string;
  mime?: string;
  search?: string;
  owner_tenant?: string;
  sort?: string;
};

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams?: Promise<MediaSearchParams> | MediaSearchParams;
}) {
  try {
    await requirePlatformAdmin({ hardFail: true });
  } catch {
    notFound();
  }

  const resolved = searchParams ? await Promise.resolve(searchParams) : {};
  const category = resolved.category;
  const mime = resolved.mime;
  const search = resolved.search;
  const owner_tenant = resolved.owner_tenant;
  const sortRaw = resolved.sort;

  const validSorts = ["created_desc", "size_desc", "filename_asc"] as const;
  const sort =
    sortRaw && (validSorts as ReadonlyArray<string>).includes(sortRaw)
      ? (sortRaw as (typeof validSorts)[number])
      : "created_desc";

  const normalizedCategory =
    category && (MEDIA_CATEGORIES as ReadonlyArray<string>).includes(category)
      ? (category as import("./lib").MediaCategory)
      : undefined;

  const result = await listMediaAction({
    ...(normalizedCategory ? { category: normalizedCategory } : {}),
    ...(mime ? { mime } : {}),
    ...(search ? { search } : {}),
    ...(owner_tenant ? { owner_tenant } : {}),
    sort,
    limit: 200,
  });

  const rows = result.ok ? result.rows : [];
  const count = result.ok ? result.count : 0;

  const initialFilters = {
    category: normalizedCategory ?? "",
    mime: mime ?? "",
    search: search ?? "",
    owner_tenant: owner_tenant ?? "",
    sort,
  };

  const mimeOptions = Array.from(ALLOWED_MIMES);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">Media Library</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Gestione file multimediali — immagini, PDF e documenti condivisi tra i tenant Velora.
        </p>
      </div>
      <MediaClient
        initialRows={rows}
        count={count}
        initialFilters={initialFilters}
        categories={Array.from(MEDIA_CATEGORIES)}
        mimeOptions={mimeOptions}
      />
    </div>
  );
}
