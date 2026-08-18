import { describe, it, expect } from "vitest";
import { loginSchema, onboardingSchema, normalizeSlug, safeRedirect } from "@/lib/server/auth-pure";
import { isAtLeastRole, ROLE_RANK } from "@/modules/auth/core/roles";

describe("Auth — Validation schemas", () => {
  describe("loginSchema", () => {
    it("accepts valid email + password", () => {
      const r = loginSchema.safeParse({
        email: "mario@velora.test",
        password: "secret123",
        next: "/dashboard",
      });
      expect(r.success).toBe(true);
    });

    it("rejects blank password", () => {
      const r = loginSchema.safeParse({
        email: "mario@velora.test",
        password: "",
        next: undefined,
      });
      expect(r.success).toBe(false);
    });

    it("rejects invalid email format", () => {
      const r = loginSchema.safeParse({ email: "not-an-email", password: "x" });
      expect(r.success).toBe(false);
    });

    it("trims and lowercases email", () => {
      const r = loginSchema.safeParse({
        email: "  MARIO@velora.TEST  ",
        password: "abcdef12",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.email).toBe("mario@velora.test");
    });

    it("safe-redirects enforce internal path only", () => {
      const r1 = loginSchema.safeParse({
        email: "mario@velora.test",
        password: "x",
        next: "https://evil.example",
      });
      expect(r1.success).toBe(false);
      const r2 = loginSchema.safeParse({
        email: "mario@velora.test",
        password: "x",
        next: "/dashboard?x=1",
      });
      expect(r2.success).toBe(true);
    });
  });

  describe("onboardingSchema", () => {
    const base = {
      business_name: "Mario Hair",
      category: "Parrucchiere",
      city: "Milano",
      province: "MI",
      phone: "",
      business_email: "",
      timezone: "Europe/Rome",
      locale: "it-IT",
    };

    it("accepts minimal valid payload (optional empty)", () => {
      const r = onboardingSchema.safeParse(base);
      expect(r.success).toBe(true);
    });

    it("rejects missing required", () => {
      const r = onboardingSchema.safeParse({ ...base, business_name: "" });
      expect(r.success).toBe(false);
    });

    it("rejects too long province (>4)", () => {
      const r = onboardingSchema.safeParse({ ...base, province: "MILANO" });
      expect(r.success).toBe(false);
    });

    it("rejects invalid business email format if provided", () => {
      const r = onboardingSchema.safeParse({ ...base, business_email: "not-email" });
      expect(r.success).toBe(false);
    });

    it("accepts valid optional business email", () => {
      const r = onboardingSchema.safeParse({
        ...base,
        business_email: "info@mario.test",
      });
      expect(r.success).toBe(true);
    });
  });
});

describe("Auth — slug normalization", () => {
  it("lowercases + hyphenates spaces", () => {
    expect(normalizeSlug("Mario Hair Studio")).toBe("mario-hair-studio");
  });

  it("removes accents (NFKD)", () => {
    expect(normalizeSlug("Café à la mode")).toBe("cafe-a-la-mode");
  });

  it("strips special chars + squeezes hyphens", () => {
    expect(normalizeSlug("Hello...  World!!1")).toBe("hello-world-1");
  });

  it("trims + enforces max length (default 40)", () => {
    const long = "a".repeat(60);
    expect(normalizeSlug(long)).toHaveLength(40);
  });

  it("returns fallback for empty", () => {
    expect(normalizeSlug("   ")).toMatch(/^tenant-[a-z0-9]{6}$/);
  });
});

describe("Auth — safe redirect anti open-redirect", () => {
  it("allows internal paths", () => {
    expect(safeRedirect("/dashboard")).toBe("/dashboard");
    expect(safeRedirect("/onboarding?ref=x")).toBe("/onboarding?ref=x");
    expect(safeRedirect("/a-b_c/d.e?f=1&g=2%20h")).toBe("/a-b_c/d.e?f=1&g=2%20h");
  });

  it("blocks protocol URLs", () => {
    expect(safeRedirect("https://evil.it/steal", "/")).toBe("/");
    expect(safeRedirect("//evil.it", "/")).toBe("/");
    expect(safeRedirect("javascript:alert(1)", "/")).toBe("/");
    expect(safeRedirect("file:///etc/passwd", "/")).toBe("/");
  });

  it("blocks empty/invalid", () => {
    expect(safeRedirect("", "/")).toBe("/");
    expect(safeRedirect("nope-without-leading-slash", "/")).toBe("/");
    expect(safeRedirect("")).toBe("/dashboard");
  });

  it("uses default fallback", () => {
    expect(safeRedirect("evil", "/login")).toBe("/login");
  });
});

describe("Auth — Role guards", () => {
  it("ranks ordered staff < manager < owner < platform_admin", () => {
    expect(ROLE_RANK.staff).toBeLessThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeLessThan(ROLE_RANK.owner);
    expect(ROLE_RANK.owner).toBeLessThan(ROLE_RANK.platform_admin);
  });

  it("isAtLeastRole owner accepts owner + platform_admin, rejects lower", () => {
    expect(isAtLeastRole("owner", "owner")).toBe(true);
    expect(isAtLeastRole("platform_admin", "owner")).toBe(true);
    expect(isAtLeastRole("manager", "owner")).toBe(false);
    expect(isAtLeastRole("staff", "manager")).toBe(false);
    expect(isAtLeastRole("staff", "staff")).toBe(true);
  });

  it("handles unknown / null roles safely", () => {
    expect(isAtLeastRole("staff", "owner")).toBe(false);
    // @ts-expect-error test runtime invalid
    expect(isAtLeastRole("owner", undefined)).toBe(false);
  });
});
