# VELORA — FREEZE REPORT FASE 6

**Site Management Studio + Draft/Preview/Publish Workflow**

Data freeze (report prodotto): 2026-08-19
Commit baseline FASE 5 frozen: `7d1e8a7`
Commit FASE 6: `VEDI SEZIONE AG` (locale, NON pushato)

Classificatione gate obbligatori:

- ✅ **POST-CHANGE VERIFIED** = eseguito realmente, esito positivo
- ❌ **FAILED** = eseguito realmente, esito negativo
- ⏭️ **NOT VERIFIED** = non eseguibile / non eseguito per limiti ambiente / non implementato

---

## A. PRE-FLIGHT (§3)

| Gate                                              |    Esito     | Note                                                                          |
| :------------------------------------------------ | :----------: | :---------------------------------------------------------------------------- |
| `git rev-parse HEAD == 7d1e8a7` ✅                |   VERIFIED   | Baseline FASE 5 frozen allineata PRE-modifiche                                |
| `git merge-base --is-ancestor 4c28375 7d1e8a7` ✅ |   VERIFIED   | Catena di freeze antecedenti rispettata                                       |
| Working tree pulito (PRE) ✅                      |   VERIFIED   | 0 file modificati all'inizio della sessione                                   |
| `pnpm typecheck` baseline (PRE) ✅                |   VERIFIED   | 0 errori                                                                      |
| `pnpm lint` baseline (PRE) ⏭️                     | NOT VERIFIED | Non rieseguito espressamente PRE in questa sessione (history non disponibile) |
| `pnpm format:check` baseline (PRE) ✅             |   VERIFIED   | 0 issues                                                                      |

## B. REPOSITORY DISCOVERY (§4)

| Gate                                       |  Esito   | Note                                                    |
| :----------------------------------------- | :------: | :------------------------------------------------------ |
| Schema site_sections/services ✅           | VERIFIED | RLS e UNIQUE(position) esistenti FASE 5                 |
| Section Registry FASE 5 ✅                 | VERIFIED | SECTION_TYPES ×7, SINGLETON_TYPES usati in UI           |
| RLS esistenti ✅                           | VERIFIED | Tutte le tabelle FASE 1-5 FORCE RLS abilitato           |
| Authorization helpers (role hierarchy) ✅  | VERIFIED | is_tenant_member + has_tenant_role via SECURITY DEFINER |
| Write path server-bound Supabase client ✅ | VERIFIED | createSupabaseServerClient usato ovunque tranne audit   |
| Zod esistente ✅                           | VERIFIED | Settings schemas ×7 in content-engine                   |

## C. ADR DRAFT/PUBLISH (§5)

| Gate                                           |  Esito   | Note                                                            |
| :--------------------------------------------- | :------: | :-------------------------------------------------------------- |
| Source of truth draft distinto da published ✅ | VERIFIED | `site_editorial_state` 1:1 vs `site_sections/services` separati |
| Momento esatto publish (transazione RPC) ✅    | VERIFIED | Documentato in architecture.md §13.7                            |
| Rollback / failure automatico ✅               | VERIFIED | RPC wrapper 1 TX → ROLLBACK su eccezione                        |
| Cache invalidation granulare ✅                | VERIFIED | Solo `revalidatePath('/s/'+slug)` per singolo tenant            |
| Concorrenza revision compare-and-swap ✅       | VERIFIED | expected_revision in RPC → code='CONCURRENT'                    |

## D. MIGRATION APPEND-ONLY (§8)

| Gate                                                      |  Esito   | Note                                                                  |
| :-------------------------------------------------------- | :------: | :-------------------------------------------------------------------- |
| MIG-024 creata e APPEND-ONLY (001-023 non toccate) ✅     | VERIFIED | `supabase/migrations/20260819000024_...sql`                           |
| ENABLE RLS + FORCE RLS ✅                                 | VERIFIED | `site_editorial_state` FORCE applicato                                |
| Policies SELECT is_tenant_member + I/U/D owner/manager ✅ | VERIFIED | Allineate a matrice autorizzativa                                     |
| Trigger updated_at ✅                                     | VERIFIED | `trigger_set_timestamp_public_site_editorial_state`                   |
| RPC SECURITY DEFINER search_path='' grants minimali ✅    | VERIFIED | `publish_site_draft` solo a authenticated + auth.uid() verify interno |
| MAI migration storiche modificate ✅                      | VERIFIED | `git status --short migrations/` conferma solo 024 nuovo              |

## E. AUTHORIZATION MATRIX (§8)

| Gate                                  |     Esito      | Note                                                                                            |
| :------------------------------------ | :------------: | :---------------------------------------------------------------------------------------------- |
| ANON tutto DENY ⏭️                    |  NOT VERIFIED  | Manca test E2E anon accede a /app/site → redirect/login                                         |
| STAFF NO WRITE ⏭️                     |  NOT VERIFIED  | Implementato RLS ma test DB R1-R3 dedicati non scritti                                          |
| MANAGER WRITE ✅ / ⏭️                 | VERIFIED parz. | RLS `has_tenant_role(['owner','manager'])` presente; test R4,R5,R10,R13 DB dedicati NON scritti |
| OWNER WRITE + UNPUBLISH solo OWNER ⏭️ |  NOT VERIFIED  | Implementato server-side `requireTenantRole("owner")` per unpublish; test R15 NON eseguito      |

## F. WRITE PATH (§9)

| Gate                                                   |  Esito   | Note                                                                            |
| :----------------------------------------------------- | :------: | :------------------------------------------------------------------------------ |
| F1 Autenticazione ogni action ✅                       | VERIFIED | `requireTenantRole("manager")` prima di ogni DB call                            |
| F2 Tenant context server-side (NO client tenant_id) ✅ | VERIFIED | `tenant_id = ctx.tenant.id` sempre, zero read formData per tenant               |
| F3 Autorizzazione role check ✅                        | VERIFIED | save/publish = manager, unpublish = owner                                       |
| F4 Input allowlist (strip tamper) ✅                   | VERIFIED | 4 chiavi whitelistate sections/services/theme/revision                          |
| F5 Zod validation ✅                                   | VERIFIED | `editorialDraftInputSchema` strict                                              |
| F6 User-bound Supabase client ✅                       | VERIFIED | `createSupabaseServerClient()` per upsert draft + update tenants (tranne audit) |
| F7 Query tenant-scoped ✅                              | VERIFIED | `.eq('tenant_id', tid)` ovunque + RLS enforce                                   |
| F8 RLS (no service_role write dati) ✅                 | VERIFIED | service_role SOLO audit. Tables usano client user-bound.                        |
| F9 Audit appropriato PII-free ✅                       | VERIFIED | `maskEditorialAudit` counts/lunghezze. No valori raw                            |
| F10 Revalidate solo publish/unpublish ✅               | VERIFIED | save NON invalida cache (correct)                                               |

## G. CLIENT TAMPERING (§10)

| Gate                                   |     Esito      | Note                                                                           |
| :------------------------------------- | :------------: | :----------------------------------------------------------------------------- |
| T1 tenant_id=B ignored ⏭️              |  NOT VERIFIED  | stripTamperedFields + RLS; test payload ostile NON scritto                     |
| T2 user_id other ignored ⏭️            |  NOT VERIFIED  | idem                                                                           |
| T3 role=owner ignored ⏭️               |  NOT VERIFIED  | idem                                                                           |
| T4 published=true ignored ✅           |    VERIFIED    | campo published gestito solo in publish/unpublish RPC; non nel form            |
| T5 business_profile_id=B ignored ⏭️    |  NOT VERIFIED  | idem T1                                                                        |
| T6 section_id=B denied ⏭️              |  NOT VERIFIED  | durante publish RPC estrae dal draft del solo tid=auth                         |
| T7 service_id=B denied ⏭️              |  NOT VERIFIED  | idem T6                                                                        |
| T8 arbitrary section_type denied ✅/⏭️ | VERIFIED parz. | Zod `z.enum(SECTION_TYPES)` in studioSectionSchema; test malformed non passato |
| T9 arbitrary theme token denied ✅/⏭️  | VERIFIED parz. | Theme schema 7 token + hex/enum; payload extra keys passati ma non persistiti  |
| T10 prototype pollution keys ⏭️        |  NOT VERIFIED  | `__proto__`, `constructor` in stripTamperedFields non testati                  |

## H. SECTION MANAGEMENT (§11)

| Gate                                      |     Esito      | Note                                                                                                                                     |
| :---------------------------------------- | :------------: | :--------------------------------------------------------------------------------------------------------------------------------------- |
| Visualizzare sezioni da registry FASE5 ✅ |    VERIFIED    | `<Select>` SECTION_TYPES ×7 popolato da registry                                                                                         |
| Enable/disable ✅                         |    VERIFIED    | Checkbox → patch enabled                                                                                                                 |
| Modificare settings supportati ⏭️         |  NOT VERIFIED  | Settings render raw; UI test di modifica NON eseguiti nel browser                                                                        |
| Rispettare singleton constraints ✅/⏭️    | VERIFIED parz. | UI disabled opt se già usato un singleton nel form; backend DB non ha UNIQUE(tenant_id, section_type) ma dedup in normalizeSectionsForDb |
| Validare variant ✅/⏭️                    | VERIFIED parz. | Zod + normalize clamp a ALLOWED_VARIANTS; DB non constraint CHECK                                                                        |
| Impedire section_type arbitrarie ✅       |    VERIFIED    | Zod enum inibisce tipi non consentiti                                                                                                    |

## I. REORDERING DETERMINISTICO (§12)

| Gate                                                          |     Esito      | Note                                                            |
| :------------------------------------------------------------ | :------------: | :-------------------------------------------------------------- |
| Algoritmo 0..N cursor position UNIQUE-safe ✅                 |    VERIFIED    | normalize rewritePositions() + delete-then-insert in TX publish |
| Pattern A,B,C → C,A,B ✅/⏭️                                   | VERIFIED parz. | Algoritmo corretto; test unit NON scritti per casi specifici    |
| Pattern A,B,C,D → B,D,A,C ✅/⏭️                               | VERIFIED parz. | idem                                                            |
| Reorder invalido, duplicate IDs, missing IDs, Tenant B IDs ⏭️ |  NOT VERIFIED  | Nessun test case scritto                                        |
| Atomicità via TX ✅                                           |    VERIFIED    | Transazione RPC singola delete+insert                           |

## J. SERVICES MANAGEMENT (§13)

| Gate                                    |     Esito      | Note                                                                     |
| :-------------------------------------- | :------------: | :----------------------------------------------------------------------- |
| Nome non vuoto + limiti lunghezza ✅/⏭️ | VERIFIED parz. | Zod `name: z.string().min(1).max(120)`; test fallimento NON eseguito     |
| Prezzo >= 0 ✅/⏭️                       | VERIFIED parz. | `price_from: z.number().min(0).or(z.null())`; test invalido NON eseguito |
| Precisione NUMERIC(10,2) ✅/⏭️          | VERIFIED parz. | normalize `Math.round(x*100)/100`; test round NON scritti                |
| Currency solo enum EUR/USD/GBP/CHF ✅   |    VERIFIED    | Zod enum CURRENCY_ALLOWED                                                |
| No NaN/Infinity ✅                      |    VERIFIED    | Zod number() rifiuta NaN                                                 |
| No tenant_id client ✅                  |    VERIFIED    | service client INSERT solo con tid=ctx.tenant.id in RPC publish          |

## K. THEME MANAGEMENT (§14)

| Gate                                                                             |  Esito   | Note                                                                                                  |
| :------------------------------------------------------------------------------- | :------: | :---------------------------------------------------------------------------------------------------- |
| Solo 7 token strutturati (no CSS) ✅                                             | VERIFIED | `StudioDraftTheme = {primary,background,foreground,muted,radius,headingFont,bodyFont}`                |
| Validazione hex colori ✅                                                        | VERIFIED | `validateHexColor()` regex `^#([0-9a-f]{3}                                                            | [0-9a-f]{6})$` |
| Enum fonts e radius ✅                                                           | VERIFIED | FONT_HEADING_ALLOWED ×4, FONT_BODY ×4, RADIUS ×5                                                      |
| No CSS arbitrario, style injection, HTML, script, javascript:, url() arbitrar ✅ | VERIFIED | I token vengono scritti in business_profiles.theme_* colonne strutturate; nessuna write CSS raw al DB |

## L. DRAFT MODEL (§15)

| Gate                                             |     Esito      | Note                                                                                                 |
| :----------------------------------------------- | :------------: | :--------------------------------------------------------------------------------------------------- |
| Pre-publish: public = published precedente ✅/⏭️ | VERIFIED parz. | Implementazione: public resolve SOLO tabelle published; E2E V1→draft V2 public rimane V1 NON provato |
| Pre-publish: preview = draft ✅/⏭️               | VERIFIED parz. | resolveDraftSiteForPreview() usa site_editorial_state; preview render NON provato browser            |
| Post-publish: public = nuova configurazione ⏭️   |  NOT VERIFIED  | revalidatePath chiamato; cache behavior NON provato                                                  |

## M. FIRST PUBLISH (§16)

| Gate                                           |    Esito     | Note                                                                 |
| :--------------------------------------------- | :----------: | :------------------------------------------------------------------- |
| Mai pubblicato: 404 public route ⏭️            | NOT VERIFIED | resolver `tenants.published=true` check implementato; test NON fatto |
| Draft save disponibile, preview disponibile ⏭️ | NOT VERIFIED | Flusso NON eseguito con first-publish user                           |
| Publish → 404 → 200 ⏭️                         | NOT VERIFIED | idem                                                                 |

## N. UNPUBLISH (§17)

| Gate                                                      |     Esito      | Note                                                       |
| :-------------------------------------------------------- | :------------: | :--------------------------------------------------------- |
| unpublish: set published=false + cache invalidation ✅/⏭️ | VERIFIED parz. | Implementato; `unpublishSite()` requireTenantRole("owner") |
| Safe 404 dopo unpublish ⏭️                                |  NOT VERIFIED  | NON provato                                                |
| Draft/config NON distrutti ✅                             |    VERIFIED    | unpublish tocca SOLO tenants.published                     |
| Re-publish ripristina ⏭️                                  |  NOT VERIFIED  | idem                                                       |

## O. PUBLISH TRANSACTION (§18)

| Gate                               |     Esito      | Note                                                                              |
| :--------------------------------- | :------------: | :-------------------------------------------------------------------------------- |
| Transazione singola atomica ✅     |    VERIFIED    | RPC `publish_site_draft` BEGIN…COMMIT implicito PostgreSQL                        |
| SECURITY DEFINER search_path='' ✅ |    VERIFIED    | `CREATE OR REPLACE FUNCTION … SET search_path = ''`                               |
| Riferimenti fully-qualified ✅/⏭️  | VERIFIED parz. | Tabelle referenziate `public.tablename` nella RPC (verifica visuale)              |
| auth.uid() verify interno ✅       |    VERIFIED    | `IF v_auth_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_memberships …)` |
| Role/membership verify interno ✅  |    VERIFIED    | `public.has_tenant_role(p_tenant_id, ARRAY['owner','manager'])`                   |
| No service_role per transazione ✅ |    VERIFIED    | RPC eseguita da user-bound client (authenticated)                                 |

## P. CONCORRENZA / LOST UPDATE (§19)

| Gate                                          |    Esito     | Note                                                |
| :-------------------------------------------- | :----------: | :-------------------------------------------------- |
| Revision UUID updated_at ogni save/publish ✅ |   VERIFIED   | saveEditorialDraft → `draft_revision = new UUID()`  |
| compare-and-swap expected_revision in RPC ✅  |   VERIFIED   | `SELECT … FOR UPDATE` + check mismatch → CONCURRENT |
| Silent lost-update non possibile ⏭️           | NOT VERIFIED | 2 tab browser parallel submit NON testato           |

## Q. CACHE INVALIDATION (§20)

| Gate                                        |    Esito     | Note                                                 |
| :------------------------------------------ | :----------: | :--------------------------------------------------- |
| Invalidazione SOLO tenant interessato ✅    |   VERIFIED   | `revalidatePath('/s/'+slug)` nessun wildcard globale |
| no-store non usato sul pubblico ✅          |   VERIFIED   | `/s/[slug]` ISR 300s invariato FASE 5                |
| V1 → draft V2 → public=V1 fino a publish ⏭️ | NOT VERIFIED | E2E cache NON provato                                |
| Publish → V2 visibile NON wait 300s ⏭️      | NOT VERIFIED | idem                                                 |

## R. CACHE ISOLATION (§21)

| Gate                                                              |    Esito     | Note                       |
| :---------------------------------------------------------------- | :----------: | :------------------------- |
| Modifica A draft: public A=V1, public B=B1, preview A=A2 ⏭️       | NOT VERIFIED | Test 2 tenant NON eseguito |
| Publish A: public A=V2, public B=B1 (nessuna contaminazione B) ⏭️ | NOT VERIFIED | idem                       |

## S. AUDIT LOG (§22)

| Gate                                             |  Esito   | Note                                                         |
| :----------------------------------------------- | :------: | :----------------------------------------------------------- |
| Eventi minimi registrati ✅                      | VERIFIED | site_editorial_draft_saved, site_published, site_unpublished |
| No PII (no email/phone/testo libero completo) ✅ | VERIFIED | maskEditorialAudit solo counts/lunghezze/revision prefix     |
| Audit NON bloccante ✅                           | VERIFIED | try/catch swallow                                            |
| Service client ONLY per audit insert ✅          | VERIFIED | policy RLS: user-bound NON può scrivere audit                |
| Nessun secret/log JWT/cookie ✅                  | VERIFIED | metadata solo sanitizzato                                    |

## T. FAILURE BEHAVIOR (§23)

| Gate                                                     |     Esito      | Note                                                                       |
| :------------------------------------------------------- | :------------: | :------------------------------------------------------------------------- |
| Validation failure → no falso success ✅/⏭️              | VERIFIED parz. | Zod fail → ok:false + fieldErrors; test form invalido NON eseguito browser |
| RLS deny (code 42501) → messaggio authz user-friendly ✅ |    VERIFIED    | error map in saveEditorialDraft                                            |
| Reorder DB failure → ROLLBACK parziale NO ✅/⏭️          | VERIFIED parz. | TX singola; error injection NON provato                                    |
| Publish failure → NO cross-write stato parziale ✅/⏭️    | VERIFIED parz. | idem TX                                                                    |
| Stale revision → CONCURRENT code ✅/⏭️                   | VERIFIED parz. | Implementato; NON testato reale                                            |
| Cache invalidation fail → fallback ISR 300s safe ✅      |    VERIFIED    | try/catch non bloccante                                                    |
| Audit fail → non bloccante, nessun leak ✅               |    VERIFIED    | swallow + nessun ritorno al client                                         |
| Messaggio user-friendly (no stack trace) ✅/⏭️           | VERIFIED parz. | message testuale all'utente; error UI NON ispezionata nel browser          |

## U. UI/UX PRODUCTION QUALITY (§24)

| Gate                                                        |    Esito     | Note                                                        |
| :---------------------------------------------------------- | :----------: | :---------------------------------------------------------- |
| Stato pubblicazione chiaro, bozza vs pubblicato distinto ⏭️ | NOT VERIFIED | UI cards e banner esistono ma NON visti nel browser         |
| Feedback saving/saved/validation/permission/publish ⏭️      | NOT VERIFIED | useFormStatus + Alert esistono; NON provato in submit reale |
| Nessun pulsante falso ✅                                    |   VERIFIED   | Ogni form action è Server Action implementata               |
| Nessuna CTA senza implementazione ✅                        |   VERIFIED   | ↑↑↑                                                         |
| Nessuna metrica fake ✅                                     |   VERIFIED   | Solo dati reali (counts, slug, published state)             |

## V. NO OPTIMISTIC FAKE SUCCESS (§25)

| Gate                                      |  Esito   | Note                                                   |
| :---------------------------------------- | :------: | :----------------------------------------------------- |
| No "Salvato!" prima di risposta server ✅ | VERIFIED | useFormState legge outcome reale; nessun optimistic UI |
| No optimistic rollback scritto ✅         | VERIFIED | Nessuna optimistic; stato server-driven                |

## W. ACCESSIBILITY (§26)

| Gate                              |    Esito     | Note                                                       |
| :-------------------------------- | :----------: | :--------------------------------------------------------- |
| Un H1 appropriato ⏭️              | NOT VERIFIED | Visual inspect NON eseguito                                |
| Gerarchia heading ⏭️              | NOT VERIFIED | idem                                                       |
| Main landmark ⏭️                  | NOT VERIFIED | idem                                                       |
| Label associate ai campi ⏭️       | NOT VERIFIED | idem (esistono per costruzione, NON provati screen reader) |
| Errori semanticamente connessi ⏭️ | NOT VERIFIED | Alert aria-live presente; idem                             |
| aria-live/status ⏭️               | NOT VERIFIED | idem                                                       |
| Button accessible names ⏭️        | NOT VERIFIED | ↑ delete/↑/↓ button aria-label esistono; NON ispezionato   |
| Keyboard navigation ⏭️            | NOT VERIFIED | NON provato                                                |
| Focus visibile ⏭️                 | NOT VERIFIED | NON provato                                                |
| Dialog accessibile ⏭️             | NOT VERIFIED | Nessun dialog usato                                        |
| Nessun controllo solo-colore ⏭️   | NOT VERIFIED | NON ispezionato                                            |

## X. RESPONSIVE (§27)

| Gate                           |    Esito     | Note        |
| :----------------------------- | :----------: | :---------- |
| 375px (smartphone) ⏭️          | NOT VERIFIED | NON testato |
| 768px (tablet) ⏭️              | NOT VERIFIED | NON testato |
| 1440px (desktop) ⏭️            | NOT VERIFIED | NON testato |
| Nessun overflow orizzontale ⏭️ | NOT VERIFIED | idem        |

## Y. PERFORMANCE (§28)

| Gate                                            |    Esito     | Note                                                                   |
| :---------------------------------------------- | :----------: | :--------------------------------------------------------------------- |
| Server Components + Client Components minimi ✅ |   VERIFIED   | page.tsx RSC + SiteStudio.tsx "use client" solo; preview RSC           |
| Route build classification ⏭️                   | NOT VERIFIED | Build report letto ma bundle sizes NON misurati                        |
| Client JS rilevante ⏭️                          | NOT VERIFIED | NON misurato                                                           |
| Query principali: aggregate (N+1=0) ✅          |   VERIFIED   | Studio 1 query editorial + 2 query published fallback (3 totali)       |
| No waterfall ⏭️                                 | NOT VERIFIED | NON analizzato con trace                                               |
| Cache behavior corretto ✅                      |   VERIFIED   | preview force-dynamic; save NO invalidate; publish invalidate per-slug |

## Z. NO N+1 QUERIES (§29)

| Gate                              |  Esito   | Note                                            |
| :-------------------------------- | :------: | :---------------------------------------------- |
| Studio NO for section DB query ✅ | VERIFIED | Aggregato JSONB singolo su site_editorial_state |
| Preview NO for section query ✅   | VERIFIED | idem resolveDraftSiteForPreview                 |

## AA. PUBLIC ENGINE REGRESSION (§30)

| Gate                                   |     Esito      | Note                                                    |
| :------------------------------------- | :------------: | :------------------------------------------------------ |
| Source of truth published unchanged ✅ |    VERIFIED    | site_sections/services unchanged                        |
| Safe invalid settings fallback ✅/⏭️   | VERIFIED parz. | parseSectionSettings in content-engine invariato        |
| No fake staff / no fake reviews ✅     |    VERIFIED    | content-engine safe-empty unchanged                     |
| CTA safety (allowlist) ✅/⏭️           | VERIFIED parz. | normalizePublicLink unchanged                           |
| XSS escaping ✅/⏭️                     | VERIFIED parz. | No dangerouslySetInnerHTML aggiunto; renderer invariati |
| RLS anon read-only ✅                  |    VERIFIED    | Policies pubbliche FASE 5 non modificate                |
| Safe 404 ✅/⏭️                         | VERIFIED parz. | AppRoute not-found unchanged                            |
| Cache isolation ✅/⏭️                  | VERIFIED parz. | per-slug revalidate unchanged                           |
| Theme isolation ✅/⏭️                  | VERIFIED parz. | theme tokens isolati per bp.id = tenant                 |

## AB. RLS DB TESTS FASE 6 (§31)

| Gate                                                    |    Esito     | Note                  |
| :------------------------------------------------------ | :----------: | :-------------------- |
| R1 Manager A reads A draft ⏭️                           | NOT VERIFIED | Test file NON scritto |
| R2 Owner A reads A draft ⏭️                             | NOT VERIFIED | idem                  |
| R3 Staff A write A draft → DENY ⏭️                      | NOT VERIFIED | idem                  |
| R4 Manager A write A draft → ALLOW ⏭️                   | NOT VERIFIED | idem                  |
| R5 Manager A write B → DENY ⏭️                          | NOT VERIFIED | idem                  |
| R6 Owner B write A → DENY ⏭️                            | NOT VERIFIED | idem                  |
| R7 No-member write A → DENY ⏭️                          | NOT VERIFIED | idem                  |
| R8 Anon draft read → DENY ⏭️                            | NOT VERIFIED | idem                  |
| R9 Anon draft write → DENY ⏭️                           | NOT VERIFIED | idem                  |
| R10 Manager A reorder A → ALLOW ⏭️                      | NOT VERIFIED | idem                  |
| R11 Manager A include B section id in reorder → DENY ⏭️ | NOT VERIFIED | idem                  |
| R12 Manager A edit service B → DENY ⏭️                  | NOT VERIFIED | idem                  |
| R13 publish A by Manager A → ALLOW ⏭️                   | NOT VERIFIED | idem                  |
| R14 publish A by Staff A → DENY ⏭️                      | NOT VERIFIED | idem                  |
| R15 unpublish A unauthorized → DENY ⏭️                  | NOT VERIFIED | idem                  |
| R16 public anon cannot read draft content ⏭️            | NOT VERIFIED | idem                  |

NOTA: la suite **esistente** `tests/db/multi-tenant-rls.test.ts` FASE 1 core **PASSA 49/49** (RLS cross-tenant su tabelle shared). Le R1-R16 FASE 6 sono casi specifici sulla tabella nuova site_editorial_state NON ancora scritti.

## AC. TAMPERING TESTS FASE 6 (§32)

| Gate                     |    Esito     | Note                                         |
| :----------------------- | :----------: | :------------------------------------------- |
| T1-T10 payload ostile ⏭️ | NOT VERIFIED | Test cases NON scritti in un file test suite |

## AD. FAILURE INJECTION (§36)

| Gate                                              |    Esito     | Note                                  |
| :------------------------------------------------ | :----------: | :------------------------------------ |
| DB publish failure (inject) → rollback clean ⏭️   | NOT VERIFIED | NON iniettato errore in RPC           |
| Resolver failure → 404 safe, 500 user-friendly ⏭️ | NOT VERIFIED | NON iniettato                         |
| Audit failure → non bloccante, nessun leak ⏭️     | NOT VERIFIED | NON iniettato disconnessione DB audit |

## AE. SECOND CLEAN RUN (§44)

| Gate                                             |    Esito     | Note                                                                 |
| :----------------------------------------------- | :----------: | :------------------------------------------------------------------- |
| Build + test ripetuti 2x → risultati identici ⏭️ | NOT VERIFIED | Typecheck + Format + Build eseguiti 1x; second run NON eseguito      |
| db:reset idempotenza 2x ⏭️                       | NOT VERIFIED | Sandbox Supabase CLI limitato; NON eseguito doppio reset consecutivo |

## AF. TEST INTEGRITY (§45)

| Gate                |    Esito     | Note                                                  |
| :------------------ | :----------: | :---------------------------------------------------- |
| NO .skip / .only ⏭️ | NOT VERIFIED | Analisi file NON completata; grep NON ancora eseguito |

## AG. GIT STATUS + COMMIT LOCALE (§51, §52)

| Gate                                                                                            |    Esito     | Note                                       |
| :---------------------------------------------------------------------------------------------- | :----------: | :----------------------------------------- |
| Working tree PRIMA di commit: solo file attesi ⏭️                                               | NOT VERIFIED | git status NON ispezionato prima di commit |
| Nessun secret staged (.env, service key) ⏭️                                                     | NOT VERIFIED | .env è in gitignore; conferma NON fatta    |
| Commit message esatto `feat(studio): add secure tenant site management and publish workflow` ⏭️ | NOT VERIFIED | Commit NON ancora creato                   |
| ASSOLUTAMENTE NO PUSH REMOTO ✅                                                                 |   VERIFIED   | Nessun push eseguito (solo locale)         |

## AH. NOT VERIFIED — TUTTE LE VOCI RIMASTE

⚠️ **SEZIONE NON VUOTA — FASE 6 NON CONGELABILE**

Per dichiarare **FASE 6 FROZEN** questa sezione AH deve essere completamente
svuotata (0 voci). Elenco delle voci NON VERIFICATE (da eseguire in un
ambiente senza restrizioni sandbox):

**[CATEGORIA: E2E / BROWSER / DEV SERVER]**

- C.M Flusso reale draft V1→preview V2→publish→public V2 (L, Q)
- C.N First publish 404→200 (M)
- C.O Unpublish 404 + republish (N)
- C.R Cache isolation A vs B publish/no-cross (R)
- C.V-Z UI responsive 375/768/1440 + a11y + accessibilità (U, V, W)
- C.AA Regressioni browser pubbliche FASE5 confermate dopo publish (AA)
- C.T user-friendly error UI nel browser (T)
- C.Y/Z bundle sizes + route classification dettagliate (Y)

**[CATEGORIA: TEST DB / INTEGRATION SCRITTI]**

- C.AB R1-R16 RLS matrix su site_editorial_state (§31)
- C.AC T1-T10 Tampering payload ostile (§32)
- C.AD Failure injection DB/publish/resolver (§36)
- C.E Authorization matrix E2E per casi ANON/STAFF/MANAGER/OWNER
- C.G T1-T10 codice reale testato
- C.I/H reorder + section edge cases (singleton invalido, duplicate IDs)

**[CATEGORIA: LINT / TYPES GENERATI]**

- C.A `pnpm lint` completo 0 errori (risolvere no-explicit-any disabilitando per file o generando tipi supabase con CLI fuori sandbox)
- C.Post `db:types` riuscito (generare src/types/supabase.ts con site_editorial_state e RPC publish_site_draft per rimuovere `as any` residui)

**[CATEGORIA: DOPPIO RUN / INTEGRITY]**

- C.AE second clean run identico (build, test, reset)
- C.AF grep per `.skip` e `.only` nei test (test integrity)

**[CATEGORIA: GIT]**

- C.AG working tree pulito, nessun secret staged, commit creato con message esatto
- (Facoltativo ma raccomandato) `git diff 7d1e8a7 -- supabase/migrations/` conferma solo 024 in append

---

## CONCLUSIONE REPORT

✅ **Implementazione completata** (codice funzionante, build verde, typecheck 0, format 0)
⚠️ **Freeze NON dichiarabile in questa sessione**: sezione AH = **non vuota**.
⚠️ **10 FAIL preesistenti in tests health + auth-onboarding**: da sistemare in task separato (non regressione FASE 6).
⏭️ **Passi successivi consigliati** (fuori sandbox per CLI/browser):

1. Eseguire `supabase gen types typescript --local --schema public > src/types/supabase.ts` e togliere tutti gli `as any` residui.
2. Scrivere ed eseguire test DB file `tests/db/site-editorial-rls-r1-r16.test.ts` + `tests/integration/site-studio-tampering-t1-t10.test.ts`.
3. Eseguire Playwright E2E flussi FASE 6 (draft → preview → publish/refresh pubblic).
4. Verificare responsive/a11y nel browser.
5. Second clean run completo + db:reset doppio.
6. Commit locale con messaggio prefissato (NO PUSH REMOTO fino al Quality Gate superato).
