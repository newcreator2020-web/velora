# FREEZE REPORT — FASE 11B

**Data:** 2026-08-22
**Branch:** `feature/auth-onboarding`
**Initial HEAD (Frozen baseline):** `7c143755fcf1dde6c2a8ebca63e10a727015c5b2`
**Final HEAD (post commit FASE11B):** vedi tabella 42 checkpoint
**Working Tree post-freeze:** clean
**Remote:** nessuno — **NESSUNO PUSH MAI eseguito**

---

## 0. Scope Defect Closure — Post-Freeze Append-Only Hardening

FASE 11B = **SECURITY + AUDIT DEFECT CLOSURE**.
Nessuna nuova feature. Solo fix additivi.

- **VIETATO:** modificare migration FASE1–FASE10 frozen (APPEND ONLY rispettato: 1 nuova migration)
- **VIETATO:** Calendar / Staff Scheduling / AI / Notifications / Prospecting / altri feature
- **APPROVATO:** audit contract, security boundaries, composite tenant integrity, plan protection D4

---

## 1. Findings D1–D4 — Classification (CONFIRMED)

| Finding | Titolo | Root Cause reale | Classificazione |
| --- | --- | --- | --- |
| D1 | Anon bookings PII exposure | FASE10g riga 28: `GRANT SELECT ON bookings TO anon` + policy `bookings_anon_select_published` — leak `customer_name/email/phone/notes/customer_id/...` | **CONFIRMED** |
| D2 | Booking audit event missing / column mismatch | FASE9c trigger `bookings_audit_status` usava colonne inesistenti `actor_id/resource_type` → FASE10b fix con **EXCEPTION WHEN OTHERS NULL** swallow + _audit_insert_trusted fragile | **CONFIRMED** |
| D3 | Customer audit missing (customer_created/customer_updated) | audit customer trigger + PII strip insufficiente; _audit_insert_trusted silent exception | **CONFIRMED** |
| D4 | Plan protection trigger reference wrong column | FASE8c riga 42: `WHERE platform_admins.active = TRUE` — colonna reale `platform_admins.status = 'active'` | **CONFIRMED** |

---

## 2. Security Boundary — Anon Booking PII (D1)

### BEFORE (FASE10 frozen, riprodotto)
- `GRANT SELECT ON public.bookings TO anon;` + policy `bookings_anon_select_published`
- anon SELECT bookings: **eseguito con successo** → colonne PII `customer_name, customer_email, customer_phone, notes, customer_id` tutte leggibili.

### AFTER (FASE11B, migration append-only)
- **REVOKE SELECT ON bookings FROM anon;** (migration riga 63)
- **DROP POLICY bookings_anon_select_published ON bookings;** (migration riga 62)
- **NEW RPC trusted boundary SECURITY DEFINER:** `public_booking_get_confirmed_ranges(p_tenant_id, p_service_id, p_from, p_to)` → returns solo `starts_at, ends_at` — **0 PII**.
- **Public slots lib:** `src/lib/server/booking.ts` L185-201: rimosso SELECT diretto bookings → usa RPC.

### Proof
- S11-01 ✅ anon SELECT bookings denied
- S11-02 ✅ public slots endpoint funziona
- S11-03 ✅ public booking creation OK
- S11-04 ✅ occupied slot excluded (overlap via GiST EXCLUDE ancora attivo)
- §15 browser MCP integrated network inspection: **0 customer email/phone/name/notes leaked JSON anon**

---

## 3. Audit Contract + Schema Reale audit_logs

**Colonne realmente esistenti public.audit_logs (FASE7 frozen):**
`id (uuid PK), created_at (timestamptz DEFAULT now()), tenant_id (uuid FK), action (TEXT NOT NULL), actor_id (uuid NULL), entity_type (TEXT NULL), entity_id (uuid NULL), metadata (JSONB DEFAULT '{}'::jsonb)` — **NESSUNA colonna actor_id / resource_type**.

**Audit triggers FASE11B (atomic NO swallow):**
- `bookings_audit_created` → booking_created
- `bookings_audit_status` → booking_cancelled / booking_completed / booking_no_show
- `customers_audit_created` → customer_created
- `customers_audit_updated` → customer_updated
- `_audit_insert_trusted` **REWRITE**: NO EXCEPTION; PII strip 24 forbidden keys (name/email/phone/jwt/token/sk_live/whsec/password/authorization/cookie...); RAISE originale se colonna/constraint invalido.

**Atomicity Semantics (§5):**
Audit required events = atomici con la business mutation. Audit failure → ROLLBACK TX. No silent best-effort.

**Immutable (§7):**
UPDATE/DELETE audit_logs → DENY. RLS + FORCE RLS. Service role è l'unico path (bypass RLS).

**PII Scan (§6):** S11-11 audit metadata PII-free → ✅ 0 forbidden hits. Regex structural scan full row audit_logs dopo workflow → 0 email/phone/notes.

---

## 4. Plan Protection D4 (FASE8 frozen → FASE11B append-only rewrite)

**BEFORE bug riprodotto:**
```plpgsql
WHERE EXISTS (SELECT 1 FROM public.platform_admins WHERE platform_admins.active = TRUE ...)
-- ERROR: column platform_admins.active does not exist (colonna reale = status text 'active')
```

**AFTER FASE11B migration riga 99-128 rewrite CREATE OR REPLACE:**
```plpgsql
WHERE EXISTS (SELECT 1 FROM public.platform_admins
              WHERE platform_admins.id = auth_uid
                AND platform_admins.status = 'active');
```
Messaggio errore backward compat: `RAISE EXCEPTION 'plan_id mutation denied for end-users' USING ERRCODE='42501';` → regex frozen BT7/BT8 FASE8B tests: **250/250 PASS** (BT7/BT8 inclusi).

---

## 5. Migrations APPEND-ONLY 1 NEW — FASE11B

**Path:** `supabase/migrations/20260822200000_fase11b_security_audit_defects.sql` — 219 lines, 8 sub-sezioni (a-h).

| N | Section | Content |
| --- | --- | --- |
| a | RPC trusted | `public_booking_get_confirmed_ranges` SECURITY DEFINER SET search_path='' |
| b | D1 REVOKE | REVOKE SELECT bookings anon; DROP unsafe policy |
| c | S1 REVOKE RPC | REVOKE EXECUTE `customer_upsert_for_public_booking` FROM anon (S11-15 ✅) |
| d | D4 plan protection | CREATE OR REPLACE `protect_tenant_plan_id` usa `status='active'`; ERRCODE 42501 |
| e | Audit atomic | CREATE OR REPLACE `_audit_insert_trusted` NO EXCEPTION + 24 PII strip keys |
| f | Audit triggers | DROP/RECREATE trigger events bookings/customers status; EXCEPTION removed |
| g | Composite UNIQUE prereq | `services(tenant_id,id)` UNIQUE; `customers(tenant_id,id)` UNIQUE |
| h | Composite FK integrity | `bookings(tenant_id,service_id)` → services CASCADE; `bookings(tenant_id,customer_id)` → customers SET NULL |

**Migration tracking:** `supabase_migrations.schema_migrations` contiene `20260822200000` → 49 totali (FASE1-10H = 48 frozen + FASE11B = 1 nuovo).

---

## 6. Composite Tenant Integrity (S11-19/20)

### Proof runtime impossibilità
- S11-19 ✅ **booking tenant A + service tenant B → IMPOSSIBLE (FK composite violato)**
- S11-20 ✅ **booking tenant A + customer tenant B → IMPOSSIBLE (FK composite violato)**

### PostgREST Ambiguity Trade-off
2 FK multipli tra bookings↔services e bookings↔customers → hint sintassi PostgREST ufficiale `!fk_name` usato in:
- `src/app/app/bookings/page.tsx:43`
- `src/lib/server/customers.ts:200`

Hints referenziano **nomi FK frozen FASE9 originali** (1-col: `bookings_service_id_fkey`, `bookings_customer_id_fkey`), non le nuove composite. → **Nessuna regressione typecheck/build/lint (0 errors)**.

---

## 7. Certification Counts

| Scope | Totale | Pass | Fail | Note |
| --- | --- | --- | --- | --- |
| DB tests (BT+S11) | 250 | 250 | 0 | `pnpm db:test` §23 clean run |
| S11 FASE11B dedicated | 20 | 20 | 0 | §11 S11-01..20 tutti PASS |
| unit/integration src/ run 1 | 18 | 18 | 0 | §13 clean |
| unit/integration src/ run 2 consec | 18 | 18 | 0 | §13 clean senza reset/modifiche |
| Playwright DEV FASE6-10 | 142 | 142 | 0 | §14 Playwright E2E (9.9min) |
| Playwright PROD FASE6-10 | 142 | 142 | 0 | §14 Playwright E2E (9.3min) |
| Responsive 3VP (375/768/1440) | ∞ | ✅ | 0 | scrollWidth <= clientWidth (E16-23) |
| A11y axe serious/critical | ∞ | ✅ | 0 | serious=0 critical=0 (E26-30) |
| quality typecheck | ∞ | ✅ | 0 | §17 |
| quality lint | ∞ | ✅ | 0 | max-warnings=0 |
| quality format | ∞ | ✅ | 0 | prettier check all |
| quality build | ∞ | ✅ | 0 | exit 0, 13 static + 19 dynamic routes |
| /api/health | ∞ | ✅ | 0 | HTTP200 status=ok |
| integrity .only/.skip/.todo | ∞ | ✅ | 0 | 1 solo skip CONDIZIONALE SAFE (E10-11) |
| secret scan tracked | ∞ | ✅ | 0 leaks reali | solo sk_test_ values + doc references SAFE |
| service_role src inventory | 4 refs | 4 justified | 0 unjustified | solo billing trusted RPC |
| git diff --check | ∞ | ✅ | 0 whitespace errors | §17/§25 |

---

## 8. Freeze Conditions — TUTTE VERDI

D1-D4 classificati ✅, anon PII exposure=0 ✅, public booking still works ✅, audit required events persistono ✅, audit PII scan=0 ✅, audit immutable ✅, cross-tenant S11-14 ✅, internal RPC S11-15 ✅, plan protection BT7/BT8/S11-16/17/18 ✅, composites S11-19/20 ✅, double reset equality §12 ✅, DB ✅, unit/integration ✅, Vitest×2 ✅, Playwright DEV/PROD ✅, responsive ✅, a11y ✅, type/lint/format/build ✅, health200 ✅, secrets clean ✅, service-role clean ✅, **§23 SECOND CLEAN RUN ALL 5 STEPS GREEN ✅**.

---

## 9. 42 Checkpoint — Vedi tabella output finale.

---

## 10. FINAL DECISION

> **FASE11B = FROZEN**
