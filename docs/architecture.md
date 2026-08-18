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

## 12. FASE 5 — Site Sections Public Engine (Freeze 2026-08-18)

Aggiunto in FASE 5: motore di rendering pubblico **data-driven**,
**tenant-driven**, **type-safe**, **secure**.
Documentazione dettagliata → `docs/site-sections.md`.

### 12.1 Stack aggiuntivo FASE 5

| Componente    | Scelta                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| Rendering     | Next.js 16 RSC Server Components **solo**. 7 renderer × NO "use client" |
| ISR Cache     | `/s/[slug]` `revalidate = 300` (5 min per-slug, tenant-safe)            |
| Validazione   | Zod strict ×7 settings schemas in `src/lib/server/content-engine.ts`    |
| DB Structured | `site_sections` + `services` (migration 020…023)                        |
| Theme         | 7 colonne strutturate `business_profiles.theme_*` → CSS vars            |
| Registry      | `SECTION_RENDERERS: Record<type, RenderFn>` (NoSwitch pattern)          |
| Logging       | `console.warn` sanitizzati (slug + count + reason enum)                 |

### 12.2 Source of Truth FASE 5

```
businessName    → business_profiles.display_name  (structured)
slug            → tenants.slug
publication     → tenants.status=active AND tenants.published=true
section config  → site_sections table (enabled, position, variant)
settings JSONB  → presentation-only, strict Zod allowlist
contacts        → business_profiles (phone, email, address, city, ...)
services        → services table (active=true, tenant-scoped, structured price)
staff pub.      → safe-empty (future dedicated table. MAI memberships!)
reviews         → safe-empty (future dedicated table. MAI fake names!)
theme tokens    → business_profiles.theme_primary / theme_* structured.
```

Vedi matrice completa §4 in `docs/site-sections.md`.

### 12.3 Performance (miglioramenti FASE 5)

- **Query count da 4 → 3** tramite JOIN tenants+business_profiles
  (elimina query ridondante bp+theme).
- sections + services: `Promise.all` parallelo.
- Client JS pubblico: 594.6 KB / 15 chunks (in linea Next.js baseline).
- Routes: 3 Static + 6 Dynamic; `/s/[slug]` ISR 300s.
- No N+1 queries. Zero renderer client-side (tutti Server Components).

### 12.4 Security & Fail-safe

- **RLS anon read-only published-only** su tenants/bp/site_sections/services.
- **Anon writes denied**.
- Cross-tenant isolation verificato FASE1 test multi-tenant-rls **49/49**.
- Theme isolation verificato E31 (A≠B primary).
- **Settings JSON invalido NON crasha**: sezione skippata + log sanitizzato.
- **CTA protocol allowlist**: tel/mailto/http/https/path interni → safe.
- XSS safe: 0 × dangerouslySetInnerHTML in tutti i 7 renderer.
- **Public DTO strict**: memberships / auth data NON raggiungibili dal pubblico.

### 12.5 Testing FASE 5 baseline

| Livello           | File                                |  PASS  |
| ----------------- | ----------------------------------- | :----: |
| DB RLS            | `tests/db/multi-tenant-rls.test.ts` |   49   |
| DB Resolver       | `tests/db/site-engine.test.ts`      |   11   |
| DB Content        | `tests/db/content-model.test.ts`    |   18   |
| Unit Zod/DTO      | `tests/unit/`                       |   81   |
| Integration       | `tests/integration/`                |   26   |
| E2E Chromium dev  | `e2e/site-public.spec.ts` E1–E37    |   52   |
| E2E Chromium prod | `test:e2e:prod` (pnpm start)        |   52   |
| Health            | `/api/health`                       | 200 OK |
| Secret scan       | git tracked files (5 patterns)      | 0 leak |

Regression complete F1–F5: **185/185 PASS**.
Second clean run: risultati **identici** (DB counts invariati, E2E 52/52 due volte).

### 12.6 Build classification FASE 5 finale

Static routes: `/`, `/_not-found`, `/login` (3).
Dynamic routes: `/api/health`, `/app`, `/app/settings`, `/dashboard`, `/onboarding` (5).
ISR dynamic: `/s/[slug]` revalidate=300s (1).
**Middleware proxy** attivo come da build report.

---

## 13. FASE 6 — Site Management Studio + Draft/Preview/Publish (Freeze 2026-08-19)

Aggiunto in FASE 6: dashboard di configurazione sito **tenant-scoped**,
**autenticata**, con workflow bozza → anteprima privata → pubblicazione
atomica con cache invalidation per singolo tenant.

Documentazione dettagliata → `docs/site-management-studio.md`.

### 13.1 Modello dati Draft separato + Published (ADR FASE 6)

| Concetto         | Tabella / Colonne                                                                                            | Note                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Stato editoriale | `site_editorial_state` (tenant_id PK, JSONB sections/services/theme, draft_revision UUID, updated_at)        | 1 riga per tenant; RLS FORCE + policies owner/manager write, member read. |
| Pubblicato       | `site_sections` + `services` + `business_profiles.theme_*` + `tenants.published` (bool) + `published_at`     | Stesse tabelle FASE 5 (non modificato schema FASE 5 esistente).           |
| Publish boundary | RPC `publish_site_draft()` SECURITY DEFINER, `search_path=''`, auth.uid() + has_tenant_role verify inside TX | Atomicità garantita da singola transazione DB.                            |

### 13.2 Matrice autorizzativa (FASE 6)

| Azione        | ANON | NO-TENANT | STAFF |  MANAGER   |       OWNER        |
| ------------- | :--: | :-------: | :---: | :--------: | :----------------: |
| `/app/site`   | DENY |   DENY    | READ  | READ+WRITE |     READ+WRITE     |
| Preview draft | DENY |   DENY    | READ  |   ALLOW    |       ALLOW        |
| Save Draft    | DENY |   DENY    | DENY  |   ALLOW    |       ALLOW        |
| Publish       | DENY |   DENY    | DENY  |   ALLOW    |       ALLOW        |
| **Unpublish** | DENY |   DENY    | DENY  |    DENY    | ALLOW (solo Owner) |

### 13.3 Invarianti di sicurezza critici FASE 6

1. `tenant_id` **mai** autorevole dal client; ogni Server Action lo deriva da `requireTenantRole()` server-side.
2. Whitelist payload: solo chiavi `{sections, services, theme, revision}` sono elaborate; chiavi extra (`tenant_id`, `__proto__`, `role`, `published`, `business_profile_id`) scartate.
3. Preview route: `dynamic='force-dynamic'` + `requireTenantMembership` prima di qualunque render → NO leak URL-indovinabile.
4. Publish RPC: SECURITY DEFINER `SET search_path=''` + auth.uid() verify interno + compare-and-swap revision (CONCURRENT code per lost-update).
5. Audit `site_published` / `site_editorial_draft_saved`: insert service_role only (anti-tampering), metadata PII-free (counts / prefix hash, nessun contenuto libero).
6. Cache invalidation publish: esclusivamente `revalidatePath('/s/'+slug)` → **ZERO invalidazione globale**.

### 13.4 Source of Truth aggiornata (FASE 6)

```
Bozza editoriale  → site_editorial_state (JSONB aggregato 1:1)
Revision concorrenza → site_editorial_state.draft_revision (UUID)
Pubblicato live   → site_sections/services/bp.theme_*/tenants.published (FASE 5 unchanged)
Preview rendering → SOLO site_editorial_state (force-dynamic, NO ISR)
Public rendering  → SOLO tabelle published (ISR 300s)
First-publish 404 → tenants.published=false → not-found page (draft NON distrutto)
```

Vedi `docs/site-management-studio.md` §2, §5, §6.

### 13.5 Comandi di verifica FASE 6

```bash
pnpm typecheck                 # TypeScript strict + exactOptional (0 errori)
pnpm format:check              # Prettier 0 warning
pnpm build                     # Next.js 16 production build
pnpm test run                  # 193 PASS FASE1-6 core / 10 FAIL (preesistenti: health env + auth-onboarding test RPC non nel DB locale)
pnpm db:reset                  # Idempotenza migrations 001→024 (2 run consecutivi identici)
```

### 13.6 Service Client Inventory (FASE 6)

| File + riga                                      | Uso                     | Classificazione | Note                                                                                      |
| ------------------------------------------------ | ----------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `site-studio.ts:74` `getSupabaseServiceClient()` | INSERT `audit_logs`     | **JUSTIFIED**   | Policy `audit_logs_service_only_insert`; audit tamper-proof non scrivibile da user-bound. |
| `auth.ts:243` (FASE 1)                           | onboarding provisioning | **JUSTIFIED**   | Create profiles/membership/tenants RLS non accessibili da anon/authenticated              |

NESSUN altro uso del service client per le write tenant-scoped (sections/services/theme usano **esclusivamente** createSupabaseServerClient user-bound).

### 13.7 Atomicity Report publish

```
BEGIN TX (RPC publish_site_draft)
  1. SELECT FOR UPDATE site_editorial_state (lock a livello riga)
  2. IF expected_revision ≠ current → RAISE EXCEPTION CONCURRENT
  3. DELETE site_sections  WHERE tenant_id = $1
  4. DELETE services       WHERE tenant_id = $1
  5. INSERT site_sections  (rows 0..N dal draft JSONB normalizzato)
  6. INSERT services       (rows 0..M)
  7. UPDATE business_profiles (theme_primary, theme_background, …, theme_radius, theme_fonts)
  8. UPDATE tenants SET published=true, published_at=NOW()
  9. UPDATE site_editorial_state SET draft_revision = new_uuid, updated_at=NOW()
  10. RETURN (ok, new_published_at, sections_applied, services_applied, theme_applied)
COMMIT

Next.js (Server Action post-TX):
  11. try { revalidatePath('/s/'+slug) } catch { /* NON bloccante, fallback ISR 300s */ }
  12. Audit insert site_published (NON bloccante)
```

Fallimento in punto 1-10 → **ROLLBACK automatico**: né site_sections né published cambiano. Stato transiente parziale impossibile per definizione.

---

## 14. Future work

- Sostituire la sessione Cloud `dgekfjkuvnofwdwxflms` con ambienti dedicati
  (DEV → STAGING → PRODUCTION).
- Introdurre `import "server-only"` in più file server-side.
- Centralizzare entitlement (feature flags per piano).
- Introdurre pgTAP per test strutturali alongside Vitest.
- FASE 7+ bookings engine, payments, staff & reviews reali, custom domains,
  sitemap, OG meta per-tenant, storage upload gallery immagini.
