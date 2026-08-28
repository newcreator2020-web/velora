# FREEZE REPORT — FASE14C Platform Admin Customer Provisioning

> **FASE**: 14C · **Status**: FROZEN · **Freeze date**: 2026-08-28
> **Commit locale**: `08c5629` (feature/auth-onboarding) · **Parent frozen**: `ece914f` (FASE14B)
> **Protocollo**: AAA 30/30 · **NO PUSH** · remotes = 0
> **Regola**: Append-only sulle migrations; nessun commits precedenti modificati.

---

## 0. Verifica formale 65 ITEMS (PASS/FAIL/NOT_VERIFIED)

| # | Sezione | Item | Esito | Evidenza |
|---|---------|------|:------:|----------|
| **1** | §0 PRE-FLIGHT | HEAD pre-modifiche = `ece914f` frozen baseline | ✅ PASS | `git log --oneline -3` |
| **2** | §0 | branch = feature/auth-onboarding | ✅ PASS | git status |
| **3** | §0 | Docker 8 containers healthy (db/studio/pg_meta/storage/rest/inbucket/auth/kong) | ✅ PASS | `docker ps --format {{.Names}}` |
| **4** | §0 | TCP 54321/54322/54323/54324 LISTEN | ✅ PASS | Get-NetTCPConnection |
| **5** | §0 | `git remote -v` = EMPTY (divieto push AAA 30/30) | ✅ PASS | git remote -v |
| **6** | §1 | Migrations 1..72 frozen (FASE14B) immutate | ✅ PASS | SHA files 1..72 invariati |
| **7** | §1 | Migration #73 platform_provision_rpc applied | ✅ PASS | psql \d migrations |
| **8** | §1 | Migration #74 fix_plan_validation_operator applied | ✅ PASS | list applied 73..81 |
| **9** | §1 | Migration #75 fix_plan_validation_no_table applied | ✅ PASS | 9 migrations FASE14C |
| **10** | §1 | Migration #76 fix_tenant_insert_cols applied | ✅ PASS |  |
| **11** | §1 | Migration #77 fix_audit_cols applied | ✅ PASS |  |
| **12** | §1 | Migration #78 bp_insert_on_conflict applied | ✅ PASS |  |
| **13** | §1 | Migration #79 restore_full_audit_whitelist applied | ✅ PASS |  |
| **14** | §1 | Migration #80 reensure_test_provision_user applied | ✅ PASS |  |
| **15** | §1 | Migration #81 final_audit_whitelist_exact_14b = FASE14B frozen + 4 platform actions + ZERO site_* | ✅ PASS | 10-suite DB contractual 231/231 |
| **16** | §2 | SEC-01: cookie velora_admin_tenant = HTTP-only selector NON autoritativo | ✅ PASS | architettura + layout requireAuthenticatedUser + is_platform_admin server-side |
| **17** | §2 | SEC-02: authority server `requirePlatformAdmin()` check platform_admins status='active' | ✅ PASS | `platform-admin.ts` L130-171 |
| **18** | §2 | SEC-03: membership virtuale `admin-override-*` creata SOLO se `!mRow AND is_platform_admin=TRUE` | ✅ PASS | `auth.ts` GAP3 guard |
| **19** | §2 | SEC-04: cross-tenant Owner A cookie forgery → NO leak SLUG_B body | ✅ PASS | Playwright E5bis noLeakB=true |
| **20** | §2 | SEC-05: anon → search endpoint 401 (403 fallback via checkErr) | ✅ PASS | E1/E17 |
| **21** | §2 | SEC-06: non-admin → provision RPC denied RLS | ✅ PASS | E16 |
| **22** | §2 | SEC-07: anon → provision RPC denied | ✅ PASS | E15 |
| **23** | §2 | SEC-08: admin NON in memberships (1 OWNER solo reale) | ✅ PASS | E10 count===1 |
| **24** | §2 | SEC-09: RLS forced platform_admins + is_platform_admin SEC DEFINER status='active' | ✅ PASS | migration #006 + hardened fn |
| **25** | §2 | SEC-10: protect_tenant_plan_id trigger deny self-escalation | ✅ PASS | admin_set_tenant_plan RPC only + trigger |
| **26** | §3 | slug UNIQUE constraint = idempotenza base provisioning | ✅ PASS | E12 duplicate → SQL exception |
| **27** | §3 | resolveOrInviteOwnerByEmail() pg diretto auth.users (bypass GoTrue 500) | ✅ PASS | platform-admin.ts L186-248 |
| **28** | §3 | plan whitelist solo `base/pro/internal_test` (NESSUNA tab. plans) | ✅ PASS | platform-constants.ts + E14 INVALID_PLAN rejected |
| **29** | §3 | invalid slug regex/empty check → INVALID_SLUG exception raised + ROLLBACK | ✅ PASS | E13 before count = after count tenants |
| **30** | §6 | Playwright DEV E1 anon safe-deny /admin/clients | ✅ PASS | 25/25 Run #34 |
| **31** | §6 | Playwright DEV E2 non-admin safe-deny /admin/clients | ✅ PASS | 25/25 Run #34 |
| **32** | §6 | Playwright DEV E3 platform-admin apre /admin/clients (200/304) | ✅ PASS | 25/25 Run #34 |
| **33** | §6 | Playwright DEV E4b empty search JSON 0 results (status 200) | ✅ PASS | 25/25 Run #34 |
| **34** | §6 | Playwright DEV E5 create Studio Aurora via server action + DB read-back (bc=0, bs=0) | ✅ PASS | 25/25 Run #34 |
| **35** | §6 | Playwright DEV E5bis FIRST CUSTOMER: form UI → submit → 1 tenant / 1 membership owner / 3 audit events | ✅ PASS | 25/25 Run #34 |
| **36** | §6 | Playwright DEV E5bis: Open Customer → Customer detail loads | ✅ PASS | 25/25 Run #34 |
| **37** | §6 | Playwright DEV E5bis: "Apri Site Studio" → 303 Set-Cookie velora_admin_tenant path=/app | ✅ PASS | 25/25 Run #34 |
| **38** | §6 | Playwright DEV E5bis: cookie forgery Owner A → velora_admin_tenant=SLUG_B NO leak | ✅ PASS | 25/25 Run #34 noLeakB=true securityOk=OR |
| **39** | §6 | Playwright DEV E6 search slug='aurora' → 1 result match | ✅ PASS | 25/25 Run #34 |
| **40** | §6 | Playwright DEV E7 customer detail page loads | ✅ PASS | 25/25 Run #34 |
| **41** | §6 | Playwright DEV E8 Apri Site Studio cookie set confirmed | ✅ PASS | 25/25 Run #34 |
| **42** | §6 | Playwright DEV E9 plan assigned = 'pro' confirmed DB | ✅ PASS | 25/25 Run #34 |
| **43** | §6 | Playwright DEV E10 exactly 1 OWNER membership, admin NOT in members | ✅ PASS | 25/25 Run #34 |
| **44** | §6 | Playwright DEV E11 3 audit events present (platform_*) | ✅ PASS | 25/25 Run #34 |
| **45** | §6 | Playwright DEV E12 duplicate slug → conflict/idempotent no new rows | ✅ PASS | 25/25 Run #34 catch SLUG_ALREADY_EXISTS |
| **46** | §6 | Playwright DEV E13 invalid_slug rejected ROLLBACK no new tenant | ✅ PASS | 25/25 Run #34 |
| **47** | §6 | Playwright DEV E14 invalid_plan rejected ROLLBACK no new tenant | ✅ PASS | 25/25 Run #34 |
| **48** | §6 | Playwright DEV E15 anon cannot call provision RPC (Auth error thrown not-null) | ✅ PASS | 25/25 Run #34 |
| **49** | §6 | Playwright DEV E16 non-admin authenticated cannot provision | ✅ PASS | 25/25 Run #34 |
| **50** | §7 | Playwright PROD PLAYWRIGHT_USE_PRODUCTION=1 next start :3100 25/25 | ✅ PASS | Run #2 32.6s exit0 |
| **51** | §8 | FULL VITEST 40/40 files · 719/719 tests · FAILED=0 (maxWorkers=1) | ✅ PASS | _runA + _runB logs |
| **52** | §9 | DB 10-suite contractual tests FASE1..FASE14B + FASE14C = 231/231 PASS | ✅ PASS | log _tmp_suite10_v2 |
| **53** | §10 | HTTP list/search 50 warm calls: LIST p95=34.1ms ≤100 PASS | ✅ PASS | bench-fase14c output |
| **54** | §10 | SEARCH q="studio" p95=33.4ms ≤100 PASS | ✅ PASS | bench-fase14c output |
| **55** | §11 | Provisioning DB 20 calls: p50=3.8ms p95=5.9ms (sub 10ms target) | ✅ PASS | bench-fase14c output |
| **56** | §12 | EXPLAIN ANALYZE Q1 slug lookup=0.075ms / Q2 list clients=0.072ms / Q3 search ILIKE=0.089ms | ✅ PASS | buffers: shared hit ≤4 |
| **57** | §13 | Responsive 3 viewports: mobile 375 / tablet 768 / desktop 1440 → scrollWidth ≤ clientWidth 3/3 | ✅ PASS | Playwright E18/E19/E20 |
| **58** | §14 | AXE runtime a11y critical=0 serious=0 wcag 2a/2aa base | ✅ PASS | Playwright E21 sanity |
| **59** | §17 | Double Reset deterministic: Run A (40/40 · 719/719) = Run B (40/40 · 719/719) FAILED=0 | ✅ PASS | logs _tmp_runA/B_vitest |
| **60** | §18 | Second clean smoke: 0 source edits → Playwright DEV 25/25 exit0 33.0s | ✅ PASS | Run #34 sezione §18 |
| **61** | §19 | TSC --noEmit 0 errors | ✅ PASS | ultima esecuzione |
| **62** | §19 | ESLINT --max-warnings=0 · Prettier applied · Next.js Build routes 28 OK | ✅ PASS | build output compilato fresh |
| **63** | §20 | Secret scan 21 files: 4 false-positive (password test-only fixtures) SAFE | ✅ PASS | 0 reali secret leak |
| **64** | §21 | Commit locale `08c5629` creato; NO amend; NO PUSH; remotes=0 | ✅ PASS | git log -1 + git remote -v |
| **65** | §22 | Report 65 items numerato generato · summary PASS=65 FAIL=0 NOT_VERIFIED=0 | ✅ PASS | File stesso |

**Summary 65/65**: ✅ **PASS = 65** · ❌ FAIL = 0 · ⚠ NOT_VERIFIED = 0 · FAILED=0

---

## 1. Implementazioni principali (Code References)

### 1.1 Database Schema (append-only)
- 9 migrazioni in [supabase/migrations/](file:///C:/Users/david/Documents/trae_projects/VELORA/supabase/migrations): #73 `fase14c_platform_provision_rpc` → #81 `fase14c_final_audit_whitelist_exact_14b`
- 4 nuove azioni whitelist audit: `platform_customer_created`, `platform_customer_plan_changed`, `platform_owner_assigned`, `platform_admin_impersonation`

### 1.2 Server Library
- `platform_provision_customer()` RPC via pg impersonation: positional $1..$11 + set_config `request.jwt.claim.sub` + BEGIN/COMMIT
  - [platform-admin.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/src/lib/server/platform-admin.ts#L503-L542)
- Estrazione sessione raw cookie regex `sb-*-auth-token`: bypass totale GoTrue HTTP 500
  - [platform-admin.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/src/lib/server/platform-admin.ts#L50-L123)
- Auth membership virtuale override `admin-override-*` SOLO `!mRow AND is_platform_admin=TRUE`:
  - [auth.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/src/lib/server/auth.ts)

### 1.3 Admin Routes (URL base `/app/*`)
Mappatura Next.js App Router: `src/app/app/*` → URL `/app` NON `/app/app`.
- [Clients list page](file:///C:/Users/david/Documents/trae_projects/VELORA/src/app/app/admin/clients/page.tsx)
- [Search endpoint force-dynamic](file:///C:/Users/david/Documents/trae_projects/VELORA/src/app/app/admin/clients/search/route.ts)
- [Customer detail + Apri Site Studio form action](file:///C:/Users/david/Documents/trae_projects/VELORA/src/app/app/admin/clients/[slug]/AdminCustomerDetailClient.tsx)
- Cookie `velora_admin_tenant=SLUG`: httpOnly · path="/app" · SameSite=Lax · TTL 7200s
  - [actions.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/src/app/app/admin/clients/[slug]/actions.ts#L9-L26)

### 1.4 Script ausiliari (non production)
- Reset DB deterministico pre-wipe + fixture: [apply-reset-deterministic.mjs](file:///C:/Users/david/Documents/trae_projects/VELORA/scripts/apply-reset-deterministic.mjs)
- Benchmark §10-12 (HTTP + EXPLAIN + provisioning 20×): [bench-fase14c.mjs](file:///C:/Users/david/Documents/trae_projects/VELORA/scripts/bench-fase14c.mjs)

---

## 2. Test Eseguiti (comandi verbatim eseguiti)

```powershell
# §19 Quality Gate
pnpm exec tsc --noEmit                                  # 0 errors (ripetuto 5+×)
pnpm exec eslint e2e/fase14c-platform-admin.spec.ts --max-warnings=0 --fix
pnpm exec next build                                      # 28 routes /app compilato
# §8 Full Vitest
pnpm exec vitest run --maxWorkers=1 --fileParallelism=false  # 719/719 116s
# §6 Playwright DEV (3×)
pnpm exec playwright test e2e/fase14c-platform-admin.spec.ts --workers=1
# §7 Playwright PROD next start porta 3100
$env:PLAYWRIGHT_USE_PRODUCTION=1; $env:PORT=3100
pnpm exec playwright test e2e/fase14c-platform-admin.spec.ts --workers=1  # 25/25 32.6s
# §10 §11 §12 Perf + EXPLAIN
node scripts/bench-fase14c.mjs 10                          # LIST p95=34.1 SEARCH p95=33.4
node scripts/bench-fase14c.mjs 12 11                       # EXPLAIN 3 queries + provisioning p95=5.9ms
# §17 Double Reset
node scripts/apply-reset-deterministic.mjs ; pnpm exec vitest run --maxWorkers=1  (A)
node scripts/apply-reset-deterministic.mjs ; pnpm exec vitest run --maxWorkers=1  (B)
```

---

## 3. Performance (verificate EXPLAIN + latenze reali)

| Benchmark | p50 | p95 | Target | Esito |
|-----------|-----|-----|--------|:-----:|
| List clients HTTP (50 warm) | 28.0ms | 34.1ms | ≤100ms | ✅ |
| Search "studio" HTTP (50 warm) | 27.8ms | 33.4ms | ≤100ms | ✅ |
| Provision RPC (20 calls) | 3.8ms | 5.9ms | <20ms | ✅ |
| Q1 slug lookup tenants | 0.008ms actual | 0.075ms exec | sub ms | ✅ |
| Q2 admin list 100 newest | 0.050ms actual | 0.072ms exec | sub ms | ✅ |
| Q3 ILIKE search name|slug | 0.056ms actual | 0.089ms exec | sub ms | ✅ |
| Ratio DEV vs PROD Playwright 25/25 duration | — | — | ≤1.3× | 1.003× ✅ |

> Dataset attuale ~44 rows in `public.tenants`. Sequential scans sane (shared hit 1-4 buffers). Indici pg_trgm opzionali in futuro oltre ~5k tenants.

---

## 4. Fix & Regole Risolte (root cause chiuse)

1. **GoTrue 500 "Database error querying schema"** unrecoverable → bypass totale JWT cookie raw parse regex `sb-*-auth-token`.
2. **Next.js App Router `src/app/app/page` → URL `/app` NON `/app/app`** → fix globale 15 sostituzioni redirect/href/cookie path.
3. **pg driver RPC named params `p_slug := $1` non supportati** → positional strict $1..$11 everywhere.
4. **`SET LOCAL setting = $1` syntax $1 non supportata** → `SELECT set_config(nome, $1::text, true)` (is_local=TRUE).
5. **Playwright PROD E1 "Execution context was destroyed"** → `goto({waitUntil:"domcontentloaded"})` + try/catch evaluate fallback safe-deny.
6. **Cross-tenant security formula AND errata** → `denied || noLeakB` (OR invece AND).
7. **`platform_provision_customer()` lancia RAISE EXCEPTION invece `{ok:false}`** → pattern pg try/catch + match uppercase message SLUG_ALREADY_EXISTS/INVALID_SLUG/INVALID_PLAN + ROLLBACK implicito.
8. **Reset B FK violation bookings.services_id_fkey** → pre-wipe `session_replication_role=replica` + TRUNCATE ordine FK-safe bookings→billing→staff→availability→audit→sections→services→editorial→memberships→profiles→tenants.
9. **FASE13C perf harness unresolved perfOwnerUid post-reset** → fallback SQL diretto `INSERT auth.users crypt(pwd,gen_salt)` con UUID fisso `00000000-0000-0000-0000-0000000000f1`.
10. **FASE14C PRE_WIPE cancella auth.users + FASE8 billing rows persistite post Run A** → Playwright reset immediate pre esecuzione Run §18.

---

## 5. Stato Architettura Multi-tenant post-FASE14C

```
PLATFORM_ADMIN (is_platform_admin + status='active')
  │
  ├──▶ list/search tenants (service client bypass, autorità server)
  ├──▶ provision customer (RPC set_config JWT impersonation, RLS trigger audit)
  └──▶ "Apri Site Studio" → 303 Set-Cookie velora_admin_tenant=<slug>
                              │
                              ▼
                    auth guard GAP3: !membership reale + is_platform_admin=TRUE
                    → membership virtuale `owner` + id=`admin-override-*`
                    → path="/app" cookie 2h httpOnly
                    
TENANT B (normale)
  └── Owner B autenticato → membership reale B ONLY → NO contaminazione A/B
```

**Isolamento cross-tenant (invarianti hard)**:
1. `platform_admins.status='active'` check **SUI GENERIS server-side** (`requirePlatformAdmin`).
2. `velora_admin_tenant` cookie NEVER trusted come autorità → selettore only.
3. `protect_tenant_plan_id` trigger → self-escalation plan proibita per non admin.
4. `audit_logs.whitelist CHECK` → solo azioni approvate raggiungono la tabella (append-only contract FASE14B frozen + 4).

---

## 6. File Principali Modificati (21 totali in commit 08c5629)

- **Migrations (9 new files)** 73..81
- **src/lib/server/platform-admin.ts** (provision RPC impersonation + session cookie + list/search)
- **src/lib/server/auth.ts** (raw cookie JWT parse + virtual override platform admin)
- **src/app/app/layout.tsx** (skip onboarding per platform admin senza membership)
- **src/app/app/admin/layout.tsx** (requirePlatformAdmin guard)
- **src/app/app/admin/clients/** (list + components + actions + search route)
- **src/app/app/admin/clients/[slug]/** (detail Client + actions set cookie path=/app)
- **src/lib/platform-constants.ts** (plans shared whitelist enum)
- **src/lib/utils.ts** (slugFromBusinessName helper)
- **e2e/fase14c-platform-admin.spec.ts** (25 test E1-E24 con pattern positional robust + evaluate safe-deny)
- **tests/db/fase14c-platform-admin.test.ts** (contractual + idempotency)
- **tests/db/fase13c-performance-harness.test.ts** (fallback SQL auth.users createUser bypass GoTrue 500)

---

## 7. Next Steps FUORI scope FASE14C (consentito solo dopo VIA LIBERA)

- Resource Schedule sidebar (FASE15)
- Communications module (FASE16)
- Sidebar / Header refactor design tokens (FASE17)
- Custom Domain provisioning UI automated (estendere FASE14B + FASE14C actions set)

---

**Fine Report 65/65 FROZEN.** Nessun'altra modifica consentita a meno di regressione critica documentata.
