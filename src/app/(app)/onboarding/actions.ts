"use server";
import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  const { data, error } = await supabase.rpc("create_tenant_with_owner", rpcParams);

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
