import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();

const envPath = path.join(ROOT, ".env");
const envLocalPath = path.join(ROOT, ".env.local");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

console.warn(
  "[vitest-setup-env-local] override applied.",
  "NEXT_PUBLIC_SUPABASE_URL=",
  process.env["NEXT_PUBLIC_SUPABASE_URL"],
  "SUPABASE_DB_HOST=",
  process.env["SUPABASE_DB_HOST"],
  "SUPABASE_DB_PORT=",
  process.env["SUPABASE_DB_PORT"],
);
