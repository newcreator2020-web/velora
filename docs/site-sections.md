# VELORA — Site Sections Public Engine (FASE 5)

Documentazione ufficiale del motore di rendering pubblico
**tenant-driven / data-driven / type-safe / secure**.

Questo documento **descrive solo ciò che realmente esiste** in FASE 5 frozen.

---

## 1. Obiettivo del sistema

> "Posso creare Tenant A, B, C con contenuti e sezioni diverse SENZA
> scrivere nuovo codice per ciascun cliente, senza contaminazione tra
> tenant, con sicurezza e test reali."

Il public site engine non produce componenti demo.
Produce il **sito pubblico vero** di un tenant:

```
URL pubblico  →  /s/[slug]
                  │
                  ├─ 1. resolvePublicTenant()    ← JOIN tenants+business_profiles
                  │                                (SOURCE OF TRUTH structured)
                  │
                  ├─ 2. resolvePublicSiteContent() ← 2 query in parallelo
                  │     ├─ site_sections ORDER BY position ASC
                  │     └─ services        WHERE active=true ORDER BY position
                  │
                  └─ 3. SectionRegistry.renderSections()
                        ├─ Hero  (singleton, Server Component)
                        ├─ About (singleton, Server Component)
                        ├─ Services / Gallery / Staff / Reviews (multi 0..N)
                        └─ Contact (singleton, Server Component)
```

Tutti i componenti sono **Server Components Next.js RSC**, zero client JS
aggiuntivo per il public renderer.

---

## 2. Content model (7 × Section Types)

### 2.1 `site_sections` table

```sql
  tenant_id        UUID        NOT NULL → FK tenants.id   (RLS isolamento)
  section_type     TEXT        NOT NULL → hero|about|services|gallery|staff|reviews|contact
  enabled          BOOLEAN     NOT NULL DEFAULT true
  "position"       INT         NOT NULL → deterministic ordering
  variant          TEXT        NULL     → split|centered|grid|list|minimal|hero-default
  settings         JSONB       NOT NULL DEFAULT '{}'::jsonb  ← SOLO presentation-only
```

**Singleton invariant (DB)**: `UNIQUE(tenant_id, section_type)` parziale
dove `section_type IN ('hero','about','contact')`. Garantito da indice +
RLS + secondo filtro in-memory (fail-safe anti-corruzione transitoria).

**Deterministic ordering**: `ORDER BY position ASC, section_type ASC`
(tie-break deterministico). `UNIQUE(tenant_id, position)` evita collisioni
di posizione.

### 2.2 `services` table

```sql
  tenant_id        UUID        NOT NULL
  name             TEXT        NOT NULL
  description      TEXT
  price_from       NUMERIC(10,2)   ← structured, NOT JSONB
  duration_minutes INT
  position         INT         NOT NULL
  active           BOOLEAN     NOT NULL DEFAULT true
```

Solo servizi `active=true` entrano nel Public DTO.
Se `COUNT(services) = 0` la sezione **Services viene omessa dal render**.

### 2.3 Staff e Reviews oggi (empty safe)

- **Staff pubblico**: `staff = []` vuoto. **NON USA MAI memberships**.
  Modello dedicato `public_staff_members` verrà introdotto in futuro.
- **Reviews**: `reviews = []` vuoto. **NOMI FAKE MAI ACCETTATI**.
  Modello dedicato `public_reviews` verrà introdotto.

Se `items = 0` le sezioni Gallery/Staff/Reviews ritornano `null`
(omesse dal DOM). Zero contenuti fantoccio.

---

## 3. Source of Truth matrix (Regola §49)

**Nessuna ambiguità. Tutte le fonti sono colonne strutturate.**

| Campo pubblico          | Sorgente DB Structured                                             | Tipo colonna | NOT in JSONB? |
| ----------------------- | ------------------------------------------------------------------ | :----------: | :-----------: |
| `slug`                  | `tenants.slug`                                                     |     TEXT     |      ✅       |
| Pubblicazione attiva    | `tenants.status='active'` AND `tenants.published=true`             |     BOOL     |      ✅       |
| Business name           | `business_profiles.display_name`                                   |     TEXT     |      ✅       |
| Contatti telefono       | `business_profiles.phone`                                          |     TEXT     |      ✅       |
| Contatti email          | `business_profiles.email`                                          |     TEXT     |      ✅       |
| Contatti indirizzo      | `business_profiles.address/city/province/postal_code/country_code` |    ×TEXT×    |      ✅       |
| Locale / timezone       | `business_profiles.locale/timezone`                                |     TEXT     |      ✅       |
| Tema primary/…/radius   | `business_profiles.theme_primary / theme_*` ×7 colonne             |     TEXT     |      ✅       |
| Elenco sezioni / ordine | `site_sections.position ASC` + `enabled`                           |   INT+BOOL   |      ✅       |
| Section variant         | `site_sections.variant`                                            |     TEXT     |      ✅       |
| Section visual copy     | `site_sections.settings JSONB`                                     |    JSONB     |      ❌       |
| Services list           | `services.active=true ORDER BY position`                           |  Structured  |      ✅       |
| Service price           | `services.price_from NUMERIC(10,2)`                                |   NUMERIC    |      ✅       |
| Staff pubblico          | `[]` oggi. Modello futuro (NO memberships)                         |      —       |      ✅       |
| Reviews                 | `[]` oggi. Modello futuro (NO fake)                                |      —       |      ✅       |

---

## 4. Section Registry type-safe

### 4.1 Interfaccia pubblica (consumer)

```ts
// src/lib/server/site-engine.ts
export type PublicSection =
  | HeroSectionData
  | AboutSectionData
  | ServicesSectionData
  | GallerySectionData
  | StaffSectionData
  | ReviewsSectionData
  | ContactSectionData;

export interface PublicSiteData {
  readonly slug: string;
  readonly businessName: string;
  readonly theme: ThemeTokens;
  readonly sections: readonly PublicSection[]; // immutabile
  readonly contacts: PublicContactsDTO; // allowlist
  readonly locale: string;
  readonly timezone: string;
}
```

### 4.2 Zod schemas (strict, no unknown)

7 schemi in `src/lib/server/content-engine.ts`:

- `heroSettingsSchema` — eyebrow, headline, subheadline, cta[{label,href,variant}]
- `aboutSettingsSchema` — title, body[], image[]
- `servicesSettingsSchema` — title, subtitle, show_price, show_duration
- `gallerySettingsSchema` — title, items[{src,alt,weight}], aspect, columns
- `staffSettingsSchema` — title, items[] OGGI SEMPRE EMPTY (blocked)
- `reviewsSettingsSchema` — title, items[] OGGI SEMPRE EMPTY (blocked)
- `contactSettingsSchema` — title, show_map, opening_hours{day,open,close}

`parseSectionSettings(type, rawJSONB)` ritorna `{ok,value}` o
`{ok:false, issue}`. **Settings invalido non crasha**. → Sezione omessa +
log sanitizzato.

### 4.3 `SECTION_RENDERERS` — NoSwitch pattern

`src/components/site/SectionRegistry.tsx`:

```tsx
const SECTION_RENDERERS: Record<PublicSection["type"], RenderFn> = {
  hero: HeroPublicSection,
  about: AboutPublicSection,
  services: ServicesPublicSection,
  gallery: GalleryPublicSection,
  staff: StaffPublicSection,
  reviews: ReviewsPublicSection,
  contact: ContactPublicSection,
};
```

- 7 × Server Components → **nessun "use client"** richiesto per il sito
  pubblico.
- Rendering: `.map()` + `filter(Boolean)`. Sections con `items=0` o
  `enabled=false` già assenti dall'array (`null`).

---

## 5. Public DTO Allowlist (security)

### 5.1 Cosa PUÒ uscire nel DTO pubblico

✅ Contatti **allowlist** (solo): phone, email, address, city,
province, postal_code, country_code, locale, timezone.

✅ Dati sezione settings dopo parsing Zod strict (nessun campo arbitrario).

✅ Services allowlist: name, description, price_from, duration_minutes,
position, display_image_src, display_image_alt.

❌ MAI: `memberships`, `raw_user_meta_data`, `auth.users.*`, ruoli,
audit_logs, `business_profiles.theme_*` grezze prima del token.

### 5.2 CTA Protocol safety

`normalizePublicLink()` in content-engine:

```ts
ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:", // link esterni
  "tel:",
  "mailto:", // azioni contatto
  "", // path interni ("/contatti")
]);
```

Bloccati: `javascript:`, `data:`, `vbscript:`, `file:`, protocolli
custom non dichiarati, doppi slash `//evil.tld` senza protocollo →
normalizzati a path sicuro `"/evil.tld"`.

### 5.3 XSS Safety

- **Zero `dangerouslySetInnerHTML`** in tutti i 7 renderers.
- `textContent` React default → escape automatico.
- Immagini `next/image` remote: Domini in remotePatterns config.
- Test E24 XSS: name="<img src=x onerror=…>" → **niente img, niente alert**
  (provato).

---

## 6. RLS & Isolamento

### 6.1 Policies applicate

| Tabella             | Policy anon                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `tenants`           | `status='active' AND published=true`                                                    |
| `business_profiles` | `EXISTS (SELECT 1 FROM tenants WHERE id = tenant_id AND status='active' AND published)` |
| `site_sections`     | `enabled = true` + join tenants attivo/pubblicato (forza RLS)                           |
| `services`          | `active = true` + join tenants attivo/pubblicato (forza RLS)                            |

### 6.2 Anon read-only

Policy anon: solo SELECT. INSERT/UPDATE/DELETE anonimo =
**esplicitamente negato**.

Test verificato (A1): anonimo SELECT * tenants → 0 rows (perché seed
non pubblicati senza global setup).

### 6.3 Cross-tenant safety

- **`tenant_id` sempre trusted server-side.** MAI derivato da slug
  senza JOIN. Selezioniamo SEMPRE con Supabase query RLS-enabled
  (`createSupabaseAnonReadonlyClient`), quindi engine vede solo le
  righe consentite.
- **Theme isolation testato E31**: tenant A primary = `#be185d`.
  Tenant B primary = `#111827`. Page A → B: CSS variables cambiano.
  **Niente contaminazione**.

---

## 7. Observability + Invalid Settings (§47-48)

### 7.1 Fail-safe (non crasha)

`resolvePublicSiteContent()` gestisce 5 scenari di corruzione **senza
throw**:

| Causa                            | Comportamento              | Severity log |
| -------------------------------- | -------------------------- | :----------: |
| `section_type` sconosciuto       | skip riga                  |   warn (1)   |
| Variante non in allowlist        | fallback default variant   |   warn (1)   |
| Singleton duplicato in DB        | prendi la prima, skip rest |   warn (1)   |
| Zod strict parsing settings FAIL | sezione omessa             |   warn (1)   |
| `services` con 0 active          | sezione Services omessa    |    no log    |

(1) **Log SANITIZZATO** — contiene solo: slug, conteggio skip, reason enum.
**MAI JSON raw corrotto / MAI dati sensibili** nei log.

```
[site-engine] section_skipped slug=beauty-b total=2 reasons=invalid_settings=1,duplicate_singleton=1
```

### 7.2 Publication not-found log

```
[site-engine] public_not_found reason=NO_TENANT slug=abcdef… host=none
[site-engine] public_not_found reason=NOT_PUBLISHED slug=velora-e2e-unpublished-c
```

Motivo distinto per:

- slug non esistente → NO_TENANT.
- slug esiste ma status≠active OR published=false → NOT_PUBLISHED.

---

## 8. Performance (§46) — real measurements

### 8.1 Query count (public render singolo)

Prima (FASE 4): **4 query** (resolveTenant + resolveBP+theme ridondante +
sections + services).

Dopo (FASE 5 frozen): **3 query nette** — N+1 eliminato.

| #   | Query                                               | Cardinalità | Note                                                                       |
| --- | --------------------------------------------------- | :---------: | -------------------------------------------------------------------------- |
| 1   | `tenants` + INNER JOIN `business_profiles` 1:1      |    1 row    | ✅ Porta id, slug, status, published e TUTTE le 7 colonne theme + contatti |
| 2   | `site_sections WHERE enabled` ORDER BY position ASC |  0..7 rows  | Promise.all parallela a Q3                                                 |
| 3   | `services WHERE active=true` ORDER BY position ASC  |  0..N rows  | Promise.all parallela a Q2                                                 |

### 8.2 Client JS size (Next production build)

```
.next/static/chunks  :  594.6 KB   (15 files)
.next/static/css     :  (incluso chunks)
Build classification :  3 Static routes, 6 Dynamic routes
                       ├─ Static  :  / , /_not-found , /login
                       └─ Dynamic :  /api/health, /app, /dashboard, /onboarding, /app/settings
                       └─ ISR 300s:  /s/[slug]  ✅ cached 5 minuti per-slug
```

### 8.3 Cache behavior (tenant-safe)

- `/s/[slug]` → `export const revalidate = 300;` (ISR 5 min).
- Slug è parte dell'URL → chiave cache = per-slug.
- Cache **non condivide nulla tra tenant A e B**.
- Anon Supabase client: persist=false → sessione-less, caching sicuro.
- Nessun cookie auth → ISR non sballa per user loggati.

### 8.4 No N+1

- `theme_*` e `id` estratti 1 SOLA volta da JOIN iniziale.
- sections e services: **una query ciascuno in parallelo**.
- PublicSiteData costruito in memoria con reduce O(rows).

---

## 9. Testing matrix

| Livello       | Nome file                                           | Test FASE 5 | Verifica                                                              |
| ------------- | --------------------------------------------------- | :---------: | --------------------------------------------------------------------- |
| DB / RLS      | `tests/db/multi-tenant-rls.test.ts`                 |   49 PASS   | Cross-tenant read/write deny, roles, anon 0                           |
| DB / Resolver | `tests/db/site-engine.test.ts`                      |   11 PASS   | resolvePublicTenant, slug esistente/non, unpublished                  |
| DB / Content  | `tests/db/content-model.test.ts`                    |   18 PASS   | Singletons, services active flag, ordering                            |
| Unit / Zod    | `tests/unit/*.test.ts`                              |   81 PASS   | Schemas strict, normalizePublicLink safety, section registry          |
| Integration   | `tests/integration/auth-onboarding.test.ts` + altri |   26 PASS   | FASE 2 Auth preserved, settings hardening                             |
| E2E (dev)     | `e2e/site-public.spec.ts` (E1-E37)                  |   52 PASS   | Rendering vero browser, XSS, CTA, theme isolation, responsive 375/768 |
| E2E (prod)    | `test:e2e:prod`                                     |   52 PASS   | Build ottimizzato + next start + ISR                                  |
| Health        | `/api/health`                                       |   200 OK    | status=ok, checks.uptime_ms presente                                  |

**Totale combinato regression F1-F5**: 49 + 26 + 81 + 11 + 18 =
**185/185 PASS**.

---

## 10. Empty behavior matrix

| Condizione                          | Risultato UI                | Crash? |     Errore console?     |
| ----------------------------------- | --------------------------- | :----: | :---------------------: |
| Zero sezioni DB per un tenant       | Shell vuota, H1 only?       |   ❌   |           ❌            |
| Services 0 rows active              | Services section **OMESSA** |   ❌   |           ❌            |
| Gallery items = 0                   | Gallery `null` → OMESSA     |   ❌   |           ❌            |
| Staff items = 0 (oggi default)      | Staff `null` → OMESSA       |   ❌   |           ❌            |
| Reviews items = 0 (oggi default)    | Reviews `null` → OMESSA     |   ❌   |           ❌            |
| Settings JSON invalido su 1 sezione | Sezione skippata, resto ok  |   ❌   | sanitizzato 1 riga warn |
| Unknown section_type                | Riga skippata, resto ok     |   ❌   | sanitizzato 1 riga warn |
| Singleton hero 2 righe corrotte     | 1 sola resa, seconda skip   |   ❌   | sanitizzato 1 riga warn |
| Slug inesistente                    | not-found.tsx (no stack)    |   ❌   |      1 riga sanit.      |

---

## 11. Migrations applicate per FASE 5 (append-only)

| #   | Migration file                                                      | Scopo                            |
| --- | ------------------------------------------------------------------- | -------------------------------- |
| 20  | `20260818120020_tenant_publication_state_and_domain_foundation.sql` | status, published, slug          |
| 21  | `20260818120021_anon_public_site_rls_policies.sql`                  | Anon read-only + JOIN publicate  |
| 22  | `20260818121022_content_model_site_sections_and_services.sql`       | site_sections + services tables  |
| 23  | `20260818121023_anon_rls_content_model.sql`                         | RLS anon section + service + idx |

(20–23 = nuove migration FASE5, MAI modificate dopo freeze. Eventuali fix = nuove migration.)

---

## 12. Cosa NON implementato in FASE 5 (esplicito)

- ❌ Custom domain pubblico (infrastructure successiva).
- ❌ Booking engine (FASE 6+).
- ❌ Pagamenti / Stripe.
- ❌ Modello Staff pubblico vero (oggi safe-empty).
- ❌ Modello Reviews vero (oggi safe-empty).
- ❌ AI Assistant nel sito pubblico.
- ❌ Upload immagini reale Gallery (oggi URL remote).
- ❌ Sitemap + OG dinamico multi-tenant.

Tutti i punti "mancanti" **non rompono il modello**: i renderer
gestiscono empty-state come `null` → omessi dal DOM. Zero crash, zero
fake.
