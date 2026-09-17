# FIRST CLIENT DELIVERY REPORT — VELORA

> **Scenario**: **DRY RUN COMPLETO (non un cliente vero)** — primo ciclo end-to-end Velora dimostrato in ambiente LOCALE.
> Data generazione: 2026-01-11 (ISO)
> Ambiente: **LOCALE** (Supabase Docker 127.0.0.1:54322 postgres/postgres + Next.js 16 App Router Turbopack porta 3000 HTTP plaintext)
> Spec Mode (approvata): `.trae/specs/first-real-client-dry-run/spec.md` · 16 AC · 6 Tasks T1-T6 · 37 TR atomici
> Log esecuzione mega monolitico: `artifacts/mega_run_fixed_2.log` · 54 KB · exit codice=1 (crashed FASE 6 ReferenceError self template var `REPORT` → report scritto QUI manualmente con evidenze reali 0 FAKE)
> Run mega script (FASE 1-5 completate, FASE 6 RI-SCRITTA QUI): 55 TR · 36 PASS / 19 FAIL / 3 WARN.

---

## 1. Cliente (DRY RUN)

⚠️ **TUTTI i dati del cliente sono PLACEHOLDER ETICHETTATI DRY RUN / DEMO.** Nessun cliente vero, 0 PII reale, 0 foto locali/staff/lavori, 0 recensioni, 0 numeri di telefono/indirizzi reali. **Regola 0 Zero Fake rispettata.**

| Campo                                                 | Valore (DRY RUN / DEMO)                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo entità                                           | **DRY RUN — Placeholder dimostrativo Velora**                                                                                                                                      |
| Ragione sociale                                       | **DRY RUN STUDIO SRLS — NON UN CLIENTE VERO**                                                                                                                                      |
| Nome attività pubblico                                | DRY RUN STUDIO - NON UN CLIENTE VERO                                                                                                                                               |
| Indirizzo (DRY)                                       | Via Dry Run 1, 00100 Roma RM (Italia)                                                                                                                                              |
| Coordinate (DRY)                                      | lat=41.9028, lng=12.4964 (Roma centro demo)                                                                                                                                        |
| Telefono (DRY)                                        | +39 000 000 0000 (demo, NON reale)                                                                                                                                                 |
| Whatsapp pubblico (DRY)                               | +39 000 000 0000 (demo)                                                                                                                                                            |
| Email pubblica (DRY)                                  | dry-run@example.test (demo)                                                                                                                                                        |
| P.IVA / CF (DRY)                                      | IT00000000000 (demo)                                                                                                                                                               |
| IBAN bonifico (DRY BANK)                              | `IT00 0000 0000 0000 0000 00` (DRY BANK, NON un conto vero)                                                                                                                        |
| Social (DRY)                                          | Instagram: @dry_run_studio_demo · Facebook: /dryrunstudiodemo · TikTok: @dry_run_demo · Sito web: (nessuno)                                                                        |
| Foto / media                                          | **0 foto fornite** · **0 AI usata come foto vera** · Gallery pubblica + Staff pubblica + Reviews pubbliche = DISABILITATE per design direction minimal elegante invece di fake. ✅ |
| Booking cliente test (DRY E2E)                        | Mario E2E Dry <mario-mega-87k9o3@example.test> · +39 333 000 87K9 (DRY, NON vero)                                                                                                  |
| Numero occorrenze parola **DRY RUN** in questo report | **≥ 30** (controllate) ✅                                                                                                                                                          |

---

## 2. Tenant (DRY RUN)

| Campo                                                                         | Valore (evidenza DB SQL diretto pg driver, non API)                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tenant_id**                                                                 | `69d628f8-6f8f-4674-8914-efcc2db8a519` · [TR-04 F1-D env OK ✅]                                                                                                                                                                                                                                                                                         |
| **slug** pubblico                                                             | `dry-run-studio-3iwem9` ✅                                                                                                                                                                                                                                                                                                                              |
| status                                                                        | active ✅                                                                                                                                                                                                                                                                                                                                               |
| published flag                                                                | true (FASE 1 READ BACK `n_pub=1`) ✅                                                                                                                                                                                                                                                                                                                    |
| design_preset_id                                                              | minimal (7 preset ammessi: minimal · elegant · navy · sand · warm · bold · classic)                                                                                                                                                                                                                                                                     |
| Membership Owner assegnata                                                    | SUPER_ADMIN `9df5232e-2303-4a6f-b643-f2386ac92ec1` con ruolo `owner` (create_dry_run `owner SA role: owner ✅`)                                                                                                                                                                                                                                         |
| business_profiles theme                                                       | Navy embed, Inter font, radius=lg, hero gradient CTA Prenota                                                                                                                                                                                                                                                                                            |
| Contenuti demo                                                                | tutti etichettati DRY RUN in title/H1/subhead/footer. Badge ⚠️ DEMO visibile.                                                                                                                                                                                                                                                                           |
| Tabelle popolate (≥9, READ BACK F1-RB ✅ svc=2 staff=1 bh=7 rh=7 sec=8 pub=1) | `tenants`, `tenant_memberships`, `business_profiles`, `tenant_bank_accounts`, **`services` (2)**, **`staff_resources` (1)**, `staff_resource_services` (2), **`business_availability` (7)**, **`resource_availability` (7)**, `site_sections` (8), **`site_publication_versions` v1 status=published**, `bookings`=0 (fallimento validation, sezione 6) |
| Cross-tenant invariance Tonino                                                | `slugo-mtu30v76-1fon` servizi=9 invariato dopo create_dry_run ✅ · non contaminazione ✅                                                                                                                                                                                                                                                                |
| bookings Mario Dry ultimi 3 minuti CROSS tenant leak                          | **COUNT = 0** · [RB-10 TR-31 ✅] — regola 6 RLS OK                                                                                                                                                                                                                                                                                                      |

---

## 3. Dominio / URL (DRY RUN locale ONLY)

⚠️ **0 DNS, 0 HTTPS, 0 dominio cliente, 0 raggiungibilità Internet.** Solo localhost HTTP :3000. (Motivo 2 VERDETTO NO).

| Tipo                                                       | URL                                                                                             | Stato HTTP                                                                    | Match body                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Temporary DRY HOME locale                                  | `http://localhost:3000/s/dry-run-studio-3iwem9`                                                 | **200** ✅ FASE2 TR-08                                                        | ✅ contiene "DRY RUN STUDIO" (Fase 2 OK; Fase 5 post-reset DB build lunga=match=false) |
| Temporary DRY BOOKING locale                               | `http://localhost:3000/s/dry-run-studio-3iwem9/booking`                                         | **200** ✅ FASE2 TR-09 · FASE5 TR-41                                          | ✅ match "Prenota" in entrambi                                                         |
| Temporary DRY SLOTS API GET (Fase2 / Fase5)                | `/s/dry-run-studio-3iwem9/booking/slots?service_id=0d9cc276-&date=2026-09-14&resource_slug=any` | **200** ✅ FASE2 TR-10 / 404 ❌ FASE5 TR-44 (DB reset post build)             | ✅ JSON slot time labels `09:00 … 17:30` (35) / ❌ post reset                          |
| DRY Privacy Cookie Policy                                  | `/s/dry-run-studio-3iwem9/privacy-policy` · `/cookie-policy`                                    | **200** ✅ TR-42 · TR-43                                                      | ✅ Privacy/GDPR match                                                                  |
| ROOT + LOGIN Velora                                        | `http://localhost:3000/` · `/login`                                                             | **200** ✅ TR-45 · TR-46                                                      | ✅ match /Accedi·Entra·Velora·Booking/                                                 |
| Tonino GOLDEN cross check HOME/BOOKING                     | `/s/slugo-mtu30v76-1fon` · `/booking`                                                           | **200** ✅ F2 TR-11 TR-12 / F5 BOOKING ✅ TR-48 · HOME post-reset match=false | ✅ FASE2 Tonino/Prenota / ❌ F5 HOME Tonino post reset                                 |
| **Dominio custom cliente REALE (es. `www.mio-salone.it`)** | NON CONFIGURATO — DRY RUN senza dominio cliente                                                 | ❌ MANCANTE BLOCCANTE LIVE YES                                                |                                                                                        |
| DNS apex + www, redirect canonicale, HTTPS TLS valid       | NON ESEGUITI locale HTTP plaintext                                                              | ❌ MANCANTE BLOCCANTE LIVE YES                                                |                                                                                        |
| URL Internet HTTPS raggiungibile da IP pubblico            | ❌ ❌ ❌ Solo loopback localhost 127.0.0.1:3000                                                 | ❌ BLOCCANTE LIVE YES                                                         |                                                                                        |

---

## 4. Design direction (DRY RUN — minimal + Navy)

| Item                                                           | Scelta applicata in `business_profiles.theme_*` + `site_sections` (8 abilitate)                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preset base Velora                                             | **minimal** · fra 7 preset ammessi (minimal, elegant, navy, sand, warm, bold, classic)                                                                                                                                                                                                                                                 |
| Palette                                                        | theme_primary=Navy (#1e3a8a) · theme_secondary=Indigo light · accent=White                                                                                                                                                                                                                                                             |
| Tipografia                                                     | heading_font=Inter · body_font=Inter (font preset embed)                                                                                                                                                                                                                                                                               |
| radius_border                                                  | lg (8-12px)                                                                                                                                                                                                                                                                                                                            |
| Hero (PRINCIPALE)                                              | strategy: gradient full. Title: "DRY RUN STUDIO — NON UN CLIENTE VERO". Subhead specifica "Placeholder dimostrativo Velora DRY RUN · Prenota il tuo servizio di prova con bonifico V1". CTA primaria: **Prenota ora** → `/s/dry-run-studio-3iwem9/booking`. CTA secondaria "Torna indietro" sulla pagina booking. Badge DEMO ⚠️ fisso. |
| Navbar tipo                                                    | sticky. Link: Home · Servizi · Orari · Contatti · Prenota. Logo = testo "DRY RUN STUDIO".                                                                                                                                                                                                                                              |
| Services layout                                                | cards 2 colonne mobile 1. Senza foto, minimal. Tariffe visualizzate a destra. 0 foto → design direction minimal elegante rispettata. ✅ (Regola 2 rispettata: zero foto/AI come reali)                                                                                                                                                 |
| Gallery pubblica                                               | **⚠️ SEZIONE DISABILITATA** (site_sections.gallery.enabled=false) per 0 foto cliente; nessun placeholder/fixture/AI foto.                                                                                                                                                                                                              |
| Staff pubblica                                                 | **⚠️ DISABILITATO** (enabled=false) per 0 foto staff; nome "Operatore Dry" usato solo internamente booking; nessuna foto staff inventata. ✅                                                                                                                                                                                           |
| Reviews pubblica                                               | **⚠️ DISABILITATO** (enabled=false); 0 recensioni inventate; nessun fixture 5 stelle. ✅                                                                                                                                                                                                                                               |
| Orari pubblica · Hours                                         | **ENABLED** · Lun–Ven 09:00–18:00 · Sab 09:00–13:00 · Dom CHIUSO · 7 business_availability ✅                                                                                                                                                                                                                                          |
| Contact / Location pubblica                                    | **ENABLED** · Mappa Leaflet/OpenStreetMap Roma 41.90/12.49 · Indirizzo DRY · Telefono demo · WhatsApp demo CTA · Email demo · Modulo contatto disabilitato (email non config).                                                                                                                                                         |
| Booking Widget pubblica                                        | **ENABLED** nel content-engine; path booking separato raggiungibile da CTA Hero e navbar Prenota.                                                                                                                                                                                                                                      |
| Footer Copyright                                               | **© 2026 DRY RUN STUDIO — Placeholder Velora · NON UN CLIENTE VERO · DRY RUN.** Link legali Privacy · Cookie.                                                                                                                                                                                                                          |
| Sezioni site_sections abilitate count = 8 (F1-RB `n_sec=8` ✅) | `navbar, hero, about, services, hours, booking_widget, contact, footer` — deterministico.                                                                                                                                                                                                                                              |

---

## 5. Servizi & prezzi (DRY RUN — NON tariffario vero)

| Servizio (services.name)                                     | slug                                                                                                           | duration_minutes | price EUR | deposit_amount | deposit_strategy                                 | payment_mode          | currency | Staff assegnato (staff_resource_services) |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------: | --------: | -------------: | ------------------------------------------------ | --------------------- | -------- | ----------------------------------------- |
| Taglio base                                                  | taglio-base                                                                                                    |           30 min |     25,00 |         € 0,00 | **NONE (bonifico bancario manuale V1)**          | offline_bank_transfer | EUR      | Operatore Dry ✅                          |
| Piega                                                        | piega                                                                                                          |           45 min |     35,00 |         € 0,00 | **NONE (bonifico bancario manuale V1)**          | offline_bank_transfer | EUR      | Operatore Dry ✅                          |
| **Operatore Dry staff bookable**                             | `operatore-dry-<rand>`                                                                                         |                  |           |                | bookable_online=true                             |                       |          | 2 services JOIN ✅                        |
| Orari bookable (business + resource availability = 7+7 rows) |                                                                                                                |                  |           |                | Lun–Ven 09:00–18:00, Sab 09:00–13:00, Dom closed |                       |          | ✅ F1-RB `bh=7 rh=7`                      |
| Modalità prenotazione                                        | **Prenotazione online immediata + bonifico bancario manuale V1.** Nessun Stripe (divieto assoluto rispettato). |

---

## 6. Booking status & E2E Playwright UI → DB READ BACK 0 FAKE (DRY RUN)

### 6a. Flussi UI Playwright (Chromium headless 1440×900)

Evidenze reali da `artifacts/mega_run_fixed_2.log` sezione [FASE 3 Playwright booking UI Chromium headless E2E] + screenshots `artifacts/mega-run/screenshots/bXX_*.png`.

| Step ID | Descrizione                                                                                                                                                                                                                                                                             |          Esito           | Evidenza concreta                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------: | ------------------------------------------------------------------------------------------ |
| B1      | HOME DRY HTTP 200 Playwright                                                                                                                                                                                                                                                            |         ✅ PASS          | `HTTP=200` · [TR-13]                                                                       |
| B2      | CTA "Prenota ora" clickable count>0                                                                                                                                                                                                                                                     |         ✅ PASS          | count>0 · [TR-14]                                                                          |
| B3      | Click CTA → navigate `/booking?_csrf=…`                                                                                                                                                                                                                                                 |         ✅ PASS          | URL regex match `/booking` · [TR-15]                                                       |
| B4      | Seleziona servizio "Taglio base" (`select#service.value = UUID`)                                                                                                                                                                                                                        |         ✅ PASS          | UUID match `0d9cc276-22a1…` · [TR-16]                                                      |
| B5      | Click primo slot disponibile **09:00** (14 SET 2026 Lun.)                                                                                                                                                                                                                               |         ✅ PASS          | `slot_label=09:00` · 35 slot buttons trovati · [TR-17]                                     |
| B6      | Input hidden `starts_at` ISO valorizzato 2026-09-14                                                                                                                                                                                                                                     |         ✅ PASS          | `2026-09-14T07:00:00.000Z` (Europe/Rome +2h) · [TR-18]                                     |
| B7      | Workaround apply: **JS evaluate force** hidden inputs `resource_slug="any"`, `service_id=<UUID>` + fill customer name/email/phone/notes → after fill check: `name=Mario E2E Dry email=mario-mega-87k9o3@example.test rs=any sid=0d9cc276-22a1`                                          |       ✅ PASS DOM        | After fill check verified nel log. [TR-19]                                                 |
| B8      | Checkbox privacy checked (GDPR art.13)                                                                                                                                                                                                                                                  |         ✅ PASS          | `privacy=true` · [TR-20]                                                                   |
| B9      | Submit POST Server Action `Conferma prenotazione` → HTTP 200. POST page body snippet 900c: **"Riepilogo Taglio base 30 min 09:00 Prezzo 25.00 EUR — Completa correttamente tutti i campi obbligatori. codice: validation_error. Almeno un contatto tra email e telefono è richiesto."** | ❌ FAIL validation_error | HTTP=200 `err=true succ=true` (testo errore visibile ma riepilogo OK anche) · [TR-21 FAIL] |

### 6b. Root cause del fallimento B9 (NOTATO COME PROBLEMA RESIDUO #2)

`after fill check DOM OK` ma `Server Action zod validation fallisce con "Almeno un contatto tra email e telefono è richiesto"` nonostante input DOM email contenga il valore. **Causa diagnosticata concreta:** `BookingClientForm.tsx` usa React Controlled Component state interno (non HTML native form fields) per `customer_email, customer_phone, customer_name, notes`. Il Playwright `page.fill()` + JS evaluate imposta il valore DOM ma NON dispatcha eventi React `onChange/onInput` verso lo state interno. Il Server Action legge formData da React state e riceve **stringhe vuote** per email/phone → check "almeno un contatto" fallisce → ZOD schema validation_error → booking NON inserita.

### 6c. READ BACK DB bookings (FASE 3b SQL diretto pg driver, NON API)

| RB ID         | Controllo                                                                                                                                                         |       Esito        | Evidenza SQL `SELECT ... FROM bookings b LEFT JOIN services ... WHERE tenant_id=69d6… AND customer_email='mario-mega-87k9o3@example.test' ORDER BY created_at DESC LIMIT 1` |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RB-1          | Booking presente 1 riga in DB                                                                                                                                     |  ❌ FAIL COUNT 0   | `(nessuna riga)` · [TR-22 FAIL]                                                                                                                                             |
| RB-2 → RB-9   | tenant=DRY / service=Taglio base / customer Mario / 14-09 / payment unpaid / price €25 / 30m                                                                      |      ❌ FAIL       | Non eseguibili per COUNT 0 · RB2-RB9 tutti FAIL TR-23..TR-30                                                                                                                |
| RB-10         | Cross-tenant leak Mario Dry ultimi 3 minuti = 0 (SQL `WHERE customer_email=... AND tenant_id<>... AND created_at > now() - interval '3 minutes'`)                 | ✅ **PASS 0 leak** | `leak_n=0` · [TR-31 PASS] ✅                                                                                                                                                |
| RB-11 → RB-14 | Toggle pagato manuale UPDATE → `payment_status=deposit_paid, deposit_confirmed_by=SA_USER_ID, deposit_payment_method='bank_transfer'` → READ BACK deposit_paid_at | ⚠️ NON ESEGUIBILI  | booking non esiste RB1=0; non si può toggle su riga inesistente.                                                                                                            |

> **Nota bonifico V1 capability toggle esistente (capability UI già esistente in Velora NON modificata)**:  
> Server Actions `markDepositPaidAction / markDepositUnpaidAction` in [src/app/app/bookings/actions.ts](file:///c:/Users/david/Documents/trae_projects/VELORA/src/app/app/bookings/actions.ts) + UI bottoni "Segna pagato" in [BookingsListClient.tsx](file:///c:/Users/david/Documents/trae_projects/VELORA/src/app/app/bookings/BookingsListClient.tsx). Per LIVE YES: dopo fix React state sync booking create → 1 click in backoffice Owner/Manager conferma bonifico ricevuto.
> **Trigger esistenti booking safety (non modificati)**: `bookings_delete_denied` append-only + GiST EXCLUSION anti-overlap `WITH overlap` (REGOLA 2 non toccare verdi ✅ rispettata).

---

## 7. Modalità pagamento (DRY RUN)

| Item                                                           | Stato                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DIVIETO ASSOLUTO STRIPE (Reg. progetto)**                    | ✅ **TOTALMENTE RISPETTATO ZERO FAKE** · 0 variabili Stripe env · 0 webhook · 0 SDK stripe installato · 0 API key. Non toccato. ✅                                                                                                                                                 |
| **Canale pagamento DRY RUN cliente**                           | **Bonifico bancario manuale V1** · IBAN DRY `IT00 0000 ...`                                                                                                                                                                                                                        |
| Status booking SUBITO DOPO create (fix React state avvenisse)  | `status = confirmed` · `payment_status = unpaid` (caparra non pagata) · `deposit_strategy = NONE`                                                                                                                                                                                  |
| Backoffice distingue PAGATO / NON PAGATO                       | ✅ Badge esistenti map stati: `unpaid → IN ATTESA CAPARRA · deposit_pending_bank → BONIFICO IN ATTESA · deposit_paid → ✅ CAPARRA PAGATA · paid → SALDATA`. Nessuna modifica UI verde. ✅                                                                                          |
| Toggle pagato / non pagato manuale (esistente, non modificato) | ✅ Server Action esistenti. Stato backend: `UPDATE bookings SET payment_status='deposit_paid', deposit_paid_at=now(), deposit_confirmed_by='<OWNER/SA UUID>', deposit_payment_method='bank_transfer', deposit_payment_ref='MEGA-DRY-<rand>'`. Non modificato, solo documentato. ✅ |

---

## 8. SEO / Lighthouse (LOCALE DRY; produzione HTTPS NON deployata)

⚠️ **Target SEO ≥ 90 NON DICHIARATO RAGGIUNTO in dev Turbopack SSR hydration.**
Storico Gate FC _Precedente_ Lighthouse Chrome build prod reale 6 rotte = SEO 91 / A11y 100 / Perf 93-100. **Live YES dovrà riconfermare ≥90 con URL HTTPS Internet.**

Check eseguiti LOCALE HTTP Turbopack dev SSR (next dev su :3000, post build lunga):

| Check SEO locale home DRY                                          | Risultato                                                 | Note / fallback                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`                                                          | ✅ NON VUOTO                                              | Valore post-reset = "Sito non disponibile" (DB reset intermittente dopo build lunga) · Atteso LIVE YES = "<Nome attività> a <Città>            | Prenota Online" |
| `<meta name=description>` length                                   | ❌ 38 char < 50 min                                       | "Sito non disponibile al momento" (reset DB). LIVE YES ≥ 100 char.                                                                             |
| `<link rel=canonical>`                                             | ⚠️ ASSENTE in dev SSR                                     | Route metadata `generateMetadata` per [slug] esistente; atteso build Full produzione popolato. Annotato in problemi residui.                   |
| `<meta name=robots>`                                               | `noindex` (causa reset DB "Sito non disponibile")         | Default LIVE YES index,follow.                                                                                                                 |
| `<script type=application/ld+json>` JSON-LD                        | ❌ LEN = 0 MANCANTE.                                      | **Aggiungere LocalBusiness subtype in content-engine PRIMA LIVE YES.** Gate FC storico JSON-LD LocalBusiness dichiarato esistente; verificare. |
| H1 count / H2 count                                                | ❌ H1=0 H2=0 post reset DB                                | Atteso H1 unico LIVE YES.                                                                                                                      |
| OpenGraph (og:title, og:image, og:url, og:type website)            | ⚠️ NON VERIFICATO URL HTTPS.                              | Esistente in metadata.                                                                                                                         |
| sitemap.xml, robots.txt                                            | ❌ NON VERIFICATO URL HTTPS.                              | Esistenti in app routes.                                                                                                                       |
| **Lighthouse HTTP pubblico HTTPS dominio cliente reale**           | ❌ NON ESEGUIBILE · VERCEL_TOKEN missing + 0 DNS dominio. | Bloccante LIVE YES                                                                                                                             |
| Target Lighthouse SEO ≥90 produzione HTTPS                         | ⚠️ NON VERIFICATO                                         | Target ≥90 SEO · ≥90 A11y · ≥80 Performance LIVE YES                                                                                           |
| LocalBusiness subtype JSON-LD corretto (HairSalon/BeautySalon/...) | ❌ NON VERIFICATO SENZA JSON-LD in questa run             | LIVE YES controllo essenziale.                                                                                                                 |

---

## 9. Mobile QA (DRY RUN)

| Item mobile                                                              | Risultato                                                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| HOME / BOOKING DRY 1440×900 desktop Playwright (questa run)              | ✅ HTTP 200 · CTA Prenota · 35 slot buttons trovati · 09:00 cliccabile · campi form cliente visibili                                |
| Mobile 360 · iPhone 390 · iPad 768 × 4 viewport T2 PRE Gate FC (storico) | ✅ **8/8 PASS** · Badge DEMO DRY RUN visibile in tutti e 4 · 0 overflow involontario · 0 bottoni irraggiungibili · 0 testo tagliato |
| Primo LIVE YES QA obbligatorio                                           | 12+ rotte × 4 viewport (Home/Services/Hours/Staff/Contact/Privacy/Cookie/Booking/Booking confirmation/ThankYou/Backoffice/Login)    |

---

## 10. Security QA (DRY RUN 0 FAKE)

| Controllo sicurezza                                                       | Esito 0 FAKE         | Evidenza                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant leak Mario bookings ultimi 3 min = 0                         | ✅ PASS              | RB-10 SQL count=0 · TR-31                                                                                                                                                                                                                     |
| Cross-tenant invariance Tonino n. servizi=9 invariato POST create_dry_run | ✅ PASS              | TR-05 F1-E                                                                                                                                                                                                                                    |
| **Vitest multi-tenant-rls SUPABASE_PROJECT_ID=velora-local**              | ✅ **49/49 PASS** 🟢 | TR-38 R `Tests 49 passed` · (anon + auth impersonation, cross deny, privilege escalation denied PA1/E1-E8, last owner invariant L1-L3, append-only audit AU1-AU3, settings runtime S1-S6, platform admin P1-P3, structural constraints C1-C6) |
| **Vitest section-engine (pure content-engine + validators)**              | ✅ **23/23 PASS** 🟢 | TR-37 R `Tests 23 passed` · (Zod schemas sections, helpers normalizzazione link sicuri, deterministic empty state NO hardcoded reviews/foto, CTA safety javascript: BLOCKED, color font radius validators)                                    |
| **BOOKING safety triggers (verdi, NON toccati)**                          | ✅ Esistenti Gate FC | GiST EXCLUSION overlap su staff/resource+time · `bookings_delete_denied` append-only · RLS enabled `tenants, services, staff_resources, bookings, tenant_memberships, business_profiles, site_sections, tenant_bank_accounts`                 |
| Client-side secrets leak check (`NEXT_PUBLIC_*`)                          | ✅ OK                | Solo URL anon Supabase + anon key. SENTRY/STRIPE/VERCEL/SERVICE_ROLE/PASSWORD = tutti MISSING server side ✅                                                                                                                                  |
| IDOR cross bookings Mario                                                 | ✅ 0 leak            | RB-10                                                                                                                                                                                                                                         |
| HIGH / CRITICAL noti aperti (dopo analisi statica)                        | 0 ✅                 |                                                                                                                                                                                                                                               |

---

## 11. Deployment (DRY RUN — LOCALE next dev + next build PASS)

| Item                                                                       | Stato                                                                                                                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm tsc --noEmit -p tsconfig.json` TypeScript typecheck                  | ✅ exit 0 · TR-34                                                                                                                        | Nessun errore TS.                                                                 |
| `pnpm eslint src tests --ext .ts,.tsx,.mjs,.cjs,.js --max-warnings=0` lint | ✅ exit 0 · TR-35                                                                                                                        | scripts/mega_script_dry_run.mjs è /* eslint-disable */ come richiesto in passato. |
| `pnpm build` produzione Next 16 Turbopack Full                             | ✅ exit 0 · TR-36                                                                                                                        | Pages generated OK. build PASS. ✅                                                |
| NEXT_PUBLIC_SUPABASE_URL corrente                                          | `http://127.0.0.1:54321` locale (ok DRY RUN). **⚠️ LIVE YES: sostituire con URL anon Supabase Cloud + dominio HTTPS cliente.**           |
| **Deploy Vercel pubblico**                                                 | ❌ **BLOCKED** `process.env.VERCEL_TOKEN = empty/MISSING` + 0 progetto Vercel linkato + 0 dominio cliente.                               |
| Middleware route `hostname → slug tenant`                                  | ✅ Codice esistente. NON testato senza DNS dominio reale.                                                                                |
| Storage media RLS bucket                                                   | ⚠️ Workaround locale `public/media-demo` next static. 0 foto in questa run. LIVE YES bucket RLS prefix `tenant/<tenant_id>/` path e RLS. |
| NEXT_PUBLIC_SITE_URL                                                       | ⚠️ atteso LIVE YES = `https://<dominio-cliente-vero>`                                                                                    |

---

## 12. DNS / SSL (DRY RUN — BLOCCATO)

| Item                                                                      | Stato                                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Dominio apex cliente vero (es. `mio-salone.it`)                           | ❌ Non esiste (DRY RUN senza cliente reale). BLOCCANTE LIVE YES. |
| `www.` subdomain dominio                                                  | ❌ Non esiste                                                    |
| Redirect canonicale 1 soltanto (apex → www o viceversa, no ambedue)       | ❌ Non eseguito                                                  |
| HTTPS TLS certificato valido (no self-signed, no expired)                 | ❌ Locale HTTP plaintext :3000. BLOCCANTE.                       |
| Mixed content (HTTP assets dentro HTTPS page)                             | ⚠️ Controllare a deploy LIVE YES dopo SSL.                       |
| Route middleware hostname → slug TENANT corretto                          | ❌ Non testabile senza DNS.                                      |
| Reachability Internet HTTP 200 da IP pubblico (es. curl da server remoto) | ❌ ❌ ❌ Solo localhost loopback.                                |

---

## 13. Osservabilità minima PRIMA cliente LIVE YES (DRY RUN)

| Item osservabilità                                               | Stato (DRY RUN)                                                                                                   | Cosa fare PRIMA cliente LIVE YES                                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_logs` tabella public PostgreSQL EXISTS                    | ✅ **TRUE** · TR-32 O1 `audit_exists=true` ✅                                                                     | (OK)                                                                                                                                                     |
| Trigger audit_logs append-only + history hstore (AU1-AU3 vitest) | ✅ 49/49 PASS vitest ✅                                                                                           | (OK)                                                                                                                                                     |
| **Sentry Error Monitoring client.ts + server.ts**                | ❌ MISSING. `SENTRY_DSN = <empty>` TR-33 O2. Fallback: `audit_logs` + Next server stdout + pg logs locale Docker. | **MANDATORIO INSTALLARE + CONFIGURARE SENTRY DSN PRIMA LIVE YES.** Alert booking failures, publish failures, 5xx, uncaught exceptions. Rate limit PII 0. |
| Alerting BOOKING failures                                        | ⚠️ Solo audit_logs. Nessun alert attivo.                                                                          | Sentry alerts + webhook Slack/email.                                                                                                                     |
| Alerting PUBLISH site failures                                   | ⚠️ Solo Next server logs + audit                                                                                  | Sentry alerts                                                                                                                                            |
| Runtime Next.js / unhandled rejections / 5xx                     | ⚠️ Solo Next server logs locale Docker                                                                            | Sentry                                                                                                                                                   |
| PII e secret logging                                             | ✅ 0 secret o PII non necessaria loggata                                                                          | (OK, mantenere)                                                                                                                                          |
| **Backup Supabase pg_dump settimanale + restore testato**        | ❌ NON FATTO                                                                                                      | MANDATORIO PRIMA LIVE YES. Cloud PITR abilitato se Supabase Cloud.                                                                                       |

---

## 14. Problemi residui (NON bloccanti per DRY VERDICT=NO dato che i 3 motivi VERDETTO sono molto più bloccanti; OBBLIGATORI PRIMA LIVE YES)

1. **UI Booking — React state non sync DOM → Server Action**: `page.fill()` + evaluate settano valore DOM ma BookingClientForm è React Controlled; eventi onChange/onInput interni non scattano → Server Action riceve stringhe vuote customer_email/customer_phone → validation "Almeno un contatto è richiesto". → **Fix produzione (LIVE YES prereq)**: BookingClientForm.tsx sync esplicita DOM events → React state, oppure useRef + form nativa, oppure test Playwright aggiunga `dispatchEvent(new Event('input',{bubbles:true}))` per ogni campo customer dopo fill.
2. **Booking validation_error UI**: campi `resource_slug` e `service_id` hidden NON sempre propagati dopo click slot in tutte le condizioni. → workaround evaluate mega script (già applicato nel mega; **Fix LIVE**: BookingClientForm garantisca hidden inputs dopo selezione servizio + click slot).
3. **DB reset intermittente Supabase Docker locale dopo ~2 minuti (build lunga next build)**. Evidenze: FASE1 OK + FASE2 HTTP 200 tutti match ✅ → dopo build 3-4 minuti FASE5 HOME DRY/Tonino match=false, title="Sito non disponibile", SLOTS 404, SEO title reset, H1=0, booking_e2e Tonino rows[0].id undefined. → **Fix LIVE**: deploy Supabase Cloud storage persistente non locale Docker. Investigare locale se si ripresenta (trigger role reset, pg volume non bind).
4. **3 Golden tenants = solo Tonino creato dopo ensure_three_tenants; Luca + Giulia mancano** (ensure 3/3 fallisce 2/3). Non bloccante DRY ma parity design direction NON coperto LIVE. → Ripristinare 3/3.
5. **Deploy BLOCKED**: VERCEL_TOKEN empty, 0 progetto Vercel linkato, 0 dominio cliente DNS. → Prerequisito LIVE YES.
6. **SEO PRODUZIONE HTTPS non validato**: Lighthouse ≥90, JSON-LD LocalBusiness subtype corretto, sitemap.xml robots.txt canonical H1 unico. → Verificare URL HTTPS Internet vero.
7. **booking_e2e Tonino API 15/15 crash intermittenza DB reset (vedi #3)**. Quando Tonino presente = PASS storico 15/15.
8. **Sentry error tracking MISSING (vedi Osservabilità)**. → MANDATORIO.
9. **NEXT_PUBLIC_SUPABASE_URL hardcoded locale 127.0.0.1:54321** in .env.local. → Sostituire deploy prod con Supabase Cloud anon HTTPS URL.
10. **JSON-LD LocalBusiness MISSING (SEO FASE5 len=0)**. → Aggiungere in content-engine PRIMA LIVE YES.
11. **Canonical link <link rel=canonical> missing in dev SSR** (deve esserci build prod; verificare).

---

## 15. Istruzioni operative (prossimo cliente **LIVE VERO YES**, passo passo)

1. **Dati REALI cliente workflow**: Workflow Velora create tenant (NON DRY RUN, NO placeholder). Nome attività/P.IVA/indirizzo reale/IBAN bonifico vero/telefono+WhatsApp reali/email pubblica vera.
2. **Foto REALI + autorizzate cliente**: Upload bucket Supabase path `/tenant/<tenant_id>/<section>/<filename>` · RLS prefix. NO foto AI come foto vera locali/staff/lavori · NO recensioni inventate · NO numeri demo.
3. **Env produzione SUPER SICURE**: `NEXT_PUBLIC_SUPABASE_URL` cloud anon. `SUPABASE_ANON_KEY` cloud anon. `SENTRY_DSN` creato. `VERCEL_TOKEN` link progetto. `NEXT_PUBLIC_SITE_URL=https://<dominio-cliente-vero>`. `NEXT_PUBLIC_PLAN_LOCK` no. ZERO secret in NEXT_PUBLIC.
4. **Dominio cliente DNS reale**: apex (`mio-salone.it`) A record + CNAME www → Vercel/Edge. Provisioning SSL Vercel automatico. Redirect canonicale 1 (es. apex → www). Verifica reachability curl pubblico HTTPS 200 redirect.
5. **Booking E2E UI Playwright HTTPS LIVE**: 4 viewport (360 / 390 / 768 / 1440) × rotte (Home / Services / Hours / Contact / Booking / ThankYou). Submit singola → READ BACK DB _subito_ → cross tenant leak=0. Broken links 0.
6. **SEO produzione Lighthouse HTTPS pubblico**: SEO ≥90, A11y ≥90, Perf ≥80. H1 unico. JSON-LD LocalBusiness subtype = HairSalon / BeautySalon / HealthAndBeautyBusiness corretto. Canonical + OpenGraph + sitemap.xml + robots.txt INDEX FOLLOW.
7. **Bonifico V1 operativo Backoffice Owner**: Assegna ruolo OWNER a email cliente reale. Test login. Verifica visibility booking filter tenant_id. Toggle "Segna pagato" cliccabile dopo bonifico ricevuto.
8. **Observability LIVE**: Sentry client.ts + server.ts configurati. Alerting: 5xx, booking create failures, publish errors, uncaught exceptions. Retention audit logs >30 giorni.
9. **Backup**: pg_dump manuale + restore testato eseguito ✅. Supabase Cloud PITR >7 giorni abilitato.
10. **QA FINALE LIVE desktop+mobile**: homepage, services, gallery, staff (se presente foto), location, contact, booking, thank you, broken links, media HTTP 2xx, no mixed content, no 404, no console errori browser.

---

# 🔴 **LIVE CLIENT READY = NO**

## Motivo 1: Nessun cliente reale (DRY RUN / placeholder)

**Tutti i dati del tenant sono placeholder etichettati DRY RUN**: 0 PII cliente vero · 0 foto autorizzate reali · 0 IBAN vero conto cliente · 0 telefono cliente vero · 0 indirizzo cliente vero · 0 servizi/prezzi cliente vero · 0 ragione sociale vera. La parola **DRY RUN** appare in questo report **≥ 30 volte**. Placeholder demo NON è un cliente pagante LIVE.

## Motivo 2: Nessuna foto / media reale fornita / autorizzata

0 foto locali, 0 foto staff, 0 foto lavori cliente. Gallery pubblica + Staff pubblica + Reviews pubbliche = FORZATAMENTE DISABILITATE per design direction per NON usare contenuti falsi. Regola 2 rispettata ma LIVE YES richiede foto reali cliente o esplicita scelta vuota.

## Motivo 3: Nessun dominio pubblico HTTPS raggiungibile da Internet

URL solo `http://localhost:3000/s/dry-run-studio-3iwem9` (HTTP plaintext loopback). 0 DNS apex/www, 0 SSL/TLS certificato browser-trusted, 0 deploy Vercel pubblico (VERCEL_TOKEN missing), 0 redirect canonicale. Nessun browser/cliente esterno può raggiungere il sito. LIVE YES impossibile.

---

**Report scritto manualmente dopo crash mega script FASE 6 ReferenceError self-var; TUTTE le evidenze derivano da log artifacts reali 0 FAKE (`artifacts/mega_run_fixed_2.log`, screenshots Playwright, SQL diretto pg driver Node.js).**

- 55 TR eseguiti · 36 PASS / 19 FAIL / 3 WARN
- Regressioni baseline Gate verdi: typecheck ✅ / lint ✅ / build ✅ / vitest section-engine 23/23 ✅ / vitest multi-tenant-rls 49/49 ✅ / audit_logs EXISTS ✅
- Fallimenti booking/QA URLs/SEO tutti riconducibili a: (a) React Controlled state non sync Playwright fill, (b) DB reset intermittente post build Docker, (c) REPORT template self-reference crash. Nessun componente GATE verde modificato in questa fase. ✅
