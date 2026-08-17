# VELORA

Piattaforma SaaS multi-tenant commerciale. Fase 0 — Fondazione tecnica.

## Scopo

Repository unico (monolitico modulare) per la piattaforma VELORA. Questa fase
stabilisce la base tecnica tipizzata, testabile e pronta per la produzione
su cui verranno innestate successivamente: autenticazione, tenant, database,
pagamenti, booking, AI, domini personalizzati e restanti moduli business.

Nessuna funzionalità business è ancora implementata in questa fase.

## Prerequisiti

| Runtime / Tool | Versione consigliata                         |
| -------------- | -------------------------------------------- |
| Node.js        | >= 20.18 LTS (testato con 24.13)             |
| pnpm           | >= 11 (installabile tramite `npm i -g pnpm`) |
| Git            | >= 2.45                                      |
| Playwright     | vedi comando `pnpm playwright:install`       |

## Installazione

```bash
pnpm install
pnpm playwright:install
cp .env.example .env.local
```

Modifica `.env.local` con i valori appropriati. **Non committare file `.env*`
che contengono segreti o credenziali.**

## Avvio locale

```bash
pnpm dev
```

L'applicazione sarà disponibile su `http://localhost:3000`.

Health check: `GET /api/health`

## Build e avvio produzione

```bash
pnpm build
pnpm start
```

## Comandi disponibili

| Comando                   | Descrizione                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`                | Avvia Next.js in sviluppo con Turbopack                                             |
| `pnpm build`              | Esegue la production build                                                          |
| `pnpm start`              | Avvia l'applicazione in modalità produzione                                         |
| `pnpm lint`               | Esegue ESLint                                                                       |
| `pnpm lint:fix`           | Esegue ESLint con auto-fix                                                          |
| `pnpm typecheck`          | Controllo tipi TypeScript (`tsc --noEmit`)                                          |
| `pnpm format`             | Applica Prettier a tutti i file supportati                                          |
| `pnpm format:check`       | Verifica la formattazione (no write)                                                |
| `pnpm test`               | Avvia Vitest in watch mode                                                          |
| `pnpm test:run`           | Esegue i test unit/integration una sola volta                                       |
| `pnpm test:coverage`      | Esegue test unitari con report coverage                                             |
| `pnpm test:e2e`           | Esegue Playwright E2E (contro `pnpm dev`)                                           |
| `pnpm test:e2e:prod`      | Esegue Playwright E2E (contro build/start)                                          |
| `pnpm playwright:install` | Installa il browser Chromium per Playwright                                         |
| `pnpm check`              | Esegue in serie: typecheck, lint, format:check, test:run. Fallisce se uno fallisce. |

## Test

- **Unit / Integration** → Vitest (file `*.test.ts` / `*.spec.ts` in `src/`).
- **End-to-End** → Playwright (directory `e2e/`).

Il comando `pnpm check` esegue tutti i controlli essenziali pre-commit.

## Struttura essenziale

```
VELORA/
├─ e2e/                    # Test Playwright E2E
├─ docs/
│  └─ architecture.md      # Decisioni architetturali Fase 0
├─ src/
│  ├─ app/                 # App Router Next.js
│  │  ├─ api/health/       # Endpoint di health check
│  │  ├─ error.tsx         # Error boundary globale
│  │  ├─ loading.tsx       # Loading UI
│  │  ├─ not-found.tsx     # Pagina 404
│  │  ├─ layout.tsx
│  │  └─ page.tsx          # Pagina iniziale
│  ├─ config/
│  │  └─ env.ts            # Validazione env (server/public) con Zod
│  ├─ lib/
│  │  ├─ server/           # Codice server-only
│  │  └─ utils.ts          # Utility condivise (non server-only)
│  └─ types/               # Tipi globali / Result / shared contracts
├─ .env.example            # Schema env di esempio (senza segreti)
├─ eslint.config.mjs       # ESLint 10 Flat Config (Next.js + TS + React + Prettier)
├─ .prettierrc.json
├─ next.config.ts
├─ playwright.config.ts
├─ tsconfig.json           # TypeScript strict-mode
├─ vitest.config.ts
└─ package.json
```

I moduli business (tenant, auth, billing, booking, site, business, ai, …)
verranno creati sotto `src/modules/` **solo quando realmente necessari**.
Nessun file vuoto o placeholder è presente in questa fase.

## Gestione environment

- Variabili **server-only** → senza prefisso. Non importarle nel codice client.
- Variabili **pubbliche (browser)** → prefisso `NEXT_PUBLIC_*`.
- `src/config/env.ts` valida runtime con Zod sia le variabili server che
  pubbliche. Un valore invalido blocca l'avvio.
- `.env`, `.env.local`, `.env.*.local` sono ignorati da Git.

### Regola

**Non inserire mai segreti, chiavi API o credenziali nel repository.**
Usa `.env.local` o un secret manager appropriato.

## Script `check`

```bash
pnpm check
```

Equivalente a:

```
typecheck → lint → format:check → test:run
```

Se un passaggio fallisce, l'intero comando fallisce (exit code != 0).
Usalo come gate pre-commit / pre-push / CI.
