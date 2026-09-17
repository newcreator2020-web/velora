"use server";
import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { onboardingSchema, requireAuthenticatedUser } from "@/lib/server/auth";

export type OnboardingActionResult = {
  ok: boolean;
  error?: string | undefined;
  fieldErrors?: Record<string, string> | undefined;
  values?: Record<string, unknown> | undefined;
};

export async function onboardingAction(
  _prev: OnboardingActionResult,
  formData: FormData,
): Promise<OnboardingActionResult> {
  await requireAuthenticatedUser();

  const raw = {
    business_name: formData.get("business_name"),
    category: formData.get("category"),
    city: formData.get("city"),
    province: formData.get("province"),
    phone: formData.get("phone"),
    business_email: formData.get("business_email"),
    timezone: formData.get("timezone") ?? "Europe/Rome",
    locale: formData.get("locale") ?? "it-IT",
  };

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join(".");
      if (!fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return {
      ok: false,
      error: "Controlla i campi sottostanti.",
      fieldErrors,
      values: Object.fromEntries(formData.entries()),
    };
  }

  const supabase = await createSupabaseServerClient();
  const svc = getSupabaseServiceClient();
  const currentUser = await supabase.auth.getUser().then((r) => r.data.user);
  const uid = currentUser?.id;

  let existingOwner: { tenant_id: string; tenant_status?: string } | null = null;
  if (uid) {
    const ownerRows = await svc
      .from("tenant_memberships")
      .select("tenant_id,role,status,tenants!inner(id,status)")
      .eq("user_id", uid)
      .eq("status", "active")
      .eq("role", "owner");
    const owners =
      (ownerRows.data as Array<{
        tenant_id: string;
        tenants?: { id: string; status?: string } | null;
      }> | null) ?? [];
    for (const o of owners) {
      const tStatus = ((o.tenants?.status as string | undefined) ?? "onboarding") as string;
      if (tStatus !== "onboarding") {
        existingOwner = { tenant_id: o.tenant_id, tenant_status: tStatus };
        break;
      }
      if (!existingOwner) existingOwner = { tenant_id: o.tenant_id, tenant_status: tStatus };
    }
  }

  type BpPayload = {
    display_name: string;
    category: string;
    city: string;
    province: string;
    updated_at: string;
    phone?: string;
    email?: string;
    timezone?: string;
    locale?: string;
  };

  let data: Record<string, unknown> | null;
  let error: unknown;

  if (existingOwner) {
    const tid = existingOwner.tenant_id;
    const payload: BpPayload = {
      display_name: parsed.data.business_name,
      category: parsed.data.category,
      city: parsed.data.city,
      province: parsed.data.province,
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.phone) payload["phone"] = parsed.data.phone;
    if (parsed.data.business_email) payload["email"] = parsed.data.business_email;
    if (parsed.data.timezone) payload["timezone"] = parsed.data.timezone;
    if (parsed.data.locale) payload["locale"] = parsed.data.locale;

    const bpCheck = await svc
      .from("business_profiles")
      .select("tenant_id")
      .eq("tenant_id", tid)
      .limit(1)
      .maybeSingle();
    if (bpCheck.data) {
      const upd = await svc.from("business_profiles").update(payload).eq("tenant_id", tid);
      error = upd.error ?? null;
    } else {
      const ins = await svc.from("business_profiles").insert({
        tenant_id: tid,
        ...payload,
      });
      error = ins.error ?? null;
    }
    if (!error) {
      const tUpd = await svc
        .from("tenants")
        .update({ status: "active" as const, updated_at: new Date().toISOString() })
        .eq("id", tid);
      if (tUpd.error) error = tUpd.error;
    }
    data = error
      ? null
      : {
          tenant_id: tid,
          tenant_status: existingOwner.tenant_status ?? "active",
          onboarded_via: "upsert_existing",
        };
  } else {
    const rpcParams: {
      p_business_name: string;
      p_category: string;
      p_city: string;
      p_province: string;
      p_phone?: string;
      p_business_email?: string;
      p_timezone?: string;
      p_locale?: string;
    } = {
      p_business_name: parsed.data.business_name,
      p_category: parsed.data.category,
      p_city: parsed.data.city,
      p_province: parsed.data.province,
    };
    if (parsed.data.phone) rpcParams.p_phone = parsed.data.phone;
    if (parsed.data.business_email) rpcParams.p_business_email = parsed.data.business_email;
    if (parsed.data.timezone) rpcParams.p_timezone = parsed.data.timezone;
    if (parsed.data.locale) rpcParams.p_locale = parsed.data.locale;

    const rpc = await supabase.rpc("create_tenant_with_owner", rpcParams);
    data = (rpc.data as Record<string, unknown> | null) ?? null;
    error = rpc.error ?? null;
  }

  if (error || !data) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code).toLowerCase()
        : String(error ?? "").toLowerCase();
    let msg = "Non è stato possibile completare l'onboarding. Riprova.";
    if (code.includes("authentication_required")) {
      redirect("/login");
    } else if (
      code.includes("business_name") ||
      code.includes("slug") ||
      code.includes("invalid")
    ) {
      msg = "Alcuni campi non sono validi. Riprova con valori differenti.";
    } else if (code.includes("conflict")) {
      msg = "Nome attività già in uso. Scegli un nome leggermente differente.";
    }
    return {
      ok: false,
      error: msg,
      values: Object.fromEntries(formData.entries()),
    };
  }

  // Aggiorna stato tenant a 'active' dopo onboarding completato ok
  const payload = (data ?? {}) as Record<string, unknown> | null;
  if (
    payload &&
    typeof payload["tenant_id"] === "string" &&
    payload["tenant_status"] !== "active"
  ) {
    await supabase.from("tenants").update({ status: "active" }).eq("id", payload["tenant_id"]);
  }

  // Forza refresh della sessione prima della redirect per propagare cookie
  await supabase.auth.getUser();
  redirect("/dashboard");
}
