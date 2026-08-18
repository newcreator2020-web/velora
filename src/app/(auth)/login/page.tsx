import { LoginForm } from "./LoginForm";

export const metadata = { title: "Accedi — VELORA" };

export default function LoginPage() {
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
        <LoginForm />
      </section>
    </main>
  );
}
