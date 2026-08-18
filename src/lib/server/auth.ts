import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MembershipRole } from "@/modules/auth/core/roles";
import { isAtLeastRole } from "@/modules/auth/core/roles";
import type { Database } from "@/types/supabase";
import { businessProfileUpdateSchema } from "./auth-pure";
export {
  SAFE_REDIRECT_PATH,
  safeRedirect,
  normalizeSlug,
  slugUniqueFromName,
  loginSchema,
  onboardingSchema,
  loginErrorMessage,
  businessProfileUpdateSchema,
} from "./auth-pure";
export type { LoginInput, OnboardingInput, BusinessProfileUpdateInput } from "./auth-pure";

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

export type UpdateBusinessProfileResult =
  | { ok: true; updated_at: string }
  | {
      ok: false;
      code: "VALIDATION" | "AUTH" | "NOT_FOUND" | "CONCURRENT" | "INTERNAL";
      message: string;
      fieldErrors?: Partial<Record<string, string[]>>;
    };

export async function updateBusinessProfile(
  raw: FormData | Record<string, unknown>,
): Promise<UpdateBusinessProfileResult> {
  const ctx = await requireTenantRole("manager");
  const formInput: Record<string, unknown> =
    raw instanceof FormData ? Object.fromEntries((raw as FormData).entries()) : raw;

  const parsed = businessProfileUpdateSchema.safeParse(formInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const iss of parsed.error.issues) {
      const path = iss.path.join(".") || "_";
      const arr = fieldErrors[path];
      if (arr) arr.push(iss.message);
      else fieldErrors[path] = [iss.message];
    }
    return {
      ok: false,
      code: "VALIDATION",
      message: "Controlla i campi sottostanti.",
      fieldErrors,
    };
  }
  const data = parsed.data;

  const supabaseSvc = await import("@/lib/supabase/service").then((m) =>
    m.getSupabaseServiceClient(),
  );

  const { tenant_id: tid } = ctx.business_profile;
  const actor = ctx.user.id;

  try {
    const tenantUpdatePayload: Partial<{ name: string }> = {};
    if (data.business_name) tenantUpdatePayload.name = data.business_name;

    const bpPayload: Partial<{
      display_name: string | null;
      phone: string | null;
      email: string | null;
      address_line1: string | null;
      city: string | null;
      province: string | null;
      postal_code: string | null;
      description: string | null;
    }> = {};
    if (Object.prototype.hasOwnProperty.call(data, "phone")) bpPayload.phone = data.phone ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "email")) bpPayload.email = data.email ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "address_line1"))
      bpPayload.address_line1 = data.address_line1 ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "city")) bpPayload.city = data.city ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "province"))
      bpPayload.province = data.province ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "postal_code"))
      bpPayload.postal_code = data.postal_code ?? null;
    if (Object.prototype.hasOwnProperty.call(data, "description"))
      bpPayload.description = data.description ?? null;
    if (data.business_name) bpPayload.display_name = data.business_name;

    const updatedAtISO = new Date().toISOString();

    const { error: bpErr } = await supabaseSvc
      .from("business_profiles")
      .update({ ...bpPayload, updated_at: updatedAtISO })
      .eq("tenant_id", tid);

    if (bpErr) {
      if ((bpErr.code ?? "") === "42501") {
        return {
          ok: false,
          code: "AUTH",
          message: "Non sei autorizzato a modificare questi dati.",
        };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Non siamo riusciti a salvare le modifiche. Riprova tra un momento.",
      };
    }

    if (Object.keys(tenantUpdatePayload).length > 0) {
      const payloadName = tenantUpdatePayload.name;
      if (payloadName !== undefined) {
        const { error: tErr } = await supabaseSvc
          .from("tenants")
          .update({ name: payloadName, updated_at: updatedAtISO })
          .eq("id", tid);
        if (tErr) {
          return {
            ok: false,
            code: "INTERNAL",
            message: "Non siamo riusciti a salvare le modifiche. Riprova tra un momento.",
          };
        }
      }
    }

    const auditMeta: Record<string, unknown> = {};
    if (bpPayload.display_name !== undefined) auditMeta["display_name"] = bpPayload.display_name;
    if (bpPayload.phone !== undefined) auditMeta["phone"] = bpPayload.phone;
    if (bpPayload.email !== undefined)
      auditMeta["email"] = bpPayload.email ? "[email masked]" : null;
    if (bpPayload.city !== undefined) auditMeta["city"] = bpPayload.city;
    if (bpPayload.province !== undefined) auditMeta["province"] = bpPayload.province;
    if (bpPayload.postal_code !== undefined) auditMeta["postal_code"] = bpPayload.postal_code;
    if (bpPayload.address_line1 !== undefined)
      auditMeta["address_line1"] = bpPayload.address_line1 ? "[address masked]" : null;
    if (bpPayload.description !== undefined)
      auditMeta["description_len"] = bpPayload.description?.length ?? 0;

    await supabaseSvc.from("audit_logs").insert({
      tenant_id: tid,
      actor_user_id: actor,
      action: "business_profile_updated",
      entity_type: "business_profile",
      entity_id: tid,
      metadata: auditMeta as unknown as import("@/types/supabase").Json,
    });

    return { ok: true, updated_at: updatedAtISO };
  } catch (err) {
    const c = (err as { code?: string } | undefined)?.code ?? "";
    if (c === "23505") {
      return {
        ok: false,
        code: "CONCURRENT",
        message: "Modifica in corso da un'altra sessione. Riprova.",
      };
    }
    return {
      ok: false,
      code: "INTERNAL",
      message: "Si è verificato un errore imprevisto. Riprova tra un momento.",
    };
  }
}
