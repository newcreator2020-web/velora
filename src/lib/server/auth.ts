import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MembershipRole } from "@/modules/auth/core/roles";
import { isAtLeastRole } from "@/modules/auth/core/roles";
import type { Database } from "@/types/supabase";
export {
  SAFE_REDIRECT_PATH,
  safeRedirect,
  normalizeSlug,
  slugUniqueFromName,
  loginSchema,
  onboardingSchema,
  loginErrorMessage,
} from "./auth-pure";
export type { LoginInput, OnboardingInput } from "./auth-pure";

type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

export async function requireAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/login");
  }
  const { data: claims } = await supabase.auth.getSession();
  return { user, session: claims.session };
}

export type TenantContext = {
  user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    created_at: string;
    updated_at: string;
    auth_email: string;
  };
  membership: {
    id: string;
    tenant_id: string;
    role: MembershipRole;
    status: "active" | "invited" | "suspended" | "revoked";
  } | null;
  tenant: Tables<"tenants"> | null;
  business_profile: Tables<"business_profiles"> | null;
};

export async function getCurrentTenantContext(): Promise<TenantContext> {
  const { user } = await requireAuthenticatedUser();
  const supabase = await createSupabaseServerClient();

  const profile = await supabase
    .from("profiles")
    .select("id,display_name,avatar_url,created_at,updated_at")
    .eq("id", user.id)
    .limit(1)
    .maybeSingle();

  const membership = await supabase
    .from("tenant_memberships")
    .select("id,tenant_id,role,status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("role", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mRow = membership.data as TenantContext["membership"] | null;
  let tenant: Tables<"tenants"> | null = null;
  let bp: Tables<"business_profiles"> | null = null;

  if (mRow) {
    const t = await supabase
      .from("tenants")
      .select("id,name,slug,status,created_at,updated_at")
      .eq("id", mRow.tenant_id)
      .limit(1)
      .maybeSingle();
    tenant = (t.data as Tables<"tenants"> | null) ?? null;

    if (tenant) {
      const b = await supabase
        .from("business_profiles")
        .select(
          "tenant_id,display_name,description,category,city,province,address_line1,address_line2,phone,website_url,email,timezone,locale,created_at,updated_at",
        )
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle();
      bp = (b.data as Tables<"business_profiles"> | null) ?? null;
    }
  }

  return {
    user: {
      id: user.id,
      display_name: profile.data?.display_name ?? null,
      avatar_url: profile.data?.avatar_url ?? null,
      created_at: profile.data?.created_at ?? user.created_at ?? new Date().toISOString(),
      updated_at: profile.data?.updated_at ?? user.updated_at ?? new Date().toISOString(),
      auth_email: user.email ?? "",
    },
    membership: mRow,
    tenant,
    business_profile: bp,
  };
}

export async function requireTenantMembership(): Promise<
  TenantContext & {
    membership: NonNullable<TenantContext["membership"]>;
    tenant: NonNullable<TenantContext["tenant"]>;
    business_profile: NonNullable<TenantContext["business_profile"]>;
  }
> {
  const ctx = await getCurrentTenantContext();
  if (!ctx.membership || !ctx.tenant || !ctx.business_profile) {
    redirect("/onboarding");
  }
  return ctx as TenantContext & {
    membership: NonNullable<TenantContext["membership"]>;
    tenant: NonNullable<TenantContext["tenant"]>;
    business_profile: NonNullable<TenantContext["business_profile"]>;
  };
}

export async function requireTenantRole(required: MembershipRole) {
  const ctx = await requireTenantMembership();
  if (!isAtLeastRole(ctx.membership.role, required)) {
    redirect("/login");
  }
  return ctx;
}
