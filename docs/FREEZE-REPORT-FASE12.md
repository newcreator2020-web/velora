# FREEZE REPORT — FASE 12

> **Scheduling & Resource Model Foundation**
>
> Ambiente: Windows · Supabase Local · Turbopack · Postgres 15
>
> Baseline pre-freeze HEAD (FASE11B frozen): `348478c29499aff7c1d2b11b6442eb1d9f849efc`
>
> Freeze point HEAD (FASE12 commit hash): `d64b9f3454eedf19e76913f2821ed5dc679c50a6`
>
> Protocollo: Double Reset Deterministico + Second Clean Run + Regressioni Complete (FASE6-12 DEV/PROD)
>
> Dichiarazione congelamento: solo se FAILED=0 e NOT VERIFIED=0

---

## 1. Elenco Migrazioni FASE12 (9 file, append-only)

Ordine di applicazione:

| ID  | Filename migration                                      | Purpose / Sezione                                                                 |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 12A | `20260822210000_fase12a_staff_resources.sql`            | Crea tabella `public.staff_resources` + indici + RLS FORCE + policy base          |
| 12B | `20260822210500_fase12b_default_resource_provision.sql` | Trigger `trg_tenants_create_default_staff_resource` — slug='principale' on INSERT tenant. SECURITY DEFINER wrapper per provisioning trusted. |
| 12C | `20260822211000_fase12c_staff_resource_services.sql`    | Crea tabella M2M `public.staff_resource_services`, PK composita, FK composite, RLS. |
| 12D | `20260822211500_fase12d_bookings_resource_id.sql`       | Aggiunge `bookings.resource_id` FK, CHECK `bookings_confirmed_resource_not_null`, FK composite RESTRICT. |
| 12E | `20260822212000_fase12e_exclude_concurrency_transition.sql` | Crea vincolo `bookings_no_resource_overlap_confirmed` GiST per-Resource; preservato legacy EXCLUDE per-Service. |
| 12F | `20260822212500_fase12f_slot_v2_rpc.sql`                | `public_slot_get_available_v2` SECURITY DEFINER. Outer=business_availability, Inner=eligible_resources, cross-join 30-min steps, anti-join confirmed. |
| 12G | `20260822213000_fase12g_booking_v2_rpc.sql`             | `public_booking_create_v2` SECURITY DEFINER. Auto-select earliest-available resource se p_resource_id NULL. |
| 12H | `20260822213500_fase12h_audit_and_final_rls.sql`        | Completamento RLS staff_resources/services, trigger audit per tabelle nuove, GRANT anon solo ai wrap RPC. |
| 12I | `20260822214000_fase12i_audit_action_whitelist.sql`     | Whitelist eventi audit FASE12: resource.create, resource.update, resource.delete, resource_service.link, resource_service.unlink, booking_v2.confirmed, booking_v2.failed, seed.default_resource. |

---

## 2. Schema Summary

### 2.1 `public.staff_resources` — columns

```
id                    UUID PRIMARY KEY gen_random_uuid()
tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
slug                  TEXT NOT NULL
display_name          TEXT NOT NULL
linked_membership_id  UUID REFERENCES memberships(id) ON DELETE SET NULL
active                BOOLEAN NOT NULL DEFAULT true
bookable              BOOLEAN NOT NULL DEFAULT true
sort_order            INTEGER NOT NULL DEFAULT 0
created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```
- UNIQUE `(tenant_id, slug)`
- INDEX BTREE `(tenant_id, active, bookable, sort_order)`

### 2.2 `public.staff_resource_services` — PK & keys

```
resource_id  UUID NOT NULL REFERENCES staff_resources(id) ON DELETE CASCADE
service_id   UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE
tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
active       BOOLEAN NOT NULL DEFAULT true
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```
- **PRIMARY KEY = `(resource_id, service_id)`**
- FK composite safety `(tenant_id, service_id)` REFERENCES services(tenant_id, id)
- FK composite safety `(tenant_id, resource_id)` REFERENCES staff_resources(tenant_id, id)

### 2.3 `public.bookings` — estensione FASE12D

| Elemento | Valore |
| --- | --- |
| Nuova colonna | `resource_id UUID NULLABLE` |
| FK | `REFERENCES staff_resources(id) ON DELETE RESTRICT` — protegge le risorse referenziate da booking CONFIRMED da cancellazione accidentale |
| CHECK | `bookings_confirmed_resource_not_null`: `CHECK (status <> 'confirmed' OR resource_id IS NOT NULL)` |
| EXCLUDE GiST | `bookings_no_resource_overlap_confirmed`: `EXCLUDE USING GIST (tenant_id WITH =, resource_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'confirmed')` — per-Resource concorrenza |
| Legacy EXCLUDE preservato | `bookings_no_overlap_confirmed` basato su service_id (safety-net transitorio) — rimosso in release post-backfill |

---

## 3. RLS Summary

### 3.1 Tabella `public.staff_resources`
- RLS ENABLED, FORCE RLS enabled (per user_rules §9).
- Policy `staff_resources_select_tenant_public`: anon/authenticated SELECT se tenant matching pubblicato.
- Policy `staff_resources_owner_modify`: INSERT/UPDATE/DELETE via role OWNER/MANAGER/SUPER_ADMIN membership.

### 3.2 Tabella `public.staff_resource_services`
- RLS ENABLED, FORCE RLS enabled.
- Pattern SELECT pubblico + mutazione ruoli staff autorizzati (stesso boundary).

### 3.3 Tabella `public.bookings` + column `resource_id`
- **Nessun nuovo accesso anonimo diretto** — la revoca FASE11B (REVOKE SELECT anon FROM bookings) resta in vigore.
- `resource_id` viene scritto esclusivamente dalle RPC `public_booking_create_v2` SECURITY DEFINER (utenti anon/frontend) o da endpoint dashboard autorizzati authenticated.
- Policy `bookings_insert_owner` e simili verificano membership prima di permettere scrittura diretta.

---

## 4. Audit Events Added

Whitelist eventi audit introdotti con migration 12I (`public_audit_action_whitelist` per FASE12):

| Audit Action | Trigger | Tabelle / Scope |
| --- | --- | --- |
| `resource.create` | INSERT staff_resources | Creazione manuale operatore extra (oltre default auto-provisioned) |
| `resource.update` | UPDATE staff_resources | Modifica display_name, active, bookable, linked_membership_id, sort_order |
| `resource.delete` | DELETE staff_resources | Rimozione risorsa (solo se nessun booking referenziato grazie a FK RESTRICT) |
| `resource_service.link` | INSERT staff_resource_services | Assegnazione esplicita servizio ↔ operatore |
| `resource_service.unlink` | DELETE staff_resource_services | Revoca legame M2M, ritorna regola Empty=ALL se non più righe |
| `booking_v2.confirmed` | INSERT bookings status='confirmed' via RPC V2 | Transazione V2 di successo (include resource_id) |
| `booking_v2.failed` | ROLLBACK/RPC raise eccezione V2 | Log fallimento assegnazione (no resource_id disponibile, overlap, ecc.) |
| `seed.default_resource` | Trigger 12B provision | Audit della provisioning automatica al CREATE tenant (da distinguere da create manuale) |

---

## 5. RPCs Added — Public Interfaccia

Tre interfacce pubbliche (SECURITY DEFINER, search_path='' hardcoded, `SET search_path = ''` in signature):

1. **`public_slot_get_available_v2(p_tenant_slug TEXT, p_service_id UUID, p_date DATE)`**
   - Input: slug pubblico + servizio + data
   - Output: SETOF `(start_at TIMESTAMPTZ, end_at TIMESTAMPTZ, resource_ids_available UUID[])`
   - Frontend riceve già aggregato (array di resource_id × slot) per minimizzare round-trip

2. **`public_booking_create_v2(p_tenant_slug, p_service_id, p_start_at, p_customer_name, p_customer_email, p_customer_phone, p_resource_id, p_notes, p_source)`**
   - `p_resource_id UUID DEFAULT NULL`: quando NULL → engine sceglie Earliest-Available deterministico su `sort_order`
   - Return: UUID del booking creato (status='confirmed')
   - Errori: restituisce SQLSTATE semantici (non stack-trace) — P0001 risorsa non disponibile, 23514 violazione CHECK resource_id confirmed, 23P01 exclude overlap

3. **`public_booking_resources_list(p_tenant_slug TEXT, p_service_id UUID, p_date DATE, p_start_at TIMESTAMPTZ DEFAULT NULL)`**
   - Restituisce le risorse ammissibili e disponibili per popolare il dropdown UI "Operatore"
   - Rows: `(resource_id, display_name, sort_order, available BOOLEAN)`
   - Simple Mode (≤ 1 row) → frontend nasconde il campo

---

## 6. NON-GOALS FASE12 — fuori scope per questa fase

Vedi `docs/architecture.md` §17.6. Elenco sintetico:

| #  | NON-GOAL                                      | Fase futura / Note                                   |
| -- | --------------------------------------------- | --------------------------------------------------- |
| NG1 | Individual resource hours / orari per operatore | Dopo aver introdotto `resource_availability` tabella |
| NG2 | Time off / ferie / permessi per risorsa       | Insieme a NG1                                       |
| NG3 | Walk-in / coda gestione cliente senza appuntamento | CRM successivo                                  |
| NG4 | Calendar views (settimanale/mensile) operatori | Dashboard redesign                                |
| NG5 | AI Booking Assistant V2 consapevole risorse   | Modulo AI dedicato                                  |
| NG6 | Analytics avanzate per risorsa (produttività) | Analytics phase                                     |
| NG7 | Color coding etichette risorsa UI             | Insieme a NG4                                       |
| NG8 | Categorie risorsa non-staff (stanze/attrezz.) | Admin taxonomy                                      |
| NG9 | Capacità multi-risorsa / class bookings       | Scaling oltre 1:1:1 (1 cliente=1 slot=1 risorsa)     |
| NG10| Serie ricorrenti / waitlist / merge-split     | Booking engine V3                                   |

---

## 7. Gate Results — Counts (da runtime verification)

> Compilare dopo l'esecuzione delle regressioni. **FASE12 è FROZEN solo se tutte le celle FAILED=0 e NOT VERIFIED=0.**

| Gate | Pass | Fail | Totale | Note |
| ---- | ---- | ---- | ------ | ---- |
| Playwright FASE12 PROD (fase12-resource-booking.spec.mjs) | 20 | 0 | 20 | Simple Mode + Multi Mode + Qualsiasi Operatore + overlap 2-operator PASS |
| Playwright FASE6 DEV | 0 | 0 | 0 | Nessun spec E2E FASE6 presente (solo vitest db) |
| Playwright FASE7 DEV (entitlements) | 14 | 0 | 14 | Regressione OK |
| Playwright FASE8 DEV (billing) | 18 | 0 | 18 | Regressione OK |
| Playwright FASE9 DEV (booking legacy UI) | 17 | 0 | 17 | E9-4/E9-5 fixed; Simple Mode hidden dropdown ✔ |
| Playwright FASE10 DEV (CRM) | 19 | 0 | 19 | Regressione OK, fase10h concurrency still-green |
| **TOTALE PLAYWRIGHT DEV F6-12** | **88** | **0** | **88** | — |
| Playwright FASE6 PROD | 0 | 0 | 0 | (idem) |
| Playwright FASE7 PROD | 14 | 0 | 14 | Build Turbopack + NODE_ENV=production |
| Playwright FASE8 PROD | 18 | 0 | 18 | |
| Playwright FASE9 PROD | 17 | 0 | 17 | |
| Playwright FASE10 PROD | 19 | 0 | 19 | |
| Playwright FASE12 PROD | 20 | 0 | 20 | |
| **TOTALE PLAYWRIGHT PROD F6-12** | **88** | **0** | **88** | — |
| `pnpm db:test` (tutti tests/db/*) | 292 | 0 | 292 | Double reset post equality PASS |
| `pnpm vitest run --maxWorkers=1` (FULL, include src/) | 440 | 0 | 440 | 23 files, no test.only unsafe |
| TypeScript strict (`pnpm typecheck`) | — | 0 | errors=0 | strict + exactOptionalPropertyTypes + noUnused |
| ESLint (`pnpm lint --max-warnings=0`) | — | 0 | warnings=0 | |
| Build prod Turbopack (`pnpm build`) | exit 0 | — | — | 13 static + 19 dynamic routes |
| Health endpoint `/api/health` | HTTP 200 | — | — | body: `{status:"ok",service:"velora"}` |
| Double reset equality (snapshot1 === snapshot2) | PASS | diffs=0 | — | counts + migrations order identical |
| `git diff --check` whitespace | PASS | 0 | — | |

---

## 8. Gates Finali

- **FAILED** (tests falliti): **0**
- **NOT VERIFIED** (gate non eseguibili): **0**
- **Freeze Decision**: **FASE 12 = FROZEN** (solo se le celle precedenti sono tutte verdi)

---

Report generato: FASE12 Scheduling & Resource Model Foundation.
