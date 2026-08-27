import "server-only";
import dns from "node:dns";
import { serverEnv } from "@/config/env";

export type DnsLookupAddress = {
  address: string;
  family: 4 | 6;
};

export type DnsTxtRecord = string[][];

export interface DnsResolver {
  lookup(hostname: string): Promise<DnsLookupAddress>;
  resolveTxt(hostname: string): Promise<DnsTxtRecord>;
  resolveCname(hostname: string): Promise<string>;
}

export class DefaultDnsResolver implements DnsResolver {
  private readonly resolver: typeof dns.promises;

  constructor(resolver?: typeof dns.promises) {
    this.resolver = resolver ?? dns.promises;
  }

  async lookup(hostname: string): Promise<DnsLookupAddress> {
    const { address, family } = await this.resolver.lookup(hostname, { family: 4 });
    const fam = (family === 6 ? 6 : 4) as 4 | 6;
    return { address, family: fam };
  }

  async resolveTxt(hostname: string): Promise<DnsTxtRecord> {
    const records = await this.resolver.resolveTxt(hostname);
    return records.map((r) => [...r]);
  }

  async resolveCname(hostname: string): Promise<string> {
    const records = await this.resolver.resolveCname(hostname);
    if (records.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`queryCname ENODATA ${hostname}`);
      err.code = "ENODATA";
      throw err;
    }
    return String(records[0]);
  }
}

export type DnsMockPayload = {
  lookup?: Record<string, DnsLookupAddress | undefined>;
  resolveTxt?: Record<string, DnsTxtRecord | undefined>;
  resolveCname?: Record<string, string | undefined>;
};

function parseDnsMock(raw: string | undefined): DnsMockPayload | null {
  if (!raw || typeof raw !== "string" || raw.length === 0) return null;
  const nodeEnv = serverEnv.NODE_ENV ?? "development";
  if (nodeEnv === "production") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DnsMockPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export class MockDnsResolver implements DnsResolver {
  private readonly mock: DnsMockPayload;
  private readonly fallback: DnsResolver | null;

  constructor(mock: DnsMockPayload, fallback?: DnsResolver | null) {
    this.mock = mock;
    this.fallback = fallback ?? null;
  }

  private missOrThrow<K extends keyof DnsMockPayload>(
    tableKey: K,
    hostname: string,
  ): NonNullable<DnsMockPayload[K]>[string] | undefined {
    const table = this.mock[tableKey] as Record<string, unknown> | undefined;
    if (!table) return undefined;
    return table[hostname] as NonNullable<DnsMockPayload[K]>[string] | undefined;
  }

  async lookup(hostname: string): Promise<DnsLookupAddress> {
    const hit = this.missOrThrow("lookup", hostname);
    if (hit) return { ...hit };
    if (this.fallback) return this.fallback.lookup(hostname);
    const err: NodeJS.ErrnoException = new Error(`queryA ENOTFOUND ${hostname}`);
    err.code = "ENOTFOUND";
    throw err;
  }

  async resolveTxt(hostname: string): Promise<DnsTxtRecord> {
    const hit = this.missOrThrow("resolveTxt", hostname);
    if (hit) return hit.map((r) => [...r]);
    if (this.fallback) return this.fallback.resolveTxt(hostname);
    const err: NodeJS.ErrnoException = new Error(`queryTxt ENODATA ${hostname}`);
    err.code = "ENODATA";
    throw err;
  }

  async resolveCname(hostname: string): Promise<string> {
    const hit = this.missOrThrow("resolveCname", hostname);
    if (hit) return String(hit);
    if (this.fallback) return this.fallback.resolveCname(hostname);
    const err: NodeJS.ErrnoException = new Error(`queryCname ENODATA ${hostname}`);
    err.code = "ENODATA";
    throw err;
  }
}

let cachedResolver: DnsResolver | null = null;

export function getDnsResolver(): DnsResolver {
  if (cachedResolver) return cachedResolver;
  const mock = parseDnsMock(process.env["VELORA_DNS_MOCK"]);
  const base: DnsResolver = new DefaultDnsResolver();
  cachedResolver = mock ? new MockDnsResolver(mock, base) : base;
  return cachedResolver;
}

export function resetDnsResolverCache(): void {
  cachedResolver = null;
}

export function createDnsResolverFromMock(mock: DnsMockPayload): DnsResolver {
  return new MockDnsResolver(mock, null);
}
