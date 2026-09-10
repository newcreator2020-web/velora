import type {
  StudioDraftSection,
  StudioDraftService,
  StudioDraftTheme,
} from "@/lib/server/site-studio-pure";
import type { EntitlementsSnapshot } from "@/lib/server/entitlements";

export type EditorialActionResult =
  | {
      ok: true;
      revision: string;
      updated_at: string;
      values?: {
        sections: StudioDraftSection[];
        services: StudioDraftService[];
        theme: StudioDraftTheme;
      };
      info?: { kind: "SAVED" | "PUBLISHED" | "UNPUBLISHED"; payload?: unknown };
      error?: undefined;
      code?: undefined;
      fieldErrors?: undefined;
    }
  | {
      ok: false;
      error: string;
      code?:
        | "VALIDATION"
        | "AUTH"
        | "INTERNAL"
        | "CONCURRENT"
        | "AUTHZ"
        | "NO_DRAFT"
        | "ENTITLEMENT_DENIED"
        | "LIMIT_REACHED"
        | "CROSS_TENANT";
      fieldErrors?: Partial<Record<string, string[]>>;
      values?: {
        sections: StudioDraftSection[];
        services: StudioDraftService[];
        theme: StudioDraftTheme;
      };
      info?: undefined;
    };

export type PublicationStatus = "draft" | "ready_for_qa" | "validated" | "published";

export const PUBLICATION_ALLOWED_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  draft: ["ready_for_qa"],
  ready_for_qa: ["draft", "validated"],
  validated: ["draft", "published"],
  published: ["draft"],
};

export const PUBLICATION_STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: "Bozza",
  ready_for_qa: "Pronta per QA",
  validated: "Validata",
  published: "Pubblicata",
};

export type PublicationVersionRow = {
  id: string;
  tenant_id: string;
  version_number: number;
  status: PublicationStatus;
  snapshot: unknown;
  hash_sha256: string | null;
  published_at: string | null;
  created_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicationWorkflowState = {
  status: PublicationStatus;
  version_number: number;
  latest_published_at: string | null;
  latest_published_version: number | null;
};

export type EditorialInitialState = {
  ok: false;
  error: string;
  code?: undefined;
  values: {
    sections: StudioDraftSection[];
    services: StudioDraftService[];
    theme: StudioDraftTheme;
  };
  state: {
    tenant_id: string;
    slug: string;
    published: boolean;
    published_at: string | null;
    revision: string | null;
    updated_at: string | null;
    business_name: string;
    workflow: PublicationWorkflowState;
  };
  entitlements: EntitlementsSnapshot;
};

export type TransitionPublicationResult =
  | {
      ok: true;
      from: PublicationStatus;
      to: PublicationStatus;
      version_number: number;
      info?: string;
    }
  | {
      ok: false;
      error: string;
      code?: "AUTH" | "VALIDATION" | "INTERNAL" | "AUTHZ" | "INVALID_TRANSITION";
      from?: PublicationStatus;
      to?: PublicationStatus;
    };

export type DomainStatus = "none" | "pending" | "verified" | "failed";

export type DomainStateResult = {
  ok: true;
  customDomain: string | null;
  temporaryDomain: string | null;
  verificationToken: string;
  status: DomainStatus;
  statusReason?: string | null;
  routingReady: boolean;
  targetCname: string;
  targetA: string;
  slug: string;
  tenantStatus: string;
  canonicalUrl: string | null;
};

export type DomainActionResult =
  | {
      ok: true;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      code?: "AUTH" | "VALIDATION" | "INTERNAL" | "VERIFICATION_FAILED" | "ROUTING_NOT_READY";
    };

export type RollbackPublicationResult =
  | {
      ok: true;
      message: string;
      from_version_number: number;
      to_version_number_source: number;
      restored_status: PublicationStatus;
      new_version_number: number;
      sections_applied: number;
      services_applied: number;
      theme_applied: boolean;
      info?: undefined;
      error?: undefined;
      code?: undefined;
    }
  | {
      ok: false;
      error: string;
      code: "AUTH" | "VALIDATION" | "INTERNAL" | "AUTHZ" | "NOT_FOUND";
      message?: string;
      info?: undefined;
    };
