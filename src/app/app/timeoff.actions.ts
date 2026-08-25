"use server";
import {
  createResourceTimeOff,
  deleteResourceTimeOff,
  listResourceTimeOff,
  previewResourceTimeOff,
  type TimeOffActionResult,
  type PreviewConflictBooking,
  type ResourceTimeOffVM,
} from "@/lib/server/timeoff";

function actionFormToObject(a: unknown, b: unknown): unknown {
  if (b instanceof FormData) return Object.fromEntries(b.entries());
  if (typeof b === "object" && b !== null) return b;
  if (a instanceof FormData) return Object.fromEntries(a.entries());
  return b ?? a;
}

export async function previewResourceTimeOffAction(input: unknown): Promise<
  TimeOffActionResult<{
    conflicts: PreviewConflictBooking[];
    conflict_count: number;
  }>
> {
  const raw = input instanceof FormData ? Object.fromEntries(input.entries()) : input;
  return previewResourceTimeOff(raw);
}

export async function createResourceTimeOffAction(
  _: unknown,
  input: unknown,
): Promise<
  TimeOffActionResult<{
    id: string;
    resource_id: string;
    conflict_count: number;
    read_back: ResourceTimeOffVM;
  }>
> {
  return createResourceTimeOff(actionFormToObject(_, input));
}

export async function deleteResourceTimeOffAction(
  a: unknown,
  b?: unknown,
): Promise<TimeOffActionResult<{ id: string; resource_id: string }>> {
  const raw =
    a && typeof a === "object" && a !== null && "time_off_id" in a
      ? a
      : actionFormToObject(a, b ?? null);
  return deleteResourceTimeOff(raw);
}

export async function listResourceTimeOffAction(options?: {
  resource_id?: unknown;
  start_from_iso?: string;
}): Promise<ResourceTimeOffVM[]> {
  const start_from = options?.start_from_iso ? new Date(options.start_from_iso) : undefined;
  return listResourceTimeOff({
    ...(options?.resource_id ? { resource_id: options.resource_id } : {}),
    ...(start_from ? { start_from } : {}),
  });
}
