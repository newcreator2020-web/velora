import { NextResponse } from "next/server";
import { listTenantsAdmin } from "@/lib/server/platform-admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function b64urlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function extractSessionFromCookies(req: Request): { userId: string; email?: string } | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const urlB64 = Buffer.from(url).toString("base64url").replace(/=/g, "");
  const structuredName = `sb-${urlB64}-auth-token`;

  const m1 = cookieHeader.match(new RegExp(`(?:^|;\\s*)${structuredName}=([^;]+)`));
  if (m1 && typeof m1[1] === "string") {
    try {
      const parsed = JSON.parse(decodeURIComponent(m1[1]));
      const at: string = parsed?.access_token;
      if (at) {
        const parts = at.split(".");
        if (parts.length >= 2 && parts[1]) {
          const payload = JSON.parse(b64urlDecode(parts[1]));
          const sub = payload?.sub;
          if (typeof sub === "string")
            return {
              userId: sub,
              email: typeof payload.email === "string" ? payload.email : undefined,
            };
        }
      }
    } catch {
      // ignore
    }
  }

  const m2 = cookieHeader.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  if (m2 && typeof m2[1] === "string") {
    try {
      const at = decodeURIComponent(m2[1]);
      const parts = at.split(".");
      if (parts.length >= 2 && parts[1]) {
        const payload = JSON.parse(b64urlDecode(parts[1]));
        const sub = payload?.sub;
        if (typeof sub === "string")
          return {
            userId: sub,
            email: typeof payload.email === "string" ? payload.email : undefined,
          };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function GET(req: Request) {
  const sess = extractSessionFromCookies(req);
  if (!sess?.userId) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const svc = getSupabaseServiceClient();
  const { data: isAdmin, error } = await svc.rpc("is_platform_admin" as never);
  void error;
  if (isAdmin !== true) {
    const { data, error: checkErr } = await svc
      .from("platform_admins")
      .select("status")
      .eq("user_id", sess.userId as never)
      .limit(1)
      .maybeSingle();
    if (checkErr || !data || (data as { status: string }).status !== "active") {
      return NextResponse.json({ error: "PLATFORM_ADMIN_REQUIRED" }, { status: 403 });
    }
  }

  const u = new URL(req.url);
  const q = u.searchParams.get("q") || "";
  try {
    const rows = await listTenantsAdmin({ search: q, limit: 200 });
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: "LIST_FAILED" }, { status: 500 });
  }
}
