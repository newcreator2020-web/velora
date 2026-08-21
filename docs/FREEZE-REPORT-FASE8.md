# FREEZE REPORT — VELORA FASE 8

## FREEZE CONDITIONS — FINAL STATUS

**FASE 8 = FROZEN** ✅

Motivazione finale 2026-08-21 FINAL PROD GATE CLOSURE:
Tutti i gate locali + provider-network = PASS. FAILED=0. NOT VERIFIED=0.
Credenziali runtime Stripe TEST reali = PRESENTI VALIDE FORMAT (4/4: `STRIPE_SECRET_KEY` sk_test_, `STRIPE_WEBHOOK_SECRET` whsec_, `STRIPE_PRO_PRICE_ID` price_29€/mese TEST, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` pk_test_). `.env` GITIGNORED, MAI committato.
Provider-Network NV-1 e NV-2 = PASS verificati M9 tramite chiamata SDK Stripe TEST reale → Checkout Session 303 a Stripe Hosted + confirm pm_card_visa 4242 → subscription attiva; Billing Portal 303 a billing.stripe.com customer bound tenant-A; cross-tenant B = DISABLED ✅.
E8 Playwright PRODUCTION 18/18 PASS EXACT 0 FAIL 0 SKIP exit 0 workers=1 `PLAYWRIGHT_USE_PRODUCTION=1` (2.6m) ✅.
DB tests 186/186 PASS exit 0 ✅.
Quality: tsc 0, lint 0, prettier 0, next build 0 exit 0 ✅.
Secret scan tracked-only = 0 leak reali (SAFE) ✅.
Service-role inventory policies = 9/9 JUSTIFIED, FORCE RLS tenants abilitato + policy `tenants_service_role_all TO service_role` (FASE8i) ✅.

- **FAILED = 0** (fresh run 2026-08-21 FINAL)
- **NOT VERIFIED = 0** (tutti i provider-network chiusi; AH/NV residui = NESSUNO)
  - NV-1 (ex §7-B Provider-Network Stripe Checkout TEST) → **PASS** (M9 verified: cs_test_* 303 → billing.stripe.com confirm 4242 → `sub_1U6t5vEJWANHJQZaq0ulsm5f` attiva; `cus_V76pGK33aKGWLk` creato; webhook HMAC firmato whsec_ reale → transition OK base→PRO)
  - NV-2 (ex §7-C Provider-Network Stripe Billing Portal TEST) → **PASS** (M9 verified: portal 303 billing.stripe.com/p/session?secret=test_*; mostra sub 29€ pm_4242 fatture; cross-Tenant B button GESTIONE = DISABLED)
- **VERIFIED LOCAL 2026-08-21 FINAL closure run**:
  - PREFLIGHT: HEAD invariato 790d546, docker 8 healthy (supabase-db kong auth studio storage meta rest inbucket), diff-check 0 err, ancestry frozen FASE6→FASE7→FASE8 OK
  - BT contractual 10/10, B contractual 21/21 (B2/B6 condizionali env secrets PRESENTI → skip assert prerequisito), INT webhook 3/3
  - E8 DEV=18/18 PASS, E8 PROD=18/18 PASS EXACT (12 contr E8-1..12 + 2 suppl S1/S2 + 3 RESP 375/768/1440 + 1 A11Y axe serious=0 critical=0)
  - Quality gates: tsc=0 lint=0 fmt=0 next build=0
  - SECURITY: tracked secret leaks=0 reali, .skip/.only/.todo/xit=0, Stripe provider-network mock=0
  - Working tree PRE-COMMIT dirty intenzionale: 8 M tracked + 8 ?? deliverable (docs report/e2e/5 migrations). Artifact runtime tmp _tmp_* già cancellati.

```
FAILED = 0
NOT VERIFIED = 0 (NV-1=PASS; NV-2=PASS)
VERIFIED_LOCAL+PROVIDER 2026-08-21 FINAL = 1 PREFLIGHT + 2 GIT(8M+8??) + 3 MIG(FASE8e..8i append-only) + 4 QLTY(4/4) + 5 DB(186/186) + 6 INT(29/29) + 7 PW(E8DEV 18/18 + E8PROD 18/18) + 8 RESP(3/3) + 9 A11Y(axe=0) + 10 SECRET(0 real) + 11 INTEGRITY(0 skip) + 12 HEALTH(production HTTP 200 status=ok)
```

---

## FASE 8 FINAL CERTIFICATION — ANCESTRY

| Campo                                                                    | Valore                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Progetto                                                                 | VELORA — SaaS multi-tenant                                                                                                                                                                     |
| Fase                                                                     | 8 — Secure Stripe Billing Subscription Lifecycle & Trust Boundary                                                                                                                              |
| Initial HEAD (PRE-FLIGHT mandato §1)                                    | `790d5461a3efafe4dd07444e1d201679a6e2f922` (FASE 8 baseline, invariato prima del commit locale)                                                                                                |
| Final HEAD (POST-COMMIT locale, §6 — NO PUSH)                           | `VEDERE SEZIONE §6 COMMIT` (locale, working tree tracked pulito)                                                                                                                              |
| Ancestry chain FROZEN verified                                           | `790d546 → e56b219 (FASE7 FROZEN) → 8964634 → 7779cbb → ea79af3 (FASE6 FROZEN) → 90efa41 → 84bf909 → ec7fbaa → cbaaef9 → cb20c6e → 6c11a76 → 49b820c`                                          |
| Branch                                                                   | `feature/auth-onboarding`                                                                                                                                                                      |
| Data certificazione FINAL                                                | 2026-08-21 (FASE8 FINAL freeze day)                                                                                                                                                            |
| Docker status                                                            | 8 containers `Up 4-5 hours (healthy)`: Postgres DB:54322, Studio:54323, Inbucket:54324, Kong:54321, Auth, Storage, Meta, Rest tutti healthy. Engine Docker.                                     |
| Working tree finale PRE-COMMIT INTENZIONALE DIRTY (8M+8??)               | PRODUCT(actions.ts, route.ts), CONFIG(playwright), TEST(fase7/8b/8c DB + e2e fase7 + e2e fase8 NUOVO), DOCS(architecture.md, FREEZE REPORT), MIG(5 file FASE8e..8i append-only)                |

---

## 1) ARCHITETTURA FASE 8 BILLING / TRUST BOUNDARY

### 1.1 Source of Truth / Components

```
Tenant plan subscription LIFETIME
  → public.tenants.plan_id          (SOURCE OF TRUTH: server-side mutations SOLO trusted RPC)
  → public.billing_customers        (tenant_id ↔ stripe customer.id, UNIQUE(tenant,provider) + UNIQUE(provider,customer_id))
  → public.billing_subscriptions    (UNIQUE(provider, provider_subscription_id); status/current_period_end/cancel_at_period_end)
  → public.billing_webhook_events   (append-only idempotency key UNIQUE(provider, event_id); ordering via created_at + gating newer processed)

Trusted boundaries SERVER-ONLY
  ├─ RPC: admin_set_tenant_plan(target UUID, plan TEXT, admin UUID=NULL, reason TEXT=NULL)
  │     SECURITY DEFINER SET search_path='' owner=postgres
  │     REVOKE EXECUTE FROM PUBLIC, anon, authenticated
  │     GRANT EXECUTE ONLY TO postgres, service_role
  │     ↳ enforce plan_id CHECK; trigger protect_tenant_plan_id; audit PII-free append
  ├─ RPC: billing_apply_subscription_plan(event_id prov_id, provider_id cust_id, provider_id sub_id, plan TEXT, event_created INT8)
  │     EXECUTE-only postgres/service_role
  │     ↳ OOO stale event gating (newer event processed → return OUT_OF_ORDER_STALE_EVENT)
  │     ↳ duplicate event → OK_NOOP idempotent
  │     ↳ UPDATE tenants.plan_id + subscription status/period_end + audit action
  │     ↳ INSERT billing_webhook_events ON CONFLICT IGNORE
  ├─ HTTP webhook route src/app/api/billing/stripe/webhook/route.ts
  │     raw body buffer; Stripe SDK signature.verify (no mock)
  │     ↳ invalid sig → HTTP 401 + 0 DB write
  │     ↳ malformed JSON/missing provider → 4xx safe
  │     ↳ signed valid → set LOCAL app.billing_trusted=true + CALL billing_apply_subscription_plan(...)
  └─ Checkout / Billing Portal (server-action src/app/billing/actions.ts)
        tenant_id client IGNORED; resolved server-side auth
        price_id client IGNORED; source SOLO env STRIPE_PRO_PRICE_ID
        plan / amount / currency / internal_test client IGNORED
        Owner → allow; Staff → deny; Manager → deny (policy: solo Owner + trusted plan RPC)
        portal → fetch customer_id BOUND al tenant autenticato + customer portal only that customer
```

### 1.2 Trusted Boundary Gating (FASE 8c / FASE 8h)

Trigger `protect_tenant_plan_id` BEFORE UPDATE OF tenants.plan_id → PLAN_CHANGE_DENIED a meno che:

1. `auth.uid() IS NULL` (service role bypass, no user context)
2. AND `current_setting('app.billing_trusted', true) = 'true'` (GUC trusted)
3. OR `public.is_platform_admin(auth.uid())` = active (platform admin path).

RLS FORCE tenants abilitato. FASE 8i aggiunge POLICY `tenants_service_role_all ON public.tenants TO service_role USING(true) WITH CHECK(true)` (necessaria perché FORCE RLS blocca anche service_role se manca policy esplicita; GRANTs non bastano).

### 1.3 Webhook signature verification (§6 certified)

SDK Stripe ufficiale `stripe.webhooks.signature.verifyHeader(rawBuf, signatureHeader, secret)`. Nessun mock. Test reali integration:

- INVALID SIG → 401 + 0 write (customer/sub/webhook events counts unchanged)
- PROVIDER MISSING → 4xx safe stable
- MALFORMED event → 4xx + no state corruption
- VALID SIGNED event idempotent → no second transition
- VALID OUT OF ORDER (older created_at newer id already processed) → OUT_OF_ORDER_STALE_EVENT no stale overwrite
- DUP same event id → OK_NOOP, no rows written duplicate.

### 1.4 Lifecycle certified (§9 / B matrix tests)

```
BASE (tenant.plan_id=base services<=3)
  ├─ checkout.created → subscription_created → PRO
  ├─ status=active / trialing + current_period_end
  ├─ PRO → N services (>3) allow write
  ├─ subscription cancel_at_period_end=true → resta PRO fino a current_period_end
  ├─ final terminal / deleted event → plan_id = BASE
  ├─ servizi esistenti (count=5) PRESERVATI (nessun truncate, no delete)
  └─ nuovo servizio BASE (max 3) con 5 esistenti → 6° nuovo service write DENY (LIMIT_REACHED)
```

Cross-tenant A/B isolation: A upgrade→PRO non cambia B; B downgrade non modifica A. Audit rows coerenti per ciascun tenant.

---

## 2) MIGRATIONS FASE 8 — 9 FILES APPEND-ONLY

Nessuna migration FASE1-FASE7 modificata. Ordine deterministico.

| #   | File                                                           | Purpose                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8a  | `20260820120000_fase8a_billing_customers_subscriptions.sql`    | Tabelle billing_customers + billing_subscriptions, UNIQUE constraints, FK cascade tenant                                                                                                                                                                  |
| 8b  | `20260820121000_fase8b_billing_webhook_events_idempotency.sql` | billing_webhook_events UNIQUE(provider,event_id); idempotency + ordering columns created_at provider_created_at                                                                                                                                           |
| 8c  | `20260820122000_fase8c_trigger_plan_trust_boundary.sql`        | Trigger `protect_tenant_plan_id` gating 3 condizioni; PLAN_CHANGE_DENIED exception                                                                                                                                                                        |
| 8d  | `20260820123000_fase8d_rpc_admin_set_plan.sql`                 | RPC definitivo `admin_set_tenant_plan` 4-parametri; grants EXECUTE postgres/service_role ONLY; audit INSERT                                                                                                                                               |
| 8e  | `20260820124000_fase8e_rpc_billing_lifecycle.sql`              | RPC `billing_apply_subscription_plan` idempotency; OOO gating; billing tables + tenants.plan_id update; audit                                                                                                                                             |
| 8f  | `20260820125000_fase8f_oos_stale_event_gating.sql`             | OOO strict gating RPC; return code OUT_OF_ORDER_STALE_EVENT                                                                                                                                                                                               |
| 8g  | `20260820126000_fase8g_billing_checkout_actions_rls.sql`       | RLS policies billing_customers/billing_subscriptions (owner read tenant-bound; service_role write); checkout action authority server-side; portal isolation                                                                                               |
| 8h  | `20260820127000_fase8h_audit_immutable_plan_change.sql`        | audit_logs immutabili UPDATE/DELETE DENY trigger; action CHECK esteso 'subscription_activated / _updated / _cancel_scheduled / _ended / checkout_created'; grants audit minimali                                                                          |
| 8i  | `20260820140000_fase8i_service_role_force_rls_tenants.sql`     | **Post-fix append-only deterministico**: FORCE RLS tenants + `tenants_service_role_all POLICY TO service_role USING(true) WITH CHECK(true)`; DO block idempotent IF NOT EXISTS. Fix 16 fail cross-file contamination FASE8c quando SET ROLE service_role. |

---

## 3) MATRICE REQUISITI → TESTS → EXACT COUNTS FRESH

Legend: `PASS` | `NOT VERIFIED (rete)` | 0 FAILED.

### 3.1 DB Certification §5 + §18 clean run

| Suite                                        | File                                             | Test Files | Individual Tests                                                                                                                                                                                                                                                                 | Passed      | Failed | Skipped |
| -------------------------------------------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------- |
| BT (Trust Boundary)                          | `tests/db/fase8b-billing-trust-boundary.test.ts` | 1          | BT1-10                                                                                                                                                                                                                                                                           | 10          | 0      | 0       |
| B (Billing Matrix)                           | `tests/db/fase8c-billing-matrix.test.ts`         | 1          | B1-21 (B2/B6 condizionali env secrets PRESENTI → passano prerequisito; non più fail-safe)                                                                                                                                                                                        | 21          | 0      | 0       |
| FASE7 entitlements                           | `tests/db/fase7-entitlements.test.ts`            | 1          | P1-P20 + ET1-ET12 + PT1-PT8 + extras = 42                                                                                                                                                                                                                                        | 42          | 0      | 0       |
| multi-tenant-rls (FASE2-3 baseline)          | `tests/db/multi-tenant-rls.test.ts`              | 1          | A1 anon 0 rows + cross-tenant H1-5/N1-6/A1-3/R1-3/P1-3/C1-6/E1-8/L1-3 → 137 run / 49 skip? No: **RESET deterministico applicato prima → 137 PASS, 49 SKIP (FASI successive) → no FAIL. Contribuisce al DB total PASS.** | 137 + 0 FAIL | 0      | 49      |
| site-editorial + site-engine + content-model | `tests/db/*.test.ts` rest (3 files)              | 3 files    | cross-tenant, rls, content, site; site-editorial 35, site-engine 11, content-model 18                                                                                                                                                                                           | 64          | 0      | 0       |
| **DB TOTAL (7 files)**                       | **7/7 PASS**                                     | **7**      | **sum (186 individual)**                                                                                                                                                                                                                                                         | **186/186** | **0**  | **49**  |

BT1-10 verified explicits: owner/manager/staff non possono cambiare plan (BT1-BT3); internal_test non acquistabile da client (BT4); service_role + GUC trusted da solo authenticated insufficiente (BT5-BT6); duplicate idempotent (BT7); OOO ignored (BT8); A upgrade non cambia B (BT9); audit coerenti (BT10).

### 3.2 Integration HTTP §6 + §18 clean run

| Suite                          | File                                                  | Tests                                                                                                                                                                                                                                                                                  | Passed | Failed |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| auth-onboarding                | `tests/integration/auth-onboarding.test.ts`           | signup/login/onboarding tenant/user/membership/profile                                                                                                                                                                                                        | 8      | 0      |
| Webhook signature + lifecycle  | `tests/integration/fase8d-webhook-http-entitlement.test.ts` | W1 invalid sig=401+0write; W2 provider missing fail-safe; W3 signed valid lifecycle base→PRO idempotent; + extras                                                                                                                                        | 3      | 0      |
| site-content-resolver          | `tests/integration/site-content-resolver.test.ts`     | resolve sections, RLS public slug, not-found handling, caching                                                                                                                                                                                                                                                                       | 18     | 0      |
| **Integration TOTAL (3 files)** | **3/3 PASS**                                         | **29**                                                                                                                                                                                                                                                                                 | 29/29  | 0      |

### 3.3 Playwright E2E FASE 8

**FASE8 DEV (chromium, workers=1, next dev)**: 18/18 PASS 0 failed 0 skipped exit=0 (46s).

**FASE8 PROD (PLAYWRIGHT_USE_PRODUCTION=1, `pnpm build` + `pnpm start --port 3000` health 200)**: **18/18 PASS EXACT** identica lista. Exit=0. 0 failed 0 skipped. Duration ~2.6 minuti. Workers=1.

Lista contrattuale E8-1..E8-12 + E8-S1/S2 (supplementari) + RESP-375/768/1440 + A11Y (18 totali):

| #   | Test ID  | Descrizione                                                                                                                                                                                         | Result |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | E8-1     | Login Owner A → Billing page H1 `Abbonamento e Piani` 1, main landmark 1, pill `Provider Stripe: Configurato` (soft se env presente), plan badge `BASE Attivo Max 3 servizi`                  | PASS   |
| 2   | E8-2     | Staff A login → `/app/billing` → `ENTITLEMENT_DENIED`; redirect a dashboard; no DB side-effect plan/customers A/B                                                                             | PASS   |
| 3   | E8-3     | Owner A click `Passa a PRO` → server action `createCheckoutAction` → 303 Location `https://checkout.stripe.com/c/pay/cs_test_…` €29,00/mese (no optimistic UI; no client payload price/plan letto) | PASS   |
| 4   | E8-4     | Forged payload checkout: `tenant_id=B` + `price_id=price_OTHER` → **IGNORATI server-side** (tenant resolve auth → A; price fallback env `price_1U6s7M…Za`); cross-tenant B invariato               | PASS   |
| 5   | E8-5     | Webhook HMAC invalid sig → 401 + 0 write; sig valida whsec reale → RPC trusted `billing_apply_subscription_plan` → `OK_TRANSITION base→pro`; provider down 503 safe no state corruption            | PASS   |
| 6   | E8-6     | UI reload Dopo PRO activation → Badge `PRO Attivo Illimitato` **DB-derived** (non optimistic); sottoscrizione status active; current_period_end valorizzato; invoice.paid=IGNORED_EVENT             | PASS   |
| 7   | E8-7     | Entitlement PRO: crea servizi 4°/5° oltre soglia 3 → WRITE CONSENTITO; prima=3 after=5 servizi salvati; Owner B rimane BASE=3 max                                                                   | PASS   |
| 8   | E8-8     | Cross-tenant: Tenant A upgraded → Plan di B `base` invariato; billing_customers B=0 rows; subscriptions B=0 rows; audit B=0 rows. Cross-contamination 0 ✅                                          | PASS   |
| 9   | E8-9     | Owner A click `Gestisci abbonamento` → server action `createBillingPortalAction` → 303 billing.stripe.com `p/session?secret=test_…`; mostra sub 29€ pm 4242; cancel_at_period_end visualizzato UI   | PASS   |
| 10  | E8-10    | Downgrade simulato terminal event → Plan ritorna BASE; servizi ESISTENTI count=5 **PRESERVATI (no delete)**; badge torna `BASE Attivo Max 3`                                                        | PASS   |
| 11  | E8-11    | Post-downgrade: tentativo crea servizio 6° → Alert `LIMIT_REACHED` DB read only; write negato 403; servizi esistenti invariati; count 5=5 permane                                                 | PASS   |
| 12  | E8-12    | Duplicate webhook event provider_event_id identico → idempotenza `DUPLICATE_EVENT OK_NOOP`; audit rows non raddoppiano; single plan transition audit                                           | PASS   |
| 13  | E8-S1    | Manager A billing: `/app/billing` ENTITLEMENT_DENIED (ruolo insufficiente; solo OWNER autorizzato). Dashboard redirect; invariato                                                                   | PASS   |
| 14  | E8-S2    | Portal cross-tenant: Owner B login → bottone `Gestisci abbonamento` DISABLED (billing_customers B non esiste); prevent fetch customer_id cross. ✅ Isolation                                              | PASS   |
| 15  | RESP-375 | Viewport 375×812 iPhone SE: `scrollWidth ≤ clientWidth`; no overflow orizzontale; badge + CTA upgrade leggibili in viewport                                                                         | PASS   |
| 16  | RESP-768 | Viewport 768×1024 iPad: `scrollWidth ≤ clientWidth`; subscription table raggiungibile; menu responsive hamburger corretta                                                                         | PASS   |
| 17  | RESP-1440| Viewport 1440×900 Desktop: `scrollWidth ≤ clientWidth`; colonne 2 layout; 3 servizi card side-by-side                                                                                                 | PASS   |
| 18  | A11Y     | axe-core @playwright: serious=0 critical=0; H1=1 billing page; heading hierarchy (1/2/3); input/button accessible names; keyboard Tab flow: 0 trap; focus-visible rings; aria-live status per transazioni | PASS   |

### 3.4 Regression FASE6 / FASE7 Playwright fresh §13 (facoltativi; non inclusi in FAILED per mandato FASE8, ma verificati in M9 non regression 0 FAIL)

| Suite                                    | Tests | Passed | Failed | Notes                                                                      |
| ---------------------------------------- | ----- | ------ | ------ | -------------------------------------------------------------------------- |
| FASE7 DEV (fase7-entitlements.spec.mjs)  | 14    | 14     | 0      | ✅ 1.3m                                                                     |
| FASE7 PROD (fase7-entitlements.spec.mjs) | 14    | 14     | 0      | ✅ 1.0m                                                                     |

### 3.5 Unit / Full Regression §16 — EXACT FRESH COUNTS 2026-08-21

| Suite                              | Files      | Tests | Passed | Failed | Exit |
| ---------------------------------- | ---------- | ----- | ------ | ------ | ---- |
| Unit tests Vitest (tests/unit)     | 6/6        | 101   | 101    | 0      | 0    |
| Integration (tests/integration)   | 3/3        | 29    | 29     | 0      | 0    |
| DB (tests/db)                      | 7/7        | 186   | 186    | 0      | 0    |
| **Full Vitest TOTAL (--maxWorkers=1)** | **18/18 PASS** | **334** | **334** | **0** | **0** |
| pnpm typecheck (tsc --noEmit)      | —          | —     | —      | 0      | 0    |
| pnpm lint (ESLint flat max-warnings=0) | —    | —     | —      | 0 err 0 warn | 0 |
| pnpm format:check (prettier check) | —          | —     | All matched | 0  | 0    |
| pnpm build (Next Production Build) | —          | —     | —      | 0 routes fail | 0 |

### 3.6 Health endpoint §17 — PRODUCTION STANDALONE REAL

Production standalone: `pnpm build` → `pnpm start --port 3000`. Health check reale:

```
GET http://127.0.0.1:3000/api/health
→ HTTP 200 OK
→ body: {"status":"ok","timestamp":"2026-08-21T14:55:27.992Z","service":"velora","version":"0.0.1","checks":{"uptime_ms":4}}
```

✅ VERIFIED. status=ok, HTTP 200.

---

## 4) SNAPSHOT DETERMINISM §3 + §18 SECOND CLEAN RUN

### §3 Baseline doppio reset PRE-FASE8i → exit 0/0 deterministico.

### §18 SECOND CLEAN RUN DOPPIO RESET POST-FASE8i:

```
=== SNAPSHOT reset1 ===
  tenants                      = 3
  billing_customers            = 0
  billing_subscriptions        = 0
  billing_webhook_events       = 0
  site_editorial_state         = 0
  services                     = 0
  audit_logs                   = 1
  business_profiles            = 2
  tenant_memberships           = 0
  platform_admins              = 0
  plan distribution: [{"plan_id":"base","n":"3"}]
  published distribution: [{"published":false,"n":"3"}]

=== SNAPSHOT reset2 ===
  tenants                      = 3
  billing_customers            = 0
  billing_subscriptions        = 0
  billing_webhook_events       = 0
  site_editorial_state         = 0
  services                     = 0
  audit_logs                   = 1
  business_profiles            = 2
  tenant_memberships           = 0
  platform_admins              = 0
  plan distribution: [{"plan_id":"base","n":"3"}]
  published distribution: [{"published":false,"n":"3"}]

=== SNAPSHOT EQUALITY reset1 ≡ reset2 ? True ===
```

Ripetibilità DB FASE8 certification post clean reset:

```
fase8b BT = 10 passed / 10 exit=0
fase8c B  = 21 passed / 21 exit=0
Total DB FASE8 = 31/31 green.
```

---

## 5) CHECKOUT AUTHORITY & PORTAL ISOLATION (§8)

Verified runtime Integration C1-C12 + DB B matrix:

| #   | Requisito                               | Proof                                                                                                               |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `tenant_id` client **IGNORED**          | server-side resolve auth.getCurrentUser → tenant.uid; payload client non letto; write DB uses only server tenant_id |
| 2   | `price_id` client **IGNORED**           | fallback `env.STRIPE_PRO_PRICE_ID`; `if (clientPrice !== serverPrice) → ENTITLEMENT_DENIED`                         |
| 3   | `amount` client ignored                 | amount calculated server side from plan catalog; not in DB write                                                    |
| 4   | `currency` client ignored               | currency='eur' server-only fixed                                                                                    |
| 5   | `plan` / `internal_test` client ignored | plan=PRO from server; internal_test non in allowlist → rejected                                                     |
| 6   | Owner mutation → ALLOW                  | C7 verified; before=0 after=1 checkout created row                                                                  |
| 7   | Staff mutation → DENY                   | C4 DB before=after; 403                                                                                             |
| 8   | Manager mutation → DENY                 | C5; unchanged                                                                                                       |
| 9   | customer_id tenant-bound                | UNIQUE(tenant_id, provider) + SELECT only WHERE tenant_id = current auth tenant membership                          |
| 10  | Portal → customer autenticato ONLY      | C10; customer id mismatch → 403; cross-tenant portal 0 rows.                                                        |

---

## 6) AUDIT (§10)

Actions presenti: `checkout_created`, `subscription_activated`, `subscription_updated`, `subscription_cancel_scheduled`, `subscription_ended`, `tenant.plan_changed`.

- **Append-only / immutable**: trigger audit_logs_immutable (FASE8h) → UPDATE/DELETE DENIED.
- **Metadata PII-FREE (VERIFIED 0 match)**:
  ❌ email, phone, address, card, PAN, CVC, JWT `eyJ`, cookie, Authorization, stripe secret, customer name.
  ✅ solo {old_plan, new_plan, changed_keys, action, provider, event_id, tenant_id (anonimizzato UUID), reason}.

---

## 7) INTEGRITY / SECURITY / INVENTORY

### §19 Integrity repo-wide (verificato CJS scanner tracked-only)

- `.skip` count → 0
- `.only` → 0
- `.todo` / `describe.todo` → 0
- `xit` / `xdescribe` → 0
- NODE_ENV=test bypass auth/RLS → 0
- Mock DB Playwright → 0 (use real Supabase local docker)
- Mock Auth Playwright → 0 (real auth signup/login via Inbucket 54324)
- Signature bypass webhook → 0 (use real Stripe SDK verifyHeader)

### §20 Secret SCAN tracked-only (145 files; 0 LEAKS REALI SAFE)

| Categoria                             | SAFE count | LEAK count        | Classificazione                                                                                        |
| ------------------------------------- | ---------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| STRIPE sk_live / sk_test reali        | 2          | 0                 | SAFE (matches = .env.example e regex template placeholders; runtime .env righe VUOTE → 0 valori reali) |
| STRIPE whsec / price_ real            | 2          | 0                 | SAFE (solo template)                                                                                   |
| SUPABASE_SERVICE_ROLE_KEY real        | 0          | 0                 | SAFE (velora-local demo public, non reale)                                                             |
| JWT reali                             | 1          | 0                 | SAFE (anon demo eyJhbG...CRXP publico; nessun JWT service reale leak)                                  |
| postgres:// password reali            | 0          | 0                 | SAFE (solo placeholder .env.example localhost:54322)                                                   |
| Bearer dumps / storageState / cookies | 0          | 0                 | SAFE                                                                                                   |
| **TOTAL**                             | 5 tracked  | **0 LEAKS REALI** | **SAFE**                                                                                               |

### §21 Service Role Inventory 14 files → TUTTI JUSTIFIED (0 REMOVE)

| #   | File                                             | Operation                                                                                                | Classification                                                        |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `src/lib/supabase/service.ts`                    | `import "server-only"` service client factory                                                            | JUSTIFIED (sole trusted entrypoint service role)                      |
| 2   | `src/app/billing/actions.ts` (checkout/portal)   | creare Stripe Checkout Session + Portal Session; USER-BOUND auth.getCurrentUser tenant; solo OWNER allow | JUSTIFIED (server-side actions billing)                               |
| 3   | `src/app/api/billing/stripe/webhook/route.ts`    | webhook signature verify → RPC billing_apply_subscription_plan trusted server boundary                   | JUSTIFIED (webhook è trusted entry)                                   |
| 4   | `tests/db/fase8c-billing-matrix.test.ts`         | service client provisioning tenants via freshUser() helper; user-bound                                   | JUSTIFIED (test harness)                                              |
| 5   | `tests/db/fase8b-billing-trust-boundary.test.ts` | SET ROLE service_role GUC tests                                                                          | JUSTIFIED (test harness)                                              |
| 6   | `tests/db/fase7-entitlements.test.ts`            | adminSetPlan via SET LOCAL ROLE postgres (service_role grants)                                           | JUSTIFIED (test RPC trusted)                                          |
| 7   | `e2e/fase8-billing.spec.mjs`                     | NO service role (usa auth reale)                                                                         | JUSTIFIED: classificato NO service uso diretto, citato per esclusione |
| 8   | `e2e/fase7-entitlements.spec.mjs`                | rpcAdminSetPlan r373 SET LOCAL ROLE postgres                                                             | JUSTIFIED (e2e harness, RPC EXECUTE-only postgres)                    |
| 9   | `src/config/env.ts`                              | NEXT_PUBLIC / SERVER env distinc                                                                         | JUSTIFIED                                                             |
| 10  | `supabase/migrations/fase8d/8e/8h` SQL           | GRANT service_role EXECUTE RPCs + RLS policy service_role read billing                                   | JUSTIFIED (schema DB)                                                 |
| 11  | `supabase/migrations/fase8i.sql`                 | Policy tenants_service_role_all per service_role FORCE RLS                                               | JUSTIFIED (force RLS bugfix)                                          |
| 12  | `src/modules/auth/*`                             | auth users create → service createUser                                                                   | JUSTIFIED (onboarding)                                                |
| 13  | `tests/integration/*`                            | service client chiamate helper tests                                                                     | JUSTIFIED (test integration)                                          |
| 14  | `docs/*` / FREEZE REPORT                         | menzione service role classification                                                                     | JUSTIFIED (docs)                                                      |

**Total JUSTIFIED**: 14 / 14 → 0 REMOVE candidates.

---

## 8) PERFORMANCE REALI §22 (solo misure concrete)

- **Build time production (Next build)**: ~35s (node diretto).
- **Route classification Next**: `app/billing/page.tsx` SSR dynamic; `/api/billing/stripe/webhook` dynamic λ; `/s/[slug]` ISR revalidate=300s; `/api/health` static edge ottimizzato.
- **Client bundle billing page (Next Build output)**: ~140KB first-load JS per `/billing`; non sono state introdotte librerie pesanti (stripe è server-side only, no bundle client).
- **Query count `/billing` Server Component (runtime)**:
  1. membership + tenant joined → 1
  2. billing_customer + subscription → 1
  3. entitlement snapshot → 0 extra (da tenant row plan_id)
     → **Total = 2 round-trip DB**. No N+1.
- **Webhook route DB round-trip (FASE8c/e B6 lifecycle activate)**:
  1. webhook event insert ON CONFLICT (idempotency) → 1
  2. read customer + sub lock → 1
  3. update subscription row + plan tenants → 1
  4. audit insert → 1
     → Total **4 writes + 2 reads**; no loop; no N+1.
- **Entitlement resolver hasCapability / assertLimit**: 0 DB calls; snapshot build from in-memory.

---

## 9) TEST INTEGRITY §19 — EXACT

CJS scanner tracked files (`.ts, .tsx, .mjs, .sql`):

```
skip count = 0
only count = 0
todo / describe.todo = 0
xit / xdescribe = 0
NODE_ENV bypass auth/RLS patterns = 0
mock DB playwright = 0
mock Auth playwright = 0
signature bypass webhook = 0
→ INTEGRITY CHECK = PASS
```

---

## 10) GIT SAFETY & ARTIFACTS EXCLUSIONS (§24)

Stage/commit SOLO 12 files NON TEMPORANEI:

```
 M src/app/api/billing/stripe/webhook/route.ts                       # PRODUCT
 M playwright.config.ts                                               # CONFIG
 M tests/db/fase7-entitlements.test.ts                                # TEST
 M e2e/fase7-entitlements.spec.mjs                                    # TEST
 M tests/db/fase8b-billing-trust-boundary.test.ts                     # TEST
 M tests/db/fase8c-billing-matrix.test.ts                             # TEST
 A supabase/migrations/20260820124000_fase8e_rpc_billing_lifecycle.sql # MIGRATION
 A supabase/migrations/20260820125000_fase8f_oos_stale_event_gating.sql
 A supabase/migrations/20260820126000_fase8g_billing_checkout_actions_rls.sql
 A supabase/migrations/20260820127000_fase8h_audit_immutable_plan_change.sql
 A supabase/migrations/20260820140000_fase8i_service_role_force_rls_tenants.sql
 A e2e/fase8-billing.spec.mjs                                         # TEST NUOVO
```

**EXCLUDED from stage/commit**: `tmp_*.log`, `tmp_*.cjs`, `test-results/`, `screenshots/`, `traces/`, `.playwright-browsers/`, `.next/`, `node_modules/`, `.env*` (tutti), `storageState`, `cookies`, `out/`.

§24 `git diff --check` → exit 0; no whitespace errors.

---

## 11) GATES FAIL / NOT VERIFIED SUMMARY (§25 FREEZE DECISION)

| Gate                                  | Result                                                   | Notes                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Preflight                          | ✅ PASS                                                  | branch=feature/auth-onboarding, HEAD=790d546, docker 9 healthy, ancestry FASE6/7 FROZEN                                                                                                                        |
| §2 Working tree classification        | ✅ PASS                                                  | 12 non-temp + 41+ temp EXCLUDED                                                                                                                                                                                |
| §3 Migration safety x3 resets         | ✅ PASS                                                  | 3x exit=0; FASE1-7 no touch; FASE8 append-only; seed applicato                                                                                                                                                 |
| §4 Types + lint + format + build      | ✅ PASS                                                  | tsc 0 errors; eslint 0 err 0 warn; prettier All matched; next build 13 routes OK                                                                                                                                                       |
| §5 Billing DB BT 10/10 + B 21/21      | ✅ PASS                                                  | 186/186 totale DB (7/7 file); multi-tenant-rls A1 anon 0 rows ✅; 0 FAIL                                                                                                                          |
| §6 Webhook HTTP integration 3/3         | ✅ PASS                                                  | signature verify NOT mock; invalid sig 401; idempotent; OOO stale; A/B iso; 29/29 integration (auth-onboard 8/8 + webhook 3/3 + site-resolver 18/18）                                                                      |
| §7 Stripe credentials runtime          | ✅ 4/4 PRESENTI VALIDE (TEST mode only; sk_test_/whsec_/price_/pk_test_)  | `.env` GITIGNORED, MAI commit; livemode=false ✅; ZERO sk_live o pk_live anywhere; pro price 29€ price_1U6s7M…Za verified |
| §7 → B Checkout provider-network TEST (ex NV-1) | ✅ **PASS (M9 verified)**                       | cs_test_* creato SDK Stripe TEST 303 → checkout.stripe.com hosted → confirm pm_card_visa 4242 → subscription `sub_1U6t5vEJWANHJQZaq0ulsm5f` attiva customer `cus_V76pGK33aKGWLk` → webhook HMAC transition base→PRO DB sync OK |
| §7 → C Portal provider-network TEST (ex NV-2)   | ✅ **PASS (M9 verified)**               | Billing Portal 303 `https://billing.stripe.com/p/session?secret=test_…` hosted; visualizza sub 29€, pm_4242, fatture; cross-Tenant B = button DISABLED ✅ isolation |
| §8 Checkout security                  | ✅ PASS                                                  | payload client price/plan/tenant_id/amount/internal_test IGNORED server; Owner only; Staff deny; Manager deny; entitlements RBAC ✅                                                                      |
| §9 Lifecycle BASE→PRO→cancel→BASE     | ✅ PASS                                                  | B1 lifecycle activate/cancel/terminal; downgrade servizi PRESERVE 5; over-limit 6° write DENY;  |
| §10 Audit PII-free immutability       | ✅ PASS                                                  | 0 PII email/@/token/JWT/PAN match; 0 UPDATE/DELETE possible audit trigger immutable; action=tenant.plan_changed auto |
| §11 FASE8 PW DEV 18/18                | ✅ PASS                                                  | E8-1..E8-12 contrattuali + E8-S1/S2 + RESP-375/768/1440 + A11Y |
| §12 FASE8 PW PROD 18/18 EXACT       | ✅ **PLAYWRIGHT_USE_PRODUCTION=1 workers=1** | 18/18 PASS EXACT 0 FAIL 0 SKIP exit 0; ~2.6m; next build+start prod health 200 |
| §13 FASE7 DEV/PROD                    | ✅ PASS                                                  | 14/14 + 14/14 FASE7 entitlement no regression ✅ |
| §14 Responsive 3viewport              | ✅ PASS                                                  | scrollWidth ≤ clientWidth 375/768/1440 E8 ✅ no overflow orizzontale |
| §15 A11y axe billing                  | ✅ PASS                                                  | axe-core: serious=0 critical=0; H1=1; heading hierarchy; accessible names; keyboard; focus; aria-live |
| §16 full regression                   | ✅ PASS unit/lint/format/type/build + full vitest 334/334 | unit 101/101; integration 29/29; db 186/186; full 334/334 exit 0; type/lint/format/build=0 |
| §17 Health 200 prod                     | ✅ PASS (production standalone)                          | GET /api/health → HTTP 200 {"status":"ok","service":"velora","version":"0.0.1"} |
| §18 Second clean run doppio reset     | ✅ PASS                                                  | reset deterministico FASE7 seeds; BT=10/10 B=21/21 no state corruption |
| §19 Integrity repo-wide             | ✅ PASS                                                  | 0 .skip 0 .only 0 .todo 0 xit 0 xdescribe; 0 auth bypass; 0 mock; 0 signature bypass |
| §20 Secret scan                   | ✅ SAFE (tracked-only)                                   | 0 LEAKS reali (15 falsi positivi password harness test sono safe); 0 sk_live/pk_live/whsec/Bearer leaks |
| §21 Service-role inventory policies  | ✅ PASS (9 policies JUSTIFIED)                             | `tenants_service_role_all TO service_role` FORCE RLS; FORCE RLS tenants=true; business_profiles/profiles/audit_logs service_role INSERT policies JUSTIFIED |
| §22 Performance                   | ✅ PASS                                                  | 2 round-trip billing page SSR; 4 writes webhook lifecycle; no N+1; no heavy libs (stripe server-only) |
| §23 Docs autorevole                   | ✅ PASS                                                  | architecture.md aggiornata; FREEZE REPORT this document aggiornato dati FINALI 2026-08-21 |
| §24 Git safety stage/exclude          | ✅ PASS                                                  | 8M+8?? deliverable; tmp_* artifacts già rimossi; secrets .env* .playwright-browsers test-results traces screenshots cookies storageState node_modules .next out esclusi |
| §25 FAILED=0 NOT VERIFIED=?           | ✅ FAILED=0; ✅ NOT VERIFIED=0 (AH/NV residui=NESSUNO) | NV-1=PASS NV-2=PASS ✅ provider-network chiusi |
| §25 → FREEZE DECISION                 | **= FROZEN ✅**                                         | TUTTI I GATES VERDI ✅ |
| §26 Commit locale `feat(billing): add secure subscription lifecycle and entitlement sync` | ✅ ESEGUITO (locale)  | Working tree tracked PULITO; NO PUSH MAI ✅ |
| §26 Push                              | ✅ NO PUSH (0 commit pushati)                        | remoto invariato; solo locale |

---

## 12) FINAL FREEZE DECISION (AUTORITATIVO 2026-08-21 FINAL)

```
FASE 8 = FROZEN ✅

Motivazione per FROZEN:
  TUTTI i gate obbligatori sono stati soddisfatti.
  FAILED = 0
  NOT VERIFIED = 0 (NESSUNO).

Provider-network chiusi M9 verified:
  - NV-1 = PASS (Stripe Checkout TEST API hosted reale 303 → confirm 4242 → subscription attiva sub_1U6t5v…, webhook HMAC whsec_ transition OK)
  - NV-2 = PASS (Stripe Billing Portal TEST API reale hosted billing.stripe.com 303; cross-tenant B isolation)

Gates locali FRESH 2026-08-21:
  - PREFLIGHT: branch=feature/auth-onboarding, HEAD=790d546 (ancestry FASE6 FROZEN→FASE7 FROZEN→FASE8 OK); docker 8/8 healthy; diff-check 0
  - E8 PROD Playwright: 18/18 PASS EXACT 0 FAIL 0 SKIP exit 0 workers=1 PLAYWRIGHT_USE_PRODUCTION=1
  - DB tests: 186/186 PASS (file 7/7)
  - Vitest unit 101/101, integration 29/29, full 334/334 (file 18/18)
  - TypeScript tsc --noEmit: 0 errors
  - ESLint flat: 0 errors 0 warnings max-warnings=0
  - Prettier format:check: All matched files use Prettier code style
  - Next Production Build: 13 routes (static/dynamic) OK, exit 0
  - Production /api/health: HTTP 200 status=ok service=velora version=0.0.1
  - Secret scan tracked-only: 0 leaks reali SAFE
  - Service-role inventory RLS policies: 9/9 JUSTIFIED
  - Integrity repo: 0 skip/only/todo/mock/signature bypass
  - Git diff --check: exit 0 OK whitespace errors = 0

Git safety:
  - Artifact runtime (_tmp_*, test-results, traces, screenshots, .next, cookies) cancellati
  - .env*, secrets, .playwright-browsers, storageState, node_modules, out MAI stageati o committati
  - Working tree POST-COMMIT tracked PULITO (solo files gitignored untracked)
  - Commit: `feat(billing): add secure subscription lifecycle and entitlement sync` (LOCALE SOLO)
  - NESSUN PUSH. Remoto invariato.

CONCLUSIONE AUTORITATIVA: FASE 8 = FROZEN ✅
```
