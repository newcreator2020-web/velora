import { redirect } from "next/navigation";
import { getCurrentTenantContext, requireTenantMembership } from "@/lib/server/auth";
import { listResourcesAction } from "./actions";
import { TeamClient } from "./TeamClient";

const ROLE_CAN_WRITE = new Set(["owner", "manager"]);

export default async function AppTeamPage() {
  const ctx = await getCurrentTenantContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.membership || !ctx.tenant) redirect("/onboarding");
  await requireTenantMembership();
  const canWrite = ROLE_CAN_WRITE.has(ctx.membership.role);
  const initial = await listResourcesAction();
  const timezone = ctx.business_profile?.timezone;
  return <TeamClient initial={initial} canWrite={canWrite} {...(timezone ? { timezone } : {})} />;
}
