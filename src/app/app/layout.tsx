import { redirect } from "next/navigation";
import { getCurrentTenantContext, extractServerSession } from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export default async function AppProtectedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) {
    redirect("/login");
  }
  const sess = await extractServerSession();
  let isPlatformAdmin = false;
  if (sess && sess.user.id === ctx.user.id) {
    const svc = getSupabaseServiceClient();
    const row = await svc
      .from("platform_admins")
      .select("status")
      .eq("user_id", sess.user.id)
      .limit(1)
      .maybeSingle();
    isPlatformAdmin = row.data?.status === "active";
  }
  if (isPlatformAdmin) {
    return <>{children}</>;
  }
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  return <>{children}</>;
}
