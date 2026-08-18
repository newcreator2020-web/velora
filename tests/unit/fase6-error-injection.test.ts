import { describe, it, expect } from "vitest";
import {
  stripEditorialTamperedFields,
  normalizeSectionsForDb,
  normalizeServicesForDb,
  maskEditorialAudit,
  editorialDraftInputSchema,
  studioSectionSchema,
  studioServiceSchema,
  studioThemeSchema,
  type StudioDraftSection,
  type StudioDraftService,
} from "@/lib/server/site-studio-pure";

describe("§36 FASE 6 ERROR INJECTION + SAFETY (pure functions, NO backdoor)", () => {
  describe("T1-T10 TAMPERING WHITELIST: stripEditorialTamperedFields scarta chiavi autorevoli", () => {
    it("T1: tenant_id (tenant B) viene SCARTATO dal payload", () => {
      const raw = {
        sections: [],
        services: [],
        theme: {},
        tenant_id: "00000000-0000-0000-0000-00000000000b",
      } as Record<string, unknown>;
      const out = stripEditorialTamperedFields(raw);
      expect(Object.keys(out).sort()).toStrictEqual(["sections", "services", "theme"].sort());
      expect(out).not.toHaveProperty("tenant_id");
    });

    it("T2/T3: user_id e role vengono SCARTATI", () => {
      const raw = {
        sections: [],
        services: [],
        theme: {},
        revision: null,
        user_id: "11111111-1111-1111-1111-111111111111",
        role: "owner",
      } as Record<string, unknown>;
      const out = stripEditorialTamperedFields(raw);
      expect(Object.keys(out).sort()).toStrictEqual(
        ["sections", "services", "theme", "revision"].sort(),
      );
      expect(out).not.toHaveProperty("user_id");
      expect(out).not.toHaveProperty("role");
    });

    it("T4: published=true autorevole dal client VIENE SCARTATO", () => {
      const raw = { sections: [], services: [], theme: {}, published: true };
      const out = stripEditorialTamperedFields(raw);
      expect(out).not.toHaveProperty("published");
    });

    it("T5: business_profile_id=B SCARTATO", () => {
      const raw = { sections: [], services: [], theme: {}, business_profile_id: "bp-b" };
      const out = stripEditorialTamperedFields(raw);
      expect(out).not.toHaveProperty("business_profile_id");
    });

    it("T8/T9/T10: section_type arbitrario extra, theme token arbitrario, __proto__ scartati", () => {
      const payload: Record<string, unknown> = {
        sections: [],
        services: [],
        theme: {},
        bogus_section: "hacked",
        arbitrary_theme_extra: "x",
      };
      Object.defineProperty(payload, "__proto__", {
        value: { isAdmin: true },
        enumerable: true,
      });
      const out = stripEditorialTamperedFields(payload);
      expect(out).not.toHaveProperty("bogus_section");
      expect(out).not.toHaveProperty("arbitrary_theme_extra");
    });
  });

  describe("SEZIONI INVALIDE: nessun fake success; safeParse filtrato da editorialDraftInputSchema transform", () => {
    it("section_type NON consentito ('fake_section') viene filtrato fuori", () => {
      const badSection: unknown = {
        id: null,
        section_type: "fake_section",
        enabled: true,
        position: 0,
        variant: "default",
        settings: {},
      };
      const parsed = editorialDraftInputSchema.safeParse({
        sections: [badSection],
        services: [],
        theme: {},
      });
      expect(parsed.success).toBe(true);
      expect((parsed.data as { sections: unknown[] }).sections).toHaveLength(0);
    });

    it("section variant invalida → viene ricaduta a 'default' in normalizeSectionsForDb", () => {
      const badVariant = {
        id: null,
        section_type: "hero",
        enabled: true,
        position: 0,
        variant: "DOES_NOT_EXIST_variant",
        settings: {},
      } as unknown as StudioDraftSection;
      const norm = normalizeSectionsForDb([badVariant]);
      expect(norm).toHaveLength(1);
      expect(norm[0].variant).toBe("default");
    });

    it("SINGLETON hero due volte → secondo hero RIMOSSO (duplicate dedup)", () => {
      const hero1 = {
        id: null,
        section_type: "hero",
        enabled: true,
        position: 0,
        variant: "default",
        settings: {},
      } as StudioDraftSection;
      const hero2 = {
        id: null,
        section_type: "hero",
        enabled: true,
        position: 1,
        variant: "default",
        settings: {},
      } as StudioDraftSection;
      const about = {
        id: null,
        section_type: "about",
        enabled: true,
        position: 2,
        variant: "default",
        settings: {},
      } as StudioDraftSection;
      const norm = normalizeSectionsForDb([hero1, hero2, about]);
      const types = norm.map((r) => r.section_type);
      expect(types).toStrictEqual(["hero", "about"]);
    });

    it("REORDER con gap e duplicati position: A(99),B(5),C(5) → cursor 0,1,2 (no UNIQUE collision)", () => {
      const sA = { id: null, section_type: "hero", enabled: true, position: 99, variant: "default", settings: {} } as StudioDraftSection;
      const sB = { id: null, section_type: "about", enabled: true, position: 5, variant: "default", settings: {} } as StudioDraftSection;
      const sC = { id: null, section_type: "services", enabled: true, position: 5, variant: "default", settings: {} } as StudioDraftSection;
      const norm = normalizeSectionsForDb([sA, sB, sC]);
      expect(norm.map((r) => r.position)).toStrictEqual([0, 1, 2]);
    });
  });

  describe("SERVIZI INVALIDI: rejection e normalizzazione sicura", () => {
    it("nome servizio vuoto viene SCARTATO da normalizeServicesForDb", () => {
      const bad = {
        id: null,
        name: "   ",
        description: null,
        price_from: 0,
        currency: "EUR",
        duration_minutes: null,
        position: 0,
        active: true,
      } as unknown as StudioDraftService;
      const norm = normalizeServicesForDb([bad]);
      expect(norm).toHaveLength(0);
    });

    it("prezzo negativo (-1) → viene annullato a null (no scrittura <0)", () => {
      const badPrice = {
        id: null,
        name: "Taglio",
        description: null,
        price_from: -1,
        currency: "EUR",
        duration_minutes: 30,
        position: 0,
        active: true,
      } as StudioDraftService;
      const norm = normalizeServicesForDb([badPrice]);
      expect(norm).toHaveLength(1);
      expect(norm[0].price_from).toBeNull();
    });

    it("currency non ammessa (XBT) → fallback a EUR, nessun success fake", () => {
      const bad = {
        id: null,
        name: "Taglio",
        description: null,
        price_from: 10,
        currency: "XBT",
        duration_minutes: 30,
        position: 0,
        active: true,
      } as StudioDraftService;
      const norm = normalizeServicesForDb([bad]);
      expect(norm[0].currency).toBe("EUR");
    });

    it("NaN / Infinity prezzo → price_from=null", () => {
      const nanP: unknown = {
        id: null,
        name: "Taglio",
        price_from: NaN,
        currency: "EUR",
        position: 0,
        active: true,
      };
      const infP: unknown = {
        id: null,
        name: "Piega",
        price_from: Infinity,
        currency: "EUR",
        position: 1,
        active: true,
      };
      const norm = normalizeServicesForDb([nanP, infP] as StudioDraftService[]);
      expect(norm[0].price_from).toBeNull();
      expect(norm[1].price_from).toBeNull();
    });
  });

  describe("THEME: colori e token arbitrari rifiutati (no CSS injection)", () => {
    it("colore non-hex 'javascript:alert(1)' → rifiutato da studioThemeSchema", () => {
      const r = studioThemeSchema.safeParse({ primary: "javascript:alert(1)" });
      expect(r.success).toBe(false);
    });

    it("url('evil') come primary → rifiutato (non hex)", () => {
      const r = studioThemeSchema.safeParse({ background: "url('https://evil.com/x.png')" });
      expect(r.success).toBe(false);
    });

    it("radius non enum → rifiutato; NON consentiamo CSS arbitrario", () => {
      const r = studioThemeSchema.safeParse({ radius: "9999px" });
      expect(r.success).toBe(false);
    });

    it("key arbitraria styleInject non presente in schema → stripata da Zod strict-ish object", () => {
      const r = studioThemeSchema.safeParse({
        primary: "#ff0000",
        styleInject: "body{color:red}",
      } as unknown as Parameters<typeof studioThemeSchema.safeParse>[0]);
      expect(r.success).toBe(true);
      expect((r as { success: true; data: Record<string, unknown> }).data).not.toHaveProperty("styleInject");
    });
  });

  describe("AUDIT MASKING: nessun PII sensibile in maskEditorialAudit", () => {
    it("ritorna solo counts + theme_fields; NO nome servizi, NO testi liberi", () => {
      const audit = maskEditorialAudit({
        sections: [{}, {}, {}],
        services: [{ name: "Mario Rossi Visita Privata" }, { phone: "+393331234567" } as unknown as unknown[]],
        theme: { primary: "#111", background: "#222", headingFont: "Inter" },
      });
      expect(audit["sections_count"]).toBe(3);
      expect(audit["services_count"]).toBe(2);
      expect(audit["theme_fields"]).toStrictEqual(["primary", "background", "headingFont"]);
      expect(audit).not.toHaveProperty("Mario");
      expect(audit).not.toHaveProperty("phone");
      expect(JSON.stringify(audit)).not.toContain("+39333");
    });
  });

  describe("ZOD: nessun falso success su schema section/service invalidi base", () => {
    it("studioSectionSchema: section_type='phishing' → success=false", () => {
      const r = studioSectionSchema.safeParse({
        section_type: "phishing",
        enabled: true,
        position: 0,
      });
      expect(r.success).toBe(false);
    });

    it("studioServiceSchema: name min 1 ma stringa vuota → success=false", () => {
      const r = studioServiceSchema.safeParse({
        name: "",
        currency: "EUR",
        position: 0,
        active: true,
      });
      expect(r.success).toBe(false);
    });
  });
});
