export const TIME_OFF_TYPES = ["vacation", "sick", "leave", "training", "custom_block"] as const;

export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

export const TIME_OFF_TYPE_LABELS: Record<TimeOffType, string> = {
  vacation: "Ferie",
  sick: "Malattia",
  leave: "Permesso",
  training: "Formazione",
  custom_block: "Blocco",
};

export type PreviewConflictBooking = {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  service_id: string;
  service_name: string;
  resource_id: string;
  status: string;
};

export type ResourceTimeOffVM = {
  id: string;
  tenant_id: string;
  resource_id: string;
  type: TimeOffType;
  starts_at: string;
  ends_at: string;
  title: string | null;
  created_at: string;
};

export type TimeOffErrorCode =
  | "AUTHZ_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_INTERVAL"
  | "RANGE_TOO_LARGE"
  | "CONFLICT_PREVIEW_STALE"
  | "VALIDATION_ERROR"
  | "TIME_OFF_NOT_FOUND"
  | "UNKNOWN_ERROR";

export type TimeOffActionResult<T = never> = [T] extends [never]
  ? | { ok: true; code: "OK"; message?: string }
    | {
        ok: false;
        code: TimeOffErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
      }
  : | { ok: true; code: "OK"; message?: string; data: T }
    | {
        ok: false;
        code: TimeOffErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
