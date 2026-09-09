import { z } from "zod";

export type ProspectDedupCandidate = {
  business_name: string;
  telefono: string | null;
};

export function findDuplicateProspect<TRow extends ProspectDedupCandidate>(
  rows: TRow[],
  candidate: ProspectDedupCandidate,
): TRow | null {
  const candidateName = candidate.business_name.trim();
  const candidateTel = (candidate.telefono ?? "").trim();

  for (const row of rows) {
    const rowName = row.business_name.trim();
    const rowTel = (row.telefono ?? "").trim();
    if (rowName === candidateName && rowTel === candidateTel) {
      return row;
    }
  }
  return null;
}

export function slugFromBusinessName(nome: string, comune?: string): string {
  const base = `${nome}${comune ? " " + comune : ""}`;
  return base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export const PHONE_REGEX = /^[+]?[\d\s().-]{6,20}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ProspectStatuses = [
  "mai_contattato",
  "da_chiamare",
  "chiamato",
  "richiamare",
  "interessato",
  "cliente",
  "non_interessato",
  "non_contattare",
] as const;

export type ProspectStatus = (typeof ProspectStatuses)[number];

export const ProspectCreateSchema = z.object({
  business_name: z.string().trim().min(2).max(200),
  business_category: z.string().trim().max(100).nullish(),
  comune: z.string().trim().min(1).max(120),
  telefono: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || PHONE_REGEX.test(v), "Formato telefono non valido"),
  email: z
    .string()
    .trim()
    .nullish()
    .refine((v) => !v || EMAIL_REGEX.test(v), "Formato email non valido"),
  sito_web: z.boolean().optional().default(false),
  sito_quality_score: z.number().int().min(0).max(10).nullish(),
  gmb_url: z.string().trim().max(400).nullish(),
  status: z.enum(ProspectStatuses).optional().default("mai_contattato"),
  note: z.string().trim().max(5000).nullish(),
  ultimo_contatto_at: z.string().datetime().nullish(),
  prossimo_contatto_at: z.string().datetime().nullish(),
  assigned_to: z.string().uuid().nullish(),
});

export const ProspectUpdateSchema = ProspectCreateSchema.partial();

export const ProspectActivityKind = [
  "chiamata",
  "sms",
  "email",
  "appuntamento",
  "nota_interna",
  "cambio_stato",
  "cambio_assegnazione",
  "promosso_tenant",
] as const;

export type ProspectActivityKindT = (typeof ProspectActivityKind)[number];

export const ProspectActivitySchema = z.object({
  prospect_id: z.string().uuid(),
  activity_kind: z.enum(ProspectActivityKind),
  summary: z.string().trim().min(1).max(2000),
  outcome: z.string().trim().max(1000).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

export type ListProspectsQuery = {
  q?: string;
  status?: ProspectStatus;
  categoria?: string;
  comune?: string;
  assigned_to?: string;
  solo_prossimi_7gg?: boolean;
  limit?: number;
};
