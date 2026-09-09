import Link from "next/link";
import { notFound } from "next/navigation";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";

interface CookiePolicyPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CookiePolicyPage({ params }: CookiePolicyPageProps) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const tenantResult = await resolvePublicTenant({ slug: parsed.data });
  if (tenantResult._tag !== "Found") notFound();
  const businessName =
    (tenantResult.site.businessName?.length ?? 0) > 0
      ? tenantResult.site.businessName
      : "Titolare del trattamento";
  const base = `/s/${encodeURIComponent(parsed.data)}`;

  return (
    <article className="gdpr-page">
      <Link className="gdpr-back-link" href={base}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Torna alla home
      </Link>

      <h1>Cookie Policy</h1>
      <p className="gdpr-page-subtitle">
        Informazioni sui cookie, gestione delle preferenze e disattivazione
      </p>

      <h2>1. Cosa sono i cookie</h2>
      <p>
        I cookie sono piccoli file di testo inviati dal sito al browser del visitatore, che li
        memorizza e li ritrasmette al sito in occasione delle visite successive. I cookie permettono
        di ricordare le preferenze dell&apos;utente (es. lingua scelta), garantire la sicurezza
        della navigazione, migliorare l&apos;esperienza d&apos;uso e, previo consenso, misurare
        l&apos;audience o proporre annunci personalizzati.
      </p>
      <p>
        La presente Cookie Policy integra la{" "}
        <Link href={`${base}/privacy-policy`}>Privacy Policy</Link> di {businessName} e descrive in
        modo dettagliato ogni categoria di cookie utilizzata sul sito pubblico, le relative
        finalità, durata, terze parti coinvolte e le modalità attraverso cui l&apos;utente può
        esprimere o modificare il proprio consenso.
      </p>

      <h2>2. Categorie di cookie utilizzate</h2>
      <p>
        Il sito utilizza esclusivamente le tre categorie descritte di seguito. I cookie tecnici
        necessari sono sempre attivi in quanto indispensabili al funzionamento; le restanti due
        categorie sono attivate solo a seguito di consenso esplicito e libero dell&apos;utente,
        prestabile tramite il banner di prima visualizzazione o la pagina di gestione delle
        preferenze dettagliate.
      </p>

      <h3>Categoria A — Cookie tecnici necessari</h3>
      <p>
        Questa categoria include tutti i cookie il cui utilizzo non richiede il consenso
        dell&apos;utente (art. 122 comma 1 del D.Lgs. 196/2003 e Linee Guida Garante Privacy
        10/2021), in quanto essenziali per garantire il corretto funzionamento del sito e
        l&apos;erogazione dei servizi richiesti dall&apos;utente.
      </p>
      <table>
        <thead>
          <tr>
            <th>Nome cookie</th>
            <th>Provenienza</th>
            <th>Descrizione e scopo</th>
            <th>Durata</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>sid</code>
            </td>
            <td>Supabase Inc. / Primo partito</td>
            <td>
              Cookie di sessione HttpOnly, Secure, flag &quot;HttpOnly&quot; attivo (non accessibile
              da JavaScript lato client). Garantisce la gestione sicura della sessione durante la
              navigazione e durante l&apos;invio del modulo di prenotazione; protegge da attacchi
              CSRF e session hijacking.
            </td>
            <td>1 ora (sessione)</td>
            <td>Primo partito, HttpOnly</td>
          </tr>
        </tbody>
      </table>
      <p>
        Questi cookie non possono essere disattivati dall&apos;utente tramite il banner, né tramite
        le impostazioni del browser in quanto il sito non funzionerebbe correttamente.
      </p>

      <h3>Categoria B — Cookie analitici (solo con consenso)</h3>
      <p>
        I cookie analitici sono utilizzati per raccogliere informazioni in forma anonima
        sull&apos;utilizzo del sito (numero visitatori, pagine più visualizzate, tempo medio di
        permanenza, sorgenti di traffico, dispositivi e browser utilizzati). Questi dati permettono
        al Titolare di migliorare struttura, contenuti e prestazioni del sito. I cookie di questa
        categoria sono installati solo previo consenso esplicito dell&apos;utente.
      </p>
      <table>
        <thead>
          <tr>
            <th>Nome cookie</th>
            <th>Provenienza</th>
            <th>Descrizione e scopo</th>
            <th>Durata</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>_ga</code>
            </td>
            <td>Google LLC (Google Analytics 4)</td>
            <td>
              Identificatore univoco e persistente assegnato al browser del visitatore per
              distinguere utenti diversi e conteggiare il numero di sessioni. Dati anonimizzati (IP
              masking attivo dove applicabile).
            </td>
            <td>14 mesi</td>
            <td>Terzo partito</td>
          </tr>
          <tr>
            <td>
              <code>_ga_XXXXXXXXXX</code> (pattern <code>_ga_*</code>)
            </td>
            <td>Google LLC (Google Analytics 4)</td>
            <td>
              Cookie di sessione Analytics 4: memorizza lo stato della sessione di navigazione, il
              numero di pagina per sessione e i parametri di acquisizione sorgente traffico.
            </td>
            <td>14 mesi</td>
            <td>Terzo partito</td>
          </tr>
        </tbody>
      </table>
      <p>
        Base giuridica: consenso esplicito dell&apos;utente (art. 6.1.a GDPR e art. 122 comma 2
        Codice Privacy). Il consenso può essere revocato in qualsiasi momento tramite il banner o
        tramite le impostazioni del browser.
      </p>

      <h3>Categoria C — Cookie di marketing e profilazione (solo con consenso)</h3>
      <p>
        I cookie di marketing sono installati da piattaforme pubblicitarie terze parti al fine di
        tracciare la navigazione dell&apos;utente sul sito e mostrare successivamente annunci
        personalizzati (remarketing), misurare l&apos;efficacia delle campagne pubblicitarie
        (conversion tracking) e costruire profili comportamentali per segmenti pubblicitari mirati.
        Questi cookie sono attivati solamente previo consenso esplicito e libero dell&apos;utente.
      </p>
      <table>
        <thead>
          <tr>
            <th>Nome cookie</th>
            <th>Provenienza</th>
            <th>Descrizione e scopo</th>
            <th>Durata</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>_fbp</code>
            </td>
            <td>Meta Platforms Inc. (Facebook Pixel)</td>
            <td>
              Identificatore unico del browser assegnato dal Meta Pixel per permettere
              l&apos;attribuzione delle conversioni, la misurazione delle campagne Meta Ads e la
              costruzione di pubblici personalizzati per attività di remarketing.
            </td>
            <td>90 giorni</td>
            <td>Terzo partito</td>
          </tr>
          <tr>
            <td>
              <code>_fbc</code>
            </td>
            <td>Meta Platforms Inc. (Facebook Pixel)</td>
            <td>
              Cookie generato automaticamente dal Meta Pixel quando un utente raggiunge il sito
              cliccando da un&apos;inserzione Meta Ads, utile per attribuire con precisione la
              conversione alla campagna cliccata (click-through attribution).
            </td>
            <td>90 giorni</td>
            <td>Terzo partito</td>
          </tr>
        </tbody>
      </table>
      <p>
        Base giuridica: consenso esplicito dell&apos;utente (art. 6.1.a GDPR e art. 122 comma 2
        Codice Privacy). L&apos;utente può in ogni momento revocare il consenso e le terze parti
        coinvolte sono responsabili dei dati trattati in qualità di Titolari autonomi, secondo le
        loro rispettive informative.
      </p>

      <h2>3. Gestione delle preferenze tramite banner</h2>
      <p>
        In occasione della prima visita sul sito, l&apos;utente visualizza un banner informativo
        sempre accessibile, posizionato in basso (sticky) e ottimizzato per il mobile. Dal banner
        l&apos;utente può scegliere tre opzioni immediate:
      </p>
      <ul>
        <li>
          <strong>Accetta tutto</strong>: salva il consenso positivo per le categorie Analitici e
          Marketing, oltre ai Necessari sempre attivi;
        </li>
        <li>
          <strong>Rifiuta non necessari</strong>: salva la scelta di disattivare ogni cookie non
          tecnicamente indispensabile;
        </li>
        <li>
          <strong>Preferenze dettagliate</strong>: apre una modale (finestra dedicata) in cui è
          possibile attivare/disattivare ogni categoria individualmente tramite appositi switch e
          salvare la scelta.
        </li>
      </ul>
      <p>
        Le preferenze salvate sono memorizzate in locale (localStorage) con chiave{" "}
        <code>velora_gdpr_v1</code> e inviate al database del Titolare come registro di avvenuta
        acquisizione del consenso, in conformità all&apos;articolo 7 GDPR e alle Linee Guida del
        Garante Privacy in materia di cookie e tracking.
      </p>

      <h2>4. Disattivazione cookie dal browser</h2>
      <p>
        L&apos;utente può disattivare o cancellare i cookie direttamente dalle impostazioni del
        proprio browser. La disattivazione dei cookie tecnici necessari può tuttavia impedire il
        corretto funzionamento del sito e la fruizione di alcuni servizi. Di seguito i link alle
        guide ufficiali dei principali browser:
      </p>
      <ul>
        <li>
          <a
            href="https://support.google.com/chrome/answer/95647"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Chrome
          </a>
        </li>
        <li>
          <a
            href="https://support.mozilla.org/it/kb/protezione-antitracciamento-avanzata-firefox-desktop"
            target="_blank"
            rel="noopener noreferrer"
          >
            Mozilla Firefox
          </a>
        </li>
        <li>
          <a
            href="https://support.apple.com/it-it/guide/safari/sfri11471/mac"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apple Safari
          </a>
        </li>
        <li>
          <a
            href="https://support.microsoft.com/it-it/microsoft-edge/elimina-i-cookie-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
            target="_blank"
            rel="noopener noreferrer"
          >
            Microsoft Edge
          </a>
        </li>
      </ul>
      <p>
        Per i cookie di terza parte, l&apos;utente può inoltre disattivare il tracciamento
        pubblicitario tramite le piattaforme ufficiali:{" "}
        <a
          href="https://policies.google.com/technologies/ads"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Ads Settings
        </a>{" "}
        e{" "}
        <a
          href="https://www.facebook.com/ads/preferences/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Meta Ad Preferences
        </a>
        .
      </p>

      <h2>5. Ulteriori informazioni</h2>
      <p>
        Per informazioni più estese sul trattamento dei dati personali, i diritti
        dell&apos;interessato e i recapiti del Titolare è possibile consultare la{" "}
        <Link href={`${base}/privacy-policy`}>Privacy Policy</Link> completa del sito. L&apos;elenco
        e le caratteristiche dei cookie possono essere aggiornati nel tempo: eventuali modifiche
        saranno riportate in questa pagina con indicazione della data di ultimo aggiornamento.
      </p>
      <p>Ultimo aggiornamento: settembre 2026 · Versione v1.</p>
    </article>
  );
}
