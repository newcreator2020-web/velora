"use server";

import {
  ALLOWED_MIMES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  MEDIA_CATEGORIES,
  MediaMetadataPatchSchema,
  MediaAssociateSchema,
  extensionFromFilename,
  extensionToMime,
  mimeToExtension,
  isImageMime,
  slugFilename,
  verifyMagicBytes,
  type MediaUploadState,
  type MediaVariant,
  type MediaMetadataPatch,
  type MediaAssociateInput,
  type MediaCategory as MediaCategoryFromLib,
  type MediaLibraryRow,
} from "./lib";

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Tables, TablesInsert, TablesUpdate, Json } from "@/types/supabase";

async function guardAdmin() {
  return requirePlatformAdmin({ hardFail: true });
}

function shortUuid8(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function buildStoragePath(params: {
  tenantId: string | null | undefined;
  year: number;
  month: number;
  uuid8: string;
  slug: string;
  ext: string;
}): string {
  const owner = params.tenantId ? `owner_${params.tenantId}` : "owner_admin";
  const mm = String(params.month).padStart(2, "0");
  const safeSlug = params.slug.replace(/\.\./g, "").replace(/\//g, "").replace(/\\/g, "");
  const safeExt = params.ext.replace(/[^a-z0-9]/g, "").toLowerCase();
  return `${owner}/${params.year}-${mm}/${params.uuid8}-${safeSlug}.${safeExt}`;
}

function buildVariantPath(basePath: string, key: "small" | "medium" | "large"): string {
  const dot = basePath.lastIndexOf(".");
  const pre = dot > 0 ? basePath.slice(0, dot) : basePath;
  return `${pre}.${key}.webp`;
}

// ---------------------------------------------------------------------------
// 1. uploadMediaAction
// ---------------------------------------------------------------------------
export async function uploadMediaAction(
  _prevState: MediaUploadState | null,
  formData: FormData,
): Promise<MediaUploadState> {
  let admin: { userId: string; isAdmin: true; email: string | undefined };
  try {
    admin = await guardAdmin();
  } catch {
    return { ok: false, error: "Permesso negato.", code: "PERMISSION" };
  }

  const rawFile = formData.get("file");
  if (!rawFile || !(rawFile instanceof Blob)) {
    return { ok: false, error: "Nessun file ricevuto.", code: "MIME" };
  }
  const file = rawFile as Blob & { name?: string };
  const filenameOrig = typeof file.name === "string" && file.name.trim() ? file.name : "upload.bin";

  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `File troppo grande (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).`,
      code: "OVERSIZE",
    };
  }

  const declaredMime = (file.type || "").toLowerCase().trim();
  const extFromName = extensionFromFilename(filenameOrig);

  const mimeOk = (ALLOWED_MIMES as ReadonlyArray<string>).includes(declaredMime);
  const extOk = extFromName
    ? (ALLOWED_EXTENSIONS as ReadonlyArray<string>).includes(extFromName)
    : false;
  if (!mimeOk && !extOk) {
    return {
      ok: false,
      error: "Tipo di file non ammesso (png/jpeg/webp/avif/gif/pdf).",
      code: "MIME",
    };
  }

  const effectiveMime = mimeOk
    ? declaredMime
    : extFromName
      ? (extensionToMime(extFromName) ?? "")
      : "";
  if (!effectiveMime) {
    return { ok: false, error: "Tipo file non valido.", code: "MIME" };
  }

  const ext =
    extFromName && (ALLOWED_EXTENSIONS as ReadonlyArray<string>).includes(extFromName)
      ? extFromName
      : (mimeToExtension(effectiveMime) ?? "bin");

  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "Impossibile leggere il file.", code: "STORAGE" };
  }
  const u8 = new Uint8Array(buf);

  if (!verifyMagicBytes(u8, effectiveMime)) {
    return {
      ok: false,
      error: "Contenuto file non corrisponde al tipo dichiarato.",
      code: "MIME",
    };
  }

  const sha256 = createHash("sha256").update(Buffer.from(u8)).digest("hex");

  const supabase = getSupabaseServiceClient();
  const dupRes = await supabase
    .from("media_library")
    .select("id")
    .eq("checksum_sha256", sha256)
    .limit(1)
    .maybeSingle();
  if (!dupRes.error && dupRes.data) {
    return {
      ok: false,
      error: "File già presente nella libreria (hash duplicato).",
      code: "HASH_DUP",
    };
  }

  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let sharpFn: ((input: Buffer) => import("sharp").Sharp) | null = null;
  try {
    const sharpMod: { default?: unknown } = (await import("sharp")) as { default?: unknown };
    const sf = (sharpMod.default ?? sharpMod) as (input: Buffer) => import("sharp").Sharp;
    if (typeof sf === "function") sharpFn = sf;
  } catch {
    sharpFn = null;
  }

  const isImage = isImageMime(effectiveMime);
  if (isImage && sharpFn) {
    try {
      const meta = await sharpFn(Buffer.from(u8)).metadata();
      if (typeof meta.width === "number") widthPx = meta.width;
      if (typeof meta.height === "number") heightPx = meta.height;
    } catch {
      widthPx = null;
      heightPx = null;
    }
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const uuid8 = shortUuid8();
  const slug = slugFilename(filenameOrig);
  const tenantIdRaw = formData.get("owner_tenant_id") as string | null;
  const tenantId =
    tenantIdRaw && typeof tenantIdRaw === "string" && tenantIdRaw.trim()
      ? tenantIdRaw.trim()
      : null;
  const storedPath = buildStoragePath({
    tenantId,
    year,
    month,
    uuid8,
    slug,
    ext,
  });

  const bucket = "velora-media";
  const uploadRes = await supabase.storage.from(bucket).upload(storedPath, Buffer.from(u8), {
    contentType: effectiveMime,
    cacheControl: "public, max-age=31536000, immutable",
    upsert: false,
  });
  if (uploadRes.error) {
    return {
      ok: false,
      error: `Storage upload fallito: ${uploadRes.error.message}`,
      code: "STORAGE",
    };
  }

  let variantsJson: Json = null;
  if (isImage && sharpFn) {
    const variantsDef: Array<{ key: "small" | "medium" | "large"; width: number; label: string }> =
      [
        { key: "small", width: 480, label: "Small 480w" },
        { key: "medium", width: 1024, label: "Medium 1024w" },
        { key: "large", width: 1920, label: "Large 1920w" },
      ];
    const built: MediaVariant[] = [];
    for (const def of variantsDef) {
      try {
        const vPath = buildVariantPath(storedPath, def.key);
        const outBuf = await sharpFn(Buffer.from(u8))
          .rotate()
          .resize({ width: def.width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
        const vUpload = await supabase.storage.from(bucket).upload(vPath, outBuf, {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
          upsert: false,
        });
        if (vUpload.error) continue;
        let vw: number = def.width;
        let vh: number = 0;
        try {
          const vmeta = await sharpFn(outBuf).metadata();
          if (typeof vmeta.width === "number") vw = vmeta.width;
          if (typeof vmeta.height === "number") vh = vmeta.height;
        } catch {
          /* keep computed */
        }
        built.push({
          key: def.key,
          label: def.label,
          width: def.width,
          stored_path: vPath,
          mime_type: "image/webp",
          file_size_bytes: outBuf.length,
          width_px: vw,
          height_px: vh,
        });
      } catch {
        continue;
      }
    }
    if (built.length > 0) {
      variantsJson = { variants: built } as unknown as Json;
    }
  }

  const categoryRaw = formData.get("category") as string | null;
  let categoryVal: MediaCategoryFromLib = "immagine_generica";
  if (categoryRaw && (MEDIA_CATEGORIES as ReadonlyArray<string>).includes(categoryRaw)) {
    categoryVal = categoryRaw as MediaCategoryFromLib;
  } else if (effectiveMime === "application/pdf") {
    categoryVal = "documento";
  }
  const category = categoryVal as NonNullable<TablesInsert<"media_library">["category"]>;

  const insert: TablesInsert<"media_library"> = {
    filename_orig: filenameOrig,
    stored_path: storedPath,
    mime_type: effectiveMime,
    file_size_bytes: file.size,
    width_px: widthPx,
    height_px: heightPx,
    checksum_sha256: sha256,
    alt_text: null,
    caption: null,
    category,
    variants: variantsJson,
    owner_tenant_id: tenantId,
    created_by: admin.userId,
    status: "draft",
  };

  const dbRes = await supabase
    .from("media_library")
    .insert(insert)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (dbRes.error || !dbRes.data) {
    try {
      await supabase.storage.from(bucket).remove([storedPath]);
      if (variantsJson && typeof variantsJson === "object" && variantsJson !== null) {
        const vj = variantsJson as { variants?: Array<{ stored_path: string }> };
        const extras = (vj.variants ?? []).map((v) => v.stored_path);
        if (extras.length) await supabase.storage.from(bucket).remove(extras);
      }
    } catch {
      /* cleanup non bloccante */
    }
    return {
      ok: false,
      error: `DB insert fallito: ${dbRes.error?.message ?? "nessun record"}`,
      code: "DB",
    };
  }

  const media = dbRes.data as Tables<"media_library">;
  return { ok: true, media };
}

// ---------------------------------------------------------------------------
// 2. updateMediaMetadataAction
// ---------------------------------------------------------------------------
export async function updateMediaMetadataAction(
  id: string,
  patch: MediaMetadataPatch,
): Promise<{ ok: boolean; error: string | null }> {
  z.string().uuid("ID media non valido").parse(id);
  let admin;
  try {
    admin = await guardAdmin();
    if (!admin.isAdmin) return { ok: false, error: "PERMISSION_DENIED" };
  } catch {
    return { ok: false, error: "PERMISSION_DENIED" };
  }
  const parsed = MediaMetadataPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const changes: TablesUpdate<"media_library"> = {};
  const p = parsed.data;
  if ("alt_text" in p) changes.alt_text = p.alt_text ?? null;
  if ("caption" in p) changes.caption = p.caption ?? null;
  if ("category" in p && typeof p.category === "string") changes.category = p.category;
  if ("owner_tenant_id" in p) changes.owner_tenant_id = p.owner_tenant_id ?? null;
  if ("status" in p && typeof p.status === "string") changes.status = p.status;

  if (Object.keys(changes).length === 0) return { ok: true, error: null };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("media_library").update(changes).eq("id", id);
  if (error) return { ok: false, error: `UPDATE_MEDIA_FAILED: ${error.message}` };
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// 3. deleteMediaAction
// ---------------------------------------------------------------------------
export async function deleteMediaAction(
  id: string,
): Promise<{ ok: boolean; error: string | null }> {
  z.string().uuid("ID media non valido").parse(id);
  let admin;
  try {
    admin = await guardAdmin();
    if (!admin.isAdmin) return { ok: false, error: "PERMISSION_DENIED" };
  } catch {
    return { ok: false, error: "PERMISSION_DENIED" };
  }
  const supabase = getSupabaseServiceClient();
  const fetchRes = await supabase
    .from("media_library")
    .select("stored_path,variants")
    .eq("id", id)
    .limit(1)
    .maybeSingle();
  if (fetchRes.error) return { ok: false, error: `FETCH_MEDIA_FAILED: ${fetchRes.error.message}` };
  const row = fetchRes.data as { stored_path: string; variants: Json | null } | null;
  const bucket = "velora-media";
  const toRemove: string[] = [];
  if (row?.stored_path) toRemove.push(row.stored_path);
  if (row?.variants && typeof row.variants === "object" && row.variants !== null) {
    const vj = row.variants as { variants?: Array<{ stored_path: string }> };
    for (const v of vj.variants ?? []) {
      if (v?.stored_path) toRemove.push(v.stored_path);
    }
  }
  if (toRemove.length > 0) {
    try {
      await supabase.storage.from(bucket).remove(toRemove);
    } catch {
      /* non bloccante se storage già pulito */
    }
  }
  const { error } = await supabase.from("media_library").delete().eq("id", id);
  if (error) return { ok: false, error: `DELETE_MEDIA_FAILED: ${error.message}` };
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// 4. associateMediaAction
// ---------------------------------------------------------------------------
export async function associateMediaAction(
  input: MediaAssociateInput,
): Promise<{ ok: boolean; error: string | null; id?: string }> {
  let admin;
  try {
    admin = await guardAdmin();
    if (!admin.isAdmin) return { ok: false, error: "PERMISSION_DENIED" };
  } catch {
    return { ok: false, error: "PERMISSION_DENIED" };
  }
  const parsed = MediaAssociateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const supabase = getSupabaseServiceClient();
  const data = parsed.data;
  const insert: TablesInsert<"media_assocs"> = {
    media_id: data.media_id,
    association_type: data.association_type,
    assoc_key_id: data.assoc_key_id,
    tenant_id: data.tenant_id ?? null,
    ordine: typeof data.ordine === "number" ? data.ordine : 0,
    metadata: (data.metadata ?? null) as Json,
  };
  const res = await supabase
    .from("media_assocs")
    .upsert(insert, {
      onConflict: "media_id,association_type,assoc_key_id",
      ignoreDuplicates: false,
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (res.error) return { ok: false, error: `ASSOCIATE_FAILED: ${res.error.message}` };
  const out: { ok: boolean; error: string | null; id?: string } = { ok: true, error: null };
  if (res.data && typeof (res.data as { id?: string }).id === "string") {
    out.id = (res.data as { id: string }).id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. listMediaAction
// ---------------------------------------------------------------------------
type ListMediaFilters = {
  category?: MediaCategoryFromLib | undefined;
  mime?: string | undefined;
  search?: string | undefined;
  owner_tenant?: string | undefined;
  sort?: "created_desc" | "size_desc" | "filename_asc" | undefined;
  limit?: number | undefined;
};

export async function listMediaAction(
  filters: ListMediaFilters = {},
): Promise<{ ok: boolean; error: string | null; rows: MediaLibraryRow[]; count: number }> {
  let admin;
  try {
    admin = await guardAdmin();
    if (!admin.isAdmin) return { ok: false, error: "PERMISSION_DENIED", rows: [], count: 0 };
  } catch {
    return { ok: false, error: "PERMISSION_DENIED", rows: [], count: 0 };
  }

  const supabase = getSupabaseServiceClient();
  let query = supabase.from("media_library").select("*", { count: "exact" });

  if (filters.category && (MEDIA_CATEGORIES as ReadonlyArray<string>).includes(filters.category)) {
    query = query.eq("category", filters.category);
  }
  if (filters.mime && filters.mime.trim()) {
    query = query.like("mime_type", `%${filters.mime.trim()}%`);
  }
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim();
    query = query.or(`filename_orig.ilike.%${s}%,alt_text.ilike.%${s}%,caption.ilike.%${s}%`);
  }
  if (filters.owner_tenant && filters.owner_tenant.trim()) {
    query = query.eq("owner_tenant_id", filters.owner_tenant.trim());
  }

  const limit = typeof filters.limit === "number" && filters.limit > 0 ? filters.limit : 200;
  query = query.limit(limit);

  switch (filters.sort) {
    case "size_desc":
      query = query.order("file_size_bytes", { ascending: false });
      break;
    case "filename_asc":
      query = query.order("filename_orig", { ascending: true });
      break;
    case "created_desc":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  const res = await query;
  if (res.error) {
    return { ok: false, error: `LIST_MEDIA_FAILED: ${res.error.message}`, rows: [], count: 0 };
  }
  return {
    ok: true,
    error: null,
    rows: (res.data ?? []) as MediaLibraryRow[],
    count: res.count ?? 0,
  };
}

export type { ListMediaFilters };
