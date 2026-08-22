import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugSchema } from "@/lib/server/site-engine";

export const dynamic = "force-dynamic";

const Req = z.object({
  slug: slugSchema,
  service_id: z.string().uuid(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Req.safeParse({
    slug: url.searchParams.get("slug"),
    service_id: url.searchParams.get("service_id"),
  });
  if (!parsed.success) {
    return NextResponse.json({ resources: [] }, { status: 400 });
  }
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb.rpc("public_booking_resources_list", {
      p_slug: parsed.data.slug,
      p_service_id: parsed.data.service_id,
    });
    if (error) {
      return NextResponse.json({ resources: [] }, { status: 500 });
    }
    return NextResponse.json({ resources: (data as unknown[]) ?? [] });
  } catch {
    return NextResponse.json({ resources: [] }, { status: 500 });
  }
}
