import { describe, it, expect } from "vitest";
import { findDuplicateProspect, ProspectCreateSchema } from "@/app/app/admin/prospects/lib";
import type { ProspectRow } from "@/app/app/admin/prospects/actions";

function mkProspect(overrides: Partial<ProspectRow>): ProspectRow {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    created_by: "admin-uuid",
    assigned_to: null,
    business_name: "",
    business_category: null,
    comune: "Roma",
    telefono: null,
    email: null,
    sito_web: false,
    sito_quality_score: null,
    gmb_url: null,
    status: "mai_contattato",
    note: null,
    ultimo_contatto_at: null,
    prossimo_contatto_at: null,
    promoted_to_tenant_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as ProspectRow;
}

describe("T8 — Prospect dedup UNIT (Zod + client-side lookup)", () => {
  describe("findDuplicateProspect — dedup su (business_name, COALESCE(telefono, ''))", () => {
    it("C1: nome diverso, stesso tel → NO dup", () => {
      const rows: ProspectRow[] = [
        mkProspect({
          business_name: "Pizzeria Da Nino",
          telefono: "+39 06 1234567",
        }),
      ];
      const result = findDuplicateProspect(rows, {
        business_name: "Trattoria Da Nino",
        telefono: "+39 06 1234567",
      });
      expect(result).toBeNull();
    });

    it("C2: stesso nome, tel uguali → SI dup", () => {
      const dup = mkProspect({
        business_name: "Pizzeria Da Nino",
        telefono: "+39 06 1234567",
      });
      const rows: ProspectRow[] = [dup];
      const result = findDuplicateProspect(rows, {
        business_name: "Pizzeria Da Nino",
        telefono: "+39 06 1234567",
      });
      expect(result).toBe(dup);
    });

    it("C3: stesso nome, entrambi tel NULL → SI dup (COALESCE behavior)", () => {
      const dup = mkProspect({
        business_name: "Studio Legale Rossi",
        telefono: null,
      });
      const rows: ProspectRow[] = [dup];
      const result = findDuplicateProspect(rows, {
        business_name: "Studio Legale Rossi",
        telefono: null,
      });
      expect(result).toBe(dup);
    });

    it("C4: stesso nome, primo tel NULL, secondo valorizzato → NO dup", () => {
      const rows: ProspectRow[] = [
        mkProspect({
          business_name: "Auto Officina Bianchi",
          telefono: null,
        }),
      ];
      const result = findDuplicateProspect(rows, {
        business_name: "Auto Officina Bianchi",
        telefono: "+39 0973 1234",
      });
      expect(result).toBeNull();
    });
  });

  describe("ProspectCreateSchema — validazione Zod campi invalidi", () => {
    const baseValid = {
      business_name: "Attività Valida SRL",
      business_category: "servizi",
      comune: "Milano",
      telefono: "+39 02 98765432",
      email: "info@valida.it",
      sito_web: true,
      sito_quality_score: 7,
      gmb_url: "https://maps.google.com/...",
      status: "da_chiamare" as const,
      note: "Nota di prova",
    };

    it("C5: telefono 'ciao' invalido", () => {
      const r = ProspectCreateSchema.safeParse({
        ...baseValid,
        telefono: "ciao",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const paths = r.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("telefono");
      }
    });

    it("C6: email 'foo@bar' invalida (manca TLD)", () => {
      const r = ProspectCreateSchema.safeParse({
        ...baseValid,
        email: "foo@bar",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const paths = r.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("email");
      }
    });

    it("C7: sito_quality_score 11 invalido", () => {
      const r = ProspectCreateSchema.safeParse({
        ...baseValid,
        sito_quality_score: 11,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const paths = r.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("sito_quality_score");
      }
    });

    it("C8: status 'status_inesistente' invalido", () => {
      const r = ProspectCreateSchema.safeParse({
        ...baseValid,
        status: "status_inesistente",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const paths = r.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("status");
      }
    });
  });
});
