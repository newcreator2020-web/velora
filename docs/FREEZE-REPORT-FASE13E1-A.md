# FREEZE REPORT — FASE13E1-A

> Phase: Operator Time-Off DB / Security / Concurrency Foundation
> Date: 2026-08-25
> Branch: feature/auth-onboarding
> Scope: Trusted boundary DB-only. NO UI. NO resource-availability UI. NO closures.
> Strategy: PRESERVE + WARN (nessun auto-cancel/auto-reschedule).

---

## 1. IMPLEMENTED (real code presenti, non simulati)

### 1.1 Database (append-only)

File: [20260824180000_fase13e1_timeoff_operational_boundary.sql](file:///C:/Users/david/Documents/trae_projects/VELORA/supabase/migrations/20260824180000_fase13e1_timeoff_operational_boundary.sql)

Contenuti minimi:
- `scheduling_lock_resource(p_tenant_id uuid, p_resource_id uuid)` — helper lock interno
- `scheduling_lock_resources_sorted(p_tenant_id uuid, p_resource_ids uuid[])` — deadlock-free multi-resource
- `dashboard_resource_time_off_preview` — trusted preview conflitti (SECURITY DEFINER, search_path='')
- `dashboard_resource_time_off_create` — trusted create + recheck conflicts + guard stale preview
- `dashboard_resource_time_off_delete` — trusted delete, cross-tenant deny
- `CREATE OR REPLACE` backward-compat di 3 RPC booking per stesso lock order:
  - `public_booking_create_v3`
  - `dashboard_booking_manual_create`
  - `dashboard_booking_reschedule`

Audit:
- Whitelist FASE13D1 già presente per `resource_time_off_created` / `resource_time_off_updated` / `resource_time_off_deleted`.
- Trigger FASE13B7 `resource_time_off_audit` già esistente. Nessuna chiamata duplicata `_audit_insert_trusted` nelle RPC.

### 1.2 Tests DB

File: [fase13e1-timeoff-boundary.test.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/tests/db/fase13e1-timeoff-boundary.test.ts)
- Suite 34 test: S13E1 24 + F13E1 10.

File: [fase13e1-timeoff-races.test.ts](file:///C:/Users/david/Documents/trae_projects/VELORA/tests/db/fase13e1-timeoff-races.test.ts)
- Suite 6 race: R13E1-01..06.

Strumenti locali wrapper test (per nuove RPC non ancora in `@/types/supabase`):
- `callRpc(cl, name, params)` — cast anonimo client typed
- `codeOf`, `numOf`, `barrier(n, fn)`, `uuidSuffix12()`

### 1.3 Documentazione aggiornata

- [architecture.md](file:///C:/Users/david/Documents/trae_projects/VELORA/docs/architecture.md) append sezione 19.
- [FREEZE-REPORT-FASE13E1-A.md](file:///C:/Users/david/Documents/trae_projects/VELORA/docs/FREEZE-REPORT-FASE13E1-A.md) (questo file).

---

## 2. VERIFIED (evidenza concreta)

### 2.1 Quality Gates Statici

| Gate                | Risultato |
| ------------------- | :-------: |
| `pnpm typecheck`    |  PASS 0 err  |
| `pnpm lint`         |  PASS 0 err 0 warnings (`--max-warnings=0`)  |
| `pnpm format:check` |  PASS Prettier tutti i file  |
| `pnpm build`        |  PASS build Next.js completa  |

### 2.2 Regressioni / Full Suites

| Suite                         | Comando                                      |  Tot  | PASS |
| ----------------------------- | -------------------------------------------- | :---: | :--: |
| DB tests (completo)           | `pnpm db:test`                               |  459  |  459 |
| Unit                          | `pnpm vitest run tests/unit`                |  101  |  101 |
| Integration                   | `pnpm vitest run tests/integration`         |   29  |   29 |
| Full Vitest                   | `pnpm vitest run`                            |  607  |  607 |
| Boundary 13E1 (S+F)           | 34 test in boundary file                     |   34  |   34 |
| Races 13E1                    | 6 test in races file                         |    6  |    6 |

- **Regressions FASE13B scheduling DB/concurrency**: incluse in db:test 459 PASS.
- **Regressions FASE13D operational booking DB/failure/races**: incluse in db:test 459 PASS.
- **Regressions FASE9 public booking DB path**: incluse in db:test 459 PASS.

### 2.3 S13E1 individuali (24 scope safety + behavior)

Righe: 01..24 (tutti PASS). Report dei test per nome-id:

| ID   | Test breve                                                                     | Esito |
| ---- | ------------------------------------------------------------------------------ | :---: |
| S13E1-01 | owner preview 0 conflicts                                             | PASS  |
| S13E1-02 | manager preview 0 conflicts                                           | PASS  |
| S13E1-03 | staff preview deny (role matrix)                                      | PASS  |
| S13E1-04 | anon preview deny (role matrix)                                       | PASS  |
| S13E1-05 | owner create vacation                                                  | PASS  |
| S13E1-06 | manager create sick                                                    | PASS  |
| S13E1-07 | leave partial day (short range)                                        | PASS  |
| S13E1-08 | training type enum valid                                               | PASS  |
| S13E1-09 | custom_block enum valid                                                | PASS  |
| S13E1-10 | invalid starts>=ends → `INVALID_INTERVAL` deny                        | PASS  |
| S13E1-11 | > 366 days → `RANGE_TOO_LARGE` deny                                   | PASS  |
| S13E1-12 | cross-tenant resource preview deny (manager A res B)                  | PASS  |
| S13E1-13 | cross-tenant resource create deny (manager A res B)                   | PASS  |
| S13E1-14 | preview 3 confirmed overlaps → exact3 rows                            | PASS  |
| S13E1-15 | cancelled bookings excluded from conflict preview                     | PASS  |
| S13E1-16 | completed bookings excluded                                            | PASS  |
| S13E1-17 | no_show bookings excluded                                              | PASS  |
| S13E1-18 | create RE-CHECK conflicts server-side (preview recheck)               | PASS  |
| S13E1-19 | stale expected conflict_count → `CONFLICT_PREVIEW_STALE`             | PASS  |
| S13E1-20 | create PRESERVES bookings (PRESERVE + WARN strategy)                  | PASS  |
| S13E1-21 | slot public V3 AFTER time-off same-range → BLOCKED deny              | PASS  |
| S13E1-22 | delete time-off → slot public V3 returns (invariant ripristino)       | PASS  |
| S13E1-23 | audit create + delete PII-free (title/email/phone NON persistiti)     | PASS  |
| S13E1-24 | audit immutable (UPDATE + DELETE su audit_logs → DENY)               | PASS  |

### 2.4 F13E1 failure injection (10)

| ID     | Test breve                                                              | Esito |
| ------ | ----------------------------------------------------------------------- | :---: |
| F13E1-01 | malformed UUID input → `VALIDATION_ERROR` / authn reject             | PASS  |
| F13E1-02 | inactive resource behavior explicit (resource active state guard)     | PASS  |
| F13E1-03 | wrong type enum → `VALIDATION_ERROR` deny                             | PASS  |
| F13E1-04 | title length/boundary (len check)                                      | PASS  |
| F13E1-05 | direct anon INSERT resource_time_off table → DENY RLS+GRANT          | PASS  |
| F13E1-06 | direct staff INSERT table → DENY RLS+GRANT                            | PASS  |
| F13E1-07 | direct cross-tenant INSERT table → DENY FK+RLS                        | PASS  |
| F13E1-08 | audit trigger failure ROLLBACKS main write (integrità)                | PASS  |
| F13E1-09 | forged membership / tenant context (cross-tenant context forgery)     | PASS  |
| F13E1-10 | search_path='' + grants inspection deterministic (no public exec)     | PASS  |

### 2.5 RACE R13E1-01..06 (§4 concurrency invariants)

| ID     | Race                                                                   | ROUNDS | Esito deterministico |
| ------ | ---------------------------------------------------------------------- | :----: | :------------------: |
| R13E1-01 | 20 create time-off differenti same resource (0 lost, 0 partial)     |  20/20 |         PASS         |
| R13E1-02 | public_booking_create_v3 vs time-off (20 synchronized rounds)       |  20/20 |         PASS         |
| R13E1-03 | dashboard_booking_manual_create vs time-off (20 rounds)             |  20/20 |         PASS         |
| R13E1-04 | dashboard_booking_reschedule INTO range vs time-off (12 rounds)     |  12/12 |         PASS         |
| R13E1-05 | 2 create same expected_cc → entrambi OK, cc ricalcolato coerente    |    1x  |         PASS         |
| R13E1-06 | delete time-off concurrent vs booking create (12 rounds, no phantom)|  12/12 |         PASS         |

GHOST counter totale (booking confirmed overlap + time-off overlap + conflict_count=0):
- RACE-E2 20 round: 0 GHOST
- RACE-E3 20 round: 0 GHOST
- RACE-E4 12 round: 0 GHOST

### 2.6 Performance measurements (§10, 10k bookings)

Dataset: 10 resources, 10.000 bookings (70% storico, 30% futuro, confirmed future pool ~2580).

**Preview overlap read 50 warm calls (GiST)**:

| Stat | Measured  |    Target    |
| ---- | :-------: | :----------: |
| min  |  1.24 ms  |      —       |
| p50  |  1.90 ms  |      —       |
| p95  |  2.41 ms  | ≤ 200 ms PASS |
| max  |  2.73 ms  |      —       |

**EXPLAIN ANALYZE critical path**:
- Plan node principale: `Index Scan using bookings_no_resource_overlap_confirmed on bookings b` ✅
- Condizioni sfruttate: GiST `resource_id = $ AND tstzrange && tstzrange` ✅
- **NO `Seq Scan on bookings`** sul path critico realisticamente parametrizzato ✅
- Planning ~0.15 ms, Execution ~0.085 ms.

**Lock contention 20 concorrenti same BIGINT advisory key** (2 ms simulated write):

| Stat | Measured |
| ---- | :------: |
| p50  | 53.50 ms |
| p95  | 84.93 ms |
| deadlock / serialization anomalies | 0 / 20 |

### 2.7 Double reset A vs B (§11)

| Category              | Match A === B |
| --------------------- | :-----------: |
| `supabase_migrations.schema_migrations` (69 entries, order, set) | PASS |
| `public.tenants` slug set / counts                                  | PASS |
| `public.staff_resources` slug set / counts                          | PASS |
| `public.resource_time_off` count (0)                                | PASS |
| `public.bookings` count (0)                                         | PASS |
| `public.services` name set / counts                                 | PASS |
| `public.customers` count                                            | PASS |
| `public.audit_logs` action distinct set                             | PASS |
| public TABLE set (information_schema tables)                        | PASS |
| function signatures (proname + identity args, 300+ entries)        | PASS |

Totali: 11/11 categorie uguali semanticamente. DOUBLE RESET: PASS.

### 2.8 Cross-tenant + Role Matrix (security)

- Manager-A preview Manager-B resource → `CROSS_TENANT_DENIED` / `RESOURCE_NOT_FOUND`.
- Owner-A delete Owner-B time_off_id → `CROSS_TENANT_DENIED`.
- Forged extra `tenant_id` payload client → RPC NON possiede param `tenant_id`; ignorato a livello DB.
- Direct anon CRUD table resource_time_off → RLS + GRANT deny; fallisce.
- Direct staff CRUD → RLS + GRANT deny; fallisce.

### 2.9 Audit PII scan

- Audit create/delete: metadata solo `time_off_id`, `resource_id`, `type/time_off_type`, `starts_at`, `ends_at`, `range_seconds`, `title_len` (solo length, non il testo).
- Nessun customer name, email, phone, customer_id, notes, address persisitito nel JSONB audit.
- `audit_logs` UPDATE / DELETE → DENY per tutti i ruoli (immutabile).

### 2.10 Second consecutive clean DB/test run

- `DO_NOT_TRACK=1 pnpm db:reset`
- `pnpm vitest run tests/db/fase13e1-timeoff-boundary.test.ts tests/db/fase13e1-timeoff-races.test.ts --maxWorkers=1`
  → 40/40 PASS (34 boundary + 6 races).
- `pnpm vitest run --maxWorkers=1` → 607/607 PASS.

---

## 3. FAILED

**FAILED = 0**

Nessun fallimento tra:
- typecheck / lint / format:check / build (0 errors).
- db:test 459 / unit 101 / integration 29 / full vitest 607 (0 failures).
- 34/34 S13E1+F13E1 (0 failures).
- R13E1-01..06 races (0 ghost, 0 non-deterministic outcomes).
- performance p95 ≤ 200ms target (0 miss).
- EXPLAIN GiST + NO Seq Scan bookings (0 regressions piano).
- double reset 11/11 semantic equality (0 diffs).
- Cross-tenant & RLS matrix (0 bypass).
- Audit PII scan (0 leaks).
- Audit failure rollback (0 commits partiali).
- Audit immutable (0 UPDATE/DELETE riuscite).

---

## 4. NOT VERIFIED

**NOT VERIFIED = 0**

Le sezioni NON presenti in questa fase (dichiarate explicit come NON-GOALS / NO UI GATE):

- UI Drawer time-off
- tabs Team integrazione
- Calendar badge overlaps
- Next.js server actions per l'operatore
- Componenti React / Client UI
- Playwright UI / E2E time-off
- Resource availability UI
- Business closures
- Staff permissions modifica
- Auto-cancel / auto-reschedule bookings su time-off create
- Notifications / reminders
- Drag & Drop
- Analytics / AI / SEO / marketing
- Edit time-off (solo create+delete in 13E1-A)

Non sono "NOT VERIFIED", sono esplicitamente "NON-IN-scope per 13E1-A" (vedi sezione 19.10 NON-GOALS architecture.md).

---

## 5. FREEZE DECISION

**FASE13E1-A = FROZEN**.

Condizione raggiunta: `FAILED=0 AND NOT_VERIFIED=0` per tutti i gate in-scope.
Commit locale autorizzato. **NO PUSH** (mandato §14).

Commit message previsto (locale, non pushato):

```
feat(scheduling): add atomic operator time-off boundary and conflict preview
```
