import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeHostname } from "@/lib/server/site-engine";

export const dynamic = "force-dynamic";

const INTERACTION_ACTIONS = [
  "click_book",
  "click_call",
  "click_whatsapp",
  "click_maps",
  "booking_started",
  "booking_confirmed",
  "booking_completed",
  "booking_cancelled",
  "page_view",
] as const;

type InteractionAction = (typeof INTERACTION_ACTIONS)[number];

const TrackPayloadSchema = z.object({
  action: z.enum(INTERACTION_ACTIONS),
  label: z.string().max(500).optional().nullable(),
  page_slug: z.string().max(120).optional().nullable(),
  referer: z.string().max(500).optional().nullable(),
  user_anon_id: z.string().uuid().optional().nullable(),
  correlation_id: z.string().uuid().optional().nullable(),
  meta: z.unknown().optional().nullable(),
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

function safeNormalizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().slice(0, 60);
  if (s.length < 2) return null;
  if (!SLUG_RE.test(s)) return null;
  return s;
}

// ---- Rate limit LRU ----
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60;
const RL_LRU_MAX = 1000;
type RlEntry = { count: number; windowStart: number };
const rlStore: Map<string, RlEntry> = new Map();
let rlLastEvict = Date.now();

function evictOldRl() {
  const now = Date.now();
  if (now - rlLastEvict < RL_WINDOW_MS) return;
  rlLastEvict = now;
  if (rlStore.size <= RL_LRU_MAX) return;
  const cutoff = now - RL_WINDOW_MS;
  const toDelete: string[] = [];
  for (const [k, v] of rlStore) {
    if (v.windowStart < cutoff) toDelete.push(k);
    if (toDelete.length >= 200) break;
  }
  for (const k of toDelete) rlStore.delete(k);
  if (rlStore.size > RL_LRU_MAX) {
    let removed = 0;
    const need = rlStore.size - RL_LRU_MAX;
    for (const k of rlStore.keys()) {
      rlStore.delete(k);
      removed++;
      if (removed >= need) break;
    }
  }
}

function rateLimitPass(key: string): boolean {
  evictOldRl();
  const now = Date.now();
  const cur = rlStore.get(key);
  if (!cur || cur.windowStart < now - RL_WINDOW_MS) {
    rlStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (cur.count >= RL_MAX) {
    return false;
  }
  cur.count += 1;
  return true;
}

// ---- IP extraction ----
function extractClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const doCf = req.headers.get("cf-connecting-ip");
  if (doCf) return doCf.trim();
  return "127.0.0.1";
}

// ---- Tenant resolver ----
async function resolveTenantIdFromRequest(
  req: Request,
): Promise<{ id: string } | { error: { code: "TENANT_NOT_FOUND"; message: string } }> {
  const slugHeader = safeNormalizeSlug(req.headers.get("x-velora-slug"));
  const hostRaw = req.headers.get("x-forwarded-host") || req.headers.get("host") || null;
  const hostNorm = hostRaw ? normalizeHostname(hostRaw) : null;

  if (!slugHeader && !hostNorm) {
    return { error: { code: "TENANT_NOT_FOUND", message: "missing slug or host" } };
  }

  const svc = getSupabaseServiceClient();
  let q = svc.from("tenants").select("id,status,published").limit(1);

  if (slugHeader) {
    q = q.eq("slug", slugHeader);
  } else if (hostNorm) {
    q = q.or(`temporary_domain.eq.${hostNorm},custom_domain.eq.${hostNorm}`);
  }

  const { data, error } = await q.maybeSingle();
  if (error || !data) {
    return { error: { code: "TENANT_NOT_FOUND", message: "tenant lookup failed" } };
  }
  const status = (data as { status?: unknown }).status;
  const published = Boolean((data as { published?: unknown }).published);
  if (status !== "active" || !published) {
    return { error: { code: "TENANT_NOT_FOUND", message: "tenant not published" } };
  }
  return { id: (data as { id: string }).id };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-velora-slug",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store, max-age=0",
  };
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  const baseHeaders = corsHeaders();
  try {
    const ip = extractClientIp(req);
    if (!rateLimitPass(`rl:ip:${ip}`)) {
      return NextResponse.json(
        { ok: false as const, code: "RATE_LIMITED" as const, message: "too many requests" },
        { status: 429, headers: baseHeaders },
      );
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false as const, code: "VALIDATION" as const, message: "invalid json body" },
        { status: 400, headers: baseHeaders },
      );
    }

    const parsed = TrackPayloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false as const,
          code: "VALIDATION" as const,
          message: "invalid payload",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400, headers: baseHeaders },
      );
    }

    const tenantRes = await resolveTenantIdFromRequest(req);
    if ("error" in tenantRes) {
      return NextResponse.json(
        { ok: false as const, code: "TENANT_NOT_FOUND" as const, message: tenantRes.error.message },
        { status: 404, headers: baseHeaders },
      );
    }
    const tenantId = tenantRes.id;

    const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;
    const ref = req.headers.get("referer")?.slice(0, 500) ?? null;
    const { action, label, page_slug, referer, user_anon_id, correlation_id, meta } = parsed.data;

    const safeMeta =
      meta && typeof meta === "object"
        ? (JSON.parse(JSON.stringify(meta)) as Record<string, unknown>)
        : {};

    const insertPayload: {
      tenant_id: string;
      action: InteractionAction;
      label?: string | null;
      page_slug?: string | null;
      referer?: string | null;
      user_anon_id?: string | null;
      correlation_id?: string | null;
      ip_address?: string | null;
      user_agent?: string | null;
      meta?: Record<string, unknown>;
    } = {
      tenant_id: tenantId,
      action,
      label: label && label.length > 0 ? label : null,
      page_slug: page_slug && page_slug.length > 0 ? page_slug : null,
      referer: (referer && referer.length > 0 ? referer : null) ?? ref,
      user_anon_id: user_anon_id ?? null,
      correlation_id: correlation_id ?? null,
      ip_address: ip,
      user_agent: ua,
      meta: safeMeta,
    };

    const svc = getSupabaseServiceClient() as unknown as {
      from: (t: string) => {
        insert: (payload: unknown) => {
          select: (cols: string) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{
                data?: unknown;
                error?: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
    const inserted = await svc
      .from("interaction_events")
      .insert(insertPayload)
      .select("id")
      .limit(1)
      .maybeSingle();

    if (inserted.error) {
      return NextResponse.json(
        { ok: false as const, code: "DB_ERROR" as const, message: "insert failed" },
        { status: 500, headers: baseHeaders },
      );
    }
    const row = inserted.data as { id: string } | null;
    return NextResponse.json(
      { ok: true as const, id: row?.id ?? null },
      { status: 201, headers: baseHeaders },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false as const,
        code: "INTERNAL" as const,
        message: err instanceof Error ? String(err.message) : "unexpected error",
      },
      { status: 500, headers: baseHeaders },
    );
  }
}
