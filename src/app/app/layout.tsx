import { redirect } from "next/navigation";
import { getCurrentTenantContext, extractServerSession } from "@/lib/server/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AppShell } from "@/components/app-shell/AppShell";

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
  if (isPlatformAdmin && (!ctx.membership || !ctx.tenant || !ctx.business_profile)) {
    return <>{children}</>;
  }
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  const rawDisplay = ctx.user.display_name?.trim() || null;
  const rawEmail = ctx.user.auth_email?.trim() || null;
  const sanitizedDisplay = rawDisplay && !rawDisplay.includes("@") ? rawDisplay : null;
  const localPart = rawEmail ? rawEmail.split("@")[0] || null : null;
  return (
    <AppShell
      businessName={ctx.business_profile.display_name ?? null}
      membershipRole={ctx.membership.role}
      userDisplayName={sanitizedDisplay}
      userLocalPart={localPart}
    >
      {children}
    </AppShell>
  );
}
