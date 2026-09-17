# FINAL PRODUCTION ACCEPTANCE BASELINE

**Timestamp:** 2026-09-17 T Z CET (inizio acceptance run)
**Audit:** Production Acceptance Gate Velora

## 1. COMMIT / BRANCH

| Campo | Valore |
|---|---|
| Branch corrente | `feature/auth-onboarding` |
| HEAD commit | `fa3b673709f02747669c668fbaab4a7c26157f15` |
| Working tree | **MODIFICATO** (vedi `git status --short` sotto) |

### git status --short (selezionati i file sorgenti sensibili)

- ` M .npmrc`
- ` M ARCHITECTURE_DECISIONS.md`
- ` M PRE_FIRST_CLIENT_STABILIZATION.md`
- ` M PRODUCTION_READINESS_CHECKLIST.md`
- ` M playwright.config.ts`
- ` M scripts/apply-reset-deterministic.mjs`
- ` M src/app/app/page.tsx`
- ` M src/app/globals.css`
- ` M src/app/s/[slug]/booking/BookingClientForm.tsx`
- ` M src/app/s/[slug]/booking/actions.ts` ← azioni booking (CSRF cookies())
- ` M src/app/s/[slug]/booking/page.tsx`
- ` M src/app/s/[slug]/components/MobileStickyCta.tsx`
- ` M src/components/app-shell/AppShell.tsx`
- ` M src/components/site/SiteShell.tsx`
- ` M src/components/site/sections/Footer.tsx`
- ` M src/components/site/sections/Navbar.tsx`
- ` M src/components/site/sections/BookingWidget.tsx`
- ` M src/components/site/sections/Hero.tsx` / `Services.tsx` / `Staff.tsx` / `Reviews.tsx` / `Gallery.tsx` / `About.tsx`
- ` M src/lib/server/site-engine.ts` ← 10 switch case + PublicSiteData whatsapp/lat/lng
- ` M src/lib/server/site-studio.ts` ← coerenza anteprima editoriale
- ` M artifacts/gate20260917-f7-contacts-browser-v2.mjs` ← fix regex phone spazi

## 2. VERSIONI

| Componente | Versione |
|---|---|
| Next.js | 16.3.5 (Turbopack) |
| Node.js | 24.13.1 (Vercel CLI report) |
| TypeScript | rigoroso |
| Vitest | 4.1.10 |
| Playwright | 1.62.1 |
| @supabase/supabase-js | 2.112.3 |
| @supabase/ssr | 0.12.4 |
| Vercel CLI | **59.20.0** — appena installata globale `npm install -g vercel` (durante baseline) |

## 3. AMBIENTE LOCALE

| Servizio | Stato | Note |
|---|---|---|
| Next.js :3000 | **NON ATTIVO** | Processo precedente spento (nessun LISTEN port 3000 al momento baseline) |
| Docker Desktop | **NON ATTIVO** | `docker ps` → `The system cannot find the file specified. //./pipe/dockerDesktopLinuxEngine` |
| Supabase DB locale 127.0.0.1:54322 | **NON RAGGIUNGIBILE** (Docker spento) | Necessario riavvio Docker Desktop prima dei test DB/F8/F9/F10/F11/F15 |
| Inbucket :54324 | **NON RAGGIUNGIBILE** | Dipende da Supabase locale |

## 4. VERCEL / CLOUD

| Componente | Stato | Evidence |
|---|---|---|
| `.vercel/project.json` | PRESENTE | Project ID `prj_RhmdpUTZnx6e560Smr3tx0HsdF1W`, Org `team_p1QSkJNMSbnMRuO3i9bqyESi`, framework=nextjs, node=24.x |
| Vercel CLI | INSTALLATA | `vercel --version` → 59.20.0 |
| `$env:USERPROFILE\.config\vercel\auth.json` | **MISSING** | Non loggato |
| `VERCEL_TOKEN` env variable | **NULL** (non settato) | |
| Deploy URL esistente (storico) | `velora-first-customer-prod-1aoim9tul-newcreatord-1773s-projects.vercel.app` | Dal report precedente; NON verificato in questo run |
| Dominio reale cliente | **NON CONFIGURATO** in questo run | da verificare dopo login deploy |

### VERCEL — BLOCCO AUTENTICAZIONE

Vercel CLI installata ma **NON autenticata**. Due vie possibili:
- (A) Chiedere all'utente un VERCEL_TOKEN temporaneo con scope progetto → `$env:VERCEL_TOKEN=xxxx ; vercel deploy --prod --token xxxx`
- (B) `vercel login` interattivo → NON eseguibile in ambiente non interattivo di default.

Finché l'autenticazione Vercel non è disponibile, i seguenti gate rimangono BLOCCATI: F3.6 (Vercel deploy), F4 (Domain/HTTPS), F5 (Real customer HTTPS), F7 (produzione reale), F22 (Final smoke HTTPS), F19 (responsive produzione), F20 (SEO HTTPS).

## 5. SENTRY / OSSERVABILITÀ

| Elemento | Stato |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | NON presente in `.env` o `.env.local` |
| `SENTRY_DSN` server-side | NON presente |
| `src/instrumentation.ts` | **NON ESISTE** |
| `app/global-error.tsx` | **NON ESISTE** (esiste solo `app/error.tsx`) |
| Stub `src/lib/shared/sentry-stub.ts` | Presente, safe, NO hardcoded secrets |

Osservabilità = NOT VERIFIED prima di configurazione DSN + instrumentation.ts.

## 6. SUPABASE / DATABASE

| Riferimento | Valore |
|---|---|
| Cloud dev Project | `uiekkhgspziozprxulit` (storico) |
| Cloud REST DNS IPv6 unreachable (storico) | confermato non scritture |
| Locale Docker (predefinito) | DB `127.0.0.1:54322`, REST `54321`, Kong `54323`, Inbucket `54324` |
| RLS 49/49 PASS | Sessione precedente — RIPETERE come regression in questo run dopo riavvio Docker |

## 7. TEST E SUITE DISPONIBILI

| Test | Path | Ultimo stato storico | Stato questa run |
|---|---|---|---|
| RLS 49 test | `tests/db/multi-tenant-rls.test.ts` | 49/49 PASS (SSL locale fix) | DA ESEGUIRE dopo Docker up |
| Booking E2E F13 | `scripts/booking_e2e.mjs` | 14/14 PASS Tonino | DA ESEGUIRE dopo up Next+Supabase |
| F7 CONTATTI 3T × 2VP × 9 | `artifacts/gate20260917-f7-contacts-browser-v2.mjs` | 6/6 PASS v4 | Regression: DA ESEGUIRE (locale) |
| Secrets scan 172 files src/ | `artifacts/tmp-secrets-scan-gate.mjs` | 0 leaks | DA RIESGUIRE in questo run |
| F8 RACE 10x | NON trovato script stand-alone | - | DA IMPLEMENTARE ad hoc (minimale) |
| F9 DOUBLE SUBMIT | NON trovato | - | DA IMPLEMENTARE |
| F10 SLOT 5-STEP | NON trovato | - | DA IMPLEMENTARE |
| F11 PAYMENT | NON trovato | - | DA IMPLEMENTARE |
| F15 PERSISTENCE 10min | `scripts/db_persistence_sampler.mjs` (esiste) | - | DA ESEGUIRE |
| F20 SEO locale | Invoke-WebRequest localhost | PASS storico | DA ESEGUIRE in questo run |

## 8. GATE GIÀ VERIFICATI (EVIDENZA STORICA — DA NON CONFONDERE CON "VERIFIED NOW")

Regola 23 del mandato: vecchia evidenza = historical evidence; i gate richiesti dal corrente acceptance devono essere "VERIFIED NOW" ove esplicitamente nuovo run.

| Gate | Historical evidence | This run |
|---|---|---|
| F3.1 Typecheck | EXIT=0 | DA RIESGUIRE |
| F3.2 ESLint src scope | max-warnings=0 | DA RIESGUIRE |
| F3.3 pnpm audit --prod | 0 vuln | DA RIESGUIRE |
| F3.4 Secrets scan src 172 | 0 leaks | DA RIESGUIRE |
| F3.5 Next build | 18 routes PASS | DA RIESGUIRE |
| F2.3 RLS 49 | 49/49 PASS | DA RIESGUIRE |
| F2.1 Booking E2E Tonino 14/14 | PASS | DA RIESGUIRE |
| F7 CONTATTI 6/6 | PASS | DA RIESGUIRE locale |
| F20 SEO locale | PASS | DA RIESGUIRE |
| F3.6 Vercel deploy | NOT VERIFIED (auth missing) | BLOCCATO auth |
| F4 Domain/HTTPS | NOT VERIFIED (deploy non fatto) | BLOCCATO auth |
| F5 Real customer HTTPS | NOT VERIFIED | BLOCCATO auth |
| F8 Race 10× | NOT VERIFIED | DA ESEGUIRE dopo Docker up |
| F9 Double submit | NOT VERIFIED | DA ESEGUIRE |
| F10 Slot 5-step | NOT VERIFIED | DA ESEGUIRE |
| F11 Payment bonifico | NOT VERIFIED | DA ESEGUIRE |
| F15 Persistence marker 10min | NOT VERIFIED | DA ESEGUIRE |
| F6 Backoffice login Tonino | NOT VERIFIED | DA ESEGUIRE |
| F12 Cross multi-tenant dedicated QA-A/B | NOT VERIFIED (slug QA non nel DB corrente) | DA ESEGUIRE |
| F14 Error handling 5 casi | NOT VERIFIED | DA ESEGUIRE |
| F17 Audit log 3 eventi | NOT VERIFIED | DA ESEGUIRE |
| F19 Responsive 4VP | 2/4 VP storiche (390/1440) | DA ESEGUIRE 360/768/390/1440 |
| F22 Smoke HTTPS completo | NOT VERIFIED | BLOCCATO auth |

## 9. MODIFICHE LOCALI APPLICATE IN QUESTO RUN (fino a questo baseline)

1. **npm install -g vercel** - CLI installata, versione 59.20.0. Nessuna modifica a sorgenti progetto.
2. **SCRIVENDO questo file** baseline.

Nessun'altra modifica applicata.
