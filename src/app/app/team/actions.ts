"use server";
import "server-only";
import {
  listTenantResources,
  listTenantServices,
  listResourceServiceEligibility,
  createResource,
  updateResource,
  setResourceServiceEligibility,
  type ResourceActionResult,
} from "@/lib/server/resources";

export type TeamResource = {
  id: string;
  display_name: string;
  slug: string;
  active: boolean;
  bookable: boolean;
  sort_order: number;
  color_hex: string | null;
  linked_membership_id: string | null;
};

export async function listResourcesAction(): Promise<{
  resources: TeamResource[];
  services: Array<{ id: string; name: string; duration_minutes: number; active: boolean }>;
}> {
  const [resources, services] = await Promise.all([listTenantResources(), listTenantServices()]);
  return {
    resources: resources.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      slug: r.slug,
      active: r.active,
      bookable: r.bookable,
      sort_order: r.sort_order,
      color_hex: r.color_hex,
      linked_membership_id: r.linked_membership_id,
    })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      duration_minutes: s.duration_minutes,
      active: s.active,
    })),
  };
}

export async function createResourceAction(
  _: unknown,
  form: FormData,
): Promise<ResourceActionResult> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) raw[k] = v?.toString();
  return createResource(raw);
}

export async function updateResourceAction(
  _: unknown,
  form: FormData,
): Promise<ResourceActionResult> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) raw[k] = v?.toString();
  if (raw["linked_membership_id"] === "__none__") raw["linked_membership_id"] = "";
  return updateResource(raw);
}

export async function toggleResourceActiveAction(input: {
  resource_id: unknown;
  active: unknown;
}): Promise<ResourceActionResult> {
  return updateResource({
    resource_id: input.resource_id,
    active: typeof input.active === "boolean" ? (input.active ? "on" : "off") : input.active,
  });
}

export async function setResourceServicesAction(input: {
  resource_id: unknown;
  service_ids: string[];
}): Promise<ResourceActionResult> {
  return setResourceServiceEligibility({
    resource_id: input.resource_id,
    service_ids: input.service_ids,
    mode: "replace",
  });
}

export async function listResourceServicesAction(resource_id: unknown): Promise<
  Array<{
    service_id: string;
    service_name: string;
    active: boolean;
  }>
> {
  return listResourceServiceEligibility(resource_id);
}
