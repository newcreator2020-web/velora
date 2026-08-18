// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  businessProfileUpdateSchema,
  buildBusinessUpdatePayloads,
  maskAuditMetadata,
  BUSINESS_PROFILE_ALLOWED_INPUT_KEYS,
  stripTamperedFields,
} from "@/lib/server/auth-pure";

function formToObj(fd: FormData): Record<string, unknown> {
  return Object.fromEntries(fd.entries());
}

const LEGIT: Record<string, string> = {
  business_name: "My Beauty Salon",
  phone: "+39 333 123 4567",
  email: "info@example.com",
  address: "Via Roma 123",
  city: "Milano",
  province: "MI",
  postal_code: "20121",
  description:
    "Salone di bellezza specializzato in taglio, colore e trattamenti estetici personalizzati.",
};

function tamperedInput(): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...LEGIT };
  raw["tenant_id"] = "00000000-0000-0000-0000-0000000000BA";
  raw["user_id"] = "11111111-1111-1111-1111-111111111199";
  raw["role"] = "owner";
  raw["owner_id"] = "22222222-2222-2222-2222-222222222233";
  raw["status"] = "active";
  raw["created_at"] = "1999-01-01T00:00:00Z";
  return raw;
}

describe("FASE 3B — Tampering + Dual Write + PII Masking (pure)", () => {
  describe("PAYLOAD TAMPERING: campi autorevoli dal client ignorati", () => {
    it("T1: Zod schema NON include field `tenant_id` nel risultato", () => {
      const raw = tamperedInput();
      const parsed = businessProfileUpdateSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(Object.keys(parsed.data)).not.toContain("tenant_id");
      expect((parsed.data as unknown as Record<string, unknown>)["tenant_id"]).toBeUndefined();
    });

    it("T2: Zod schema NON include `user_id` o `role` nel risultato", () => {
      const raw = tamperedInput();
      const parsed = businessProfileUpdateSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const keys = Object.keys(parsed.data);
      expect(keys).not.toContain("user_id");
      expect(keys).not.toContain("role");
      expect(keys).not.toContain("owner_id");
    });

    it("T3: FormData con tampering fields → stessi campi NON compaiono dopo safeParse", () => {
      const fd = new FormData();
      for (const k of Object.keys(LEGIT)) fd.append(k, LEGIT[k] as string);
      fd.append("tenant_id", "00000000-0000-0000-0000-0000000000BA");
      fd.append("user_id", "99999999-9999-9999-9999-999999999999");
      fd.append("role", "super_admin");

      const obj = formToObj(fd);
      const parsed = businessProfileUpdateSchema.safeParse(obj);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const d = parsed.data as unknown as Record<string, unknown>;
      expect(d["tenant_id"]).toBeUndefined();
      expect(d["user_id"]).toBeUndefined();
      expect(d["role"]).toBeUndefined();
      expect(d["super_admin"]).toBeUndefined();
    });

    it("T4: BUSINESS_PROFILE_ALLOWED_INPUT_KEYS contiene SOLO gli 8 campi legittimi", () => {
      const sorted = Array.from(BUSINESS_PROFILE_ALLOWED_INPUT_KEYS).sort();
      expect(sorted).toEqual([
        "address",
        "business_name",
        "city",
        "description",
        "email",
        "phone",
        "postal_code",
        "province",
      ]);
    });

    it("T5: stripTamperedFields rimuove TUTTI i campi extra del tampering", () => {
      const raw = tamperedInput();
      const stripped = stripTamperedFields(raw);
      expect(Object.keys(stripped).sort()).toEqual(
        Array.from(BUSINESS_PROFILE_ALLOWED_INPUT_KEYS).sort(),
      );
      expect((stripped as Record<string, unknown>)["tenant_id"]).toBeUndefined();
      expect((stripped as Record<string, unknown>)["role"]).toBeUndefined();
    });
  });

  describe("DUAL WRITE consistency (business_name in tenants + business_profiles)", () => {
    it("DW1: business_name → tenantUpdate.name === bpUpdate.display_name", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { tenantUpdate, bpUpdate } = buildBusinessUpdatePayloads(parsed);
      expect(tenantUpdate.name).toBe(LEGIT["business_name"]);
      expect(bpUpdate.display_name).toBe(LEGIT["business_name"]);
      expect(tenantUpdate.name).toBe(bpUpdate.display_name);
    });

    it("DW2: address form → address_line1 in parsed.data e in bpUpdate", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      expect(parsed.address_line1).toBe(LEGIT["address"]);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      expect(bpUpdate.address_line1).toBe(LEGIT["address"]);
    });

    it("DW3: campi phone/email/city/province/postal_code propagati corretti", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      expect(bpUpdate.phone).toBe(LEGIT["phone"]);
      expect(bpUpdate.email).toBe(LEGIT["email"]);
      expect(bpUpdate.city).toBe(LEGIT["city"]);
      expect(bpUpdate.province).toBe(LEGIT["province"]);
      expect(bpUpdate.postal_code).toBe(LEGIT["postal_code"]);
      expect(bpUpdate.description).toBe(LEGIT["description"]);
    });
  });

  describe("AUDIT PII MASKING: nessun dato sensibile in chiaro", () => {
    it("PII1: phone → '[phone masked]' (non il numero di telefono originale)", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["phone"]).toBe("[phone masked]");
      expect(String(meta["phone"])).not.toContain("333");
      expect(String(meta["phone"])).not.toContain("123 4567");
    });

    it("PII2: phone null → meta phone è null", () => {
      const raw = { ...LEGIT, phone: "" };
      const parsed = businessProfileUpdateSchema.parse(raw);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["phone"]).toBeNull();
    });

    it("PII3: email → '[email masked]' NON contiene indirizzo libero", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["email"]).toBe("[email masked]");
      expect(String(meta["email"])).not.toContain("info@");
      expect(String(meta["email"])).not.toContain("example.com");
    });

    it("PII4: city, province, postal_code → tutti '[city/province/postal masked]'", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["city"]).toBe("[city masked]");
      expect(meta["province"]).toBe("[province masked]");
      expect(meta["postal_code"]).toBe("[postal masked]");
      expect(String(meta["city"])).not.toContain("Milano");
      expect(String(meta["postal_code"])).not.toContain("20121");
    });

    it("PII5: address_line1 → '[address masked]' NON contiene Via Roma 123", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["address_line1"]).toBe("[address masked]");
      expect(String(meta["address_line1"])).not.toContain("Via Roma");
      expect(String(meta["address_line1"])).not.toContain("123");
    });

    it("PII6: description → description_len numerico (non testo libero)", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      const len = meta["description_len"];
      expect(typeof len).toBe("number");
      expect(len).toBe((LEGIT["description"] as string).length);
      expect(JSON.stringify(meta)).not.toContain("taglio, colore");
    });

    it("PII7: display_name NON è mascherato (è branding, non PII)", () => {
      const parsed = businessProfileUpdateSchema.parse(LEGIT);
      const { bpUpdate } = buildBusinessUpdatePayloads(parsed);
      const meta = maskAuditMetadata(bpUpdate);
      expect(meta["display_name"]).toBe(LEGIT["business_name"]);
    });
  });

  describe("FAILURE behavior (no false success)", () => {
    it("F1: zod parse fallito → safeParse.success === false, nessun payload valido", () => {
      const bad: Record<string, unknown> = {
        ...LEGIT,
        business_name: "X",
        email: "non-email",
      };
      const r = businessProfileUpdateSchema.safeParse(bad);
      expect(r.success).toBe(false);
    });

    it("F2: flusso corretto NON builda payloads se il parse fallisce (early return VALIDATION)", () => {
      const bad = { ...LEGIT, email: "bademail" };
      const r = businessProfileUpdateSchema.safeParse(bad);
      expect(r.success).toBe(false);
      let payloadBuilt = false;
      if (r.success) {
        buildBusinessUpdatePayloads(r.data);
        payloadBuilt = true;
      }
      expect(payloadBuilt).toBe(false);
    });
  });
});
