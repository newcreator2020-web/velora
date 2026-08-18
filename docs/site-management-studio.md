# VELORA — Site Management Studio (FASE 6)

Documentazione tecnica del Site Management Studio e del workflow
Draft / Preview / Publish multi-tenant.

## 1. Ambito

Studio consente a **OWNER e MANAGER** di configurare il sito pubblico del
proprio tenant senza interventi tecnici:

- `/app/site` → dashboard di gestione (autenticata, tenant-scoped)
- `/app/site/preview` → anteprima privata della bozza (force-dynamic, NO ISR)
- `/s/[slug]` → sito pubblico (usa configurazione **pubblicata**, ISR 300s)

Tutto è persistito in PostgreSQL e validato server-side; nessun `tenant_id`
autorevole viene accettato dal browser.

---

## 2. Modello di persistenza (ADR — Draft separato + Published)

Scelta architetturale: **stato editoriale separato 1:1 dal contenuto
pubblicato**.

| Strato                | Source of Truth                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Bozza (Draft)**     | tabella `site_editorial_state` (JSONB sections / services / theme + `draft_revision` + `updated_at`)       |
| **Pubblicato (Live)** | tabelle FASE 5: `site_sections`, `services`, colonne `business_profiles.theme_*`, flag `tenants.published` |

### Perché non un campo `published` booleano sulle righe

- Il sito pubblico FASE 5 è già basato su `site_sections/services`
  normalizzati e RLS-guarded; duplicare in due stati sulla stessa tabella
  avrebbe richiesto filter conditions ovunque e RLS più complessa.
- L'editoriale cambia spesso e in modo non atomico (l'utente modifica più
  campi prima di "Pubblica"). Uno stato aggregato JSONB per il draft
  riduce write parziali e semplifica la transazione atomica di publish.

### Momento esatto della pubblicazione

L'utente clicca **Pubblica**:

1. Server Action `publishEditorialAction` chiama `publishSiteDraft()`.
2. `publishSiteDraft` invoca la RPC PostgreSQL `publish_site_draft()`
   marcata **SECURITY DEFINER** e **search_path = ''**.
3. La RPC, in una sola transazione atomica:
   - verifica `auth.uid()` e ruolo `manager` o superiore (doppio strato
     authz oltre a RLS);
   - confronta opzionalmente `expected_revision` (CONCURRENT check per
     lost-update);
   - **DELETE** righe `site_sections`, **DELETE** `services` del tenant;
   - **INSERT** nuove righe sections/services basate sul JSONB draft
     (normalizzazione 0..N position deterministic);
   - **UPDATE** `business_profiles.theme_*` dai token strutturati;
   - **UPDATE** `tenants.published = true`, `published_at = now()`;
   - incrementa `draft_revision` di `site_editorial_state` a un nuovo UUID;
   - COMMIT.
4. Successo: Server Action esegue `revalidatePath('/s/' + slug)`
   (**invalidazione cache solo per il singolo tenant**).
5. Audit: evento `site_published` con conteggi sections/services/theme
   (nessun contenuto libero, no PII).

### Unpublish

- `unpublishSite()` imposta `tenants.published = false` e invalida cache.
- Il **draft non viene distrutto**: l'utente può ri-pubblicare in qualsiasi
  momento.

---

## 3. Authorization Matrix

Tutte le policy RLS esistenti FASE 1-5 sono preservate.

| RISORSA/AZIONE         | ANON | NO TENANT | STAFF | MANAGER | OWNER |
| ---------------------- | :--: | :-------: | :---: | :-----: | :---: |
| `/app/site` read       | DENY |   DENY    | READ¹ |  READ   | READ  |
| `/app/site` write      | DENY |   DENY    | DENY  |  WRITE  | WRITE |
| preview privata        | DENY |   DENY    | READ¹ |  ALLOW  | ALLOW |
| section create         | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| section update         | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| section enable/disable | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| section reorder        | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| service create         | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| service update         | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| service deactivate     | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| theme update           | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| publish                | DENY |   DENY    | DENY  |  ALLOW  | ALLOW |
| **unpublish**          | DENY |   DENY    | DENY  |  DENY²  | ALLOW |

¹ STAFF read sullo Studio è previsto ma in questa release implementiamo
solo write path per MANAGER/OWNER; il caricamento RLS `is_tenant_member`
consente STAFF di leggere.
² Unpublish è riservato a OWNER per policy applicativa.

### Policy RLS nuove (migration 024)

- `site_editorial_state` ENABLE ROW LEVEL SECURITY + FORCE RLS.
- SELECT → `is_tenant_member(tenant_id)` (tutti i membri autenticati).
- INSERT / UPDATE / DELETE →
  `has_tenant_role(tenant_id, ARRAY['owner','manager'])`.

---

## 4. Write path (Server Actions)

Ogni action rispetta la catena:

```
user-bound cookie
  → requireTenantRole("manager")   [authz + tenant context server-side]
  → stripEditorialTamperedFields() [whitelist 4 chiavi: sections/services/theme/revision]
  → editorialDraftInputSchema      [Zod strict validation]
  → normalizeSectionsForDb()       [position 0..N deterministic, singleton dedup, variant clamp]
  → normalizeServicesForDb()       [price round 2 dec, currency enum, position cursor]
  → Supabase user-bound client
  → INSERT/UPSERT con RLS
  → Audit (service_role insert, PII-free mask, NON bloccante)
  → Cache invalidation ONLY on publish/unpublish
```

`tenant_id` **non è mai** letto dal form o dal client: viene derivato da
`ctx.tenant.id` dopo `requireTenantRole`.

### Tampering allowlist

Chiavi accettate nel payload: `sections`, `services`, `theme`, `revision`.
Qualsiasi altra chiave (es. `tenant_id`, `user_id`, `role`, `published`,
`business_profile_id`, `__proto__`) viene **scartata silenziosamente** da
`stripEditorialTamperedFields()` prima della validazione Zod.

Valori manipolati internamente:

- `position` → risolto con cursore deterministico 0..N (ignora valori
  client arbitrari o collisioni).
- `section_type` → enum consentiti dal registry FASE 5 (`SECTION_TYPES`).
- `variant` → clamp a `ALLOWED_VARIANTS`.
- `settings` → Zod `record(string, unknown)` passthrough (ma non
  autorevole, sarà normalizzato lato engine in parseSectionSettings).
- `theme` → soli 7 token strutturati (`primary`, `background`, `foreground`,
  `muted`, `radius`, `headingFont`, `bodyFont`) con validazione hex / enum.
  **NON sono ammessi CSS arbitrario / HTML / javascript: / url() arbitrari.**

---

## 5. Anteprima privata (Preview)

Route: `/app/site/preview`.

- `export const dynamic = 'force-dynamic'` — nessun ISR su preview.
- Prima del render: `requireTenantMembership()` → ANON/NO TENANT = DENY.
- Risoluzione contenuti: `resolveDraftSiteForPreview()` usa
  **esclusivamente** `site_editorial_state` (draft).
- Banner sticky giallo: "Stai visualizzando una bozza non pubblicata."
- I dati pubblici del sito `/s/[slug]` **non** vengono alterati dalla
  preview (no pubblicazione temporanea, no flip `published=true`).

---

## 6. Cache isolation

FASE 5 usa ISR con `revalidate = 300` su `/s/[slug]`.

- **Publish / Unpublish** rieseguono `revalidatePath('/s/' + slug)` solo per
  il tenant corrente. Non è mai chiamata un'invalidazione globale.
- Preview non usa ISR (`force-dynamic`), quindi non ha cache da invalidare.
- Test atteso: Tenant A pubblica, `/s/a` si aggiorna immediatamente,
  `/s/b` rimane alla versione precedente senza contaminazione.

---

## 7. Reorder atomico sezioni / servizi

La tabella `site_sections` FASE 5 ha
`UNIQUE (tenant_id, position)`.

Strategia deterministic:

1. UI scambia adiacenti (↑/↓) e in locale normalizza con
   `rewritePositions(sections.map((s, i) => ({...s, position: i})))` a
   `0..N`.
2. Server-side `normalizeSectionsForDb()` riscrive **sempre** position
   da 0 a N in base all'ordine dell'array, ignorando i valori ricevuti:
   ```ts
   s.position = i;
   ```
3. Publish RPC, dentro la transazione:
   - DELETE * di tutte le sezioni del tenant;
   - INSERT in ordine 0..N (nessuna collisione UNIQUE perché le
     posizioni sono riempite consecutivamente dopo il DELETE).

Stesso pattern per servizi.

---

## 8. Concorrenza (lost update guard)

- `site_editorial_state.draft_revision` = UUID aggiornato a ogni save
  e publish.
- `publish_site_draft(p_tenant_id, p_expected_revision)` se riceve
  `p_expected_revision` (non vuoto) e non corrisponde al revision
  corrente del draft: ritorna `code='CONCURRENT'`, message appropriato
  (UI chiede all'utente di ricaricare).
- La compare-and-swap è atomica perché la RPC legge e scrive nella
  stessa transazione con `SELECT … FOR UPDATE` su `site_editorial_state`.

---

## 9. Audit

Eventi minimi e PII-free:

| evento                       | entity_type            | metadata minimo                                                           |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `site_editorial_draft_saved` | `site_editorial_state` | `countSections`, `countServices`, `lenThemePrimary`, `newRevisionPrefix8` |
| `site_published`             | `tenants`              | `sections_applied`, `services_applied`, `theme_applied`, `published_at`   |
| `site_unpublished`           | `tenants`              | vuoto                                                                     |

Implementazione: funzione `insertAudit()` interna a site-studio, usa
`getSupabaseServiceClient()` (JUSTIFIED: policy RLS `audit_logs` è
**service_role only insert** per evitare tampering da user-bound client).
Audit è **NON bloccante**: try/catch swallow.

---

## 10. File implementativi principali

| percorso file                                                                 | ruolo                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/20260819000024_site_editorial_draft_and_publish_rpc.sql` | Migration 024 append-only: tabella + trigger + RLS + RPC                  |
| `src/lib/server/site-studio-pure.ts`                                          | Zod schemas / strip tampering / normalizzazioni pure (no DB, testabile)   |
| `src/lib/server/site-studio.ts`                                               | Queries DB + load/save/publish/unpublish + resolveDraftForPreview + audit |
| `src/app/app/site/actions.ts`                                                 | Server Actions save/publish/unpublish + discriminated union result        |
| `src/components/studio/SiteStudio.tsx`                                        | UI editor (React Client Componente) + useFormState/useFormStatus          |
| `src/app/app/site/page.tsx`                                                   | RSC che passa initialState a `<SiteStudio>`                               |
| `src/app/app/site/preview/page.tsx`                                           | Preview privata `force-dynamic` con banner bozza                          |

---

## 11. Limiti e fuori scope (release corrente)

- Nessun collaborative editing real-time (CRDT/OT).
- Nessun rollback a revisioni storiche (solo stato draft corrente vs
  ultimo published; implementazione versioning posticipata).
- Nessun builder grafico del tema (solo token strutturati hex/enum).
- STAFF in questa release accede in lettura alla preview ma non
  usa scritture (read-only enforcement server-side via RLS).
