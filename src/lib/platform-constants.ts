export type PlanId = "base" | "pro" | "internal_test";

export const PLAN_IDS: PlanId[] = ["base", "pro", "internal_test"];

export function planLabel(p: string) {
  if (p === "internal_test") return "Internal Test";
  if (p === "pro") return "Pro";
  return "Base";
}

export function statusLabel(s: string) {
  if (s === "active") return "Attivo";
  if (s === "onboarding") return "Onboarding";
  if (s === "suspended") return "Sospeso";
  return s || "Sconosciuto";
}
