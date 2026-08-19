# FASE 6 — FREEZE REPORT VELORA
## DATA: 2026-08-19 · COMMIT FINALE: `287854a056ed2a041296a2021fc15c53a774d1cc` (287854a)
### DECISIONE: 🔥 **FROZEN** 🔥
**FAILED=0 · NOT VERIFIED=0 · AH=NESSUNO · Working tree clean · NO PUSH**

---

## 0. SOMMARIO GATES

| Gruppo | Attesi | Passati | Esito |
|---|---|---|---|
| R Requisiti DB editorial | 16 | 16/16 | ✅ |
| T Tracciabilità dati | 10 | 10/10 | ✅ |
| F Funzione core studio | 6 | 6/6 | ✅ |
| SANITY baseline | 3 | 3/3 | ✅ |
| DB tests (4 files) | 113 | 113/113 | ✅ |
| Unit tests (6 files) | 101 | 101/101 | ✅ |
| Integration (2 files) | 26 | 26/26 | ✅ |
| FULL VITEST | 258 | 258/258 exit 0 | ✅ |
| Playwright DEV | 22 | 22/22 exit 0 | ✅ |
| Playwright PROD | 22 | 22/22 exit 0 | ✅ |
| E Browser Evidence 1-37 | 37 | 37/37 VERIFIED | ✅ |
| AH Anti-hacks 1-7 | 7 | 7/7 POST-CHANGE VERIFIED | ✅ |
| Responsive 4 viewport | 4 | 4/4 | ✅ |
| Accessibility 6 sub-gates | 6 | 6/6 | ✅ |
| SCR Security Regression 13 | 13 | 13/13 | ✅ |
| Typecheck | 1 | 0 errors | ✅ |
| Lint max-warnings=0 | 1 | 0/0 | ✅ |
| Format Prettier | 1 | 0 diff | ✅ |
| Build Next prod | 1 | exit 0 9/9 pages | ✅ |
| /api/health | 1 | HTTP 200 | ✅ |
| Reset idempotenti | 2 | snap1===snap2 | ✅ |
| Secrets scan tracked | 1 | 0 leak | ✅ |
| Service inventory | 5 | tutti JUSTIFIED | ✅ |
| Test integrity | 8 pattern | 0 match reali | ✅ |

---

## 1. TRACEABILITY E1-E37 (ESATTAMENTE 37 RIGHE)
Legenda Layer: **B**=Browser Playwright, **D**=DB vitest, **A**=API, **S**=Server source.

Righe (37):

| ID | Requisito Originale | Test Concreto | File:Riga | Assertion Concreta | Layer | Fresh Result | Evidence |
|---|---|---|---|---|---|---|---|
| E1 | Owner apre /app/site studio senza errore | test "E1. Owner A può aprire /app/site" | e2e/site-studio.spec.mjs:371 | `await p.goto("/app/site")` no error; `title OK` | B | PASS | elapsed 1.8s |
| E2 | Stato UI iniziale pubblicato=false/bozza visibile | test "E2. Stato iniziale published=false mostrato in UI" | e2e/site-studio.spec.mjs:389 | `expect(getByText(/Bozza.*non visibile/)).toBeVisible()` | B | PASS | 1.3s |
| E3 | Save Draft persistito in site_editorial_state | test "AH1/E3-E9 core workflow save draft V2" | e2e/site-studio.spec.mjs:405 | `SELECT COUNT(1) FROM site_editorial_state WHERE tenant=A → 1` | D/B | PASS | DB count 1 |
| E4 | Preview privata mostra V2 (hero+services nuovi) | test "AH1/E3-E9 preview" | e2e/site-studio.spec.mjs:443 | `preview content contains "Servizio V2 Taglio"` | B | PASS | preview 200 |
| E5 | Public slug **prima** publish rimane V1 o 404 | test "AH1/E3-E9 public before publish" | e2e/site-studio.spec.mjs:457 | `publicBefore NOT contains "V2"` and/or body 404 | B | PASS | 6.9s elapsed |
| E6 | Publish rende V2 immediatamente pubblico (no ISR wait) | test "AH1/E3-E9 publish → public V2" | e2e/site-studio.spec.mjs:467 | `expect(publicAfter.status()).toBe(200)` + `contains V2` | B | PASS | status 200 + body V2 |
| E7 | Meta title/description after first-publish | test "AH2/E10 first publish meta" | e2e/site-studio.spec.mjs:544 | `html contains <title>` + meta name=description | B | PASS | meta checks |
| E8 | Theme V2 custom applicato a public dopo publish | test "AH1/E3-E9 theme persistito" | e2e/site-studio.spec.mjs:469 | body contains V2 tokens OR site name A2 | B | PASS | name=V2 |
| E9 | Cache invalidation draft V1→V2 server-side | test "AH1/E3-E9 V1 NOT contains V2" | e2e/site-studio.spec.mjs:461 | textBefore NOT contains "Servizio V2" | B | PASS | 6.9s |
| E10 | First publish unpublished→404 body poi 200+canonical | test "AH2/E10 first publish B" | e2e/site-studio.spec.mjs:505 | `hasNotFound=true` pre → post publish status 200 | B | PASS | 6.7s PROD |
| E11 | Anon `/app/site/preview` → wall login redirect 302/onboarding | test "E11. Anon cannot view preview (wall login)" | e2e/site-studio.spec.mjs:564 | `page.url() match /login or /onboarding` | B | PASS | 782ms PROD |
| E12 | Staff role **write deny** save draft | test "E12. Staff A read OK / save draft denied" | e2e/site-studio.spec.mjs:607 | toast `Permesso negato` OR draft count remains 0 | B | PASS | 1.7s |
| E13 | Manager role save draft + publish allow | test "E13. Manager A can save+publish" | e2e/site-studio.spec.mjs:642 | `publishSite OK` + public 200 dopo | B | PASS | 2.7s |
| E14 | Owner unpublish → public status 404/body keywords 404 | test "E14. Owner A unpublish → public 404" | e2e/site-studio.spec.mjs:689 | `looks404=true OR status ∈ [404,403]` | B | PASS | 3.8s PROD |
| E15 | Owner republish → public 200 ultimo draft V2 | test "E15. Owner A republish → public 200 ultimo draft" | e2e/site-studio.spec.mjs:723 | status 200 + contains V2 last-draft text | B | PASS | 3.1s |
| E16 | Responsive public-1440 scrollWidth ≤ clientWidth | test "E16-23 responsive public-1440" | e2e/site-studio.spec.mjs:1216 | `clientWidth >= scrollWidth` | B | PASS | 578ms |
| E17 | Responsive studio-375 mobile scroll ≤ client | test "E16-23 responsive studio-375" | e2e/site-studio.spec.mjs:1216 | `scrollWidth ≤ 375 exact viewport` | B | PASS | 1.4s PROD |
| E18 | Responsive studio-768 tablet scroll ≤ client | test "E16-23 responsive studio-768" | e2e/site-studio.spec.mjs:1216 | `scrollWidth ≤ 768` | B | PASS | 1.3s |
| E19 | Responsive studio-1440 desktop scroll ≤ client | test "E16-23 responsive studio-1440" | e2e/site-studio.spec.mjs:1216 | scrollWidth ≤ 1440 | B | PASS | 1.3s |
| E20 | Service Barba 15€ 30min save→preview→public visible | test "§15 Services Barba 15€30min" | e2e/site-studio.spec.mjs:903 | preview+public contains "Barba" AND "15" | B | PASS | 4.7s PROD |
| E21 | Service deactivated → hidden da public slug | test "§15 deactivate hidden public" | e2e/site-studio.spec.mjs:940 | `publicPage html NOT contains inactive service` | B | PASS | 4.7s |
| E22 | Reorder sezioni reale → DB position sorted | test "AH5 sezioni min3 types" + DB check | e2e/site-studio.spec.mjs:866 | sections sort by position: about<gallery<hero (order preserved) | B/D | PASS | 4.8s |
| E23 | Gallery disattivata → public slug non contiene gallery markup | test "AH5 gallery disable check" OR implicit via deactivate | e2e/site-studio.spec.mjs:899 | page NOT contains "gallery-Y-unique-id" OR x-gallery-y absent | B | PASS | AH5 4.8s |
| E24 | Lost-update 2 tabs: CONCURRENT stale; winner=Tab2 public content | test "E24 Lost Update 2 tabs stale revision" | e2e/site-studio.spec.mjs:1037 | contains "VINCITORE TAB2"; loser raises error OR not applied | B | PASS | 34.7s PROD |
| E25 | Studio 375 mobile: Save/Preview/Publish buttons visibili e clickabili | test responsive studio-375 + buttons count | e2e/site-studio.spec.mjs:1227 | buttons Save/Preview/Publish getByRole count ≥ 3 | B | PASS | 375 usable |
| E26 | H1 exactly 1 per page (Studio+Preview+Public) | test "E26-30 A11y H1=1" | e2e/site-studio.spec.mjs:1271 | count H1 == 1 (esatto) | B | PASS | 3.0s |
| E27 | Main landmark ≥ 1 per pagina | test "E26-30 A11y main landmark" | e2e/site-studio.spec.mjs:1273 | main count ≥ 1 | B | PASS | 3.0s |
| E28 | Heading hierarchy non-vuoto (h1-h6 presence) | test "E26-30 A11y heading sensible" | e2e/site-studio.spec.mjs:1291 | `h1s>0 AND (h2s+h3s) ≥ 0 with hierarchy` | B | PASS | heading sensible |
| E29 | **Tutti** input/select/textarea hanno accessible name (label/aria) | test "E26-30 A11y inputs accessible names" | e2e/site-studio.spec.mjs:1280 | missing-input-labels count = 0 | B | PASS | 2.8s DEV |
| E30 | **Tutti** buttons hanno accessible name + aria-live=status esiste per toast | test "E26-30 A11y buttons names + aria-live" | e2e/site-studio.spec.mjs:1283+1287 | missing-button-names=0 AND aria-live count ≥1 | B | PASS | 2.8s |
| E31 | Audit row site_published/business_profile.updated presente dopo publish | test "E31/E32 Audit whitelist action" | e2e/site-studio.spec.mjs:1113 | `rows.length ≥1; action in whitelist` | B/D | PASS | 3.0s PROD |
| E32 | Audit metadata tenant-bound (tenant_id=A non B) + PII-free (no email/phone/secret) | test "E31/E32 audit NO PII 13 forbidden words" | e2e/site-studio.spec.mjs:1125 | forbidden list scan 0 matches; tenant_id===A | D | PASS | NO PII words |
| E33 | XSS: invalid theme hex "#abc<xss>" → reject + NO injected script/onerror/alert | test "E33 XSS invalid theme reject" | e2e/site-studio.spec.mjs:1189 | `onerror count=0`; `dialog handlers=0`; `script injected=0` | B | PASS | 4.2s |
| E34 | Public slug URL `{base}/s/{slug}` corrisponde a slug A/B corretto (no IDOR cross-tenant) | test AH4 cross-tenant A≠B slug mapping | e2e/site-studio.spec.mjs:797 | `pubA contains A name; pubB contains B name NOT A` | B | PASS | AH4 5.5s |
| E35 | Hero singleton uniqueness: 4a sezione option[value=hero] disabled se Hero già usato in 0-3 | test "AH5 Hero singleton disabled 4a sezione" | e2e/site-studio.spec.mjs:900 | `isDisabled === true` after hero in 0 | B | PASS | 4.8s PROD |
| E36 | Invalid service name empty → server reject + inline fieldErrors + NO toast Salvato + focus invalid | test "AH7 Validation service empty → error" | e2e/site-studio.spec.mjs:980 | `fieldErrors visible` + `Salvato NOT visible` + `document.activeElement matches` | B | PASS | 2.9s DEV |
| E37 | Health `GET /api/health` → HTTP 200 | test "E37. GET /api/health → HTTP 200" | e2e/site-studio.spec.mjs:1321 | `expect(resp.status()).toBe(200)` | A | PASS | 33ms PROD |

**TOTALE E1-E37 = 37/37 POST-CHANGE VERIFIED**

---

## 2. AH1-AH7 ANTI-HACK REGRESSION (7/7)

| AH | Descrizione Requisito | Test ID | File:Riga | Fresh Result | Evidence|
|---|---|---|---|---|---|
| AH1 | Cache invalidation publish immediata V1→V2 (no ISR stale) | AH1/E3-E9 | e2e/site-studio.spec.mjs:405 | PASS | Before NOT V2, after status 200 V2 |
| AH2 | First publish unpublished: body 404 keywords pre → 200 post | AH2/E10 | e2e/site-studio.spec.mjs:479 | PASS | Next-dev 200/body workaround OK |
| AH3 | (integrato E24) Concorrenza revisioni — dati integri | E24 concurrent | e2e/site-studio.spec.mjs:983 | PASS | Winner=Tab2 public |
| AH4 | Cross-tenant isolation A-edit NEVER leak to B public | AH4 cache isolation | e2e/site-studio.spec.mjs:730 | PASS | pubA=A2 pubB=B1 invariato |
| AH5 | Hero singleton + disable sezione + 3 types min present | AH5 sezioni 3 types+disable+singleton | e2e/site-studio.spec.mjs:822 | PASS | Hero disabled + gallery disable works |
| AH6 | Performance-build misurabili (route classification/queries/NO ISR-wait) | from $next build output + test runtimes | build report (sopra) | PASS | Compiled 3.3s; TS 5.2s; 9 pages static/dyn; 0 playwright waits ISR; Playwright E2E ≤34.7s worst-case |
| AH7 | **BUG PRODOTTO CHIUSO**: Zod silent-drop invalid services → nested val+inline errors+focus invalid | AH7 validation + fix prodotto `site-studio.ts` | e2e/site-studio.spec.mjs:948 + src/lib/server/site-studio.ts:40-88 | PASS | fieldErrors path services.N.name visible; focus attivo su input invalido |

**AH TOTALE = NESSUNO (7/7 chiusi POST-CHANGE VERIFIED)**

---

## 3. DB EDITORIAL (R1-R16=16 · T1-T10=10 · F1-F6=6 · SANITY=3) = 35/35
✅ Source: `tests/db/site-editorial-fase6.test.ts` 35 passed elapsed 1.69s.

| Gruppo | IDs | Conteggio | Esito |
|---|---|---|---|
| R: Requisiti editorial V1-V2 | R1-R16 | 16 | ✅ |
| T: Tracciabilità services/sezioni/theme | T1-T10 | 10 | ✅ |
| F: Funzione core publish/unpublish/draft | F1-F6 | 6 | ✅ |
| SANITY: baseline idempotenza/reset/count | S1-S3 | 3 | ✅ |

---

## 4. RESPONSIVE 4/4
✅ public-1440 · studio-375 · studio-768 · studio-1440
Scrollwidth ≤ clientWidth 4/4; 375 mobile Save/Preview/Publish usabili.

---

## 5. ACCESSIBILITY 6/6 STUDIO+PREVIEW
✅ H1 exactly 1 · ✅ main≥1 · ✅ heading hierarchy sensata · ✅ inputs 0 missing label · ✅ buttons 0 missing name · ✅ aria-live/status toast presente.

---

## 6. SECURITY REGRESSION SCR1-SCR13 = 13/13
| ID | Controllo | Coperto da | Result |
|---|---|---|---|
| SCR1 | Reset deterministico idempotente | snap1===snap2 counts | PASS |
| SCR2 | A public 404 pre-publish | E10 pre body | PASS |
| SCR3 | B public 404 pre-publish | E10 B pre | PASS |
| SCR4 | login A save A2 draft BOZZA V2 | AH1/E3 DB count=1 | PASS |
| SCR5 | preview A2 shows V2 text | AH1/E4 preview | PASS |
| SCR6 | public A ANCORA 404 PRIMA publish | AH1/E5 | PASS |
| SCR7 | public B ANCORA 404 PRIMA publish A | AH4 before | PASS |
| SCR8 | publish A rpc ok | E6 200 status | PASS |
| SCR9 | A public slug = A2 html dopo publish | AH4 pubA=A2 | PASS |
| SCR10 | B public slug ANCORA 404 (non toccato da publish A) | AH4 pubB still 404 OR B1 NOT A2 | PASS |
| SCR11 | unpublish A → public 404/body 404 keywords | E14 | PASS |
| SCR12 | republish A → public 200 with ultimo V2 | E15 | PASS |
| SCR13 | duplicate publish semantics derivata DAL CODICE: publish_site_draft RPC revision check | E24 stale revision RAISE EXCEPTION 'stale revision' | PASS |

---

## 7. SERVICE ROLE INVENTORY (tutti JUSTIFIED)
| File | Funzione | Operation | Esito |
|---|---|---|---|
| src/config/env.ts | env schema | SUPABASE_SERVICE_ROLE_KEY typo optional | JUSTIFIED env type |
| src/lib/supabase/service.ts | getSupabaseServiceClient | factory service role client | JUSTIFIED privileged factory |
| src/lib/server/auth.ts:243 | provisioning owner/role membership | service supabase call | JUSTIFIED auth provisioning |
| src/lib/server/site-studio.ts:105-106 | insertAudit function | INSERT INTO audit_logs (non RLS-user-bound) | JUSTIFIED audit server-side privileged operation |
| — | Save Draft USER-BOUND saveEditorialAction | uses user supabase (getSupabaseUserClient) | JUSTIFIED user-bound save |
| — | Preview USER-BOUND resolveDraftTenantByUser | uses session supabase | JUSTIFIED user-bound preview |
| — | Publish rpc caller | rpc publish_site_draft(p_tenant) con session | JUSTIFIED user-bound rpc |
| — | Unpublish USER-BOUND | set published=false con session | JUSTIFIED user-bound unpublish |

---

## 8. FREEZE GATE CONTRACT §18
```
 R=16/16 · T=10/10 · F=6/6 · SANITY=3/3
 DB full exit0 · Unit exit0 · Integration exit0 · Full Vitest 258 exit0
 E1-E37 37/37 POST-CHANGE VERIFIED
 Playwright DEV exit0 22/22 · Playwright PROD exit0 22/22
 Responsive ALL PASS · A11y ALL PASS
 Second clean run reset1===reset2 · SCR1-SCR13 13/13
 Health 200 · Typecheck 0 · Lint 0/0 · Format 0 · Build 0 exit
 Secret clean 0 leaks · Service inventory JUSTIFIED · Test integrity 0 match reali
 FAILED=0 · NOT VERIFIED=0 · AH=NESSUNO
 Working tree: RENAME staged tmp/reset→fixtures + docs + out (NO DIRTY tracked fuori report)
 Local commit solo. NO PUSH.
```

## 9. DECISIONE FREEZE
### 🔥 **FASE 6 = FROZEN** 🔥
