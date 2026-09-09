import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type ServiceSeedRow = {
  name: string;
  description: string;
  price_from: number;
  currency: "EUR" | "USD" | "GBP" | "CHF";
  duration_minutes: number;
};

const PARRUCCHIERE_SEEDS: ServiceSeedRow[] = [
  {
    name: "Taglio donna",
    description:
      "Taglio personalizzato con shampoo e piega inclusi. Consulenza stylistica su misura.",
    price_from: 38.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Taglio uomo",
    description:
      "Taglio classico o moderno con shampoo e finizione. Rifinitura barba inclusa su richiesta.",
    price_from: 22.0,
    currency: "EUR",
    duration_minutes: 40,
  },
  {
    name: "Colore completo",
    description:
      "Tinta professionale su tutta la lunghezza, con copertura grigia ottimale e trattamento finale.",
    price_from: 58.0,
    currency: "EUR",
    duration_minutes: 90,
  },
  {
    name: "Mèches / Degradé",
    description:
      "Schiariture tecniche effetto naturale con carta o cuffia. Shampoo e piega inclusi.",
    price_from: 72.0,
    currency: "EUR",
    duration_minutes: 120,
  },
  {
    name: "Piega",
    description:
      "Piega lisci, mossi o volume con phon e spazzola. Ideale dopo trattamenti o per un'occasione.",
    price_from: 22.0,
    currency: "EUR",
    duration_minutes: 45,
  },
  {
    name: "Trattamento nutriente",
    description:
      "Impacco rigenerante con principi attivi per capelli secchi, sfibrati o trattati. Massaggio cute.",
    price_from: 28.0,
    currency: "EUR",
    duration_minutes: 40,
  },
  {
    name: "Bioliss / cheratina",
    description:
      "Lisciatura professionale alla cheratina per capelli crespi e ribelli. Effetto dura mesi.",
    price_from: 150.0,
    currency: "EUR",
    duration_minutes: 180,
  },
];

const ESTETISTA_SEEDS: ServiceSeedRow[] = [
  {
    name: "Pulizia viso profonda",
    description:
      "Detersione, scrub, estrazione comedoni, maschera lenitiva e crema giorno. Adatta a tutte le pelli.",
    price_from: 48.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Depilazione gambe complete",
    description:
      "Depilazione con cera liposolubile o pasta zuccherata per un risultato duraturo e pelle morbida.",
    price_from: 35.0,
    currency: "EUR",
    duration_minutes: 45,
  },
  {
    name: "Depilazione inguine e ascelle",
    description:
      "Trattamento delicato con cera tiepida. finitura con olio lenitivo post-depilatorio.",
    price_from: 25.0,
    currency: "EUR",
    duration_minutes: 30,
  },
  {
    name: "Massaggio corpo decontratturante",
    description:
      "Manovre profonde su schiena, collo e spalle per sciogliere tensioni da stress o lavoro.",
    price_from: 65.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Sopracciglia design",
    description:
      "Ridisegno con pinzetta o filo, misurazione arco ideale, tintura e piega con sapone.",
    price_from: 22.0,
    currency: "EUR",
    duration_minutes: 30,
  },
  {
    name: "Laminazione ciglia",
    description:
      "Trattamento lifting permanente delle ciglia naturali, incurvatura e volume per 6-8 settimane.",
    price_from: 55.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Manicure semipermanente",
    description:
      "Preparazione unghie, stesura gel/smalto semipermanente, decoro base e finitura lucida.",
    price_from: 32.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Pedicure estetico",
    description: "Ammorbidimento callosità, cura unghie, smalto e massaggio drenante ai piedi.",
    price_from: 38.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Trattamento anticellulite",
    description:
      "Protocollo combinato con bendaggi, oli drenanti e manovre palpate-roulotte per gambe più leggere.",
    price_from: 75.0,
    currency: "EUR",
    duration_minutes: 75,
  },
];

const BARBIERE_SEEDS: ServiceSeedRow[] = [
  {
    name: "Taglio classico",
    description: "Taglio con macchinetta e forbice, rifinitura attaccatura e styling con prodotto.",
    price_from: 18.0,
    currency: "EUR",
    duration_minutes: 35,
  },
  {
    name: "Taglio + barba completa",
    description:
      "Il pacchetto più richiesto: taglio personalizzato, barba con rasoio tradizionale e asciugamano caldo.",
    price_from: 30.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Barba tradizionale con rasoio",
    description:
      "Prelavaggio, pennello e sapone, due passate di rasoio dritto, dopobarba e acqua di colonia.",
    price_from: 20.0,
    currency: "EUR",
    duration_minutes: 45,
  },
  {
    name: "Regolazione barba",
    description:
      "Rifinitura e mantenimento della barba con macchinetta e rifinitura contorni da rasoio.",
    price_from: 12.0,
    currency: "EUR",
    duration_minutes: 25,
  },
  {
    name: "Trattamento cute e barba",
    description: "Scrub cute, impacco idratante, siero barba anti-prurito e massaggio rilassante.",
    price_from: 22.0,
    currency: "EUR",
    duration_minutes: 40,
  },
  {
    name: "Ritocco capelli grigi",
    description:
      "Colore mimetico per capelli bianchi o grigi senza effetto tinta, naturale e discreto.",
    price_from: 25.0,
    currency: "EUR",
    duration_minutes: 45,
  },
  {
    name: "Taglio bambino",
    description: "Taglio dedicato ai più piccoli con attrezzatura dedicata e clima rilassato.",
    price_from: 15.0,
    currency: "EUR",
    duration_minutes: 30,
  },
];

const SERVIZIO_GENERICO_SEEDS: ServiceSeedRow[] = [
  {
    name: "Consulenza iniziale",
    description:
      "Appuntamento conoscitivo senza impegno: analizza esigenze, tempi e preventivo personalizzato.",
    price_from: 0.0,
    currency: "EUR",
    duration_minutes: 30,
  },
  {
    name: "Servizio standard",
    description:
      "Il servizio base della tua attività: esecuzione professionale secondo i più alti standard di qualità.",
    price_from: 50.0,
    currency: "EUR",
    duration_minutes: 60,
  },
  {
    name: "Servizio premium",
    description:
      "Formula top di gamma: tempi più lunghi, prodotti di fascia alta e dettagli personalizzati extra.",
    price_from: 90.0,
    currency: "EUR",
    duration_minutes: 90,
  },
  {
    name: "Pacchetto mensile",
    description:
      "Abbonamento convenienza: include servizio principale con priorità e tariffa dedicata per clienti fedeli.",
    price_from: 150.0,
    currency: "EUR",
    duration_minutes: 120,
  },
  {
    name: "Ritocco / mantenimento",
    description:
      "Appuntamento breve per rifinitura o mantenimento a distanza di tempo dal servizio principale.",
    price_from: 28.0,
    currency: "EUR",
    duration_minutes: 35,
  },
];

export const CATEGORY_SEEDS_MAP: Record<string, ServiceSeedRow[]> = {
  parrucchiere: PARRUCCHIERE_SEEDS,
  hairdresser: PARRUCCHIERE_SEEDS,
  hair: PARRUCCHIERE_SEEDS,
  "hair salon": PARRUCCHIERE_SEEDS,
  estetista: ESTETISTA_SEEDS,
  beauty: ESTETISTA_SEEDS,
  "beauty center": ESTETISTA_SEEDS,
  centro_estetico: ESTETISTA_SEEDS,
  barbiere: BARBIERE_SEEDS,
  barber: BARBIERE_SEEDS,
  "barber shop": BARBIERE_SEEDS,
  service_business: SERVIZIO_GENERICO_SEEDS,
  generico: SERVIZIO_GENERICO_SEEDS,
  generic: SERVIZIO_GENERICO_SEEDS,
  altro: SERVIZIO_GENERICO_SEEDS,
  other: SERVIZIO_GENERICO_SEEDS,
  "": SERVIZIO_GENERICO_SEEDS,
};

export function resolveCategorySeeds(rawCategory?: string | null): ServiceSeedRow[] {
  const key = (rawCategory || "").trim().toLowerCase();
  const match = Object.prototype.hasOwnProperty.call(CATEGORY_SEEDS_MAP, key)
    ? CATEGORY_SEEDS_MAP[key]
    : undefined;
  return match ?? SERVIZIO_GENERICO_SEEDS;
}

export function buildServiceInserts(
  seeds: ServiceSeedRow[],
  tenantId: string,
): Array<{
  tenant_id: string;
  name: string;
  description: string;
  price_from: number;
  currency: "EUR" | "USD" | "GBP" | "CHF";
  duration_minutes: number;
  active: boolean;
  position: number;
}> {
  return seeds.map((s, i) => ({
    tenant_id: tenantId,
    name: s.name,
    description: s.description,
    price_from: s.price_from,
    currency: s.currency || "EUR",
    duration_minutes: s.duration_minutes,
    active: true,
    position: i,
  }));
}

export type SeedServicesResult =
  | { ok: true; inserted: number; category: string; tenant_id: string }
  | { ok: false; error: string; code: "EMPTY_TENANT" | "DB_ERROR" | "NO_SEEDS" };

export async function seedServicesForCategory(
  categoryRaw: string | null | undefined,
  tenantId: string,
): Promise<SeedServicesResult> {
  if (!tenantId?.trim()) {
    return { ok: false, error: "ID tenant richiesto.", code: "EMPTY_TENANT" };
  }

  const seeds = resolveCategorySeeds(categoryRaw);
  if (!seeds.length) {
    return { ok: false, error: "Nessun seed disponibile per la categoria.", code: "NO_SEEDS" };
  }

  try {
    const svc = getSupabaseServiceClient();
    const svcAny = svc as unknown as {
      from: (rel: string) => {
        select: (
          cols?: string,
          opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
        ) => {
          eq: (
            k: string,
            v: unknown,
          ) => Promise<{
            data?: unknown | null;
            error?: { message: string } | null;
            count?: number | null;
          }>;
        };
        insert: (rows: Array<Record<string, unknown>>) => {
          select: (
            cols?: string,
            opts?: { count?: "exact" | "planned" | "estimated" },
          ) => Promise<{
            data?: unknown | null;
            error?: { message: string } | null;
            count?: number | null;
          }>;
        };
      };
    };
    const payload = buildServiceInserts(seeds, tenantId.trim()) as unknown as Array<
      Record<string, unknown>
    >;

    const existing = await svcAny
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId.trim());

    if ((existing.count ?? 0) > 0) {
      return {
        ok: true,
        inserted: 0,
        category: (categoryRaw || "generic").trim() || "generic",
        tenant_id: tenantId.trim(),
      };
    }

    const res = await svcAny.from("services").insert(payload).select("id", { count: "exact" });

    if (res.error) {
      return {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Errore interno."
            : `DB services insert: ${res.error.message}`,
        code: "DB_ERROR",
      };
    }

    return {
      ok: true,
      inserted: res.count ?? payload.length,
      category: (categoryRaw || "generic").trim() || "generic",
      tenant_id: tenantId.trim(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore seed servizi";
    return {
      ok: false,
      error: process.env.NODE_ENV === "production" ? "Errore interno." : msg,
      code: "DB_ERROR",
    };
  }
}
