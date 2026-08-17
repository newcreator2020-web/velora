export default function Loading() {
  return (
    <main>
      <div className="container">
        <div
          className="skeleton"
          style={{ width: 180, height: 32, margin: "0 auto 1.5rem", borderRadius: 9999 }}
          aria-hidden="true"
        />
        <div
          className="skeleton"
          style={{ width: "min(520px, 90%)", height: 64, margin: "0 auto 1rem" }}
          aria-hidden="true"
        />
        <div
          className="skeleton"
          style={{ width: "min(360px, 70%)", height: 28, margin: "0 auto 2rem" }}
          aria-hidden="true"
        />
        <div
          className="skeleton"
          style={{ width: 320, height: 140, margin: "0 auto" }}
          aria-hidden="true"
        />
      </div>
    </main>
  );
}
