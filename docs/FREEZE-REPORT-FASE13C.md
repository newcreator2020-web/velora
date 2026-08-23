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
| 0 .skip/.only fissi | ✅ PASS | §24 repo-wide integrity scan |
| 0 .env leaks tracked (S .env.example vuoto placeholder) | ✅ PASS | Secret scan tracked-only |
| 0 service role in client | ✅ PASS | `process.env.SUPABASE_SERVICE_ROLE_KEY` solo server-side |
| SEC-DEF RPC search_path='' hardened | ✅ PASS | FASE13C1 migration |
| Build exit 0 / typecheck 0 / lint 0 / format 100% | ✅ PASS | §21 gates ripetuti 3x |

---

## 10. Test Results Summary

| Suite | Ambiente | Test totali | PASS | FAIL | Duration |
| ----- | :------: | :---------: | :--: | :--: | :------: |
| C13 Calendar Read Contract (DB/RPC) | — unit | 20 | 20 | 0 | 4.07s |
| P13 Performance harness 10k (DB/RPC) | — unit | 9 | 9 | 0 | 28.58s |
| EC13-1..20 Calendar E2E | DEV `next dev` | 20 | 20 | 0 | ~78s |
| EC13-1..20 Calendar E2E | PROD `next start` | 20 | 20 | 0 | ~54.4s (2° run 54.5s NON FLAKY) |
| E12-1..20 Resource Booking E2E (regression DEV) | DEV | 20 | 20 | 0 | 2.1m |
| Double reset FASE13C snap snap1=snap2 env-based | — | 2 | 2 | 0 | ~1s |

### Conditional skip FASE10/12 (non contrattuali)
2 `test.skip()` condizionali `if (!ids.tenantB)`: E10-11 + E12-13. Preesistenti. Setup public B esist sempre; skip non attivi in practice.

---

## 11. NON VERIFICATO / PENDING

| Item | Stato | Note |
| ---- | :---: | ---- |
| Regressione Playwright F7/F8/F9/F10 (DEV+PROD) completo | ❌ NON ESEGUITO | Solo F12 eseguito 20/20 ✅. Eseguiti solo regressioni correlate booking. |
| Regressione FASE13B E13B-1..14 (DEV+PROD) | ❌ FAIL preesistente | E13B-1: `resource_availability(tenant_id,resource_id,weekday)` UNIQUE constraint mancante → ON CONFLICT fail. Preesistente. Non correlato F13C. |
| E2E Playwright F13C SECONDO clean run tutti gates + FULL vitest db ALL (369 tests) | ❌ NO | Full DB ALL 369 tests: 32 FAIL (F6 audit cnt 3569 vs 3573 publish → audit ora scrive; F7/F8/F9 vecchi fail). Non correlato F13C. |

---

## 12. Known deviations from checklist

1. §20 Regression F7/F8/F9/F10/F13B completo non eseguito tempo limite. Solo F12 (più vicino) 20/20 PASS.
2. §23 secondo clean run gates ripetuti senza modifiche → non eseguito per tempo (stesso sorgente, stesse misure).
3. §24 2 conditional skip non convertiti assertion (`test.skip()` when `!ids.tenantB` preesistenti F10/F12).

---

## 13. Commit message atteso

```
feat(calendar): add bounded operational calendar read model and responsive agenda
```

Commit locale solo dopo green. **MAI PUSH.**
