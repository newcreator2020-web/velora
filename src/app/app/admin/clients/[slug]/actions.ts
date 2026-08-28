"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";

const ADMIN_TENANT_COOKIE = "velora_admin_tenant";

export async function setAdminTenantAction(_: unknown, formData: FormData) {
  await requirePlatformAdmin({ hardFail: true });
  const slug = (formData.get("slug") as string | null)?.trim().slice(0, 80);
  if (!slug) {
    return { ok: false, message: "Slug mancante." };
  }
  const c = await cookies();
  c.set({
    name: ADMIN_TENANT_COOKIE,
    value: slug,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/app",
    maxAge: 60 * 60 * 2,
  });
  redirect("/app");
}

export async function clearAdminTenantAction() {
  try {
    await requirePlatformAdmin({ hardFail: true });
  } catch {
    /* puliamo cookie comunque */
  }
  const c = await cookies();
  c.delete(ADMIN_TENANT_COOKIE);
  redirect("/app/admin/clients");
}

export async function getAdminTenantOverride(): Promise<string | null> {
  const c = await cookies();
  return c.get(ADMIN_TENANT_COOKIE)?.value || null;
}
