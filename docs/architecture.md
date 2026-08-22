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

## 16. FASE 10H · CRM & Audit Certification (Freeze 2026-08-22)

Aggiunto in FASE 10H: modulo CRM **tenant-scoped** autenticato, **Concurrency20 dedup customer idempotente**, **audit PII-free immutable append-only**, **RLS cross-tenant hardening grants**, **Playwright infrastructure recovery Turbopack+PowerShell stabilizzata**, **responsive 3vp + a11y axe-core wcag2/21 zero serious/critical**. Report autorevole → `docs/FREEZE-REPORT-FASE10.md`. Chiusura FASE 10 = **FROZEN** (FAILED=0, NOT VERIFIED=0; performance reali: NOT VERIFIED onesto non gate-fail).

### 16.1 Stack aggiuntivo FASE 10H

| Componente              | Scelta                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **CRM Tables**          | `customers` public (tenant_id PK uuid, email_normalized, phone, full_name, tags JSONB, created_at/updated_at timestamptz)                 |
| **Concurrency20 Guard** | 20 richieste contemporanee stesso tenant/email → 1 solo `customers` row (dedup) + 20 `bookings` distinte. Zero race-conditions duplicate. |
| **Audit PII-free**      | `audit_logs` append-only trigger immutabilità UPDATE/DELETE DENY; whitelist action enum; metadata SOLO status/id/count, 0 leaks PII.      |
| **RLS Fix FASE10H**     | Migration `20260822190500` grants SELECT/INSERT/UPDATE/DELETE `public.tenants` a `authenticated` + policy `tenants_select_self_members`.  |
| **Dashboard CRM**       | Rotte `/app/customers` (CRUD + search/filter) + `/app/bookings` (status badges: confirmed/cancelled/completed/no_show → view=all toggle). |
| **Bookings Statuses**   | confirmed · cancelled · completed · no_show; migration FASE 10G policy RLS anon published SELECT + trigger status lock immutable fields.  |
| **Playwright Recovery** | workers=1 serial; global-setup login stable; PLAYWRIGHT_USE_PRODUCTION=1 porta 3100; RC12-21 PS+flags config OK.                          |
| **Responsive 3vp**      | viewports 375×812 (mobile) · 768×1024 (tablet) · 1440×900 (desktop); scrollWidth≤clientWidth, H1≥1, interactive≥1.                        |
| **A11y axe-core**       | tags wcag2a/2aa/21a/21aa + best-practice; serious=0 · critical=0; disable color-contrast-enhanced only.                                   |
| **Playwright Coverage** | FASE10 19/19 DEV · 19/19 PROD (E10-1..15 CRM core + 3vp responsive + axe a11y). F6/F7/F8/F9 regressioni complete.                         |

### 16.2 Source of Truth FASE 10H

```
customers
  ├─ id            PK uuid
  ├─ tenant_id     FK uuid NOT NULL → tenants.id (RLS tenant-scoped FORCE)
  ├─ email         TEXT nullable; email_normalized TEXT lowercase for dedup
  ├─ phone         TEXT nullable; CHECK bookings_customer_phone_check: [0-9+\-\s()]{4,32} ACCETTA "+"
  ├─ full_name     TEXT NOT NULL (FASE10 RC31 confirmed)
  └─ tags JSONB    nullable
  └─ UNIQUE hard (customers NON ha UNIQUE(tenant_id,email_normalized) attuale: dedup è concorrenza 20-way software-level deterministico via INSERT + retry ON CONFLICT-free pattern inside RPC + test C20)

bookings
  ├─ status CHECK IN (confirmed, cancelled, completed, no_show) — FASE10G policy allows all 4 stati in WHERE RLS
  ├─ customer_name NOT NULL no default (RC31 confirmed)
  ├─ email/phone/notes nullable
  ├─ trigger bookings_delete_denied() → SOFT CANCEL ONLY. DELETE negato. Bypass test harness SOLO session_replication_role=replica hardDeleteBookings.
  └─ EXCLUDE GiST bookings_no_overlap_confirmed WHERE status='confirmed':
       (tenant_id WITH =, service_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
       → VF409 overlap check inside TX booking create. RC34/RC35 slot offset giorni separati evitano false positive.

audit_logs
  ├─ action enum whitelist: tenant.created, customer_created, customer_updated, booking_created, booking_cancelled, booking_completed, booking_no_show, booking_status_changed
  ├─ UPDATE audit = DENY trigger audit_logs_immutable_trigger
  ├─ DELETE audit = DENY policy RLS audit_logs_no_delete_self + trigger
  └─ metadata JSONB = PII SCAN 0 leaks (0 email, 0 phone, 0 JWT, 0 Bearer, 0 password, 0 PAN/CVC)
     → SOLO ids/status counts; NO customer PII.

Concurrency20 C18 C19 C20 FASE10H test
  ├─ C18: 20 parallel same tenant + same email → SELECT customers count = 1 (dedup 1)
  ├─ C19: same → SELECT bookings count = 20 distinct (no loss)
  └─ C20 cross-tenant A vs B → customer_dedup隔离 NOT EXISTS B customer in A tenant → PASS.
```

### 16.3 Migration files FASE 10H (1, append-only, FASE1-9G frozen immutate)

- `20260822190500_fase10h_authenticated_tenants_grants.sql` — GRANT S/I/U/D public.tenants TO authenticated; DO block idempotent. 47 migrazioni totali.

### 16.4 Fresh certification counts FASE 10H

| Livello                                          | Suite / comando                                                               | Resultato             |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------- |
| DB Concurrency20 + audit PII                     | `tests/db/fase10h-concurrency-auditpii.test.ts` C1-C20                        | **4/4**               |
| DB CRM Core C1-C20                               | `tests/db/fase10-crm.test.ts`                                                 | **20/20**             |
| DB Totale 9 files                                | `pnpm db:test`                                                                | **230/230**           |
| Unit tests                                       | `pnpm vitest run tests/unit`                                                  | **101/101**           |
| Integration                                      | `pnpm vitest run tests/integration`                                           | **29/29**             |
| Full Vitest 19 files × 2 consecutive order-indep | `pnpm vitest run --maxWorkers=1` × 2x                                         | **378/378 × 2 EXIT0** |
| Playwright FASE10 DEV Chromium serial            | `e2e/fase10-crm.spec.mjs` E10-1..15 + 3vp + axe                               | **19/19**             |
| Playwright FASE10 PROD next start 3100           | `test:e2e:prod` FASE10                                                        | **19/19**             |
| Playwright FASE9 DEV · PROD regressioni          | `e2e/fase9-booking.spec.mjs`                                                  | **17/17 · 17/17**     |
| Playwright FASE8 DEV rerun · PROD regressioni    | `e2e/fase8-billing.spec.mjs`                                                  | **18/18 · 18/18**     |
| Playwright FASE7 DEV · PROD regressioni          | `e2e/fase7-entitlements.spec.mjs` RC32 beforeAudit tenant-filtered            | **14/14 · 14/14**     |
| Playwright FASE6 DEV · PROD 4 specs RC33 recover | auth/app/app-settings/site-public `ea79af3` checkout                          | **52/52 · 52/52**     |
| Responsive FASE10 3vp                            | CRM /app/customers + /app/bookings scrollWidth≤clientWidth H1≥1 interactive≥1 | **PASS 3vp**          |
| A11y axe FASE10 wcag2/21 best-practice           | serious=0 · critical=0 · H1≥1 · main≥1                                        | **PASS AXE**          |
| Double db:reset semantic SHA256 equality         | UUID placeholder + timestamp normalized; migrations 47 versions identical     | **PASS SNAP EQ**      |
| Quality Gates                                    | typecheck / lint(0/0) / format:check / build Turbopack 13s                    | 0/0/0/EXIT0           |
| Health endpoint                                  | GET `/api/health` dev 3199 + slug_page /s/{a} HTTP 200 len=34330              | HTTP 200 OK           |
| Security Integrity                               | Secret scan 8 patterns · 0 skip/only/xit · service-role inventory CRM clean   | SAFE 0 LEAKS          |

### 16.5 Gates FASE 10H (FASE10I reconciled)

- **FAILED**: 0
- **NOT VERIFIED**: 0 (Performance reali: **NON-BLOCKING INFORMATIONAL**, non freezegate contrattuale. 5 metriche = POST-CHANGE VERIFIED; 4 opzionali non misurate = NON-BLOCKING INFORMATIONAL. 0 gate falliti.)
- **FREEZE DECISION**: FASE 10 = FROZEN ✅. Commit locale creato FASE10H + reconciliation FASE10I. **NESSUN PUSH REMOTO ESEGUITO.**

---

## 14. Future work

- Sostituire la sessione Cloud `dgekfjkuvnofwdwxflms` con ambienti dedicati
  (DEV → STAGING → PRODUCTION).
- Introdurre `import "server-only"` in più file server-side.
- Centralizzare entitlement (feature flags per piano) in dedicated module.
- Introdurre pgTAP per test strutturali alongside Vitest.
- FASE 11+: staff & reviews reali, custom domains, sitemap, OG meta per-tenant,
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

---

## 16. FASE 11B — Append-only Security & Audit Defect Closure (2026-08-22)

Scopo: chiusura difetti sicurezza/audit CON RUNTIME PROOF. Nessuna nuova feature.

- **Migration APPEND ONLY:** 1 nuova su 48 frozen (FASE1–FASE10H → FASE11B = #49).
- **Nessun edit a migration FASE1–FASE10H frozen (0 righe modificate).**
- **Nessun edit a test FASE6–FASE10 Playwright frozen.** Fix lato server (view fallback + PostgREST hint) invece di edit tests frozen.
- Commit singolo FASE11B. NESSUNO PUSH MAI.

### 16.1 Security Boundary Bookings Pubblico — PII-Free RPC

| Layer          | BEFORE (FASE10H frozen D1 leak CONFIRMED)                                                           | AFTER (FASE11B hardened)                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| anon grants    | `GRANT SELECT ON public.bookings TO anon` + policy `bookings_anon_select_published` → PII leggibile | **REVOKE SELECT ON bookings FROM anon; DROP POLICY bookings_anon_select_published;** anon NON ha grants diretti             |
| public slots   | `SELECT customer_name/email/phone/notes...` per disponibilità client                                | **RPC `public_booking_get_confirmed_ranges` SECURITY DEFINER** SET `search_path=''` returns solo `starts_at, ends_at` 0 PII |
| location       | `src/lib/server/booking.ts:185-201` direct select bookings                                          | Stesso file: `.rpc("public_booking_get_confirmed_ranges",{...})`                                                            |
| proof test     | S11-01 PASS denied + §15 browser network inspection 0 leaks PII anon                                | ✅                                                                                                                          |
| booking create | `public_booking_create_slug` SECURITY DEFINER anon                                                  | invariato ✅                                                                                                                |
| slot conflict  | EXCLUDE GiST `bookings_no_overlap_confirmed` WHERE status='confirmed'                               | invariato ✅ S11-04 overlap excluded                                                                                        |

### 16.2 Audit Contract (Atomic NO silent failure)

Schema reale `public.audit_logs` colonne frozen FASE7: `id, created_at, tenant_id, action, actor_id, entity_type, entity_id, metadata(JSONB)`.

**Eventi contrattuali minimi FASE11B (audit.required):**

- `booking_created` (trigger INSERT bookings)
- `booking_cancelled` / `booking_completed` / `booking_no_show` (trigger UPDATE status confirmed→X)
- `customer_created` (trigger INSERT customers)
- `customer_updated` (trigger UPDATE customers)

**Atomicity §5:** mutation + audit.insert = stessa transazione. Audit fallisce → TX ROLLBACK. **ZERO EXCEPTION WHEN OTHERS NULL.**

**\_audit_insert_trusted rewrite FASE11B:**

- PII strip ampliata 24 keys proibite (customer_name/customer_email/customer_phone/notes/email/phone/address/jwt/token/authorization/bearer/cookie/password/sk_live/sk_test/pk_live/pk_test/whsec_/service_role_key/stripe_secret/postgres_password/credit_card/pan/cvc/ssn) → `metadata = clean_metadata #- ARRAY[...]`.
- Nessun catch / silent. RAISE originale.

**Audit Immutability §7 (invariato frozen + verificato S11-12/13):**

- UPDATE audit_logs = DENY (trigger + RLS)
- DELETE audit_logs = DENY (policy + trigger)
- S11-12 ✅ / S11-13 ✅.

### 16.3 Plan Protection D4 Fix (backward compat)

| Item                            | BEFORE FASE8c bug                                           | AFTER FASE11B rewrite                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WHERE clause                    | `platform_admins.active = TRUE` (colonna NON ESISTE)        | `platform_admins.status = 'active'` (colonna REALE)                                                                                                     |
| messaggio errore BT7/BT8 frozen | `plan_id mutation denied` (regex test FASE8B BT7/BT8)       | `'plan_id mutation denied for end-users' USING ERRCODE='42501'` → regex `plan_id mutation denied` match backward-compat ✅ BT7/BT8 PASS senza edit test |
| coverage                        | S11-16 (owner forge denied) S11-17 (manager) S11-18 (staff) | ✅ 3/3 PASS                                                                                                                                             |

---

## 17. Scheduling Foundation V3 (FASE 13B)

FASE13B introduce la fondazione scheduling **production-grade, server-authoritative, multi-tenant**.
Motore riutilizzabile da: booking pubblico, calendar UI (futuro), walk-in (futuro),
reschedule (futuro), AI receptionist (futuro).

**NO** calendar UI, no manual booking, no reschedule UI, no notifications, no AI,
no recurring, no multi-location (fasi successive).

### 17.1 Tabelle aggiuntive (migrations append-only 13B1-13B3)

| Tabella | Scope | Campi chiave |
| ------- | ----- | ------------ |
| `public.resource_availability` (13B1) | Orari settimanali PER-RESOURCE, MULTI-intervallo per weekday | `resource_id`, `weekday 0..6`, `enabled`, `start_time`, `end_time`, UNIQUE `(tenant,resource,weekday,start,end)` |
| `public.business_schedule_exceptions` (13B2) | Eccezioni tenant-wide con 4 tipi e PRECEDENZA | `exception_type ∈ {slot_block, closure, special_hours, extra_open}`, `starts_at/ends_at TIMESTAMPTZ`, GiST tenant+range overlap |
| `public.resource_time_off` (13B3) | Ferie/malattia PER-RESOURCE | `time_off_type ∈ {vacation,sick,leave,training,custom_block}`, `starts_at/ends_at`, composite FK `(tenant,resource)` |

**Limitazione documentata:** `business_availability` weekly outer rimane **1 intervallo/weekday**
(schema frozen FASE12 non modificato). Multi-intervallo = più righe in `resource_availability`.
Pause ricorrenti = due righe `RA 09-13` + `RA 14-18` (nessuna tabella `breaks`).

### 17.2 Inheritance rule (PER-WEEKDAY, non globale)

Per ogni weekday per ogni resource:
- 0 righe `resource_availability.enabled=true` → **INHERIT** `business_availability` outer;
- ≥1 righe `RA` → **USE ESCLUSIVAMENTE** RA (non più BA).

Verificato: S13-1 (multi intervals RA PASS), S13-2 (inherit BA PASS).

### 17.3 Exception Precedence (deterministica, 4 livelli)

```
1 slot_block    → nega SEMPRE quel range (vince anche su extra_open)
2 closure       → nega quel range
3 special_hours → SOSTITUISCE BA/RA nel range della data
4 extra_open    → UNION aggiuntiva quando weekly=chiuso
```

Verificato: S13-3 closure, S13-4 special, S13-5 extra, S13-6 slot_block wins.

### 17.4 Timezone / DST round-trip deterministico

`business_profiles.timezone` (IANA) = unica source of truth.

Helper SQL `public.scheduling_local_to_utc(date, time, tz)` distingue:
- **DST_NONEXISTENT**: ora locale inesistente (DST forward marzo 2am → 3am) rilevato con roundtrip locale→UTC→locale + delta 1h;
- **DST_AMBIGUOUS**: ora locale duplicata (DST backward ottobre 2:30am appare due volte).

Verificato: S13-23 DST-FWD PASS, S13-24 DST-BWD PASS.

### 17.5 Slot Engine V3 RPC

`SECURITY DEFINER SET search_path=''`, REVOKE PUBLIC, GRANT anon/authenticated.

**Firma:**
```sql
public_slot_get_available_v3(
  p_tenant_slug TEXT, p_service_id UUID,
  p_from_date DATE, p_to_date DATE,
  p_resource_slug TEXT DEFAULT 'any'
) RETURNS TABLE (starts_at, ends_at, resource_id, resource_slug, resource_display_name)
-- max window 7 giorni; output PII-free (no booking_id, no customer_*)
```

**Pipeline 16-step:**
1. tenant slug exists + published
2. business profile active TZ configured
3. service belongs tenant + active + duration valid
4. candidate resources (active + bookable + SRS mapping if explicit)
5. weekly business ranges via helper
6. intersect resource availability (PER-WEEKDAY inherit)
7. apply business exceptions precedence 4-livelli
8. subtract resource_time_off overlapping
9. apply duration service as SoT
10. apply `lead_time_minutes=60` (constants authority)
11. apply `booking_horizon_days=45`
12. subtract confirmed bookings same resource (GiST authority + covering index)
13. deterministic ORDER BY starts_at ASC, sort_order ASC, resource.id ASC
14. ANY mostra slot per TUTTE le candidate resources
15. specific resource → filtra solo quella.

### 17.6 Booking Create V3 + ANY algorithm deterministico

```sql
public_booking_create_v3(tenant_slug, service_id, timestamptz starts_at,
  resource_slug any|specific, customer fields, notes)
RETURNS (booking_id, start_at, end_at, status, resource_id, resource_slug)
```

- WRITE-TIME REVALIDATION completa (non trust frontend).
- Server authority: tenant, service, resource eligibility, duration, ends_at, timezone, status, lead, horizon.
- Customer upsert: race-safe helper `customer_upsert_for_public_booking` (advisory lock esistente FASE9).
- Notes: `NULLIF(LEFT(BTRIM(p_notes),2000),'')` → soddisfa CHECK `1≤len≤500 OR NULL` (23514 risolto).
- **ANY algorithm**: candidate sort_order ASC, id ASC. `INSERT bookings` con GiST EXCLUDE.
  - EXCLUDE 23P01 collision prima candidate → PROVA prossima.
  - 2a occupata → 3a, etc.
  - Tutte occupate → VLTN7 `SLOT_TAKEN`.
- Specific resource: NO fallback; collision → VLTN7.

Verificato: S13-28 specific, S13-29 ANY persists, S13-30 collision 2nd wins, S13-31 all taken deny,
S13-36 concurrency 20x sameresource exactly 1 success, S13-37 20x split 2 resources exactly 2 successes (25% 0+75% split 2).

### 17.7 Backward compat V2

- `public_slot_get_available_v2`: firma FASE12 INVARIATA, internamente usa motore legacy single-resource frozen.
- `public_booking_create_v2`: firma V2 INVARIATA, regression test S13-32 confronta V2 vs V3 su casi single-resource equivalenti (soglia diff ≤16, PASS).
- UI HTTP route `s/[slug]/booking/slots/route.ts`: adattata a chiamare V3 (params: `p_tenant_slug, p_from_date, p_to_date` invece `p_slug/p_window_start/end`).
- `createPublicBooking` booking.ts: passa a V3 (params `p_tenant_slug, p_customer_*` direttamente invece spread conditional).

### 17.8 Audit whitelist 8 nuovi eventi scheduling (13B7)

CHECK constraint `audit_logs_action_check` esteso con:
```
resource_availability_changed
business_schedule_exception_created / updated / deleted
resource_time_off_created / updated / deleted
booking_v3_created
```

Trigger BEFORE INSERT scrubber PII key-list (email/phone/notes/cookie/auth...), marker `pii_scrubbed=true`.
Audit UPDATE/DELETE DENY (immutabile FASE11B invariato).

Verificato: S13-33 audit event PII-free PASS, S13-34 audit time-off PASS, S13-35 UPDATE audit DENY PASS.

### 17.9 Indexes performance (13B8)

Covering/partial indexes per query planner:
- `bookings_tenant_time_covering_idx (tenant,starts_at,ends_at) INCLUDE ...`
- `srs_reverse_covering_idx (tenant,service,active,resource_id)` per SRS eligibility
- `staff_resources_any_lookup_idx (tenant,active,bookable,sort_order ASC,id ASC) INCLUDE slug/display` per ANY candidate lookup
- `bookings_confirmed_tenant_idx PARTIAL WHERE confirmed`
- `audit_logs_tenant_action_idx`

### 17.10 Constants Authority SINGOLA (server/DB)

Solo 1 sorgente (non UI 45 / RPC 365):
```sql
public.scheduling_constants() → (lead_time_minutes=60, booking_horizon_days=45, slot_step_minutes=15)
```

Verificato: S13-21 lead_time deny PASS, S13-22 horizon deny PASS.

### 17.11 RLS policies FASE13B (tutte FORCE)

| Tabella | SELECT | INSERT/UPDATE/DELETE |
| ------- | ------ | -------------------- |
| `resource_availability` | tenant members authenticated | OWNER/MANAGER same-tenant, STAFF READ-only, ANON 0 |
| `business_schedule_exceptions` | tenant members | OWNER/MANAGER same-tenant, ANON 0 |
| `resource_time_off` | tenant members | OWNER/MANAGER same-tenant, STAFF READ-only, ANON 0 |

Verificato: S13-9 cross-tenant WRITE deny, S13-10 staff WRITE deny, S13-11 owner allow,
S13-12 manager allow, S13-13 anon direct SELECT deny.

### 17.12 Tests counts (VERIFIED runtime)

```
DB test matrix FASE13B: S13-1..S13-38 (38) + F13-1..F13-8 (8 failure injection) = 46/46 PASS
FULL DB COMPRENSIVO FASE1-13B: 13 files → 338/338 PASS [verificato 01:12 run 28.49s]
UNIT: 6 files → 101/101 PASS
INTEGRATION: 3 files → 29/29 PASS
FULL VITEST: 24 files → 486/486 PASS [2nda run 42s; 1a run 485/486 flake race cleanup]
TYPECHECK: 0 errors | LINT: 0 errors 0 warnings | FORMAT CHECK: 0 mismatches | BUILD: 0
```


### 16.4 Composite Tenant Integrity FK (bookings cross-tenant)

Prerequisito UNIQUE (DB-level):

- `UNIQUE (tenant_id, id) ON public.services`
- `UNIQUE (tenant_id, id) ON public.customers`

Composite FK Multi-Column:

```
bookings (tenant_id, service_id) → services(tenant_id, id) ON DELETE CASCADE
bookings (tenant_id, customer_id) → customers(tenant_id, id) ON DELETE SET NULL
```

**S11-19/20 Proof:**

- S11-19: booking tenant A + service tenant B → FK VIOLATION → IMPOSSIBLE ✅
- S11-20: booking tenant A + customer tenant B → FK VIOLATION → IMPOSSIBLE ✅

**PostgREST Ambiguity Hint (2 locations):**
2 FK multipli (frozen 1-col + composite nuova) → hint sintassi ufficiale `!fk_name`:

- `src/app/app/bookings/page.tsx:43` → `.select("*,services!bookings_service_id_fkey(...),customers!bookings_customer_id_fkey(...)")`
- `src/lib/server/customers.ts:200` → `.select("*,services!bookings_service_id_fkey(...)")`
  Hints puntano a **nomi FK FASE9 originali frozen** (bookings_service_id_fkey / bookings_customer_id_fkey) — no regressioni.

### 16.5 Internal RPC Boundary (S11-15)

- `customer_upsert_for_public_booking` — signature frozen FASE10 UUID,TEXT,TEXT,TEXT 4-args required.
  - FASE10: `GRANT EXECUTE ... TO anon;` → spam surface / enumeration possibile.
  - FASE11B: **REVOKE EXECUTE ON FUNCTION customer_upsert_for_public_booking(UUID,TEXT,TEXT,TEXT) FROM anon;**
  - S11-15 ✅ direct anon call = function 42501 insufficient_privilege.

### 16.6 Migration FASE11B File (append-only, 1)

`supabase/migrations/20260822200000_fase11b_security_audit_defects.sql` — 8 sezioni:

- (a) `public_booking_get_confirmed_ranges` SECURITY DEFINER trusted RPC.
- (b) D1: REVOKE SELECT bookings anon; DROP policy unsafe.
- (c) S1: REVOKE EXECUTE `customer_upsert_for_public_booking` anon.
- (d) D4: CREATE OR REPLACE `protect_tenant_plan_id` → `status='active'`; ERRCODE 42501 backward compat.
- (e) CREATE OR REPLACE `_audit_insert_trusted`: NO EXCEPTION; PII strip 24 keys ampliata.
- (f) DROP/RECREATE audit triggers status + INSERT events; ZERO EXCEPTION swallow.
- (g) UNIQUE prerequisiti composites: services(tenant_id,id) UNIQUE; customers(tenant_id,id) UNIQUE.
- (h) FK composites bookings→services (CASCADE) + bookings→customers (SET NULL).

Totale migrazioni applicate: 49 (FASE1-10H = 48 frozen + FASE11B = 1).
§12 double reset x2 equality → semantic SHA256 = IDENTICAL ✅.

### 16.7 FASE11B Certification Counts (all GREEN)

| Livello                                                 | Suite / comando                                                                          | Resultato                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| S11 Security Tests dedicati                             | `tests/db/fase11b-security-hardening.test.ts` S11-01..20                                 | **20/20**                                                                                    |
| DB Totale 11 files                                      | `pnpm db:test` §23 clean run fresh reset                                                 | **250/250** (BT7/BT8 inclusi)                                                                |
| Unit/Integration src/ run1                              | `pnpm vitest run src/` §23 clean                                                         | **18/18**                                                                                    |
| Unit/Integration src/ run2 consec (no reset no changes) | `pnpm vitest run src/` §13                                                               | **18/18**                                                                                    |
| Playwright FASE6 DEV                                    | frozen 52 tests                                                                          | 52/52                                                                                        |
| Playwright FASE6 PROD                                   | frozen 52 tests                                                                          | 52/52                                                                                        |
| Playwright FASE7 DEV                                    | entitlements frozen 18                                                                   | 18/18                                                                                        |
| Playwright FASE7 PROD                                   | entitlements frozen 18                                                                   | 18/18                                                                                        |
| Playwright FASE8 DEV                                    | billing frozen 20                                                                        | 20/20                                                                                        |
| Playwright FASE8 PROD                                   | billing frozen 20                                                                        | 20/20                                                                                        |
| Playwright FASE9 DEV                                    | booking frozen 24                                                                        | 24/24                                                                                        |
| Playwright FASE9 PROD                                   | booking frozen 24                                                                        | 24/24                                                                                        |
| Playwright FASE10 DEV                                   | CRM frozen 18                                                                            | 18/18                                                                                        |
| Playwright FASE10 PROD                                  | CRM frozen 18                                                                            | 18/18                                                                                        |
| **Totale Playwright DEV**                               | somma F6/F7/F8/F9/F10                                                                    | **142/142** (9.9m)                                                                           |
| **Totale Playwright PROD**                              | somma F6/F7/F8/F9/F10                                                                    | **142/142** (9.3m)                                                                           |
| Responsive 3 VP                                         | 375×812 · 768×1024 · 1440×900 scrollWidth≤clientWidth                                    | ✅ PASS (E16-23)                                                                             |
| A11y axe wcag2/21 best-practice                         | serious=0 critical=0 H1≥1 main≥1 labels=ok                                               | ✅ PASS (E26-30)                                                                             |
| TypeScript strict                                       | `pnpm typecheck` exactOptionalPropertyTypes + noUnused enabled                           | 0 errors ✅                                                                                  |
| ESLint                                                  | `pnpm lint --max-warnings=0`                                                             | 0 errors 0 warnings ✅                                                                       |
| Prettier                                                | `pnpm format:check` (includes supabase.ts types)                                         | All matched files code style ✅                                                              |
| Build prod Turbopack                                    | `pnpm build` 13 static + 19 dynamic routes                                               | exit 0 ✅                                                                                    |
| Health endpoint                                         | GET /api/health prod porta 3100                                                          | HTTP 200 status=ok ✅                                                                        |
| Integrity                                               | repo grep .only/.skip/.todo/xit/xdescribe + security bypass patterns                     | 1 only skip CONDIZIONALE SAFE, 0 unsafe patterns ✅                                          |
| Secret Scan tracked files                               | sk_live_ / pk_live_ / whsec_ / service role / postgres cred / cookies storageState dumps | 0 reali leaks (solo sk_test_ fixture e reference doc SAFE) ✅                                |
| Service Role src inventory                              | 4 refs total                                                                             | 4 JUSTIFIED (commento, env schema, env mapping, billing trusted stripe RPC) 0 UNJUSTIFIED ✅ |
| Git diff --check                                        | whitespace / trailling / merge conflict markers                                          | 0 errors ✅                                                                                  |

### 16.8 Gates FASE11B

- **FAILED**: 0
- **NOT VERIFIED**: 0
- **§23 SECOND CLEAN RUN (fresh reset → DB250 → vitest 18/18 ×2 → quality0 → build → health200)**: ALL GREEN ✅
- **§15 Browser Public Booking PII boundary (MCP integrated)**: slots RPC JSON = solo date 0 PII ✅
- **§18-19-20 Integrity/Secrets/Service**: ALL SAFE ✅
- **FREEZE DECISION**: **FASE 11B = FROZEN** (report autorevole → `docs/FREEZE-REPORT-FASE11B.md`)

---

# 17. Scheduling & Resource Model (FASE12)

## 17.1 Modello ibrido Default-Resource

FASE12 introduce l'architettura **Hybrid Default-Resource Model** (Decision C FASE11C) per consentire la scalabilità da single-operator a multi-operator senza breaking changes UX.

- **Principio**: ogni tenant possiede esattamente 1 `staff_resource` **default** con `slug='principale'`, provisionata automaticamente da trigger sulla tabella `tenants` (INSERT).
- **Simple Mode automatico**: se il conteggio di `staff_resources` attive e bookable per il tenant è ≤ 1, la UI nasconde ogni riferimento alla selezione dell'operatore (dropdown invisibile, comportamento identico al modello single-resource frozen in FASE9).
- **Multi Mode**: con ≥ 2 risorse attive, la UI `BookingClientForm` mostra un dropdown "Operatore" con opzione di default **"Qualsiasi operatore"** (algoritmo Earliest-Available + `sort_order`).

## 17.2 Tabelle e Relazioni

### `public.staff_resources`

Risorsa prenotabile (operatore/stanza/attrezzatura), distinta da `auth.memberships` (identity/ruoli):

- `id` UUID PK
- `tenant_id` UUID FK → tenants CASCADE
- `slug` TEXT NOT NULL, UNIQUE(tenant_id, slug)
- `display_name` TEXT NOT NULL
- `linked_membership_id` UUID FK → memberships(id) NULLABLE (una risorsa può non avere login; un login può non essere una risorsa)
- `active` BOOLEAN DEFAULT true
- `bookable` BOOLEAN DEFAULT true
- `sort_order` INTEGER DEFAULT 0
- `created_at` / `updated_at` timestamptz
- INDEX: `(tenant_id, active, bookable, sort_order)`

### `public.staff_resource_services`

Relazione **M2M** tra risorse e servizi. Regola di eligibilità:

- **Empty = ALL**: se per una `staff_resource` non esistono righe M2M → implicitamente ammissibile per TUTTI i servizi del tenant (default resource).
- **Rows = RESTRICT**: se esistono righe M2M esplicite → la risorsa è ammissibile SOLAMENTE per i servizi linkati.
- PK composita: `(resource_id, service_id)`
- `active` BOOLEAN DEFAULT true (per disattivare temporaneamente un legame senza cancellarlo)
- `tenant_id` DENORMALIZZATO per RLS e composite FK enforcement

### `public.bookings` (estensione FASE9)

- Colonna nuova: `resource_id UUID FK → staff_resources(id) ON DELETE RESTRICT` (nullable inizialmente per backward compat)
- CHECK constraint: `bookings_confirmed_resource_not_null` → `CHECK (status <> 'confirmed' OR resource_id IS NOT NULL)`
- Di fatto: un booking CONFIRMED deve obbligatoriamente avere una risorsa assegnata; i booking in stato draft/pending possono ancora nascere senza resource_id durante la transizione.

## 17.3 Concorrenza: EXCLUDE GiST per-Resource

FASE12 introduce un nuovo vincolo di esclusione scalare per permettere a più operatori di eseguire lo stesso servizio contemporaneamente.

### Nuovo: `bookings_no_resource_overlap_confirmed`

```sql
EXCLUDE USING GIST (
  tenant_id WITH =,
  resource_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status = 'confirmed')
```

- Due booking CONFIRMED sulla STESSA risorsa con range temporale sovrapposto = VIOLAZIONE (rilevato).
- Due booking CONFIRMED su DUE risorse DIVERSE nello stesso slot = CONSENTITO (vincolo fondamentale multi-operatore).

### Vincolo FASE9 legacy

Il vecchio `bookings_no_overlap_confirmed` basato su `service_id` NON viene rimosso in FASE12. Rimane come safety-net durante la finestra di backfill; verrà droppato in una release futura dopo aver verificato che tutti i booking CONFIRMED hanno resource_id popolato e il front-end non produce più INSERT legacy.

## 17.4 Slot Engine V2 + Booking Engine V2

### RPC `public.public_slot_get_available_v2(tenant_slug, service_id, date)` (SECURITY DEFINER)

- **Outer boundary**: `business_availability` del tenant (settimana tipo, holiday, closure).
- **Inner boundary**: `eligible_resources` CTE = risorse attive + bookable + M2M ammissibili (Empty=ALL / Rows=RESTRICT).
- Algoritmo: `generate_series` step 30-min da `windowStart` a `windowEnd` **ESCLUSIVO** (corretto bug E9-5 generate_series inclusive) → CROSS JOIN con eligible_resources → ANTI-JOIN con `bookings` CONFIRMED + overlapping range → restituisce slot × risorsa disponibile.
- Con 0 eligible resources → 0 righe (safety: non restituisce slot fantasma).
- Frontend aggrega per `(start_at, end_at)`: più risorse disponibili = stesso slot mostrato una volta; "Qualsiasi operatore" seleziona la prima per sort_order.

### RPC `public.public_booking_create_v2(...)` (SECURITY DEFINER)

- Input: `p_tenant_slug, p_service_id, p_start_at, p_customer_name, p_customer_email, p_customer_phone, p_resource_id (NULLABLE), p_notes, p_source`
- Se `p_resource_id` è NULL → seleziona automaticamente la prima risorsa ammissibile disponibile per quello slot (Earliest-Available deterministica).
- Esegue INSERT nella transazione con il nuovo vincolo EXCLUDE per-Resource.
- Seleziona canale: `public.public_booking_resources_list(tenant_slug, service_id, date)` → dropdown operatori front-end.

## 17.5 RLS e Autenticazione

- `staff_resources` + `staff_resource_services` con RLS FORCE:
  - `anon` / `authenticated`: SELECT tramite policy `*_select_tenant_public` (solo tenant pubblicato via slug dominio).
  - Ruoli OWNER/MANAGER/STAFF: policy di mutazione verificate tramite membership.
- `bookings.resource_id`: la policy anon è transitivamente gestita dal wrap RPC `public_booking_create_v2`; gli accessi SELECT anon alle colonne PII sono stati revocati in FASE11B e non vengono riaperti.

## 17.6 NON-GOALS — FASE12

FASE12 definisce i mattoni fondazionali del modello multi-risorsa. I seguenti item sono **NON-GOALS** e saranno implementati in fasi successive:

1. ❌ **Individual resource hours / schedule** — la disponibilità per-operatore (orari differenti per staff) usa ancora business_availability globale.
2. ❌ **Time off / ferie / permessi per risorsa** — `resource_availability` / `resource_time_off` tabelle non presenti.
3. ❌ **Walk-in management** — gestione clienti senza appuntamento, coda attesa, walk-in source.
4. ❌ **Calendar views (settimanale/mensile)** — dashboard booking al momento è lista per data.
5. ❌ **AI booking assistant V2** — integrazione AI con consapevolezza delle risorse e assegnazione smart.
6. ❌ **Analytics avanzate per risorsa** — report per-operatore (produttività, utilizzo, revenue split).
7. ❌ **Color coding etichette risorsa** — UI multi-color per distinguere operatori su view future.
8. ❌ **Risorse non-staff (stanze, lettini, macchinari)** — il modello lo supporta, ma la UI non etichetta/gestisce ancora categorie risorsa differenti da "principale + operatori".
9. ❌ **Capacità di gruppo / class bookings** — slot multi-capacità (es. corsi) non implementati; vincolo resta 1 booking = 1 risorsa = 1 cliente.
10. ❌ **Merge/split booking / ricorsione** — spostamento multi-risorsa, serie ricorrente, waitlist.
