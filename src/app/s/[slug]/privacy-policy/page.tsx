import Link from "next/link";
import { notFound } from "next/navigation";
import { slugSchema, resolvePublicTenant } from "@/lib/server/site-engine";

interface PrivacyPolicyPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PrivacyPolicyPage({ params }: PrivacyPolicyPageProps) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const tenantResult = await resolvePublicTenant({ slug: parsed.data });
  if (tenantResult._tag !== "Found") notFound();
  const businessName =
    (tenantResult.site.businessName?.length ?? 0) > 0
      ? tenantResult.site.businessName
      : "Titolare del trattamento";
  const contactEmail =
    (tenantResult.site.email?.length ?? 0) > 0 ? tenantResult.site.email : "indirizzo@email";
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

      <h1>Informativa sulla Privacy</h1>
      <p className="gdpr-page-subtitle">
        Ai sensi dell&apos;articolo 13 del Regolamento UE 2016/679 (GDPR)
      </p>

      <h2>1. Chi siamo</h2>
      <p>
        Il titolare del trattamento dei dati personali è <strong>{businessName}</strong>,
        l&apos;attività il cui sito pubblico stai visitando. La presente informativa descrive le
        modalità di trattamento dei dati raccolti tramite questo sito web e durante il processo di
        prenotazione online, in conformità al Regolamento Generale sulla Protezione dei Dati (GDPR,
        Reg. UE 2016/679) e alla normativa nazionale di settore.
      </p>
      <p>
        Per ogni domanda relativa alla protezione dei dati puoi scrivere a{" "}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a> oppure utilizzare i riferimenti
        pubblicati nella sezione contatti del sito. Il Responsabile della Protezione dei Dati (DPO),
        ove nominato, è contattabile tramite gli stessi canali.
      </p>

      <h2>2. Tipologie di dati raccolti e finalità</h2>
      <p>
        Raccogliamo unicamente i dati personali strettamente necessari alle finalità indicate nel
        prosieguo. Nello specifico:
      </p>
      <ul>
        <li>
          <strong>Dati di prenotazione:</strong> nome e cognome, indirizzo email, numero di
          telefono, servizio richiesto, data e orario dell&apos;appuntamento, eventuali note
          inserite nel modulo. Questi dati sono utilizzati per la gestione amministrativa e
          operativa della prenotazione (conferma, promemoria, gestione del calendario interno).
        </li>
        <li>
          <strong>Dati di navigazione:</strong> indirizzo IP anonimizzato ove possibile, User-Agent,
          pagine visitate, orario di accesso, tipo di browser. Questi dati sono raccolti per
          finalità di sicurezza e, previo consenso, per analisi statistiche anonime del traffico.
        </li>
        <li>
          <strong>Cookie e tecnologie simili:</strong> cookie tecnici necessari, cookie analitici
          (con consenso) e cookie di marketing/profilazione (con consenso esplicito). L&apos;elenco
          dettagliato è disponibile nella <Link href={`${base}/cookie-policy`}>Cookie Policy</Link>.
        </li>
      </ul>

      <h2>3. Base giuridica del trattamento</h2>
      <p>
        I trattamenti svolti da {businessName} si fondano su una delle basi giuridiche previste
        dall&apos;articolo 6 del GDPR:
      </p>
      <ol>
        <li>
          <strong>Esecuzione di misure precontrattuali o contrattuali (art. 6.1.b):</strong>{" "}
          trattamento di nome, contatti e dettagli della prenotazione per eseguire la richiesta
          appuntamento e adempiere agli obblighi derivanti dal rapporto con la clientela.
        </li>
        <li>
          <strong>Legittimo interesse (art. 6.1.f):</strong> invio di promemoria automatici relativi
          all&apos;appuntamento prenotato (email/SMS), sicurezza e integrità del sistema,
          rilevazione anomalie e prevenzione frodi.
        </li>
        <li>
          <strong>Consenso esplicito (art. 6.1.a):</strong> trattamento per finalità di marketing
          diretto, newsletter, promozioni personalizzate, profilazione e cookie analitici di terza
          parte e di marketing. Il consenso è sempre revocabile in qualsiasi momento.
        </li>
        <li>
          <strong>Obbligo di legge (art. 6.1.c):</strong> conservazione dei dati per adempimenti
          fiscali, contabili e amministrativi previsti dal Codice Civile e dalle normative
          tributarie.
        </li>
      </ol>

      <h2>4. Conservazione dei dati</h2>
      <p>
        I dati sono conservati per un periodo non superiore a quello necessario al conseguimento
        delle finalità per cui sono stati raccolti:
      </p>
      <ul>
        <li>
          <strong>24 mesi</strong> dalla data dell&apos;ultimo contatto o dell&apos;ultimo servizio
          erogato, per finalità di gestione del rapporto con la clientela e invio di comunicazioni
          amministrative;
        </li>
        <li>
          <strong>10 anni</strong> dalla data di chiusura dell&apos;esercizio fiscale, per dati
          fatturazione/documenti fiscali e record di prenotazioni con valenza contabile, come
          previsto dal Codice Civile (art. 2220 ss.) e dalle normative tributarie;
        </li>
        <li>
          <strong>14 mesi</strong> per i cookie analitici Google Analytics, ove attivati tramite
          consenso;
        </li>
        <li>
          <strong>90 giorni</strong> per i cookie marketing Meta/Facebook pixel, ove attivati
          tramite consenso.
        </li>
      </ul>
      <p>
        Trascorsi i periodi di conservazione applicabili, i dati vengono cancellati in modo
        irreversibile oppure resi completamente anonimi.
      </p>

      <h2>5. Diritti dell&apos;interessato (artt. 15-22 GDPR)</h2>
      <p>
        In qualsiasi momento puoi esercitare, nei confronti del Titolare, i seguenti diritti,
        mediante richiesta scritta ai contatti indicati:
      </p>
      <ul>
        <li>
          <strong>Diritto di accesso (art. 15):</strong> ottenere conferma dell&apos;esistenza o
          meno di dati personali che ti riguardano e riceverne copia in formato leggibile;
        </li>
        <li>
          <strong>Diritto di rettifica (art. 16):</strong> correggere dati inesatti o incompleti;
        </li>
        <li>
          <strong>Diritto alla cancellazione (&quot;diritto all&apos;oblio&quot;, art. 17):</strong>{" "}
          ottenere la cancellazione dei dati quando ricorrono le condizioni previste dal GDPR (es.
          revoca consenso, fine della finalità, trattamento illecito);
        </li>
        <li>
          <strong>Diritto di limitazione (art. 18):</strong> limitare il trattamento in presenza
          delle ipotesi contemplate dalla norma;
        </li>
        <li>
          <strong>Diritto alla portabilità (art. 20):</strong> ricevere i dati forniti attivamente
          in formato strutturato, di uso comune e leggibile da dispositivo automatico;
        </li>
        <li>
          <strong>Diritto di opposizione (art. 21):</strong> opporsi, in tutto o in parte, al
          trattamento per motivi connessi alla tua situazione particolare, quando il trattamento si
          fonda su legittimo interesse o marketing diretto;
        </li>
        <li>
          <strong>Diritto di revoca del consenso:</strong> revocare in qualsiasi momento il consenso
          prestato per marketing/profilazione/cookie non necessari, senza pregiudicare la liceità
          del trattamento svolto prima della revoca;
        </li>
        <li>
          <strong>Diritto a proporre reclamo:</strong> qualora ritieni che il trattamento dei tuoi
          dati violi il GDPR, puoi proporre reclamo dinanzi al{" "}
          <strong>Garante per la Protezione dei Dati Personali</strong>
          (Piazza di Monte Citorio, 121 - 00186 Roma, Italia - www.garanteprivacy.it), oltre a
          qualsiasi altro ricorso amministrativo o giurisdizionale.
        </li>
      </ul>

      <h2>6. Cookie dettagliati</h2>
      <p>
        Il sito utilizza tre categorie di cookie, la cui attivazione è subordinata alla tua libera
        scelta, salvo per i cookie tecnici necessari.
      </p>
      <h3>Cookie Necessari (sempre attivi)</h3>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Provenienza</th>
            <th>Scopo</th>
            <th>Durata</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>sid</code>
            </td>
            <td>Supabase Auth</td>
            <td>Sessione autenticazione sicura, HttpOnly, no accesso JS</td>
            <td>1 ora</td>
          </tr>
        </tbody>
      </table>
      <h3>Cookie Analytics (solo con consenso)</h3>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Provenienza</th>
            <th>Scopo</th>
            <th>Durata</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>_ga</code>
            </td>
            <td>Google Analytics</td>
            <td>ID visitatore distinto, misurazione visite</td>
            <td>14 mesi</td>
          </tr>
          <tr>
            <td>
              <code>_ga_*</code>
            </td>
            <td>Google Analytics</td>
            <td>ID sessione e stato navigazione</td>
            <td>14 mesi</td>
          </tr>
        </tbody>
      </table>
      <h3>Cookie Marketing (solo con consenso)</h3>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Provenienza</th>
            <th>Scopo</th>
            <th>Durata</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>_fbp</code>
            </td>
            <td>Meta/Facebook Pixel</td>
            <td>ID visitatore unico per remarketing/conversioni</td>
            <td>90 giorni</td>
          </tr>
          <tr>
            <td>
              <code>_fbc</code>
            </td>
            <td>Meta/Facebook Pixel</td>
            <td>Attribuzione click da Meta Ads</td>
            <td>90 giorni</td>
          </tr>
        </tbody>
      </table>

      <h2>7. Riferimenti</h2>
      <p>
        Per esercitare i tuoi diritti o chiedere informazioni sul trattamento, contatta{" "}
        {businessName} all&apos;indirizzo email{" "}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
      </p>
      <p>
        Consulta la <Link href={`${base}/cookie-policy`}>Cookie Policy</Link> per i dettagli
        operativi sulla gestione dei cookie, sul banner e sulle modalità di disattivazione dal
        browser.
      </p>
      <p>Ultimo aggiornamento: settembre 2026 · Versione v1.</p>
    </article>
  );
}
