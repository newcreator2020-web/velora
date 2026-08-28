import type { Result } from "@/types";
import { ok, err } from "@/types";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function slugFromBusinessName(raw: string): string {
  let s = (raw || "").toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  s = s.slice(0, 40);
  if (s.length < 3) s = "attivita";
  return s;
}

export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function safeJsonParse<T = unknown>(input: string): Result<T> {
  try {
    const value = JSON.parse(input) as T;
    return ok(value);
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return err(error);
  }
}
