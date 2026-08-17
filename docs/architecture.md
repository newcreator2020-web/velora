# VELORA — Architettura (Fase 0)

Decisioni architetturali prese per la fondazione tecnica.
Questo documento descrive **solo ciò che esiste realmente in questa fase**.

## 1. Modular Monolith (e perché)

VELORA adotta, per ora, un **monolite modulare** in una singola applicazione
Next.js.

Motivazioni:

- Una sola codebase, una sola pipeline CI/CD, un solo deployment;
- Massima velocità di sviluppo nelle fasi iniziali;
- Coerenza delle dipendenze;
- Possibilità futura di estrarre servizi in momenti successivi **solo se e
  quando dimostrato necessario**, senza alcun lock-in architetturale prematuro.

Non sono presenti: microservizi separati, repo multipli, applicazioni
differenziate per admin/dashboard/sito pubblico.

## 2. Stack di base

| Componente         | Scelta                                     | Note                                                           |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| Framework UI       | Next.js 16+ App Router                     | Rendering ibrido (server/client) supportato nativamente        |
| Linguaggio         | TypeScript strict                          | tsconfig con `strict: true` e regole aggiuntive                |
| Package manager    | pnpm v11+                                  | Installato globalmente via npm                                 |
| Dev server         | Turbopack (`next dev --turbopack`)         | Nessuna modifica a runtime production                          |
| Lint               | ESLint + `next/core-web-vitals` + Prettier | Nessuna regola disabilitata senza motivo                       |
| Formattazione      | Prettier 3                                 | Config condivisa, check separato da lint                       |
| Unit / Integration | Vitest 4 + jsdom + Testing Library         | Coverage via `@vitest/coverage-v8`                             |
| E2E                | Playwright                                 | Chromium, web-server auto avviato, test su `/` e `/api/health` |
| Schema env         | Zod                                        | `src/config/env.ts` distingue server/public                    |
| Git                | Standard                                   | `.gitignore` per node, Next, env, test artifacts, IDE          |

Non sono ancora introdotte: Tailwind, Supabase, Stripe, database, autenticazione,
domini personalizzati, booking, AI, ecc.

## 3. Boundary client / server

La separazione è garantita in più modi:

1. **Convenzione di directory**
   - `src/lib/server/` → codice pensato per essere eseguito solo lato server.
   - Qualsiasi altra cartella (`lib/utils.ts`, `types`, ecc.) → condivisa, ma
     non può importare codice/server-only né segreti.

2. **Convenzione di naming env**
   - Variabili senza prefisso → server-only.
   - Variabili con prefisso `NEXT_PUBLIC_*` → disponibili anche nel browser.

3. **Validazione centralizzata**
   - `src/config/env.ts` esporta `serverEnv` e `publicEnv`. Entrambe sono
     validate con Zod. Importare dall'una o dall'altra esplicita l'intenzione.

4. **Nessun segreto hardcoded**
   - `.env.example` contiene solo lo schema, senza valori reali.
   - `.env`, `.env.local` e simili sono in `.gitignore`.

## 4. Organizzazione del codice (Fase 0)

```
src/
├─ app/                 # App Router: pagine, layout, API route, boundaries
├─ config/              # Configurazioni (env, ecc.)
├─ lib/
│  ├─ server/           # Server-only (health builder, …)
│  └─ utils.ts          # Utility pure, condivise
└─ types/               # Tipi condivisi e contratti (Result, Health, …)
```

La struttura prevede in futuro moduli business sotto `src/modules/`:

- `auth/`
- `tenant/`
- `site/`
- `business/`
- `billing/`
- `booking/`
- `ai/`

Essi **non esistono ancora** in questa fase e verranno creati **solo quando**
ci saranno funzionalità reali da assegnarvi. Nessun file vuoto o stub è stato
aggiunto per simulare una struttura più grande.

## 5. Strategia testing

### Unit / Integration (Vitest)

- Ambiente `jsdom`.
- File `*.test.ts` o `*.spec.ts` **dentro** `src/`, accanto al codice testato.
- Test reali già presenti e significativi:
  - `src/lib/utils.test.ts` → verifica utility di stringa, uptime formatter,
    safe JSON parse e helper Result.
  - `src/lib/server/health.test.ts` → verifica struttura payload health,
    timestamp ISO, crescita uptime (con fake timers).

### End-to-End (Playwright)

- Cartella `e2e/` separata da `src/`.
- Configurazione avvia automaticamente il `webServer` (sviluppo o produzione)
  e attende `/api/health`.
- Smoke test reale già presente:
  1. carica `/` e verifica status 2xx e elementi identificabili via
     `data-testid` (title, subtitle, status badge, system info, footer);
  2. chiama `GET /api/health` e verifica struttura JSON, campi minimi e header
     `Cache-Control: no-store`;
  3. verifica che una rotta inesistente restituisca 404 con la pagina
     `not-found` renderizzata.

### Scoping

- `vitest` non esegue file dentro `e2e/`.
- `playwright` non esegue test dentro `src/`.

## 6. Strategia environment

- **.env.example** → template versionato, soli placeholder.
- **.env.local** → file locale dell'utente, ignorato da Git, per segreti e
  override.
- **Validazione runtime con Zod** in `src/config/env.ts`:
  - `serverEnvSchema` → valori server-only.
  - `publicEnvSchema` → valori `NEXT_PUBLIC_*`.
  - In caso di schema invalido: lancio eccezione (fail-fast).
- `NODE_ENV` è gestito separatamente dallo schema server.

## 7. Health endpoint

`GET /api/health`

- Risposta JSON `{ status, timestamp, service, version, checks: { uptime_ms } }`.
- HTTP 200 se `status === "ok"`, 503 altrimenti.
- Header `Cache-Control: no-store`.
- Nessuna informazione sensibile esposta.

Motivazione: servirà in futuro per monitoring, load balancer, readiness probe
e post-deploy smoke checks.

## 8. Cosa NON è ancora implementato (esplicito)

Questa lista è intenzionale ed evita fraintendimenti.

- ❌ Database / schema / Supabase / Postgres
- ❌ Autenticazione e autorizzazione (ruoli SUPER_ADMIN / OWNER / …)
- ❌ Row Level Security
- ❌ Multi-tenant (tenant_id, mapping dominio-tenant, isolamento)
- ❌ Pannello admin / dashboard / site builder
- ❌ Siti pubblici dei clienti / custom domains / SSL
- ❌ Booking engine / disponibilità / race conditions
- ❌ Pagamenti / Stripe / webhook / abbonamenti
- ❌ AI assistant / LLM / RAG
- ❌ Email / notifiche
- ❌ Analytics
- ❌ Upload file / storage

Ognuno di questi moduli verrà introdotto in fasi successive, con la propria
migrazione, policy, test e senza indebolire le garanzie attuali.

## 9. Regole operative / Definition of Done (minime per la Fase 0)

Una modifica è considerata pronta solo se:

1. `pnpm typecheck` passa;
2. `pnpm lint` passa;
3. `pnpm format:check` passa;
4. `pnpm test:run` passa;
5. `pnpm build` passa (production build);
6. l'app avvia (`pnpm start`) e risponde `/api/health`;
7. `pnpm test:e2e` passa (almeno Chromium);
8. nessun segreto entra in Git;
9. nessuna regola di lint o tipo è stata disabilitata per mascherare un errore.

Il comando aggregato è `pnpm check` (non include la build production e E2E,
che sono più costose e tipicamente in CI).

## 10. Future work (cose deliberate per dopo)

- Aggiungere una convenzione `server-only` più forte (es. `import "server-only"`
  negli appropriati moduli, appena si iniziano a gestire rotte che toccano
  dati sensibili).
- Centralizzare future feature-flags (es. `booking_enabled`, `ai_enabled`) in
  un modulo dedicato di entitlement.
- Preparare lo scaffold iniziale di `src/modules/*` quando viene introdotta la
  prima feature business concreta.
- Aggiungere un audit log strutturato quando si introdurranno operazioni
  amministrative.
