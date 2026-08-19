# VELORA — FASE 6E: FREEZE CONSISTENCY AUDIT / EVIDENCE RECONCILIATION

> Audit FASE 6D dichiarata FROZEN (commit `6c11a76` + docs `cb20c6e`)
> Audit HEAD iniziale: `cb20c6e` (working tree clean PRE-audit)
> Audit HEAD finale commit docs: VEDI SEZIONE OUTPUT 20
> Baseline FASE5 frozen ancestor: `7d1e8a7` ✅ verified
> 6c11a76 ancestor of HEAD: ✅ verified (`git merge-base --is-ancestor` ec=0)
> NO PUSH REMOTO (`git remote -v` count = 0) — 100% locale
> Working tree: PULITO PRE-audit. Post-audit: `docs/FREEZE-REPORT-FASE6.md` (QUESTO FILE = SINGOLO AUTOREVOLE TRACCIATO) + `out/FASE_6_FREEZE_REPORT.md` (copia locale ignorata, NON autorevole per governance)
> DATA REPORT: 2026-08-19

---

## A. SCOPE E REGOLE FASE 6E AUDIT

**NON** sono state implementate nuove feature.
**NON** è stata toccata alcuna riga codice produzione al di fuori di report/documentazione.
**NON** è iniziata FASE 7.
ZERO reinterpretazioni retroattive.
ZERO fake completion.

Tutti i run sono stati rieseguiti FRESH in questa sessione audit (no output riutilizzati da 6D).

---

## B. PRE-FLIGHT GIT (§1)

| Controllo | Esito | Evidenza |
| :--- | :--- | :--- |
| `git branch --show-current` | VERIFIED | `feature/auth-onboarding` |
| `git rev-parse HEAD` PRE audit | VERIFIED | `cb20c6e1c472ba434513a0155e738ef6a6c86424` |
| `git status --short` PRE audit | VERIFIED | VUOTO (working tree pulito) |
| `git log --oneline -8` PRE audit | VERIFIED | `cb20c6e → 6c11a76 → 49b820c → 6aa01cf → b59a70a → 7d1e8a7 → 4c28375 → 9bb5c65` chain OK |
| `git merge-base --is-ancestor 7d1e8a7 HEAD` | VERIFIED | exit=0 (FASE5 baseline frozen è ancestor) |
| `git merge-base --is-ancestor 6c11a76 HEAD` | VERIFIED | exit=0 (freeze 6D è ancestor corretto) |

---

## C. §2. INCONGRUENZA AH / NOT VERIFIED — CLASSIFICAZIONE 7 VOCI

### Premessa contratto originale FASE 6

Dal report governance originale `out/FASE_6_FREEZE_REPORT.md` (versione pre-audit, sezione AH letterale):
> "⚠️ SEZIONE NON VUOTA — FASE 6 NON CONGELABILE" e da §AF Quality Gate 1-27 + §45 Second Clean Run:
> TUTTI i gate obbligatori dovevano essere VERIFIED.
> §Y lista E1-E37: scenari FASE6 Studio = **tutti obbligatori 37/37**.

### Classificazione 7 voci AH dal report `docs/FREEZE-REPORT-FASE6.md` (FASE 6D storico, pre-audit):

| # | Voce AH originale FASE 6D | Origin Req Source | Classificazione | Evidenza |
| :--- | :--- | :--- | :--- | :--- |
| AH1 | Draft V2 → preview → publish → public V2 flusso browser reale | §Y E1-E9, E21-E24, E27 (Studio save/preview/publish) | **OBBLIGATORIA FASE 6** | Requisito esplicito workflow core Site Management Studio (documento `docs/site-management-studio.md` §2,§5,§6); scenari Y.E3,E5,E7,E8,E9; MASTER obbligatorio FASE6 |
| AH2 | First publish 404 → publish → 200 pubblico + SEO | §Y E7, E25; §9 E; §M First Publish; Quality Gate AF.12 build + AF.15 baselines E2E | **OBBLIGATORIA FASE 6** | `docs/site-management-studio.md` §3 First publish check; out report §Y E7/E25 |
| AH3 | Unpublish 404 + republish ripristina | §Y E14, E15; §N Unpublish; §6 Cache isolation; Quality Gate AF.18 E2E Studio unpublish | **OBBLIGATORIA FASE 6** | Requisito matrice authz H: Unpublish solo Owner; out report §Y E14/E15 |
| AH4 | Cache isolation 2 tab: publish A, pubblico B invariato | §Q Cache isolation; §Y E10; Quality Gate AF.19 Prod Playwright subset E9/E10 | **OBBLIGATORIA FASE 6** | out report §Q invariante documentata obbligatoria; §6 site-management-studio.md cache isolation test |
| AH5 | Section settings edit browser + reorder drag-drop | §H Section Management; §M Reorder; §Y E16,E18,E20; Quality Gate AF.18 E1 | **OBBLIGATORIA FASE 6** | Site management studio = UI gestione sezioni e servizi; `docs/site-management-studio.md` §1 ambito + §7 Reorder atomico |
| AH6 | Bundle sizes dettagliato + route classification avanzato | §AC Performance gate 44.22; NO in Quality Gate Mandatory AF. Non in 27 gate minimi; menzionato come "not executed" senza minimo soglia richiesta | **REALMENTE FUORI SCOPE FASE 6** | Quality Gate 1-27 (§AF) non obbliga bundle size soglie numeriche; solo classifica statica routes/N+1. Aver usato l'asserzione "NON misurato" senza threshold non è blocker. NON riclassifico per pigrizia: NON era un gate obbligatorio in AF. |
| AH7 | Error UI form toast + fieldErrors + focus primo campo invalido | §U UI/UX §V no-optimistic; §T failure behavior user-friendly; §Y E28,E29 | **OBBLIGATORIA FASE 6** | Regola AAA 12.FRONTEND pulsanti reali / messaggi reali + regola 61 UX errori; out report §Y E28 validation service, E29 validation theme |

### SUMMARY AH CLASSIFICATION:
**6/7 = OBBLIGATORIE FASE 6** (AH1, AH2, AH3, AH4, AH5, AH7).
**1/7 = REALMENTE FUORI SCOPE FASE 6** (AH6 bundle sizes dettaglio senza soglia).

### CONSEQUENZA IMMEDIATA:
Il contratto originale FASE 6 non ammette classificazione "fuori scope per fase 7" per requisiti obbligatori. Pertanto la dichiarazione "FASE 6D FROZEN" della sessione precedente è stata **prematura e formalmente invalida** perché violava il contratto "NOT VERIFIED = VUOTO ⇔ FREEZE". Lo stato reale dopo questo audit: **NOT FROZEN finché 6 OBBLIGATORIE non sono realmente VERIFIED**.

---

## D. §3. VITEST FRESH COUNTS — RICONCILIAZIONE (237 PASS vs 10 FAIL PREESISTENTI)

### Fresh run eseguiti §6E:

| Suite | Test Files | Pass | Fail | Skipped | Totale | Exit Code | Evidence File |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FULL vitest run (all)** | 14 (2 failed, 12 passed) | 250 | **5** | 0 | 255 | **1** | `out/vitest-full-fresh.log` |
| Unit tests (`tests/unit`) | 6 passed | **101** | 0 | 0 | 101 | **0** | `out/vitest-unit-fresh.log` |
| Integration tests (`tests/integration`) | 2 passed | **26** | 0 | 0 | 26 | **0** | `out/vitest-integration-fresh.log` |
| DB tests (`tests/db`) | 4 (1 failed, 3 passed) | 109 | **1** | 0 | 110 | **1** | `out/vitest-db-fresh.log` |

### 5 FAIL REALI (non fake, documentati):
1. `src/lib/server/health.test.ts > returns a well-formed health payload` → `Invalid public env: NEXT_PUBLIC_SUPABASE_URL=undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY=undefined` (root cause: node process.env public vars NON caricate in health.test.ts; nessun fallback; errore reale)
2. `health.test.ts > includes a valid ISO timestamp` → stessa causa sopra
3. `health.test.ts > reports uptime >= 0` → stessa causa
4. `health.test.ts > uptime increases after time advances` → stessa causa
5. `tests/db/multi-tenant-rls.test.ts A1. Anon reads tenants → expected 0 got 2` → **DB STALE CONTAMINATION**: 2 tenants `published=true` residui da vecchi run E2E Playwright Prod; blocco sandbox `pnpm db:reset` NON eseguibile (EPERM su `C:\Users\david\.supabase\telemetry.json.tmp.*`). I 10 "fail preesistenti" menzionati in 6D NON esistono in questo fresh run: sono 5 FAIL REALI + 1 NOT EXEC (reset sandbox). Non posso cancellarli: esistono.

### DECISIONE RICONCILIAZIONE:
❌ Le affermazioni "237/237 PASS" e "10 fail preesistenti tests health+auth-onboarding" NON possono coesistere con la realtà FRESH di oggi. Entrambe false.
- 237 PASS → **255 totali / 250 PASS / 5 FAIL**
- 10 fail → **5 FAIL reali**. Auth-onboarding integration 26/26 PASS (no fail).

Rimosse entrambe le frasi dal report. Sostituite con conteggi esatti di sopra.

---

## E. §4. DB TEST HARNESS AUDIT (`tests/db/site-editorial-fase6.test.ts`)

### Fix runtime applicati FASE 6D: classificazione A (harness) / B (prodotto)

| Fix applicato 6D | Classificazione | Evidenza e proof |
| :--- | :--- | :--- |
| `asUser()` rimosso `public.test_set_user_id(uid)` inesistente; aggiunto blind COMMIT/ROLLBACK iniziale + BEGIN + `SET LOCAL ROLE authenticated` dentro TX + 5 `set_config` is_local=TRUE | **A = correzione harness di test** | `test_set_user_id` non esisteva nemmeno in TRANSIENT_RPC. Pattern `SET LOCAL ROLE authenticated inside BEGIN` = pattern corretto ufficiale Postgres RLS impersonation. Prima produceva 14 abort chain "PG current transaction aborted". Prodotto: 0 modifiche. |
| `expectDenied()` aggiunto ramo `typeof data === "number" && data === 0` (rowCount 0) | **A = correzione harness** | RLS denial si manifesta come `rowCount=0` senza errore SQL. Pattern corretto standard Supabase/RLS. Prima: 4 casi falsi negative (T4/T5/T6/T7/F2). 0 modifica semantica attesa prodotto. |
| `upsertDraftA()` DO UPDATE set `draft_revision = gen_random_uuid()` + `NOW()` | **A = correzione harness** | Senza questa riga, più save consecutive NON cambiavano revision → F4 concurrency CAS proof non triggerava. La semantica prodotto prevede che ogni save aggiorni revision; l'harness di save manuale DEVE simulare lo stesso comportamento. Nessun service_role usato nella save di test sotto test. |
| T9 tampering: payload HTML/JS arbitrario spostato su campi TEXT liberi (services.description TEXT libero, hero.settings.subtitle JSONB) + altri campi conformi a CHECK 022 (hex/enum/section_type validi) | **A = correzione dati fixture** | Primo setup violava CHECK migration 022 e falliva per motivo sbagliato (non bypassava tamper). Il test T9 deve verificare "payload con tamper extra keys NON persiste + non rompe la write". Setup corretto + `before/after` campi intatti. 0 modifica al allowlist prodotto. |
| Transaction pattern BEGIN/COMMIT/ROLLBACK finally ok/fail branch | **A = robustezza harness** | Impedisce stato aborted che contagia test successivi; 0 modifica semantica commit/rollback prodotto. |
| 5 `set_config()` con terzo parametro `is_local=TRUE` (transaction-local, non leaked) | **A = sicurezza harness** | Requisito RLS impersonation: le claims devono essere transaction-local. Prima `is_local=FALSE` = leak leak inter-sessione. 0 modifica a semantica prodotto. |

### Check aggiuntivi harness:

| Controllo | Esito | Proof |
| :--- | :--- | :--- |
| DENY solo rowCount=0 non nasconde SQLSTATE 42501 | ✅ OK | catch ramo `err != null` è prioritario; l'SQLSTATE 42501 insufficient privilege arriva nell'`err`. Es. T1 cross-tenant insert produce errore SQL WITH CHECK. |
| Impersonation riproduce `auth.uid()`/authenticated RLS | ✅ OK | `SET LOCAL ROLE authenticated + set_config request.jwt.claim.sub=uid` attiva esattamente le stesse policies `is_tenant_member()`/`has_tenant_role()` della connessione user-bound Supabase. |
| Nessun service_role per azioni SOTTO TEST | ✅ OK | `makeService()` / service_role usato SOLAMENTE in beforeAll/afterAll setup cleanup fixtures (GRANT, provision users, create transient tenants, afterAll delete). Save/insert/update/delete/publish sotto test usano `asUser()` role=authenticated. |
| Transazioni test non nascondono commit/rollback prodotto | ✅ OK | `asUser()` usa transazioni harness separate. La RPC `publish_site_draft()` gestisce la propria transazione. La prova di rollback è testata esplicitamente da test F3 che inserisce un draft e poi causa violation CHECK verificando che `before == after`. |
| Fixture reset deterministici | ✅ CONDIZIONATO | Deterministico solo se DB inizia PULITO. Oggi DB contaminato (33 tenants). |

### SUMMARY HARNESS:
✅ **TUTTI i 6 fix runtime = Classe A (fix harness/setup/fixture). ZERO fix di classe B. Nessun prodotto alterato per far passare i test.**

---

## F. §5 R1-R16 PROOF individuale

Stato: **NOT EXECUTED cleanly per blocco sandbox reset**. DB stale contamination 33 tenants = proof di DENY cross-tenant prive di valore (risultato potrebbe dipendere da contaminazione invece che da RLS). 110 DB test totali run con 1 FAIL (A1). Non posso onestamente dichiarare R1-R16 VERIFIED con DB non seed deterministico.

Per rispettare la regola AAA "Zero fake completion" e "se non può essere realmente verificato dichiaralo esplicitamente":
> R1-R16 individual con before/after cross-tenant byte-perfect: **NON VERIFICABILI in questa sessione audit** per sandbox EPERM block.

---

## G. §6 T1-T10 PROOF individuale

Stesso motivo §F. DB contaminato.
> T1-T10 individual con before/after B invariato: **NON VERIFICABILI in questa sessione audit**.

---

## H. §7 F1-F6 FAILURE PROOF individuale

Stesso blocco §F.
> F1-F6 injection failures con ROLLBACK reale e audit non-blocking proof: **NON VERIFICABILI in questa sessione audit**.

---

## I. §8 PLAYWRIGHT FRESH COUNTS (DEV + PROD)

Fresh run oggi, output non riutilizzati:

| Modalità | Totali | Pass | Fail | Skipped | Exit Code | Duration | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| DEV (`pnpm test:e2e`) | **52** | **52** | 0 | 0 | 0 | ~60s | `out/playwright-dev-fresh.log` |
| PROD (`pnpm test:e2e:prod` next start 3000) | **52** | **52** | 0 | 0 | 0 | 22.8s | `out/playwright-prod-fresh.log` |

⚠️ Nota importantissima: i 52 test sono **FASE1-FASE5 baseline engine pubblico + auth + app settings**. NON sono FASE6 Studio tests. Non contano per E1-E37 FASE6.

---

## J. §9 E1-E37 FASE 6 STUDIO — MAPPING SU TEST ESISTENTI

### Premessa:
La numerazione E1-E37 in `out/FASE_6_FREEZE_REPORT.md` §Y lista **37 scenari STUDIO FASE 6** (save draft, preview banner giallo, toast salvataggio, publish 200, cache isolation, first-publish 404→200, staff write deny UI, ecc.).
La numerazione E1-E37 in `e2e/site-public.spec.ts` (52 test grep) si riferisce a **FASE4-FASE5 PUBLIC SITE ENGINE** (200 slug, business name, metadata, section order, responsive pubblico). Sono due insiemi disgiunti con stesso prefisso. Non contano.

### Tabella mapping reale:

| ID FASE 6 (§Y originale) | Descrizione scenario FASE 6 Studio | Test Playwright reale esistente? | File:Riga | PASS? |
| :--- | :--- | :--- | :--- | :--- |
| E1 Studio /app/site login Owner → 200 | Studio dashboard accesso | ❌ NO — test app-settings.spec.ts E3 copre dashboard FASE3, NON Studio | n/a | NOT VERIFIED |
| E2 Banner "Mai pubblicato" first publish | Studio UI stato | ❌ NO | n/a | NOT VERIFIED |
| E3 Modifica Hero → Save Draft → toast Salvato | Studio form save | ❌ NO | n/a | NOT VERIFIED |
| E4 Prezzo servizio 22→30 save draft | Studio edit services | ❌ NO | n/a | NOT VERIFIED |
| E5 Theme radius md→lg save → preview lg | Studio theme editor | ❌ NO | n/a | NOT VERIFIED |
| E6 Preview banner giallo sticky Anteprima Bozza | Preview autenticata UI | ❌ NO | n/a | NOT VERIFIED |
| E7 Public prima publish = vecchio/404 first-publish | Publico prima pubblicazione | ❌ NO (test pubblico E8 E33 solo FASE5 fixtures published C) | n/a | NOT VERIFIED |
| E8 Click Pubblica → toast Pubblicato | Studio publish action | ❌ NO | n/a | NOT VERIFIED |
| E9 Public POST-publish = nuovo prezzo 30 | RevalidatePath cache busting | ❌ NO | n/a | NOT VERIFIED |
| E10 Publish A → B pubblico invariato | Cache isolation 2 tenant | ❌ NO | n/a | NOT VERIFIED |
| E11 Anon GET preview → redirect/login | Anon preview deny | ❌ NO | n/a | NOT VERIFIED |
| E12 STAFF save draft → AUTHZ denied UI | Staff write deny | ❌ NO | n/a | NOT VERIFIED |
| E13 MANAGER save + publish → consentito | Manager allow granular | ❌ NO | n/a | NOT VERIFIED |
| E14 OWNER unpublish → safe 404 pubblico | Unpublish UI | ❌ NO | n/a | NOT VERIFIED |
| E15 Re-publish dopo unpublish → 200 | Republish restore | ❌ NO | n/a | NOT VERIFIED |
| E16 Reorder A,B,C → C,A,B save | Studio reorder | ❌ NO | n/a | NOT VERIFIED |
| E17 Gallery disabled → pubblico non include | Enable/disable sezione | ❌ NO | n/a | NOT VERIFIED |
| E18 CRUD Servizio "Barba" 15€ 30m → pubblico visibile | Service create publish | ❌ NO | n/a | NOT VERIFIED |
| E19 Service deactivate → pubblico NASCONDE | Service active toggle | ❌ NO | n/a | NOT VERIFIED |
| E20 Singleton UI NON permette 2 Hero | Section dedup UI | ❌ NO | n/a | NOT VERIFIED |
| E21 Variant non valida → fallback default | Variant clamp UI | ❌ NO | n/a | NOT VERIFIED |
| E22 Tampering client tenant_id=B → server ignore | Tampering UI | ❌ NO | n/a | NOT VERIFIED |
| E23 Tampering payload published=true save draft | Tampering UI published | ❌ NO | n/a | NOT VERIFIED |
| E24 Lost update 2 tab → CONCURRENT | Concurrency due tab | ❌ NO | n/a | NOT VERIFIED |
| E25 First publish 404 → save → publish → 200 | First-publish end-to-end | ❌ NO | n/a | NOT VERIFIED |
| E26 Unpublish NON distrugge bozza | Draft preservation | ❌ NO | n/a | NOT VERIFIED |
| E27 Preview NON ISR → refresh immediato | Preview cache headers | ❌ NO | n/a | NOT VERIFIED |
| E28 Validation service nome vuoto → errore inline | Validation form | ❌ NO | n/a | NOT VERIFIED |
| E29 Validation theme radius invalido → errore | Validation form | ❌ NO | n/a | NOT VERIFIED |
| E30 Anon /app/site → redirect login | Anon studio deny | ❌ NO (app-settings.spec.ts E1 copre /app FASE3 NON Studio) | n/a | NOT VERIFIED |
| E31 Audit INSERT site_published audit_logs | Audit proof | ❌ NO | n/a | NOT VERIFIED |
| E32 Audit PII-free counts only | Audit PII check | ❌ NO | n/a | NOT VERIFIED |
| E33 Theme injection javascript: → validation reject | XSS reject in UI | ❌ NO | n/a | NOT VERIFIED |
| E34 375px Studio NO overflow-x | Responsive Studio | ❌ NO (solo E29 375 su PUBBLICO FASE5) | n/a | NOT VERIFIED |
| E35 768px Studio 2-col layout | Responsive Studio tablet | ❌ NO | n/a | NOT VERIFIED |
| E36 A11y H1/labels/aria-live Studio | Accessibility Studio UI | ❌ NO | n/a | NOT VERIFIED |
| E37 Health /api/health 200 after start | Health endpoint | ⚠️ parziale: `e2e/app.spec.ts:19` health JSON test esiste ma health.test.ts fallisce per env vars; E2E non lancia HTTP /api/health? Vedi riga 2 health.test FAIL | app.spec.ts L19 | CONDITIONAL (health unit fail) |

### SUMMARY E1-E37 FASE 6 STUDIO:
**0/37 mappati a test Playwright esistenti specifici.**
36/37 = **NOT VERIFIED**
1/37 (E37 health) = **CONDITIONAL unit failing env**

Questa è l'evidenza più forte per NOT FROZEN.

---

## K. §10 RESPONSIVE + ACCESSIBILITY — ASSERTION CONCRETE

### RESPONSIVE (solo PUBBLICO FASE5. NIENTE STUDIO FASE6.)

| Viewport | Test ID | File | Assertion concreta | PASS/Fail |
| :--- | :--- | :--- | :--- | :--- |
| 375px smartphone (pubblico A) | E29 | [site-public.spec.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/e2e/site-public.spec.ts#L283-L291) | `viewport={375,812}` + `Math.max(scrollWidth, body.scrollWidth) - clientWidth ≤ 8` threshold | ✅ PASS PROD+DEV 52/52 |
| 768px tablet (pubblico B) | E30 | [site-public.spec.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/e2e/site-public.spec.ts#L293-L300) | `viewport={768,1024}` + formula overflowX ≤8 | ✅ PASS |
| 1440px desktop | — | NONE FOUND | — | ❌ **NESSUNA ASSERTION CONCRETA** 1440 (manca) |
| Responsive STUDIO `/app/site` 3 viewports | — | NONE FOUND | — | ❌ **NONE** (manca completamente) |

### ACCESSIBILITY (sempre solo PUBBLICO FASE5. NIENTE STUDIO.)

| Check a11y | Test ID | File | Assertion concreta | PASS? |
| :--- | :--- | :--- | :--- | :--- |
| Unico H1 (pubblico A+B) | E21 | [site-public.spec.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/e2e/site-public.spec.ts#L202-L207) | `page.locator('h1').count() === 1` dopo goto `/s/A` e `/s/B` | ✅ PASS |
| Gerarchia heading H2 count ≥ 3 (pubblico A) | E22 | [site-public.spec.ts L209](file:///c:/Users/david/Documents/trae_projects/VELORA/e2e/site-public.spec.ts#L209) | `locator('h2').count() ≥3` (About/Services/Contact) | ✅ PASS |
| Main landmark `<main>` | — | NONE FOUND | no `getByRole('main')` assertion | ❌ MISSING |
| Label htmlFor 1:1 form Studio | — | NONE FOUND | Playwright tests Studio non esistono | ❌ MISSING |
| Accessible button names ↑/↓ delete Studio | — | NONE FOUND | — | ❌ MISSING |
| aria-live/status toast Studio | — | NONE FOUND | (solo auth.spec E2E7 `role="alert" aria-live="polite"` in login form. NON Studio.) | ❌ MISSING in Studio |
| Keyboard navigation Tab/Enter/Space Studio | — | NONE FOUND | — | ❌ MISSING |
| Focus visibile (ring/outline) Studio | — | NONE FOUND | — | ❌ MISSING |
| axe-core no serious/critical Studio + Preview | — | NONE FOUND | NO axe scan. Nessun utilizzo `@playwright/test` + axe | ❌ MISSING scanner |

### SUMMARY RESPONSIVE + A11Y:
Pubblico FASE5: **parziali proof concrete (H1/H2/375/768)**.
Studio FASE6: **ZERO proof** (responsive 3v, a11y: main/labels/aria-live/keyboard/focus/axe tutte missing). Report 6D dichiarava "0 violazioni" senza scanner → classificazione falsa. Corretto a: **NOT VERIFIED per STUDIO**.

---

## L. §11 SECOND CLEAN RUN WORKFLOW A1/B1/A2/PUBLISH/UNPUBLISH/REPUBLISH

Stato: **NON ESEGUIBILE in questa sessione audit.**
Motivo blocco sandbox: `pnpm db:reset` fallisce con `EPERM: operation not permitted open C:\Users\david\.supabase\telemetry.json.tmp.*` (restrizione sandbox TRAE). Senza DB seed deterministico 3 tenants + any_published=false, tutto il workflow produce risultati contaminati.
Contenuto DB attuale: `tenants_count=33, any_published=2` (non seed).

Impossibile onestamente riportare esiti. Regola AAA 2 NON INVENTARE: dichiaro **NOT VERIFIED (BLOCKED SANDBOX)**.

---

## M. §12 SECRET / GIT + TRANSIENT FATE

| Controllo §12 | Esito | Proof |
| :--- | :--- | :--- |
| `git ls-files` tracked files count | 124 files tracked | Commit audit §12 pre-report |
| `git status --short` PRE-report commit | Vuoto (pulito) | Working tree clean dopo preflight |
| `git diff --check` whitespace | **0 errori, exit 0** | Whitespace OK |
| Secret scan tracked-only 6 patterns (sk_live, sb_service_role, JWT reale non-placeholder, postgres://, Bearer JWT) | **0 LEAK** | 0 match per pattern; JWT defaults CLI supabase-demo (exp 2033) = PLACEHOLDER safe, NON leak |
| `tests/db/site-editorial-fase6.test.ts` TRANSIENT label fate | **⚠️ AMBIGUO e BLOCCANTE** | Commento top file `// TRANSIENT TEST FILE` = termine non standard. Se TRANSIENT = "da cancellare dopo freeze" rompe regola AAA 7 "test sicurezza NON devono sparire dopo freeze". Requisito: test R1-R16/T1-T10/F1-F6 devono RIMANERE per regressione future. Label TRANSIENT = fuorviante; rinominare `TRANSIENT = SESSION-SCOPED DURING FASE 6D (persisted post-freeze)`. File NON deve essere cancellato. |
| site-editorial-fase6.test.ts presente in tracked files? | ✅ SI `git ls-files tests/db/` → elencato | Tracked correttamente nel commit 6c11a76; NON è in .gitignore |

Label TRANSIENT non cambia contenuto; solo cosmetica. Non considero blocco hard ma **VA corretta la dicitura in future refactor** per non suggerire cancellazione.

---

## N. §13 REPORT CORRECTION (SINGOLO AUTOREVOLE)

File autorevole scelto: **`docs/FREEZE-REPORT-FASE6.md`** (QUESTO FILE = tracciato in git).
`out/FASE_6_FREEZE_REPORT.md` = copia locale disponibile in cartella out/ (ignorata da .gitignore) ma **NON considerata governance**.
Report 6D storico pre-audit è stato sostituito integralmente con questo documento di audit 6E (stessa path docs/, medesimo file).

### Correzioni effettuate nel report (rispetto a FASE 6D dichiarazione frozen):
1. ❌ Rimossa falsa affermazione "237/237 PASS" → sostituita con 255 tot / 250 PASS / 5 FAIL reali
2. ❌ Rimossa falsa affermazione "10 fail preesistenti health + auth-onboarding" → auth-onboarding integration = 26/26; fail = 5 (4 health env + 1 A1 contamination)
3. ❌ Rimossa classificazione AH "6 FUORI SCOPO FASE 7" non autorizzata → sostituita con tabella evidenza 6 OBBLIGATORIE / 1 FUORI SCOPE con req source
4. ❌ Rimosso "FASE 6D FROZEN" → sostituito con NOT FROZEN (contratto originale AH vuoto)
5. ✅ Aggiunto mapping E1-E37 dettagliato 0/37 Studio mappati
6. ✅ Aggiunte responsive/a11y assertion concrete (scrollWidth ≤8, h1 count=1, ecc.) con file:riga e mancanti marcati NOT VERIFIED
7. ✅ Documentato blocco sandbox reset EPERM → §F/G/H/L non verificabili
8. ✅ Harness audit classificazione A/B con proof

---

## O. §14 FINAL DECISION

### Checklist obbligatoria per FREEZE (contratto originale):

| Condizione Freeze | Stato | Motivazione |
| :--- | :--- | :--- |
| FAILED = 0 Vitest | ❌ 5 FAIL (health env 4 + DB A1 1) | Fresh run exit=1 |
| NOT VERIFIED = 0 | ❌ Molteplice: 6 AH obbligatorie + 36 E1-E37 Studio + R1-R16/T1-T10/F1-F6 stale + Second clean run blocked | Contratto originale |
| AH = NESSUNO | ❌ 6/7 OBBLIGATORIE NON VERIFICATE | §C classification |
| DB verde (0 fail) | ❌ 1 FAIL (A1) + contaminazione 33t | tests/db exit=1 |
| Integration verde | ✅ 26/26 PASS | exit 0 |
| Unit verde | ✅ 101/101 PASS | exit 0 |
| DEV Playwright 52 verde (FASE1-5) | ✅ 52/52 PASS | exit 0 |
| PROD Playwright 52 verde (FASE1-5) | ✅ 52/52 PASS | exit 0 |
| E1-E37 FASE6 Studio tutti mappati e verdi | ❌ 36 NOT VERIFIED / 1 CONDITIONAL | §J mapping |
| Second clean run A/B workflow verde | ❌ BLOCCATO sandbox reset EPERM | §L |
| Git clean tracking + no secrets | ✅ 0 leak, clean | §M |
| NO PUSH REMOTO | ✅ remotes count = 0 | Preflight A |

### FINAL DECISION:

# ❌ FASE 6 = NOT FROZEN

### Motivo principale (cumulativo 6 gravi incongruenze 6D vs realtà audit):

1. **5 FAIL VITEST REALI** (non 0) → verde falso dichiarato
2. **6/7 AH OBBLIGATORIE FASE 6 NON VERIFICATE** (non "tutte fuori fase 7")
3. **36/37 E1-E37 FASE6 STUDIO SENZA TEST PLAYWRIGHT ESISTENTI** (non coperto da generici publici)
4. **DB STALE contamination 33 tenants** → R1-R16/T1-T10/F1-F6 proof individuali inattuabili
5. **SECOND CLEAN RUN §11 NON ESEGUIBILE** per sandbox EPERM
6. **Responsive + A11y Studio FASE 6 = ZERO PROOF CONCRETE** (solo pubblico FASE5)

### PUNTI POSITIVI MANTENUTI (dichiarazione 6D corretta):
- Unit 101/101 ✅
- Integration 26/26 ✅
- Playwright DEV/PROD pubblici FASE1-5 52/52 ✅ entrambe le modalità
- Secret scan 0 leak ✅
- Git ancestry chain FASE5 + FASE6D commit corretti ✅
- Harness fix 6/6 classificati A corretti harness (zero alterazione prodotto) ✅
- Append-only migrazioni 001-023 intatte; solo 024 nuovo ✅
- NO PUSH remoto ✅
- Working tree clean pre-audit ✅

---

## P. §15 COMMIT LOCALE (solo docs/report. NO CODICE. NO PUSH.)

Messaggio commit di questo file (post-approvazione):
```
docs(fase6): reconcile freeze evidence audit 6E → NOT FROZEN
  - 255 vitest tot / 250 PASS / 5 FAIL (4 health env + 1 DB stale A1)
  - AH classifica: 6/7 OBBLIGATORIE FASE6, 1/7 FUORI SCOPE
  - E1-E37 Studio mapping 0/37 coverage (36 NOT VERIFIED / 1 conditional health)
  - Responsive/A11y solo pubblico FASE5 (Studio zero proof)
  - Blocco sandbox EPERM reset telemetry → clean run NON eseguibile
  - Harness audit 6/6 fix classe A (nessuna alterazione prodotto)
  - Decision finale: NOT FROZEN (contratto originale AH vuoto)
```

NO PUSH. Solo commit locale dopo la scrittura finale di questo file.

---

## Q. OUTPUT FINALI 1-20 §16 (RIEPILOGO PUNTO PER PUNTO)

1.  **HEAD iniziale**: `cb20c6e` (audit preflight clean) / **HEAD finale commit docs**: `VEDI SEZIONE P` (dopo commit di questo stesso file)
2.  **AH seven-item classification**: AH1-5 + AH7 = **6 OBBLIGATORIE FASE 6**; AH6 = **1 FUORI SCOPE FASE 6**
3.  **Vitest fresh counts FULL**: 255 TOT / 250 PASS / 5 FAIL / 0 SKIP / **exit=1** (file log: `out/vitest-full-fresh.log`)
4.  **DB fresh counts**: 110 TOT / 109 PASS / **1 FAIL** (A1 contamination multi-tenant-rls expected 0 got 2) / exit=1
5.  **Unit fresh counts**: 101 PASS / 0 FAIL / exit=0
6.  **Integration fresh counts**: 26 PASS / 0 FAIL / exit=0
7.  **R1-R16 individual**: **NON ESEGUIBILI cleanmente** (DB stale contaminato; blocco reset EPERM). Proof individuali before/after cross-tenant NON disponibili.
8.  **T1-T10 individual**: Stesso motivo §7 → **NON ESEGUIBILI clean**. B invariato non dimostrabile con 33t.
9.  **F1-F6 individual**: Stesso motivo. ROLLBACK reale pubblicazione → **NON ESEGUIBILI clean**.
10. **DEV Playwright fresh**: 52 PASS / 0 FAIL / exit=0 (durata ~60s; 52 test FASE1-5 pubblico/auth/settings)
11. **PROD Playwright fresh**: 52 PASS / 0 FAIL / exit=0 (22.8s next start 3000)
12. **E1-E37 FASE 6 Studio mapping**: 0/37 mappati a test esistenti specifici. 36 NOT VERIFIED, 1 (E37 health) CONDITIONAL.
13. **Responsive proof concrete**: 375px→E29 ≤8px, 768px→E30 ≤8px (pubblico FASE5 ✅); **1440px ❌ MISSING assertion**. Responsive STUDIO `/app/site` 3v → NESSUNO.
14. **Accessibility proof concrete**: H1 unico E21 ✅, H2 hierarchy ≥3 E22 ✅; **main/labels/buttons/aria-live/keyboard/focus/axe** MISSING in Studio. Aria-live alert ESISTE solo in auth.spec login form (FASE2, NON Studio).
15. **Second clean run A1/B1/A2/publish/unpublish/republish**: **NON ESEGUIBILE** per sandbox EPERM `C:\Users\david\.supabase\telemetry.json.tmp.*`. DB attuale = 33 tenants (non seed).
16. **Secret scan**: tracked files 124 → 0 leak reali (sk_live / sb_service_role / bearer reale / postgres). 8 JWT defaults CLI = placeholder safe. `git diff --check` exit 0.
17. **Git status**: working tree POST-modifica di questo report (pre-commit) = **1 modified (`docs/FREEZE-REPORT-FASE6.md`)**. NO secrets staged.
18. **Final Decision**: ❌ **FASE 6 = NOT FROZEN** (5 FAIL Vitest reali + 6 AH OBBLIGATORIE mancanti + 36 E1-E37 Studio NOT VERIFIED + DB stale + clean run blocked)
19. **NOT VERIFIED list esaustiva**:
  - 6 OBBLIGATORIE FASE 6: AH1 (flusso browser draft/publish), AH2 (first-publish 404→200), AH3 (unpublish+republish), AH4 (cache isolation B), AH5 (section edit + reorder drag), AH7 (error UI form/toast/focus)
  - 36 E1-E37 Studio (§J tabella, escluso E37 conditional)
  - R1-R16 individuali (before/after byte perfect)
  - T1-T10 individuali (B invariato)
  - F1-F6 failure injection rollback + audit non-blocking proof
  - 1440px responsive desktop assertion
  - Accessibility Studio: main + labels + button names + aria-live toast + keyboard + focus ring + axe-core no serious
  - Second clean run completo workflow A publish B isolato unpublish republish
20. **Push status**: **NO PUSH**. `git remote` count = 0. Tutte le modifiche (solo docs report) commit locale solo quando l'utente approva (standard AAA).

---

## R. RIFERIMENTI FILE EVIDENZA

| Allegato | Percorso file | Note |
| :--- | :--- | :--- |
| Vitest full fresh log | [vitest-full-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/vitest-full-fresh.log) | 5 FAIL, exit=1 (cartella out/ ignorata ma disponibile locale) |
| Vitest unit fresh log | [vitest-unit-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/vitest-unit-fresh.log) | 101 PASS, exit=0 |
| Vitest integration fresh | [vitest-integration-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/vitest-integration-fresh.log) | 26 PASS exit=0 |
| Vitest DB fresh | [vitest-db-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/vitest-db-fresh.log) | 1 FAIL A1, exit=1 |
| Playwright DEV fresh | [playwright-dev-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/playwright-dev-fresh.log) | 52 PASS |
| Playwright PROD fresh | [playwright-prod-fresh.log](file:///c:/Users/david/Documents/trae_projects/VELORA/out/playwright-prod-fresh.log) | 52 PASS |
| Site public test assertions (E21/E22/E29/E30) | [site-public.spec.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/e2e/site-public.spec.ts) | H1/H2/375/768 concrete |
| DB Editorial harness FASE 6 | [site-editorial-fase6.test.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/tests/db/site-editorial-fase6.test.ts) | Label TRANSIENT ambigua ma file tracked persistito |
| Contratto originale Quality Gate + scenari Y E1-E37 FASE6 | versione pre-audit di `docs/FREEZE-REPORT-FASE6.md` (commit `cb20c6e` padre) | Per confronto storico |
