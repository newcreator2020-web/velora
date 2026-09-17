import Link from "next/link";
import type { MembershipRole } from "@/modules/auth/core/roles";

const STEPS: readonly {
  id: number;
  group: "business" | "site" | "launch";
  title: string;
  description: string;
  href: string;
  minRole: Exclude<MembershipRole, "staff">;
  hint?: string;
}[] = [
  {
    id: 1,
    group: "business",
    title: "Profilo attività",
    description:
      "Nome attività, partita IVA, categoria, indirizzo, recapiti telefonici ed email. Dati base visibili in tutto il sistema.",
    href: "/app/settings",
    minRole: "owner",
    hint: "Obbligatorio per Fatturazione Elettronica",
  },
  {
    id: 2,
    group: "business",
    title: "Orari di apertura",
    description:
      "Imposta orari settimanali, pause pranzo, chiusure festive, ferie e giornate speciali. Il booking li usa in tempo reale.",
    href: "/app/availability",
    minRole: "manager",
  },
  {
    id: 3,
    group: "business",
    title: "Servizi e listino prezzi",
    description:
      "Crea servizi (nome, durata, prezzo, categoria, descrizione, deposito caparra). Sono quelli che appaiono nel listino pubblico.",
    href: "/app/site#services",
    minRole: "manager",
  },
  {
    id: 4,
    group: "business",
    title: "Team e operatori",
    description:
      "Invita operatori (Staff / Manager / Owner), assegna ruolo, permessi e servizi dedicati per ciascun membro.",
    href: "/app/team",
    minRole: "owner",
  },
  {
    id: 5,
    group: "site",
    title: "Tema grafico e colori",
    description:
      "Scegli Preset visivo (Elegant · Modern · Editorial · Luxury · Minimal), colori primari, tipografia heading/body, raggio bordi.",
    href: "/app/site#theme",
    minRole: "manager",
  },
  {
    id: 6,
    group: "site",
    title: "Struttura sezioni del sito",
    description:
      "Attiva/riordina sezioni: Hero · Chi siamo · Servizi · Galleria · Team · Recensioni · Orari · Contatti · CTA · Prezzi. Varianti per ciascuna sezione.",
    href: "/app/site#sections",
    minRole: "manager",
  },
  {
    id: 7,
    group: "site",
    title: "Media e immagini",
    description:
      "Carica logo, immagine cover Hero, foto About, galleria lavori e prodotti. Formati consigliati: WEBP 1x/2x, massimo 1MB.",
    href: "/app/admin/media",
    minRole: "manager",
  },
  {
    id: 8,
    group: "site",
    title: "Contatti e mappa",
    description:
      "Indirizzo completo con lat/lon per Google Maps embed, telefono, email, link social. Appaiono nel footer e sezione Contatti.",
    href: "/app/site#contacts",
    minRole: "manager",
  },
  {
    id: 9,
    group: "business",
    title: "Regole prenotazioni",
    description:
      "Durata minima slot, buffer tra appuntamenti, caparra confirmatoria importo/% , anticipo massimo giorni, anticipo minimo prenotabile.",
    href: "/app/settings#booking",
    minRole: "owner",
  },
  {
    id: 10,
    group: "business",
    title: "Coordinate bonifico bancario",
    description:
      "Inserisci IBAN, intestatario, BIC/SWIFT, nome banca. Le coordinate sono mostrate al cliente dopo la prenotazione per il bonifico della caparra.",
    href: "/app/billing",
    minRole: "owner",
    hint: "Nessun costo: bonifico manuale, 0 commissioni",
  },
  {
    id: 11,
    group: "launch",
    title: "Dominio personalizzato",
    description:
      "Configura DNS (CNAME/A record), verifica dominio, abilita HTTPS automatico. Stato: Non configurato / Pending / Attivo.",
    href: "/app/site#domain",
    minRole: "owner",
  },
  {
    id: 12,
    group: "launch",
    title: "Pubblicazione sito live",
    description:
      "Salva bozza Studio → Pubblica → crea nuova versione sito pubblico. Controlla anteprima, poi premi 'Pubblica versione N'.",
    href: "/app/site#publications",
    minRole: "owner",
  },
] as const;

const GROUP_LABEL: Record<(typeof STEPS)[number]["group"], string> = {
  business: "Configurazione Attività",
  site: "Sito Pubblico",
  launch: "Avvio e Pubblicazione",
};

export const metadata = {
  title: "Setup Iniziale · VELORA",
  description:
    "Completa i 12 passaggi per avviare il tuo salone: attività, orari, servizi, tema, contenuti, dominio e pubblicazione.",
};

export default async function SetupPage() {
  const progress = Math.max(0, Math.min(12, 0));
  const percent = Math.round((progress / STEPS.length) * 100);

  const grouped = STEPS.reduce<Map<(typeof STEPS)[number]["group"], typeof STEPS>>((acc, s) => {
    const arr = (acc.get(s.group) ?? []) as typeof STEPS;
    (arr as unknown as (typeof STEPS)[number][]).push(s);
    acc.set(s.group, arr);
    return acc;
  }, new Map());

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-8 sm:py-10 lg:py-12">
        <header className="mb-6 sm:mb-8">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Wizard setup
            </span>
            <span className="text-xs text-zinc-500">
              {progress}/{STEPS.length} passaggi
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900">
            Prepara il tuo salone al pubblico
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-zinc-600">
            Segui i 12 passaggi. Completa tutti quelli del gruppo &quot;Configurazione
            Attività&quot; per iniziare a prendere prenotazioni, poi passa a &quot;Sito
            Pubblico&quot; e infine &quot;Avvio e Pubblicazione&quot;.
          </p>

          <div className="mt-5 sm:mt-6">
            <div
              className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-200"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progresso setup"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600 transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-zinc-500">
              <span>Start</span>
              <span className="tabular-nums">
                {percent}% · Step {progress} di {STEPS.length}
              </span>
              <span>Pubblica sito</span>
            </div>
          </div>
        </header>

        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([groupId, groupSteps]) => (
            <section
              key={groupId}
              className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm"
            >
              <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Gruppo {String.fromCharCode(65 + [...grouped.keys()].indexOf(groupId))}
                  </div>
                  <h2 className="mt-0.5 text-lg sm:text-xl font-semibold text-zinc-900">
                    {GROUP_LABEL[groupId]}
                  </h2>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 tabular-nums">
                  {groupSteps.length} step
                </span>
              </div>

              <ol className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 overflow-hidden">
                {(groupSteps as readonly (typeof STEPS)[number][]).map((step) => {
                  type StepStatus = "locked" | "todo" | "done";
                  const status = (() => "todo")() as StepStatus;
                  return (
                    <li
                      key={step.id}
                      className="grid grid-cols-[auto_1fr_auto] items-start gap-3 sm:gap-4 p-4 sm:p-5 bg-white"
                    >
                      <div className="pt-0.5 shrink-0">
                        <div
                          aria-hidden
                          className={[
                            "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
                            status === "done"
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : status === "locked"
                                ? "bg-zinc-100 border-zinc-200 text-zinc-400"
                                : "bg-indigo-50 border-indigo-200 text-indigo-700",
                          ].join(" ")}
                        >
                          {status === "done" ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <span className="tabular-nums">{step.id}</span>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                          <h3 className="text-sm sm:text-base font-semibold text-zinc-900">
                            {step.title}
                          </h3>
                          {step.hint ? (
                            <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {step.hint}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[13px] sm:text-sm text-zinc-600 leading-relaxed mb-2">
                          {step.description}
                        </p>
                        <div className="text-[11px] text-zinc-500 flex flex-wrap items-center gap-x-2">
                          <span>
                            Ruolo minimo:&nbsp;
                            <span className="font-medium capitalize">
                              {step.minRole === "owner" ? "Proprietario" : "Manager"}
                            </span>
                          </span>
                          <span aria-hidden>·</span>
                          <span className="font-mono text-zinc-500/80">{step.href}</span>
                        </div>
                      </div>

                      <div className="pt-1 shrink-0">
                        <Link
                          href={step.href}
                          className={[
                            "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
                            status === "locked"
                              ? "bg-zinc-50 border-zinc-200 text-zinc-400 pointer-events-none cursor-not-allowed"
                              : status === "done"
                                ? "bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-400"
                                : "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-sm",
                          ].join(" ")}
                          aria-disabled={status === "locked" ? "true" : undefined}
                        >
                          {status === "done"
                            ? "Rivedi"
                            : status === "locked"
                              ? "Bloccato"
                              : "Completa"}
                          <span aria-hidden>→</span>
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        <footer className="mt-8 sm:mt-10 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900">
              Hai bisogno di aiuto con un passaggio?
            </div>
            <p className="text-xs sm:text-sm text-zinc-600 mt-0.5">
              Salta i passaggi opzionali e completa prima quelli obbligatori: Profilo · Orari ·
              Servizi · Coordinate bancarie · Pubblicazione.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/app/site"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
            >
              Vai a Studio sito
            </Link>
            <Link
              href="/app"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:ring-offset-2"
            >
              Torna a Dashboard
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
