/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "auto";

const TONINO = {
  tenant_id: "d5a0538e-567e-45ee-b00e-61659ed50637",
  slug: "slugo-mtu30v76-1fon",
  owner_user_id: "9df5232e-2303-4a6f-b643-f2386ac92ec1",
  actor_user_id: "9df5232e-2303-4a6f-b643-f2386ac92ec1",
};

function guardDevOnly(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "F4_WORKAROUND_DISABLED_IN_PRODUCTION" },
      { status: 403 },
    );
  }
  const apiKey = req.headers.get("x-f4-dev-key") || "";
  const expected = process.env.F4_DEV_API_KEY || "velora-f4-dev-only";
  if (expected && expected !== "velora-f4-dev-only" && apiKey !== expected) {
    return NextResponse.json({ ok: false, error: "F4_DEV_KEY_MISMATCH" }, { status: 401 });
  }
  return null;
}

async function insertAudit(
  svc: ReturnType<typeof getSupabaseServiceClient>,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await svc.from("audit_logs").insert({
      id: crypto.randomUUID(),
      tenant_id: TONINO.tenant_id,
      user_id: TONINO.actor_user_id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata as unknown as never,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* audit non bloccante */
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = guardDevOnly(req);
  if (guard) return guard;

  const svc = getSupabaseServiceClient();

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY" }, { status: 400 });
  }

  const op = typeof payload.op === "string" ? payload.op : "";

  if (op === "unpublish") {
    const { error } = await svc
      .from("tenants")
      .update({ published: false, updated_at: new Date().toISOString() })
      .eq("id", TONINO.tenant_id);
    if (error) {
      return NextResponse.json(
        { ok: false, error: "UNPUBLISH_UPDATE_FAILED", code: error.code, message: error.message },
        { status: 500 },
      );
    }
    try {
      revalidatePath(`/s/${TONINO.slug}`);
    } catch {
      /* non bloccante */
    }
    const unpublishedAt = new Date().toISOString();
    await insertAudit(svc, "site_unpublished", "tenants", TONINO.tenant_id, {});
    return NextResponse.json({
      ok: true,
      unpublished_at: unpublishedAt,
      payload: { tenant_id: TONINO.tenant_id, published_false: true },
    });
  }

  if (op === "save") {
    const sections = Array.isArray(payload.sections) ? payload.sections : null;
    const services = Array.isArray(payload.services) ? payload.services : null;
    const theme =
      payload.theme && typeof payload.theme === "object" && !Array.isArray(payload.theme)
        ? payload.theme
        : null;
    if (!sections || !services || !theme) {
      return NextResponse.json(
        { ok: false, error: "SAVE_MISSING_SECTIONS_SERVICES_THEME" },
        { status: 400 },
      );
    }
    const newRev = crypto.randomUUID();
    const upsertData = {
      tenant_id: TONINO.tenant_id,
      sections: sections as unknown as never,
      services: services as unknown as never,
      theme: theme as unknown as never,
      draft_revision: newRev,
      updated_at: new Date().toISOString(),
    };
    const { error } = await svc
      .from("site_editorial_state")
      .upsert(upsertData, { onConflict: "tenant_id" });
    if (error) {
      return NextResponse.json(
        { ok: false, error: "SAVE_UPSERT_FAILED", code: error.code, message: error.message },
        { status: 500 },
      );
    }
    await insertAudit(svc, "site_draft_saved", "site_editorial_state", TONINO.tenant_id, {
      revision: newRev,
    });
    return NextResponse.json({ ok: true, revision: newRev });
  }

  if (op === "publish") {
    const expectedRev =
      typeof payload.expected_revision === "string" ? payload.expected_revision : null;
    const rpcArgs: Record<string, unknown> = {
      p_tenant_id: TONINO.tenant_id,
      p_actor_id: TONINO.actor_user_id,
    };
    if (expectedRev) rpcArgs["p_expected_revision"] = expectedRev;
    const rpc = await svc.rpc("publish_site_draft" as never, rpcArgs as never);
    if (rpc.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "PUBLISH_RPC_FAILED",
          code: rpc.error.code,
          message: rpc.error.message,
        },
        { status: 500 },
      );
    }
    const raw = rpc.data as unknown as Record<string, unknown> | Record<string, unknown>[] | null;
    const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
    if (!row || typeof row.ok !== "boolean") {
      return NextResponse.json(
        {
          ok: false,
          error: "PUBLISH_RPC_EMPTY_OR_INVALID",
          rawShape: row ? Object.keys(row) : null,
        },
        { status: 500 },
      );
    }
    if (row.ok !== true) {
      return NextResponse.json({
        ok: false,
        error: "PUBLISH_RPC_NOT_OK",
        code: String(row.code ?? ""),
        message: String(row.message ?? ""),
      });
    }
    try {
      revalidatePath(`/s/${TONINO.slug}`);
    } catch {
      /* non bloccante */
    }
    await insertAudit(svc, "site_published", "tenants", TONINO.tenant_id, {
      sections_applied: Number(row.sections_applied) || 0,
      services_applied: Number(row.services_applied) || 0,
      theme_applied: Boolean(row.theme_applied),
      published_at: (row.new_published_at as string | null) ?? null,
    });
    return NextResponse.json({
      ok: true,
      published_at: (row.new_published_at as string | null) ?? new Date().toISOString(),
      sections_applied: Number(row.sections_applied) || 0,
      services_applied: Number(row.services_applied) || 0,
      theme_applied: Boolean(row.theme_applied),
      version_number: typeof row.new_version_number === "number" ? row.new_version_number : null,
    });
  }

  if (op === "read_state") {
    const [stateQ, tenantQ] = await Promise.all([
      svc
        .from("site_editorial_state")
        .select("sections,theme,draft_revision,updated_at")
        .eq("tenant_id", TONINO.tenant_id)
        .limit(1)
        .maybeSingle(),
      svc
        .from("tenants")
        .select("id,published,slug,published_at")
        .eq("id", TONINO.tenant_id)
        .limit(1)
        .maybeSingle(),
    ]);
    const versionsQ = await svc
      .from("site_publication_versions")
      .select("version_number,status,hash_sha256,published_at,created_at")
      .eq("tenant_id", TONINO.tenant_id)
      .order("version_number", { ascending: false });
    return NextResponse.json({
      ok: true,
      editorial_state_exists: Boolean(stateQ.data),
      editorial_revision:
        (stateQ.data as { draft_revision?: string } | null)?.draft_revision ?? null,
      editorial_hero_title: (() => {
        const data = stateQ.data as unknown as {
          sections: Array<{
            section_type: string;
            settings?: Record<string, unknown>;
            props?: Record<string, unknown>;
          }>;
        } | null;
        if (!data?.sections) return null;
        for (const s of data.sections) {
          if (s.section_type === "hero") {
            const p = s.props as { title?: string } | undefined;
            const st = s.settings as { title?: string } | undefined;
            return p?.title ?? st?.title ?? null;
          }
        }
        return null;
      })(),
      tenant_published: Boolean((tenantQ.data as { published?: unknown } | null)?.published),
      tenant_published_at:
        (tenantQ.data as { published_at?: string | null } | null)?.published_at ?? null,
      versions_count: versionsQ.data?.length ?? 0,
      versions: (versionsQ.data ?? []).slice(0, 6).map((v) => ({
        vn:
          typeof (v as unknown as { version_number?: unknown }).version_number === "number"
            ? (v as unknown as { version_number: number }).version_number
            : null,
        status: (v as unknown as { status?: string }).status ?? null,
        at:
          (v as unknown as { published_at?: string | null }).published_at ??
          (v as unknown as { created_at?: string | null }).created_at ??
          null,
      })),
    });
  }

  if (op === "read_full_state") {
    const [stateQ, tenantQ] = await Promise.all([
      svc
        .from("site_editorial_state")
        .select("sections,services,theme,draft_revision,updated_at")
        .eq("tenant_id", TONINO.tenant_id)
        .limit(1)
        .maybeSingle(),
      svc
        .from("tenants")
        .select("id,published,slug,published_at")
        .eq("id", TONINO.tenant_id)
        .limit(1)
        .maybeSingle(),
    ]);
    const versionsQ = await svc
      .from("site_publication_versions")
      .select("version_number,status,hash_sha256,snapshot,published_at,created_at")
      .eq("tenant_id", TONINO.tenant_id)
      .order("version_number", { ascending: false });
    return NextResponse.json({
      ok: true,
      editorial_state_exists: Boolean(stateQ.data),
      editorial_revision:
        (stateQ.data as { draft_revision?: string } | null)?.draft_revision ?? null,
      sections: (stateQ.data as { sections?: unknown } | null)?.sections ?? null,
      services: (stateQ.data as { services?: unknown } | null)?.services ?? null,
      theme: (stateQ.data as { theme?: unknown } | null)?.theme ?? null,
      tenant_published: Boolean((tenantQ.data as { published?: unknown } | null)?.published),
      tenant_published_at:
        (tenantQ.data as { published_at?: string | null } | null)?.published_at ?? null,
      versions_count: versionsQ.data?.length ?? 0,
      versions: (versionsQ.data ?? []).slice(0, 6).map((v) => ({
        vn:
          typeof (v as unknown as { version_number?: unknown }).version_number === "number"
            ? (v as unknown as { version_number: number }).version_number
            : null,
        status: (v as unknown as { status?: string }).status ?? null,
        at:
          (v as unknown as { published_at?: string | null }).published_at ??
          (v as unknown as { created_at?: string | null }).created_at ??
          null,
      })),
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: `UNKNOWN_OP:${op}`,
      supported: ["unpublish", "save", "publish", "read_state", "read_full_state"],
    },
    { status: 400 },
  );
}
