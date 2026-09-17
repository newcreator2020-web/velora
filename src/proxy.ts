import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|css|js|map)$).*)",
  ],
};

const CSRF_COOKIE_NAME = "velora_csrf_token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_MAX_AGE_SEC = 60 * 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

const RATE_LIMIT_PATTERNS: Array<RegExp> = [
  /^\/s\/[^/]+\/booking(\/.*)?$/,
  /^\/login$/,
  /^\/api\/app\/.*$/,
];

const WEBHOOK_BYPASS_PATTERN = /^\/api\/(billing\/stripe\/webhook|cron\/.*)$/;

const publicAppUrl = process.env["NEXT_PUBLIC_APP_URL"]
  ? safeParseHost(process.env["NEXT_PUBLIC_APP_URL"])
  : null;
const veloraSitesHostPattern = /^[a-z0-9-]+\.sites\.velora\.app$/;
const vercelHostPattern = /^(.+)\.vercel\.app$/;

const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

type RateBucket = { timestamps: number[] };
const rateBuckets = new Map<string, RateBucket>();

function safeParseHost(input: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHostAllowed(host: string): boolean {
  const h = safeParseHost(host);
  if (!h) return false;
  if (allowedLocalHosts.has(h)) return true;
  if (publicAppUrl && h === publicAppUrl) return true;
  if (veloraSitesHostPattern.test(h)) return true;
  if (vercelHostPattern.test(h)) return true;
  return false;
}

function generateToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in (crypto ?? {})) {
    return (crypto as Crypto).randomUUID().replace(/-/g, "");
  }
  return randomUUID().replace(/-/g, "");
}

function hashFingerprint(ip: string, ua: string): string {
  const base = `${ip}|${ua}`;
  let hash = 2166136261;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isRateLimited(key: string, now: number): { limited: boolean; retryAfterSec: number } {
  const bucket = rateBuckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (bucket.timestamps.length >= RATE_LIMIT_MAX) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    rateBuckets.set(key, bucket);
    return { limited: true, retryAfterSec: retryAfter };
  }
  bucket.timestamps.push(now);
  rateBuckets.set(key, bucket);
  return { limited: false, retryAfterSec: 0 };
}

function rateLimitCleanup(now: number) {
  for (const [k, b] of rateBuckets) {
    b.timestamps = b.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (b.timestamps.length === 0) rateBuckets.delete(k);
  }
}

async function csrfTokenFromRequest(req: NextRequest): Promise<string | null> {
  const header = req.headers.get(CSRF_HEADER);
  if (header && header.length >= 16) return header;
  const method = req.method.toUpperCase();
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isWrite) return null;
  const _csrfFromQs = req.nextUrl.searchParams.get("_csrf");
  if (_csrfFromQs && _csrfFromQs.length >= 16) return _csrfFromQs;
  const ct = req.headers.get("content-type") ?? "";
  if (
    !ct.includes("application/x-www-form-urlencoded") &&
    !ct.includes("multipart/form-data") &&
    !ct.includes("text/plain")
  ) {
    return null;
  }
  try {
    const cloned = req.clone();
    const fd = await cloned.formData();
    const fromBody = fd.get("_csrf");
    if (typeof fromBody === "string" && fromBody.length >= 16) return fromBody;
  } catch {
    // formData parsing fallito (es. binary / RSC body speciale). Fallback: nessun token da body
  }
  return null;
}

function setCsrfCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_MAX_AGE_SEC,
  });
}

export async function proxy(request: NextRequest) {
  const now = Date.now();
  if (rateBuckets.size > 2000) rateLimitCleanup(now);

  const host = request.headers.get("host") ?? "";
  if (!isHostAllowed(host)) {
    return new NextResponse(
      JSON.stringify({ error: "invalid_host", message: "Host header non valido." }),
      { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });

  const requestId = (request.headers.get("x-request-id") as string | null) ?? generateToken();
  response.headers.set("x-request-id", requestId);

  const existingToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfToken = existingToken && existingToken.length >= 16 ? existingToken : generateToken();
  setCsrfCookie(response, csrfToken);

  const newRequestHeaders = new Headers(request.headers);
  const existingCookieHeader = newRequestHeaders.get("cookie") ?? "";
  const csrfCookieEntry = `${CSRF_COOKIE_NAME}=${csrfToken}`;
  if (new RegExp(`(^|;\\s*)${CSRF_COOKIE_NAME}=`).test(existingCookieHeader)) {
    newRequestHeaders.set(
      "cookie",
      existingCookieHeader.replace(
        new RegExp(`(^|;\\s*)${CSRF_COOKIE_NAME}=[^;]*`),
        (_m, g1) => `${g1}${csrfCookieEntry}`,
      ),
    );
  } else {
    newRequestHeaders.set(
      "cookie",
      existingCookieHeader ? `${existingCookieHeader}; ${csrfCookieEntry}` : csrfCookieEntry,
    );
  }
  response = NextResponse.next({ request: { headers: newRequestHeaders } });
  response.headers.set("x-request-id", requestId);
  setCsrfCookie(response, csrfToken);

  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;

  if (WEBHOOK_BYPASS_PATTERN.test(pathname)) {
    return response;
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const isPublicBookingServerAction = /^\/s\/[^/]+\/booking\/?$/.test(pathname);
    if (!isPublicBookingServerAction) {
      const submitted = await csrfTokenFromRequest(request);
      if (!submitted || submitted !== csrfToken) {
        const accept = request.headers.get("accept") ?? "";
        if (accept.includes("text/html")) {
          const redir = new NextResponse(
            `<!doctype html><html><head><meta charset="utf-8"><title>Richiesta scaduta</title></head><body style="font-family:system-ui;padding:40px;"><h2>Richiesta scaduta o non valida (CSRF).</h2><p>Torna indietro, ricarica la pagina e riprova.</p></body></html>`,
            { status: 403, headers: { "content-type": "text/html; charset=utf-8" } },
          );
          setCsrfCookie(redir, generateToken());
          return redir;
        }
        return NextResponse.json(
          {
            error: "csrf_mismatch",
            message: "Token di sicurezza CSRF mancante o non valido. Ricarica la pagina e riprova.",
          },
          { status: 403 },
        );
      }
    }
  }

  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(pathname)) {
      const ip =
        (request.headers.get("x-forwarded-for") as string | null)?.split(",")[0]?.trim() ??
        (request.headers.get("x-real-ip") as string | null) ??
        "anon";
      const ua = (request.headers.get("user-agent") as string | null) ?? "";
      const key = `${hashFingerprint(ip, ua)}:${pathname}`;
      const rl = isRateLimited(key, now);
      if (rl.limited) {
        return NextResponse.json(
          {
            error: "too_many_requests",
            message: "Troppe richieste. Riprova tra qualche secondo.",
            retry_after: rl.retryAfterSec,
          },
          {
            status: 429,
            headers: {
              "retry-after": String(rl.retryAfterSec),
            },
          },
        );
      }
      break;
    }
  }

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anon = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (url && anon) {
    try {
      const supabase = createSupabaseMiddlewareClient(request, response);
      const result = await supabase.auth.getUser();
      if (result.data?.user) {
        response = NextResponse.next({ request });
        const requestId2 = request.headers.get("x-request-id") ?? requestId;
        response.headers.set("x-request-id", requestId2);
        const reCookieNow = request.cookies.get(CSRF_COOKIE_NAME)?.value;
        if (reCookieNow && reCookieNow.length >= 16) {
          setCsrfCookie(response, reCookieNow);
        } else {
          setCsrfCookie(response, csrfToken);
        }
      }
    } catch {
      // No-op: auth helpers server-side enforce redirect on protected routes.
    }
  }

  return response;
}
