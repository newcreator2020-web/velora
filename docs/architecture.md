# VELORA — Architettura (FASE 1 aggiornata)

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

| Componente         | Scelta                                                           | Note                                                               |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Framework UI       | Next.js 16+ App Router                                           | Rendering ibrido (server/client) supportato nativamente            |
| Linguaggio         | TypeScript strict                                                | tsconfig con `strict: true` e `noUncheckedIndexedAccess` abilitati |
| Package manager    | pnpm v11+                                                        | Workspace singolo attualmente                                      |
| Dev server         | Turbopack (`next dev --turbopack`)                               | Nessuna modifica a runtime production                              |
| Lint               | ESLint 10 Flat Config + Prettier                                 | Zero warnings                                                      |
| Formattazione      | Prettier 3                                                       | `.prettierrc` condiviso, check separato da lint                    |
| Unit / Integration | Vitest 4 + jsdom + Testing Library + pg (direct)                 | Coverage via `@vitest/coverage-v8`                                 |
| E2E                | Playwright 1.62                                                  | Chromium, web-server auto, smoke test `/` e `/api/health`          |
| Database           | PostgreSQL 15+ su Supabase (Cloud / self-hosted / Docker locale) | RLS + RLS-helpers + trigger-based invariants                       |
| Schema env         | Zod                                                              | `src/config/env.ts` distingue server/public                        |
| Git                | Standard + branch strategy                                       | `main`, `develop`, `feature/*`, `fix/*`                            |

## 3. Moduli introdotti in FASE 1 (Multi-tenant core)

Sono ora presenti i seguenti moduli (minimi, senza UI effettiva):

```
src/
├─ modules/auth/core/
│   ├─ guards.ts        # Zod role guard + gerarchia numerica ruoli
│   └─ roles.ts         # Enums + ruolo numerico (Staff 10 → PlatformAdmin 10000)
└─ lib/supabase/
    ├─ browser.ts       # Client anon, per browser
    ├─ server.ts        # Client server-side, context user
    └─ service.ts       # service_role + marcato "server-only"
```

### Client Supabase a 3 livelli

1. **`browser.ts`** → usa `NEXT_PUBLIC_SUPABASE_ANON_KEY`, cookie-less,
   nessun segreto. Viene importato solo da codice client.
2. **`server.ts`** → Server Components / Route Handlers; legge la sessione
   dalle chiamate SSR.
3. **`service.ts`** → marcato `import "server-only"`; usa
   `SUPABASE_SERVICE_ROLE_KEY` e **bypassa RLS**. Deve essere usato solo da
   backend autorizzato e MAI da codice raggiungibile dal client senza
   adeguati controlli di autorizzazione.

## 4. Boundary client / server

La separazione è garantita in più modi:

1. **Convenzione di directory**
   - `src/lib/server/` → codice pensato per essere eseguito solo lato server.
   - Qualsiasi altra cartella (`lib/utils.ts`, `types`, ecc.) → condivisa, ma
     non può importare codice/server-only né segreti.

2. **Convenzione di naming env**
   - Variabili senza prefisso → server-only.
   - Variabili con prefisso `NEXT_PUBLIC_*` → disponibili anche nel browser.

3. **Validazione centralizzata** con Zod.

4. **Nessun segreto hardcoded**
   - `.env.example` contiene solo lo schema; `.env` è ignorato da git.

## 5. Organizzazione del codice (FASE 1)

```
src/
├─ app/                 # App Router: pagine, layout, API route, boundaries
├─ config/              # Configurazioni (env, …)
├─ lib/
│  ├─ server/           # Server-only (health builder, …)
│  ├─ supabase/         # 3 clients: browser / server / service
│  └─ utils.ts          # Utility pure, condivise
├─ modules/
│  └─ auth/core/        # ruoli + guardie
└─ types/               # Tipi condivisi + Database (generati da Supabase CLI)
supabase/
├─ migrations/          # DDL versionata (12 file attualmente: 001…012)
├─ seed.sql             # DATI TEST local-only; applicato dopo migrations
└─ config.toml          # Config Supabase CLI per locale
tests/
└─ db/                  # Test DB-level: RLS, invariants, isolation
e2e/                    # Playwright smoke test
```

## 6. Ambienti (Local / Staging / Production)

| Ambiente    | Supabase                                  | Test distruttivi ammessi? | RPC `test_*` permanenti? |
| ----------- | ----------------------------------------- | :-----------------------: | :----------------------: |
| **LOCAL**   | Docker `supabase start` (porta 54322)     | ✅ Si, senza limitazioni  | ✅ TRANSIENT (beforeAll) |
| **DEV**     | Cloud `dgekfjkuvnofwdwxflms` (temporaneo) | ✅ Ultima volta in FASE 1 |        ❌ RIMOSSI        |
| **STAGING** | Cloud dedicato (futuro)                   |            ❌             |            ❌            |
| **PROD**    | Cloud dedicato (futuro)                   |            ❌             |            ❌            |

Vedi `docs/database.md` per il workflow completo di migration.

## 7. Strategia testing

### DB-level tests (`tests/db/*.test.ts`)

- Ambiente **Node** (`@vitest-environment node`).
- **Env guardrail fail-hard**: se `NEXT_PUBLIC_SUPABASE_URL` non è in whitelist
  (`127.0.0.1`, `localhost`, `db.dgekf…`, `velora-local`) → la suite fallisce
  `process.exit(1)` prima di qualunque modifica.
- Impersonazione RLS tramite:
  1. Transient helper `test_rls()` (CREATA e DROPPATA nel beforeAll/afterAll
     via connessione `pg.Client` diretta, **MAI in migration**).
  2. `SET LOCAL ROLE authenticated` +
     `set_config('request.jwt.claims', '{"sub":"…"}', true)`.
- ~43 test attuali coprono: cross-tenant, RBAC, privilege escalation,
  last-owner invariant, platform-admin isolation, audit append-only,
  structural constraints.

### Unit / Integration (Vitest)

- File `*.test.ts` dentro `src/` accanto al codice testato.

### End-to-End (Playwright)

- Cartella `e2e/` separata.
- Smoke test: homepage, health, 404.

## 8. Database & RLS (sintesi)

- **12 migration** versionate (001…012). Principio **IMMUTABILE**: una
  migration distribuita non viene più modificata; correzioni = nuova
  migration append-only.
- **Seed separato**: `supabase/seed.sql` (NON in migration).
- **RLS FORZATO** su tutte le tabelle tenant-sensitive (`ENABLE ROW LEVEL
SECURITY` + `FORCE`).
- **Helpers RLS**: `is_tenant_member`, `has_tenant_role`, `is_platform_admin`
  sono `SECURITY DEFINER SET search_path = ''` completamente qualificati
  (`public.*` / `auth.*`), `REVOKE ALL FROM PUBLIC`, grant minimali.
- **Last Owner Invariant** garantita da trigger `DEFERRABLE INITIALLY DEFERRED`
  `guard_last_active_owner` + constraint trigger.
- **audit_logs append-only** garantita da trigger + policy insert limitata a
  `service_role`.

Vedi `docs/multi-tenancy.md` e `docs/database.md`.

## 9. Health endpoint

`GET /api/health` invariato (Fase 0).

## 10. Cosa NON è ancora implementato (esplicito)

- ❌ UI Auth (signup/login/password reset)
- ❌ Dashboard admin / gestione tenant
- ❌ Siti pubblici dei clienti / custom domains / SSL
- ❌ Booking engine / disponibilità / race conditions
- ❌ Pagamenti / Stripe / webhook / abbonamenti
- ❌ AI assistant / LLM / RAG
- ❌ Email / notifiche
- ❌ Analytics avanzati
- ❌ Upload file / storage (schema esiste, non usato)

## 11. Regole operative / Definition of Done (FASE 1)

Una modifica al core DB è considerata pronta solo se:

1. `pnpm typecheck` passa;
2. `pnpm lint` passa (zero warnings);
3. `pnpm format:check` passa;
4. `pnpm test:run` passa (unit src/);
5. **Locale**: `supabase start` OK → `supabase db reset` (prima volta) OK →
   secondo `supabase db reset` (idempotenza) OK;
6. **Locale**: `pnpm db:test` passa i ~43 test;
7. `pnpm build` passa;
8. Playwright `pnpm test:e2e` passa;
9. working tree pulito (`git status` senza modifiche o `??` incontrollati);
10. nessun segreto entra in git;
11. migration: si usa nuova migration append-only, MAI modifica migration
    distribuita.

## 12. Future work

- Sostituire la sessione Cloud `dgekfjkuvnofwdwxflms` con ambienti dedicati
  (DEV → STAGING → PRODUCTION) al termine della FASE 2.
- Introdurre `import "server-only"` in più file quando necessario.
- Centralizzare entitlement (feature flags per piano).
- Introdurre pgTAP per test strutturali alongside Vitest.
