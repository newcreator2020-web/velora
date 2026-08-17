# VELORA — Project Rules (TRAE)

> Formato autorevole per TRAE. Versionato. Non sono appunti: sono operative.
> Fonte supplementare: `docs/architecture.md`, `docs/database.md`, `docs/multi-tenancy.md`.

---

## 1. NO FAKE COMPLETION

Una task è completata solo quando:

1. il codice compila senza errori;
2. viene eseguito nell'ambiente previsto;
3. viene testato;
4. produce il risultato richiesto;
5. i dati vengono salvati e riletti realmente;
6. gli errori principali sono gestiti;
7. le verifiche sono dimostrate con output concreto.

Non scrivere "funziona", "dovrebbe passare", "OK".
Scrivi **VERIFICATO**, **NON VERIFICABILE**, **BLOCCATO** con evidenza.

---

## 2. MULTI-TENANT INVARIANTS — ASSOLUTI

- Ogni risorsa privata deve avere `tenant_id`.
- **Mai fidarsi del `tenant_id` mandato dal browser.** Validarlo server-side.
- Tutte le query tenant-sensitive devono avere filtro/RLS appropriato.
- Mai esporre dati di un tenant a un altro.
- Ogni nuovo modulo: valuta esplicitamente il rischio cross-tenant.

### 4 ruoli minimi (livello numerico)

`SUPER_ADMIN=0 > OWNER=10 > MANAGER=20 > STAFF=30`.

### Test minimi per dati privati (sempre richiesti)

| Test                                      | Esito atteso              |
| ----------------------------------------- | ------------------------- |
| Tenant A legge risorsa A                  | CONSENTITO se autorizzato |
| Tenant A modifica risorsa A               | CONSENTITO se autorizzato |
| Tenant A legge risorsa B                  | **NEGATO**                |
| Tenant A modifica risorsa B               | **NEGATO**                |
| Utente anonimo legge dati privati         | **NEGATO**                |
| Utente autenticato senza membership legge | **NEGATO**                |

---

## 3. NO SECRETS — MAI

**Mai** esporre nel repo / commit / log / frontend:

- service role key;
- secret API key;
- password DB;
- Stripe secret key / webhook secret;
- token amministrativi;
- credenziali infrastruttura.

I segreti:

- stanno server-side / .env non versionato;
- mai nei componenti client;
- mai nei messaggi di errore all'utente;
- mai stampati nei log (usa redazione).

---

## 4. DATABASE — MIGRATION IMMUTABILI

- Tutte le modifiche schema = **migration versionata**.
- Migrazioni già applicate/distribuite → **IMMUTABILI, MAI modificare**.
- Correzione → **NUOVA migration append-only**.
- Mai alterare production manualmente.
- Tutte le tabelle con dati privati → **ENABLE ROW LEVEL SECURITY + FORCE**.

### Seed

Dati test = `supabase/seed.sql` (ufficiale Supabase).
**Mai** mettere fixture permanenti in migration production-safe.

### Test-only

RPC / helper prefissati `test_`:

- **mai in migration production-safe**;
- possono esistere solo TRANSIENTI (installati via harness e droppati dopo).

---

## 5. SECURITY DEFINER / RLS HELPERS

Prima di usare `SECURITY DEFINER`:

1. valuta se basta `SECURITY INVOKER`;
2. se SD necessario:
   - `SET search_path = ''` (nessun compromesso);
   - qualifica TUTTO `public.*`, `auth.*`;
   - `REVOKE ALL ON FUNCTION … FROM PUBLIC`;
   - `GRANT EXECUTE` solo ai ruoli minimi.

Helpers RLS (`is_tenant_member`, `has_tenant_role`, `is_platform_admin`):

- non modificabili dal client;
- immuni a search_path hijacking;
- non ricorsivi con RLS;
- `auth.uid()` internamente.

---

## 6. AUDIT LOGS E PLATFORM ADMINS

`audit_logs` — sempre **append-only**:

- client → INSERT diretto **NEGATO** (se non flusso autorizzato esplicito);
- client → UPDATE/DELETE **NEGATO**;
- service_role autorizzato → INSERT **CONSENTITO**.

`platform_admins`:

- client authenticated → **NESSUNA policy** (0 righe);
- SELECT/INSERT/UPDATE/DELETE da parte di un tenant → sempre **NEGATO**;
- solo SD helpers (con grants service-only) possono leggerli.

---

## 7. LAST OWNER INVARIANT

- Un tenant ACTIVE non può mai avere **zero owner attivi**.
- Rimuovere/declassare ultimo owner → **EXCEPTION e rollback**.
- Più owner sono consentiti (non bloccare).
- Implementazione: trigger DEFERRABLE INITIALLY DEFERRED.

---

## 8. PRIVILEGE ESCALATION — BLOCCA SEMPRE

Blocca e testa:

- OWNER non promuove sé a platform_admin, non modifica platform_admins, non crea membership altro tenant;
- MANAGER non si promuove OWNER, non modifica ruolo OWNER;
- STAFF non cambia il proprio ruolo/status, non invita utenti senza permesso.

---

## 9. TEST BEFORE DONE — FAIL HARD

- Mai disabilitare un test per farlo passare.
- Mai rimuovere una validazione per risolvere un errore.
- Mai `any`, `@ts-ignore`, catch vuoti come soluzione ordinaria.
- Mai usare service_role per bypassare RLS nei test (tranne service-side harness).

### Fail-hard ambiente

Test distruttivi DB:

- prima verificano host + project id;
- whitelist locale/test;
- se non in whitelist → `process.exit(1)`; mai seed/reset su produzione.

---

## 10. NO PRODUCTION EXPERIMENTS

- Non committare direttamente su main production.
- Preferisci branching: `main` / `develop` / `feature/*` / `fix/*`.
- Ambienti separati: **LOCAL → STAGING → PRODUCTION**.
- Nessun test distruttivo / fixture sul DB cloud production.

Flusso migration: **locale → (tests verdi) → staging → (smoke) → production**.

---

## 11. REPORTING FINALE

Alla fine di ogni task importante:

1. Implementato — cosa modificato veramente.
2. File principali — percorsi.
3. Test eseguiti — comandi reali.
4. Risultati — pass/fail conteggi.
5. Verifica funzionale — cosa provato concretamente.
6. **Non verificato** — qualunque cosa non provata realmente.
7. Problemi residui — solo problemi reali.

---

## 12. CORTEGGIO FINALE: "AAA"

Prima di marcare DONE una task: **"Affiderei questa implementazione a un'attività che la usa ogni giorno e paga per il servizio?"**
Se la risposta è onestamente **no**, il lavoro non è finito.
