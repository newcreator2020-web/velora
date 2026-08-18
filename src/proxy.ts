import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/server";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|css|js|map)$).*)",
  ],
};

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anon = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (url && anon) {
    try {
      const supabase = createSupabaseMiddlewareClient(request, response);
      const result = await supabase.auth.getUser();
      if (result.data?.user) {
        response = NextResponse.next({ request });
      }
    } catch {
      // No-op: if session refresh fails, continue the request; auth helpers
      // server-side will enforce redirect on protected routes.
    }
  }

  return response;
}
