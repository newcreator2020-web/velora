# VELORA — Database & Migration Workflow

Questo documento definisce le regole e il ciclo di vita del database in
tutti gli ambienti. La finalità è **RIPRODUCIBILITÀ** e **SAFETY**: un nuovo
sviluppatore clonato il repo deve poter ricreare da zero lo stack locale in
pochi minuti, senza dipendenze dal cloud o da modifiche manuali.

## 1. Stack DB

- **Motore**: PostgreSQL 15+ (Supabase managed / Docker locale).
- **Versione**: `major_version = 15` in `supabase/config.toml`.
- **Gestione schema**: migration SQL versionate con **Supabase CLI**.
- **Gestione test data**: file `supabase/seed.sql` (applicato automaticamente
  dal CLI).
- **Generazione tipi**: `supabase gen types typescript --local`.
- **RLS**: abilitato e forzato su tutte le tabelle sensibili.

## 2. Elenco migrazioni definitive (FASE 1)

Cartella: `supabase/migrations/`. Ogni file è **IMMUTABILE**: dopo essere
stata applicata a qualunque ambiente condiviso non viene più modificata.
Eventuali correzioni = nuova migration.

| #       | Timestamp file  | Nome file                         | Ambito                                 | Production-safe? | Test data? |
| :------ | :-------------- | :-------------------------------- | :------------------------------------- | :--------------: | :--------: |
| 001     | 20260815 000001 | `init_extensions_and_helpers.sql` | pgcrypto + shared helpers              |      ✅ SÍ       |     ❌     |
| 002     | 20260815 000002 | `tenants.sql`                     | tabella tenants + indici + RLS         |      ✅ SÍ       |     ❌     |
| 003     | 20260815 000003 | `profiles.sql`                    | profili utenti (pubblici)              |      ✅ SÍ       |     ❌     |
| 004     | 20260815 000004 | `tenant_memberships.sql`          | ruoli utenti-tenant                    |      ✅ SÍ       |     ❌     |
| 005     | 20260815 000005 | `business_profiles.sql`           | profili commerciali                    |      ✅ SÍ       |     ❌     |
| 006     | 20260815 000006 | `platform_admins.sql`             | amministratori di piattaforma          |      ✅ SÍ       |     ❌     |
| 007     | 20260815 000007 | `audit_logs.sql`                  | log di audit append-only               |      ✅ SÍ       |     ❌     |
| 008     | 20260815 000008 | `rls_helpers_and_policies.sql`    | is_tenant_member + Policies RLS base   |      ✅ SÍ       |     ❌     |
| 009     | 20260815 000009 | `seed.sql`                        | ⚠️ test data storati in migration      |   ⚠️ (storica)   |   ✅ SÍ    |
| 009d    | 20260817 011800 | `test_get_user_id_rpc.sql`        | RPC test-only (aiuto sviluppo F1)      |      ❌ NO       |     ✅     |
| 009e    | 20260817 011904 | `test_provision_user_rpc.sql`     | RPC test-only (provisioning auth)      |      ❌ NO       |     ✅     |
| 009f    | 20260817 011990 | `test_rls_wrapper.sql`            | RPC test-only (impersonation)          |      ❌ NO       |     ✅     |
| **010** | 20260817 100010 | `drop_testonly_rpc.sql`           | ✅ DROP delle tre RPC test-only 009d/f |      ✅ SÍ       |     ❌     |
| **011** | 20260817 100011 | `security_definer_hardening.sql`  | helpers RLS: `search_path=''`, grants  |      ✅ SÍ       |     ❌     |
| **012** | 20260817 100012 | `last_owner_guard_and_audit.sql`  | trigger last-owner + audit policy      |      ✅ SÍ       |     ❌     |

### Note sullo stato 009 e 009{d,e,f}

- `009_seed.sql` contiene test data inseriti male a inizio FASE 1. Per
  principio di immutability **non lo modifichiamo più**. Invece, da adesso in
  avanti:
  - **Lo schema dei dati test** (tenant alpha/beta, business profile, marker
    seed) vive in `supabase/seed.sql` (ufficiale).
  - Le fixture utente/membership vengono create **transientmente** dal
    `beforeAll` della suite di test (non nel DB persistente).
- `009{d,e,f}` (RPC `test_*`) esistevano solo come appoggio durante i primi
  test; sono rimosse **in ogni ambiente condiviso** dalla migration `010`.

## 3. Ambienti

| Ambiente  | Indirizzo                                  | Migrations applicate da:  | RPC `test_*` permanenti? |             Ammesso `db reset` distruttivo?              |
| :-------- | :----------------------------------------- | :------------------------ | :----------------------: | :------------------------------------------------------: |
| LOCAL     | `http://localhost:54321` (Supabase Studio) | `supabase db reset` CLI   |   ✅ transient (test)    |                          ✅ SÍ                           |
| CLOUD DEV | `https://dgekfjkuvnofwdwxflms.supabase.co` | `supabase db push` / tool |            ❌            | ⚠️ Solo se autorizzato esplicitamente (ultimo in FASE 1) |
| STAGING   | (futuro)                                   | `supabase db push` CI     |            ❌            |                          ❌ NO                           |
| PROD      | (futuro)                                   | `supabase db push` CI     |            ❌            |                          ❌ NO                           |

## 4. Workflow migration end-to-end

**Regola aurea**: ogni migration viene prima provata in locale, poi contro
DEV, poi in STAGING, infine in PRODUCTION. MAI modificare direttamente lo
schema di staging/prod a mano.

```
(1) Sviluppatore locale:
    $ supabase start       # avvia stack locale Docker
    $ supabase db reset    # applica migration 001…012 → seed.sql
    $ pnpm db:test         # test RLS / invariants PASSANO
(2) Quando tutto verde:
    $ git push feature/xxx
    $ supabase db push     # su CLOUD DEV
(3) CI:
    $ pnpm check
    $ pnpm build
    $ pnpm test:e2e
(4) Merge in develop → STAGING
(5) Merge in main → PRODUCTION
```

### 4.1 Reset LOCALE ripetibile (idempotenza)

Il seguente flusso DEVE passare due volte consecutive per dimostrare che non
dipendiamo da stato precedente:

```
$ pnpm db:stop
$ pnpm db:start
$ pnpm db:reset   # 1° passaggio
$ pnpm db:types
$ pnpm db:test    # PASS
$ pnpm db:reset   # 2° passaggio
$ pnpm db:test    # PASS
```

Se il primo reset passa e il secondo fallisce → c'è una migration non
idempotente o uno seed collidente → correggere prima di pushare.

## 5. Seed (`supabase/seed.sql`)

Contiene **solo dati**, MAI definizioni schema:

- Tenants Alpha / Beta (`00000000-0000-4000-8000-0000000000a1`, `00000000-0000-4000-8000-0000000000b1`).
- Business Profiles deterministici (`Alpha Barbershop`, `Beta Beauty Studio`).
- Marker audit `seed.applied` (con `ON CONFLICT DO NOTHING`).

È:

- Applicato **automaticamente** dopo l'ultimo `schema_migrations` da
  `supabase db reset` (`supabase/config.toml: db.seed.enabled=true + db.seed.sql_paths=...`).
- Versionato e deterministico.
- Contiene solo fixture che la suite di test **non deve** sovrascrivere.

### 5.1 Utenti e membership di test

Gli utenti (`owner-a@test.local`, …, `platform-admin@test.local`) NON sono
creati nel seed. La suite di test li crea tramite:

1. `Supabase.auth.admin.createUser` (provisioning utenti tramite API admin
   GoTrue con service role), oppure
2. Transient RPC `test_provision_user()` (se direct pg è disponibile).

Questa strategia evita:

- Fixture dipendenti da UUID hardcoded;
- Account test permanenti nel cloud;
- Collisioni tra run multipli.

## 6. Generazione tipi TypeScript

I tipi **non sono mai scritti a mano**:

```bash
# Ambiente locale (consigliato default):
$ pnpm db:types        # → src/types/supabase.ts (da DB locale Docker)

# Solo eccezionalmente se Docker non è disponibile:
$ pnpm db:types:cloud  # → src/types/supabase.ts (da cloud project)
```

Regola sul determinismo: dopo aver rigenerato, un secondo `pnpm db:types` con
stesso schema non deve produrre differenze nel file (oltre a timestamp).

## 7. RPC test-only & testing strategy

### 7.1 Perché sono vietate in produzione

Le funzioni `test_get_user_id`, `test_provision_user`, `test_rls`:

- permettono operazioni di impersonazione e scrittura su `auth.users`;
- se lasciate in staging/prod sono un vettore diretto di privilege
  escalation;
- non servono al runtime applicativo.

### 7.2 Strategia corretta: transient + connessione `pg`

Le stesse identiche funzioni vengono installate nel DB target solo per la
durata della suite di test:

```
beforeAll  → pg.Client() diretto → esegue TESTONLY_RPC_SQL.
tests      → chiamate a test_provision_user / test_rls come prima.
afterAll   → DROP ... IF EXISTS (sempre, anche se test falliscono).
```

Questa installazione **non lascia traccia** nel database condiviso dopo la
fine della suite.

### 7.3 Env guardrail (fail-hard anti-produzione)

All'inizio di `tests/db/multi-tenant-rls.test.ts`, prima di qualunque query
vengono valutate:

- `ALLOWED_DB_HOSTS = {127.0.0.1, localhost, db.dgekfjkuvnofwdwxflms.supabase.co}`
- `SAFE_PROJECT_IDS = {dgekfjkuvnofwdwxflms, velora-local}`

Se `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_PROJECT_ID` non corrispondono:
`process.exit(1)` immediatamente.

## 8. SECURITY DEFINER hardening

Tutte le funzioni SECURITY DEFINER esposte a ruoli client applicano queste
regole:

1. `SET search_path = ''` (nessuno schema di default → nessun hijack).
2. Riferimenti **completamente qualificati** (`public.tenants`,
   `auth.users`, `public.platform_admins`, …).
3. `REVOKE ALL ON FUNCTION … FROM PUBLIC`.
4. `GRANT EXECUTE ON FUNCTION … TO anon, authenticated, service_role` —
   soltanto i ruoli effettivamente autorizzati.
5. Uso `STABLE` per funzioni lette; mai `VOLATILE` senza motivo.

Helpers attualmente SECURITY DEFINER:

| Funzione                        | search_path | Grants                                     |
| :------------------------------ | :---------- | :----------------------------------------- |
| `is_tenant_member(UUID)`        | `''`        | anon, authenticated, service_role          |
| `has_tenant_role(UUID, TEXT[])` | `''`        | anon, authenticated, service_role          |
| `is_platform_admin()`           | `''`        | anon, authenticated, service_role          |
| `guard_last_active_owner()`     | `''`        | service_role / trigger (no grant pubblici) |

## 9. Verifica REMOTE post-cleanup (Punto 28)

Dopo aver applicato `010_drop_testonly_rpc` su un ambiente condiviso,
verificare:

```sql
-- NON devono esistere:
SELECT proname FROM pg_proc WHERE proname LIKE 'test_%';
-- → 0 righe.

-- Devono ancora esistere (core safe):
SELECT * FROM public.tenants          WHERE id IN ('0000-…-a1','0000-…-b1');
SELECT * FROM public.business_profiles;
SELECT * FROM public.platform_admins  LIMIT 1;
SELECT * FROM public.audit_logs       LIMIT 1;
-- → almeno 0 righe o come atteso (nessun dato core perso).
```

Le policy RLS e i trigger last-owner/append-only sono ancora attivi.

## 10. Troubleshooting checklist

| Symptom                                                       | Check                                                                             |
| :------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| `supabase start` fallisce                                     | Docker Desktop in esecuzione? porte 54321/54322 libere?                           |
| `db reset` fallisce a metà migration                          | Ordine corretto (001 → 012)? migration non modificata dopo push?                  |
| `db:test` fallisce con "missing env NEXT_PUBLIC_SUPABASE_URL" | `.env` valorizzato?                                                               |
| `db:test` fallisce hard "refusing to run against…"            | Hostname/progetto non in whitelist `ALLOWED_DB_HOSTS`.                            |
| `pg.Client` direct: "ENOTFOUND db.xxx.supabase.co"            | Formato host changed; valorizzare `SUPABASE_DB_HOST` e `SUPABASE_DB_PORT` in .env |
| `db:types:cloud` fallisce                                     | Link CLI attivo? `supabase link --project-ref …` effettuato?                      |
