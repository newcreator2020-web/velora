export const MEMBERSHIP_ROLES = ["owner", "manager", "staff"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PLATFORM_ADMIN_STATUS = ["active", "suspended", "revoked"] as const;

export type PlatformAdminStatus = (typeof PLATFORM_ADMIN_STATUS)[number];

export const MEMBERSHIP_STATUSES = ["active", "invited", "suspended", "revoked"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const TENANT_STATUSES = ["active", "onboarding", "suspended", "pending_deletion"] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ROLE_RANK: Record<MembershipRole | "platform_admin", number> = {
  staff: 10,
  manager: 50,
  owner: 100,
  platform_admin: 10_000,
};

export function roleRank(role: MembershipRole | "platform_admin"): number {
  return ROLE_RANK[role];
}

export function isAtLeastRole(actor: MembershipRole, required: MembershipRole): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[required];
}

export function canGrantRole(
  actorRole: MembershipRole | "platform_admin",
  targetRole: MembershipRole,
): boolean {
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRole === "platform_admin") return true;
  return actorRank > targetRank;
}
