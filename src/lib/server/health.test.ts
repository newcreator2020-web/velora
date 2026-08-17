import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HealthCheckResponse } from "@/types";

describe("buildHealthResponse", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    vi.resetModules();
  });

  async function getBuildHealthResponse(): Promise<
    typeof import("@/lib/server/health").buildHealthResponse
  > {
    const mod = await import("@/lib/server/health");
    return mod.buildHealthResponse;
  }

  it("returns a well-formed health payload", async () => {
    const buildHealthResponse = await getBuildHealthResponse();
    const payload = buildHealthResponse();
    expect(payload).toMatchObject<HealthCheckResponse>({
      status: "ok",
      service: "velora",
      timestamp: expect.any(String),
      version: expect.any(String),
      checks: {
        uptime_ms: expect.any(Number),
      },
    });
  });

  it("includes a valid ISO timestamp", async () => {
    const buildHealthResponse = await getBuildHealthResponse();
    const payload = buildHealthResponse();
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });

  it("reports uptime greater than or equal to zero", async () => {
    const buildHealthResponse = await getBuildHealthResponse();
    const payload = buildHealthResponse();
    expect(payload.checks.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(payload.checks.uptime_ms)).toBe(true);
  });

  it("uptime increases after time advances", async () => {
    const buildHealthResponse = await getBuildHealthResponse();
    const first = buildHealthResponse();
    vi.advanceTimersByTime(5000);
    const second = buildHealthResponse();
    expect(second.checks.uptime_ms).toBeGreaterThanOrEqual(first.checks.uptime_ms + 5000);
  });
});
