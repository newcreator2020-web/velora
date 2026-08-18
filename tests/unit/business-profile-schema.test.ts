import { describe, it, expect } from "vitest";
import { businessProfileUpdateSchema } from "@/lib/server/auth-pure";

function formToObj(fd: FormData): Record<string, unknown> {
  return Object.fromEntries(fd.entries());
}

describe("businessProfileUpdateSchema", () => {
  it("accepts minimal valid payload", () => {
    const fd = new FormData();
    fd.set("business_name", "Mario Hair");
    const result = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.business_name).toBe("Mario Hair");
      expect(result.data.address_line1).toBeNull();
      expect(result.data.email == null).toBe(true);
    }
  });

  it("trims business_name and rejects too short", () => {
    const fd = new FormData();
    fd.set("business_name", "  A  ");
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const fd = new FormData();
    fd.set("business_name", "Valid Name");
    fd.set("email", "not-an-email");
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(false);
  });

  it("accepts valid email", () => {
    const fd = new FormData();
    fd.set("business_name", "Valid Name");
    fd.set("email", " info@esempio.it ");
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("info@esempio.it");
  });

  it("maps address form field to address_line1", () => {
    const fd = new FormData();
    fd.set("business_name", "Test");
    fd.set("address", " Via Roma 12 ");
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.address_line1).toBe("Via Roma 12");
      expect((r.data as Record<string, unknown>)["address"]).toBeUndefined();
    }
  });

  it("converts empty strings to null for optional fields", () => {
    const fd = new FormData();
    fd.set("business_name", "Test");
    fd.set("phone", "   ");
    fd.set("city", "");
    fd.set("postal_code", "\t");
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBeNull();
      expect(r.data.city).toBeNull();
      expect(r.data.postal_code).toBeNull();
    }
  });

  it("enforces max lengths", () => {
    const longName = "A".repeat(121);
    const fd = new FormData();
    fd.set("business_name", longName);
    const r = businessProfileUpdateSchema.safeParse(formToObj(fd));
    expect(r.success).toBe(false);
  });

  it("accepts plain object input (not only FormData)", () => {
    const r = businessProfileUpdateSchema.safeParse({
      business_name: "Plain Name",
      phone: "+39 02 1234567",
      address: "Via Milano 1",
      city: "Milano",
      province: "MI",
      postal_code: "20100",
      description: "Descrizione",
      email: "a@b.it",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.business_name).toBe("Plain Name");
      expect(r.data.address_line1).toBe("Via Milano 1");
      expect(r.data.email).toBe("a@b.it");
      expect(r.data.description).toBe("Descrizione");
    }
  });
});
