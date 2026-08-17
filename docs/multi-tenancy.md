# VELORA — Multi-tenancy & Security Model

Definisce come i dati dei tenant sono separati, ruoli, policy, e le garanzie
di isolamento cross-tenant. Tutto quello descritto qui è **enforced a livello
database (PostgreSQL RLS + trigger)**, non soltanto nel codice applicativo.

## 1. Modello concettuale

```
Platform Admin (SUPER_ADMIN)
   └─ Tenant (ACTIVITY = ACTIVE / ONBOARDING / SUSPENDED)
        ├─ BusinessProfile
        ├─ Memberships (OWNER → MANAGER → STAFF)
        ├─ Profiles (public user info)
        ├─ Audit logs (immutabili, append-only)
        ├─ (Booking, Sites, Domini, Staff, Services — FASI successive)
        └─ …
```

Un utente può:

- appartenere a più tenant (in ruoli diversi);
- essere platform admin (e accedere a tutti i tenant);
- non appartenere a nessun tenant (`no_member`).

## 2. Gerarchia ruoli utente

La gerarchia è codificata in `src/modules/auth/core/roles.ts`. Il confronto
tra ruoli usa **livelli numerici**: un livello più alto include tutti i
permessi dei livelli inferiori.

| Ruolo              | Livello numerico | Scope         | Ambito autorizzativo tipico                                        |
| :----------------- | :--------------: | :------------ | :----------------------------------------------------------------- |
| STAFF              |        10        | Tenant-scoped | Read dati, booking self, lista colleghi. NO scrittura struttura.   |
| MANAGER            |        50        | Tenant-scoped | Inviti staff, modifica business profile, scheduling. NO owner ops. |
| OWNER              |       100        | Tenant-scoped | Tutto il tenant; aggiunta/rimozione owner (see §9).                |
| **PLATFORM ADMIN** |      10.000      | Platform      | Accesso illimitato a **tutti** i tenant (enforced da RLS policy).  |

> Questa gerarchia è una guardia applicativa. **Sempre e comunque**, dietro le
> quinte, le policy RLS del database e i trigger del DB restringono
> concretamente cosa può essere letto/scritto.

## 3. Row Level Security: Principi

Tutte le entità sensibili al tenant hanno:

```sql
ALTER TABLE public.tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants          FORCE  ROW LEVEL SECURITY;
```

- **`ENABLE`**: la policy viene applicata a tutti i ruoli che non sono BYPASSRLS.
- **`FORCE`**: anche gli owner della tabella (non-superuser) sono filtrati.
- Solo il ruolo `service_role` e `postgres` superuser bypassano RLS in
  scritture amministrative autorizzate.

### Regola hard

> Qualunque query tenant-sensitive senza un appropriato `WHERE tenant_id = …`
> e senza policy RLS associata è un bug di sicurezza. Non si basa sul
> frontend.

## 4. Helpers RLS di autorizzazione

Tre funzioni centralizzate usate da tutte le policy:

| Funzione                              | Restituisce | Utilizzo tipico                                                         |
| :------------------------------------ | :---------: | :---------------------------------------------------------------------- |
| `is_tenant_member(tenant_id)`         |   boolean   | un utente può **vedere** o **scrivere** risorse associate al tenant.    |
| `has_tenant_role(tenant_id, [roles])` |   boolean   | come sopra, ma richiede un ruolo minimo in `roles[]` (owner / manager). |
| `is_platform_admin()`                 |   boolean   | l'utente è nel team di piattaforma e vede TUTTO.                        |

Ogni funzione è `SECURITY DEFINER SET search_path = ''` completamente
qualificata (vedi `docs/database.md` §8):

- `REVOKE ALL FROM PUBLIC`;
- `GRANT EXECUTE TO anon, authenticated, service_role`;
- tutti i riferimenti a tabelle sono `public.tenant_memberships`,
  `public.platform_admins`, ecc.

### Pattern nelle policy

Pattern base per policy **tenant-scoped**:

```sql
CREATE POLICY xxx_select ON public.xxx FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR public.is_tenant_member(xxx.tenant_id)
);
```

Pattern per **owner-only write**:

```sql
CREATE POLICY xxx_update ON public.xxx FOR UPDATE TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_tenant_role(xxx.tenant_id, ARRAY['owner'])
)
WITH CHECK (
  public.is_platform_admin()
  OR public.has_tenant_role(xxx.tenant_id, ARRAY['owner'])
);
```

## 5. Policy effettive attuali (FASE 1)

| Tabella                     | Policy esistenti                                                                     |
| :-------------------------- | :----------------------------------------------------------------------------------- |
| `public.tenants`            | read: PA + member; update: PA + OWNER. INSERT/DELETE: PA (non per client finali).    |
| `public.profiles`           | read: PA + same-user OR share-tenant member (vedi migration 008).                    |
| `public.tenant_memberships` | read: PA + membro tenant A vede A.<br>insert/update/delete: PA OR OWNER A su A.      |
| `public.business_profiles`  | read: PA + membro tenant; update: PA + OWNER/MANAGER del tenant.                     |
| `public.platform_admins`    | NESSUNA policy per client. `authenticated` vede sempre 0 righe. Solo `service_role`. |
| `public.audit_logs`         | INSERT solo `service_role`; SELECT/UPDATE/DELETE: vietato a client.                  |

## 6. Enumerazione platform admins

- **NON è possibile** per owner/manager/staff/anon elencare la tabella
  `platform_admins`: non esiste policy `FOR SELECT` per `authenticated` e
  RLS è attivo con FORCE → 0 righe ritornate sempre.
- Le funzioni `is_platform_admin()` permettono solo di determinare se
  **l'utente corrente** è PA.

## 7. Audit logs append-only

### a) Trigger

```sql
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
-- RAISE EXCEPTION 'audit_logs is append-only: updates and deletes are not allowed';
```

### b) Policy

```sql
CREATE POLICY audit_logs_service_only_insert ON public.audit_logs
  FOR INSERT TO service_role WITH CHECK (true);
```

Risultato:

| Ruolo          | INSERT | SELECT | UPDATE | DELETE |
| :------------- | :----: | :----: | :----: | :----: |
| anon           |   ❌   |   ❌   |   ❌   |   ❌   |
| authenticated  |   ❌   |   ❌   |   ❌   |   ❌   |
| service_role   |   ✅   |   ✅   |  ❌¹   |  ❌¹   |
| postgres/super |   ✅   |   ✅   |   ✅   |   ✅   |

¹ Bloccato comunque dal trigger `audit_logs_immutable`.

## 8. Isolamento cross-tenant (Test G1-G3 nella suite)

Matrice attesa & comportamento:

| Azione                                     | Attore    | Esito |
| :----------------------------------------- | :-------- | :---: |
| Owner A legge Tenant A                     | owner_a   |  ✅   |
| Staff A legge BP A                         | staff_a   |  ✅   |
| Staff A lista membri A                     | staff_a   |  ✅   |
| Owner A modifica nome Tenant A             | owner_a   |  ✅   |
| Manager A modifica desc BP A               | manager_a |  ✅   |
| Staff A legge Tenant B (cross)             | staff_a   |  ❌   |
| Owner A legge BP B (cross)                 | owner_a   |  ❌   |
| Owner A modifica nome Tenant B (cross)     | owner_a   |  ❌   |
| Manager A inserisce membership in Tenant B | manager_a |  ❌   |
| Owner B lista membri Tenant A (cross)      | owner_b   |  ❌   |
| Anon: SELECT tenants                       | anon      |   0   |
| No-member legge Tenant A                   | no_member |  ❌   |
| No-member modifica BP A                    | no_member |  ❌   |

## 9. Last Owner Invariant

Obiettivo: impedire stati invalidi come **Tenant attivo con zero owner attivi**.

Implementazione:

1. Funzione trigger `public.guard_last_active_owner()` (`search_path=''`).
2. `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` su INSERT/UPDATE/DELETE.
3. Logica: quando viene rimossa/declassata una row `owner` + `status='active'`,
   conta le remaining owner attive. Se `count = 0` →
   `RAISE EXCEPTION 'last_active_owner: cannot remove/declass the last active owner of tenant …'`.

Regole derivate:

| Scenario                                                             | Esito |
| :------------------------------------------------------------------- | :---: |
| 1 owner attivo: owner si auto-cancella membership                    |  ❌   |
| 1 owner attivo: owner si declassa a staff                            |  ❌   |
| 2 owner attivi: owner A rimuove owner B                              |  ✅   |
| Owner aggiunge un secondo owner                                      |  ✅   |
| Owner B viene messo `status='suspended'` e c'è un altro owner attivo |  ✅   |

## 10. Privilege escalation matrix (Test G7)

| Scenario                                              | Esito |
| :---------------------------------------------------- | :---: |
| Owner A: INSERT self into platform_admins             |  ❌   |
| Owner A: UPDATE row PA altrui (es. sospendi)          |  ❌   |
| Owner A: crea OWNER in Tenant B (cross-tenant)        |  ❌   |
| Manager A: promuove sé stesso a owner                 |  ❌   |
| Manager A: declassa Owner A a staff                   |  ❌   |
| Staff A: modifica il proprio ruolo                    |  ❌   |
| Staff A: sospende la propria membership               |  ❌   |
| Staff A: invita un utente esterno come nuovo membro A |  ❌   |

## 11. Platform admin isolation

**Tabella `platform_admins`**:

- Nessuna policy per `authenticated` → SELECT/INSERT/UPDATE/DELETE sempre
  filtrate a 0 righe o rifiutate.
- Solo `service_role` (backend autorizzato) e superuser possono scrivervi.

**Enforcement**:

| Scenario                                                    |  Esito  |
| :---------------------------------------------------------- | :-----: |
| Owner A: `select * from platform_admins` (anon impersonato) | 0 righe |
| Owner A: `INSERT INTO platform_admins(self)`                |   ❌    |
| Owner A: `UPDATE platform_admins SET status='suspended'`    |   ❌    |
| PA: impersonation test_rls PA legge Tenant A/B              |   ✅    |

## 12. Autenticazione & Autorizzazione

La separazione è **netta**:

- ✅ Autenticato: l'utente è "loggato" (JWT valido).
- ✅ Autorizzato: l'utente ha la relazione corretta (membership attiva con
  ruolo sufficiente) con il TENANT della risorsa.

Essere autenticati **non implica** poter fare nulla. Ad esempio `no_member`
è autenticato ma non vede alcun dato di alcun tenant.

## 13. Future work

- Quando verrà aggiunto il dominio pubblico (site engine): un dominio mappa
  a un solo `tenant_id`, lato server. Nessun fiducia al parametro `?tenant_id`.
- Quando verrà aggiunto il booking: le race condition su slot saranno
  gestite con `SELECT … FOR UPDATE` e vincoli unici su (staff_id, start_at).
- Audit logs: introdurre corredo standard di campi `correlation_id`,
  `request_id`, `ip_address`, quando iniziamo a servire richieste da backend.
