"use server";
import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSchema, loginErrorMessage, safeRedirect } from "@/lib/server/auth";

export type LoginActionResult = {
  ok: boolean;
  error?: string | undefined;
  fieldErrors?: Record<string, string> | undefined;
  email?: string | undefined;
};

export async function loginAction(
  _prev: LoginActionResult,
  formData: FormData,
): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

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
      email:
        typeof formData.get("email") === "string" ? (formData.get("email") as string) : undefined,
    };
  }

  const { email, password, next } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    console.error("[loginAction] Supabase Auth error:", {
      name: error?.name,
      message: error?.message,
      status: (error as unknown as { status?: number })?.status,
    });
    return {
      ok: false,
      error: loginErrorMessage(error?.name, error?.message),
      email,
    };
  }

  redirect(safeRedirect(next, "/dashboard"));
}
