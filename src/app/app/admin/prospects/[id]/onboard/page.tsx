import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { OnboardWizard } from "@/components/admin/prospects/OnboardWizard";

export const dynamic = "force-dynamic";

type ProspectOnboardPageParams = { params: { id: string } };

export default async function ProspectOnboardPage({ params }: ProspectOnboardPageParams) {
  const admin = await requirePlatformAdmin({ hardFail: false });
  if (!admin?.isAdmin) {
    redirect("/login?next=" + encodeURIComponent(`/app/admin/prospects/${params.id}/onboard`));
  }

  const prospectId = params.id;
  const svc = getSupabaseServiceClient();

  const { data: prospect, error: prErr } = await svc
    .from("prospects")
    .select(
      "id, business_name, business_category, comune, telefono, email, status, promoted_to_tenant_id, note",
    )
    .eq("id", prospectId)
    .limit(1)
    .maybeSingle();

  if (prErr || !prospect) {
    redirect("/app/admin/prospects?err=prospect_not_found");
  }
  if (!prospect.promoted_to_tenant_id) {
    redirect(`/app/admin/prospects/${prospectId}?err=not_promoted`);
  }

  const tenantId = prospect.promoted_to_tenant_id as string;

  const { data: tenantRow, error: trErr } = await svc
    .from("tenants")
    .select(
      "id, slug, business_name, custom_domain, temporary_domain, status, published, created_at",
    )
    .eq("id", tenantId)
    .limit(1)
    .maybeSingle();

  if (trErr || !tenantRow) {
    redirect(`/app/admin/prospects/${prospectId}?err=tenant_broken`);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <OnboardWizard
          prospectId={prospectId}
          prospect={{
            business_name: prospect.business_name,
            business_category: prospect.business_category ?? null,
            comune: prospect.comune,
            telefono: prospect.telefono ?? null,
            email: prospect.email ?? null,
            note: prospect.note ?? null,
          }}
          tenant={{
            id: (tenantRow as unknown as Record<string, unknown>)["id"] as string,
            slug: (tenantRow as unknown as Record<string, unknown>)["slug"] as string,
            business_name: (tenantRow as unknown as Record<string, unknown>)[
              "business_name"
            ] as string,
            custom_domain:
              ((tenantRow as unknown as Record<string, unknown>)["custom_domain"] as
                string | null) ?? null,
            temporary_domain:
              ((tenantRow as unknown as Record<string, unknown>)["temporary_domain"] as
                string | null) ?? null,
            status:
              ((tenantRow as unknown as Record<string, unknown>)["status"] as string) ?? "active",
            published: Boolean((tenantRow as unknown as Record<string, unknown>)["published"]),
          }}
        />
      </div>
    </main>
  );
}
