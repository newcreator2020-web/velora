import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCalendarContext } from "@/lib/server/calendar";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type ErrCode =
  | "AUTHZ_DENIED"
  | "INVALID_DATE"
  | "WINDOW_TOO_LARGE"
  | "RESOURCE_NOT_FOUND"
  | "RESULT_TOO_LARGE"
  | "CALENDAR_QUERY_FAILED"
  | "INTERNAL";

function mapError(e: unknown): { code: ErrCode; message: string; http: number } {
  const raw = e instanceof Error ? (e as Error & { code?: string; sqlState?: string }) : null;
  const msg = raw?.message ?? "";
  const sqlState = raw?.sqlState ?? "";
  if (/AUTHZ_DENIED/.test(msg) || sqlState === "28000")
    return { code: "AUTHZ_DENIED", message: "Accesso non autorizzato", http: 403 };
  if (/INVALID_DATE/.test(msg) || (sqlState === "22023" && /INVALID_DATE/.test(msg)))
    return { code: "INVALID_DATE", message: "Intervallo date non valido", http: 400 };
  if (/WINDOW_TOO_LARGE/.test(msg))
    return {
      code: "WINDOW_TOO_LARGE",
      message: "Intervallo troppo ampio. Massimo 14 giorni.",
      http: 400,
    };
  if (/RESOURCE_NOT_FOUND/.test(msg) || sqlState === "02000")
    return {
      code: "RESOURCE_NOT_FOUND",
      message: "Risorsa non valida per l'attività corrente",
      http: 400,
    };
  if (/RESULT_TOO_LARGE/.test(msg) || sqlState === "54000")
    return {
      code: "RESULT_TOO_LARGE",
      message: "Troppi appuntamenti nel periodo. Riduci l'intervallo o filtra gli operatori.",
      http: 413,
    };
  if (/CALENDAR_QUERY_FAILED/.test(msg))
    return { code: "CALENDAR_QUERY_FAILED", message: "Parametri di ricerca non validi", http: 400 };
  console.error("calendar:query_error unhandled", { sqlState, msg });
  return { code: "INTERNAL", message: "Errore nel caricamento del calendario", http: 500 };
}

export async function GET(req: Request) {
  const t0 = performance.now();
  const url = new URL(req.url);
  const raw: Record<string, string | string[] | undefined> = Object.fromEntries(
    [...url.searchParams.entries()].map(([k, v]) => [k, v]),
  );
  let tenant_id: string | null = null;
  let rows_count: number;
  let payload_bytes: number;
  try {
    const ctx = await resolveCalendarContext(raw);
    tenant_id = ctx.tenant_id;
    const sb = await createSupabaseServerClient();

    const diffMs = +ctx.window.range.end - +ctx.window.range.start;
    const diffDays = diffMs / 86400000;
    if (diffDays > 14.5) {
      throw new Error("WINDOW_TOO_LARGE");
    }
    console.warn(
      "CALENDAR_DEBUG tenant_id=",
      ctx.tenant_id,
      "view=",
      ctx.window.view,
      "anchor=",
      ctx.window.anchor_date,
      "tz=",
      ctx.window.tz,
      "diffDays=",
      diffDays.toFixed(2),
      "range_start=",
      ctx.window.range.iso_start,
      "range_end=",
      ctx.window.range.iso_end,
      "statuses=",
      JSON.stringify(ctx.window.statuses),
      "res=",
      JSON.stringify(ctx.window.resource_ids),
    );
    const rp = await (
      sb as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data?: unknown[];
          error?: { code?: string; message?: string };
        }>;
      }
    ).rpc("dashboard_calendar_get_range", {
      p_range_start: ctx.window.range.start.toISOString(),
      p_range_end: ctx.window.range.end.toISOString(),
      p_resource_ids: ctx.window.resource_ids ?? null,
      p_statuses: ctx.window.statuses,
    });
    if (rp.error) {
      const rpCode = rp.error?.code ?? "";
      const rpMsg = rp.error?.message ?? String(rp.error);
      throw Object.assign(new Error(String(rpMsg)), { sqlState: String(rpCode) });
    }
    const rows_raw = (rp.data ?? []) as unknown[];
    rows_count = rows_raw.length;

    const rs = await sb
      .from("staff_resources")
      .select("id,slug,display_name,active,bookable,sort_order,color_hex,created_at,updated_at")
      .eq("tenant_id", ctx.tenant_id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("display_name");
    const resources = (rs.data ?? []) as unknown[];
    if (rs.error) {
      const rsCode = rs.error?.code ?? "";
      console.error("calendar:resources_error", { sqlState: String(rsCode) });
    }

    const out = {
      ok: true as const,
      timezone: ctx.window.tz,
      view: ctx.window.view,
      range: {
        start: ctx.window.range.iso_start,
        end: ctx.window.range.iso_end,
        anchor: ctx.window.anchor_date,
        days: ctx.window.view === "week" ? 7 : 1,
      },
      rows: rows_raw,
      resources,
      generated_at: new Date().toISOString(),
    };
    const json = JSON.stringify(out);
    payload_bytes = Buffer.byteLength(json, "utf-8");
    const latency = Math.round(performance.now() - t0);
    console.warn(
      `calendar_range_latency_ms=${latency} calendar_rows_returned=${rows_count} calendar_payload_bytes=${payload_bytes} tenant_id=${tenant_id} view=${ctx.window.view}`,
    );
    return new NextResponse(json, {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    const info = mapError(e);
    const latency = Math.round(performance.now() - t0);
    console.warn(
      `calendar_query_error=${info.code} calendar_range_latency_ms=${latency} calendar_rows_returned=0 calendar_payload_bytes=0 tenant_id=${tenant_id ?? "unknown"} http=${info.http}`,
    );
    return NextResponse.json(
      {
        ok: false,
        code: info.code,
        message: info.message,
      },
      { status: info.http },
    );
  }
}
