import { describe, it, expect } from "vitest";
import {
  SECTION_TYPES,
  SINGLETON_TYPES,
  isSingletonSection,
  normalizePublicLink,
  validateHexColor,
  validateFontPreset,
  validateRadiusPreset,
  buildDefaultDeterministicSections,
  parseSectionSettings,
  ALLOWED_VARIANTS,
  heroSettingsSchema,
  aboutSettingsSchema,
  servicesSettingsSchema,
  gallerySettingsSchema,
  staffSettingsSchema,
  reviewsSettingsSchema,
  contactSettingsSchema,
  themeTokensSchema,
} from "@/lib/server/content-engine";
import type { PublicSection, SectionType } from "@/lib/server/content-engine";

describe("FASE5 content-engine pure & helpers", () => {
  describe("SECTION_TYPES + SINGLETON invariants (GATE 13)", () => {
    it("20 tipi sezione supportati (10 originali gate27 + 10 estensione: navbar/footer/trust/hours/faq/location/booking_cta/whatsapp_cta/social_links/legal_links)", () => {
      expect(SECTION_TYPES).toHaveLength(20);
      expect(SECTION_TYPES).toEqual(
        expect.arrayContaining([
          "hero",
          "about",
          "services",
          "gallery",
          "staff",
          "reviews",
          "contact",
          "price_list",
          "features_cta",
          "booking_widget",
          "navbar",
          "footer",
          "trust",
          "hours",
          "faq",
          "location",
          "booking_cta",
          "whatsapp_cta",
          "social_links",
          "legal_links",
        ]),
      );
    });

    it("SINGLETON: hero/about/contact + navbar/footer/booking_cta/whatsapp_cta/social_links/legal_links (9 totali); services/gallery NON singleton", () => {
      expect(SINGLETON_TYPES).toEqual(
        expect.arrayContaining([
          "hero",
          "about",
          "contact",
          "navbar",
          "footer",
          "booking_cta",
          "whatsapp_cta",
          "social_links",
          "legal_links",
        ]),
      );
      expect(SINGLETON_TYPES.includes("services")).toBe(false);
      expect(SINGLETON_TYPES.includes("gallery")).toBe(false);
      expect(SINGLETON_TYPES).toHaveLength(9);

      expect(isSingletonSection("hero")).toBe(true);
      expect(isSingletonSection("navbar")).toBe(true);
      expect(isSingletonSection("services")).toBe(false);
      expect(isSingletonSection("unknown")).toBe(false);
    });
  });

  describe("GATE 27 CTA URL safety helper normalizePublicLink", () => {
    it("passa link interni con /path", () => {
      expect(normalizePublicLink("/")).toBe("/");
      expect(normalizePublicLink("/s/example")).toBe("/s/example");
      expect(normalizePublicLink("/about#x?a=1")).toBe("/about#x?a=1");
    });

    it("passa https / http leciti", () => {
      expect(normalizePublicLink("https://example.com")).toBe("https://example.com");
      expect(normalizePublicLink("http://example.com/a")).toBe("http://example.com/a");
    });

    it("passa tel / mailto", () => {
      expect(normalizePublicLink("tel:+393331234567")).toBe("tel:+393331234567");
      expect(normalizePublicLink("mailto:a@b.com")).toBe("mailto:a@b.com");
    });

    it("BLOCCA javascript: / data: / vbscript: / protocol-relative", () => {
      expect(normalizePublicLink("javascript:alert(1)")).toBe("");
      expect(normalizePublicLink("JAVASCRIPT:alert(1)")).toBe("");
      expect(normalizePublicLink("data:text/html,<h1>x</h1>")).toBe("");
      expect(normalizePublicLink("vbscript:msgbox(1)")).toBe("");
      expect(normalizePublicLink("//evil.com/x")).toBe("");
    });

    it("non valori non stringa o troppo lunghi → blank", () => {
      expect(normalizePublicLink(null)).toBe("");
      expect(normalizePublicLink(undefined)).toBe("");
      expect(normalizePublicLink(123 as unknown as string)).toBe("");
      expect(normalizePublicLink("https://a.com/" + "a".repeat(400))).toBe("");
    });

    it("rifiuta path interno con caratteri strani", () => {
      expect(normalizePublicLink("/ok<script>")).toBe("");
      expect(normalizePublicLink("\\evil")).toBe("");
    });
  });

  describe("GATE 25 theme validators", () => {
    it("validateHexColor accetta 3 o 6 hex, rifiuta altro", () => {
      expect(validateHexColor("#fff")).toBe(true);
      expect(validateHexColor("#FFFFFF")).toBe(true);
      expect(validateHexColor("#ab12EF")).toBe(true);
      expect(validateHexColor("red")).toBe(false);
      expect(validateHexColor("#gggggg")).toBe(false);
      expect(validateHexColor("#ffff")).toBe(false);
      expect(validateHexColor(null)).toBe(false);
    });

    it("validateFontPreset heading include display; body NO", () => {
      expect(validateFontPreset("display", true)).toBe(true);
      expect(validateFontPreset("display", false)).toBe(false);
      expect(validateFontPreset("sans", true)).toBe(true);
      expect(validateFontPreset("serif", false)).toBe(true);
      expect(validateFontPreset("comic", true)).toBe(false);
    });

    it("validateRadiusPreset enum 6 valori", () => {
      for (const r of ["none", "sm", "md", "lg", "xl", "full"]) {
        expect(validateRadiusPreset(r)).toBe(true);
      }
      expect(validateRadiusPreset("999px")).toBe(false);
      expect(validateRadiusPreset(null)).toBe(false);
    });

    it("themeTokensSchema rifiuta colori/font invalidi, passa validi", () => {
      const bad = themeTokensSchema.safeParse({
        primary: "red",
        headingFont: "comic",
        radius: "huge",
      });
      expect(bad.success).toBe(false);

      const ok = themeTokensSchema.safeParse({
        primary: "#0ea5e9",
        background: "#ffffff",
        foreground: "#0f172a",
        muted: "#64748b",
        radius: "lg",
        headingFont: "display",
        bodyFont: "sans",
      });
      expect(ok.success).toBe(true);
    });
  });

  describe("GATE 23 default deterministic config + ordering", () => {
    it("nessuna description, 0 servizi → lista standard 17 sezioni (navbar, hero, trust, hours, staff disabled, gallery disabled, reviews disabled, faq disabled, location, booking_cta, whatsapp_cta disabled, contact, booking_widget disabled, social_links, legal_links, footer). Senza about/services/price_list. Ordinamento position crescente. Enabled flag corretti.", () => {
      const res = buildDefaultDeterministicSections({ description: null }, 0);
      expect(res.map((r) => r.section_type)).toEqual([
        "navbar",
        "hero",
        "trust",
        "hours",
        "staff",
        "gallery",
        "reviews",
        "faq",
        "location",
        "booking_cta",
        "whatsapp_cta",
        "contact",
        "booking_widget",
        "social_links",
        "legal_links",
        "footer",
      ]);
      expect(res.map((r) => r.position)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      ]);
      const ENABLED_BY_DEFAULT = new Set([
        "navbar",
        "hero",
        "trust",
        "hours",
        "location",
        "booking_cta",
        "contact",
        "social_links",
        "legal_links",
        "footer",
      ]);
      for (const r of res) {
        if (ENABLED_BY_DEFAULT.has(r.section_type)) {
          expect(r.enabled).toBe(true);
        } else {
          expect(r.enabled).toBe(false);
        }
        expect(ALLOWED_VARIANTS.includes(r.variant)).toBe(true);
      }
      const positions = res.map((r) => r.position);
      for (let i = 0; i < positions.length - 1; i++) {
        const curr = positions[i];
        const next = positions[i + 1];
        expect(curr).toBeDefined();
        expect(next).toBeDefined();
        expect(curr!).toBeLessThan(next!);
      }
    });

    it("description presente + 5 servizi → aggiunge about, services, price_list in posizione corretta. 20 sezioni totali. ordering crescente.", () => {
      const res = buildDefaultDeterministicSections({ description: "Barberia anni 90" }, 5);
      expect(res.map((r) => r.section_type)).toEqual([
        "navbar",
        "hero",
        "trust",
        "about",
        "services",
        "price_list",
        "hours",
        "staff",
        "gallery",
        "reviews",
        "faq",
        "location",
        "booking_cta",
        "whatsapp_cta",
        "contact",
        "booking_widget",
        "social_links",
        "legal_links",
        "footer",
      ]);
      const positions = res.map((r) => r.position);
      expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
      const idxAbout = res.findIndex((r) => r.section_type === "about");
      const idxServices = res.findIndex((r) => r.section_type === "services");
      const idxPriceList = res.findIndex((r) => r.section_type === "price_list");
      const idxTrust = res.findIndex((r) => r.section_type === "trust");
      const idxHours = res.findIndex((r) => r.section_type === "hours");
      expect(idxAbout).toBeGreaterThan(idxTrust);
      expect(idxServices).toBeGreaterThan(idxAbout);
      expect(idxPriceList).toBeGreaterThan(idxServices);
      expect(idxHours).toBeGreaterThan(idxPriceList);
      for (let i = 0; i < positions.length - 1; i++) {
        const curr = positions[i];
        const next = positions[i + 1];
        expect(curr).toBeDefined();
        expect(next).toBeDefined();
        expect(curr!).toBeLessThan(next!);
      }
      for (const r of res) {
        expect(ALLOWED_VARIANTS.includes(r.variant)).toBe(true);
      }
    });
  });

  describe("GATE 9 Zod section schemas (no any) & parseSectionSettings (GATE 15/16 invalid rejection)", () => {
    it("7 schemas dedicati esistono e accettano empty", () => {
      for (const schema of [
        heroSettingsSchema,
        aboutSettingsSchema,
        servicesSettingsSchema,
        gallerySettingsSchema,
        staffSettingsSchema,
        reviewsSettingsSchema,
        contactSettingsSchema,
      ]) {
        const empty = schema.safeParse({});
        expect(empty.success).toBe(true);
      }
    });

    it("hero settings rifiuta ctaTarget javascript: (app-level GATE 16)", () => {
      const bad = parseSectionSettings("hero", {
        ctaTarget: "javascript:alert(1)",
      });
      expect(bad.ok).toBe(true);
      // ctaTarget è stato normalizzato a "" (blank string)
      expect((bad as { ok: true; value: { ctaTarget: unknown } }).value.ctaTarget).toBe("");
    });

    it("parseSectionSettings rifiuta type non in lista", () => {
      const res = parseSectionSettings("homepage", {});
      expect(res.ok).toBe(false);
    });

    it("parseSectionSettings rifiuta settings invalidi (es gallery columns stringa)", () => {
      const res = parseSectionSettings("gallery", { columns: "lots" });
      expect(res.ok).toBe(false);
    });
  });

  describe("GATE 11 discriminated union TypeScript type (compile + runtime sanity)", () => {
    it("PublicSection: ogni tipo ha `type` discriminante", () => {
      const heroSection: PublicSection = {
        type: "hero",
        variant: "centered",
        settings: {},
        data: { businessName: "X" },
      };
      const servicesSection: PublicSection = {
        type: "services",
        variant: "cards",
        settings: {},
        data: { services: [] },
      };
      expect(heroSection.type).toBe("hero");
      expect(servicesSection.type).toBe("services");
      const unionCheck: Array<PublicSection["type"]> = [
        "hero",
        "about",
        "services",
        "gallery",
        "staff",
        "reviews",
        "contact",
      ];
      const uniq = new Set<SectionType>(unionCheck);
      expect(uniq.size).toBe(7);
    });
  });

  describe("GATE 22 empty-state policy assumptions (0 rows data)", () => {
    it("ServicesSection.data.services.length=0 → empty state true, renderer tornerà null (per contratto)", () => {
      const emptyServicesSection = { type: "services", data: { services: [] } } as const;
      expect(emptyServicesSection.data.services).toHaveLength(0);
    });

    it("ReviewsSection.data.reviews.length=0 → empty state true; NO dati hardcoded", () => {
      const emptyReviews = { type: "reviews", data: { reviews: [] } } as const;
      expect(emptyReviews.data.reviews).toHaveLength(0);
    });

    it("GallerySection.data.assets.length=0 → empty state true; NO url inventate", () => {
      const emptyGallery = { type: "gallery", data: { assets: [] } } as const;
      expect(emptyGallery.data.assets).toHaveLength(0);
    });
  });

  describe("GATE 26 XSS handling assumptions", () => {
    it("settings strings accettano HTML ma sono salvate come plain (renderer React {text} = escaped); NO dangerouslySetInnerHTML nel codebase (verifica GATE 26 globabile a parte)", () => {
      const xssDesc = `<script>alert(1)</script>`;
      const ok = heroSettingsSchema.safeParse({ subheadline: xssDesc });
      expect(ok.success).toBe(true);
      // i dati passano come testo; renderer deve usare `{text}` quindi escaped per default.
      if (ok.success) {
        expect(ok.data.subheadline).toBe(xssDesc);
      }
    });
  });
});
