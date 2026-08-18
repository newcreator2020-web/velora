import { redirect } from "next/navigation";
import { getCurrentTenantContext } from "@/lib/server/auth";

export default async function AppProtectedLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) {
    redirect("/login");
  }
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  return <>{children}</>;
}
