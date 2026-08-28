"use server";

import {
  provisionCustomer,
  listTenantsAdmin,
  type ProvisionCustomerInput,
  type ProvisionCustomerResult,
} from "@/lib/server/platform-admin";
import { PLAN_IDS } from "@/lib/platform-constants";
import { randomUUID } from "node:crypto";

export type { ProvisionCustomerResult };

export async function listCustomersAction(search?: string) {
  const s = (search || "").trim();
  return listTenantsAdmin({ search: s, limit: 200 });
}

export async function createCustomerAction(
  _state: ProvisionCustomerResult | null,
  formData: FormData,
): Promise<ProvisionCustomerResult> {
  const idempotencyKey = (formData.get("idempotencyKey") as string | null)?.trim() || randomUUID();
  const planRaw = (formData.get("plan") as string | null)?.trim();
  const plan = (PLAN_IDS as string[]).includes(planRaw || "")
    ? (planRaw as (typeof PLAN_IDS)[number])
    : "base";
  const slugRaw = (formData.get("slug") as string | null)?.trim();
  const phoneRaw = (formData.get("phone") as string | null)?.trim();
  const businessEmailRaw = (formData.get("businessEmail") as string | null)?.trim();
  const input: ProvisionCustomerInput = {
    businessName: (formData.get("businessName") as string | null) || "",
    ownerEmail: (formData.get("ownerEmail") as string | null) || "",
    plan,
    idempotencyKey,
    category: (formData.get("category") as string | null)?.trim() || "service_business",
    city: (formData.get("city") as string | null)?.trim() || "Non specificata",
    province: (formData.get("province") as string | null)?.trim() || "--",
    timezone: (formData.get("timezone") as string | null)?.trim() || "Europe/Rome",
    locale: (formData.get("locale") as string | null)?.trim() || "it-IT",
    ...(slugRaw ? { slug: slugRaw } : {}),
    ...(phoneRaw ? { phone: phoneRaw } : {}),
    ...(businessEmailRaw ? { businessEmail: businessEmailRaw } : {}),
  };
  return provisionCustomer(input);
}
