import { initialSettingsResult, type SettingsActionResult } from "./actions";
import { SettingsForm } from "./SettingsForm";
import { requireTenantRole } from "@/lib/server/auth";

export const metadata = { title: "Impostazioni attività — VELORA" };

export default async function SettingsPage() {
  await requireTenantRole("manager");
  const initial = await initialSettingsResult();
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f8fafc",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
        }}
      >
        <section
          style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <SettingsForm
            initial={
              initial as SettingsActionResult & { values: Partial<Record<string, string | null>> }
            }
          />
        </section>
      </div>
    </main>
  );
}
