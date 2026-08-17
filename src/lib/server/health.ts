import { serverEnv } from "@/config/env";
import type { HealthCheckResponse } from "@/types";

const START_TIME = Date.now();

export function buildHealthResponse(): HealthCheckResponse {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "velora",
    version: process.env["npm_package_version"] ?? "0.0.0",
    checks: {
      uptime_ms: Date.now() - START_TIME,
    },
  };
}

export function isProduction(): boolean {
  return serverEnv.NODE_ENV === "production";
}
