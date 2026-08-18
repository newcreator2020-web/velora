"use server";

import type { ZodIssue } from "zod";
import {
  businessProfileUpdateSchema,
  type BusinessProfileUpdateInput,
  requireTenantMembership,
  updateBusinessProfile,
} from "@/lib/server/auth";

export type SettingsActionResult =
  | {
      ok: true;
      updated_at: string;
      values?: Partial<Record<string, string | null>>;
      error?: undefined;
      fieldErrors?: undefined;
      success?: undefined;
    }
  | {
      ok: false;
      error: string;
      code?: "VALIDATION" | "AUTH" | "CONCURRENT" | "INTERNAL" | undefined;
      fieldErrors?: Partial<Record<string, string[]>> | undefined;
      values?: Partial<Record<string, string | null>>;
      success?: undefined;
    };

const initialValues = async (): Promise<Partial<Record<string, string | null>>> => {
  const ctx = await requireTenantMembership();
  const bp = ctx.business_profile;
  const name = bp.display_name ?? ctx.tenant.name ?? "";
  return {
    business_name: name,
    phone: bp.phone ?? null,
    email: bp.email ?? null,
    address: bp.address_line1 ?? null,
    city: bp.city ?? null,
    province: bp.province ?? null,
    postal_code: bp.postal_code ?? null,
    description: bp.description ?? null,
  };
};

export async function settingsAction(
  _state: SettingsActionResult,
  formData: FormData,
): Promise<SettingsActionResult> {
  const valuesSnapshot: Partial<Record<string, string | null>> = {
    business_name: (formData.get("business_name") as string | null) ?? null,
    phone: (formData.get("phone") as string | null) ?? null,
    email: (formData.get("email") as string | null) ?? null,
    address: (formData.get("address") as string | null) ?? null,
    city: (formData.get("city") as string | null) ?? null,
    province: (formData.get("province") as string | null) ?? null,
    postal_code: (formData.get("postal_code") as string | null) ?? null,
    description: (formData.get("description") as string | null) ?? null,
  };

  const res = await updateBusinessProfile(formData);
  if (res.ok) {
    const normalized = await initialValues();
    return {
      ok: true,
      updated_at: res.updated_at,
      values: normalized,
    };
  }

  const resCode = res.code === "NOT_FOUND" ? "INTERNAL" : res.code;
  const fieldErrorsMap = res.fieldErrors;
  let fieldErrors: Partial<Record<string, string[]>> | undefined = undefined;
  if (fieldErrorsMap !== undefined && fieldErrorsMap !== null) {
    fieldErrors = {};
    for (const k of Object.keys(fieldErrorsMap)) {
      const arr = fieldErrorsMap[k];
      if (arr !== undefined && arr !== null) {
        fieldErrors[k] = arr;
      }
    }
  }

  if (fieldErrors !== undefined) {
    return {
      ok: false,
      error: res.message,
      code: resCode,
      fieldErrors,
      values: valuesSnapshot,
    };
  }

  return {
    ok: false,
    error: res.message,
    code: resCode,
    values: valuesSnapshot,
  };
}

export async function loadInitialSettingsState(): Promise<
  SettingsActionResult & { values: Partial<Record<string, string | null>> }
> {
  const values = await initialValues();
  const parsed = businessProfileUpdateSchema.safeParse(values as BusinessProfileUpdateInput);
  if (parsed.success) {
    return {
      ok: false,
      error: "",
      values,
    };
  }
  const fieldErrors = parsed.error.issues.reduce<Record<string, string[]>>(
    (acc: Record<string, string[]>, i: ZodIssue) => {
      const k = i.path.join(".") || "_";
      const arr = acc[k];
      if (arr) arr.push(i.message);
      else acc[k] = [i.message];
      return acc;
    },
    {},
  );
  return {
    ok: false,
    error: "",
    values,
    fieldErrors,
  };
}

export async function initialSettingsResult(): Promise<
  SettingsActionResult & { values: Partial<Record<string, string | null>> }
> {
  return loadInitialSettingsState();
}
