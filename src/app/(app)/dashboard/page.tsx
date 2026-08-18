import { redirect } from "next/navigation";
import { requireAuthenticatedUser, getCurrentTenantContext } from "@/lib/server/auth";

export const metadata = { title: "Dashboard — VELORA" };

export default async function DashboardLegacyRedirect() {
  await requireAuthenticatedUser();
  const ctx = await getCurrentTenantContext();
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  redirect("/app");
}
