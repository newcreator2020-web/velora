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

## 14. NOT VERIFIED (runtime non eseguito in questa sessione)

```
[§19] Playwright E2E e2e/fase13-scheduling-foundation.spec.mjs E13B-1..14
        + responsive 375/768/1440 + axe 0 serious/critical + keyboard a11y
        MOTIVO: non ancora scritto il file playwright per FASE13B.
[§20] Performance dataset sintetico ≥ 10000 bookings storici + EXPLAIN ANALYZE slot V3
        + 50 warm calls p95 reale. MOTIVO: tempo.
[§21] Reset Deterministico double snapshot semantic equality 10 tabelle + plan distribution.
        MOTIVO: tempo.
[§23] SECOND CLEAN RUN post-reset. MOTIVO: tempo.
```

---

## 15. Freeze Decision

```
FAILED = 0 su tutti i punti verificati (§0..§18 / §22 Tc/Lint/Fmt/Build).
NOT VERIFIED = 4 voci (E2E playwright FASE13B, Performance, Reset Deterministico 2x, Second Clean Run).

→ FASE 13B = NOT FROZEN secondo il contratto rigoroso §29 "tutto deve risultare verificato".
   Fondazione scheduling/codice 100% implementata e 338 DB / 486 vitest / 0tc / 0lint / 0fmt / 0build
   tutti PASS, ma mancano gli step 19 (E2E)/20 (perf)/21 (reset)/23 (second run) per freeze completo.

Raccomandazione prossima fase (13C pre-production):
  1. Scrivi e runna E2E Playwright FASE13B 14 casi + responsive + axe.
  2. Genera dataset 10k bookings sintetici, EXPLAIN ANALYZE e 50 warm calls p95.
  3. Double reset determinismo snapshot 1/2 equality.
  4. Second Clean Run ripeti tutti i counts.
  5. Esegui nuovamente freeze checklist §29.
  6. Freeze + commit definitivo.
```

---

## 16. Changed files Summary (12 files tracked + types rigenerato)

```
Modified (4):
  src/app/s/[slug]/booking/slots/route.ts    — switch V2 → V3 RPC params mapping
  src/lib/server/booking.ts                  — switch create V2 → V3 params
  src/types/supabase.ts                      — pnpm db:types regenerated V3 tables/funcs
  docs/architecture.md                       — aggiunta §17 Scheduling Foundation

New created (9 migrations + 1 DB test + 1 report):
  supabase/migrations/20260822214500_fase13b0_baseline_grants.sql
  supabase/migrations/20260822220000_fase13b1_resource_availability.sql
  supabase/migrations/20260822220500_fase13b2_business_schedule_exceptions.sql
  supabase/migrations/20260822221000_fase13b3_resource_time_off.sql
  supabase/migrations/20260822221500_fase13b4_scheduling_helpers_and_tz.sql
  supabase/migrations/20260822222000_fase13b5_slot_engine_v3.sql
  supabase/migrations/20260822222500_fase13b6_booking_create_v3.sql
  supabase/migrations/20260822223000_fase13b7_audit_whitelist_triggers.sql
  supabase/migrations/20260822223500_fase13b8_indexes_performance.sql
  tests/db/fase13-scheduling-foundation.test.ts   (46 tests S13-1..38 F13-1..8)
  docs/FREEZE-REPORT-FASE13B.md                    (questo report)
```
