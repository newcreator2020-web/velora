import { NextResponse } from "next/server";
import { buildHealthResponse } from "@/lib/server/health";

export const dynamic = "force-dynamic";

export function GET() {
  const payload = buildHealthResponse();
  return NextResponse.json(payload, {
    status: payload.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
