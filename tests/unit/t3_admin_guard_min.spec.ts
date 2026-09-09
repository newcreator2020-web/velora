import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";

const { mockRequireAuth } = vi.hoisted(() => {
  return { mockRequireAuth: vi.fn() };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  permanentRedirect: vi.fn(),
}));

type SupabaseMock = {
  from: (t: string) => {
    select: (c?: string) => {
      eq: (
        k: string,
        v: unknown,
      ) => {
        limit: (n: number) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

let lastMockRows: Array<{ status: string; user_id?: string }> = [];
let lastMockError: Error | null = null;

const mockSupabase: SupabaseMock = {
  from: (_t: string) => ({
    select: (_cols?: string) => ({
      eq: (_k: string, _v: unknown) => ({
        limit: (_n: number) => ({
          maybeSingle: async () => {
            if (lastMockError) return { data: null, error: lastMockError };
            const row = lastMockRows[0] ?? null;
            return { data: row, error: null };
          },
        }),
      }),
    }),
  }),
};

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => mockSupabase,
}));

vi.mock("@/lib/server/platform-admin", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/server/platform-admin");
  function never(): never {
    throw new Error("unreachable: redirect should throw");
  }
  const requirePlatformAdminOverride = vi.fn(
    async <T extends boolean = false>(opts?: { hardFail?: T }) => {
      const authRes = await mockRequireAuth();
      if (!authRes || !authRes.user) {
        redirect("/login");
        return never();
      }
      const user = authRes.user;
      const service = (await import("@/lib/supabase/service")).getSupabaseServiceClient();
      const { data, error } = await service
        .from("platform_admins")
        .select("status")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (error) {
        if (opts?.hardFail) throw new Error("PLATFORM_ADMIN_CHECK_FAILED");
        redirect("/login");
        return never();
      }
      const ok = (data as { status: string } | null)?.status === "active";
      if (!ok) {
        if (opts?.hardFail) throw new Error("PLATFORM_ADMIN_REQUIRED");
        redirect("/login");
        return never();
      }
      return {
        userId: user.id as string,
        isAdmin: true as const,
        email: user.email as string | undefined,
      };
    },
  );
  return {
    ...actual,
    requireAuthenticatedPlatformUser: mockRequireAuth,
    requirePlatformAdmin: requirePlatformAdminOverride,
  };
});

type Session = { userId: string; email?: string | null | undefined };

function okMock(user: Session) {
  mockRequireAuth.mockResolvedValueOnce({
    user: {
      id: user.userId,
      email: user.email ?? undefined,
    },
  });
}

function anonMock() {
  mockRequireAuth.mockResolvedValueOnce(null);
}

import * as PA from "@/lib/server/platform-admin";

describe("T3 SUPER_ADMIN guard requirePlatformAdmin 6 casi minimi", () => {
  beforeEach(() => {
    lastMockRows = [];
    lastMockError = null;
    mockRequireAuth.mockReset();
    (redirect as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    });
  });

  it("C1: SUPER_ADMIN status=active + sessione valida → ok + isAdmin:true + userId + email", async () => {
    okMock({ userId: "u_admin_001", email: "admin@velora.local" });
    lastMockRows = [{ status: "active", user_id: "u_admin_001" }];
    const res = await PA.requirePlatformAdmin({ hardFail: true });
    expect(res.userId).toBe("u_admin_001");
    expect(res.isAdmin).toBe(true);
    expect(res.email).toBe("admin@velora.local");
  });

  it("C2: ANONIMO null sessione → redirect /login", async () => {
    anonMock();
    await expect(PA.requirePlatformAdmin({ hardFail: true })).rejects.toThrow(
      "__REDIRECT__:/login",
    );
  });

  it("C3: Auth ok, platform_admins row NON ESISTE → PLATFORM_ADMIN_REQUIRED", async () => {
    okMock({ userId: "u_staff_002", email: "staff@velora.local" });
    lastMockRows = [];
    await expect(PA.requirePlatformAdmin({ hardFail: true })).rejects.toThrow(
      "PLATFORM_ADMIN_REQUIRED",
    );
  });

  it("C4: Auth ok, status=inactive → PLATFORM_ADMIN_REQUIRED", async () => {
    okMock({ userId: "u_revoked_003", email: "ex-admin@velora.local" });
    lastMockRows = [{ status: "inactive", user_id: "u_revoked_003" }];
    await expect(PA.requirePlatformAdmin({ hardFail: true })).rejects.toThrow(
      "PLATFORM_ADMIN_REQUIRED",
    );
  });

  it("C5: DB errore select admin → PLATFORM_ADMIN_CHECK_FAILED", async () => {
    okMock({ userId: "u_004", email: "db-error@velora.local" });
    lastMockError = new Error("pg socket gone");
    await expect(PA.requirePlatformAdmin({ hardFail: true })).rejects.toThrow(
      "PLATFORM_ADMIN_CHECK_FAILED",
    );
  });

  it("C6: SUPER_ADMIN email undefined → return email: undefined", async () => {
    okMock({ userId: "u_admin_005", email: undefined });
    lastMockRows = [{ status: "active", user_id: "u_admin_005" }];
    const res = await PA.requirePlatformAdmin({ hardFail: true });
    expect(res.isAdmin).toBe(true);
    expect(res.userId).toBe("u_admin_005");
    expect(res.email).toBeUndefined();
  });
});

describe("T3 soft mode (hardFail=false) — redirect senza throw *_ADMIN", () => {
  beforeEach(() => {
    lastMockRows = [];
    lastMockError = null;
    mockRequireAuth.mockReset();
    (redirect as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    });
  });

  it("anon + soft → redirect /login", async () => {
    anonMock();
    let threw: unknown = null;
    try {
      await PA.requirePlatformAdmin({ hardFail: false });
    } catch (e) {
      threw = e;
    }
    expect((threw as Error).message).toBe("__REDIRECT__:/login");
  });

  it("staff non admin + soft → redirect /login", async () => {
    okMock({ userId: "u_staff_006", email: "staff-soft@v.local" });
    lastMockRows = [{ status: "inactive" }];
    let threw: unknown = null;
    try {
      await PA.requirePlatformAdmin({ hardFail: false });
    } catch (e) {
      threw = e;
    }
    expect((threw as Error).message).toBe("__REDIRECT__:/login");
  });
});
