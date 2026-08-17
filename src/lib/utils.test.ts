import { describe, it, expect } from "vitest";
import { isNonEmptyString, formatUptime, safeJsonParse } from "@/lib/utils";
import { ok, err } from "@/types";

describe("isNonEmptyString", () => {
  it("returns true for non-empty strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("  a  ")).toBe(true);
  });

  it("returns false for empty or whitespace-only strings", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
  });
});

describe("formatUptime", () => {
  it("formats zero milliseconds", () => {
    expect(formatUptime(0)).toBe("0h 0m 0s");
  });

  it("formats seconds only", () => {
    expect(formatUptime(45_000)).toBe("0h 0m 45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatUptime(125_000)).toBe("0h 2m 5s");
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatUptime(3_661_000)).toBe("1h 1m 1s");
  });

  it("formats multi-digit hours", () => {
    expect(formatUptime(90_061_000)).toBe("25h 1m 1s");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON and returns ok result", () => {
    const result = safeJsonParse<{ name: string }>('{"name":"VELORA"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "VELORA" });
    }
  });

  it("parses valid array JSON", () => {
    const result = safeJsonParse<number[]>("[1,2,3]");
    expect(result).toEqual(ok([1, 2, 3]));
  });

  it("returns err result for invalid JSON", () => {
    const result = safeJsonParse("{ not valid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it("wraps non-Error exceptions into Error", () => {
    const str = '{"toJSON":()=>{throw "boom"}}';
    const result = safeJsonParse(str);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

describe("Result type helpers ok/err", () => {
  it("ok constructs a successful result", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it("err constructs a failing result", () => {
    const e = new Error("boom");
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(e);
    }
  });
});
