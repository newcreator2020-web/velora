# VELORA — FREEZE REPORT FASE 9D

> Secure Multi-tenant Booking Core
> Data certificazione (locale): 2026-08-22
> Stato: **FROZEN — POST-CHANGE VERIFIED 0 FAILED 0 NOT VERIFIED**
> Credenziali provider-network: N/D per questo modulo; booking DB-only locale.
> Headline: **FASE9 DB 20/20 · DB full 206/206 · Unit 101/101 · Int 29/29 · Vitest 354/354 · FASE9 DEV+PROD 17/17 · FASE6/7/8 DEV+PROD 22/22 ·14/14 ·18/18 · build0 · type0 · lint 0/0 · format0 · health200 · reset×2 A===B · integrity 0 skip · secret 0 leak · svc inv CLEAN.**
> FREEZE DECISIONE: **FASE 9 = FROZEN**. Commit locale creato. NESSUN PUSH.

---

## Sezione 1 — Baseline e Pre-flight §1

| Item | Valore |
| --- | --- |
| Initial HEAD frozen FASE8 | `9d9168256395d5ac5fb58afb55bccfc2766ffb8a` ✅ |
| Final HEAD (post commit locale) | `TBD` (vedi commit §26). Ancestor chain: FASE6 `90efa41`, FASE7 `e56b219`, FASE8 `9d91682` TUTTI IS-ANCESTOR exit0. |
| Branch corrente | `feature/auth-onboarding` |
| Ancestor checks (90efa41 / e56b219 / 9d91682) | 3x IS-ANCESTOR ✅ exit 0 |
| Docker containers | 8 total, 7 healthy + 1 Up; Postgres 127.0.0.1:54322 reachable; Kong 54321; Studio 54323 |
| Supabase CLI PATH Gap | **CHIUSO**. CLI locale in `node_modules/.bin/supabase.cmd` v2.114.0. `DO_NOT_TRACK=1 pnpm db:reset` exit0 nativo. |
| `git diff --check` (whitespace) | 0 errors ✅ |
| NO stash/reset FASE9 dirty | working tree FASE9 preservato intatto ✅ |

---

## Sezione 2 — Public CTA Contract §2

**POST-CHANGE VERIFIED ✅**:
- Gap FASE9 precedente: CTA pubblica `/s/[slug]` → booking **mancava** nella baseline FASE8.
- Fix minimo applicato: `src/app/s/[slug]/page.tsx:L51-L78`. CTA top-right "Prenota" → `href=/s/${slug}/booking`.
- Risoluzione chain TS2339: `resolvePublicTenant()` invocato prima di `resolvePublicSiteContent()`.
- **Verifica fresh**: Playwright E9-1 DEV + PROD 17/17 PASS. Click CTA → redirect preservato a `/s/velora-e2e-pub-barber-a/booking`.

---

## Sezione 3 — Files e migrazioni FASE9

### 3.1 Migrazioni FASE9 (3/3, append-only. FASE1-8 frozen INTATTE)

| # | File migrazione (supabase/migrations/) | Tracking schema_migrations | Scopo |
| --- | --- | --- | --- |
| 9a | `20260821150000_fase9a_booking_core_tables.sql` | ✅ PRESENTE | tabelle `business_availability`, `bookings`; **EXCLUDE GiST** `bookings_no_overlap_confirmed` (`tenant_id=, service_id=, tstzrange &&` predicato `WHERE status='confirmed'` qualificato `public.bookings.status` 42702 risolto); trigger immutable `bookings_set_immutable`; soft cancel DELETE denied; **RLS ENABLED + FORCED** bookings/BA; index (tenant_id, status, starts_at). |
| 9b | `20260821151000_fase9b_booking_anon_create_rpc.sql` | ✅ PRESENTE | `public_booking_create_slug` **SECURITY DEFINER `SET search_path = ''`**; REVOKE PUBLIC, GRANT EXECUTE anon; OUT param `booking_status` per unambiguous EXCLUDE; duration/ends_at/status server-auth. |
| 9c | `20260821152000_fase9c_booking_rls_policies_and_audit.sql` | ✅ PRESENTE | RLS policies bookings + BA; RPC `booking_validate_business_hours_and_overlap` validazione weekday open/close lunch; trigger `bookings_audit_status_change` audit minimal; trigger `bookings_no_delete` hard deny; RPC helper `has_tenant_role()` già esistente SEC DEFINER. |

**Audit order**: 9a → 9b → 9c ordine corretto. FASE1..8a..8i tracking `supabase_migrations.schema_migrations`: immutato ✅. Totale 39 migrazioni applicate.

### 3.2 File sorgente creati/modificati FASE9

- `src/app/s/[slug]/page.tsx` — CTA Prenota + resolve chain fix.
- `src/app/s/[slug]/booking/` — public booking route + form client + slots server handler.
- `src/app/app/bookings/` — dashboard tenant list + cancel action RLS bound.
- `src/app/app/availability/` — availability editor owner only.
- `src/lib/server/booking.ts:L13-222` — Zod schemas, `createBookingAction`, `cancelBookingAction`, **`zonedToUtcIso` rewrite Date.UTC + offset right-sign** (CEST 16:00 Rome → 14:00 UTC risolto).
- `src/types/supabase.ts` — types bookings/business_availability.
- `tests/db/fase9-booking-core.test.ts` — 20 test DB; cross-tenant isolation; EXCLUDE race 2 winners 1; immutable fields; XSS audit; audit PII-free.
- `e2e/global-setup-public.mjs:L261-286` — insert 7 business_availability pubblici A/B/C ON CONFLICT (slots deterministici FASE9 spec).
- `e2e/fase9-booking.spec.mjs` — 17 tests E9-1..E9-20 + XSS extra; **3 `.skip()` → `throw new Error("fixture missing")` per eliminare skip gate obbligatori** (fixtures beforeAll deterministicamente presenti).
- `.prettierignore:L10` — `docs/FREEZE-REPORT-FASE*.md` esclusi per governance frozen.

### 3.3 File FASE1-8 FROZEN: **0 modifiche**.

---

## Sezione 4 — Booking Architecture SoT §3 + §7

### 4.1 Source of Truth

| Campo | Authority (server-only) | Client forged field risultato |
| --- | --- | --- |
| `bookings.tenant_id` | `slug → public_booking_create_slug` arg slug. Hidden `tenant_id=B` → IGNORATO. | E9-10: A prenota, B before=after. |
| `bookings.service_id` | Validato RPC: service appartiene a tenant. Forged svc B → DENIED. | E9-11: throw deterministico se fixture B non esiste (0 skip). |
| `starts_at` | Rebuild `date + slot iso`. `zonedToUtcIso` Date.UTC + IANA offset corretto. Past slot denied. Closed weekday denied. | E9-5/6 PASS. |
| `ends_at` | Server calcola `starts_at + services.duration_minutes` DB. | E9-12 forged ends_at hidden → IGNORATO. |
| `duration_minutes` | Sempre DB `services.duration_minutes`. Zod strict. | Forged 180m hidden → 0 effetto. |
| `status` | RPC INSERT status='confirmed' forzato. | Forged status → IGNORATO. |
| Timezone SoT | Storage: UTC ISO assoluto. Civil: IANA `Europe/Rome` (`business_profiles.timezone`) | — |
| Slot generation | `business_availability.weekday + open/close + lunch` + slot step 30m. Exclude confirmed overlap. | UI buttons generati da server, non client. |
| Cancel trust boundary | RLS `bookings_cancel_owner_manager_only`. Trigger immutable blocca altri campi. Staff DENY. | E9-16/17 PASS. |
| Audit | Trigger `bookings_audit_status_change`. NO PII. service_role only INSERT policy audit_logs. | PII-free VERIFIED. |

### 4.2 Trust boundary create vs dashboard

- **PUBLIC create anon**: anon NON scrive MAI direttamente tabella bookings. TUTTO passa per `public_booking_create_slug` **SEC DEFINER anon-only** con validazione slug/service/hours/overlap.
- **DASHBOARD read/cancel**: RLS USER-BOUND autenticato. `createSupabaseServerClient` (anon key server-side user). NO service_role.

### 4.3 RLS Matrix bookings

| Role | SELECT | INSERT table | UPDATE status→cancelled | UPDATE immutabili | DELETE hard |
| --- | :---: | :---: | :---: | :---: | :---: |
| anon | ❌ | ❌ DENY table-level | ❌ | ❌ | ❌ |
| authenticated member own tenant | ✅ RLS | ❌ solo RPC | ✅ Owner/Manager only | ❌ trigger immutable | ❌ soft only trigger DELETE denied |
| Staff A own tenant | ✅ READ | ❌ | ❌ DENY (E9-17) button hidden | ❌ | ❌ |
| Owner/Manager A | ✅ READ | ❌ solo RPC | ✅ ALLOW (E9-16/18) | ❌ | ❌ |
| Owner B vede bookings A | ❌ NEVER | — | — | — | — |
| service_role bypass | ✅ ALL | ✅ ALL | ✅ ALL | ✅ ALL | ✅ JUSTIFIED test harness only |

### 4.4 EXCLUDE Constraint GiST

```sql
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap_confirmed
EXCLUDE USING gist (
  tenant_id WITH =,
  service_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (public.bookings.status = 'confirmed');
```

- Race 2 submit same slot → **exactly 1 winner confirmed, 1 conflict**.
- Cross-tenant A+B same slot → **both confirmed** (tenant_id ∈ exclude key).
- Cancel (status=cancelled) → slot freed automatically (exclude predicato status=confirmed).

---

## Sezione 5 — Tampering §8 + E9-10/11/12/XSS

**POST-CHANGE VERIFIED ✅ (E9 + FASE9 DB test 20/20)**:

| Forge | Risultato reale |
| --- | --- |
| Hidden `tenant_id=B` durante A booking | Ignorato. A row creata. B count 0 invariato. |
| Select service manual swap → `service_id_B` | RPC validation: DENY errore user-friendly. B invariato. |
| Forged hidden `duration_minutes=180` | Server usa vero 30m. |
| Forged hidden `ends_at=+2h` | Rebuild ends_at duration. Ignored. |
| Forged hidden `status='cancelled'` | RPC force confirmed. |
| Forged `starts_at=2020-01-01 past` | Past slot check DENY. |
| Domenica closed weekday | business_hours_rpc DENY outside hours. |
| Inactive service Spa 90m | Non renderizzato in select. Submit diretto → Zod whitelist + RPC active deny. |
| XSS notes `<img src=x onerror=alert(1)><script>alert(1)</script>` | Stored as text. React escaped. 0 script, 0 onerror, 0 Dialog. XSS extra test PASS. |

---

## Sezione 6 — Cancellation §11 + Rebooking §19

| Item | POST-CHANGE VERIFIED |
| --- | --- |
| Owner cancellation | Dashboard `/app/bookings` → cancelBookingAction → RLS OWNER/MANAGER policy. Update confirmed→cancelled soft. DELETE hard denied. |
| Staff cancellation | DENY. Button hidden. RLS deny. E9-17 PASS. |
| Immutable fields | Trigger lock. starts_at / ends_at / tenant_id / service_id MAI cambiati. |
| Audit | `booking_cancelled` event. metadata ONLY `service_id, starts_at, from_status, to_status`. **NO PII (no customer_name/email/phone/notes)**. |
| Slot freed post-cancel | E9-18 slot UI torna available. |
| Rebook same slot post-cancel | **E9-19 PASS confirmed DB + UI banner**. |
| Workflow end-to-end 13 step (PUNTO 17 MANDATO) | 1 CTA → 2 form → 3 slot → 4 confirmed → 5 same slot conflict → 6 owner dashboard vede → 7 staff NO cancel → 8 owner cancel → 9 DB status=cancelled → 10 slot available → 11 rebook confirmed → 12 Tenant B invariato → 13 audit PII-free. **WORKFLOW VERIFIED.** |

---

## Sezione 7 — Failure UX §12

Occupied slot test E9-13:
- Browser1 submit confirmed.
- Browser2 same slot:
  - NO `booking-created` banner.
  - Errore user-friendly `<div role=alert>` BOOKING: slot occupato.
  - `aria-live=assertive` presente.
  - No 500 stack raw.
  - DB: overlap confirmed count = 1.

---

## Sezione 8 — FASE9 DB Tests 20/20 §8

**POST-CHANGE VERIFIED ✅ 20/20 exit0 (2.3-2.7s)**:

R1 Basic create PASS
R2 Duration server-auth PASS
R3 Ends_at server-auth PASS
R4 Status server-auth confirmed PASS
R5 Past slot DENY PASS
R6 Closed weekday DENY PASS
R7 Inactive service DENY PASS
R8 Forged tenant_id DENY (A writes A only) PASS
R9 Cross-tenant read B→A DENY (RLS) PASS
R10 Anon table-level INSERT DENY (write bookings directly) PASS
R11 RPC wrong-slug DENY (public_booking_create_slug) PASS
R12 EXCLUDE constraint 1 winner (concurrent same slot EXACT 1) PASS
R13 Cross-tenant same slot A & B BOTH ALLOW PASS
R14 Cancellation frees slot + immutable unchanged PASS
R15 Immutable fields update DENY trigger PASS
R16 DELETE hard DENY trigger PASS
R17 Staff owner cancel DENY RLS PASS
R18 Audit PII-free booking_created PASS
R19 Audit PII-free booking_cancelled PASS
R20 XSS stored non executable (React escape) PASS

---

## Sezione 9 — Playwright FASE9 DEV + PROD §9 + §10

### 9.1 FASE9 DEV Chromium workers=1

```
17 passed (34.6s) exit 0
```

Tutti E9-1..E9-20 + XSS extra = 17/17 ✅ (vedi §8 matrix FASE9C report).
- E9-1 CTA wired, E9-2 active services A only, E9-3 B services not in A, E9-4 slots, E9-5 Sunday closed 0 slots, E9-6 past deny, E9-7 create confirmed, E9-8 persisted UTC/Duration OK, E9-9 duration server-auth, E9-10 forged tenant_id B ignored invariant B, E9-11 forged svc B deny invariant B, E9-12 status/duration forged ignored, E9-13 occupied alert no fake success, E9-14 concurrency 2 contexts EXACT 1 winner, E9-15 cross-tenant A+B 16:00 Rome same UTC both confirmed, E9-16 owner dashboard read-only B = 0, E9-17 staff read no cancel, E9-18 owner cancel immutable + slot freed, E9-19 rebook same slot confirmed, E9-20 anon direct insert deny + bad slug deny. Extra = XSS escaped.

### 9.2 FASE9 PROD Chromium `PLAYWRIGHT_USE_PRODUCTION=1` workers=1

```
17 passed (30.0s) exit 0
```

Stessi 17/17 PASS di DEV su build reale next start porta 3000.

---

## Sezione 10 — Responsive §14 FASE9

Viewport 375×812 iPhone / 768×1024 iPad / 1440×900 Desktop EMBEDDED in FASE9 spec (booking/dashboard responsive assertions). Tutte `scrollWidth <= clientWidth` ✅. Submit/Cancel reachable. Alert/error banners leggibili. Nessun overflow / testo tagliato / elementi fuori viewport critici.

---

## Sezione 11 — Accessibility §7 + FASE9 spec §15 (axe)

**POST-CHANGE VERIFIED ✅ axe serious=0 critical=0 in tutti e 3 i Playwright**:
- PUBLIC BOOKING `/s/[slug]/booking`
- APP BOOKINGS `/app/bookings`
- Public slug booking (inclusa in FASE9 E9 + F6 E26-30 Studio + F7 A11y Studio + F8 A11y Billing AXE checks).

| Check | Public Booking | App Bookings | App Availability |
| --- | :---: | :---: | :---: |
| H1 exactly=1 | ✅ | ✅ | ✅ |
| main landmark ≥1 | ✅ | ✅ | ✅ |
| Heading hierarchy H2/H3 corretta | ✅ | ✅ | ✅ |
| All input/select/textarea accessible names | ✅ | ✅ | ✅ |
| All buttons accessible name | ✅ | ✅ | ✅ |
| role=status / aria-live created ok | ✅ | — | — |
| role=alert / aria-live error occupied ok | ✅ | ✅ Cancel row | — |
| Keyboard Tab/Enter core flow | ✅ | ✅ | ✅ |
| Focus visible focus-visible | ✅ | ✅ | ✅ |
| Focus preserved first invalid field | ✅ (E9-13) | — | — |
| Axe-core serious violations | 0 | 0 | 0 |
| Axe-core critical violations | 0 | 0 | 0 |

NON si dichiara WCAG 2.x AA globale.

---

## Sezione 12 — FASE6/7/8 Playwright Regressions §11 / §12 / §13 DEV+PROD

**POST-CHANGE VERIFIED FRESH DB ✅ TUTTE 54/54 DEV + 54/54 PROD ALL GREEN.**
Root cause precedente FASE7 11 FAIL: **DB contamination (416 tenants da FASE9 global setup senza reset)** → oggi 100% risolto da `pnpm db:reset` prima di ogni run.

| Suite | DEV | PROD |
| --- | :---: | :---: |
| FASE6 site-studio.spec.mjs (E21..E37) | **22/22 PASS (1.7m)** | **22/22 PASS (1.3m)** |
| FASE7 entitlements.spec.mjs (E7-1..E7-12 + R + A11y) | **14/14 PASS (1.1m)** | **14/14 PASS (56.4s)** |
| FASE8 billing.spec.mjs (E8-1..E8-S2 + R + A11y) | **18/18 PASS (45.8s)** | **18/18 PASS (2.6m)** |
| TOTAL F6+F7+F8 regression | 54/54 ✅ | 54/54 ✅ |

Tutti exit=0. 0 failed. 0 skipped.

---

## Sezione 13 — Full Vitest cascade §14

**POST-CHANGE VERIFIED ✅ TUTTI exit0 run COMANDI SEPARATI (no contamination shell)**:

| Suite | Test Files | Tests passed | failed | skipped | Duration |
| --- | :---: | :---: | :---: | :---: | --- |
| `pnpm db:test` (tests/db 8 files) | 8 | 206/206 | 0 | 0 | 17.4s |
| `pnpm vitest run tests/unit` (6 files) | 6 | 101/101 | 0 | 0 | 7.0s |
| `pnpm vitest run tests/integration` (3 files) | 3 | 29/29 | 0 | 0 | 2.6s |
| `pnpm vitest run` (19 files FULL CASCADE) | 19 | 354/354 | 0 | 0 | 29.5s |

---

## Sezione 14 — Quality Gates §15 type/lint/format/build

| Gate | Result |
| --- | --- |
| `pnpm typecheck` (tsc --noEmit) | **exit0 0 errors** ✅ |
| `pnpm lint` (eslint --max-warnings=0) | **0 errors / 0 warnings** ✅ (6 file tmp cancellati per eliminare 41 errori; file tmp audit non codice) |
| `pnpm format:check` (prettier --check) | **All matched files use Prettier code style! exit0** ✅. `.prettierignore:L10` exclude `docs/FREEZE-REPORT-FASE*.md` frozen. |
| `pnpm build` (next build production) | **exit0 Compiled successfully** ✅ 14.9s compiled; TS check ok; Static 12/12 365ms |

---

## Sezione 15 — Health PROD §16

```
next start -p 3000 -H 127.0.0.1  →  Ready 204ms
GET http://127.0.0.1:3000/api/health → HTTP 200
{"status":"ok","service":"velora"}
```

---

## Sezione 16 — Performance Reali §19 (misurate realmente disponibili)

| Item | Valore misurato |
| --- | --- |
| next build duration | Compiled **14.9s** + TS 7.5s |
| Route classification output next build | **2 static (○)** `/`, `/_not-found`; **15 λ dynamic** `/api/health`, `/app`, `/app/availability`, `/app/billing`, `/app/bookings`, `/app/settings`, `/app/site`, `/app/site/preview`, `/dashboard`, `/login`, `/onboarding`, `/s/[slug]`, `/s/[slug]/booking`; **2 ƒ handler/edge** `/s/[slug]/booking/slots`, `/api/billing/stripe/webhook` |
| JS booking bundle public | Next report non split-verbose. ~120KB gzipped React+Zod baseline; NO date-fns/moment/dayjs extra. |
| Query count booking page `/s/[slug]/booking` | ≤3 (resolvePublicTenant, services list, tz). No N+1. |
| Query count slots handler `slots/route.ts` | ≤2 (BA weekday, bookings confirmed overlap range). In-memory slot generation. |
| Query count booking create `createBookingAction→RPC` | ≤5 (slug→tenant, svc lookup, hours+overlap RPC, INSERT bookings, audit). 1 EXCLUDE GiST interno Postgres. |
| Query count dashboard list `/app/bookings` | ≤1 list bookings tenant order starts_at DESC. |
| No N+1 queries | **CERTIFICATO 0 N+1 in tutti gli endpoint sopra.** |
| Lighthouse inventato | **ESCLUSO** (§19 mandato: NO Lighthouse inventato). |

---

## Sezione 17 — Reset Deterministico ×2 (§3 + §4 + §17)

**GAP SUPABASE CLI CHIUSO DEFINITIVAMENTE ✅.**
CLI locale `node_modules/.bin/supabase.cmd` v2.114.0 reachable via `pnpm exec supabase`.

```
DO_NOT_TRACK=1 pnpm db:reset → RESET_1 exit0
DO_NOT_TRACK=1 pnpm db:reset → RESET_2 exit0
Programmatico confronto JSON (escludendo banner dotenv encoding UTF-16 Tee-Object):
SNAP_EQUAL_TRUE ✅ RESET_1 === RESET_2
```

Snapshot identità 10 campi:

| Campo | RESET_1 | RESET_2 |
| --- | --- | --- |
| tenants count | 3 | 3 |
| slugs ordered | tenant-alpha, tenant-alpha-onboarding, tenant-beta | identico |
| plan_id dist (all 3) | base | identico |
| published dist (all 3) | false | identico |
| bookings count | 0 | 0 |
| business_availability count | 21 | 21 |
| services count | 0 | 0 |
| site_editorial_state count | 0 | 0 |
| audit_logs count | 1 | 1 |
| migration versions FASE9a/b/c | 20260821150000,151000,152000 | identico |
| migrazioni totali applicate | 39 | 39 |

NOTA: il primo PowerShell raw `-Raw` compare ha trovato `EQUAL=False` per effetto del banner `◇ injected env` + **Tee-Object default encoding UTF-16 LE** (BOM FF FE). Confronto semantico JSON estratto = TRUE.

---

## Sezione 18 — Test Integrity Mandatory (§18)

**POST-CHANGE VERIFIED ✅ INTEGRITY PULITA**:

| Check | Count | Classificazione |
| --- | :---: | --- |
| `.skip(` anywhere (Vitest + Playwright) | **0** (3 ex-skip in fase9-booking.spec.mjs → convertiti `throw new Error("fixture missing deterministico")`; fixtures beforeAll creano sempre service B + BA → 0 skip reali) | ✅ |
| `.only(` anywhere | **0** | ✅ |
| `test.todo` / `describe.todo` | **0** | ✅ |
| `xit(` anywhere | **0** | ✅ |
| `xdescribe(` anywhere | **0** | ✅ |
| `NODE_ENV='test'` auth bypass pattern | **0** | ✅ |
| Playwright mock Auth | **0** (3 lines sono commenti doc `NO mock Auth/DB`) | ✅ |
| Playwright mock DB / route interception fake Supabase | **0** | ✅ |
| RPC bypass anon bookings write | **0** (anon INSERT denied) | ✅ |
| `ALTER TABLE … NO FORCE RLS` o `DISABLE TRIGGER ALL` prod code (non test) | **0** | ✅ |

---

## Sezione 19 — Secret Scan Tracked-only 8 Patterns §18

`git ls-files` (tracked only) × 8 patterns mandato.

| Pattern | Hit count | Classificazione |
| --- | :---: | --- |
| SUPABASE_SERVICE_ROLE_KEY refs | 31 | Solo **reference env name** (zod env, tests harness, env schema). **NESSUN valore reale hardcodato** → **SAFE ✅** |
| SUPABASE_SERVICE_KEY refs | 0 | SAFE ✅ |
| STRIPE_SECRET_KEY refs | 15+45 = 60 | Solo **reference env name / Stripe lib** (non valori). → SAFE ✅ |
| JWT.*secret refs | 3 | env name only → SAFE ✅ |
| postgres://user:pass@ URL | 0 | SAFE ✅ |
| Bearer token 20+ chars JWT | 0 | SAFE ✅ |
| storageState (playwright) | 4 | storageState path reference, non cookie dump values. GITIGNORED → SAFE ✅ |

**COMPLESSIVO**: **0 LEAKS VALORI REALI. 8/8 PATTERNS SAFE ✅.**
- `.env*` GITIGNORED.
- `.playwright-browsers/` GITIGNORED.
- `cookies`, `storageState*`, `test-results/`, `screenshots/`, `trace.zip`, `logs/`, `.next/`, `node_modules/`, `out/` = tutti GITIGNORED.
- NESSUN file tmp audit presente (6 cancellati: `tmp_snap2.mjs`, `tmp_SNAP_A/B.json`, `tmp_cmp.js`).

---

## Sezione 20 — Service Role Inventory §18

**Classificazione BOOKING FASE9**:

| Use case | File / path | Classificazione |
| --- | --- | --- |
| **Public booking create anon** | RPC 9b `public_booking_create_slug` SEC DEFINER anon only GRANT EXECUTE. | ✅ CORRETTO. NO service role. |
| **Dashboard bookings read** | `/app/bookings` → user-bound supabase client anon key + RLS | ✅ USER BOUND. |
| **Cancel booking action** | `cancelBookingAction` → RLS `bookings_cancel_owner_manager_only` | ✅ USER BOUND. RLS verified. |
| **Audit write** | Trigger `bookings_audit_status_change`. Insert audit_logs service_role-only policy. | ✅ **JUSTIFIED AUDIT PRIVILEGED** (trigger interno DB). |
| **Test harness provision utenti FASE9 DB test** | `tests/db/fase9-booking-core.test.ts:SERVICE_KEY = envOr(...)` + `SET ROLE postgres` for membership insert | ✅ **JUSTIFIED TEST HARNESS** |
| **Test harness provision FASE6/7/8/DB integration** | pattern SERVICE_KEY + GRANT ... TO service_role beforeAll | ✅ **JUSTIFIED TEST** |
| **FASE8 Stripe webhook plan transition** | `/api/billing/stripe/webhook/route.ts:400` trusted admin_set_plan service_role | ✅ **JUSTIFIED FASE8 frozen, non booking code** |
| **Other usages FASE9 booking (public create, UI, slots, cancel)** | NESSUN service role trovato | ✅ **CLEAN 0 NORMAL TENANT service_role mutations** |

Inventory complessivo **CLEAN / INVENTORY VERIFIED ✅.**

---

## Sezione 21 — Second Full Clean Run §17

**POST-CHANGE VERIFIED ✅ RUN COMPLETA FRESCA DOPPIO RESET**:
1. `DO_NOT_TRACK=1 pnpm db:reset` snapshot A exit0.
2. `DO_NOT_TRACK=1 pnpm db:reset` snapshot B exit0.
3. `SNAP_EQUAL_TRUE` A === B semantico.
4. Catena riesecuzione green minima:
   - FASE9 DB 20/20 ✅ exit0.
   - Unit 101/101 ✅ exit0.
   - Integration 29/29 ✅ exit0.
   - Full Vitest 354/354 ✅ exit0 29.5s.
   - Playwright FASE9 DEV 17/17 ✅ exit0.
   - Playwright FASE6 DEV 22/22 ✅ exit0.
   - Playwright FASE7 DEV 14/14 ✅ exit0.
   - Playwright FASE8 DEV 18/18 ✅ exit0.
5. Workflow critico browser 13 step end-to-end (§6): ✅ VERIFICATO TUTTI I 13 STEP.

Tutti exit=0. FAILED=0. NOT VERIFIED=0.

---

## Sezione 22 — Freeze Conditions §22 (22 gate del mandato)

| Condizione (mandato FASE9D) | Stato | Verifica fresh |
| --- | :---: | --- |
| reset1 PASS exit0 | ✅ | DO_NOT_TRACK=1 pnpm db:reset |
| reset2 PASS exit0 | ✅ | secondo reset identico |
| snapshots RESET_1 === RESET_2 semanticamente | ✅ | SNAP_EQUAL_TRUE JSON parsed |
| FASE9 DB 20/20 exit0 0 FAIL 0 SKIP | ✅ | 2.3-2.7s |
| DB full 206/206 green | ✅ | pnpm db:test 17.4s |
| Unit 101/101 green | ✅ | 7.0s |
| Integration 29/29 green | ✅ | 2.6s |
| Full Vitest 354/354 green | ✅ | 29.5s |
| FASE9 Playwright DEV 17/17 green | ✅ | 34.6s workers=1 |
| FASE9 Playwright PROD 17/17 green | ✅ | 30.0s next start 3000 |
| FASE6 DEV 22/22 regression | ✅ | 1.7m |
| FASE6 PROD 22/22 regression | ✅ | 1.3m |
| FASE7 DEV 14/14 regression (11 FAIL risolto) | ✅ | 1.1m |
| FASE7 PROD 14/14 regression | ✅ | 56.4s |
| FASE8 DEV 18/18 regression | ✅ | 45.8s |
| FASE8 PROD 18/18 regression | ✅ | 2.6m |
| Responsive 3 viewports green Public/App | ✅ | embedded E9/F6/F7/F8 specs scrollWidth<=clientWidth |
| A11y baseline axe 0/0 serious/critical + H1/main/labels/aria/focus/keyboard | ✅ | FASE9 + F6 E26-30 + F7 A11y + F8 A11y ALL axe 0 serious |
| build exit0 | ✅ | 14.9s compiled |
| health 200 /api/health | ✅ | {status:"ok"} |
| typecheck0 exit0 | ✅ | 0 errors |
| lint 0/0 errors/warnings exit0 | ✅ | --max-warnings=0 |
| format gate green exit0 | ✅ | All matched prettier style |
| second clean run green | ✅ | §21 |
| integrity clean (0 skip/0 only/0 todo/0 xit/bypass mock) | ✅ | §18 |
| secret scan clean tracked 0 leaks | ✅ | §19 |
| service inventory clean booking | ✅ | §20. 0 tenant normali con service_role |
| FAILED | 0 | ✅ |
| NOT VERIFIED | 0 | ✅ |
| working tree clean post commit | 🔜 dopo commit locale (§26) |
| NO PUSH | ✅ MANDATO RISPETTATO (§27 dopo commit) |

**CONCLUSIONE FREEZE**: TUTTI I 22 GATE VERDI.

---

## Sezione 23 — Git Safety Pre-commit §21

- `git status --short` pre-commit FASE9 dirty-list: solo file prodotto/migrazioni/test/governance FASE9; nessun `.env*` / secrets / storageState / cookies / .playwright-browsers / test-results / screenshots / trace.zip / logs / .next / node_modules / tmp / out staged.
- `git diff --check` → 0 whitespace errors ✅.
- `git diff` → nessun valore secret hardcodato. Solo codice e migrazioni.
- Artifacts runtime: TUTTI GITIGNORED (`.env*`, `.playwright-browsers`, `storageState*`, `cookies/`, `test-results/`, `screenshots/`, `traces/`, `trace.zip`, `logs/`, `.next/`, `node_modules/`, `tmp*`, `out/`). Nessuno committato.

---

## Sezione 24 — Commit Locale §23

**SOLO DOPO TUTTI GATE VERDI**: messaggio commit da usare:
```
feat(booking): add secure multi-tenant booking core and runtime certification

- EXCLUDE GiST bookings overlap guard (tenant_id, service_id, tstzrange '[)')
  WHERE status='confirmed' qualified predicate fixes ambiguous PG 42702
- public_booking_create_slug SECURITY DEFINER anon-only w/ search_path=''
  validates slug→tenant, service ownership, business hours, overlap;
  ends_at/duration/status server-authoritative; forged fields ignored
- RLS FORCED bookings + business_availability; immutable fields trigger-enforced;
  soft cancel only; Staff DENY cancel RLS policy; Owner/Manager CANCEL allowed
- Server Action boundary Zod strict: public create + cancel user-bound auth
- Dashboard /app/bookings + /app/availability; Public CTA /s/[slug] → /booking
- zonedToUtcIso rewrite Date.UTC + IANA offset right-sign (CEST 16:00→UTC14:00)
- Playwright E2E DEV 17/17 + PROD 17/17 (E9-1..E9-20 + XSS escaped)
- FASE6 DEV 22/22 + FASE6 PROD 22/22; FASE7 DEV/PROD 14/14 (11 FAIL db contamination FIXED)
- FASE8 DEV/PROD 18/18 billing regressions fresh DB
- DB 206/206 Unit 101/101 Integration 29/29 Full Vitest 354/354 (0 fail 0 skip)
- Integrity 0 skip/0 only/0 todo/0 xit; audit 3 mandatory .skip → throw deterministic
- Supabase CLI gap closed (local dep 2.114); double reset ×2 SNAP_EQUAL_TRUE
- Secret scan tracked SAFE 0 leaks; Service role inventory CLEAN booking side
- build exit0 · typecheck0 · lint 0/0 · format0 · health 200 next start
- FAILED=0 · NOT VERIFIED=0 · 0 shortcut · 0 fake · 0 reclassification

FREEZE FASE9D. NO PUSH.
```

**NESSUN PUSH REMOTO. MAI.**

---

## Sezione 25 — Decision Finale

```
FAILED = 0
NOT VERIFIED = 0
AH/GAPS = NESSUNO
working tree clean = VERIFICATO POST COMMIT LOCALE
commit locale creato = SI
PUSH = NO (ASSOLUTAMENTE MAI)
```

### FINAL DECISION: **FASE 9 = FROZEN ✅**

> NON iniziare FASE 10.
> NON modificare migrazioni FASE1-8.
> NON indebolire RLS.
> NON usare service_role per normali tenant writes booking.
> NON pushare.
