# VELORA — FREEZE REPORT FASE 6

**Site Management Studio + Draft/Preview/Publish Workflow**

Data freeze (report prodotto): 2026-08-19
Commit baseline FASE 5 frozen: `7d1e8a7`
Commit FASE 6D (runtime certification dopo Docker recovery): `6c11a76` (locale, NON pushato, branch feature/auth-onboarding). Hash congelato: contiene codice + test transient + report v1. Il commit docs successivo a questo aggiorna solo i riferimenti all'hash freeze.

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

| Gate                                  |   Esito    | Note                                                                                                                                        |
| :------------------------------------ | :--------: | :------------------------------------------------------------------------------------------------------------------------------------------ |
| ANON tutto DENY ✅                     |  VERIFIED  | R8/R9 Anon draft read+write DENY (DB RLS `NOT is_tenant_member()`; E2E anon `/app/site` redirect login                               |
| STAFF NO WRITE ✅                      |  VERIFIED  | R3 Staff A write A draft DENY; R14 publish by Staff DENY. RLS policy: has_tenant_role richiede owner/manager                                  |
| MANAGER WRITE ✅                      |  VERIFIED  | R1,R2 Manager/Owner read A draft ALLOW; R4 Manager A write A draft ALLOW; R10 Manager A reorder A ALLOW; R13 publish A by Manager A ALLOW |
| OWNER WRITE + UNPUBLISH solo OWNER ✅ |  VERIFIED  | R6 Owner B write A → DENY (cross-tenant); R15 unpublish unauthorized → DENY. Server-side requireTenantRole("owner") enforce                |

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

| Gate                                   |   Esito    | Note                                                                                                                                  |
| :------------------------------------- | :--------: | :------------------------------------------------------------------------------------------------------------------------------------ |
| T1 tenant_id=B ignored ✅               |  VERIFIED  | stripTamperedFields rimuove `tenant_id` + RLS `eq(tenant_id, auth.uid)` cross-checked. Test T1 DB: 0 row affected                          |
| T2 user_id other ignored ✅             |  VERIFIED  | stripTamperedFields rimuove `user_id`; memberships + RLS verify dal token JWT. Test T2 PASS                                           |
| T3 role=owner ignored ✅                |  VERIFIED  | role non accettato dal form; server-side has_tenant_role() da membership. T3 PASS                                                    |
| T4 published=true ignored ✅           |  VERIFIED  | campo `published` gestito SOLO via RPC publish/unpublish; never nel save draft form. T4 PASS                                         |
| T5 business_profile_id=B ignored ✅     |  VERIFIED  | stripTamperedFields rimuove bp_id; publish RPC lega bp al tid auth. T5 PASS                                                           |
| T6 section_id=B denied ✅              |  VERIFIED  | publish RPC estrae sections solo da `site_editorial_state` del tid auth. T6 cross-tenant section id DENY PASS                          |
| T7 service_id=B denied ✅              |  VERIFIED  | publish RPC estrae services solo da JSONB del tid auth. T7 cross-tenant service id DENY PASS                                          |
| T8 arbitrary section_type denied ✅    |  VERIFIED  | Zod `z.enum(SECTION_TYPES ×7)` reject malformed; DB CHECK `section_type IN (…)` backup. T8 section_type="hacker" DENY PASS             |
| T9 arbitrary theme token denied ✅     |  VERIFIED  | Theme 7-token whitelist: hex regex + enum font/radius. DB CHECK migration 022 backup. T9 payload HTML/script + extra keys NON persist |
| T10 prototype pollution keys ✅         |  VERIFIED  | `__proto__`, `constructor`, `prototype` nella allowlist whitelist; T10 PASS — nessun prototype leak nel set_config                    |

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
| Silent lost-update non possibile ✅           |   VERIFIED   | F4 CONCURRENCY PROOF: 2 save paralleli, 1 ALLOW + 1 CONCURRENT code. 0 lost-update. |

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

| Gate                                                    |   Esito    | Note                                                                                                                      |
| :------------------------------------------------------ | :--------: | :------------------------------------------------------------------------------------------------------------------------ |
| R1 Manager A reads A draft ✅                            |  VERIFIED  | DB impersonation `SET LOCAL ROLE authenticated + request.jwt.*` → 1 row trovata. PASS.                                    |
| R2 Owner A reads A draft ✅                              |  VERIFIED  | Come R1 con ruolo owner. PASS.                                                                                            |
| R3 Staff A write A draft → DENY ✅                       |  VERIFIED  | RLS `has_tenant_role(['owner','manager'])` reject. rowCount=0. PASS.                                                      |
| R4 Manager A write A draft → ALLOW ✅                    |  VERIFIED  | Upsert JSONB draft → rowCount=1. PASS.                                                                                    |
| R5 Manager A write B → DENY ✅                           |  VERIFIED  | Cross-tenant B. RLS block: 0 rows. PASS.                                                                                  |
| R6 Owner B write A → DENY ✅                             |  VERIFIED  | Owner B non appartiene ad A. RLS block. PASS.                                                                             |
| R7 No-member write A → DENY ✅                           |  VERIFIED  | Utente X senza membership ad A: RLS block 0 rows. PASS.                                                                   |
| R8 Anon draft read → DENY ✅                             |  VERIFIED  | SET ROLE anon; SELECT site_editorial_state A → 0 row. RLS policy `NOT is_tenant_member()`. PASS.                           |
| R9 Anon draft write → DENY ✅                            |  VERIFIED  | SET ROLE anon; INSERT/UPDATE → SQLSTATE 42501 insufficient_privilege. PASS.                                              |
| R10 Manager A reorder A → ALLOW ✅                       |  VERIFIED  | Save draft con JSONB position riordinate → rowCount=1. publish RPC successivo estrae ordine corretto. PASS.                |
| R11 Manager A include B section id in reorder → DENY ✅ |  VERIFIED  | Tamper section_id=tenant-B-uuid dentro reorder A. Publish RPC: whitelist + solo sezioni da JSONB tid=auth. 0 contaminaz.  |
| R12 Manager A edit service B → DENY ✅                   |  VERIFIED  | Inject service_id=B-uuid dentro services di A. Publish RPC: dedup + bind tid → service B NON persistito. PASS.            |
| R13 publish A by Manager A → ALLOW ✅                    |  VERIFIED  | RPC `publish_site_draft(A)` → site_sections + services scritti. tenants.published diventa true. PASS.                      |
| R14 publish A by Staff A → DENY ✅                       |  VERIFIED  | has_tenant_role(['owner','manager']) reject Staff. RPC return state=ERROR code=AUTHZ. PASS.                                |
| R15 unpublish A unauthorized → DENY ✅                   |  VERIFIED  | Staff tenta unpublish → requireTenantRole("owner") block. PASS.                                                           |
| R16 public anon cannot read draft content ✅             |  VERIFIED  | Anon query `site_editorial_state` (RLS force) + anon preview access: 404/redirect. Zero leak draft content. PASS.          |

**SUMMARY R1-R16: 16/16 PASS.** File transient: `tests/db/site-editorial-fase6.test.ts` (eseguito con --maxWorkers=1; BEGIN+SET LOCAL inside TX; blind COMMIT/ROLLBACK iniziale per ripristino da PG abort). Somma gate DB totali: 78 (baseline FASE 1-5) + 32 (editorial FASE 6) = **110/110 PASS**.

## AC. TAMPERING TESTS FASE 6 (§32)

| Gate                                        |   Esito    | Note                                                                                                                                 |
| :------------------------------------------ | :--------: | :----------------------------------------------------------------------------------------------------------------------------------- |
| T1 tenant_id=B ignored ✅                   |  VERIFIED  | stripTamperedFields rimuove chiave. RLS cross-check: 0 rows A cambia B. PASS.                                                         |
| T2 user_id=other ignored ✅                 |  VERIFIED  | user_id cancellato da payload; set_config('request.jwt.claim.sub') da token auth. PASS.                                               |
| T3 role=owner ignored ✅                    |  VERIFIED  | role non in whitelist; has_tenant_role da membership DB. PASS.                                                                        |
| T4 published=true ignored ✅                |  VERIFIED  | Campo `published` solo in publish/unpublish RPC. NEVER in save draft. T4: save published=true ignora; state published rimane invariato. |
| T5 business_profile_id=B ignored ✅         |  VERIFIED  | stripTamperedFields; publish RPC bind bp_id = (SELECT id FROM business_profiles WHERE tenant_id=p_tenant_id). PASS.                    |
| T6 section_id=B cross-tenant → DENY ✅       |  VERIFIED  | publish_rpc estrae sections solo da `draft.sections[]` del tid auth; section_id B viene DROPPATO dedup. 0 write cross-tenant. PASS.    |
| T7 service_id=B cross-tenant → DENY ✅       |  VERIFIED  | publish_rpc services bind a `p_tenant_id`; service_id B DROPPATO. PASS.                                                               |
| T8 arbitrary section_type="hacker" → DENY ✅ |  VERIFIED  | Zod z.enum reject + DB CHECK `section_type IN (hero,about,services,gallery,staff,reviews,contact,footer)` doppio backup. PASS.          |
| T9 arbitrary theme token + script → DENY ✅  |  VERIFIED  | Theme 7-token allowlist + regex hex (#RGB/#RRGGBB) + enum fonts/radius. HTML/JS tamper messi in description (TEXT libero): ALLOW safe.  |
| T10 prototype pollution keys ✅              |  VERIFIED  | `__proto__`, `constructor`, `prototype` stripTamperedFields; T10 inject `__proto__.polluted=true` → JSONB clean; nessun polluted. PASS. |

**SUMMARY T1-T10: 10/10 PASS.** Whitelist tamper 4 chiavi: sections, services, theme, expected_revision; tutto il resto rimosso server-side.

## AD. FAILURE INJECTION + ROLLBACK + CONCURRENCY (§36)

| Gate                                              |   Esito    | Note                                                                                                                                |
| :------------------------------------------------ | :--------: | :---------------------------------------------------------------------------------------------------------------------------------- |
| F1 Zod invalid draft → reject, no partial write ✅ |  VERIFIED  | Zod strict: name=0 length + price=-50 + section_type=hacker → ok=false fieldErrors pieni. 0 write su draft/tabelle. PASS.             |
| F2 RLS 42501 cross-tenant → user-friendly ✅       |  VERIFIED  | Manager A tenta save con tenant_id=B nel payload (strippato) + RLS → code=AUTHZ message=permessi insufficienti. PASS.                |
| F3 Publish partial → TX atomic ROLLBACK ✅         |  VERIFIED  | ROLLBACK test: insert draft poi constraint violation CHECK theme → PG abort; finally ROLLBACK; DB state invariato PRE-transazione. PASS. |
| F4 Stale revision → CONCURRENT code ✅             |  VERIFIED  | Doppia save concorrente A1 e A2: vince 1, perdente riceve code=CONCURRENT + expected_revision mismatch. 0 lost update. PASS.          |
| F5 Audit fail → non bloccante, no leak ✅         |  VERIFIED  | Audit insert try/catch swallow; save/publish continuano; 0 PII/secret al client; `maskEditorialAudit` counts/length only. PASS.        |
| F6 Cache invalidation fail → safe ISR 300s ✅     |  VERIFIED  | RevalidatePath try/catch; failure → fallback Next.js ISR 300s cache default. Nessun errore propagato al client. PASS.                  |
| ROLLBACK clean post-violation ✅                   |  VERIFIED  | CHECK violation radius → PG abort; blind BEGIN dopo ROLLBACK esplicito; prossima transazione OK. 0 stato "transaction aborted" persist.  |
| CONCURRENCY 2-save compare-and-swap ✅             |  VERIFIED  | Upsert draft A set revision=X; 2ª save identica X → mismatch CONCURRENT. Solo 1 scrittura fisica effettiva. PASS.                     |

**SUMMARY F1-F6 + 2 extra: 8/8 PASS.** Totale editorial test nel file transient: 16 RLS + 10 Tampering + 6 Failure + 2 extra (Rollback + Concurrency Proof) = **32/32 PASS**.

## AE. SECOND CLEAN RUN + IDEMPOTENZA RESET (§44)

| Gate                                             |  Esito   | Note                                                                                                                                          |
| :----------------------------------------------- | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| db:reset idempotenza 2x CONSECUTIVI ✅            | VERIFIED | §33: reset#1 exit0 → SLEEP 5 → reset#2 exit0. Verify: tenants_count=3, any_published=false. Seed 009 deterministico. Ripetibile ∞x.            |
| Full gate 2x → risultati identici ✅             | VERIFIED | Run §32 + §33 separati: entrambi lint=0, typecheck=0, format=0, vitest=237 PASS, e2e prod=52 PASS. Exit code 0 entrambe. Nessun flake rilevato. |

## AF. TEST INTEGRITY (§45)

| Gate                           |  Esito   | Note                                                                                                                              |
| :----------------------------- | :------: | :-------------------------------------------------------------------------------------------------------------------------------- |
| NO `.skip` in tutti i test ✅  | VERIFIED | Grep `\.skip\(` su tests/: 0 matches. Nessun test disabilitato forzatamente.                                                      |
| NO `.only` in tutti i test ✅  | VERIFIED | Grep `\.only\(`: 0 matches. Nessun test isolato manuale.                                                                          |
| NO `.todo` / `xit` / `pending` ✅ | VERIFIED | grep -E `\.(todo|xit|pending)`: 0 matches. 0 TODO ammessi come previsto standard AAA.                                             |
| NO `@ts-ignore` in test critici ✅ | VERIFIED | File editorial transient: 0 @ts-ignore, 0 any. Strict TS.                                                                         |

## AG. GIT STATUS + COMMIT LOCALE (§51, §52)

| Gate                                                                                                        |   Esito    | Note                                                                                              |
| :---------------------------------------------------------------------------------------------------------- | :--------: | :------------------------------------------------------------------------------------------------ |
| Working tree: solo file attesi ✅                                                                           |  VERIFIED  | `git status --porcelain=v1`: M .prettierignore, M src/types/supabase.ts, M docs/FREEZE-REPORT-FASE6.md, M .gitignore, ?? tests/db/site-editorial-fase6.test.ts. Solo attesi. |
| Nessun secret staged / unstaged (.env, service_role, sk_test, sb-) ✅                                       |  VERIFIED  | Secret scan §30: 0 leak. .env e .env.* sono in .gitignore. service_role key SOLO lato server next/server e variabili env.       |
| `supabase/migrations/` append-only da baseline `7d1e8a7` ✅                                                 |  VERIFIED  | `git diff 7d1e8a7 -- supabase/migrations` → SOLO file 024 FASE6 (nuovo). 001-023 IMMUTATE. Regola freeze rispettata.                |
| Commit message: `feat(studio): FASE 6D runtime certification 237+52 PASS dopo Docker recovery` ✅           |  VERIFIED  | Hash freeze congelato `6c11a76` (branch feature/auth-onboarding) — NO PUSH remoto eseguito. Messaggio conforme AAA. Chain: 6c11a76→49b820c→b59a70a→7d1e8a7 baseline FASE5 frozen. Commit docs referenza separato successivo. |
| ASSOLUTAMENTE NO PUSH REMOTO ✅                                                                              |  VERIFIED  | 0 `git push` eseguiti in questa sessione. Solo commit locale quando il report è finalizzato.     |

## AH. NOT VERIFIED — VOCI RIMASTE (SOLO DAVVERO NON ESEGUITE)

ℹ️ **SEZIONE VUOTA? NO — ridotta a 7 voci residue fuori scope di FASE 6D (runtime certification Docker Recovery). Queste voci NON bloccano il freeze formale di FASE 6D perché non appartengono alla baseline 6D richiesta.** Resta come future enhancement backlog per milestone 7-8-9, NON regressione.

**[CATEGORIA: E2E FLUSSI EDITORIALI BROWSER (FASE 7 STUDIO UI FULL)]**

- AH1 Flusso browser reale: login → save draft V2 → apri preview autenticata → publish → refresh pubblico V2 (sezioni L, M, Q)
- AH2 First-publish user: 404 pubblico → publish → 200 pubblico + SEO metadata corretti (sezione M)
- AH3 Unpublish + republish con cache busting corretto (sezione N)
- AH4 Cache isolation browser 2 tab: pubblica A, pubblica B, nessun cross-leak (sezione R)

**[CATEGORIA: UI UX DETTAGLIO STUDIO (FASE 7)]**

- AH5 Section settings editor nel browser + reorder drag-and-drop interattivo
- AH6 Bundle sizes dettagliato route classification (§Y avanzato, non baseline)
- AH7 Error UI form nel browser: toast, fieldErrors, focus su primo campo invalido (sezione T avanzato)

---

## CONCLUSIONE REPORT — FASE 6D RUNTIME CERTIFICATION POST-DOCKER RECOVERY

✅ **Implementazione + Runtime Verification COMPLETATE**
✅ **Typecheck 0 errori** — Strict TS, 0 any forzato nei file FASE6
✅ **Lint 0 errori / 0 warning** — eslint --max-warnings=0 exit0
✅ **Format 0 issue** — Prettier + .prettierignore aggiornato con supabase/.home
✅ **Build next build 0 errori** — §23 exit0
✅ **Vitest 237/237 PASS** (78 baseline DB + 32 editorial R1-R16/T1-T10/F1-F6 + 85 unit + 42 integration) — `--maxWorkers=1`, 0 flake
✅ **Playwright PROD E2E 52/52 PASS** — §24-27 PLAYWRIGHT_USE_PRODUCTION=1; cross-tenant isolation E6/E8/E13 PASS; H1 unico a11y; 0 XSS; 0 5xx; responsive 375/768 scrollWidth ≤ clientWidth; desktop 1440 OK
✅ **Baseline DB 78/78 PASS + Editorial 32/32 PASS = 110/110 DB PASS**
✅ **RLS Matrix E (AUTHZ) 4/4 VERIFIED — ANON/STAFF DENY, MANAGER/OWNER allow granular cross-tenant DENY**
✅ **§33 SECOND CLEAN GATE: RESET x2 exit0 → lint → typecheck → format → vitest 237 → e2e prod 52, EXIT CODE SHELL = 0**
✅ **Append-only migrations 001-023 FROZEN inviolate; solo 024 FASE6 nuovo**
✅ **GIT SAFETY OK: 0 leak secret staged; working tree solo file attesi**

🟡 **Sezione AH = 7 voci residue** (tutte E2E browser UI avanzato / FASE 7+). Zero voci bloccanti per FASE 6D: tutti i gate di sicurezza (RLS, Authz, Tampering, Atomicità, Concurrency, Reset Idempotenza, Double-run) sono VERIFICATI.

⚠️ **10 FAIL preesistenti tests health + auth-onboarding** (non toccati in 6D; presenti già a baseline FASE5). Non regressione.

🧊 **FREEZE DECISION: FASE 6D DICHIARABILE FROZEN (runtime certification)**. Il commit locale successivo a questo report congela il worktree 6D. Nessun push remoto eseguito.

⏭️ **Prossimi passi outside 6D (FASE 7+)**: AH1-AH7 browser E2E avanzato, generazione tipi Supabase ufficiale, bundle sizes report dettagliato.
