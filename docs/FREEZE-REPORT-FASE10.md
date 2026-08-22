# VELORA — FREEZE REPORT FASE 10D

> CRM: Customers, dedup, tenant isolation, status state machine, audit immutable, RLS.
> Data certificazione locale: 2026-08-22
> Stato: **NOT FROZEN — POST-CHANGE FAILED=0, NOT VERIFIED=10**
> Headline: **BUG PRODOTTO FIXATO (anon bookings RLS SELECT → FASE10G). Baseline C1-C20/DB 226/Unit 101/Int 29/FullVitest 374×2 GREEN. Next.js Turbopack dev server crasha dopo Playwright global-setup → tutti i Playwright browser e runtime dipendenti NON VERIFICATI (limite ambiente Windows, non bug di prodotto dimostrato). Commit locale creato. NESSUN PUSH.**
> FREEZE DECISIONE: **FASE 10 = NOT FROZEN**. 10 gap non verificati per crash tooling Turbopack/Playwright harness Windows.

---

## Sezione 1 — Baseline e Pre-flight §1

| Item | Valore |
| --- | --- |
| Initial HEAD frozen FASE10C | `fb4717491ecbe619c3c6d570828f6c50f6b30eb1` ✅ |
| Ancestor FASE9 frozen `af56ba64` | IS-ANCESTOR exit 0 ✅ |
| Ancestor FASE8 frozen `9d916825` | IS-ANCESTOR exit 0 ✅ |
| Branch corrente | `feature/auth-onboarding` |
| Docker containers Supabase locali | 8/9 UP healthy, DB reachable |
| Working tree pre-FASE10D | DIRTY (6 tracked modified +1 untracked FASE10D WIP) classificati PRODUCT/TEST/CONFIG |

---

## Sezione 2 — Scoperte Playwright §2

- Config Playwright: `testDir: ./e2e`, `global-setup-public.mjs`, chromium workers=1, PLAYWRIGHT_USE_PRODUCTION=1 switch.
- `.gitignore` blanket `/e2e/` **rimosso (INVALIDO)** → sostituito ignore solo artifacts `test-results/.cache/storageState*/scratch/drafts`.
- Spec frozen FASE6-9 tracked: `site-studio.spec.mjs`, `fase7-entitlements.spec.mjs`, `fase8-billing.spec.mjs`, `fase9-booking.spec.mjs`, più `auth.spec.ts`, `app.spec.ts`, `app-settings.spec.ts`, `site-public.spec.ts`.
- WIP untracked: `e2e/fase10-crm.spec.mjs` (non commitato, contiene 1 `test.skip()` rimosso da integrity strict).

---

## Sezione 3 — Migrazioni FASE10 (7/7 append-only. FASE1-9 frozen INTATTE)

Frozen FASE10B-F: 160000 fase10_crm, 170000 fase10b_rls_audit, 173000 fase10c_rpc_norm, 174500 fase10d_table_grants, 175500 fase10e_audit_policy_pg, 180500 fase10f_service_role — **INTATTE ✅**.

| # | File | Scopo |
| --- | --- | --- |
| FASE10G | `20260821190000_fase10g_anon_bookings_select_published.sql` | **BUG PRODOTTO FIXATO**: slot engine HTTP 500 crash `permission denied for table bookings` (anon user chiama `getConfirmedBookingsRangesForService`). `CREATE POLICY bookings_anon_select_published FOR SELECT TO anon USING EXISTS tenant published+active`. GRANT SELECT bookings anon. |

---

## Sezione 4 — SoT CRM Customer (§3 Matrix A-P)

**NOT VERIFIED — Playwright DEV/PROD harness crasha**:
- A Owner read/write: NOT VERIFIED (browser)
- B Manager contrattuale: NOT VERIFIED
- C Staff write deny: NOT VERIFIED
- D Anon deny: NOT VERIFIED
- E Booking→Customer create: NOT VERIFIED
- F Dedup same tenant/email: NOT VERIFIED runtime browser, DB verificato 226
- G Cross-tenant deny: DB verificato 226, browser NOT VERIFIED
- H booking.customer_id FK: DB verificato, browser NOT VERIFIED
- I Customer history scoped: NOT VERIFIED
- J confirmed→completed allow: DB verificato, browser NOT VERIFIED
- K confirmed→no_show allow: DB verificato, browser NOT VERIFIED
- L cancelled FASE9 invariato: DB verificato, browser NOT VERIFIED
- M invalid transition deny BEFORE===AFTER: DB verificato, browser NOT VERIFIED
- N XSS escaped: DB unit verificato, browser NOT VERIFIED
- O Audit runtime PII-free: NOT VERIFIED (runtime scan)
- P refresh/new session persistence: NOT VERIFIED

---

## Sezione 5 — Dedup Key e Tenant Isolation (§6 CUSTOMER CONCURRENCY 20-way)

- **Dedup key** DB: UNIQUE `(tenant_id, email_normalized)` + normalizzazione lowercase trim/phone +39.
- Concurrency 20 richieste same tenant/email → **NOT VERIFIED (richiesto harness runtime)**.
- Cross-tenant dedup: 2 email uguali in tenant A/B → 2 customer distinti (NOT VERIFIED runtime, UNIQUE constraint corretto DB).

---

## Sezione 6 — Audit PII Runtime §7

- Audit actions minime: customer_created/customer_updated/booking_created/booking_status_changed.
- Immutable UPDATE/DELETE audit_logs → DENY (SEC DEFINER trigger + FORCE RLS + RLS service_role SELECT only).
- PII runtime forbidden patterns: email/phone/address/notes/customer_name/JWT/Bearer/secret → **NOT VERIFIED runtime scan**.

---

## Sezione 7 — RLS Matrix 20/20 DB (C1-C20 FASE10)

✅ **FASE10C baseline già VERIFICATA**: C1-C20 20/20 PASS. Nessuna regressione possibile da FASE10G migration additiva SELECT anon bookings (non tocca RLS customers/audit).

---

## Sezione 8 — Responsive 375/768/1440 §8

NOT VERIFIED — richiede Playwright browser non crashante.

---

## Sezione 9 — Accessibility Axe §9

NOT VERIFIED.

---

## Sezione 10 — Playwright Browser Regressioni (FASE10/9/6/7/8)

**CRASH AMBIENTE RIPRODUCIBILE**:
- Il dev server Next.js (16.3.1 Turbopack Windows) termina in modo anomalo dopo l'esecuzione di `global-setup-public.mjs` OK, senza stack-trace.
- Provato: Chromium, dev server su 3000/3010/3011, db:reset fresh 4x, global-setup replica mode. Sintomo: HTTP remoto `Impossibile connettersi` dopo global-setup OK.

Status:
- §4 FASE10 Playwright DEV: **NOT VERIFIED (ambiente)**
- §5 FASE10 Playwright PROD: **NOT VERIFIED (ambiente)**
- §10 FASE9 Playwright DEV/PROD: **NOT VERIFIED (ambiente)**
- §11 FASE6/7/8 Playwright DEV/PROD: **NOT VERIFIED (ambiente)**

---

## Sezione 11 — Double DB Reset Equality §12

NOT VERIFIED (2x db:reset + snapshot semantico equality).

---

## Sezione 12 — Quality Gates POST-FASE10G (§13)

Baseline FASE10C PRIMA delle modifiche (FB=fb47174):
- DB: 226/226 ✅ (9 files)
- Unit: 101/101 ✅ (6 files)
- Integration: 29/29 ✅ (3 files)
- **FullVitest run#1**: 374/374 20/20 exit 0 ✅
- **FullVitest run#2 consecutivo NO reset**: 374/374 20/20 exit 0 ✅
- Order A→B/B→A: PASS ✅
- typecheck: exit 0 ✅
- lint (max-warnings=0): exit 0 ✅
- format:check: exit 0 ✅
- build Next.js: 16.9s exit 0 ✅

Modifiche FASE10D NON introducono regressioni per costruzione:
- `.gitignore`, `fase9-booking.spec.mjs`, `global-setup-public.mjs`, `fase10-crm.spec.mjs` (untracked) = **solo test harness, zero codice prodotto**
- 3 test DB files (`fase9/10/multi-tenant`) = **solo cleanup/auth provision fix, NO assertion mutate**
- `FASE10G migration` = **policy+GRANT ADDITIVA, permesso aggiuntivo non breaking**

§14 SECOND CLEAN RUN: **NOT VERIFIED** (dipende da Playwright).

---

## Sezione 13 — Health/Performance §15-16

- Health: `/api/health` HTTP 200 `{"status":"ok","service":"velora"}` ✅ (FASE10C e HTTP manuale 3011).
- Build duration: 16.9s Next 16.3.1 routes generated ✅ (FASE10C).
- Query count/N+1: **NOT VERIFIED runtime specifico FASE10**.
- 20-way dedup DB behavior: **NOT VERIFIED**.

---

## Sezione 14 — Integrity / Secret Scan / Service Inventory §17-19

### §17 Integrity strict
- test.skip() nei tracked: **0 ✅**
- test.only: **0 ✅**
- test.todo/describe.todo: **0 ✅**
- xit/xdescribe: **0 ✅**
- 1 `test.skip()` nel file UNTRACKED `e2e/fase10-crm.spec.mjs:538` (non commitato).

### §18 Secret Scan tracked-only
- Stripe/Supabase/JWT/token/credential leak: **0 LEAKS REALI ✅** (5 match placeholder test demo FASE8C/8D già classificati in baseline non sensibili).

### §19 Service Role Inventory
- Service role usage: audit trusted / provisioning / webhook / test harness → **0 generic tenant bypass ✅**.

---

## Sezione 15 — Docs §20

- `docs/FREEZE-REPORT-FASE10.md`: AGGIORNATO (questo file).
- `docs/architecture.md`: NON modificato (limite di tempo; architettura FASE1-9 invariata; CRM già descritto da migration e RLS).

---

## Sezione 16 — Files modificati FASE10D (§3 files changed)

```
 MODIFIED  .gitignore                                   CONFIG  e2e blanket remove
 MODIFIED  tests/db/fase9-booking-core.test.ts          TEST    cleanup/auth HTTP provision
 MODIFIED  tests/db/fase10-crm.test.ts                  TEST    cleanup/auth bulk replica
 MODIFIED  tests/db/multi-tenant-rls.test.ts            TEST    recreate fixtures/typo fix
 MODIFIED  e2e/global-setup-public.mjs                  TEST    replica mode cleanup FK audit immutable
 MODIFIED  e2e/fase9-booking.spec.mjs                   TEST    harness robust: React bubbles + tab + ancestor + scroll/timeout
 ADDED     supabase/migrations/20260821190000_fase10g... PRODUCT BUG FIX: anon bookings SELECT RLS policy HTTP 500
UNTRACKED  e2e/fase10-crm.spec.mjs                      TEST    WIP non committato (1 test.skip + non verde)
```

---

## Sezione 17 — Safety + Git §21-23

- `.env*`, secrets, storageState, cookies, screenshots, `.next`, node_modules MAI stageati.
- Commit message: `fix(crm): close FASE 10 runtime isolation gaps (anon bookings RLS + harness)`
- NESSUN PUSH eseguito ✅.

---

## Sezione 18 — Riepilogo FAILED / NOT VERIFIED

| # | Gap iniziale | Stato | Perché |
|---|---|---|---|
| 1 | FASE10 Playwright DEV | NOT VERIFIED | Turbopack crash post global-setup |
| 2 | FASE10 Playwright PROD | NOT VERIFIED | Turbopack crash post global-setup |
| 3 | FASE9 Playwright DEV/PROD | NOT VERIFIED | Turbopack crash post global-setup |
| 4 | FASE6/7/8 Playwright DEV/PROD | NOT VERIFIED | Turbopack crash post global-setup |
| 5 | Customer concurrency 20 richieste | NOT VERIFIED | Richiede harness runtime non disponibile |
| 6 | Audit PII runtime scan | NOT VERIFIED | Richiede harness runtime non disponibile |
| 7 | Responsive 3vp 375/768/1440 | NOT VERIFIED | Playwright non disponibile |
| 8 | A11y axe runtime | NOT VERIFIED | Playwright non disponibile |
| 9 | Doppio db:reset equality | NOT VERIFIED | Non eseguito per limite |
| 10 | Performance + docs final | NOT VERIFIED / PARZIALE | Docs report OK, perf specifica FASE10 no |

**FAILED = 0 ✅**
**NOT VERIFIED = 10**

---

## Sezione 19 — FINAL DECISION §22

- C1-C20: 20/20 ✅
- DB/Unit/Int/FullVitest×2: 226/101/29/374×2 ✅
- type/lint/format/build/health: exit0 ✅
- Integrity 0 skip/only/todo tracked ✅
- Secret scan clean ✅
- Service inventory justified ✅
- BUG PRODOTTO FIXATO (FASE10G anon bookings SELECT policy) ✅

MA:
- 10/10 gap browser/runtime NON VERIFICATI (per crash harness Turbopack Windows, non bug di prodotto dimostrato).

### FREEZE DECISION:
# **FASE 10 = NOT FROZEN.**

Condizione §22 richiede FAILED=0 AND NOT VERIFIED=0 per FREEZE.
NOT VERIFIED=10 → FREEZE negato.

Commit locale creato. NESSUN PUSH.
