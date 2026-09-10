# VELORA — ARCHITECTURE DECISIONS (ADR leggere)

## ADR-001 — Prodotto PRIVATO OPERATOR-MANAGED vs SaaS Pubblico
- **Data**: 2026-09-09 (iniziale, conferma mandato 25-fasi)
- **Contesto**: L'utente vuole usare VELORA internamente per servire clienti paganti.
- **Decisione**: VELORA rimane PRIVATO. Nessun self-service signup pubblico. Solo siti pubblici finali e booking sono raggiungibili da utenti finali; backoffice solo operatori autenticati.
- **Alternative considerate**: SaaS pubblico self-service (rifiutato).
- **Motivazione**: Controllo qualità, sicurezza, prezzi premium, onboarding bianco-glove senza frodi.
- **Conseguenze**: tutte le pagine /app/* o /admin/* sono protette; nessun route `/signup` pubblico; SUPER_ADMIN e INVITI only.

---

## ADR-002 — NEXT16 APP ROUTER + TS STRICT + SUPABASE POSTGRES (stack bloccato)
- **Data**: 2026 (storico) + 2026-09-09 conferma.
- **Decisione**: Stack bloccato Next16 App Router, React19, TS strict (no any/ts-ignore), Supabase (Postgres+RLS+RPC+Auth).
- **Motivazione**: Ecosistema esistente, RLS nativo, RPC PostgreSQL per booking/concurrency, Route Handlers Next.
- **Conseguenze**: Nessun refactor stack senza dimostrazione + approvazione.

---

## ADR-003 — Multi-Tenancy: singolo DB singolo schema, tenant_id + RLS (separazione logica)
- **Data**: storico.
- **Decisione**: Unico cluster PostgreSQL; ogni tabella public ha `tenant_id`; RLS; FORCE RLS su sensibili; RPC filtrano per `p_tenant_id` server-side; **MAI fidarsi di tenant_id dal client**.
- **Alternative considerate**: 1 DB per cliente (costi, complessità, migrazioni) — rifiutato. Schema per cliente (rifiutato).
- **Conseguenze**: Indici su `(tenant_id, ...)`; E2E cross-tenant obbligatori.

---

## ADR-004 — Booking Slot Concurrency: PostgreSQL EXCLUDE USING GiST (non solo frontend)
- **Data**: storico (Fase9/13).
- **Decisione**: Doppia protezione: (a) frontend mostra slot occupati (UX); (b) database vincolo **EXCLUDE USING GIST (resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&)**. (c) RPC transazionale.
- **Motivazione**: Frontend NON è fonte di verità per concorrenza; 2 utenti simultanei devono ricevere "slot occupato" a DB level.
- **Conseguenze**: Race test T22 20 concorrenti PASS; no double-booking garantito.

---

## ADR-005 — Publish Sito: RPC `publish_site_draft` SINGOLA signature 3-arg (uuid,uuid,uuid) DEFAULT NULL
- **Data**: 2026-09-09 (fix RC5).
- **Contesto**: 3 overload RPC createvano errore "function is not unique" in certi contesti Vitest.
- **Decisione**: Una sola firma `publish_site_draft(p_tenant_id uuid, p_expected_revision uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL)`. 0 overload. 1 entry in pg_proc con proargdefaults.
- **Conseguenze**: Niente ambiguity; chiamate 1/2/3 argomenti funzionano tutte.

---

## ADR-006 — Site Title Metadata: root layout stringa semplice (NO title.template globale)
- **Data**: 2026-09-09 (F1.6 fix).
- **Contesto**: Next16 `{ absolute: title }` NON bypassava un template globale (bug/behavior diverso da documentazione). Risultato: siti pubblici leak "| VELORA".
- **Decisione**: `src/app/layout.tsx` → `title: publicEnv.NEXT_PUBLIC_APP_NAME` (sola stringa, NO object con template). Le sottopagine usano `title: { absolute: "..." }` (o default appoggiandosi a stringa semplice root).
- **Conseguenze**: Title leak VELORA risolto; E2E F1.6 VERDE.

---

## ADR-007 — Playwright E2E workers=1 + reuseExistingServer=false + safe guard DB LOCALE ONLY
- **Data**: 2026-09-09.
- **Decisione**: `playwright.config.ts`: workers=1 (seriale, evita race su DB shared locale), reuseExistingServer=false (avvia proprio webServer Next dedicato su 3000). Safe guard E2E: ALLOWED_DB_HOSTS = [127.0.0.1, localhost]; SAFE_PROJECT_IDS = [velora-local, uiekkhgspziozprxulit]. Se mismatch → exit(1).
- **Motivazione**: Evitare che E2E tocchino Supabase cloud dgekfjkuvnofwdwxflms per errore variabili d'ambiente; evitare race E2E su stesso DB.
- **Conseguenze**: 3 flussi E2E 22/22 PASS (0 FAIL).

---

## ADR-008 — Design System: STRUTTURA CONTROLLATA + VARIANTI, NON page-builder libero
- **Data**: 2026-09-09 (da mandato, non ancora implementato UI completa).
- **Decisione**: Site Editor approva contenuti e varianti da lista (enum controllato); nessun drag-and-drop libero tipo Elementor; schema validation; sezioni ordinate; lista sezioni approvate.
- **Motivazione**: Evitare siti rotti, garantire qualità, accessibility, CWV, coerenza visiva.
- **Conseguenze**: SectionRegistry enum, varianti per sezione, ZOD schema o SQL CHECK su snapshot.

---

## ADR-009 — Billing Separato: pagamenti clienti finali vs abbonamento attività
- **Data**: da mandato.
- **Decisione**: Separare in modo rigoroso: (a) `payments`, `deposit_amount`, Stripe PaymentIntent diretti del cliente finale all'attività; (b) `billing_subscriptions`, `billing_webhook_events` = abbonamento B2B attività → Velora. Tabelle separate, Stripe account separato se possibile, webhook separati, audit separati.
- **Motivazione**: Tenere pulita la contabilità; rischio cross-contamination soldi.
- **Conseguenze**: 2 webhook route? (si, /api/billing/stripe/webhook per Velora; eventualmente altra per cliente), 2 set di env keys.

---

## ADR-010 — Spec Mode obbligatorio per cambiamenti sostanziali (25+ fasi)
- **Data**: 2026-09-09 avvio.
- **Decisione**: Uso TRAE-spec-mode per il percorso completo 25 fasi con spec.md/tasks.md/review.md.
- **Motivazione**: 25 fasi, acceptance criteri rigorosi, review gate indipendenti, tracciabilità evidenze, protezione baseline verde.
- **Conseguenze**: Ogni task completato ha TR (rule/rubric) con completion evidence; file status continui aggiornati.

---

## ADR-014: Design tokens ampliati Fase3

**Stato:** `Approvato`
**Data:** 2026-03-21
**Contesto:** Il design system possedeva solo tokens palette/spacing/radius/shadows/typography scale, ma i siti premium richiedono controlli granulari su motion (durata/easing), densità layout, stile sezione/card, stile pulsanti, stile fotografico, larghezza massima contenuto corpo, e peso heading/body.
**Decisione:** Aggiungere 6 dimensioni tokens + 2 layout widths:
- density: compact/default/comfortable → --theme-density-multiplier/padding-section
- motion: none/subtle/default/playful → duration/easing/hoverDuration (--theme-motion-*)
- sectionStyle: card/minimal/striped/raised → data-section-style attr
- buttonStyle: solid/outline/soft/glass/shadow → --theme-button-style
- photographyStyle: warm/cool/mono/vivid/natural → --theme-photography-filter CSS filter
- fontWeightHeading / fontWeightBody: numero peso css
- containerMaxWidth: classe tailwind corrispondente
- bodyMaxWidth: px max larghezza testo
4 preset esistenti (elegant/soft_beauty/barber_strong/minimal) sono stati popolati con valori specifici per ogni nuovo token.
**Conseguenze:** 18 nuove CSS variables iniettate da apply.ts; backward compat spacing nomi vecchi (tight/normal/loose) mappati ai nuovi (compact/default/comfortable) automaticamente.

---

## ADR-015: Section Library Production 20 tipi

**Stato:** `Approvato`
**Data:** 2026-03-21
**Contesto:** La library sezione aveva 10 tipi (hero/about/services/gallery/staff/reviews/contact/price_list/features_cta/booking_widget) insufficienti per siti premium agency-quality. Mancavano navbar, footer, fiducia, orari, FAQ, posizione/mappa, CTA booking/esplicite, contatti social, link legali.
**Decisione:** Estendere SECTION_TYPES a 20 con 10 nuove sezioni: navbar, footer, trust, hours, faq, location, booking_cta, whatsapp_cta, social_links, legal_links. Ogni nuova sezione ha:
- Zod settingsSchema dedicato in SECTION_SETTINGS_SCHEMAS
- Varianti ammesse in SECTION_VARIANTS (20 variants totali allowed: +floating +icons)
- 9 sezioni marcate come singleton (una per sito)
- Tipo TypeScript dedicato incluso in PublicSection union
- Componente React TSX in src/components/site/sections/{Nome}.tsx con ≥2 VARIANTI REALMENTE IMPLEMENTATE (layout differente, non solo classi cosmetiche)
- Renderer mappato in SectionRegistry.tsx → 20 entry complete zero missing
buildDefaultDeterministicSections() aggiornato: navbar sticky 0, hero 1, trust 2, about 3, services/price_list se servizi, hours/staff/gallery/reviews/faq opzionali off-by-default, location, booking_cta split, contact, social_links, legal_links, footer default.
**Conseguenze:** Siti creati con zero configurazione hanno navbar, booking_cta e footer + link legali e social già pronti; operator managed può aggiungere fino a 20 moduli per sito ultra-personalizzato.
