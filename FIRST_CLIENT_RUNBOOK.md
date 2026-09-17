# FIRST CLIENT RUNBOOK VELORA

## FASE 24 — RUNBOOK OPERATIVO PRIMO CLIENTE PAGANTE REALE

### Baseline 2026-09-11 · FIRST-CLIENT-READY 94% → target 96% post-F24

#### Fixture Demo Riferimento: "ESTETISTA DA TONINO" (Chiaramente demo NON reale; usare dati cliente quando disponibili)

#### Stato Tonino attuale: tenant_id=d5a0538e · slug=slugo-mtu30v76-1fon · publication vn=4 APPEND-ONLY · 9 servizi · 3 booking READ BACK confirmed (Maria/Luca/Simone) · caparra Simone Verdi deposit_paid CRO=202609101234567 ✅

> Runbook OPERATIVO passo passo per onboarding PRIMO CLIENTE PAGANTE REALE (non demo). Sostituire placeholder Tonino/Estetista con dati cliente vero al momento dell'onboarding. Non eseguire prima che Fasi 0/1/2/3/10/15/22/12/4/23 siano GATE VERDI ✅.

---

## PRE-REQUISITI (Eseguire prima della simulazione)

1. `git status` pulito o checkpoint GIT.
2. Cluster locale `velora-local` UP (docker ps).
3. `pnpm typecheck && pnpm lint --max-warnings=0 && pnpm build` = tutti exit 0.
4. Playwright 3 flussi E2E exit 0 (22 PASS).
5. LH reale installato e runnato.
6. Task 1-4 audit residui tutti 0 fail.

---

## FASE A — CREARE NUOVO CLIENTE (Velora Operatore)

A.1 Login SUPER_ADMIN locale (credential demo test su `http://localhost:3000/login`).
A.2 Andare in Prospects (menu a sinistra /admin/prospects).
A.3 Nuovo Prospect:

- Nome attività: **Estetista da Tonino**
- Categoria: `beauty / beauty_salon`
- Provincia: RM
- Città: Roma
- Phone: +39 06 12345678
- Email: info@estetista-tonino-demo.it
- Website: (vuoto — useremo Velora)
- Status: INTERESTED
  A.4 Aprire il Prospect → "Promote to Client + Create Tenant" (flow CRM → TENANT).
  A.5 Verificare: tenant creato con slug `estetista-da-tonino-demo-<TAG>`; status TENANT=ACTIVE.

---

## FASE B — CONFIGURAZIONE ATTIVITÀ (Business Profile + Brand System)

B.1 Andare in Dashboard → Settings → Business Profile (/app/site):

- Display name: Estetista da Tonino
- Legal name: Tonino Estetica SRLS Demo
- Category: beauty_salon
- Description: Estetista premium Roma Centro. Trucco, cerette, massaggi, manicure.
- Phone: +39 06 12345678
- WhatsApp: +39 333 0000000
- Email: info@estetista-tonino-demo.it
- Address: Via del Corso, 1, 00186 Roma RM
- Coordinate: lat 41.9028, long 12.4964
- Timezone: Europe/Rome
- Locale: it-IT
  B.2 Brand System (Design Tokens):
- Palette PRIMARY: #8b3a62 (bordeaux rosa), BACKGROUND: #fdf8f5, MUTED: #f2e4e0
- Radius: preset "rounded-lg"
- Typography: serif-heading + sans-body preset
- Tone: accogliente, femminile elegante
- Visual density: comfortable
- Button style: filled-bold-rounded
- Photography style: light-airy-warm
  B.3 Upload logo + favicon (Media Manager, dimensioni consigliare 512×512 PNG trasparente).

---

## FASE C — SERVIZI + CATEGORIE (10+ servizi)

C.1 Categorie da creare:

1. Trucco (Sposa, Trucco sociale, Trucco eventi)
2. Cerette (Sopracciglia, Labbra, Ascelle, Gambe, Inglese, Completa)
3. Unghie (Manicure classico, Gel, Semipermanente, Ricostruzione)
4. Corpo (Massaggio rilassante, Massaggio decontratturante, Scrub corpo, Trattamenti anticellulite)
   C.2 Almeno 12 servizi con prezzo, durata, deposito opzionale.
   C.3 Attivi tutti; riordinamento Drag&Drop.

---

## FASE D — STAFF + ORARI

D.1 Staff:

- "Tonina" (Owner — esperta trucco sposa) — servizi Tutti.
- "Laura" — massaggi + corpo.
- "Giulia" — unghie + cerette.
  D.2 Orari Studio:
  Lun-Ven 9:00-19:00 pausa 13-14.
  Sab 9:00-18:00.
  Domenica CHIUSO.
  D.3 Ferie: 15/08 - 22/08 (estate).
  D.4 Pausa pranzo 60min buffer servizio.

---

## FASE E — MEDIA + GALLERY

E.1 Caricare 15 immagini in Media Manager (8 MB max ciascuno).
E.2 Assegnare alt text it-IT ad ogni immagine.
E.3 Ordinamento galleria 8 hero shots + 7 dettagli.
E.4 Controllare: responsive variants generate; NO originali 4K servite.

---

## FASE F — SEO LOCAL + CONTENUTI

F.1 Meta Title: **Estetista da Tonino | Centro Estetico Premium a Roma Centro**
F.2 Meta Description: **Estetista Roma Centro: trucco sposa, cerette, manicure gel, massaggi, trattamenti corpo. Prenota online 24/7. Via del Corso 1.**
F.3 JSON-LD subtype: BeautySalon.
F.4 FAQ: 5 domande frequenti.
F.5 Cookie policy + Privacy policy generate.

---

## FASE G — COSTRUZIONE SITO + VARIANTI (Fase 3)

Sezioni attive (ordine):
G.1 Navbar variante `centered-logo-cta`
G.2 Hero variante `split-immagine-destra`
G.3 Trust `clienti-loghi`
G.4 Intro `curato`
G.5 Services variante `cards-prezzo`
G.6 Service-Categories `tutti-4`
G.7 Price List variante `tab-elegante`
G.8 Staff `carousel-3`
G.9 Gallery `masonry-8`
G.10 Testimonials `5-card`
G.11 FAQ `collapse-5`
G.12 Before/After `4-slot`
G.13 Location `mappa-orari`
G.14 Hours `tabella-lun-dom`
G.15 Contact `form-email-telefono`
G.16 Booking CTA `sticky-cta`
G.17 WhatsApp CTA `float-destra-basso`
G.18 Footer `3-col-social-legali`
G.19 Legal links (2 pagine).

---

## FASE H — PREVIEW + QA + VALIDATED

H.1 Anteprima http://localhost:3000/app/site/preview
H.2 Audit visuale 5 viewport (Fase 23 checklist).
H.3 QA pass: no layout rotti.
H.4 Stato: VALIDATED.

---

## FASE I — PUBLISH + DOMINIO PREVIEW

I.1 Click PUBLISH (FASE 15 atomico).
I.2 Slug pubblico: `/s/estetista-da-tonino-demo-<TAG>`
I.3 Dominio preview: `*.velora.app` (o temporaneo progetto).
I.4 Aprire URL pubblico.
I.5 Procedere Task 14 Domain workflow (stato: PENDING_DNS se custom).

---

## FASE L — BOOKING END-TO-END (Cliente Simulato)

L.1 Aprire /s/estetista-da-tonino... sul desktop.
L.2 Scegliere servizio → "Manicure Gel" 30€ 45min.
L.3 Scegliere staff "Giulia".
L.4 Scegliere data = mercoledì prossimo 14:30.
L.5 Inserire dati cliente finale demo: Mario Rossi demo.
L.6 Conferma prenotazione.
L.7 Verificare Backoffice /app/bookings → appuntamento presente status=confirmed.
L.8 Ripetere L4 stesso slot 14:30 — attendersi ERRORE "Slot occupato" (no double).

---

## FASE M — VALUTAZIONE VISIVA (Fase 22 regola "Sembra agenzia o demo?")

Aprire il sito su:

- Smartphone 360px (iPhone SE)
- Tablet 768px
- Desktop 1440px

Valutare (1-5 dove 5 = agenzia premium):
[] Gerarchia visuale
[] Allineamenti
[] Whitespace
[] Tipografia
[] Qualità immagini
[] Coerenza
[] CTA prominenti
[] Conversion flow naturale
[] Footer e legali curati

Se punteggio medio < 4.0 → **torna a Task 7/23 e migliora Design System e varianti. Non dichiarare F22 PASS.**

---

## FASE N — EXPORT EVIDENCE

N.1 Screenshot 3 device.
N.2 Lighthouse reale sul sito live — salvare JSON/HTML.
N.3 Playwright booking flow PASS — log.
N.4 DB: SELECT da bookings + customers + publication_versions.

---

## FASE P — DATI BANCARI REALI BONIFICO (F12 DECISIONE UTENTE: NO STRIPE)

> **⚠️ Regola F12 VERIFICATA**: Nessun Stripe. Pagamenti = Bonifico Bancario Manuale. L'utente inserirà in tabella i dati bancari quando disponibili. Tabella: `public.tenant_bank_accounts`.
> Placeholder Tonino attuale: IBAN=`IT00X0000000000000000000000` (demo) → **SOSTITUIRE CON DATI REALI PRIMO CLIENTE**.

P.1 Login OWNER o SUPER_ADMIN.
P.2 Aggiornare i dati bancari REALI tramite SQL service-role (NON UI per adesso — UI banking config sarà FASE25+):

```sql
-- 🔴 SOSTITUIRE CON DATI BANCARI REALI DEL CLIENTE 🔴
SET LOCAL request.jwt.claim.sub = '9df5232e-2303-4a6f-b643-f2386ac92ec1'; -- SUPER_ADMIN demo
SET LOCAL request.jwt.claim.role = 'authenticated';
UPDATE public.tenant_bank_accounts
SET
  iban = 'ITxxxxxxxxxxxxxxxxxxxxxxxxxx',           -- REALE cliente
  bic_swift = 'BCITITMMXXX',                        -- REALE
  bank_name = 'Banca Reale Cliente S.p.A.',         -- REALE
  account_holder = 'Nome Cognome / SRLS',          -- REALE
  is_primary = TRUE,
  updated_at = NOW()
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'; -- REPLACE tenant_id cliente reale
RETURNING id, tenant_id, iban, bic_swift, bank_name, is_primary;
```

P.3 **READ BACK SQL**: Confermare che la riga è stata aggiornata (returned 1 row; iban non contiene IT00X demo).
P.4 Verificare UI pubblico BOOKING: pagina booking `/s/slug/booking` → colonna sinistra "Bonifico Bancario" mostra IBAN REALE corretto + BIC + Causale booking_code + importo caparra (20% servizio).
P.5 Salvare screenshot UI booking con dati bancari.

---

## FASE Q — DOMINIO CUSTOM (es. `estetistadatonino.it`)

> Workflow 6 step dominio. Verifiche server-side mapping hostname → tenant. Tabella `public.tenant_domains`.

Q.1 **DNS setup cliente**: Istruire cliente a creare 2 record DNS (provider dominio cliente):

```
Tipo A      @           → IP Vercel/Velora PROD (da dashboard hosting)
Tipo CNAME  www         → cname.vercel-dns.com. OPPURE velora.ingest.example
```

Q.2 Inserire dominio in DB (stato PENDING_DNS_VERIFICATION):

```sql
INSERT INTO public.tenant_domains (tenant_id, hostname, is_primary, verification_status, ssl_status, created_at)
VALUES (
  'd5a0538e-567e-45ee-b00e-61659ed50637',  -- REPLACE cliente
  'estetistadatonino.it',                   -- REPLACE dominio cliente SENZA protocollo
  TRUE,
  'PENDING_DNS_VERIFICATION',
  'PENDING_SSL',
  NOW()
) ON CONFLICT (hostname) DO UPDATE SET updated_at = NOW()
RETURNING id, tenant_id, hostname, verification_status, ssl_status;
```

Q.3 **Verifica DNS** (attendere 5-30 minuti propagazione):

```bash
nslookup estetistadatonino.it
# deve risolvere IP corretto PROD Velora
```

Q.4 Stato passa → `VERIFIED_DNS` → `ACTIVE` quando SSL automatico provisioning completato.
Q.5 Mapping dominio → tenant è **server-side**: richiesta HTTP arriva con `Host: estetistadatonino.it` → middleware Next.js lookup `tenant_domains.hostname` → restituisce sito del tenant corretto. **Nessun mapping client-side / localStorage**.
Q.6 Smoke test: `curl -I https://estetistadatonino.it/` → HTTP 200 + `<title>` corretto cliente.

---

## FASE R — SIMULAZIONE END-TO-END CLIENTE FINALE REALE (Golden Path completo)

> **Regola 34 PERSISTENZA REALE**: Ogni step INPUT → API → DATABASE → READ BACK → UI. Non fermarsi al toast "Salvato".

### R.1 Simulazione Cliente Reale = "Sig.ra Gianna Rossi"

R.1.1 Aprire sito pubblico `/s/slug/booking` (o dominio custom).
R.1.2 Selezionare: Servizio `Massaggio Rilassante 60min` (€50) · Staff predefinito · Data = **tra 7 e 14 giorni** · Slot 10:00.
R.1.3 Compilare form cliente:

- Nome: Gianna
- Cognome: Rossi
- Email: gianna.rossi.cliente-reale@protonmail.com
- Telefono: +39 333 1122334
- Note: "Preferisco stanza al piano terra se possibile."
- GDPR: ✓ checked
  R.1.4 Click **"Conferma Prenotazione"** → pagina mostra "✅ Prenotazione confermata" + Codice Prenotazione + Coordinate Bancarie + Importo Caparra €10 (20%).
  R.1.5 **READ BACK SQL BOOKING CREATO**:

```sql
SET LOCAL request.jwt.claim.sub = '9df5232e-2303-4a6f-b643-f2386ac92ec1';
SET LOCAL request.jwt.claim.role = 'authenticated';
SELECT id, booking_code, customer_name, customer_email, customer_phone,
       service_id, staff_id, start_at, end_at, deposit_euro, payment_status, created_at
FROM public.bookings
WHERE tenant_id = 'd5a0538e-567e-45ee-b00e-61659ed50637'
  AND customer_email = 'gianna.rossi.cliente-reale@protonmail.com'
ORDER BY created_at DESC LIMIT 1;
```

→ Deve restituire 1 riga; `payment_status='deposit_pending_bank'`; `deposit_euro=10`.

### R.2 Cliente Esegue Bonifico + Dichiara CRO

R.2.1 Cliente fa bonifico di €10 a coordinate bancarie viste in UI. Causale = Codice Prenotazione.
R.2.2 Cliente torna sul sito booking → sezione "Ho già fatto il bonifico" → inserisce **CRO** 12+ cifre → Click "Dichiara bonifico".
R.2.3 Chiamata RPC anon: `public_booking_declare_bank_transfer(booking_code, cro, importo, data_transfer)` → esito OK.
R.2.4 **READ BACK SQL**: `payment_status` deve essere aggiornato a `deposit_pending_bank` oppure `deposit_pending_verification` (dipende enum); colonna `deposit_cro` SALVATA con valore inserito.

### R.3 Backoffice Owner = Tonino vede CRO + Segna Caparra Pagata

R.3.1 Login OWNER Tonino (`tonino-owner@velora.test` pw provvisoria conferma email).
R.3.2 Menù → `/app/bookings` → lista prenotazioni → riga Gianna Rossi mostra badge **"BONIFICO IN ATTESA"** sky blu.
R.3.3 Tooltip badge: mostra CRO inserito, importo, data dichiarazione.
R.3.4 Click pulsante **"✓ Segna Caparra Pagata"** → Server Action authz `booking_backoffice_set_deposit_paid` (SUPER_ADMIN/OWNER/MANAGER only).
R.3.5 **READ BACK SQL**:

```sql
SELECT id, payment_status, deposit_confirmed_at, deposit_confirmed_by, deposit_cro, deposit_euro
FROM public.bookings WHERE customer_email = 'gianna.rossi.cliente-reale@protonmail.com' LIMIT 1;
```

→ `payment_status='deposit_paid'` ✅; `deposit_confirmed_at` popolato; `deposit_confirmed_by` = OWNER user_id Tonino.
R.3.6 **VERIFICA UI BACKOFFICE**: Badge cambia in **"CAPARRA PAGATA"** colore emerald verde.
R.3.7 Agenda `/app/calendar` vista giorno: evento Gianna Rossi colorato verde confermato.

### R.4 Cross-Tenant Isolation Test Finale

R.4.1 Login Staff di TENANT B (non Tonino).
R.4.2 Tenta di aprire booking id di Gianna Rossi. Esito atteso: **ERRORE 403** oppure "Prenotazione non trovata". RLS 29/29 + 113 policy garantiscono isolamento.

### R.5 Doppia Prenotazione Stesso Slot Race

R.5.1 Simula 2 tab browser che prenotano lo stesso slot Gianna + "Franca Bianchi".
R.5.2 Esito: **1 SOLA confermata**. L'altra restituisce messaggio "Slot occupato o non disponibile". Constraint PostgreSQL EXCLUDE GiST.

---

## FASE S — LANCH GATE F25 CHECK FINALE 100%

S.1 Aprire `PRODUCTION_READINESS_CHECKLIST.md`.
S.2 Verificare OGNI voce riga per riga → checked ✅ o ⚠️ spiegato.
S.3 0 Blocker aperti?
S.4 LH PROD 4 URL: A11y≥80 / BP≥80 / SEO≥80 tutti PASS? (Perf≥90 stretch opzionale pre-launch).
S.5 FIRST-CLIENT-READY % aggiornata a **96% (F24)** → 100% (F25).
S.6 Aggiornare `VELORA_PRODUCTION_STATUS.md` header: FASE CORRENTE = F25 LAUNCH GATE CHIUSO.
S.7 **Commit**: `release: first-client-runbook-2026-09-11 · F24 chiusa 96%`.
S.8 **Deploy STAGING**: `vercel --prod` staging.
S.9 **Smoke 5 min staging**: Login SUPER_ADMIN → Prospect CRM → Nuovo cliente Tonino-Clone → Publish v1 → /s/slug → Booking clone → CRO → Backoffice mark pagata → READ BACK SQL.
S.10 **Deploy PRODUZIONE**: Veloce se staging smoke OK.
S.11 **Comunica al cliente**: URL sito + Dominio preview + Credenziali OWNER + Istruzione "Primo accesso e cambia password" + Guida inserimento orari/servizi + Guida bonifico bancario quando ricevono una prenotazione.

---
