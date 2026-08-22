import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireTenantMembership, requireTenantRole } from "@/lib/server/auth";
import { MembershipRole } from "@/modules/auth/core/roles";

export const ResourceCreateSchema = z.object({
  display_name: z
    .string()
    .min(1, { message: "Nome obbligatorio" })
    .max(80)
    .refine((v) => v.trim().length > 0, { message: "Nome vuoto non valido" }),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/, {
      message: "Slug: lettere minuscole, numeri, trattini. Lunghezza 2-60.",
    })
    .optional()
    .or(z.literal("")),
  linked_membership_id: z.string().uuid().optional().or(z.literal("")),
  bookable: z
    .enum(["on", "off", "true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? true : v === "on" || v === "true" || v === "1")),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .max(7)
    .optional()
    .or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).max(10_000).optional().default(0),
});

export const ResourceUpdateSchema = ResourceCreateSchema.partial().extend({
  resource_id: z.string().uuid(),
  active: z
    .enum(["on", "off", "true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "on" || v === "true" || v === "1")),
});

export type ResourceCreateInput = z.infer<typeof ResourceCreateSchema>;
export type ResourceUpdateInput = z.infer<typeof ResourceUpdateSchema>;

export type ResourceWithMembership = {
  id: string;
  tenant_id: string;
  display_name: string;
  slug: string;
  active: boolean;
  bookable: boolean;
  sort_order: number;
  color_hex: string | null;
  linked_membership_id: string | null;
  linked_display_name: string | null;
  linked_role: MembershipRole | null;
};

export type ResourceServiceEligibility = {
  service_id: string;
  service_name: string;
  active: boolean;
  price_minor: number | null;
};

const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  return base.length >= 2 ? base : `${base}-x`.slice(0, 60).replace(/-+$/g, "").padEnd(2, "x");
};

export async function listTenantResources(): Promise<ResourceWithMembership[]> {
  const ctx = await requireTenantMembership();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff_resources")
    .select(
      `id, tenant_id, display_name, slug, active, bookable, sort_order, color_hex, linked_membership_id`,
    )
    .eq("tenant_id", ctx.tenant.id)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = ((data as unknown[]) ?? []) as Array<{
    id: string;
    tenant_id: string;
    display_name: string;
    slug: string;
    active: boolean;
    bookable: boolean;
    sort_order: number;
    color_hex: string | null;
    linked_membership_id: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    display_name: r.display_name,
    slug: r.slug,
    active: r.active,
    bookable: r.bookable,
    sort_order: r.sort_order,
    color_hex: r.color_hex,
    linked_membership_id: r.linked_membership_id,
    linked_display_name: null,
    linked_role: null,
  }));
}

export async function listTenantServices(): Promise<
  Array<{
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price_minor: number | null;
    active: boolean;
  }>
> {
  const ctx = await requireTenantMembership();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("services")
    .select("id,tenant_id,name,description,duration_minutes,price_from,active")
    .eq("tenant_id", ctx.tenant.id)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = ((data as unknown[]) ?? []) as Array<{
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price_from: number | null;
    active: boolean;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    name: r.name,
    description: r.description,
    duration_minutes: r.duration_minutes,
    price_minor: r.price_from != null ? Number(r.price_from) * 100 : null,
    active: r.active,
  }));
}

export async function listResourceServiceEligibility(resourceId: unknown): Promise<
  Array<{
    service_id: string;
    service_name: string;
    active: boolean;
  }>
> {
  const ctx = await requireTenantMembership();
  const id = z.string().uuid().safeParse(resourceId);
  if (!id.success) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("staff_resource_services")
    .select("resource_id,service_id,active")
    .eq("resource_id", id.data)
    .eq("tenant_id", ctx.tenant.id);
  if (error) throw new Error(error.message);
  const rows = ((data as unknown[]) ?? []) as Array<{
    service_id: string;
    active: boolean;
  }>;
  const svcIds = rows.filter((r) => r.service_id).map((r) => r.service_id);
  const svcMap = new Map<string, string>();
  if (svcIds.length > 0) {
    const svcResp = await supabase
      .from("services")
      .select("id,name")
      .eq("tenant_id", ctx.tenant.id)
      .in("id", svcIds);
    if (!svcResp.error && svcResp.data) {
      for (const s of svcResp.data as Array<{ id: string; name: string }>) {
        svcMap.set(s.id, s.name);
      }
    }
  }
  return rows.map((r) => ({
    service_id: r.service_id,
    service_name: svcMap.get(r.service_id) ?? "",
    active: r.active,
  }));
}

export type ResourceActionResult = {
  ok: boolean;
  code:
    | "OK"
    | "VALIDATION_ERROR"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "HAS_BOOKINGS"
    | "UNKNOWN_ERROR";
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  data?: unknown;
};

export async function createResource(input: unknown): Promise<ResourceActionResult> {
  try {
    await requireTenantRole("manager");
    const ctx = await requireTenantMembership();
    const parsed = ResourceCreateSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.reduce<Record<string, string[]>>((acc, i) => {
        const k = i.path.join(".") || "_";
        (acc[k] ||= []).push(i.message);
        return acc;
      }, {});
      return { ok: false, code: "VALIDATION_ERROR", message: "Dati non validi", fieldErrors };
    }
    const { display_name, linked_membership_id, bookable, color_hex, sort_order } = parsed.data;
    const slug =
      parsed.data.slug && typeof parsed.data.slug === "string" && parsed.data.slug.length > 0
        ? parsed.data.slug
        : slugify(display_name);

    if (linked_membership_id && linked_membership_id.length > 0) {
      const sb = await createSupabaseServerClient();
      const { error: mErr, count } = await sb
        .from("tenant_memberships")
        .select("id", { count: "exact", head: true })
        .eq("id", linked_membership_id)
        .eq("tenant_id", ctx.tenant.id);
      if (mErr) throw new Error(mErr.message);
      if (!count || count < 1) {
        return { ok: false, code: "NOT_FOUND", message: "Membro del team inesistente" };
      }
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("staff_resources")
      .insert({
        tenant_id: ctx.tenant.id,
        display_name: display_name.trim(),
        slug,
        linked_membership_id:
          linked_membership_id && linked_membership_id.length > 0 ? linked_membership_id : null,
        bookable,
        active: true,
        sort_order,
        color_hex: color_hex && color_hex.length > 0 ? color_hex : null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return { ok: false, code: "CONFLICT", message: "Slug o nome già in uso" };
      }
      throw new Error(error.message);
    }
    return { ok: true, code: "OK", message: "Risorsa creata", data };
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return { ok: false, code: "FORBIDDEN", message: "Non autorizzato" };
    }
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: e instanceof Error ? e.message : "Errore sconosciuto",
    };
  }
}

export async function updateResource(input: unknown): Promise<ResourceActionResult> {
  try {
    await requireTenantRole("manager");
    const ctx = await requireTenantMembership();
    const parsed = ResourceUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION_ERROR", message: "Dati non validi" };
    }
    const {
      resource_id,
      display_name,
      slug,
      linked_membership_id,
      bookable,
      active,
      color_hex,
      sort_order,
    } = parsed.data;
    const payload: Record<string, unknown> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    const write = payload as Record<string, unknown>;
    if (display_name !== undefined) write["display_name"] = display_name.trim();
    if (slug !== undefined && typeof slug === "string" && slug.length > 0) write["slug"] = slug;
    if (linked_membership_id !== undefined)
      write["linked_membership_id"] =
        linked_membership_id && linked_membership_id.length > 0 ? linked_membership_id : null;
    if (bookable !== undefined) write["bookable"] = bookable;
    if (active !== undefined) write["active"] = active;
    if (color_hex !== undefined)
      write["color_hex"] = color_hex && color_hex.length > 0 ? color_hex : null;
    if (sort_order !== undefined) write["sort_order"] = sort_order;

    if (linked_membership_id && linked_membership_id.length > 0) {
      const sb = await createSupabaseServerClient();
      const { error: mErr, count } = await sb
        .from("tenant_memberships")
        .select("id", { count: "exact", head: true })
        .eq("id", linked_membership_id)
        .eq("tenant_id", ctx.tenant.id);
      if (mErr) throw new Error(mErr.message);
      if (!count || count < 1) {
        return { ok: false, code: "NOT_FOUND", message: "Membro inesistente" };
      }
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("staff_resources")
      .update(write as never)
      .eq("id", resource_id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) {
      if (error.code === "23505") {
        return { ok: false, code: "CONFLICT", message: "Slug già in uso" };
      }
      throw new Error(error.message);
    }
    return { ok: true, code: "OK", message: "Risorsa aggiornata" };
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return { ok: false, code: "FORBIDDEN", message: "Non autorizzato" };
    }
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: e instanceof Error ? e.message : "Errore sconosciuto",
    };
  }
}

export async function setResourceServiceEligibility(opts: {
  resource_id: unknown;
  service_ids: unknown[];
  mode?: "replace" | "add" | "remove";
}): Promise<ResourceActionResult> {
  try {
    await requireTenantRole("manager");
    const ctx = await requireTenantMembership();
    const id = z.string().uuid().safeParse(opts.resource_id);
    if (!id.success) return { ok: false, code: "VALIDATION_ERROR", message: "Risorsa non valida" };
    const sb = await createSupabaseServerClient();
    const { count, error: rc } = await sb
      .from("staff_resources")
      .select("id", { count: "exact", head: true })
      .eq("id", id.data)
      .eq("tenant_id", ctx.tenant.id);
    if (rc) throw new Error(rc.message);
    if (!count) return { ok: false, code: "NOT_FOUND", message: "Risorsa non trovata" };

    const parsedIds = opts.service_ids
      .map((s) => (typeof s === "string" ? s : ""))
      .filter((s) => z.string().uuid().safeParse(s).success);
    const mode = opts.mode ?? "replace";

    const idsSafe = parsedIds.length
      ? await sb
          .from("services")
          .select("id")
          .eq("tenant_id", ctx.tenant.id)
          .in("id", parsedIds)
          .then(({ data, error: e }) => {
            if (e) throw new Error(e.message);
            return ((data as unknown[]) ?? []).map((r) => (r as { id: string }).id);
          })
      : [];

    if (mode === "replace") {
      const { error } = await sb
        .from("staff_resource_services")
        .delete()
        .eq("resource_id", id.data)
        .eq("tenant_id", ctx.tenant.id);
      if (error) throw new Error(error.message);
      if (idsSafe.length) {
        const rows = idsSafe.map((sid) => ({
          tenant_id: ctx.tenant.id,
          resource_id: id.data,
          service_id: sid,
          active: true,
        }));
        const { error: ie } = await sb.from("staff_resource_services").insert(rows);
        if (ie) throw new Error(ie.message);
      }
    } else if (mode === "add" && idsSafe.length) {
      const rows = idsSafe.map((sid) => ({
        tenant_id: ctx.tenant.id,
        resource_id: id.data,
        service_id: sid,
        active: true,
      }));
      const { error } = await sb.from("staff_resource_services").upsert(rows, {
        onConflict: "tenant_id,resource_id,service_id",
        ignoreDuplicates: false,
      });
      if (error) throw new Error(error.message);
    } else if (mode === "remove" && idsSafe.length) {
      const { error } = await sb
        .from("staff_resource_services")
        .delete()
        .eq("resource_id", id.data)
        .eq("tenant_id", ctx.tenant.id)
        .in("service_id", idsSafe);
      if (error) throw new Error(error.message);
    }
    return { ok: true, code: "OK", message: "Servizi aggiornati" };
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return { ok: false, code: "FORBIDDEN", message: "Non autorizzato" };
    }
    return {
      ok: false,
      code: "UNKNOWN_ERROR",
      message: e instanceof Error ? e.message : "Errore sconosciuto",
    };
  }
}
