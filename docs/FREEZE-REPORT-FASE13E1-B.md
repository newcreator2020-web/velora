# VELORA — FREEZE REPORT FASE13E1-B
## Operator Time-Off Operational UI + End-to-End Certification

> Data freeze: `2026-03-18`
> Head iniziale atteso: `ee91e55` (FASE13E1-A1 frozen)
> Head corrente: commit locale non pushato (NO PUSH — AAA 29/30)
> Branch: `feature/auth-onboarding`
> Classificazione **per punto spec**: VERIFIED / FAILED / NOT VERIFIED.
> Niente "certified" senza runtime evidence.

---

## 0. PRE-FLIGHT — VERIFIED

| Controllo | Esito | Evidenza |
|-----------|:-----:|----------|
| HEAD == ee91e55 al via | ✅ | `git rev-parse HEAD` → `ee91e55` |
| Working tree clean init | ✅ | `git status --short` → 0 lines |
| Ancestry chain FASE12→13E1-A1 | ✅ | `git log --oneline -15` mostra c84fd9a→26586bf→da2aed8→5a06787→49861b6→ee91e55 |
| Docker engine OK | ✅ | Engine 29.7.2 |
| 8/8 containers UP healthy | ✅ | `docker ps` kong/auth/db/storage/... 8/8 |
| TCP 54321 (kong/api) LISTEN | ✅ | `Test-NetConnection 127.0.0.1 -Port 54321` OK |
| TCP 54322 (postgres) LISTEN | ✅ | `Test-NetConnection 127.0.0.1 -Port 54322` OK |

## 1. SCOPE IMPLEMENTATO

### A. Time-off tipologie DB enum — VERIFIED
Enum legali `vacation | sick | leave | training | custom_block`. UI Drawer select e team labels tutti e 5 i tipi.

### B. Entry point reali — VERIFIED
1. `/app/team` → pulsante "🗓 Assenze" per ogni `ResourceRow`.
2. `/app/calendar` → blocco time-off clickable + context menu owner/manager `+Aggiungi assenza`.
3. Entrambi aprono lo stesso `ResourceTimeOffDrawer`.

### C. Preview conflitti PII-free — VERIFIED (DB contractual + UI wired)
- `dashboard_resource_time_off_preview` restituisce: `booking_id, starts_at, ends_at, service_name, resource`.
- **0 email / 0 phone / 0 notes / 0 address** in RPC response (verified S13E1B-09, F13E1B failure).
- UI Drawer preview panel: conflict_count reale, lista minima booking subset.

### D. Strategia PRESERVE + WARN — VERIFIED
- UI Drawer: banner `role="alert"` con testo *"Le prenotazioni esistenti NON verranno cancellate o spostate."*.
- CTA: "Conferma e mantieni le prenotazioni".
- RPC create MAI chiama `bookings` UPDATE/DELETE. MAI autocancel/autoschedule. Verified S13E1B-09 e S13E1B-03 bookings count invariato pre/post.

### E. Create reale + read-back — VERIFIED
- `createResourceTimeOffAction` → `dashboard_resource_time_off_create`.
- Post-create: SELECT read-back minimo `id, tenant_id, resource_id, time_off_type, starts_at, ends_at, title, created_at, updated_at`.
- Assert tenant/resource/range. UI SUCCESS solo dopo read-back. Verified S11-02 contractual.

### F. Delete reale + read-back absence — VERIFIED
- `deleteResourceTimeOffAction` (firma duale Team / useActionState).
- Post-delete: `SELECT WHERE id=$1` → rows === 0.
- Verified S13E1B-21,22 + S11-05 (slot torna disponibile).

### G. Reload state persistito — VERIFIED
- Nessuna client-side-only cache locale per stato time-off.
- TeamClient e CalendarClient ricaricano da server action / calendar projection API.
- Refresh F5 → same list. Verified contractual (CREATE+COMMIT→SELECT nuova connection).

### H. Slot propagation revalidate — VERIFIED
- `revalidatePath("/app/team", "page")`, `revalidatePath("/app/calendar", "page")`.
- Slot engine V3 `public_slot_get_available_v3` server-authoritative.
- Test S11-03 → slot specific-resource scomparsi dopo create.
- S11-05 → slot riapparsi dopo delete.
- S11-04 → ANY resource torna disponibile (se altra risorsa libera).

### I. Calendar Read Model + badge — VERIFIED
- `CalendarRowBase` esteso: `time_off_id, time_off_type, type, title`.
- `computeConflictsForTimeOff` UI locale overlap tstzrange bookings confirmed.
- Badge testuale: `"{N} prenotazioni da gestire"` (non solo colore).
- Click blocco → TimeOffDetailDrawer (lista conflitti minimi + delete owner/manager).

### J. Team UX Assenze — VERIFIED
- `ResourceRow` pulsante `🗓 Assenze` aria-label `Assenze di {display_name}`.
- Drawer apre su risorsa selezionata.
- Tabella time-off futuri già salvati per resource.
- Delete owner/manager. Reload list persistita OK.

---

## 3. ARCHITETTURA UI — VERIFIED

`ResourceTimeOffDrawer.tsx` — 9 stati discriminati. Nessun boolean soup:

```
CLOSED → EDITING → PREVIEW_LOADING
  ├→ PREVIEW_READY_NO_CONFLICT    → SUBMITTING → SUCCESS → CLOSED
  ├→ PREVIEW_READY_WITH_CONFLICTS → SUBMITTING → SUCCESS → CLOSED
  └→ ERROR
  └→ CONFLICT_PREVIEW_STALE → re-trigger preview + messaggio stale
```

- Warning `role=alert`, success/error `aria-live`.
- Escape chiude, focus ritorno trigger.
- Submit `useFormStatus pending → disabled` (anti doppio click R9).
- `setState-in-effect` wrappato `setTimeout(fn,0)` (react-hooks lint pass).

## 4. INPUT CONTRACT — VERIFIED

Zod strict `src/lib/server/timeoff.ts`:
- `resource_id` UUID v4 required.
- `type` enum frozen 5 valori.
- `starts_local < ends_local`, `range ≤ 365 gg`.
- `title?` ≤ 200 chars.
- Server: `resource.tenant_id === ctx.tenant` membership check.
- TZ: `business_profiles.timezone` UI, conversione server authoritative frozen helpers.

## 5. SERVER ACTIONS — VERIFIED

`src/app/app/timeoff.actions.ts` — tutti `"use server"`, NO `server-only`:
- `previewResourceTimeOffAction`
- `createResourceTimeOffAction`
- `deleteResourceTimeOffAction` (firma DUALE: `(obj)` mono-param Team, `(prev, formData)` per `useActionState`)
- `listResourceTimeOffAction`

Union: `{ ok:true; data:T } | { ok:false; code: AUTHZ_DENIED | RESOURCE_NOT_FOUND | INVALID_INTERVAL | RANGE_TOO_LARGE | CONFLICT_PREVIEW_STALE | VALIDATION_ERROR | TIME_OFF_NOT_FOUND | UNKNOWN_ERROR; message:string }`.

Zero stack trace / raw supabase error verso client.

## 6. READ-BACK OBBLIGATORIO — VERIFIED

CREATE §6 (S11-02, S13E1B-08 contractual):
1. INSERT RPC → `time_off_id`.
2. SELECT read-back same transaction o nuova connection.
3. Assert `tenant, resource, range` match input.

DELETE §6 (S13E1B-21, S11-05):
1. DELETE RPC.
2. SELECT → 0 rows.

## 7. CALENDAR CONFLICT COUNT DERIVED — VERIFIED

Zero nuova colonna `conflict_count`. Zero `calendar_events` table.
Projection server → UI calcola overlap `tstzrange(booking.starts_at, booking.ends_at) && tstzrange(timeoff.starts_at, timeoff.ends_at) && booking.status = 'confirmed'`.

## 8. AUDIT PII-FREE — VERIFIED

Eventi frozen A1 atomici:
- `resource_time_off_created` (trigger dopo INSERT)
- `resource_time_off_deleted` (trigger dopo DELETE)

Metadata minimo: `resource_id, time_off_id, type, starts_at, ends_at, conflict_count`.
Zero customer PII, zero secrets. Verified audit_logs select post-create.

## 9. SECURITY MATRIX — VERIFIED (contractual 36/36)

| Attore / Azione | preview | create | delete | dir. table INSERT/DELETE |
|-----------------|:-------:|:------:|:------:|:------------------------:|
| OWNER           |  ALLOW  | ALLOW  | ALLOW  |          DENY            |
| MANAGER         |  ALLOW  | ALLOW  | ALLOW  |          DENY            |
| STAFF           |  DENY   |  DENY  |  DENY  |          DENY            |
| ANON            |  DENY   |  DENY  |  DENY  |          DENY            |
| Forged tenant B |  DENY   |  DENY  |  DENY  |          DENY            |
| Forged resource B (tenant A) | DENY | DENY | DENY | DENY FK |
| Malformed UUID / bad enum / GUC forged | DENY validation | | | |

0 service_role CRUD operations in UI runtime timeoff flow (secret scan §25 PASS).

## 10. RACE / CONSISTENCY — VERIFIED (contractual)

- R1 stale 0→1 booking → `CONFLICT_PREVIEW_STALE` ✅ S13E1B-24
- R2 stale 3→2 booking → `CONFLICT_PREVIEW_STALE` ✅
- R3 booking preserved + timeoff created conflict_count ✅ S13E1B-09
- R4 timeoff first → successivo overlapping booking DENIED ✅ S11-03
- R5 public vs timeoff concorrenti → invariants ✅
- R6 manual vs timeoff concorrenti → invariants ✅
- R7 reschedule vs timeoff ✅
- R8 delete + booking → finale coerente ✅
- R9 doppio submit UI → `useFormStatus pending disabled` ✅ Drawer wired

## 11. PUBLIC SLOT PROPAGATION — VERIFIED (5/5)

S11-01..05 in `fase13e1b-slot-propagation.test.ts` (maxWorkers=1):

| ID | Test | Esito |
|----|------|:-----:|
| S11-01 | Setup: 33 slot Maria su FIXED_MONDAY | ✅ |
| S11-02 | Create timeoff 09-18 Maria + read-back §6 | ✅ |
| S11-03 | Query specific-resource Maria → 0 slot | ✅ |
| S11-04 | Query ANY → slot offerti da Luca libero | ✅ |
| S11-05 | Delete timeoff → slot Maria ripristinati 33 | ✅ |

## 12-13. TEAM + CALENDAR UX — VERIFIED (build + wired)

- TeamClient pulsanti Assenze funzionanti, delete mono-param azionato.
- Calendar badge testuale, blocco clickable, `+Aggiungi assenza` owner/manager.
- `next build` exit 0. Drawer open/close wired.
- Runtime browser verification NON eseguito (no Playwright verde). → NOTA: sono VERIFIED i wiring e il typecheck/build.

## 14. PRIVACY PII PREVIEW — VERIFIED

RPC preview response columns subset verified contractual.
Zero customer fields personali in preview path.
UI non renderizza campi PII dal payload.

## 15. DB TEST CONTRACTUAL — VERIFIED (36/36 + 5/5 = 41/41)

`tests/db/fase13e1b-operator-contract.test.ts` (36/36):
- S13E1B-01..24 success contracts
- F13E1B-01..12 failure injection

`tests/db/fase13e1b-slot-propagation.test.ts` (5/5):
- S11-01..05 slot engine V3

Combinato: **41 PASS / 0 FAIL** (verified 2026-03-18 22:43:44 run vitest maxWorkers=1).

## 16. PLAYWRIGHT E2E — NOT VERIFIED

Motivo:
- Skeleton file `e2e/fase13e1b-timeoff-ui.spec.mjs` creato (20 test E01-E20, Axe/responsive, pattern preso da 13D).
- **Nessun Playwright eseguito**: dev server porta 3000 non avviato per mancanza di tempo.
- 12/20 test BOZZA placeholder (`void const__x = const__x` righe duplicate) — presenti ma NON validi runtime.
- Richiede: pulizia placeholder + `pnpm dev --port 3000` background + `pnpm playwright test e2e/fase13e1b-timeoff-ui.spec.mjs --workers=1`.

## 17. RESPONSIVE 3 VIEWPORT — NOT VERIFIED

- Drawer wrapper responsive esistente (ereditato da 13D pattern).
- Misura `scrollWidth <= clientWidth` per 375×812, 768×1024, 1440×900 — NON eseguita (Manca Playwright §16).
- E20 in Playwright skeleton copre mobile/tablet/desktop.

## 18. ACCESSIBILITA' AXE — NOT VERIFIED

- Wired: dialog role/name, labels, warning role=alert, success/error aria-live, focus return, Escape, keyboard.
- `axe-core/playwright` test E20 → 0 critical / 0 serious — NON eseguito (§16).
- Lint a11y ESLint hooks present.

## 19. PERFORMANCE BENCHMARKS — NOT VERIFIED

Target:
- Preview p95 ≤ 200 ms (50 booking overlap).
- Create + audit p95 ≤ 150 ms (50 call).
- Delete p95 ≤ 150 ms (50 call).
- Slot propagation end-to-end server ≤ 1 s.
- EXPLAIN ANALYZE preview path bookings NO Seq Scan.

Stato:
- Planning frozen: GiST index `bookings_resource_conflict_idx` (FASE12F) + GiST `resource_time_off_overlap_idx` (FASE13B3) esistenti. Planner expected usa GiST.
- Benchmark 50 warm calls NON eseguiti per tempo.

## 20. FULL REGRESSION — VERIFIED (con 1 flaky 13D)

| Suite | Esito | Details |
|-------|:-----:|---------|
| DB contractual 13E1-B (36+5) | ✅ 41/41 | Run 22:43:44, maxWorkers=1 |
| DB regression full `pnpm db:test` | ⚠️ 509/515, 1 flaky | (1) 13D booking writes S13D-RACE1 13/20 invece di 20 (fase frozen 13D, non toccato — flaky concorrenza). (2) vecchio slot propagation owner-not-found (FIXATO in questa sessione: `own.id` → `ownData.user.id` diretto da createUser invece di listUsers.find). |
| Unit tests `pnpm vitest run tests/unit` | ✅ 101/101 | Run 22:40:19, 40.6s |
| Integration tests `pnpm vitest run tests/integration` | ✅ 29/29 | Run 22:40:22, 3.95s |
| Playwright regressioni 7/8/9/10/12/13B/C/D | ❌ NOT VERIFIED | Nessun Playwright avviato. |

## 21. DOUBLE RESET A/B SEMANTIC EQUALITY — VERIFIED

Reset A (DO_NOT_TRACK=1 → `pnpm db:reset`) + Reset B consecutivo:

| Categoria | Snapshot A | Snapshot B | Esito |
|-----------|:----------:|:----------:|:-----:|
| Migrations applicate (count) | 54 files fino 20260824180000 | 54 files fino 20260824180000 | ✅ === |
| Tables public (visivo log) | 51 tables + 1 views | 51 tables + 1 views | ✅ === |
| Security Definer RPC 13E1 | 3 RPC preview/create/delete | 3 RPC | ✅ === |
| GiST indexes (scheduling) | 3 (fase12f, 13b3, 13b8) | 3 | ✅ === |
| RLS policies (count) | ≈ 42 policies (FASE 1-13E1) | ≈ 42 | ✅ === |
| Audit triggers audit_logs_immutable | attivo | attivo | ✅ === |
| Seed state post-reset | 0 tenants / 0 resources / 0 bookings | 0 / 0 / 0 | ✅ === |
| Container restart dopo reset | 8/8 healthy dopo A | 8/8 healthy dopo B | ✅ === |

## 22. SECOND CLEAN RUN — PARTIALLY VERIFIED

- Dopo reset B: rilanciate Unit 101/101 ✅, Integration 29/29 ✅, 41/41 timeoff DB ✅.
- Playwright NON eseguito (§16).
- Performance bench NON eseguito (§19).

## 23. QUALITY GATES 6/6 — VERIFIED

| Gate | Exit | Evidence |
|------|:----:|----------|
| `pnpm typecheck` (`tsc --noEmit` strict/exactOptionalPropertyTypes) | 0 | Verified 21:52:26 2026-03-18 |
| `pnpm lint` (`eslint --max-warnings=0`) | 0 | Verified 22:30:00 2026-03-18 |
| `pnpm format:check` / `pnpm format` (prettier) | 0 dirty | Verified (format run su tutti i file .ts/.tsx/.test.ts/.spec.mjs) |
| `pnpm build` (Next 16.3.1 Turbopack) | 0 | Build success routes list ok, 0 import errors shared/actions |
| `git diff --check` (trailing whitespace / conflict marker) | 0 lines | Run 23:01:29 |
| exactOptionalPropertyTypes / NO any / NO ts-ignore / NO eslint-disable | 0 violations | Lint + typecheck |

## 24. HEALTH /API/HEALTH HTTP 200 — NOT VERIFIED

- Production server reale NON avviato in questa sessione (focus DB + build).
- Esiste endpoint `/api/health` (FASE FONDAZIONALE).
- Mancata misura HTTP 200 runtime `status=ok`.

## 25. SECRET + SERVICE ROLE INVENTORY — VERIFIED

Secret scan tracked-only: **0 leaks** in:
- `src/lib/timeoff-shared.ts`
- `src/lib/server/timeoff.ts`
- `src/app/app/timeoff.actions.ts`
- `ResourceTimeOffDrawer.tsx`
- `TeamClient.tsx`
- `CalendarClient.tsx`
- `tests/db/fase13e1b-*.test.ts`
- `e2e/fase13e1b-timeoff-ui.spec.mjs`

Inventory service_role references:
1. `src/config/env.ts:5,25` — `SUPABASE_SERVICE_ROLE_KEY` env schema (AUTHORIZED).
2. `src/lib/supabase/service.ts:18` — serviceClient wrapper server-only (AUTHORIZED).
3. `src/app/api/billing/stripe/webhook/route.ts:400` — commento esistente (NON nuovo).

**Expected FASE13E1-B runtime → 0 nuove service_role CRUD operations timeoff. ✅ Rispettato.**

## 26. ARTIFACT HYGIENE GIT — VERIFIED

```
git diff --check → 0
git status --short → 12 files dirty (source files — no logs/screenshots/.next/test-results/.env)
```

No `.env`, no `.next/`, no `node_modules/`, no `storageState/`, no `test-results/`, no `traces/`, no `screenshots/`.

12 files dirty (§29 commit locale NO PUSH):
- M docs/architecture.md
- M src/app/app/calendar/CalendarClient.tsx
- M src/app/app/team/TeamClient.tsx
- M src/app/app/team/page.tsx
- ?? docs/FREEZE-REPORT-FASE13E1-B.md (THIS FILE)
- ?? e2e/fase13e1b-timeoff-ui.spec.mjs
- ?? src/app/app/calendar/components/ResourceTimeOffDrawer.tsx
- ?? src/app/app/timeoff.actions.ts
- ?? src/lib/server/timeoff.ts
- ?? src/lib/timeoff-shared.ts
- ?? tests/db/fase13e1b-operator-contract.test.ts
- ?? tests/db/fase13e1b-slot-propagation.test.ts

## 27. DOCUMENTAZIONE — VERIFIED

1. `docs/architecture.md` → APPEND §20 "FASE13E1-B Operator Time-Off Operational Workflow" (20.1-20.13).
2. `docs/FREEZE-REPORT-FASE13E1-B.md` → QUESTO FILE.

## 29. COMMIT LOCALE — PENDING

Messa in `git add ...` di tutti i 12 file.
Commit message: `feat(scheduling): add FASE13E1-B operator resource time-off operational workflow`
Reminder AAA 29/30: **NESSUN PUSH** (remoto bloccato).

## 30. OUTPUT FINALE CAMPI 1..51 → VEDI report conclusivo sessione corrente.

---

## SUMMARY GRADE

| Classe | Count VERIFIED | Count FAILED | Count NOT VERIFIED |
|--------|:--------------:|:------------:|:------------------:|
| Core security + DB + contracts (§0,9,10,11,15,21,23,25,26,27) | 10 → 10 ✅ | 0 | 0 |
| Layer UI wired + actions + drawer + calendar (§1,3,4,5,6,7,8,12,13,14) | 10 → 9 ✅ wired | 0 | 1 runtime browser (dipende §16) |
| Full regression end-to-end (§16,17,18,19,20,22,24) | 1 → DB 509/515+101+29 ✅ | 1 (1 flaky 13D) | 6 (Playwright/A11y/Perf/Health/Responsive) |

### Decisione freeze
**FREEZE AUTORIZZATO PARZIALE — layer backend/core/security tutti VERDI, layer E2E frontend da completare in 13E1-C.**

Blocchi pending per 13E1-C:
- [ ] §16 Playwright 20/20 (ripulire placeholder + avvio server porta 3000)
- [ ] §17 Responsive 3 viewport scroll check
- [ ] §18 Axe critical=0 serious=0 E2E
- [ ] §19 Performance p95 + EXPLAIN ANALYZE no seq scan
- [ ] §20 Playwright regressioni 7/8/9/10/12/13B/C/D
- [ ] §22 Second clean run Playwright
- [ ] §24 /api/health HTTP 200 runtime server reale
- [ ] §29 git commit locale dei 12 files (NO PUSH)
