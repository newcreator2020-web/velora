import { z } from "zod";

function isRfc5322AddressLike(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  const m = v.match(/<([^>]+)>\s*$/);
  const candidate = (m && m[1]) ?? v;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(candidate.trim());
}

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRO_PRICE_ID: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z
    .string()
    .refine(isRfc5322AddressLike, {
      message:
        "Must be a valid email address or RFC 5322 display-name form like 'My Brand <no-reply@example.com>'",
    })
    .optional(),
  BOOKING_CANCEL_JWT_SECRET: z.string().min(32).optional(),
  CRON_API_KEY: z.string().min(16).optional(),
  APP_URL: z.string().url().optional(),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("VELORA"),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;
type PublicEnv = z.infer<typeof publicEnvSchema>;

function parseServerEnv(): ServerEnv {
  const raw = {
    NODE_ENV: process.env["NODE_ENV"],
    SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"],
    STRIPE_SECRET_KEY: process.env["STRIPE_SECRET_KEY"],
    STRIPE_WEBHOOK_SECRET: process.env["STRIPE_WEBHOOK_SECRET"],
    STRIPE_PRO_PRICE_ID: process.env["STRIPE_PRO_PRICE_ID"],
    RESEND_API_KEY: process.env["RESEND_API_KEY"],
    RESEND_FROM_EMAIL: process.env["RESEND_FROM_EMAIL"],
    BOOKING_CANCEL_JWT_SECRET: process.env["BOOKING_CANCEL_JWT_SECRET"],
    CRON_API_KEY: process.env["CRON_API_KEY"],
    APP_URL: process.env["APP_URL"] ?? process.env["NEXT_PUBLIC_APP_URL"],
  };
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid server environment variables: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

function parsePublicEnv(): PublicEnv {
  const raw = {
    NEXT_PUBLIC_APP_NAME: process.env["NEXT_PUBLIC_APP_NAME"],
    NEXT_PUBLIC_APP_ENV: process.env["NEXT_PUBLIC_APP_ENV"],
    NEXT_PUBLIC_SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"],
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  };
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid public environment variables: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export const serverEnv = parseServerEnv();
export const publicEnv = parsePublicEnv();

export type { ServerEnv, PublicEnv };
