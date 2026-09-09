import { z } from "zod";
import type {
  Tables,
  Json,
  MediaCategory as MediaCategoryT,
  MediaStatus as MediaStatusT,
  MediaAssociationType as MediaAssociationTypeT,
} from "@/types/supabase";

export type MediaLibraryRow = Tables<"media_library">;
export type MediaAssocsRow = Tables<"media_assocs">;

export const MEDIA_CATEGORIES = [
  "immagine_generica",
  "servizio",
  "staff",
  "gallery",
  "hero",
  "logo",
  "sfondo",
  "documento",
] as const;

export const MEDIA_STATUSES = ["draft", "published", "archived"] as const;

export const MEDIA_ASSOCIATION_TYPES = [
  "servizio",
  "staff",
  "gallery_item",
  "hero_slide",
  "sezione_sito",
  "business_logo",
  "business_sfondo",
  "prospetto_foto",
] as const;

export type MediaCategory = MediaCategoryT;
export type MediaStatus = MediaStatusT;
export type MediaAssociationType = MediaAssociationTypeT;

export const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
] as const;

export type AllowedMime = (typeof ALLOWED_MIMES)[number];

export const ALLOWED_EXTENSIONS = ["jpeg", "jpg", "png", "webp", "avif", "gif", "pdf"] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const IMAGE_MIMES: ReadonlyArray<AllowedMime> = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
];

export type MediaVariant = {
  key: "small" | "medium" | "large";
  label: string;
  width: number;
  stored_path: string;
  mime_type: string;
  file_size_bytes: number;
  width_px: number;
  height_px: number;
};

export type MediaVariants = {
  variants: MediaVariant[];
};

export type MediaUploadErrorCode =
  "OVERSIZE" | "MIME" | "HASH_DUP" | "STORAGE" | "DB" | "PERMISSION";

export type MediaUploadState =
  | {
      ok: true;
      media: MediaLibraryRow;
      urlSigned?: string;
    }
  | {
      ok: false;
      error: string;
      code?: MediaUploadErrorCode;
    };

export const MediaMetadataPatchSchema = z.object({
  alt_text: z.string().trim().max(255).nullish(),
  caption: z.string().trim().max(1000).nullish(),
  category: z.enum(MEDIA_CATEGORIES).optional(),
  owner_tenant_id: z.string().uuid().nullish(),
  status: z.enum(MEDIA_STATUSES).optional(),
});

export type MediaMetadataPatch = z.input<typeof MediaMetadataPatchSchema>;

export const MediaAssociateSchema = z.object({
  media_id: z.string().uuid(),
  association_type: z.enum(MEDIA_ASSOCIATION_TYPES),
  assoc_key_id: z.string().min(1).max(128),
  tenant_id: z.string().uuid().nullish(),
  ordine: z.number().int().min(0).max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export type MediaAssociateInput = z.input<typeof MediaAssociateSchema>;

export function bytesToSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function slugFilename(rawName: string, maxLen = 60): string {
  const dot = rawName.lastIndexOf(".");
  const base = dot > 0 ? rawName.slice(0, dot) : rawName;
  let s = base.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) s = "file";
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, "");
  return s || "file";
}

export function extensionFromFilename(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return ext || null;
}

export function mimeToExtension(mime: string): AllowedExtension | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    default:
      return null;
  }
}

export function extensionToMime(ext: string): AllowedMime | null {
  const e = ext.toLowerCase();
  switch (e) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIMES as ReadonlyArray<string>).includes(mime);
}

export function verifyMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 4) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];

  switch (mime) {
    case "image/png":
      return b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47;
    case "image/jpeg":
      return b0 === 0xff && b1 === 0xd8 && b2 === 0xff;
    case "image/webp":
      return (
        b0 === 0x52 &&
        b1 === 0x49 &&
        b2 === 0x46 &&
        b3 === 0x46 &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "image/gif":
      return b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38;
    case "image/avif":
      return (
        bytes.length >= 12 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70
      );
    case "application/pdf":
      return b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46;
    default:
      return false;
  }
}

export type { Json };
