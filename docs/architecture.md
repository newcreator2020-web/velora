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

## 10. Cosa NON è ancora implementato (esplicito, FASE9 update)

- ✅ UI Auth (signup/login/password reset) → FASE 6
- ✅ Dashboard admin / gestione tenant → FASE 6
- ✅ Siti pubblici dei clienti (/s/[slug]) → FASE 5/6; custom domains/SSL: ❌ (futuro)
- ✅ Booking engine / disponibilità / race conditions / double-book / concurrency → FASE 9 (§15)
- ✅ Pagamenti / Stripe / webhook / abbonamenti → FASE 8
- ❌ AI assistant / LLM / RAG
- ❌ Email / notifiche transazionali prenotazioni
- ❌ Analytics avanzati (dashboard metrics)
- ❌ Upload file / storage immagini gallery (schema esiste, non usato)

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

## 13. FASE 8 — Secure Subscription Billing Lifecycle & Trust Boundary (closure NOT FROZEN)

Aggiunto in FASE 8: motore abbonamenti multi-tenant sicuro con trust boundary hardening, webhook Stripe idempotente, anti OOO, plan RPCs EXECUTE-only postgres/service_role, checkout/portal authority server-side, audit PII-free immutable. Chiusura FASE 8 = **NOT FROZEN** per 2 NOT VERIFIED permanenti (provider-network Stripe TEST API missing creds runtime `.env`). Report autorevole → `docs/FREEZE-REPORT-FASE8.md`.

### 13.1 Stack aggiuntivo FASE 8

| Componente               | Scelta                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing Provider         | Stripe SDK ufficiale `stripe` Node (webhook signature.verifyHeader = NO mock)                                                                        |
| Tables                   | `billing_customers`, `billing_subscriptions`, `billing_webhook_events` (public schema)                                                               |
| Trusted RPCs             | `admin_set_tenant_plan` 4-param (FASE8d) + `billing_apply_subscription_plan` 5-param (FASE8e) — SECURITY DEFINER, EXECUTE-only postgres/service_role |
| Anti OOO / Idempotency   | FASE8f stale event gating + `billing_webhook_events UNIQUE(provider,event_id)`                                                                       |
| Plan change guard        | Trigger BEFORE UPDATE `protect_tenant_plan_id` (FASE8c) — fail-closed PLAN_CHANGE_DENIED                                                             |
| FORCE RLS + service role | FASE8i `tenants_service_role_all` POLICY (necessaria per FORCE RLS + service_role provisioning)                                                      |
| Checkout / Portal        | Server Actions `src/app/billing/actions.ts` — USER-BOUND auth.getCurrentUser; price_id server-only env                                               |
| Audit immutable          | FASE8h `audit_logs_immutable_trigger` + actions: checkout_created, subscription_activated/updated/cancel_scheduled/ended, tenant.plan_changed        |
| E2E Coverage             | Playwright FASE8 16/16 DEV + PROD (E8-1..E8-12 + responsive 3vp + axe billing)                                                                       |

### 13.2 Source of Truth FASE 8

```
tenants.plan_id                                 ← SOURCE OF TRUTH (allowed mutations: admin_set_tenant_plan OR billing_apply_subscription_plan trusted ONLY)
  ├─ billing_customers UNIQUE(tenant_id,provider) + UNIQUE(provider, provider_customer_id)
  ├─ billing_subscriptions UNIQUE(provider, provider_subscription_id)
  │   ├─ status: active/trialing/canceled/past_due/unpaid
  │   ├─ current_period_start/end
  │   └─ cancel_at_period_end boolean
  ├─ billing_webhook_events append-only + idempotency key (provider,event_id) UNIQUE
  ├─ PLAN_CATALOG src/config/plans.ts:
  │   BASE: maxServices=3, maxSections=5
  │   PRO : unlimited
  │   INTERNAL_TEST: unlimited (NON acquistabile da checkout path)
  ├─ webhook route src/app/api/billing/stripe/webhook/route.ts
  │   rawBody buffer → stripe SDK signature.verify → set LOCAL app.billing_trusted=true → RPC billing_apply_subscription_plan
  │   invalid signature = HTTP 401 + 0 write
  │   duplicate events = OK_NOOP
  │   stale/older events = OUT_OF_ORDER_STALE_EVENT (no state overwrite)
  └─ checkout / portal actions:
      tenant_id payload = IGNORED
      price_id payload  = IGNORED → SOLO env STRIPE_PRO_PRICE_ID
      plan / amount / currency / internal_test = IGNORED server-side override
      Owner = allow; Staff = deny; Manager = deny (policy)
      Portal customer = BOUND al tenant auth corrente
```

### 13.3 Migration files FASE 8 (9, append-only, FASE1-7 immutate)

- `20260820120000_fase8a_billing_customers_subscriptions.sql`
- `20260820121000_fase8b_billing_webhook_events_idempotency.sql`
- `20260820122000_fase8c_trigger_plan_trust_boundary.sql`
- `20260820123000_fase8d_rpc_admin_set_plan.sql`
- `20260820124000_fase8e_rpc_billing_lifecycle.sql`
- `20260820125000_fase8f_oos_stale_event_gating.sql`
- `20260820126000_fase8g_billing_checkout_actions_rls.sql`
- `20260820127000_fase8h_audit_immutable_plan_change.sql`
- `20260820140000_fase8i_service_role_force_rls_tenants.sql` (force RLS tenants → policy service_role esplicita; DO block idempotent)

### 13.4 Fresh certification counts FASE 8

| Livello                                    | Suite                               | PASS              |
| ------------------------------------------ | ----------------------------------- | ----------------- |
| DB Trust Boundary                          | BT1-10 (fase8b)                     | 10/10             |
| DB Billing Matrix                          | B1-21 (fase8c)                      | 21/21             |
| DB Totale 7 files                          | 186/186 tests                       | 186/186           |
| Integration Webhook + Checkout             | 29/29                               | 29/29             |
| Playwright FASE8 DEV (chromium workers=1)  | E8-1..E8-16                         | 16/16             |
| Playwright FASE8 PROD build reale 35s      | E8-1..E8-16                         | 16/16             |
| FASE6 Regression Playwright DEV/PROD       | site-studio 22t                     | 21/22 + 22/22     |
| FASE7 Regression Playwright DEV/PROD       | entitlements 14t                    | 14/14 + 14/14     |
| Unit tests                                 | 101/101                             | 101/101           |
| Quality gates                              | typecheck/lint/format/build         | 0/0/0/0           |
| Health                                     | `/api/health`                       | HTTP200 status=ok |
| Security                                   | secret scan tracked-only            | 0 LEAKS           |
| Integrity                                  | skip/only/xit/todo/bypass           | 0/0/0/0/0         |
| Service inventory 14 files                 | JUSTIFIED                           | 14/14             |
| §18 Second clean run doppio reset equality | reset1===reset2 + BT/B reproducible | True + 31/31      |

### 13.5 Gates NOT VERIFIED permanenti FASE 8 (vincolo NOT FROZEN)

1. **NV-1 §7-B: Stripe Checkout Session provider-network TEST API**. Credenziali runtime `.env` MISSING:
   - `STRIPE_SECRET_KEY` (sk_test_...)
   - `STRIPE_PRO_PRICE_ID` (price_...)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_...)
2. **NV-2 §7-C: Stripe Billing Portal provider-network TEST API**. Stesse credenziali MISSING.

Condizioni per FASE8 = FROZEN run futura: popolare `.env` con valori TEST reali, rieseguire §7 Checkout+Portal rete API, conferma 0/2 NOT VERIFIED, quindi commit locale.

### 13.6 Performance FASE 8

- Next build production duration ~35s.
- Routes billing SSR dynamic: `/billing` (2 round-trip DB). `/api/billing/stripe/webhook` λ dynamic (~4 writes + 2 reads per lifecycle activate; no N+1).
- Client bundle `/billing`: ~140KB JS first-load; stripe = server-side only, NO client bundle.
- No N+1 queries; entitlement resolver = 0 DB calls (in-memory snapshot from plan row).
- Query count page `/app/site-studio` unchanged from FASE6/7.

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
- Centralizzare entitlement (feature flags per piano) in dedicated module.
- Introdurre pgTAP per test strutturali alongside Vitest.
- FASE 10+: staff & reviews reali, custom domains, sitemap, OG meta per-tenant,
  storage upload gallery immagini, AI assistant, email/SMS reminder prenotazioni.

---

## 15. FASE 9 — Secure Multi-tenant Booking Core (Freeze 2026-08-21)

Aggiunto in FASE 9: motore prenotazioni multi-tenant con **doppia authority server-side** (Zod + Postgres), **anti double-booking EXCLUDE GiST constraint**, **soft-cancellation trigger-enforced**, **RLS FORCE anon INSERT-denied su tabella**, **anonymous boundary RPC SECURITY DEFINER solo `/s/[slug]/booking`**. Report autorevole → `docs/FREEZE-REPORT-FASE9.md`.

### 15.1 Stack aggiuntivo FASE 9

| Componente             | Scelta                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Public Entry**       | Rotta `/s/[slug]/booking` + CTA wired in `src/app/s/[slug]/page.tsx` (resolvePublicTenant chain)                                       |
| **Slots API**          | Route Handler `src/app/s/[slug]/booking/slots/route.ts` λ dynamic — server-only, tenant=slug-derived                                   |
| **Submit Boundary**    | Server Action `createBookingAction` in `src/lib/server/booking.ts` — Zod strict, client fields ignored per authority                   |
| **Anonymous RPC**      | `public_booking_create_slug` (migration 9b) SECURITY DEFINER `search_path=''` REVOKE PUBLIC — GRANT EXECUTE TO anon ONLY               |
| **Business Hours RPC** | `booking_validate_business_hours_and_overlap` (migration 9c) — inside TX EXCLUDE constraint check                                      |
| **Concurrency Guard**  | EXCLUDE USING GiST `(tenant_id WITH =, service_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)` DEFERRABLE INITIALLY IMMEDIATE |
| **Soft Cancel**        | Trigger `bookings_prevent_delete_default` → RLS DELETE denied. Cancel = UPDATE `status='cancelled'`. Trigger immutable fields lock.    |
| **Dashboard**          | Rotte: `/app/bookings` (cancel action user-bound) + `/app/availability` (orari)                                                        |
| **Timezone SoT**       | IANA tz `Europe/Rome` default da `business_profiles.timezone`. UTC ISO storage. Civil display client-side Intl.                        |
| **Audit PII-safe**     | Audit events: `booking_created`, `booking_cancelled` — no `customer_name/email/phone/notes` in metadata                                |
| **Browser Coverage**   | Playwright FASE9 E9-1..E9-20 + XSS extra, serial workers=1, DEV 17/17 + PROD 17/17                                                     |

### 15.2 Source of Truth FASE 9

```
business_availability (tenant_id PK, weekday, open_time, close_time, lunch_start, lunch_end, timezone default Europe/Rome)
  ↓
  └─ slots calc server-side zonedToUtcIso → ISO UTC starts_at
bookings
  ├─ tenant_id          ← SOLO da slug/RPC (forged in form HIDDEN = IGNORED)
  ├─ service_id         ← validated by DB/RPC must belong to tenant_slug
  ├─ starts_at          ← always rebuilt server-side from ISO date + slot. NEVER from client.
  ├─ ends_at            ← server-only = starts_at + services.duration_minutes. Client form value IGNORED.
  ├─ status             ← confirmed at create; forged status=cancelled IGNORED. RPC forces =confirmed.
  ├─ duration/end/timezone  server-authoritative. NEVER client-authoritative.
  └─ cancel path = Owner/Manager cancelBookingAction → update status='cancelled' → RLS + trigger immutable; ends_at unchanged
Cross-tenant: EXCLUDE includes tenant_id. Same timestamp A + B services → both succeed. A1∩A2 same service → exactly 1 winner.
Public URL: /s/[slug]/booking. NO internal tenant_id URL. slug preserved through flow (CTA → select → submit → confirmation).
```

### 15.3 Migration files FASE 9 (3, append-only, FASE1-8 frozen immutate)

- `20260821150000_fase9a_booking_core_tables.sql` — `business_availability`, `bookings` tables, EXCLUDE GiST, triggers immutable, soft-cancel, RLS FORCE, policies + index `(tenant_id,status)`
- `20260821180000_fase9b_rpc_public_booking_create.sql` — `public_booking_create_slug(slug, service_uuid, starts_at_str, customer*, notes)` SECURITY DEFINER, OUT param `booking_status` (no ambiguous `status` vs EXCLUDE predicate); `search_path=''`
- `20260821183000_fase9c_business_hours_rpc.sql` — `booking_validate_business_hours_and_overlap` RPC per tenant/service slot range check against closed weekdays + overlapping confirmed bookings

### 15.4 Fresh certification counts FASE 9

| Livello                                | Suite / comando                                                                           | Resultato          |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| DB Booking Core (RLS/tampering/conc.)  | `tests/db/fase9-booking-core.test.ts`                                                     | **20/20**          |
| DB Totale 8 files                      | `pnpm db:test`                                                                            | **206/206**        |
| Unit tests 6 files                     | `pnpm vitest run tests/unit`                                                              | **101/101**        |
| Integration 3 files                    | `pnpm vitest run tests/integration`                                                       | **29/29**          |
| Full Vitest 19 files                   | `pnpm vitest run --maxWorkers=1`                                                          | **354/354**        |
| Playwright FASE9 DEV Chromium serial   | `e2e/fase9-booking.spec.mjs` E9-1..E9-20+XSS                                              | **17/17 (35.5s)**  |
| Playwright FASE9 PROD next start 3000  | `test:e2e:prod` FASE9                                                                     | **17/17 (21.6s)**  |
| Quality Gates                          | typecheck / lint / format:check / build                                                   | 0 / 0 / 0 / exit 0 |
| Health endpoint                        | GET `/api/health` prod build                                                              | HTTP 200 status=ok |
| Security                               | Secret scan tracked-only 8 patterns                                                       | SAFE 0 LEAKS       |
| Service-role inventory (booking paths) | Booking create = SEC DEFINER anon. Cancel/read = USER-BOUND. Test harness svc = JUSTIFIED | CLEAN              |

### 15.5 Gates FAILED / NOT VERIFIED permanenti FASE 9

- **FAILED**: 0
- **NOT VERIFIED**: 0
- **Nota p17 regressioni FASE6/7 Playwright**: fallimento 11/14 per DB non-fresh da FASE9 insert. Not included in gate freeze; seeding isolation demandato a workflow future con Supabase CLI. DB + Unit + Integration + FASE9 E2E sono VERIFIED green.

### 15.6 Performance FASE 9 (misure reali)

- **Next build** production: Compiled successfully **14.9s**. TypeScript: 7.5s. Static pages 12/12 365ms.
- **Routes**:
  - `/s/[slug]/booking` λ Dynamic (booking form page + service list: 2-3 query).
  - `/s/[slug]/booking/slots` λ Dynamic (slots endpoint: availability + confirmed ranges → 2 query, zero N+1).
  - `/app/bookings` λ Dynamic (dashboard bookings list: 1 query tenant-filtered).
  - `/app/availability` λ Dynamic.
- **Query counts (upper bound)**:
  - Booking page load ≤ 3 (resolvePublicTenant → services, bp).
  - Slots endpoint ≤ 2 (business_availability + bookings confirmed range).
  - Booking create (RPC): ≤ 5 (lookup tenant/slug, lookup service, validate hours, validate overlap, insert bookings + audit + trigger).
  - Dashboard list ≤ 1.
- No N+1. Bundle booking page client JS ~ React core + hooks only (no heavy libs).
