import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

function requireServiceEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required server/service env: ${name}`);
  }
  return v;
}

let serviceClient: ReturnType<typeof createClient<Database>> | undefined;

export function getSupabaseServiceClient() {
  if (serviceClient) return serviceClient;
  const url = requireServiceEnv("NEXT_PUBLIC_SUPABASE_URL");
  const sk = requireServiceEnv("SUPABASE_SERVICE_ROLE_KEY");
  serviceClient = createClient<Database>(url, sk, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return serviceClient;
}

export { createClient };
