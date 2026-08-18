"use server";
import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // signOut può fallire per session already invalida → ok, prosegui redirect
  }
  redirect("/login");
}
