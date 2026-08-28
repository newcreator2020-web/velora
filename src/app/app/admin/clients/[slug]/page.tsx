import { notFound } from "next/navigation";
import AdminCustomerDetailClient from "./AdminCustomerDetailClient";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";

export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  try {
    await requirePlatformAdmin({ hardFail: true });
  } catch {
    notFound();
  }

  const svc = getSupabaseServiceClient();
  const { data: tenant, error: tErr } = await svc
    .from("tenants")
    .select("id,name,slug,status,plan_id,created_at")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (tErr || !tenant) notFound();

  const { data: bp } = await svc
    .from("business_profiles")
    .select("category,city,province,email,phone,timezone,locale")
    .eq("tenant_id", tenant.id)
    .limit(1)
    .maybeSingle();

  const { data: owner } = (await svc
    .from("tenant_memberships")
    .select("user_id,profiles:user_id(display_name,email)")
    .eq("tenant_id", tenant.id)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle()) as unknown as {
    data: null | {
      user_id: string;
      profiles: { display_name: string | null; email: string | null };
    };
    error: unknown;
  };

  const ownerRow = owner
    ? {
        user_id: owner.user_id,
        display_name: owner.profiles?.display_name || null,
        email_hint: owner.profiles?.email || bp?.email || null,
      }
    : null;

  return (
    <AdminCustomerDetailClient
      tenant={tenant}
      business_profile={
        bp
          ? {
              category: bp.category ?? null,
              city: bp.city ?? null,
              province: bp.province ?? null,
              email: bp.email ?? null,
              phone: bp.phone ?? null,
              timezone: bp.timezone || "Europe/Rome",
              locale: bp.locale || "it-IT",
            }
          : null
      }
      owner={ownerRow}
    />
  );
}
