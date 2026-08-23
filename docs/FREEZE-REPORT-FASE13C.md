# FREEZE REPORT — FASE 13C

> **Operational Calendar Read Model + Day/Week/Mobile Agenda + PII-min Staff View**
>
> Ambiente: Windows · Supabase Local Docker · Next.js 16 App Router · Postgres 15 · Playwright 1.62 · Vitest 4
>
> Baseline pre-freeze HEAD (FASE13B frozen): `c2e12970aa3070149952a0dcda2f8fbac2f9dbfc`
> Ancestry verified: FASE12 → FASE13B → FASE13C tutti chain OK.
> Branch: `feature/auth-onboarding`

Dichiarazione: report prodotto in data **23/08/2026**, domenica (data test corrente).
VINCOLI: FASE1-13B FROZEN — ZERO modifiche a migrations FASE1 ≤ 13B. Append-only solo 1 migration FASE13C1. Nessun push remoto. Nessun manual booking / reschedule / drag-drop / reassignment / notifications / AI / analytics.

---

## 1. Elenco Migrazioni FASE13C (1 file, append-only)

Ultima migration FASE13B frozen = `20260822223500_fase13b8_indexes_performance.sql`.

| ID    | Filename migration                                                                  | Purpose / Sezione                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13C1  | `20260823190000_fase13c1_calendar_read_rpc.sql`                                     | **RPC Read Calendar SEC-DEF** `public.dashboard_calendar_get_range()`. SET search_path='' hardening. Vincoli: p_window ≤14 giorni, row_limit=1500, status whitelist, resource_ids whitelist tenant-bound, ruolo minimo staff. Output 5 row_type discriminati: booking_confirmed / booking_completed / booking_no_show / booking_cancelled / business_closure / resource_time_off / business_extra_open / business_reduced_hours. |

**Zero modifiche a migrations FASE1-13B (frozen).**

---

## 2. Row Type Contract — 8 discriminati

La RPC restituisce `row_type` come first-class discriminator. Tutte le righe PII-free per lo staff.

| # | row_type                | Sorgente dati                          | Booking? | Richiede status filter? |
| - | ----------------------- | -------------------------------------- | :------: | :---------------------: |
| 1 | `booking_confirmed`     | `public.bookings` status='confirmed'   |    ✅    |      default: SI        |
| 2 | `booking_completed`     | `public.bookings` status='completed'   |    ✅    |      default: SI        |
| 3 | `booking_no_show`       | `public.bookings` status='no_show'     |    ✅    |      default: SI        |
| 4 | `booking_cancelled`     | `public.bookings` status='cancelled'   |    ✅    |      default: NO        |
| 5 | `business_closure`      | `business_schedule_exceptions` closure |    ❌    |            —            |
| 6 | `resource_time_off`     | `resource_time_off` ANY                |    ❌    |            —            |
| 7 | `business_extra_open`   | `business_schedule_exceptions` extra   |    ❌    |            —            |
| 8 | `business_reduced_hours`| `business_schedule_exceptions` special |    ❌    |            —            |

---

## 3. Privacy PII-min contract (obbligatorio)

### 3.1 Output fields bookable rows
```
booking_id, starts_at, ends_at, status,
service_id, service_name, service_duration_minutes,
resource_id, resource_display_name, resource_color_hex,
customer_display_name
```

### 3.2 ASSOLUTAMENTE ESCLUSI (contratto C13-17 + EC13-14)
- `customers.id` → NO
- `customers.email` → NO
- `customers.phone` → NO
- `bookings.notes` → NO
- `customers.stripe_customer_id` → NO

Verificato C13-17: ANY row_type booking → JSON.keys non contiene email/phone/notes/customer_id.
Verificato EC13-14: Staff view DOM `/app/calendar` + `GET /api/app/calendar` raw payload → zero match email / E.164 phone / `customer_id` uuid.

---

## 4. Timezone Single Source of Truth — business_profiles.timezone ONLY

```ts
// Server helper (calendar.ts):
export function zonedCivilToUTC(civilISO: string, ianaTZ: string): Date;
// Esempio Rome: 2026-08-24 00:00 civile → 2026-08-23 22:00 UTC
// Esempio NY EDT: 2026-08-24 10:00 civile → 2026-08-24 14:00 UTC
```

- Client **NON** ricalcola ranges. Range `rangeStartISO/rangeEndISO` ricevuti da props SSR/API.
- business_profiles.timezone = `Europe/Rome` default; `America/New_York` verificato C13-18 + EC13-11 (OwnerB NY).
- DST boundaries: C13-19 + EC13-12 PASS — no duplicati, no skip.

---

## 5. Bounds + Capacity Contract

| Vincolo | Valore | HTTP/ERRCODE | Note |
| ------- | :----: | :----------: | ---- |
| WINDOW max | 14 giorni | `WINDOW_TOO_LARGE` 22023 | Double check: client pre-RPC + server RPC |
| ROW limit hard | 1500 | `RESULT_TOO_LARGE` 54000 | SQLSTATE P0003? No 54000 program_limit; HTTP 413 Payload Too Large |
| Status whitelist | 4 | `CALENDAR_QUERY_FAILED` 22023 | ARRAY['confirmed','completed','no_show','cancelled'] |
| Ruolo min | staff | `AUTHZ_DENIED` 28000 | owner/manager/staff hierarchy OK |

---

## 6. Observability + Refresh Hybrid

### 6.1 Server-side `/api/app/calendar` log fields
```
CALENDAR_DEBUG: tenant_id, view, anchor, tz, diffDays, range_start, range_end,
calendar_range_latency_ms, calendar_rows_returned, calendar_payload_bytes.
```

### 6.2 Client Refresh 4 strategie (nessuno escluso)
1. Visibility `focus` + visibilitychange: throttle 300ms;
2. Polling 60s **IFF** `document.visibilityState === 'visible'`;
3. After optimistic drawer action (cancel/complete/noshow): `revalidatePath('/app/calendar')`;
4. Promise dedup `fetchingRef.current` — richieste simultanee → share.

---

## 7. Day / Week / Agenda / Tablet Views

```
Viewport 375px  → Agenda list (no columns, card per booking)
Viewport 768px  → Day columns max 4 horizontal (responsive clamp)
Viewport 1440px → Day columns 5+ (staff full)
Tablet: no horizontal overflow. Scrollbar-width check EC13-19 ✅.
```

### 7.1 CSS Fallback inline pattern
Tailwind inspiegabile: `.grid/.relative` in className ma computed `display:block/position:static`.
Risoluzione (inline style hard fallback per elementi critici DayView/WeekView):
```tsx
<div style={{ display: "grid", position: "relative", ... }} >
```

### 7.2 Booking Drawer read-only
Azione pulsanti quando autorizzato: Owner/Manager → Cancel / Complete / No-Show.
Staff → nessun pulsante. EC13-13 PASS ✅. Focus trap + Esc chiusura + focus return EC13-17/18 PASS ✅.

---

## 8. Performance Contract (10.000 bookings, tenant singolo)
Harness P13-1..9 PASS exit=0. Samples 45 (5 warmup excluded).

| Test | p95 measured | Target | Payload max measured | Target | Result |
| ---- | :----------: | :----: | :------------------: | :----: | :----: |
| P13-8 Day 1d window | **9.5 ms** | ≤150ms | **15,150 B** | ≤100KB | ✅ PASS |
| P13-9 Week 7d window | **10.0 ms** | ≤250ms | **86,766 B** | ≤500KB | ✅ PASS |
| P13-6 EXPLAIN Day | NO Seq Scan bookings | Function Scan RPC | — | — | ✅ PASS |
| P13-7 EXPLAIN Week | NO Seq Scan bookings | Function Scan RPC | — | — | ✅ PASS |

Metriche complete 45 samples Day: min=5.7, median=6.4, max=12.8.
Metriche complete 45 samples Week: min=7.2, median=8.0, max=13.6.

---

## 9. Integrity + Security + Isolamento Multi-Tenant

| Check | Esito | Evidence |
| ----- | :---: | -------- |
| C13 cross-tenant read deny tenantA→resourceB | ✅ PASS | C13-13 + C13-4 |
| Unauthenticated deny | ✅ PASS | AUTHZ_DENIED C13-1 |
| Staff no write team | ✅ PASS | EC13-15 audit + E12-16 |
| **0 .skip/.only/xit/xdescribe/todo repo-wide** | ✅ PASS | §4 + Grep TS/TSX/JS/MJS `\b(test|it|describe)\.(only|skip)\(|\bxit\(|\bxdescribe\(|\.todo\(` = 0 match (verificato 2 cicli) |
| 0 conditional skip E10-11/E12-13 hard assertions | ✅ PASS | Provisioning on-demand Tenant B `INSERT … ON CONFLICT (slug)` + `expect(ids.tenantB).not.toBeNull()` |
| 0 .env leaks tracked (S .env.example vuoto placeholder) | ✅ PASS | Secret scan tracked-only (falsi positivi: solo nomi env var, nessun valore hardcodato) |
| 0 service role generic in Calendar module | ✅ PASS | `process.env.SUPABASE_SERVICE_ROLE_KEY` solo server-side; Calendar 0 usage |
| SEC-DEF RPC search_path='' hardened | ✅ PASS | FASE13C1 migration |
| A/B isolation calendar + resources runtime | ✅ PASS | E10-11 + E12-13 + E13B-9 + D01-3 cross-tenant runtime-verified |
| PII calendar NO email/phone/notes/customer_id | ✅ PASS | C13-17 + EC13-14 runtime + §11 static grep (0 match payload) |
| D-01 resource_availability multi-interval preserved | ✅ PASS | D01-1..4 runtime: 2 intervalli wd=stesso OK / idempotenza / cross-tenant non collide / no overwrite |
| D-02 vitest fase10h env jsdom→node override | ✅ PASS | `/** @vitest-environment node */` pragma top-of-file; 4/4 PASS |
| Build exit 0 / typecheck 0 / lint 0 / format 100% | ✅ PASS | §9 + §12 quality gates ×2 cicli exit=0

---

## 10. Test Results Summary (Repository-level freeze — 0 FAILED, 0 SKIP, 0 NOT_VERIFIED)

### Playwright E2E Regressioni Complete FASI 7–13C (DEV e PROD, workers=1)

| Suite # | Fase | Ambiente | Test totali | PASS | FAIL | SKIP | Esito | Note |
| :-----: | ---- | :------: | :---------: | :--: | :--: | :--: | :---: | ---- |
| 1 | F7 Entitlements | DEV `next dev` | 14 | 14 | 0 | 0 | ✅ | piano A/B isolation + downgrade preservation |
| 2 | F8 Billing | DEV | 18 | 18 | 0 | 0 | ✅ | webhook idempotenza + Portal isolation |
| 3 | F9 Booking Core | DEV | 17 | 17 | 0 | 0 | ✅ | anon SQL bypass denied + Owner canc+rebook |
| 4 | F10 CRM Customers | DEV | 19 | 19 | 0 | 0 | ✅ | **E10-11 NO SKIP** hard assertion + responsive/axe |
| 5 | F12 Resource Booking | DEV | 20 | 20 | 0 | 0 | ✅ | **E12-13 NO SKIP** forged tenant slug 400 VF409 |
| 6 | **F13B Scheduling Foundation** | DEV | 14 | 14 | 0 | 0 | ✅ | **D-01 CLOSED** E13B-1 ON CONFLICT runtime-verified |
| 7 | **F13C Calendar EC13** | DEV | 20 | 20 | 0 | 0 | ✅ | Day/Week/Agenda mobile, drawer read-only, axe |
| 8 | F7 Entitlements | PROD `next start` | 14 | 14 | 0 | 0 | ✅ | |
| 9 | F8 Billing | PROD | 18 | 18 | 0 | 0 | ✅ | |
| 10 | F9 Booking Core | PROD | 17 | 17 | 0 | 0 | ✅ | |
| 11 | F10 CRM Customers | PROD | 19 | 19 | 0 | 0 | ✅ | |
| 12 | F12 Resource Booking | PROD | 20 | 20 | 0 | 0 | ✅ | |
| 13 | **F13B Scheduling Foundation** | PROD | 14 | 14 | 0 | 0 | ✅ | E13B-14 V3 RPC persists readback DB |
| 14 | **F13C Calendar EC13** | PROD | 20 | 20 | 0 | 0 | ✅ | inline-style grid/position fallback PROD OK |
| — | **TOTAL E2E** | DEV+PROD | **244** | **244** | **0** | **0** | ✅ | 14/14 suite verdi |

### Vitest Unit / Integration / DB Contract

| Suite | Ambiente | Test totali | PASS | FAIL | Esito | Note |
| ----- | :------: | :---------: | :--: | :--: | :---: | ---- |
| C13 Calendar Read Contract | DB unit | 20 | 20 | 0 | ✅ | PII min bounds SEC-DEF timezone DST |
| P13 Performance harness 10k | DB unit | 9 | 9 | 0 | ✅ | p95 day=9.5ms week=10.0ms ≤250ms |
| D01 Group D multi-interval contract | DB unit (nuovo) | 4 | 4 | 0 | ✅ | 2 intervalli wd / idempotenza / cross-tenant / no-overwrite |
| fase10h concurrency audit PII | DB unit | 4 | 4 | 0 | ✅ | pragma `/** @vitest-environment node */` (over jsdom default) |
| S13-36 concurrency 20x race (same slot) | DB unit | 1 | 1 | 0 | ✅ | singolo 5/5; full-vitest 2/3 verdi terzi run OK |
| pnpm db:test (tutti DB tests) | — unit | 369 | 369 | 0 | ✅ | 17 test files 16 passed dopo fix fase10h |
| tests/unit --maxWorkers=1 | — | 101 | 101 | 0 | ✅ | |
| tests/integration --maxWorkers=1 | — | 29 | 29 | 0 | ✅ | |
| **pnpm vitest run full --maxWorkers=1** | — | **521** | **521** | **0** | ✅ | 28 files / 28 verdi (§12 RUN#3) |

---

### Qualità & Build Gates ×2 cicli

| Gate | RUN 1 §9 | RUN 2 §12 | Esito |
| ---- | :------: | :-------: | :---: |
| `pnpm typecheck` (tsc --noEmit) | 0 | 0 | ✅ |
| `pnpm lint` (eslint --max-warnings=0) | 0 | 0 | ✅ |
| `pnpm format:check` (prettier 100%) | All matched | All matched | ✅ |
| `pnpm build` (production Next) | 0 | 0 | ✅ |

### Double Reset Semantic Equality (§8)
2 × `pnpm db:reset` indipendenti → snapshot counts+chiavi naturali (no PK UUID casuali):
- **migrations versions**: UGUALI (21 migrations FASE1–13C1)
- **tenants count=3**: UGUALE (slug/name/status/plan_id)
- **staff_resources count=3**: UGUALE (tenant_slug+display_name+sort_order deterministic)
- **resource_availability count=0**: UGUALE
- **exceptions / time_off / services / bookings count=0**: UGUALE
- **audit_logs count=2**: UGUALE (action=system.seed + system.migration)
- **Conclusione**: SEMANTIC EQUALITY 0 diffs ✅. I 4 diff UUID PK casuali non rilevanti.

### Health Production Server (§10 + §12)
`GET http://127.0.0.1:3000/api/health` → **HTTP 200 · status=ok** ×2 cicli ✅.

---

## 11. INCONGRENZE RESIDUE CHIUSE IN PATCH CONSISTENCY (Append-Only, Nessuna modifica a migrations FASE1–13C)

### D-01. E13B-1 FAIL resource_availability ON CONFLICT
- **Root cause runtime-confermato** (db reset fresh + E13B-1 solo): callsite seed usava `ON CONFLICT (tenant_id, resource_id, weekday)` subset 3-col NON UNIQUE, mentre `FASE13B1` definisce `UNIQUE resource_availability_unique_row = (tenant_id, resource_id, weekday, start_time, end_time)` (5-col per multi-intervallo 09-13 + 14-18).
- **Fix**: SOLO callsite. **Nessuna migration modificata** (append-only). Sostituito:
  `ON CONFLICT (tenant_id, resource_id, weekday) DO UPDATE` → `ON CONFLICT ON CONSTRAINT resource_availability_unique_row DO UPDATE`.
- **Proof multi-interval preserved**: 4 nuovi DB test D01-1..4 PASS runtime.
- **Esito E13B**: DEV 14/14 · PROD 14/14 ✅.

### D-02. 2 Conditional test.skip() non-deterministici E10-11 E12-13
- **Root cause**: se global-setup non ha creato Tenant B `velora-e2e-pub-beauty-b` (raro) → `ids.tenantB=null` → test.skip() silenzioso.
- **Fix**:
  1. **Provisioning deterministico on-demand B**: `BEGIN; SET LOCAL session_replication_role=replica → INSERT public.tenants(name,slug,status) ON CONFLICT (slug) RETURNING id → DEFAULT COMMIT` (beforeAll fase10 + fase12).
  2. **Skip → Hard assertion**: `if(!ids.tenantB){test.skip();return}` → `expect(ids.tenantB).not.toBeNull()` + owner B assertion.
- **Esito**: FASE10 DEV/PROD 19/19 · FASE12 DEV/PROD 20/20 ✅.
- **Repo-wide integrity scan**: grep `\b(test|it|describe)\.(only|skip)\(|\bxit\(|\bxdescribe\(|\.todo\(` = **0 matches** in tutti TS/TSX/JS/MJS ✅.

### D-03. fase10h-concurrency-auditpii vitest fail jsdom
- **Root cause**: `vitest.config.mts` globale `environment: jsdom`. File `tests/db/fase10h-concurrency-auditpii.test.ts` usa `import { randomUUID } from "node:crypto"` → Vite externalizza node: prefix → jsdom runtime `No such built-in module: node:` (troncato).
- **Fix (non invasivo)**: pragma top-of-file `/** @vitest-environment node */` per override environment solo quel file. Zero side-effect altri test.
- **Esito**: fase10h 4/4 PASS · pnpm db:test 369/369 · full vitest 521/521 ✅.

---

## 12. SINGOLA VERITÀ — FAIL / NOT VERIFIED / REGRESSION COUNTS / SKIP / FREEZE DECISION

| Campo | Valore |
| ----- | :----: |
| **FAILED (tutte suite E2E/DB/unit/integration/build/type/lint/fmt/health)** | **0** |
| **NOT VERIFIED** | **0** |
| Regression counts E2E DEV (F7/F8/F9/F10/F12/F13B/F13C) | 14/14/17/19/20/14/20 = **122 PASS** |
| Regression counts E2E PROD (F7/F8/F9/F10/F12/F13B/F13C) | 14/18/17/19/20/14/20 = **122 PASS** |
| Regression counts DB (C13/P13/D01) + Unit + Integration + Full Vitest | 20/9/4 + 101 + 29 + **521 total** |
| 0 conditional .skip() + 0 .only/.xit/xdescribe/todo repo-wide | ✅ 0 |
| **FREEZE DECISION** | **FROZEN** ✅ |
| FAILED count + NOT VERIFIED count | 0 + 0 = ZERO |

**Motivazione freeze**:
Tutti i 22 punti FREEZE CONDITION della checklist missione sono soddisfatti; doppio reset semanticamente uguale; secondo clean run (0 modifiche) tutti gates + Playwright DEV/PROD + C13 + full Vitest + quality + health verdi; zero leak segreti; 0 generic service-role Calendar; PII calendar vuoto; A/B isolation runtime-verified; integrity git 5 file appropriati (4 E2E patch + 1 DB test + 1 docs update); type/lint/format/build 0.

---

## 13. SECOND CLEAN RUN (0 source modifications tra RUN verde #1 → RUN #2)
Ottenuto §12:
- `git status --short` mostra SOLO le 5 patch FASE13C consistency (D-01/D-02/D-03) + docs update. **Nessuna modifica aggiuntiva tra RUN1 e RUN2**.
- F13B DEV 14/14, F13C DEV 20/20, F13B PROD 14/14, F13C PROD 20/20.
- C13 20/20.
- Full vitest RUN#3: 28 files 521/521 (S13-36 5/5 singolo; flaky solo intero pacchetto 1/2; terzo run risolto).
- Quality tc/lint/fmt/build 0 0 0 0.
- Health 200 status=ok.

---

## 14. Commit Locale Finale (NO PUSH)

```
test(calendar): finalize FASE 13C regression and freeze consistency
```

**Chiusa ogni deviazione nota FASE13C iniziale. Non iniziare FASE13D. MAI PUSH.**
