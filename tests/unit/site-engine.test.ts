import { describe, expect, it } from "vitest";
import { normalizeHostname, slugSchema } from "@/lib/server/site-engine";
import { normalizeSlug } from "@/lib/server/auth-pure";

describe("FASE4 · Unit · normalizeHostname / Slug Security (T5-T6 / T21)", () => {
  it("slug normalizza lowercase, sostituisce spazi/underscore e accenti", () => {
    expect(normalizeSlug("  Mario's Bar  ")).toMatch(/^mario-s-bar/);
    expect(normalizeSlug("Bellezza & Relax")).toMatch(/^bellezza-relax/);
    expect(normalizeSlug("Pizzerìa Napoletàna")).toMatch(/^pizzeria-napoletana/);
  });

  it("slug accetta valori URL-safe; rifiuta path traversal / injection chars", () => {
    const traversalInputs = [
      "../etc/passwd",
      "..%2fetc%2fpasswd",
      "foo/bar",
      "foo..bar",
      "foo bar/baz",
      "x".repeat(80),
    ];
    for (const bad of traversalInputs) {
      const normalized = normalizeSlug(bad);
      expect(normalized).not.toContain("/");
      expect(normalized).not.toContain("\\");
      expect(normalized.length).toBeLessThanOrEqual(40);
    }
  });

  it("slugSchema valida lunghezza 2..60 e pattern ^[a-z0-9][a-z0-9-]*$", () => {
    expect(slugSchema.safeParse("ab").success).toBe(true);
    expect(slugSchema.safeParse("a-b-c-9").success).toBe(true);
    expect(slugSchema.safeParse("a").success).toBe(false);
    // Leading/trailing hyphens sono rimossi durante normalizzazione → "leadingdash" valido.
    expect(slugSchema.safeParse("-leadingdash").success).toBe(true);
    expect(slugSchema.parse("-leadingdash") as string).toBe("leadingdash");
    expect(slugSchema.safeParse("UPPERCASE-123").success).toBe(true);
    expect((slugSchema.parse("UPPERCASE-123") as string).toLowerCase()).toBe("uppercase-123");
    // spazi e dots sono normalizzati a hyphen → esito valido (atteso true, non false).
    expect(slugSchema.safeParse("spaces not allowed").success).toBe(true);
    expect(slugSchema.parse("spaces not allowed") as string).toBe("spaces-not-allowed");
    expect(slugSchema.safeParse("dots.not.allowed").success).toBe(true);
    expect(slugSchema.parse("dots.not.allowed") as string).toBe("dots-not-allowed");
    expect(slugSchema.safeParse("a").success).toBe(false);
    expect(slugSchema.safeParse("ab").success).toBe(true);
    const long80 = "a".repeat(80);
    expect(slugSchema.parse(long80) as string).toHaveLength(40);
    expect(slugSchema.safeParse(long80).success).toBe(true);
  });

  it("normalizeHostname normalizza lowercase, rimuove porta e trailing dot, rifiuta invalid", () => {
    expect(normalizeHostname("Example.COM:3000")).toBe("example.com");
    expect(normalizeHostname("Sub.Example.COM.")).toBe("sub.example.com");
    expect(normalizeHostname("  localHost  ")).toBe("localhost");
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname("")).toBeNull();
    expect(normalizeHostname("space in host.com")).toBeNull();
    expect(normalizeHostname("-nope.com")).toBeNull();
    expect(normalizeHostname("foo..bar")).toBeNull();
    expect(normalizeHostname("a".repeat(254) + ".com")).toBeNull();
    expect(normalizeHostname("<script>")).toBeNull();
    expect(normalizeHostname("host<script>")).toBeNull();
  });
});
