import "server-only";
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireTenantRole } from "@/lib/server/auth";
import { normalizeHostname as normalizeHostnamePublic } from "@/lib/server/site-engine";
import { normalizeHostnameStrict, isPublicHostnameProductionSafe } from "@/lib/server/hostname";
import { getDnsResolver, type DnsResolver } from "@/lib/server/dns-resolver";
import type { Database } from "@/types/supabase";

export const DOMAIN_CACHE_TAG = "domain";
export const VERIFICATION_TOKEN_LEN = 32;
export const VERIFICATION_TXT_PREFIX = "_velora-verification.";
export const VERIFICATION_TXT_VALUE_PREFIX = "velora-verification=";
export const TEMPORARY_DOMAIN_MAX_LEN = 253;

export const DOMAIN_ERROR_CODES = [
  "DOMAIN_ALREADY_CLAIMED",
  "INVALID_HOSTNAME",
  "DNS_NOT_VERIFIED",
  "CROSS_TENANT_DENIED",
  "AUTHZ_DENIED",
  "NOT_FOUND",
  "ROUTING_NOT_READY",
  "INTERNAL",
  "VALIDATION",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export type DomainVerificationStatus = "pending" | "verified" | "failed_disabled";

export type TenantDomainsVM = {
  tenant_id: string;
  temporary_domain: string | null;
  custom_domain: string | null;
  custom_domain_status: DomainVerificationStatus | null;
  custom_domain_routing_ready: boolean | null;
  custom_domain_verified_at: string | null;
  custom_domain_routing_verified_at: string | null;
  verification_token_prefix: string | null;
};

export type ListTenantDomainsResult =
  | { ok: true; code: "OK"; data: TenantDomainsVM }
  | {
      ok: false;
      code: Exclude<
        DomainErrorCode,
        "DOMAIN_ALREADY_CLAIMED" | "DNS_NOT_VERIFIED" | "ROUTING_NOT_READY" | "INVALID_HOSTNAME"
      >;
      message: string;
    };

export type GenerateVerificationTokenResult =
  | { ok: true; code: "OK"; verification_token_prefix: string; expires_at?: string }
  | {
      ok: false;
      code: Exclude<
        DomainErrorCode,
        "DOMAIN_ALREADY_CLAIMED" | "DNS_NOT_VERIFIED" | "ROUTING_NOT_READY" | "INVALID_HOSTNAME"
      >;
      message: string;
    };

export type AddCustomDomainInput = {
  hostname: unknown;
};

export type AddCustomDomainResult =
  | { ok: true; code: "OK"; data: { custom_domain: string; verification_token_prefix: string } }
  | {
      ok: false;
      code: Exclude<DomainErrorCode, "DNS_NOT_VERIFIED" | "ROUTING_NOT_READY">;
      message: string;
    };

export type RemoveCustomDomainResult =
  | { ok: true; code: "OK" }
  | {
      ok: false;
      code: Exclude<
        DomainErrorCode,
        "DOMAIN_ALREADY_CLAIMED" | "DNS_NOT_VERIFIED" | "ROUTING_NOT_READY" | "INVALID_HOSTNAME"
      >;
      message: string;
    };

export type VerifyCustomDomainResult =
  | { ok: true; code: "OK"; verified: true; routing_ready: boolean }
  | { ok: false; code: DomainErrorCode; message: string };

type TenantDomainRow = {
  id: string;
  temporary_domain: string | null;
  custom_domain: string | null;
  custom_domain_status: unknown;
  custom_domain_verification_token: string | null;
  custom_domain_verified_at: string | null;
  custom_domain_routing_ready: unknown;
  custom_domain_routing_verified_at: string | null;
};

function maskToken(token: string | null): string | null {
  if (!token || typeof token !== "string" || token.length < 6) return null;
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}

function mapStatus(raw: unknown): DomainVerificationStatus | null {
  if (raw === "pending" || raw === "verified" || raw === "failed_disabled") return raw;
  return "pending";
}

function toVM(row: TenantDomainRow): TenantDomainsVM {
  return {
    tenant_id: row.id,
    temporary_domain:
      typeof row.temporary_domain === "string" && row.temporary_domain.length > 0
        ? normalizeHostnamePublic(row.temporary_domain)
        : null,
    custom_domain:
      typeof row.custom_domain === "string" && row.custom_domain.length > 0
        ? normalizeHostnamePublic(row.custom_domain)
        : null,
    custom_domain_status: mapStatus(row.custom_domain_status),
    custom_domain_routing_ready: Boolean(row.custom_domain_routing_ready),
    custom_domain_verified_at: row.custom_domain_verified_at ?? null,
    custom_domain_routing_verified_at: row.custom_domain_routing_verified_at ?? null,
    verification_token_prefix: maskToken(row.custom_domain_verification_token),
  };
}

function buildToken(): string {
  const raw = randomBytes(VERIFICATION_TOKEN_LEN);
  return `vt_${raw.toString("base64url")}`;
}

function revalidateDomainTag(): void {
  try {
    const rev = revalidateTag as unknown as (tag: string, opts?: unknown) => void;
    rev(DOMAIN_CACHE_TAG);
  } catch {
    // next/cache revalidateTag può throw in contesti non next runtime; non bloccante
  }
}

async function fetchTenantDomainRow(tenantId: string): Promise<TenantDomainRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tenants")
    .select(
      `id,
       temporary_domain,
       custom_domain,
       custom_domain_status,
       custom_domain_verification_token,
       custom_domain_verified_at,
       custom_domain_routing_ready,
       custom_domain_routing_verified_at`,
    )
    .eq("id", tenantId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as TenantDomainRow;
}

export async function listTenantDomains(): Promise<ListTenantDomainsResult> {
  try {
    const ctx = await requireTenantRole("manager");
    const row = await fetchTenantDomainRow(ctx.tenant.id);
    if (!row) {
      return { ok: false, code: "NOT_FOUND", message: "Tenant non trovato." };
    }
    return { ok: true, code: "OK", data: toVM(row) };
  } catch (err) {
    const code = (err as { digest?: string } | undefined)?.digest;
    if (typeof code === "string" && code.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, code: "AUTHZ_DENIED", message: "Accesso negato." };
  }
}

export async function generateVerificationToken(): Promise<GenerateVerificationTokenResult> {
  try {
    const ctx = await requireTenantRole("owner");
    const tenantId = ctx.tenant.id;
    const token = buildToken();
    const now = new Date().toISOString();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("tenants")
      .update({
        custom_domain_verification_token: token,
        custom_domain_status: "pending",
        updated_at: now,
      } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
      .eq("id", tenantId);
    if (error) {
      const c = (error as { code?: string } | undefined)?.code ?? "";
      if (c === "42501") {
        return { ok: false, code: "AUTHZ_DENIED", message: "Non sei autorizzato." };
      }
      return { ok: false, code: "INTERNAL", message: "Impossibile generare il token." };
    }
    revalidateDomainTag();
    return {
      ok: true,
      code: "OK",
      verification_token_prefix: maskToken(token) ?? "",
    };
  } catch (err) {
    const code = (err as { digest?: string } | undefined)?.digest;
    if (typeof code === "string" && code.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, code: "AUTHZ_DENIED", message: "Accesso negato." };
  }
}

export async function addCustomDomain(input: AddCustomDomainInput): Promise<AddCustomDomainResult> {
  try {
    const ctx = await requireTenantRole("owner");
    const tenantId = ctx.tenant.id;

    if (!input || typeof input !== "object") {
      return { ok: false, code: "VALIDATION", message: "Input non valido." };
    }
    const strict = normalizeHostnameStrict(input.hostname);
    if (!strict) {
      return {
        ok: false,
        code: "INVALID_HOSTNAME",
        message: "Hostname non valido. Usa un dominio pubblico (es. www.mio-sito.it).",
      };
    }
    const safe = isPublicHostnameProductionSafe(strict);
    if (!safe) {
      return {
        ok: false,
        code: "INVALID_HOSTNAME",
        message:
          "Hostname non consentito: non sono ammessi domini interni, localhost, riservati o IP.",
      };
    }

    try {
      const service = getSupabaseServiceClient();
      const { data: claimedBy, error: lookupErr } = await service
        .from("tenants")
        .select("id")
        .eq("custom_domain", strict)
        .limit(1)
        .maybeSingle();
      if (!lookupErr && claimedBy) {
        if ((claimedBy as { id: string }).id !== tenantId) {
          return {
            ok: false,
            code: "DOMAIN_ALREADY_CLAIMED",
            message: "Questo dominio è già associato a un altro account.",
          };
        }
      }
    } catch {
      // Service role non disponibile: continuiamo e lasciamo che UNIQUE constraint fallisca dopo
    }

    const token = buildToken();
    const now = new Date().toISOString();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("tenants")
      .update({
        custom_domain: strict,
        custom_domain_status: "pending",
        custom_domain_verification_token: token,
        custom_domain_verified_at: null,
        custom_domain_routing_ready: false,
        custom_domain_routing_verified_at: null,
        updated_at: now,
      } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
      .eq("id", tenantId);

    if (error) {
      const c = (error as { code?: string } | undefined)?.code ?? "";
      if (c === "42501") {
        return { ok: false, code: "AUTHZ_DENIED", message: "Non sei autorizzato." };
      }
      if (c === "23505") {
        return {
          ok: false,
          code: "CROSS_TENANT_DENIED",
          message: "Dominio già in uso da un altro account.",
        };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Salvataggio dominio fallito. Riprova tra un momento.",
      };
    }

    revalidateDomainTag();
    return {
      ok: true,
      code: "OK",
      data: {
        custom_domain: strict,
        verification_token_prefix: maskToken(token) ?? "",
      },
    };
  } catch (err) {
    const code = (err as { digest?: string } | undefined)?.digest;
    if (typeof code === "string" && code.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, code: "AUTHZ_DENIED", message: "Accesso negato." };
  }
}

export async function removeCustomDomain(): Promise<RemoveCustomDomainResult> {
  try {
    const ctx = await requireTenantRole("owner");
    const tenantId = ctx.tenant.id;
    const supabase = await createSupabaseServerClient();
    const row = await fetchTenantDomainRow(tenantId);
    if (!row) {
      return { ok: false, code: "NOT_FOUND", message: "Tenant non trovato." };
    }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tenants")
      .update({
        custom_domain: null,
        custom_domain_status: "pending",
        custom_domain_verification_token: null,
        custom_domain_verified_at: null,
        custom_domain_routing_ready: false,
        custom_domain_routing_verified_at: null,
        updated_at: now,
      } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
      .eq("id", tenantId);
    if (error) {
      const c = (error as { code?: string } | undefined)?.code ?? "";
      if (c === "42501") {
        return { ok: false, code: "AUTHZ_DENIED", message: "Non sei autorizzato." };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Rimozione dominio fallita. Riprova tra un momento.",
      };
    }
    revalidateDomainTag();
    return { ok: true, code: "OK" };
  } catch (err) {
    const code = (err as { digest?: string } | undefined)?.digest;
    if (typeof code === "string" && code.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, code: "AUTHZ_DENIED", message: "Accesso negato." };
  }
}

async function verifyOwnershipTxt(
  resolver: DnsResolver,
  customDomain: string,
  token: string,
): Promise<boolean> {
  const fqdn = `${VERIFICATION_TXT_PREFIX}${customDomain}`;
  let records: string[][];
  try {
    records = await resolver.resolveTxt(fqdn);
  } catch {
    return false;
  }
  const expected = `${VERIFICATION_TXT_VALUE_PREFIX}${token}`;
  for (const rr of records) {
    const joined = rr.join("");
    if (joined.trim() === expected.trim()) return true;
    for (const part of rr) {
      if (part.trim() === expected.trim()) return true;
    }
  }
  return false;
}

async function verifyRouting(
  resolver: DnsResolver,
  customDomain: string,
  temporaryDomain: string | null,
): Promise<boolean> {
  const strictTemporary = temporaryDomain
    ? (normalizeHostnameStrict(temporaryDomain) ?? temporaryDomain.toLowerCase().trim())
    : null;

  if (strictTemporary) {
    try {
      const cname = await resolver.resolveCname(customDomain);
      const normalizedCname = normalizeHostnameStrict(cname);
      if (normalizedCname && normalizedCname === strictTemporary) {
        return true;
      }
    } catch {
      // CNAME non presente: continua con A lookup fallback
    }
  }

  try {
    const a = await resolver.lookup(customDomain);
    if (a && typeof a.address === "string" && a.address.length > 0) {
      return true;
    }
  } catch {
    // A lookup fallito
  }

  return false;
}

export async function verifyCustomDomain(
  opts?: { resolver?: DnsResolver } | null,
): Promise<VerifyCustomDomainResult> {
  try {
    const ctx = await requireTenantRole("owner");
    const tenantId = ctx.tenant.id;
    const row = await fetchTenantDomainRow(tenantId);
    if (!row) {
      return { ok: false, code: "NOT_FOUND", message: "Tenant non trovato." };
    }
    const customDomain = normalizeHostnamePublic(row.custom_domain);
    if (!customDomain || !row.custom_domain_verification_token) {
      return {
        ok: false,
        code: "DNS_NOT_VERIFIED",
        message:
          "Nessun dominio personalizzato configurato o token di verifica mancante: aggiungi prima il dominio.",
      };
    }

    const resolver: DnsResolver = opts?.resolver ?? getDnsResolver();
    const token = row.custom_domain_verification_token;

    const ownershipOk = await verifyOwnershipTxt(resolver, customDomain, token);
    if (!ownershipOk) {
      const now = new Date().toISOString();
      const supabase = await createSupabaseServerClient();
      try {
        await supabase
          .from("tenants")
          .update({
            custom_domain_status: "failed_disabled",
            updated_at: now,
          } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
          .eq("id", tenantId);
      } catch {
        // ignore RLS/transient failure on pessimistic status update
      }
      return {
        ok: false,
        code: "DNS_NOT_VERIFIED",
        message:
          "Record TXT di ownership non trovato. Verifica che _velora-verification.<tuo-dominio> contenga il valore corretto.",
      };
    }

    const routingReady = await verifyRouting(resolver, customDomain, row.temporary_domain);
    const now = new Date().toISOString();
    const supabase = await createSupabaseServerClient();

    if (!routingReady) {
      const { error: updErr } = await supabase
        .from("tenants")
        .update({
          custom_domain_status: "verified",
          custom_domain_verified_at: now,
          custom_domain_routing_ready: false,
          custom_domain_routing_verified_at: null,
          updated_at: now,
        } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
        .eq("id", tenantId);
      if (updErr) {
        const c = (updErr as { code?: string } | undefined)?.code ?? "";
        if (c === "42501") {
          return { ok: false, code: "AUTHZ_DENIED", message: "Non sei autorizzato." };
        }
      }
      revalidateDomainTag();
      return {
        ok: false,
        code: "ROUTING_NOT_READY",
        message:
          "Ownership verificata, ma il routing DNS non è ancora pronto. Imposta un CNAME verso il dominio temporaneo oppure configura il record A e riprova tra qualche minuto.",
      };
    }

    const { error: finalErr } = await supabase
      .from("tenants")
      .update({
        custom_domain_status: "verified",
        custom_domain_verified_at: now,
        custom_domain_routing_ready: true,
        custom_domain_routing_verified_at: now,
        updated_at: now,
      } as Partial<Database["public"]["Tables"]["tenants"]["Update"]>)
      .eq("id", tenantId);

    if (finalErr) {
      const c = (finalErr as { code?: string } | undefined)?.code ?? "";
      if (c === "42501") {
        return { ok: false, code: "AUTHZ_DENIED", message: "Non sei autorizzato." };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: "Salvataggio stato verifica fallito. Riprova tra un momento.",
      };
    }

    revalidateDomainTag();
    return { ok: true, code: "OK", verified: true, routing_ready: true };
  } catch (err) {
    const code = (err as { digest?: string } | undefined)?.digest;
    if (typeof code === "string" && code.startsWith("NEXT_REDIRECT")) throw err;
    return { ok: false, code: "AUTHZ_DENIED", message: "Accesso negato." };
  }
}
