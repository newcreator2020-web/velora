import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Accedi — VELORA" };

const CSRF_COOKIE_NAME = "velora_csrf_token";

function safeToken(v: string | undefined): string {
  if (v && v.length >= 16) return v;
  return randomUUID().replace(/-/g, "");
}

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage(props: LoginPageProps) {
  const ck = await cookies();
  const token = safeToken(ck.get(CSRF_COOKIE_NAME)?.value);
  const sp = (await props.searchParams) ?? {};
  const existing = sp["_csrf"] as string | undefined;
  if (!existing || existing.length < 16 || existing !== token) {
    redirect(`/login?_csrf=${encodeURIComponent(token)}`);
  }
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8fafc",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 440,
          background: "white",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 10px 30px rgba(0,0,0,0.06)",
          border: "1px solid #e5e7eb",
        }}
      >
        <header style={{ marginBottom: 24, textAlign: "center" }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#0f172a",
            }}
          >
            VELORA
          </div>
          <h1 style={{ fontSize: 22, marginTop: 4, marginBottom: 0, fontWeight: 600 }}>
            Accedi alla tua area riservata
          </h1>
        </header>
        <LoginForm csrfToken={token} />
      </section>
    </main>
  );
}
