import { initialBillingResult } from "./actions";
import { BillingPage } from "./BillingPage";
import { requireTenantRole } from "@/lib/server/auth";

export const metadata = { title: "Abbonamento — VELORA" };

export default async function Page() {
  await requireTenantRole("owner");
  const initial = await initialBillingResult();
  return (
    <main
      role="main"
      style={{
        minHeight: "100dvh",
        background: "#f8fafc",
        padding: "24px 16px 48px",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <BillingPage initial={initial} />
      </div>
    </main>
  );
}
