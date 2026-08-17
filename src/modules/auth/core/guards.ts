import { z } from "zod";
import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  PLATFORM_ADMIN_STATUS,
  TENANT_STATUSES,
} from "./roles";

export const UUID_SCHEMA = z.string().uuid();

export const SLUG_SCHEMA = z
  .string()
  .min(3)
  .max(48)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Must be lowercase alphanumeric, start/end with letter/digit, hyphens allowed",
  );

export const EMAIL_SCHEMA = z.string().trim().email().max(255);

export const DISPLAY_NAME_SCHEMA = z.string().trim().min(1).max(128);

export const TENANT_STATUS_SCHEMA = z.enum(TENANT_STATUSES);

export const MEMBERSHIP_ROLE_SCHEMA = z.enum(MEMBERSHIP_ROLES);

export const MEMBERSHIP_STATUS_SCHEMA = z.enum(MEMBERSHIP_STATUSES);

export const PLATFORM_ADMIN_STATUS_SCHEMA = z.enum(PLATFORM_ADMIN_STATUS);

export const TENANT_INSERT_SCHEMA = z.object({
  name: DISPLAY_NAME_SCHEMA,
  slug: SLUG_SCHEMA,
  status: TENANT_STATUS_SCHEMA.default("onboarding"),
});

export const BUSINESS_PROFILE_UPSERT_SCHEMA = z.object({
  tenant_id: UUID_SCHEMA,
  display_name: DISPLAY_NAME_SCHEMA.optional(),
  description: z.string().max(2000).trim().nullish(),
  category: z.string().max(64).default("other"),
  timezone: z.string().max(64).default("Europe/Rome"),
  locale: z.string().max(8).default("it-IT"),
  phone: z.string().max(64).nullish(),
  email: EMAIL_SCHEMA.nullish(),
  website: z.string().max(255).url().nullish(),
  address: z.string().max(500).nullish(),
  city: z.string().max(128).nullish(),
  country_code: z.string().length(2).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

export const MEMBERSHIP_INSERT_SCHEMA = z.object({
  tenant_id: UUID_SCHEMA,
  user_id: UUID_SCHEMA,
  role: MEMBERSHIP_ROLE_SCHEMA,
  status: MEMBERSHIP_STATUS_SCHEMA.default("active"),
});

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

export function safeParse<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { success: true; data: T } | { success: false; issues: z.ZodIssue[] } {
  const r = schema.safeParse(input);
  if (r.success) return { success: true, data: r.data };
  return { success: false, issues: r.error.issues };
}

export type UUID = z.infer<typeof UUID_SCHEMA>;
export type Slug = z.infer<typeof SLUG_SCHEMA>;
export type Email = z.infer<typeof EMAIL_SCHEMA>;
