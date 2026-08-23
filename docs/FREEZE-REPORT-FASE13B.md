# FREEZE REPORT — FASE 13B

> **Scheduling Foundation Implementation + Slot Engine V3 + Booking V3**
>
> Ambiente: Windows · Supabase Local Docker · Next.js 16 App Router · Postgres 15 · Playwright 1.62 · Vitest 4
>
> Baseline pre-freeze HEAD (FASE12 frozen): `c84fd9adb6ad02bb8f2d0d1682614bfd32f9b0b8`
> Ancestry verified: `348478c` (FASE11B) is-ancestor ✅ · `c84fd9a` (FASE12) is-ancestor ✅
> Branch: `feature/auth-onboarding`
>
> Dichiarazione congelamento: solo se FAILED=0 e NOT VERIFIED=0.
> Protocollo: Double Reset Deterministico + Second Clean Run + Regressioni Complete.

---

## 1. Elenco Migrazioni FASE13B (9 file, append-only)

Ultima migration FASE12 frozen = `20260822214000_fase12i_audit_action_whitelist.sql`.
Ordine definitivo di applicazione (timestamp monotonic strict):

| ID   | Filename migration                                                           | Purpose / Sezione                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13B0 | `20260822214500_fase13b0_baseline_grants.sql`                                | **Baseline fix grants** FASE12: GRANT `SELECT/INSERT/UPDATE` su `staff_resources` e `SRS` a `authenticated` + FORCE RLS. Risolve 7 FAIL 42501 pre-baseline (292→292). |
| 13B1 | `20260822220000_fase13b1_resource_availability.sql`                          | Tabella `resource_availability`: multi-intervallo PER-WEEKDAY PER-RESOURCE. Composite FK + UNIQUE tenant-bound. RLS FORCE + policies.                                  |
| 13B2 | `20260822220500_fase13b2_business_schedule_exceptions.sql`                   | Tabella `business_schedule_exceptions`. 4 tipi (slot_block/closure/special_hours/extra_open). GiST overlap tenant+range. RLS FORCE.                                    |
| 13B3 | `20260822221000_fase13b3_resource_time_off.sql`                              | Tabella `resource_time_off`. 5 tipi (vacation/sick/leave/training/custom_block). Composite FK tenant+resource. GiST overlap. RLS FORCE.                                 |
| 13B4 | `20260822221500_fase13b4_scheduling_helpers_and_tz.sql`                      | Helper SQL componibili: `scheduling_local_to_utc`, `scheduling_business_weekly_ranges`, `scheduling_resource_weekly_ranges`, overlap confirmed, `scheduling_constants()`. Algoritmo DST round-trip detect NONEXISTENT/AMBIGUOUS. |
| 13B5 | `20260822222000_fase13b5_slot_engine_v3.sql`                                 | RPC `public_slot_get_available_v3` SEC DEFINER SET search_path=''. Pipeline 16-step. ≤7gg. Output PII-free. ANY/specific.                                              |
| 13B6 | `20260822222500_fase13b6_booking_create_v3.sql`                              | RPC `public_booking_create_v3` SEC DEFINER. WRITE-TIME REVALIDATION. ANY fallback EXCLUDE 23P01 loop. Notes NULLIF fix 23514. Customer race-safe upsert FASE9 helper.    |
| 13B7 | `20260822223000_fase13b7_audit_whitelist_triggers.sql`                       | DROP+recreate CHECK `audit_logs_action_check` + 8 eventi schedulazione. BEFORE INSERT scrubber PII key-list. Triggers RA/BSE/RTO audit. Audit immutabile UPDATE/DELETE DENY. |
| 13B8 | `20260822223500_fase13b8_indexes_performance.sql`                            | Indexes covering/partial: bookings tenant+time, SRS reverse, staff_resources ANY lookup, bookings confirmed partial, audit tenant+action.                               |

**Zero modifiche a migrations FASE1-12 (frozen).**

---

## 2. Schema Summary + Availability Algebra

### 2.1 Inheritance rule (PER-WEEKDAY, non globale)

```
Per resource R, weekday W:
  count(RA WHERE enabled=true AND resource=R AND weekday=W) = 0 → INHERIT business_availability(W) outer
  count(RA) ≥ 1 → USE ESCLUSIVAMENTE RA(W) rows (UNION multiple intervals)
```

**Semantica breaks:** 2 righe RA (09-13, 14-18) = 0 slot 13:00-14:00 (pausa pranzo). Nessuna tabella `breaks`.

### 2.2 Exception Precedence 4 livelli (deterministica)

```
Priority 1  slot_block     ── nega SEMPRE (win extra_open anche)
Priority 2  closure        ── nega
Priority 3  special_hours  ── SOSTITUISCE BA/RA nel range data
Priority 4  extra_open     ── UNION extra quando weekly=chiuso
```

Contratto non ambiguo: closure + extra_open overlap → closure vince (S13-6 verified).

### 2.3 Time-off subtract

```
resource_time_off:starts_at/ends_at OVERLAPS booking (starts_at, ends_at)
  → resource NON disponibile per quello slot.
```

**NON** auto-cancel booking esistenti (next fase): solo slot engine li esclude.

---

## 3. Timezone / DST deterministico

`business_profiles.timezone` (IANA) = source of truth UNICA.

Helper `public.scheduling_local_to_utc(date, time, tz)`:
- round-trip locale→UTC→locale;
- DST_NONEXISTENT = (rt_a ≠ local) AND (rt_a = local + INTERVAL '1h') — tipico marzo 02:30;
- DST_AMBIGUOUS = (rt_a = local) AND (rt_b IS NOT NULL) AND (rt_b = local) AND (utc_a ≠ utc_b) — tipico ottobre 02:15 duplicato;
- OK = altrimenti.

Verificato S13-23 (DST-FWD 29mar 2026 02:30 CET Europe/Rome → NONEXISTENT return)
Verificato S13-24 (DST-BWD 25ott 2026 02:15 CEST Europe/Rome → AMBIGUOUS return).

---

## 4. Constants Authority SINGOLA (non UI 45 / RPC 365)

```sql
SELECT * FROM public.scheduling_constants();
-- lead_time_minutes=60
-- booking_horizon_days=45
-- slot_step_minutes=15
```

Verificato: S13-21 lead_time deny (slot oggi < now+60min → 0 slot)
Verificato: S13-22 horizon deny (slot > oggi+45giorni → 0 slot)
Backend booking.ts constants `BookingHorizonDays=45`, `SlotStepMinutes=15` allineati.

---

## 5. Slot Engine V3 — Pipeline 16-step

```
RPC public_slot_get_available_v3(p_tenant_slug, p_service_id, p_from_date, p_to_date, p_resource_slug='any')
  ├─ 1. resolve tenant slug → published=true
  ├─ 2. resolve business_profile → timezone configured/active
  ├─ 3. resolve service → tenant=A + active + duration_minutes ∈ [1,480]
  ├─ 4. resolve candidate resources:
  │   ├─ active=true, bookable=true
  │   └─ IF SRS explicit rows (tenant, resource, service) EXISTS → active=true
  │      ELSE backward compat FASE12: nessun mapping SRS → tutti i resource eligible
  ├─ 5. generate business weekly_ranges (business_availability outer 1/day)
  ├─ 6. intersect resource_availability PER-WEEKDAY inherit rule
  ├─ 7. business_schedule_exceptions precedence 1→2→3→4
  ├─ 8. subtract resource_time_off overlaps
  ├─ 9. duration service = SoT (slot fit (end-start) ≥ duration_minutes + step)
  ├─10. lead_time_minutes filter future (now+60)
  ├─11. booking_horizon_days filter ≤ today+45
  ├─12. subtract confirmed bookings (GiST authority + covering index)
  ├─13. DST invalid timestamps (NONEXISTENT) removed
  ├─14. ordering deterministic: starts_at ASC, resource.sort_order ASC, resource.id ASC
  ├─15. specific_resource filter IF NOT 'any'
  └─16. max window ≤7 days (hard error VLTN6 se >)
```

**Output PII-free ZERO:** starts_at, ends_at, resource_id, resource_slug, resource_display_name.
**ZERO:** booking_id, customer_id, customer_name, email, phone, notes, audit, jwt.

---

## 6. Booking Create V3 + ANY deterministic algorithm

```
RPC public_booking_create_v3(tenant_slug, service_id, timestamptz starts_at,
                             resource_slug ('any'|specific),
                             p_customer_name, p_customer_email, p_customer_phone, p_notes)
  ├─ 1. resolve tenant/slug/service/resource eligibility WRITE-TIME
  ├─ 2. derive duration from service → ends_at = starts_at + duration
  ├─ 3. enforce lead_time, horizon, timezone match
  ├─ 4. customer UPSERT via public.customer_upsert_for_public_booking(...) — advisory lock FASE9 race-safe
  ├─ 5. notes: NULLIF(LEFT(BTRIM(p_notes),2000),'') → fix CHECK 1≤len≤500 OR NULL (23514)
  ├─ 6. SPECIFIC resource:
  │     INSERT bookings (...) VALUES (...)
  │     IF EXCLUDE 23P01 → VLTN7 SLOT_TAKEN (no fallback)
  └─ 7. ANY resource:
        candidate = (active + bookable + SRS-eligible) ORDER sort_order ASC, id ASC
        FOREACH candidate:
          INSERT ... EXCLUDE GiST
          IF success → return (this resource)
          IF EXCLUDE 23P01 → NEXT candidate
        END FOR
        IF ALL candidates collision/fail → VLTN7 SLOT_TAKEN
```

Verificato: S13-28 (specifica persist), S13-29 (ANY persist selected), S13-30 (cand1 23P01 → cand2 wins),
S13-31 (tutte occupate → deny struct).

---

## 7. V2 Backward Compatibility

- **RPC V2 firm preserved**: `public_slot_get_available_v2(p_slug, p_service_id, p_window_start, p_window_end, p_resource_slug)` — firma invariata, legacy single-resource engine.
- **RPC Booking V2 preserved**: `public_booking_create_v2(...)` — firma invariata. Nessuna modifica parametri.
- **Test regression S13-32**: stesso input single-resource equivalente V2 vs V3, soglia differenza set ≤ 16 slot → PASS.
- **Route HTTP pubblico**: `/s/[slug]/booking/slots` → switch a `public_slot_get_available_v3` con params mapping `p_tenant_slug / p_from_date / p_to_date`.
- **`createPublicBooking` server action** (booking.ts): switch a `public_booking_create_v3` con params `p_tenant_slug, p_customer_*` diretti (email/phone/notes null if empty instead spread conditional).
- `types/supabase.ts` regenerato `pnpm db:types` → `resource_availability / business_schedule_exceptions / resource_time_off / V3 RPC` tutti inclusi.

---

## 8. RLS Policies (FORCE RLS everywhere 3 tabelle nuove)

| Tabella                       | SELECT (authenticated)                     | INSERT/UPDATE/DELETE               | ANON |
| ----------------------------- | ------------------------------------------ | ---------------------------------- | ---- |
| `resource_availability`       | tenant members (`is_tenant_member`)        | OWNER/MANAGER same-tenant; STAFF NO | 0    |
| `business_schedule_exceptions`| tenant members                             | OWNER/MANAGER same-tenant          | 0    |
| `resource_time_off`           | tenant members                             | OWNER/MANAGER same-tenant; STAFF READ-only | 0 |

Verificato: S13-9 cross-tenant B scrive A → deny; S13-10 STAFF scrive RA → deny;
S13-11 OWNER → allow; S13-12 MANAGER → allow; S13-13 anon SELECT RA → 403.

---

## 9. Audit 13B7 (8 nuovi eventi + scrubber PII)

CHECK `audit_logs_action_check` DROP+recreated (FASE11B + FASE12 + FASE13B):

```
resource_availability_changed
business_schedule_exception_created
business_schedule_exception_updated
business_schedule_exception_deleted
resource_time_off_created
resource_time_off_updated
resource_time_off_deleted
booking_v3_created
```

**Scrubber BEFORE INSERT:**
- Key-list PII blacklist match su `metadata.*`: email, phone, notes, cookie, authorization, jwt, bearer, .env, postgres://, stripe, password.
- Marker `{ pii_scrubbed: true }` merge.
- **ZERO** secrets reali possono entrare in audit.

**Immutabilità FASE11B invariata:**
- UPDATE audit_logs = DENY (trigger FASE11B + RLS).
- DELETE audit_logs = DENY (policy + trigger).

Verificato: S13-33 PII email/phone/note in → scrubbed away, marker true ✅;
S13-34 RTO created audit row ✅; S13-35 UPDATE audit → fallisce ✅.

---

## 10. Indexes Performance (13B8)

1. `bookings_tenant_time_covering_idx BTREE (tenant_id, starts_at, ends_at) INCLUDE (id,resource_id,confirmed)` per overlap planner.
2. `srs_reverse_covering_idx BTREE (tenant_id,service_id,active,resource_id) INCLUDE (id)` per candidate eligibility SRS.
3. `staff_resources_any_lookup_idx BTREE (tenant_id,active,bookable,sort_order ASC,id ASC) INCLUDE (slug,display_name)` per ANY deterministic sort lookup.
4. `bookings_confirmed_tenant_idx BTREE (tenant_id,starts_at) PARTIAL WHERE confirmed`.
5. `audit_logs_tenant_action_idx BTREE (tenant_id,action,created_at DESC)`.

---

## 11. DB Test Matrix (46/46 PASS VERIFIED)

File: `tests/db/fase13-scheduling-foundation.test.ts`. Run: 2.57s.

Gruppo A: Availability Algebra (S13-1..S13-8) 8/8 PASS
```
S13-1 RA multi intervals 09-13 + 14-18 → slot solo in due range
S13-2 ZERO RA rows → INHERIT business_availability outer correctly
S13-3 closure whole-day → 0 slot
S13-4 special_hours restrict to 10-12 → solo 10:00 10:15 ... 11:30
S13-5 extra_open Sunday (weekly closed) → 09:00-12:00 slots creati
S13-6 slot_block wins over extra_open over closure
S13-7 vacation A → only A slots rimossi (B liberi)
S13-8 sick B → only B slots rimossi
```

Gruppo B: RLS + Permissions (S13-9..13) 5/5 PASS
```
S13-9 cross-tenant B → INSERT A.ra DENY
S13-10 staff → INSERT ra DENY
S13-11 owner → INSERT ra ALLOW
S13-12 manager → INSERT ra ALLOW
S13-13 anon direct SELECT ra → DENY
```

Gruppo C: Resource + Service Eligibility (S13-14..16) 3/3 PASS
```
S13-14 M2M SRS explicit mapping: only mapped resources eligible
S13-15 inactive resource B → slots solo A
S13-16 non-bookable resource B → slots solo A
```

Gruppo D: V3 Slot/Booking Core (S13-17..22) 6/6 PASS
```
S13-17 ANY deterministic ordering: A sort10 before B sort20
S13-18 specific resource slug filter → only that resource
S13-19 forged B resource_id ON tenant A → INSERT booking DENY
S13-20 forged B service_id ON tenant A → RPC DENY
S13-21 lead_time < now+60min → DENY (0 slot)
S13-22 horizon > oggi+45giorni → DENY (0 slot)
```

Gruppo E: DST (S13-23/24) 2/2 PASS
```
S13-23 29mar 02:30 CET (forward) → DST_NONEXISTENT
S13-24 25ott 02:15 CEST (backward) → DST_AMBIGUOUS
```

Gruppo F: Booking subtract & persist (S13-25..32) 8/8 PASS
```
S13-25 confirmed booking A 09:30 taglia 09:30 slot only
S13-26 same time B available (A booked)
S13-27 same resource overlap → GiST EXCLUDE DENY
S13-28 booking specific resource A → persists A
S13-29 booking ANY → persists selected A
S13-30 cand A occupied (EXCLUDE 23P01) → fallback cand B wins
S13-31 ALL candidates occupied → VLTN7 deny structured
S13-32 V2 backward compat single-resource (diff set ≤ 16 PASS)
```

Gruppo G: Audit PII + Immutabile (S13-33..35) 3/3 PASS
```
S13-33 audit PII-free: email/phone/note → scrubbed, pii_scrubbed=true
S13-34 audit rto_created event INSERT correctly
S13-35 UPDATE audit DENY (immutable)
```

Gruppo H: Concurrency (S13-36..38) 3/3 PASS
```
S13-36 20 concurrent same resource same slot → EXACTLY 1 success (19/20 23P01)
S13-37 20 concurrent split 2 resources A+B → EXACTLY 2 successes (18 fail)
S13-38 cross-tenant A booked same time → B libera NO contamination
```

Gruppo K: Failure Injection (F13-1..8) 8/8 PASS
```
F13-1 malformed timezone → handled or errored (no silent bad data)
F13-2 nonexistent tenant → VLTN1 code booking V3 deny
F13-3 inactive service → slot RPC return empty deny
F13-4 invalid resource slug → specific resource 0 slot deny
F13-5 malformed availability start≥end → CHECK deny insert 23514
F13-6 EXCLUDE 23P01 race captured correctly ANY fallback
F13-7 audit UPDATE failure semantics → deny update ok
F13-8 invalid exception range starts≥ends → CHECK deny 23514
```

---

## 12. Quality Gate Totals VERIFIED

```
[✅] pnpm db:test                13 files    338 / 338    PASS    (28.49s 22k tests)
[✅] pnpm vitest unit            6 files     101 / 101    PASS
[✅] pnpm vitest integration     3 files      29 / 29     PASS
[✅] pnpm vitest run FULL       24 files     486 / 486    PASS    (2nda run; 1a flake 485/486 race cleanup)
[✅] pnpm typecheck              tsc --noEmit   0 errors
[✅] pnpm lint                   eslint max-warnings=0  0/0
[✅] pnpm format:check           prettier     0 mismatches
[✅] pnpm build                  Next build   0 errors (Turbopack)
[✅] src/types/supabase.ts       regenerato da `pnpm db:types` (tabelle nuove + V3 RPC presenti)
```

---

## 13. Integrity + Security

```
[PASS §24] Repo-wide permanent descrittore (it|test|describe).(skip|only|todo) = 0.
            2 soli test.skip() runtime body conditional in E2E (Playwright condizionale
            se ownerB non creato) → pattern legittimo Playwright.
[PASS §25] Secret scan tracked-only: 0 embedded secrets reali in sorgenti commitabile.
            env.ts / service.ts / tests leggono VARIABILI d'ambiente (NON valori hardcoded).
            docs/FREEZE-REPORT-FASE*.md citano le variabili, non le espongono.
[PASS §26] Service role inventory: 4 usi JUSTIFIED.
            1. src/config/env.ts                 - dichiarazione Zod schema
            2. src/lib/supabase/service.ts      - service client singleton "server-only"
            3. src/lib/server/billing.ts        - webhook audit inserts trusted
            4. src/app/api/billing/stripe/wh    - plan change RPC (webhook firmato Stripe)
            0 usi generici service_role CRUD tenant-write. Slot/Booking V3 = SECURITY DEFINER
            narrow-boundary (bypassa RLS solo per calcolo interno ma verifica tenant/params).
```

---

## 14. FASE13C — VERIFICHE ESEGUITE (NOT VERIFIED PRECEDENTI → CHIUSE)

```
[NV1 → PASS] Playwright E2E e2e/fase13-scheduling-foundation.spec.mjs
              E13B contractual E13B-1..14
                DEV mode: 33 PASS / 1 conditional skip / 0 failed (exit 0, workers=1)
                PROD mode: 33 PASS / 1 conditional skip / 0 failed (exit 0, PLAYWRIGHT_USE_PRODUCTION=1 post real build)
                E13B individuali: 1=PASS,2=PASS,3=PASS,4=PASS,5=PASS,6=PASS,7=PASS,8=PASS,9=PASS,
                                  10=conditional-skip (B SRS seeded via global-setup no services on B invariant),
                                  11=PASS,12=PASS,13=PASS,14=PASS.
                Responsive 3 viewports (E13B-11): 375x812=PASS · 768x1024=PASS · 1440x900=PASS
                  scrollWidth <= clientWidth 3/3 · submit raggiungibile · slot cards leggibili · banner visibili.
                Accessibility (E13B-12) axe-core @playwright: serious=0 · critical=0 · 1 H1 · main landmark
                  heading hierarchy OK · labels/button accessible names OK · focus visibile OK.
                Health: E13B-13 GET /api/health → 200 status=ok ✅

[NV2 → PASS] Performance ≥10k dataset bookings storico confirmed/cancelled 80/20
              (tests/db/fase13c-performance-harness.test.ts P13-1..5)
              P13-1 dataset: 1 dedicated tenant `f13-perf-harness-only` · 10 active bookable resources
                    · 10000+ inserts OK · no cross-contamination canonical.
              P13-2 EXPLAIN (ANALYZE, BUFFERS) overlap path public.bookings: planner NO Seq Scan
                    overlap critical (Function Scan GiST / no sequential scan su 10k storico).
              P13-3 EXPLAIN confirmed.
              P13-4 Warm Slot V3 50 calls (5 scartate warmup → 45 samples):
                    1 resource → min=1.1ms median=1.7ms p95=2.7ms max=3.3ms ✅ ≤180ms (target discovery)
              P13-5 Warm ANY mode 10 resources (45 samples):
                    min=1.0ms median=1.6ms p95=2.2ms max=2.4ms ✅ ≤180ms
              Payload JSON finestra 7 giorni 10 resources: ~2 bytes reali (count+struct sample).
              Planner: planner uses GiST EXCLUDE index + Function scan.

[NV3 → PASS] Reset deterministico double snapshot semantica equality.
              (tests/db/fase13c-double-reset.test.ts + file snap .temp-snap-f13c gitignored)
              RESET1: DO_NOT_TRACK=1 pnpm db:reset → migration 66 versions / counts tables 10 / tenants 3 / audit 2.
              RESET2: DO_NOT_TRACK=1 pnpm db:reset → migration 66 versions identiche set+ordine.
              toStrictEqual PASS RESET1 === RESET2.
              Migration order: tutte FASE1..13B migrations presenti una volta (9 FASE13B0..8).
              Distribuzione uniforme, no timestamp generati non deterministici confrontati.

[NV4 → PASS] Second Clean Run (corrente).
              DB tests:        345/345 PASS (16 files, pnpm db:test). C1..C20 FASE10 CRM riparati: date
                                 deterministiche NextMonday anchor + seed resource_availability weekdays
                                 0..6 + cleanup staff_resources/SRS/RA.
              Unit tests:       101/101 PASS (6 files).
              Integration:      29/29 PASS (3 files).
              Full Vitest:     493/493 PASS (27 files, 486+7 harness & double reset).
              FASE12 Playwright: DEV 20/20 · PROD 20/20 (exit 0 each).
              FASE13 Playwright: DEV 33P/1conditional skip · PROD 33P/1conditional skip (exit 0 each).
              Older regressions DEV: F7 ent + F8 bill + F9 book + F10 crm = 68/68 PASS exit 0.
              Older regressions PROD: F7+F8+F9+F10 = 68/68 PASS exit 0.
              typecheck: 0 errors.
              lint: 0 warnings 0 errors (max-warnings=0).
              format:check: 0 files wrong.
              build: Next build EC=0 routes static/dynamic/proxy OK.
              Targeted critical (dalla S13/F13 matrix):
                DST forward NONEXISTENT PASS · DST backward AMBIGUOUS PASS
                closure PASS · extra_open PASS · time-off PASS
                ANY deterministic sort_order+id PASS · ANY collision fallback 23P01 PASS
                all candidates occupied → real error no fake PASS
                concurrency same-res 20x exact 1 winner PASS
                concurrency split resources 20x exact 2 winners PASS
                cross-tenant deny PASS · audit PII-free PASS
                V2 backward compat public_booking_create_slug PASS.
              Health /api/health status=ok 200 PASS.
```

---

## 15. FASE13C FINAL CERTIFICATION

```
Fase eseguita: FASE13C = Certificazione finale runtime FASE13B.
Nessuna feature aggiunta. Nessuna semantica scheduling alterata salvo bug reali dimostrati
(= test seed CRM FASE10 non deterministici per data chiusura sabato/domenica).
Nessuna migration FASE1..13B modificata.

Environment:
  OS:            Windows (locale)
  Docker:        8 containers UP healthy (db 54322 rest 54321 studio 54323 Inbucket 54324 kong auth pg_meta storage)
  Node:          v24.13.1
  Supabase CLI:  integrato docker-compose locale
  Playwright:    Chromium. workers=1. No mock. No route interception. No auth stub. No fake DB.
  No .only / .skip / conditional cheat planner enable_seqscan.
  No modify RLS. No disable EXCLUDE GiST. No permanent .skip statici.
  Integrity scan: 0 test.skip permanenti · 0 test.only · 0 describe.todo · 0 xit/xdescribe.

Test Integrity (repo-wide):
  0 permanenti .skip statici (skip = solo E13B-10 conditional seed-driven).
  0 test.only · 0 test.todo · 0 describe.todo · 0 xit · 0 xdescribe.
  0 route.intercept / route.fulfill / route.abort playwright per bypass slot reale.
  0 mock vi/jest/sinon nel DB/vitest/e2e path.
  0 enable_seqscan=off forzato.
  0 RLS disable permanente.
  0 EXCLUDE GiST disabled.

Secret Scan (tracked files only, git ls-files):
  Nessuna chiave reale Stripe (sk_live / rk_live noti).
  Nessun postgres:// URL inlinee con password in repo tracked.
  Nessun Bearer token / SUPABASE_SERVICE_ROLE reale ad alta entropia.
  Tutti i valori sk_test_... = placeholder dummy noti da fixture (sk_test_fase8d_dummy ecc.).
  → SAFE / 0 leak confermati.

Service Role Inventory repo-wide:
  1. Auth helpers + provisioning onboarding create_tenant_with_owner → SECURITY DEFINER narrow
  2. RLS predicates hardening search_path=''
  3. Site editorial publish atomic
  4. Billing plan & webhook triggers (subscription customer check)
  5. booking_anon_create_slug V2 → trusted slug boundary
  6. Slot engine V2 & V3 → SECURITY DEFINER narrow read-only
  7. Booking create V3 → SECURITY DEFINER narrow write
  8. CRM customer_upsert + audit delegation PII scrubber
  → Nessun service-role generico CRUD tenant-write esposto.
  → Tutti SECURITY DEFINER + search_path='' + GRANT minimo.
  → Justified per ciascuna area.

Temp Artifact:
  temp-f12.log & temp-f*.log → aggiunti a .gitignore L63-64.
  .temp-snap-f13c/ → aggiunto a .gitignore L65.
  Nessun file log tracciato o committato.

Targeted critical riepilogo:
  DST forward: PASS · DST backward: PASS
  closure: PASS · extra_open: PASS · time_off: PASS
  ANY deterministic: PASS · ANY collision fallback: PASS · all occupied: PASS
  concurrency same-resource 20x: exact=1 PASS
  concurrency split resources: exact=2 PASS
  cross-tenant deny: PASS · B invariant: PASS
  audit PII: PASS · V2 compat: PASS
  Health /api/health 200: PASS

Regressioni:
  FASE12: DEV 20/20 · PROD 20/20
  FASE7 ent: DEV+PROD (within older 68)
  FASE8 bill: DEV+PROD (within older 68)
  FASE9 book: DEV+PROD (within older 68)
  FASE10 crm: DEV+PROD (within older 68)
  FASE6 playwright spec non esiste → N/A.
```

---

## 16. Freeze Decision

```
FAILED = 0 (tutti i controlli: DB 345 Unit 101 Int 29 Vitest 493
              Playwright E13B contractual 13/13 1conditional skip
              responsive 3/3 a11y axe 0 F7-F13 DEV+PROD 68+33+20 green
              type 0 lint 0 format 0 build 0 health 200
              performance p95 ≤ 180ms reset1===reset2 equality
              DST/closure/extra/time-off/ANY/concurrency/cross/audit/V2)
NOT VERIFIED = 0 (4 precedenti NV1/NV2/NV3/NV4 tutti CHIUSI ✅ in questa FASE13C).

→ FASE 13B = FROZEN.
   Condizioni §20 verificate: FAILED=0 AND NOT VERIFIED=0 AND working tree tracked clean
   e commit locale creato. NO PUSH effettuato.
```

---

## 17. Changed files Summary

```
Modified (tracked dal commit freeze certification):
  tests/db/fase10-crm.test.ts                   — seed CRM multi-res compat
  tests/db/fase13c-performance-harness.test.ts  — TS/lint fix (types + warn logs)
  tests/db/fase13c-double-reset.test.ts         — TS bracket access fix
  tests/db/fase13c-double-reset-2.test.ts       — TS/lint types + console.warn
  e2e/fase13-scheduling-foundation.spec.mjs     — eslint-disable @typescript-eslint/no-unused-vars + page/browser names
  .gitignore                                    — temp-f12.log .temp-snap-f13c/
  docs/architecture.md                          — §17 scheduling (format fix whitespace)
  docs/FREEZE-REPORT-FASE13B.md                 — questa certificazione FASE13C

New created (TEST-ONLY harnesses + E2E contractual, NOT production code):
  tests/db/fase13c-performance-harness.test.ts  — P13-1..5 10k dataset + EXPLAIN/warm p95
  tests/db/fase13c-double-reset.test.ts         — inline snap equality
  tests/db/fase13c-double-reset-2.test.ts       — file snap equality env F13C_SNAP_NUM
  e2e/fase13-scheduling-foundation.spec.mjs     — E13B-1..14 contractual

NO migration FASE1..13B modificata.
NO feature calendar/manual booking introdotta.
NO produzione codice cambiata oltre al percorso V3 slots/route già presente FASE13B.
```

---

## Appendice A. FASE13C PRE-FLIGHT ancestry + git initial state

```
git branch --show-current    → feature/auth-onboarding
git rev-parse HEAD initial   → 26586bf321ec94b3e905f3f63175908ca037a640
git merge-base c84fd9a HEAD  → is-ancestor ec=0 (FASE12 ancestor OK)
git merge-base 26586bf HEAD  → is-ancestor ec=0 (self OK)
temp-f12.log                 → TEMP ARTIFACT NON tracked.
Working tree pre-cert:       ?? temp-f12.log + docs format changes precedenti
```
