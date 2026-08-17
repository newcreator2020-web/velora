import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("VELORA"),
  NEXT_PUBLIC_APP_ENV: z.enum(["development", "test", "production"]).default("development"),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;
type PublicEnv = z.infer<typeof publicEnvSchema>;

function parseServerEnv(): ServerEnv {
  const raw = {
    NODE_ENV: process.env["NODE_ENV"],
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
