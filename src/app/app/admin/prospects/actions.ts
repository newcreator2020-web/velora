"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  provisionCustomer,
  type ProvisionCustomerInput,
  type ProvisionCustomerResult,
} from "@/lib/server/platform-admin";
import { seedServicesForCategory } from "@/lib/server/category-seeds";
import type { Tables, TablesInsert, TablesUpdate, Json } from "@/types/supabase";
import {
  ProspectCreateSchema,
  ProspectUpdateSchema,
  ProspectActivitySchema,
  type ListProspectsQuery,
} from "./lib";

export type ProspectRow = Tables<"prospects">;
export type ProspectActivityRow = Tables<"prospect_activities">;

export type PromoteProspectToTenantResult = ProvisionCustomerResult & {
  prospect_id: string;
};

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

async function guardAdmin() {
  const admin = await requirePlatformAdmin({ hardFail: true });
  return admin;
}

function buildSearchFilters(q: string | undefined) {
  const filters: { field: string; op: "ilike"; value: string }[] = [];
  const term = q?.trim();
  if (term && term.length > 0) {
    const like = `%${term}%`;
    filters.push(
      { field: "business_name", op: "ilike", value: like },
      { field: "telefono", op: "ilike", value: like },
      { field: "email", op: "ilike", value: like },
      { field: "comune", op: "ilike", value: like },
      { field: "business_category", op: "ilike", value: like },
    );
  }
  return { term, filters };
}

// ---------------------------------------------------------------------------
// Letture
// ---------------------------------------------------------------------------

export async function listProspectsAction(query: ListProspectsQuery = {}) {
  await guardAdmin();
  const supabase = getSupabaseServiceClient();
  const limit = Math.min(query.limit ?? 500, 1000);

  let chain = supabase
    .from("prospects")
    .select(
      "id,created_by,assigned_to,business_name,business_category,comune,telefono,email,sito_web,sito_quality_score,gmb_url,status,note,ultimo_contatto_at,prossimo_contatto_at,promoted_to_tenant_id,created_at,updated_at",
      { count: "exact" },
    )
    .order("prossimo_contatto_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (query.status) chain = chain.eq("status", query.status);
  if (query.categoria?.trim()) chain = chain.eq("business_category", query.categoria.trim());
  if (query.comune?.trim()) chain = chain.ilike("comune", `%${query.comune.trim()}%`);
  if (query.assigned_to) chain = chain.eq("assigned_to", query.assigned_to);
  if (query.solo_prossimi_7gg) {
    const d7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    chain = chain.lte("prossimo_contatto_at", d7);
  }

  const { term, filters } = buildSearchFilters(query.q);
  if (term && filters.length > 0) {
    const orExpr = filters
      .map((f) => `${f.field}.${f.op}.${encodeURIComponent(f.value)}`)
      .join(",");
    chain = chain.or(orExpr, {});
  }

  const { data, error, count } = await chain;
  if (error) throw new Error(`LIST_PROSPECTS_FAILED: ${error.message}`);
  return { rows: (data ?? []) as ProspectRow[], count: count ?? 0 };
}

export async function getProspectDetailAction(id: string) {
  z.string().uuid("ID prospetto non valido").parse(id);
  await guardAdmin();
  const supabase = getSupabaseServiceClient();
  const [prospectRes, activitiesRes] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", id).limit(1).maybeSingle(),
    supabase
      .from("prospect_activities")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (prospectRes.error) throw new Error(`GET_PROSPECT_FAILED: ${prospectRes.error.message}`);
  if (activitiesRes.error)
    throw new Error(`GET_PROSPECT_ACTIVITIES_FAILED: ${activitiesRes.error.message}`);
  if (!prospectRes.data) return null;
  return {
    prospect: prospectRes.data as ProspectRow,
    activities: (activitiesRes.data ?? []) as ProspectActivityRow[],
  };
}

// ---------------------------------------------------------------------------
// Scritture: Prospect CRUD
// ---------------------------------------------------------------------------

export type ProspectActionState = {
  ok: boolean;
  error: string | null;
  prospect_id?: string;
  duplicate?: boolean;
};

export async function createProspectAction(
  _prev: ProspectActionState | null,
  formData: FormData,
): Promise<ProspectActionState> {
  const admin = await guardAdmin();
  const raw = Object.fromEntries(formData.entries());
  const parsed = ProspectCreateSchema.safeParse({
    ...raw,
    sito_web: formData.get("sito_web") === "on" || raw["sito_web"] === "true",
    sito_quality_score: raw["sito_quality_score"] ? Number(raw["sito_quality_score"]) : null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const supabase = getSupabaseServiceClient();
  const _rawInsert: Record<string, unknown> = { ...parsed.data };
  for (const k of Object.keys(_rawInsert)) {
    if (_rawInsert[k] === undefined) _rawInsert[k] = null;
  }
  _rawInsert["created_by"] = admin.userId;
  const insert = _rawInsert as TablesInsert<"prospects">;

  const { data, error } = await supabase
    .from("prospects")
    .insert(insert)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    const duplicate =
      /unique.*prospects_business_name|duplicate key.*idx_prospects_unique_business/i.test(
        `${error.code} ${error.message}`,
      ) || error.code === "23505";
    return {
      ok: false,
      error: duplicate
        ? "Prospetto già presente (stesso nome attività + telefono)."
        : `CREATE_PROSPECT_FAILED: ${error.message}`,
      duplicate,
    };
  }

  const prospectId = data!.id;
  if (parsed.data.note?.trim() || parsed.data.assigned_to) {
    const summary_parts = [];
    if (parsed.data.note?.trim())
      summary_parts.push(`Note iniziali: "${parsed.data.note.trim().slice(0, 300)}"`);
    if (parsed.data.assigned_to)
      summary_parts.push(`Assegnato a operatore ${parsed.data.assigned_to}`);
    if (summary_parts.length > 0) {
      await supabase.from("prospect_activities").insert({
        prospect_id: prospectId,
        author_user_id: admin.userId,
        activity_kind: "nota_interna",
        summary: summary_parts.join(" | "),
        metadata: { source: "create_prospect" },
      } satisfies TablesInsert<"prospect_activities">);
    }
  }

  return { ok: true, error: null, prospect_id: prospectId };
}

export async function updateProspectAction(
  id: string,
  patch: Partial<z.input<typeof ProspectUpdateSchema>>,
): Promise<ProspectActionState> {
  z.string().uuid("ID prospetto non valido").parse(id);
  const admin = await guardAdmin();
  const parsed = ProspectUpdateSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const supabase = getSupabaseServiceClient();
  const _rawChanges: Record<string, unknown> = { ...parsed.data };
  if ("assigned_to" in _rawChanges) {
    _rawChanges["assigned_to"] = (_rawChanges["assigned_to"] as string | null | undefined) ?? null;
  }
  const changes = _rawChanges as TablesUpdate<"prospects">;
  if (Object.keys(changes).length === 0) return { ok: true, error: null, prospect_id: id };

  const { error } = await supabase.from("prospects").update(changes).eq("id", id);

  if (error) {
    const duplicate =
      error.code === "23505" ||
      /idx_prospects_unique_business/i.test(`${error.code} ${error.message}`);
    return {
      ok: false,
      error: duplicate
        ? "Prospetto già presente (stesso nome attività + telefono)."
        : `UPDATE_PROSPECT_FAILED: ${error.message}`,
      duplicate,
    };
  }

  // Append activity 'cambio_stato' / 'cambio_assegnazione' / 'nota_interna' quando rilevanti
  const actInserts: TablesInsert<"prospect_activities">[] = [];
  if (parsed.data.status) {
    actInserts.push({
      prospect_id: id,
      author_user_id: admin.userId,
      activity_kind: "cambio_stato",
      summary: `Stato aggiornato → ${parsed.data.status}`,
      metadata: { new_status: parsed.data.status },
    });
  }
  if ("assigned_to" in parsed.data && parsed.data.assigned_to !== undefined) {
    actInserts.push({
      prospect_id: id,
      author_user_id: admin.userId,
      activity_kind: "cambio_assegnazione",
      summary: parsed.data.assigned_to
        ? `Assegnato a ${parsed.data.assigned_to}`
        : "Rimossa assegnazione",
      metadata: { new_assigned_to: parsed.data.assigned_to },
    });
  }
  if (parsed.data.note?.trim()) {
    actInserts.push({
      prospect_id: id,
      author_user_id: admin.userId,
      activity_kind: "nota_interna",
      summary: `Nota: ${parsed.data.note.trim().slice(0, 500)}`,
      metadata: { source: "update_note" },
    });
  }
  if (actInserts.length > 0) {
    await supabase.from("prospect_activities").insert(actInserts);
  }

  return { ok: true, error: null, prospect_id: id };
}

export async function deleteProspectAction(id: string): Promise<ProspectActionState> {
  z.string().uuid("ID prospetto non valido").parse(id);
  const admin = await guardAdmin();
  if (!admin.isAdmin) return { ok: false, error: "NOT_AUTHORIZED" };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("prospects").delete().eq("id", id);
  if (error) return { ok: false, error: `DELETE_PROSPECT_FAILED: ${error.message}` };
  return { ok: true, error: null, prospect_id: id };
}

// ---------------------------------------------------------------------------
// Scritture: Activity append-only
// ---------------------------------------------------------------------------

export async function addProspectActivityAction(
  _prev: { ok: boolean; error: string | null } | null,
  formData: FormData,
): Promise<{ ok: boolean; error: string | null; id?: string }> {
  const admin = await guardAdmin();
  const raw = Object.fromEntries(formData.entries());
  const prospect_id = (formData.get("prospect_id") as string | null) ?? "";
  const parsed = ProspectActivitySchema.safeParse({
    prospect_id,
    activity_kind: raw["activity_kind"],
    summary: raw["summary"] ?? "",
    outcome: raw["outcome"] || null,
    metadata: raw["metadata"] ? (raw["metadata"] as object) : {},
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const supabase = getSupabaseServiceClient();
  const _insert: Record<string, unknown> = {
    ...parsed.data,
    author_user_id: admin.userId,
  };
  if ("outcome" in _insert) {
    _insert["outcome"] = (_insert["outcome"] as string | null | undefined) ?? null;
  }
  if ("metadata" in _insert) {
    _insert["metadata"] = (_insert["metadata"] ?? {}) as Json;
  }
  const insert = _insert as TablesInsert<"prospect_activities">;

  const { data, error } = await supabase
    .from("prospect_activities")
    .insert(insert)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error)
    return {
      ok: false,
      error: `ADD_ACTIVITY_FAILED: ${error.message}`,
    };

  // Sincronizza ultimo_contatto_at se tipo = contatto diretto
  const contattoKinds: ReadonlyArray<string> = ["chiamata", "sms", "email", "appuntamento"];
  if (contattoKinds.includes(parsed.data.activity_kind)) {
    await supabase
      .from("prospects")
      .update({ ultimo_contatto_at: new Date().toISOString() })
      .eq("id", prospect_id);
  }

  const res: { ok: boolean; error: string | null; id?: string } = {
    ok: true,
    error: null,
  };
  if (data && "id" in data && typeof data.id === "string") {
    res.id = data.id;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Promote → Crea vero tenant Velora via provisionCustomer
// ---------------------------------------------------------------------------

export async function promoteProspectToTenantAction(
  prospectId: string,
  provisionInput: Omit<ProvisionCustomerInput, "idempotencyKey"> & {
    idempotencyKey?: string;
  },
): Promise<PromoteProspectToTenantResult> {
  const admin = await guardAdmin();
  z.string().uuid("ID prospetto non valido").parse(prospectId);

  const supabase = getSupabaseServiceClient();
  const { data: prospect, error: prErr } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .limit(1)
    .maybeSingle();
  if (prErr || !prospect)
    throw new Error(`PROSPECT_NOT_FOUND: ${prErr ? prErr.message : "record inesistente"}`);
  if (prospect.promoted_to_tenant_id) throw new Error("PROSPECT_ALREADY_PROMOTED");

  const idempotencyKey = provisionInput.idempotencyKey?.trim() || randomUUID();
  const provisionArgs: ProvisionCustomerInput = {
    ...provisionInput,
    idempotencyKey,
    businessName: provisionInput.businessName || prospect.business_name,
    city: provisionInput.city || prospect.comune,
    ...(prospect.telefono?.trim() && !provisionInput.phone
      ? { phone: prospect.telefono.trim() }
      : {}),
    ...(prospect.email?.trim() && !provisionInput.businessEmail
      ? { businessEmail: prospect.email.trim() }
      : {}),
    category: provisionInput.category || prospect.business_category?.trim() || "service_business",
  };

  const result = await provisionCustomer(provisionArgs);
  if (!result.ok) throw new Error(`PROVISION_FAILED: ${result.message ?? "errore provisioning"}`);

  const { tenantId, slug: tenantSlug } = result;

  // Update prospect: status = cliente, promoted_to_tenant_id
  const { error: upErr } = await supabase
    .from("prospects")
    .update({
      status: "cliente",
      promoted_to_tenant_id: tenantId,
      ultimo_contatto_at: new Date().toISOString(),
    } satisfies TablesUpdate<"prospects">)
    .eq("id", prospectId);
  if (upErr) throw new Error(`PROSPECT_PROMOTED_UPDATE_FAILED: ${upErr.message}`);

  // Append activity promosso_tenant (non bloccante se fallisce ma logghiamo)
  try {
    await supabase.from("prospect_activities").insert({
      prospect_id: prospectId,
      author_user_id: admin.userId,
      activity_kind: "promosso_tenant",
      summary: `Promosso a tenant Velora: ${tenantSlug ?? tenantId} (piano ${provisionArgs.plan})`,
      metadata: {
        tenant_id: tenantId,
        slug: tenantSlug ?? null,
        plan: provisionArgs.plan,
        owner_email: provisionArgs.ownerEmail,
      },
    } satisfies TablesInsert<"prospect_activities">);
  } catch (actErr) {
    console.warn("[prospects][promote] activity append skipped", actErr);
  }

  try {
    const seedRes = await seedServicesForCategory(provisionArgs.category, tenantId);
    if (seedRes.ok) {
      void supabase
        .from("prospect_activities")
        .insert({
          prospect_id: prospectId,
          author_user_id: admin.userId,
          activity_kind: "nota_interna",
          summary:
            seedRes.inserted > 0
              ? `Seed servizi OK: creati ${seedRes.inserted} servizi (categoria: ${seedRes.category})`
              : `Seed servizi skip: servizi già presenti per il tenant (categoria: ${seedRes.category})`,
          metadata: {
            tenant_id: tenantId,
            category: seedRes.category,
            inserted: seedRes.inserted,
          } satisfies Json,
        } satisfies TablesInsert<"prospect_activities">)
        .then(
          () => {},
          (e) => console.warn("[prospects][promote] seed activity skip", e),
        );
    } else {
      console.warn("[prospects][promote] seed servizi fallito", seedRes);
      void supabase
        .from("prospect_activities")
        .insert({
          prospect_id: prospectId,
          author_user_id: admin.userId,
          activity_kind: "nota_interna",
          summary: `Seed servizi FALLITO (${seedRes.code}): ${seedRes.error}`,
          metadata: {
            tenant_id: tenantId,
            category: provisionArgs.category ?? null,
            error_code: seedRes.code,
            error: seedRes.error,
          } satisfies Json,
        } satisfies TablesInsert<"prospect_activities">)
        .then(
          () => {},
          (e) => console.warn("[prospects][promote] seed error activity skip", e),
        );
    }
  } catch (seedErr) {
    console.warn("[prospects][promote] seed servizi eccezione", seedErr);
  }

  const promoted: PromoteProspectToTenantResult = {
    ok: true,
    tenantId,
    slug: tenantSlug,
    planId: result.planId,
    ownerUserId: result.ownerUserId,
    ownerIsNew: result.ownerIsNew,
    inviteSent: result.inviteSent,
    name: result.name,
    createdAt: result.createdAt,
    cached: result.cached,
    prospect_id: prospectId,
  };
  return promoted;
}
