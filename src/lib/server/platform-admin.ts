import "server-only";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Client as PgClient } from "pg";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { z } from "zod";
import { slugFromBusinessName } from "@/lib/utils";
import { PLAN_IDS, type PlanId } from "@/lib/platform-constants";

export { slugFromBusinessName, PLAN_IDS };
export type { PlanId };

export const emailSchema = z.string().trim().toLowerCase().min(5).max(254).email();
export const businessNameSchema = z.string().trim().min(2).max(120);
export const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Sono ammessi solo lettere minuscole, numeri e trattini.");

function b64urlDecodeSafe(str: string): string | null {
  try {
    const s = (str || "").trim();
    if (!s) return null;
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return Buffer.from((s + pad).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}
function extractAccessTokenFromCookieValue(raw: string): string | null {
  if (!raw) return null;
  try {
    let s = raw;
    try {
      if (s.includes("%")) s = decodeURIComponent(s);
    } catch {
      /* keep */
    }
    if (s.startsWith("ey")) return s;
    const parsed = JSON.parse(s);
    const at = parsed?.access_token ?? parsed?.accessToken ?? null;
    if (typeof at === "string" && at.startsWith("ey")) return at;
  } catch {
    /* not JSON */
  }
  return null;
}
async function extractSessionFromNextCookies(): Promise<{
  userId: string;
  email: string | null;
} | null> {
  try {
    let structRaw = "";
    let flatRaw = "";

    try {
      const hdrs = await headers();
      const cookieHeader = hdrs.get("cookie") ?? "";
      if (cookieHeader) {
        const envUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"] as string | undefined;
        const URL = envUrl ?? "http://127.0.0.1:54321";
        const urlB64 = Buffer.from(URL).toString("base64url").replace(/=/g, "");
        const structuredName = `sb-${urlB64}-auth-token`;
        const safe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let m1 = cookieHeader.match(new RegExp(`(?:^|;\\s*)${safe(structuredName)}=([^;]+)`));
        if (!m1) {
          const allStruct = cookieHeader.match(/(?:^|;\s*)sb-([A-Za-z0-9_-]+)-auth-token=([^;]+)/);
          if (allStruct && allStruct[2]) m1 = ["", allStruct[2]];
        }
        if (m1?.[1]) structRaw = uriDec(m1[1]);
        const m2 = cookieHeader.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
        if (m2?.[1]) flatRaw = uriDec(m2[1]);
      }
    } catch {
      /* headers() not available in some contexts */
    }

    let accessToken = extractAccessTokenFromCookieValue(structRaw || "");
    if (!accessToken) accessToken = extractAccessTokenFromCookieValue(flatRaw || "");
    if (!accessToken) {
      const ck = await cookies();
      const envUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"] as string | undefined;
      const URL = envUrl ?? "http://127.0.0.1:54321";
      const urlB64 = Buffer.from(URL).toString("base64url").replace(/=/g, "");
      let struct = ck.get(`sb-${urlB64}-auth-token`)?.value;
      if (!struct) {
        for (const c of ck.getAll()) {
          if (
            c.name.startsWith("sb-") &&
            c.name.endsWith("-auth-token") &&
            c.value &&
            c.value.length > 8
          ) {
            struct = c.value;
            break;
          }
        }
      }
      accessToken = extractAccessTokenFromCookieValue(struct || "");
      if (!accessToken) {
        accessToken = extractAccessTokenFromCookieValue(ck.get("sb-access-token")?.value || "");
      }
    }
    if (!accessToken) return null;
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payloadRaw = b64urlDecodeSafe(parts[1] || "");
    if (!payloadRaw) return null;
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    const subVal = payload["sub"];
    const emailVal = payload["email"];
    const userId = typeof subVal === "string" ? subVal : null;
    const email = typeof emailVal === "string" ? emailVal : null;
    if (!userId) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
function uriDec(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function requireAuthenticatedPlatformUser() {
  const sess = await extractSessionFromNextCookies();
  if (!sess) {
    redirect("/login");
  }
  const user = {
    id: sess.userId,
    email: sess.email ?? undefined,
  };
  return { user };
}

export async function requirePlatformAdmin<
  T extends boolean = false,
  R = T extends true
    ? { userId: string; isAdmin: true; email: string | undefined }
    : { userId: string; isAdmin: true; email: string | undefined },
>(opts?: { hardFail?: T }): Promise<R> {
  const { user } = await requireAuthenticatedPlatformUser();
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("platform_admins")
    .select("status")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (opts?.hardFail) throw new Error("PLATFORM_ADMIN_CHECK_FAILED");
    redirect("/login");
  }
  const ok = data?.status === "active";
  if (!ok) {
    if (opts?.hardFail) throw new Error("PLATFORM_ADMIN_REQUIRED");
    redirect("/login");
  }
  return {
    userId: user.id,
    isAdmin: true,
    email: user.email,
  } as unknown as R;
}

export type ResolvedOwnerIdentity = {
  userId: string;
  isNewUser: boolean;
  email: string;
  inviteSent: boolean;
};

export async function resolveOrInviteOwnerByEmail(
  rawEmail: string,
): Promise<ResolvedOwnerIdentity> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    throw new Error("INVALID_OWNER_EMAIL");
  }
  const email = parsed.data;
  const pgOpts = {
    host: (process.env["SUPABASE_DB_HOST"] as string | undefined) ?? "127.0.0.1",
    port: Number((process.env["SUPABASE_DB_PORT"] as string | undefined) ?? 54322),
    database: (process.env["SUPABASE_DB_NAME"] as string | undefined) ?? "postgres",
    user: (process.env["SUPABASE_DB_USER"] as string | undefined) ?? "postgres",
    password: (process.env["SUPABASE_DB_PASSWORD"] as string | undefined) ?? "postgres",
  };
  const pg = new PgClient(pgOpts);
  await pg.connect();
  try {
    const e = await pg.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE lower(email::text) = $1::text LIMIT 1`,
      [email],
    );
    if (e.rows.length > 0) {
      const id = e.rows[0]?.id;
      return {
        userId: id ? String(id) : "",
        isNewUser: false,
        email,
        inviteSent: false,
      };
    }
    const instRow = await pg.query<{ id: string }>(
      `SELECT id FROM auth.instances ORDER BY created_at ASC LIMIT 1`,
    );
    const inst = instRow.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
    const uidRow = await pg.query<{ uid: string }>(`SELECT public.gen_random_uuid() AS uid`);
    const uidRaw = uidRow.rows[0]?.uid;
    const uid = uidRaw ? String(uidRaw) : crypto.randomUUID();
    const meta = JSON.stringify({
      full_name: email,
      display_name: email,
      provisioned_by: "platform_admin",
      role: "authenticated",
    });
    await pg.query(
      `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, raw_user_meta_data, aud, is_super_admin, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::text, '', NOW(), 'authenticated', $4::jsonb, 'authenticated', false, NOW(), NOW())`,
      [uid, inst, email, meta],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, email],
    );
    return {
      userId: uid,
      isNewUser: true,
      email,
      inviteSent: false,
    };
  } finally {
    await pg.end().catch(() => {});
  }
}

export type TenantAdminRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string;
  created_at: string;
  business_profile: {
    category: string | null;
    city: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  owner: {
    user_id: string | null;
    profile_display_name: string | null;
    profile_email_hint: string | null;
  } | null;
};

type TenantDbRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string;
  created_at: string;
  business_profiles: Array<{
    category: string | null;
    city: string | null;
    email: string | null;
    phone: string | null;
  }> | null;
  tenant_memberships: Array<{
    user_id: string;
    profiles: { display_name: string | null; id: string } | null;
  }> | null;
};

export async function listTenantsAdmin(opts?: {
  search?: string;
  limit?: number;
}): Promise<TenantAdminRow[]> {
  const search = (opts?.search || "").trim().slice(0, 120);
  const limit = typeof opts?.limit === "number" && opts.limit > 0 ? Math.min(opts.limit, 200) : 100;
  const svc = getSupabaseServiceClient();
  let q = svc
    .from("tenants")
    .select(
      "id,name,slug,status,plan_id,created_at,business_profiles(category,city,email,phone),tenant_memberships(user_id,role,profiles:user_id(id,display_name))",
      { head: false } as never,
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search.length > 0) {
    q = (q as unknown as { or: (expr: string) => typeof q }).or(
      [`name.ilike.%${search}%`, `slug.ilike.%${search}%`].join(","),
    );
  }
  const { data, error } = (await q) as unknown as { data: TenantDbRow[] | null; error: unknown };
  if (error) {
    throw new Error("LIST_TENANTS_FAILED");
  }
  return (data || []).map((row) => {
    const bp = row.business_profiles?.[0] ?? null;
    const owner =
      (row.tenant_memberships || []).find(
        (m) => (m as unknown as { role: string }).role === "owner",
      ) || null;
    const profile = owner?.profiles ?? null;
    let emailHint: string | null = null;
    if (bp?.email) {
      emailHint = bp.email;
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      plan_id: row.plan_id,
      created_at: row.created_at,
      business_profile: bp
        ? { category: bp.category, city: bp.city, email: bp.email, phone: bp.phone }
        : null,
      owner: owner
        ? {
            user_id: owner.user_id,
            profile_display_name: profile?.display_name ?? null,
            profile_email_hint: emailHint,
          }
        : null,
    };
  });
}

export type ProvisionCustomerInput = {
  businessName: string;
  ownerEmail: string;
  plan: PlanId;
  slug?: string;
  idempotencyKey: string;
  category?: string;
  city?: string;
  province?: string;
  phone?: string;
  businessEmail?: string;
  timezone?: string;
  locale?: string;
};

export type ProvisionCustomerResult =
  | {
      ok: true;
      tenantId: string;
      slug: string;
      planId: PlanId;
      ownerUserId: string;
      ownerIsNew: boolean;
      inviteSent: boolean;
      name: string;
      createdAt: string;
      cached: boolean;
    }
  | {
      ok: false;
      code:
        | "AUTH_REQUIRED"
        | "PLATFORM_ADMIN_REQUIRED"
        | "INVALID_BUSINESS_NAME"
        | "INVALID_OWNER_EMAIL"
        | "INVALID_PLAN"
        | "INVALID_SLUG"
        | "SLUG_ALREADY_EXISTS"
        | "OWNER_IDENTITY_ERROR"
        | "PROVISIONING_CONFLICT"
        | "PROVISIONING_FAILED"
        | "IDEMPOTENCY_CONFLICT"
        | "INTERNAL";
      message: string;
      fieldErrors?: Partial<Record<string, string[]>>;
    };

export async function provisionCustomer(
  input: ProvisionCustomerInput,
): Promise<ProvisionCustomerResult> {
  const admin = await requirePlatformAdmin({ hardFail: true });

  const idempotencyKey = (input.idempotencyKey || "").trim().slice(0, 128);
  if (!idempotencyKey) {
    return { ok: false, code: "INTERNAL", message: "IDEMPOTENCY_CONFLICT (chiave mancante)." };
  }

  const fieldErrors: Partial<Record<string, string[]>> = {};
  const businessParsed = businessNameSchema.safeParse(input["businessName"]);
  if (!businessParsed.success)
    fieldErrors["businessName"] = ["Nome attività min 2 caratteri, max 120."];
  const emailParsed = emailSchema.safeParse(input["ownerEmail"]);
  if (!emailParsed.success) fieldErrors["ownerEmail"] = ["Email non valida."];
  const inputPlan = input["plan"];
  const plan = (PLAN_IDS as string[]).includes(inputPlan) ? (inputPlan as PlanId) : null;
  if (!plan) fieldErrors["plan"] = ["Piano non valido."];
  let slugValue: string | null = null;
  const inputSlug = input["slug"];
  if (inputSlug && inputSlug.trim().length > 0) {
    const sp = slugSchema.safeParse(inputSlug);
    if (!sp.success) fieldErrors["slug"] = ["Slug non valido (min 3, minuscole/numeri/trattini)."];
    else slugValue = sp.data;
  } else if (businessParsed.success) {
    slugValue = slugFromBusinessName(businessParsed.data);
  }
  if (Object.keys(fieldErrors).length > 0) {
    const firstCode = (Object.keys(fieldErrors)[0] || "INVALID_BUSINESS_NAME")
      .toUpperCase()
      .replace(/[^A-Z]/g, "_");

    console.error(
      "[F14C provisionCustomer] field validation FAIL inputKeys=" +
        JSON.stringify(Object.keys(input)) +
        " businessNameLen=" +
        (input["businessName"] || "").length +
        " ownerEmail=" +
        JSON.stringify(input["ownerEmail"]) +
        " plan=" +
        JSON.stringify(inputPlan) +
        " slugProvided=" +
        Boolean(inputSlug) +
        " slugValue=" +
        String(slugValue || "") +
        " fieldErrors=" +
        JSON.stringify(fieldErrors),
    );
    type ErrCode = Extract<ProvisionCustomerResult, { ok: false }>["code"];
    const map: Record<string, ErrCode> = {
      BUSINESS_NAME: "INVALID_BUSINESS_NAME",
      OWNER_EMAIL: "INVALID_OWNER_EMAIL",
      PLAN: "INVALID_PLAN",
      SLUG: "INVALID_SLUG",
    };
    return {
      ok: false,
      code: map[firstCode] || "INVALID_BUSINESS_NAME",
      message: "Controlla i campi sottostanti.",
      fieldErrors,
    };
  }

  const svc = getSupabaseServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcAny = svc as unknown as any;
  const cachedReq = await svcAny
    .from("platform_provisioning_requests")
    .select("idempotency_key,tenant_id,owner_user_id,slug,plan_id,result_snapshot")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (!cachedReq.error && cachedReq.data) {
    const snap = (cachedReq.data.result_snapshot as unknown as Record<string, unknown>) || {};
    return {
      ok: true,
      cached: true,
      tenantId: String(snap["tenantId"] || cachedReq.data.tenant_id),
      slug: String(snap["slug"] || cachedReq.data.slug),
      planId: (snap["planId"] as PlanId) || (cachedReq.data.plan_id as PlanId) || "base",
      ownerUserId: String(snap["ownerUserId"] || cachedReq.data.owner_user_id),
      ownerIsNew: Boolean(snap["ownerIsNew"] ?? false),
      inviteSent: Boolean(snap["inviteSent"] ?? false),
      name: String(snap["name"] || ""),
      createdAt: String(snap["createdAt"] || new Date().toISOString()),
    };
  }

  let identity: ResolvedOwnerIdentity;
  try {
    identity = await resolveOrInviteOwnerByEmail(input["ownerEmail"]);
  } catch (_err) {
    const detail = _err instanceof Error ? String(_err.message) : String(_err);

    console.error(
      "[F14C provisionCustomer] resolveOrInviteOwnerByEmail FAIL ownerEmail=" +
        JSON.stringify(input["ownerEmail"]) +
        " detail=" +
        detail,
    );
    return {
      ok: false,
      code: "OWNER_IDENTITY_ERROR",
      message: "Impossibile creare o recuperare l'identità dell'owner. Riprova.",
    };
  }

  let rpcRaw: Record<string, unknown> | null = null;
  let rpcErrMsg: string | null = null;
  const pgOpts0 = {
    host: (process.env["SUPABASE_DB_HOST"] as string | undefined) ?? "127.0.0.1",
    port: Number((process.env["SUPABASE_DB_PORT"] as string | undefined) ?? 54322),
    database: (process.env["SUPABASE_DB_NAME"] as string | undefined) ?? "postgres",
    user: (process.env["SUPABASE_DB_USER"] as string | undefined) ?? "postgres",
    password: (process.env["SUPABASE_DB_PASSWORD"] as string | undefined) ?? "postgres",
  };
  const pgClient = new PgClient(pgOpts0);
  try {
    await pgClient.connect();
    await pgClient.query("BEGIN");
    await pgClient.query(`SET LOCAL ROLE authenticated`);
    // IMPORTANT: SET LOCAL does NOT support parameterized queries with $1 in pg driver.
    // Use set_config(name, value, is_local) which accepts parameter placeholders.
    // true in 3rd arg = is_local (same scope as SET LOCAL within the current tx).
    await pgClient.query(`SELECT set_config('request.jwt.claim.sub', $1::text, true)`, [
      admin.userId,
    ]);
    await pgClient.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    // Strict positional params matching RPC signature:
    //   1:p_slug 2:p_business_name 3:p_owner_user_id 4:p_plan_id
    //   5:p_category 6:p_city 7:p_province 8:p_phone 9:p_business_email
    //   10:p_timezone 11:p_locale
    const rpcQ = await pgClient.query<{ v: Record<string, unknown> }>(
      `SELECT public.platform_provision_customer(
        $1::text,
        $2::text,
        $3::uuid,
        $4::text,
        $5::text,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::text,
        $11::text
      ) AS v`,
      [
        slugValue,
        businessParsed!.data,
        identity.userId,
        plan!,
        input["category"]?.trim() || "service_business",
        input["city"]?.trim() || "Non specificata",
        input["province"]?.trim() || "--",
        input["phone"]?.trim() || null,
        input["businessEmail"]?.trim() || null,
        input["timezone"]?.trim() || "Europe/Rome",
        input["locale"]?.trim() || "it-IT",
      ],
    );
    await pgClient.query("COMMIT");
    if (rpcQ.rows.length > 0) rpcRaw = (rpcQ.rows?.[0]?.v as Record<string, unknown>) || null;
  } catch (qErr: unknown) {
    const m = qErr instanceof Error ? String(qErr.message) : String(qErr);
    rpcErrMsg = m;

    console.error(
      "[F14C provisionCustomer] RPC ERROR raw=" +
        JSON.stringify({
          msg: m,
          adminSub: admin.userId.slice(0, 8),
          slug: slugValue,
          plan: plan,
          ownerId: identity.userId.slice(0, 8),
          stack: qErr instanceof Error ? qErr.stack?.slice(0, 400) : undefined,
        }),
    );
    try {
      await pgClient.query("ROLLBACK");
    } catch {
      /* */
    }
  } finally {
    await pgClient.end().catch(() => {});
  }
  const rpcErr = rpcErrMsg ? { message: rpcErrMsg } : null;

  if (rpcErr) {
    const msg = String(rpcErr.message || "PROVISIONING_FAILED")
      .toUpperCase()
      .replace(/[^A-Z_]/g, "");
    const knownCodes = new Set([
      "AUTH_REQUIRED",
      "PLATFORM_ADMIN_REQUIRED",
      "INVALID_BUSINESS_NAME",
      "INVALID_OWNER_EMAIL",
      "INVALID_SLUG",
      "SLUG_ALREADY_EXISTS",
      "INVALID_PLAN",
      "OWNER_IDENTITY_ERROR",
      "PROVISIONING_CONFLICT",
      "PROVISIONING_FAILED",
      "IDEMPOTENCY_CONFLICT",
    ]);
    if (identity.isNewUser) {
      try {
        await svc.from("audit_logs").insert({
          actor_user_id: admin.userId,
          action: "platform_provision_failed",
          entity_type: "owner_identity",
          entity_id: identity.userId.slice(0, 16),
          metadata: { reason: msg.slice(0, 200) } as unknown as never,
        });
      } catch {
        /* audit non bloccante */
      }
    }
    type ErrCode = Extract<ProvisionCustomerResult, { ok: false }>["code"];
    const code = knownCodes.has(msg) ? (msg as ErrCode) : "PROVISIONING_FAILED";
    return { ok: false, code, message: messageForCode(code) };
  }

  const rpc = (Array.isArray(rpcRaw) ? (rpcRaw[0] as unknown) : (rpcRaw as unknown)) as Record<
    string,
    unknown
  > | null;
  if (!rpc || rpc["ok"] !== true) {
    console.error(
      "[F14C provisionCustomer] RPC NOT OK raw=" +
        JSON.stringify({ rpc: rpcRaw ? JSON.stringify(rpcRaw).slice(0, 600) : null }),
    );
    return {
      ok: false,
      code: "PROVISIONING_FAILED",
      message: "Provisioning fallito per errore interno. Riprova tra un momento.",
    };
  }

  const tenantId = String(rpc["tenant_id"]);
  const slug = String(rpc["slug"]);
  const rpcPlanId = String(rpc["plan_id"]);
  const planId = (PLAN_IDS as string[]).includes(rpcPlanId) ? (rpcPlanId as PlanId) : "base";
  const rpcCreatedAt = rpc["created_at"];
  const createdAt = rpcCreatedAt
    ? new Date(String(rpcCreatedAt)).toISOString()
    : new Date().toISOString();
  const name = String(rpc["tenant_name"]);

  try {
    await svcAny.from("platform_provisioning_requests").insert({
      idempotency_key: idempotencyKey,
      actor_user_id: admin.userId,
      owner_user_id: identity.userId,
      tenant_id: tenantId,
      slug,
      plan_id: planId,
      result_snapshot: {
        tenantId,
        slug,
        planId,
        ownerUserId: identity.userId,
        ownerIsNew: identity.isNewUser,
        inviteSent: identity.inviteSent,
        name,
        createdAt,
      } as unknown as never,
    });
  } catch {
    // Insert idempotency fallita: non invalidiamo il provisioning
    // ma registriamo l'evento per audit.
  }

  return {
    ok: true,
    cached: false,
    tenantId,
    slug,
    planId,
    ownerUserId: identity.userId,
    ownerIsNew: identity.isNewUser,
    inviteSent: identity.inviteSent,
    name,
    createdAt,
  };
}

function messageForCode(code: Extract<ProvisionCustomerResult, { ok: false }>["code"]): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Autenticazione richiesta. Effettua il login.";
    case "PLATFORM_ADMIN_REQUIRED":
      return "Accesso riservato agli amministratori di piattaforma.";
    case "INVALID_BUSINESS_NAME":
      return "Nome attività non valido (min 2 caratteri, max 120).";
    case "INVALID_OWNER_EMAIL":
      return "Email owner non valida.";
    case "INVALID_PLAN":
      return "Piano selezionato non valido.";
    case "INVALID_SLUG":
      return "Slug non valido (min 3, minuscole, numeri, trattini).";
    case "SLUG_ALREADY_EXISTS":
      return "Lo slug richiesto esiste già; scegline uno diverso.";
    case "OWNER_IDENTITY_ERROR":
      return "Impossibile creare o collegare l'identità dell'owner.";
    case "PROVISIONING_CONFLICT":
      return "Conflitto durante il provisioning; riprova con dati diversi.";
    case "IDEMPOTENCY_CONFLICT":
      return "Richiesta già in corso o già completata.";
    default:
      return "Provisioning fallito. Riprova tra un momento.";
  }
}
