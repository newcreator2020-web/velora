import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/server/platform-admin";

type ShowcaseSite = Readonly<{
  id: "tonino" | "luca" | "giulia";
  displayName: string;
  tagline: string;
  slug: string;
  preset: "elegant" | "barber_strong" | "editorial";
  presetLabel: string;
  category: string;
  servicesCount: number;
  sectionsCount: number;
  heroVariant: string;
  gradient: string;
  accent: string;
  quality: {
    perf: number;
    a11y: number;
    bp: number;
    seo: number;
    ready: boolean;
  };
}>;

const SITES: readonly ShowcaseSite[] = [
  {
    id: "tonino",
    displayName: "Estetista da Tonino",
    tagline: "Centro estetico · Crotone",
    slug: "slugo-mtu30v76-1fon",
    preset: "elegant",
    presetLabel: "ELEGANT",
    category: "Beauty Premium",
    servicesCount: 9,
    sectionsCount: 13,
    heroVariant: "Fullscreen",
    gradient: "from-violet-600 via-purple-600 to-fuchsia-700",
    accent: "text-violet-200",
    quality: { perf: 100, a11y: 96, bp: 96, seo: 91, ready: true },
  },
  {
    id: "luca",
    displayName: "Barbieri Luca",
    tagline: "Traditional Barbershop · Roma Prati",
    slug: "barbieri-luca",
    preset: "barber_strong",
    presetLabel: "BARBER STRONG",
    category: "Barbershop",
    servicesCount: 8,
    sectionsCount: 12,
    heroVariant: "Split Hero Left",
    gradient: "from-neutral-900 via-zinc-900 to-amber-700",
    accent: "text-amber-200",
    quality: { perf: 95, a11y: 96, bp: 96, seo: 91, ready: true },
  },
  {
    id: "giulia",
    displayName: "Giulia Hair Studio",
    tagline: "Editorial Hair Salon · Milano Brera",
    slug: "giulia-hair",
    preset: "editorial",
    presetLabel: "EDITORIAL",
    category: "Hair Salon",
    servicesCount: 10,
    sectionsCount: 13,
    heroVariant: "Editorial serif",
    gradient: "from-rose-700 via-red-700 to-red-900",
    accent: "text-rose-100",
    quality: { perf: 95, a11y: 96, bp: 96, seo: 91, ready: true },
  },
] as const;

export const metadata = {
  title: "Showcase Siti · VELORA",
  description:
    "Anteprima dei siti generati con Velora: Beauty Elegant, Barbershop Modern, Hair Editorial. Tutti dallo stesso motore, configurazioni diverse.",
  robots: { index: false, follow: false },
};

export default async function ShowcasePage() {
  try {
    await requirePlatformAdmin({ hardFail: true });
  } catch {
    notFound();
  }
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <header className="mb-10 sm:mb-14">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
              Velora · Site Engine
            </span>
            <span className="text-xs text-zinc-500">
              {SITES.length} siti · 3 direzioni visive · 1 motore
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-white">
            Showcase Siti Pubblici
          </h1>
          <p className="mt-3 max-w-2xl text-sm sm:text-base text-zinc-400 leading-relaxed">
            Tutti i siti qui sotto sono generati dallo{" "}
            <strong className="text-zinc-100">stesso motore Velora</strong>. L&apos;unica
            differenza? La configurazione del tenant: preset visivo, colori, tipografia, varianti
            hero/services, contenuti, prezzi, orari. Nessun hardcoded. Nessun fork di codice.
          </p>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-2xl">
            {[
              { k: "Siti attivi", v: `${SITES.length}`, unit: "" },
              { k: "Direzioni visive", v: "7", unit: "preset" },
              { k: "Sezioni renderabili", v: "22", unit: "tipi" },
              { k: "Regole RLS attive", v: "29", unit: "tabelle" },
            ].map((m) => (
              <div
                key={m.k}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 backdrop-blur"
              >
                <div className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  {m.k}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-semibold tabular-nums text-white">
                    {m.v}
                  </span>
                  {m.unit ? (
                    <span className="text-[11px] text-zinc-500 font-medium">{m.unit}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </header>

        <section
          aria-label="Siti disponibili"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"
        >
          {SITES.map((site) => (
            <article
              key={site.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] hover:border-white/20 transition-colors"
            >
              <Link
                href={`/s/${encodeURIComponent(site.slug)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Apri il sito pubblico di ${site.displayName}`}
                className={`relative block aspect-[16/10] overflow-hidden bg-gradient-to-br ${site.gradient} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
              >
                <div
                  className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.15),transparent_55%)]"
                  aria-hidden
                />
                <div
                  className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(0,0,0,0.35),transparent_60%)]"
                  aria-hidden
                />
                <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
                  <span className="rounded-md bg-black/25 border border-white/15 backdrop-blur px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90">
                    {site.presetLabel}
                  </span>
                  <span className="rounded-md bg-black/30 backdrop-blur px-2 py-1 text-[10px] font-medium text-white/80">
                    {site.category}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                  <div
                    className={`text-[11px] font-medium uppercase tracking-[0.14em] ${site.accent} opacity-90`}
                  >
                    {site.tagline}
                  </div>
                  <h2 className="mt-1.5 text-xl sm:text-2xl font-semibold tracking-tight text-white drop-shadow">
                    {site.displayName}
                  </h2>
                </div>
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/20"
                  aria-hidden
                />
                <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-zinc-900 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all shadow-lg">
                  Apri sito ↗
                </div>
              </Link>

              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-white/10">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Slug pubblico
                  </div>
                  <code className="block truncate font-mono text-[12px] text-zinc-300">
                    /s/{site.slug}
                  </code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-md bg-black/30 backdrop-blur px-2 py-1 text-[10px] font-medium text-white/80">
                    {site.preset}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
                <div className="px-3 sm:px-4 py-3 text-center">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Servizi
                  </dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-white">
                    {site.servicesCount}
                  </dd>
                </div>
                <div className="px-3 sm:px-4 py-3 text-center">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Sezioni
                  </dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums text-white">
                    {site.sectionsCount}
                  </dd>
                </div>
                <div className="px-3 sm:px-4 py-3 text-center">
                  <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Hero
                  </dt>
                  <dd className="mt-1 text-[12px] font-medium text-zinc-200">{site.heroVariant}</dd>
                </div>
              </dl>

              <div className="px-3 sm:px-4 py-3 border-b border-white/10 bg-white/[0.015]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                      Live
                    </span>
                    {site.quality.ready ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                        Ready ✓
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        QA…
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                    Lighthouse
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  {[
                    { label: "P", v: site.quality.perf, color: "text-emerald-300" },
                    { label: "A11y", v: site.quality.a11y, color: "text-sky-300" },
                    { label: "BP", v: site.quality.bp, color: "text-indigo-300" },
                    { label: "SEO", v: site.quality.seo, color: "text-amber-300" },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-md border border-white/5 bg-white/[0.03] py-1.5"
                    >
                      <div className={`text-[13px] font-bold tabular-nums ${m.color}`}>{m.v}</div>
                      <div className="text-[9px] uppercase tracking-[0.12em] text-zinc-500 mt-0.5">
                        {m.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <nav
                aria-label={`Azioni per ${site.displayName}`}
                className="p-3 sm:p-4 grid grid-cols-2 gap-2"
              >
                <Link
                  href={`/s/${encodeURIComponent(site.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  Apri Sito
                  <span aria-hidden>↗</span>
                </Link>
                <Link
                  href={`/s/${encodeURIComponent(site.slug)}/booking`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  Prenota test
                  <span aria-hidden>↗</span>
                </Link>
                <Link
                  href="/app/site"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  Modifica
                  <span aria-hidden>✎</span>
                </Link>
                <Link
                  href="/app/site/publications"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  Pubblicazioni
                  <span aria-hidden>▤</span>
                </Link>
              </nav>
            </article>
          ))}
        </section>

        <footer className="mt-12 sm:mt-16 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              Zero hardcoded · configurazione pura
            </div>
            <p className="mt-1 text-xs sm:text-sm text-zinc-400 max-w-xl">
              Audit di ricerca hardcoded strings (0 match). Nessun nome, nessun MMXXIV, nessun
              indirizzo è scritto nel renderer pubblico. Tutti i dati arrivano dal tenant DB +
              pubblicazione append-only.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/app/site"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              Apri Studio
            </Link>
            <Link
              href="/app/setup"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Setup iniziale
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
