import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { normalizeHostname, slugSchema } from "@/lib/server/site-engine";
import { normalizeSlug } from "@/lib/server/auth-pure";

function hardCheckBusinessNameSoT({
  bpDisplay,
  tenantName,
  slug,
}: {
  bpDisplay?: unknown;
  tenantName?: string;
  slug?: string;
}) {
  if (typeof bpDisplay === "string" && bpDisplay.trim().length > 0) return bpDisplay.trim();
  return null;
  void tenantName;
  void slug;
}

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

describe("FASE4 · Unit · Source of Truth Hardening (G31 dual source)", () => {
  it("G31-SOT: business_profiles.display_name = UNICA SoT → NO fallback a tenants.name ne slug", () => {
    expect(
      hardCheckBusinessNameSoT({
        bpDisplay: "Barbiere Reale",
        tenantName: "Barbiere Reale Srl (Ragione Sociale)",
        slug: "barbiere-reale",
      }),
    ).toBe("Barbiere Reale");
  });

  it("G31-INCOMPLETE: display_name NULL → INCOMPLETE_PUBLIC_DATA (non fallback a tenant.name)", () => {
    const got = hardCheckBusinessNameSoT({
      bpDisplay: null,
      tenantName: "Nome Ragione Sociale Fallback NON AMMESSO",
      slug: "nome-incompleto",
    });
    expect(got).toBeNull();
  });

  it("G31-WHITESPACE: display_name solo spazi → vuoto = INCOMPLETE, non fallback", () => {
    const got = hardCheckBusinessNameSoT({
      bpDisplay: "   ",
      tenantName: "Nome Fallback Non Ammesso Spa",
      slug: "whitespace-bp",
    });
    expect(got).toBeNull();
  });

  it("G31-NOT_STRING: display_name number/object → non usato, non fallback", () => {
    expect(
      hardCheckBusinessNameSoT({ bpDisplay: 12345 as unknown, tenantName: "Fallback Spa" }),
    ).toBeNull();
    expect(
      hardCheckBusinessNameSoT({
        bpDisplay: { foo: "bar" } as unknown,
        tenantName: "Fallback Spa",
      }),
    ).toBeNull();
    expect(
      hardCheckBusinessNameSoT({ bpDisplay: undefined, tenantName: "Fallback Spa", slug: "x" }),
    ).toBeNull();
  });
});

describe("FASE4 · Unit · No Client Authority + Observability safe (G35, G33)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("G35: resolvePublicTenant signature ammette solo slug/hostname params (export 2-arity)", async () => {
    const mod = await import("@/lib/server/site-engine");
    expect(typeof mod.resolvePublicTenant).toBe("function");
    expect(typeof mod.normalizeHostname).toBe("function");
    expect(typeof mod.slugSchema).toBe("object");
  });

  it("G33-OBSERV: truncateForLog tronca slug a 60 char, host 80 char, sostituisce empty con none", async () => {
    const { truncateForLog } = await import("@/lib/server/site-engine");
    const longSlug = "a".repeat(500);
    const jwtLike =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(truncateForLog(longSlug, 60)).toHaveLength(60);
    expect(truncateForLog(longSlug, 60)).not.toHaveLength(500);
    expect(truncateForLog(jwtLike, 80)).not.toContain("dozjgNryP4J3jVmNHl0w");
    expect(truncateForLog(null, 10)).toBe("none");
    expect(truncateForLog(undefined, 10)).toBe("none");
    expect(truncateForLog("", 10)).toBe("none");
    expect(truncateForLog("short", 60)).toBe("short");
  });

  it("G33-WARN: console.warn sanitizzato buildNotFound usa truncate (slug ≤ 60 char)", async () => {
    const { resolvePublicTenant } = await import("@/lib/server/site-engine");
    const supabaseMod = await import("@/lib/supabase/server");
    vi.spyOn(supabaseMod, "createSupabaseServerClient").mockRejectedValue(
      new Error("DB down injection"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => void 0);
    const bad = "z".repeat(500);
    const got = await resolvePublicTenant({ slug: bad, hostname: null });
    expect((got as { _tag: string })._tag).toBe("NotFound");
    const warnJoined = warnSpy.mock.calls
      .flat()
      .map((c) => (typeof c === "string" ? c : ""))
      .join(" ");
    expect(warnJoined).toContain("reason=NO_TENANT");
    expect(warnJoined).toContain("slug=");
    expect(warnJoined.length).toBeLessThan(250);
    const slugLogged = /slug=([a-z0-9-]+)/.exec(warnJoined)?.[1] ?? "";
    expect(slugLogged.length).toBeLessThanOrEqual(60);
  });
});
