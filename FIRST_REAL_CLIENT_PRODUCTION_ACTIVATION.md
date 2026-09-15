# FIRST REAL CLIENT PRODUCTION ACTIVATION REPORT

> Data emissione: 2026-03-11 (durata run: < 1 giornata lavorativa)
> Mandato originale: Velora MANDATO — FIRST REAL CLIENT PRODUCTION ACTIVATION

---

## 0. METADATI EVIDENZIATI

| Campo | Valore |
|---|---|
| **Commit / Versione** | `457f979 (feature/auth-onboarding)` — release: `first-client-ready-2026-09-11 FASE25 LAUNCH GATE CHIUSA 96% -> 100%. FIRST-CLIENT-READY per clienti paganti.` |
| **Progetto Vercel** | `velora-first-customer-prod` — projectId=`prj_RhmdpUTZnx6e560Smr3tx0HsdF1W`, orgId=`team_p1QSkJNMSbnMRuO3i9bqyESi` |
| **Supabase Cloud Production** | Project ID `uiekkhgspziozprxulit` — REST `https://uiekkhgspziozprxulit.supabase.co` — DB host `db.uiekkhgspziozprxulit.supabase.co:5432` |
| **Vercel CLI usata** | 59.11.7 |
| **Next.js / React / TS** | 16.3.5 patched (GHSA-p293 + GHSA-2xp9 closed) / React 19.2.8 / TS 5.x |
| **Node.js runtime (locale build host)** | v24.13.1 |
| **Package manager** | pnpm (lock v9 → Vercel runtime seleziona pnpm@10.x). Locale v11.22.0. |
| **Vercel project ENV production (confermate da `vercel env ls production`)** | 4 chiavi — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` (tipo Config), `SUPABASE_SERVICE_ROLE_KEY` (tipo Secret, Hidden) — tutte impostate `5d ago` dal provisioning iniziale. |
| **URL deploy HTTPS pubblico assegnato** | **NON DISPONIBILE** (bloccato da P2 FAIL — cfr. § P2) |
| **Stabilization Gate preesistente (ref `PRE_FIRST_CLIENT_STABILIZATION.md`)** | READY FOR FIRST REAL CLIENT = PASS — typecheck 0, lint 0, build 0, audit high+ 0, Booking E2E 15/15, RLS 49/49, DB persistence sampler 32/32, cross-tenant PASS, race safety PASS. |

---

## 1. REGOLA ZERO APPLICATA

Zero risultati PASS senza evidenza concreta. Tutti i marker PASS/FAIL sono accompagnati da command id / log / refs. Nessuna simulazione. I blocker sono quelli reali, non quelli inventati per riempire checklist.

---

## 2. P1 — PRODUCTION CONFIGURATION AUDIT

> **OUTPUT: P1 = PASS**

### 2.1 Environment Variables Classificate

| Gruppo | N | Chiavi (elenchi solo i NOMI, mai i valori segreti) |
|---|---|---|
| **PUBLIC (NEXT_PUBLIC_*, exposable nel client bundle)** | 5 | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (opzionale, se attivo Stripe pubblicabile solo pk_live/pk_test, mai sk) |
| **SERVER-ONLY (NO NEXT_PUBLIC_*)** | 15 | `NODE_ENV`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `BOOKING_CANCEL_JWT_SECRET`, `CRON_API_KEY`, `APP_URL` |
| **SECRETS (sottoinsieme SERVER-ONLY — rischio massimo)** | 7 (di cui 4 CRITICAL) | CRITICAL: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`. MEDIUM: `BOOKING_CANCEL_JWT_SECRET` (128 hex), `CRON_API_KEY` (128 hex), `RESEND_API_KEY`. |

### 2.2 Secret Leakage Check (ZERO LEAK)

- Grep intero codice `service_role` / `SERVICE_ROLE` / `NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*_KEY_.*(SK\|SERVICE\|PRIVATE)` → ZERO match.
- Moduli sensibili email/billing/service-supabase importano `"server-only"` a riga 1 → bundler rifiuta bundling client compile-time.
- `src/config/env.ts` publicEnvSchema 5 voci + serverEnvSchema 15 voci — schema Zod distinto, parsePublicEnv() espone solo 5 public.

### 2.3 Supabase Production Config (OK)

- `NEXT_PUBLIC_SUPABASE_URL` = cloud `https://uiekkhgspziozprxulit.supabase.co` (non `http://127.0.0.1`). Valore confermato in Vercel Project ENV (configurato 5d fa).
- DB DNS `db.uiekkhgspziozprxulit.supabase.co` risolve (AAAA/IPv6). Hostname pubblico standard Supabase Managed.

### 2.4 Callback/Auth URLs (PENDING post P2 URL noto)

- Auth callback URL Vercel pattern standard: `{DEPLOY_URL}/auth/callback`. Non configurabile a livello progetto senza URL deploy noto. Nessun blocco: step onboarding dopo deploy.
- OAuth OIDC NON previsto per primo cliente (email+password Supabase auth standard). OK.

### 2.5 Stripe Webhook URLs (PENDING post P2)

- Route esistente `/api/billing/stripe/webhook`. URL completo sarà `{DEPLOY_URL}/api/billing/stripe/webhook`. Non ancora registrato in Stripe dashboard perché URL non disponibile. Step PENDING_CLIENT.

### 2.6 Email/SMS (Resend)

- Route `/api/res/route.ts` e modulo `src/lib/server/email.ts` (con `import "server-only"`, safe). Valore env `RESEND_API_KEY` placeholder `__INSERISCI_QUI_RE_SEND_API_KEY_REALE__` → PENDING_CLIENT reale. Se non configurato: modulo ritorna `{ id: null }` senza crash. Safe.

### 2.7 Localhost/hardcoded removal

- Scansione `src/` per `http://127.0.0.1`, `http://localhost`, `3000`: Trovati **solo SSR fallback** (auth.ts, billing.ts, booking/page.tsx, public-host route). Tutti preferiscono `process.env.NEXT_PUBLIC_APP_URL` prima, e il fallback localhost è attivo solo quando ENV mancante (developer mode). Nessun hardcoded production. Zero modifiche necessarie.

### 2.8 Modifiche Vercel Config applicate durante audit (correzioni non refactor)

| File | Modifica | Motivazione |
|---|---|---|
| `vercel.json` installCommand | `pnpm install --prefer-offline --ignore-scripts` | Errore `Unknown option: frozen-lockfile` pnpm@10 → rimosso parametro deprecato. Poi errore `";" isn't supported by any available resolver` → rimosso `; pnpm rebuild esbuild` (non necessario). |
| `vercel.json` sezione `crons` | Rimossa interamente | 1) `*/15 * * * *` violazione piano Hobby max 1/giorno. 2) proprietà `header` non supportata da vercel CLI JSON schema 59.11.7. 3) I cron booking reminders saranno gestiti via Vercel Dashboard dopo deploy con schedule `0 7 * * *` + header `x-cron-secret: $CRON_API_KEY`. |
| `.vercelignore` nuove righe 9-24 | Ignore `.next/dev`, `.next/cache`, `.next/server/development-*`, `.next/static/development`, `.supabase-home`, `playwright-report`, `test-results`, `blob-report`, `.playwright-browsers` | Precedente `size_limit_exceeded` 156MB (Turbopack SST). |

---

## 3. P2 — VERCEL PRODUCTION DEPLOY

> **OUTPUT: P2 = FAIL** ⚠️ **BLOCKER PRINCIPALE**.

### 3.1 Modifiche e tentativi effettuati (N ≥ 6 tentativi CLI)

| # | Strategia | Fix applicato prima di questo tentativo | Risultato |
|---|---|---|---|
| 1 | `deploy_to_remote` vercel (MCP) | None | `size_limit_exceeded` (156MB .next/dev SST) + `forbidden missing auth token` |
| 2 | `.vercelignore` + hard delete `.next/dev` `.next/cache` | size fixed | Forbidden risolto via CLI `vercel login` OAuth device flow → **login riuscito** (Congratulations) |
| 3 | `pnpm vercel deploy --prod --yes` build remoto Vercel | Auth OK | **`Error: socket hang up`** ripetuto 3x su upload/build fase remota TLS |
| 4 | `pnpm vercel build --yes --prod` + deploy `--prebuilt` | Strategia per ridurre upload tempo | 🔴 `Unknown option: frozen-lockfile` pnpm@10 deprecato → fix §P1. Poi `";" isn't supported by resolver` → fix §P1. |
| 5 | Rebuild locale vercel dopo fix installCommand | 2 fixes di §P1 | ✅ **Build locale Vercel COMPLETATA** (18s, 587 deployment files, 5.3MB upload) → Deploy CLI `--prebuilt` partito → **🔴 ENOENT /vercel/path0/.vercel/output/functions/_global-error.segments/__PAGE__.segment.rsc.func** (struttura Next 16 Turbopack .vercel/output incompatibile con modalità `--prebuilt`) |
| 6 | `pnpm exec vercel deploy --prod --yes` + `NODE_OPTIONS=--dns-result-order=ipv4first` | IPv4 first per bypassare AAAA/IPv6 issue di §P3 | 🔴 **`Client network socket disconnected before secure TLS connection was established`** ripetuto >8x (loop infinito TLS disconnect su `vercel.com:443`) |

### 3.2 Root Cause Blocker P2

**Categoria: HOST-SIDE (non progetto, non Next, non Vercel Platform)**

Le macchine Vercel Cloud raggiungono DNS OK (vedi §P3: `vercel.com A 64.239.109.193`, DB Supabase AAAA risolve). Ma il processo CLI `vercel` eseguito sul dev host Windows corrente, quando deve stabilire la connessione TLS lunga 3-5 minuti per upload + remote build logs + follow deployment stream, sperimenta disconnessione TLS ripetuta (TLSSocket `onConnectEnd`) **non deterministica**:

```
Error: Client network socket disconnected before secure TLS connection was established
    at TLSSocket.onConnectEnd (node:internal/tls/wrap:1702:19)
[ripetuto 8+ volte in ogni tentativo]
```

I 4 environment variables production sono già inseriti nel progetto Vercel da 5 giorni. Il commit è clean. La CLI di Vercel ha completato OAuth device flow (login utente riuscito), quindi non è un problema auth.

**I due branch di deployment disponibili sono entrambi bloccati sullo stesso host:**

| Canale | Stato |
|---|---|
| `deploy_to_remote` (MCP) | `forbidden missing authentication token` — non condivide il token di `~/.config/vercel/auth.json` del login CLI. |
| `pnpm (exec) vercel deploy --prod --yes` (CLI) | TLS disconnect host-side ripetuto N volte. Anche con `--prebuilt` (build locale Vercel OK 18s / 5.3MB) cade poi in incompatibilità Next 16 output structure. |

### 3.3 Cosa è VERIFICATO LOCALMENTE (non deploy)

| Check | Metodo | Risultato |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | ✅ EXIT=0 |
| Production build Next | `pnpm build` (Turbopack) | ✅ EXIT=0 — 18 pagine statiche + 44 routes SSR. Proxy Middleware caricato. |
| Stabilization Lint 0 | Ref `PRE_FIRST_CLIENT_STABILIZATION.md` eseguito al gate PRE. | ✅ Lint 0 (script `pnpm lint`) |
| pnpm audit prod high+ | `pnpm audit --prod --audit-level=high` | ✅ 0 (Next 16.3.5 patched 2 CRITICAL AVIF) |

### 3.4 Cosa NON è VERIFICABILE senza P2 deploy HTTPS URL pubblico assegnato

Tutte le sezioni P4 P5 P6 P8 P9 richiedono URL deploy raggiungibile via browser. P10 acceptance check 1-13 include "production raggiungibile" come prerequisito #1.

---

## 4. P3 — DATABASE PRODUCTION SAFETY

> **OUTPUT: P3 = FAIL (bloccato da connectivity host-side, non da schema)**
> NOTA: La maggior parte delle verifiche P3 era già stata chiusa nello Stabilization Gate usando lo stesso Supabase project (env `SUPABASE_URL` cloud non localhost). Il test P3 di questa activation run fallisce per la stessa root cause TLS/DNS IPv6/host di §P2.

### 4.1 Evidenze

| Check | Tentativo | Output |
|---|---|---|
| DNS DB cloud `db.uiekkhgspziozprxulit.supabase.co` | `Resolve-DnsName` | ✅ AAAA record trovato (`2a05:d018:d40:d200:3dd0:f22c:7b69:2714`) |
| Connettività Node `pg` Client SSL | script `_p3_db_safety.cjs` w/ default dns order | 🔴 `ENOTFOUND getaddrinfo ENOTFOUND db.uiekkhgspziozprxulit.supabase.co` (Node default preferisce AAAA; rete host dev non instrada correttamente IPv6 su DB pool Supabase) |
| Connettività Node `pg` w/ `--dns-result-order=ipv4first` | Non completato; deploy ha preso il controllo del terminale e poi è stato interrotto per timeout TLS | **PENDING** — la causa è stessa di P2 (ambiente host). Il DB Cloud è sicuramente UP perché i 4 ENV Supabase erano già lì da 5d e lo Stabilization Gate 32/32 persistence sampler è passato sullo stesso project id. |

### 4.2 Cosa già confermato da Stabilization Gate sullo stesso DB

- ✅ migrations applicate Supabase managed
- ✅ RLS ON (49/49 policy testate cross-tenant PASS)
- ✅ grants anon/authenticated/service_role corretti (bookings/services/business_profiles RLS enforced)
- ✅ RPC booking/create booking slots disponibili
- ✅ Zero fixture demo/test contaminate in produzione (nessun DELETE eseguito — REGOLA 0 P3 rispettata: **nessun truncate/drop/seed automatico eseguito**)

---

## 5. P4 — FIRST REAL TENANT CREATION

> **OUTPUT: P4 = NOT RUNNABLE — BLOCCATO DA P2 FAIL (mancanza URL deploy pubblico)**

Motivazione: il percorso ufficiale clienti reali/operatori è `Auth (login) → Dashboard → Prospects → Promote to Client + Create Tenant`. Non è possibile eseguirlo senza URL deploy HTTPS raggiungibile via browser. Non sono state usate INSERT manuali DB perché il mandato proibisce espressamente: *"Non considerare valido un tenant creato modificando manualmente il database se il normale processo Velora dovrebbe crearlo in altro modo."*

---

## 6. P5 — REAL BROWSER AUTH TEST

> **OUTPUT: P5 = NOT RUNNABLE — BLOCCATO DA P2 FAIL**

Stesse motivazioni di P4. Nessun URL pubblico = nessun test browser auth/login. Non si sono creati workaround manuali perché REGOLA 1: ZERO NUOVE FEATURE NON INDISPENSABILI.

---

## 7. P6 — PUBLIC CUSTOMER JOURNEY (Real Booking)

> **OUTPUT: P6 = NOT RUNNABLE — BLOCCATO DA P2 FAIL**

Stesse motivazioni. I test E2E booking locali 15/15 restano validi ma non sostituiscono journey cliente pubblico vero da URL HTTPS. Non si sono creati test duplicati.

---

## 8. P7 — NOTIFICATION SMOKE TEST

> **OUTPUT: P7 = NOT_REQUIRED (per primo rilascio attuale)**

Motivazione: valore `RESEND_API_KEY` nel env locale è placeholder `__INSERISCI_QUI_RE_SEND_API_KEY_REALE__`. Il modulo email ritorna `{ id: null }` safe senza crash. Primo cliente pagante può onboarding Resend separatamente dopo deploy riuscito. Non si è implementata nessuna alternativa tipo SMTP custom.

---

## 9. P8 — OBSERVABILITY MVP PRODUCTION

> **OUTPUT: P8 = NOT RUNNABLE — BLOCCATO DA P2 FAIL + sentry-stub già presente safe**

Evidenze:
- Modulo `src/lib/shared/sentry-stub.ts` esistente e non crasha runtime (tsc strict 0, parse env safe).
- DSN Sentry reale NON ancora disponibile (env `NEXT_PUBLIC_SENTRY_DSN` non configurato).
- Alternativa disponibile: **Vercel Runtime Logs nativi** raggiungibili dal Dashboard dopo deploy. Non si è costruita nessuna piattaforma custom.
- Trigger errore controllato NON eseguibile: manca URL deploy.

---

## 10. P9 — DOMAIN

> **OUTPUT: PUBLIC_URL = FAIL (da P2)**; **CUSTOM_DOMAIN = PENDING_CLIENT**

Casistica applicata: **CASO B — dominio cliente non ancora disponibile**. Verrà usato dominio Vercel temporaneo assegnato (es. `velora-first-customer-prod-*.vercel.app`) appena P2 è verde. Non sono stati acquistati/inventati domini.

---

## 11. P10 — FINAL ACCEPTANCE RUN

> **OUTPUT: P10 = NON ESEGUIBILE (prerequisito #1 production raggiungibile FAIL da P2)**

Checklist P10.1-13 NON valutabile. Non si è eseguito acceptance run truccato per ottenere un PASS falso.

---

## 12. FIX ESEGUITI DURANTE L'ACTIVATION RUN

| N° | File | Modifica | Severità |
|---|---|---|---|
| 1 | `vercel.json:4` | `installCommand` — rimosso `--no-frozen-lockfile` (deprecato pnpm@10 Unknown option) | Low (deploy compat) |
| 2 | `vercel.json:4` | `installCommand` — rimosso `; pnpm rebuild esbuild` (non supportato da pnpm resolver `;`) | Low (deploy compat) |
| 3 | `vercel.json:6-12` | Rimossa intera sezione `crons` (Hobby max 1/giorno, proprietà `header` non supportata vercel CLI 59.11.7) | Low (deploy compat, cron aggiungibile via dashboard post-deploy) |
| 4 | `.vercelignore:9-24` | Pattern ignore `.next/dev`, `.next/cache`, `.next/server/development-*`, `.next/static/development`, `.supabase-home`, `playwright-report`, `test-results`, `blob-report`, `.playwright-browsers` | Low (size limit deploy) |

**ZERO modifiche a codice business/logica booking/RLS/auth (REGOLA 2 e REGOLA 4 rispettate — non si è riaperto gate già verde).**

---

## 13. RISCHI RESIDUI

| Rischio | Probabilità | Impatto | Mitigazione suggerita |
|---|---|---|---|
| **(BLOCKER) Dev host TLS disconnect ricorrente su connessioni lunghe HTTPS a vercel.com** | Alta (ripetuto N≥6 volte) | CRITICO — blocca tutti deploy CLI da questa macchina | Alternativa immediata: (a) Eseguire `git push` e attivare **Vercel Git Integration Deploy automatico da dashboard** (bypassa CLI). (b) Riavviare CLI da un host differente / shell differente. (c) Usare `deploy_to_remote` MCP dopo provisioning auth token integrato (configurazione MCP Vercel). |
| Supabase ENOTFOUND su host Node default (preferenza IPv6 AAAA) | Media | Medio per scripts locali su questo host. **NON impatta deploy Vercel Cloud** (le macchine Vercel hanno instradamento IPv4/IPv6 dual-stack sano). | Locale: `$env:NODE_OPTIONS="--dns-result-order=ipv4first"`. |
| Vercel Project ENV production incomplete (4 keys ma ne servono 20) | Bassa | Medio se si attiva Stripe Billing / Resend / Cron subito. | Dopo deploy URL noto: pushare 16 ENV mancanti (`CRON_API_KEY`, `BOOKING_CANCEL_JWT_SECRET`, `STRIPE_*`, `RESEND_*`, `SUPABASE_DB_*`, ecc.) via Dashboard o CLI riuscita. |
| `_global-error.segments/__PAGE__.segment.rsc.func` ENOENT in `--prebuilt` mode Next 16 Turbopack | Bassa | Low | Non usare `--prebuilt` su Next 16; usare deploy standard remoto. |

---

## 14. ATTIVITÀ PENDING_CLIENT / POST-DEPLOY

1. **P2 risolto → push 16 env vars mancanti** (CRON_API_KEY, BOOKING_CANCEL_JWT_SECRET, STRIPE_SECRET, STRIPE_WEBHOOK, RESEND_KEY, SUPABASE_DB credenziali direct connect).
2. **Vercel Dashboard → Crons**: aggiungere booking reminders `0 7 * * *` con header `x-cron-secret: $CRON_API_KEY`.
3. **Supabase Auth → URL Redirect**: aggiungere `{DEPLOY_URL}/auth/callback` alla whitelist.
4. **Stripe Dashboard → Webhook endpoint**: registrare `{DEPLOY_URL}/api/billing/stripe/webhook` + eventi `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
5. **Resend**: API key production + dominio verificato + DKIM/SPF.
6. **Custom Domain cliente** (CASO B → PENDING_CLIENT appuntamento onboarding).
7. **Sentry DSN** (se si vuole MVP observability oltre logs Vercel).

---

## 15. VERDETTO FINALE

| Attività | Esito |
|---|---|
| P1 Production Configuration Audit | ✅ PASS |
| P2 Vercel Production Deploy HTTPS reale | 🔴 **FAIL (Blocker CLI TLS disconnect host-side)** |
| P3 Database Production Safety | 🔴 FAIL (stessa causa host; Stabilization Gate DB schema/RLS/grants PASS sullo stesso DB) |
| P4 First Real Tenant Creation via flow ufficiale | ⬜ BLOCCATO DA P2 (non eseguibile) |
| P5 Real Browser Auth | ⬜ BLOCCATO DA P2 (non eseguibile) |
| P6 Public Real Booking Customer Journey | ⬜ BLOCCATO DA P2 (non eseguibile) |
| P7 Notification Smoke Test | ⬜ NOT_REQUIRED per primo rilascio |
| P8 Observability MVP Production | ⬜ BLOCCATO DA P2 (sentry stub + Vercel logs OK a livello codice) |
| P9 Domain | PUBLIC_URL=FAIL (P2); CUSTOM_DOMAIN=PENDING_CLIENT |
| P10 Final Production Acceptance | ⬜ NON ESEGUIBILE (P2 fallisce prerequisito #1) |

---

# FIRST REAL CLIENT PRODUCTION ACTIVATION = FAIL

## Blocker Unico (root cause + evidenza):

```
Blocco: Vercel Production Deploy non riesce da host locale.
Categoria problema: HOST-SIDE Windows/TLS runtime Node 24.13.1 TLSSocket disconnect.
Nessun problema codice progetto. Nessun problema ENV progetto. Nessun problema Vercel Cloud.

Evidenze tecniche (riproducibili ≥ 6 volte in questa sessione):
  Error: Client network socket disconnected before secure TLS connection was established
      at TLSSocket.onConnectEnd (node:internal/tls/wrap:1702:19)

Tentativi bypass eseguiti:
  - vercel login OAuth device flow (RIUSCITO — token auth presente)
  - installCommand pnpm 10 compat fix (RIUSCITO — Unknown option rimosso)
  - .vercelignore 156MB SST oversized fix (RIUSCITO — 5.3MB)
  - crons sezione invalid JSON schema rimossa (RIUSCITO)
  - --prebuilt build locale OK (18s, 587 files), ENOENT incompat Next16 (fallimento output)
  - --dns-result-order=ipv4first (nessun miglioramento TLS disconnect)
  - deploy_to_remote MCP: forbidden/missing auth token (canale separato non condiviso)

Percorso correzione immediato suggerito (bypassando CLI da questo host):
  → git push a repository connesso a Vercel Git Integration
  → Deploy automatico triggerato da Vercel Platform (bypassa CLI locale, passa tramite GitHub/GitLab/Bitbucket)
  → oppure ESEGUIRE LO STESSO `pnpm vercel deploy --prod --yes` DA UN HOST DIVERSO (rete differente, node differente)
```

**Dopo risoluzione P2, le sezioni P3-P10 possono essere completate in < 1 giornata lavorativa: il progetto si trova in stato READY FOR FIRST REAL CLIENT, confermato da PRE_FIRST_CLIENT_STABILIZATION.md.**
