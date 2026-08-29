import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/supabase";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required server env: ${name}`);
  }
  return v;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createServerClient<Database>(url, anon, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    cookies: {
      async getAll() {
        return cookieStore.getAll();
      },
      async setAll(cookiesToSet) {
        let lastError: unknown = null;
        try {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options ?? {});
            } catch (e) {
              lastError = e;
              try {
                const plainOpts: Partial<{
                  path?: string;
                  domain?: string;
                  secure?: boolean;
                  httpOnly?: boolean;
                  sameSite?: "strict" | "lax" | "none";
                  maxAge?: number;
                  expires?: Date;
                  priority?: "low" | "medium" | "high";
                  partitioned?: boolean;
                }> = {};
                if (options && typeof options === "object") {
                  for (const [k, v] of Object.entries(options)) {
                    if (k === "domain") continue;
                    if (k === "priority") continue;
                    if (k === "sameSite") {
                      const s = String(v).toLowerCase();
                      if (s === "strict" || s === "lax" || s === "none") {
                        plainOpts.sameSite = s;
                      }
                      continue;
                    }
                    (plainOpts as Record<string, unknown>)[k] = v;
                  }
                }
                cookieStore.set(name, value, plainOpts);
                lastError = null;
              } catch (e2) {
                lastError = e2;
              }
            }
          }
        } catch (eOuter) {
          lastError = eOuter;
        }
        if (lastError) {
          const isRoMsg = (e: unknown) => {
            const s = e instanceof Error ? e.message : String(e ?? "");
            return /readonly|read[ -]?only|not.*permit|not.*support|cannot.*set|can.*set|only be modified in a Server Action|only be set in a Server Action|Route Handler|Middleware/i.test(
              s,
            );
          };
          if (!isRoMsg(lastError)) {
            throw lastError instanceof Error
              ? new Error(`[supabase:setAll] ${lastError.message}`, { cause: lastError })
              : new Error(`[supabase:setAll] ${String(lastError)}`);
          }
        }
      },
    },
  });
}

/**
 * Lightweight Supabase anon client for readonly public queries when
 * no request context is available (e.g. background jobs, tests, CLI).
 * Never exposes service role; uses public anon key + public RLS boundaries.
 */
export function createSupabaseAnonReadonlyClient() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseMiddlewareClient(request: NextRequest, response: NextResponse) {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createServerClient<Database>(url, anon, {
    auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          response.cookies.set(name, value);
        }
      },
    },
  });
}
