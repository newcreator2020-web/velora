"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  transitionPublicationAction,
  publishEditorialAction,
  getDomainState,
  addCustomDomainAction,
  verifyCustomDomainAction,
  removeCustomDomainAction,
} from "@/app/app/site/actions";
import {
  PUBLICATION_STATUS_LABEL,
  type DomainActionResult,
  type DomainStateResult,
  type EditorialActionResult,
  type PublicationStatus,
  type TransitionPublicationResult,
} from "@/app/app/site/lib";
import { DESIGN_PRESETS } from "@/lib/design-tokens/presets";
import type { DesignPresetId } from "@/lib/design-tokens/types";
import { MediaPicker } from "@/app/app/admin/media/components/MediaPicker";
import type { MediaLibraryRow } from "@/app/app/admin/media/lib";

type ProspectMeta = {
  business_name: string;
  business_category: string | null;
  comune: string | null;
  telefono: string | null;
  email: string | null;
  note: string | null;
};

type TenantMeta = {
  id: string;
  slug: string;
  business_name: string;
  custom_domain: string | null;
  temporary_domain: string | null;
  status: string;
  published: boolean;
};

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const STEP_TITLES: Record<WizardStep, string> = {
  1: "Dati attività",
  2: "Servizi",
  3: "Tema e branding",
  4: "Galleria, staff e copertina",
  5: "Contenuti e SEO",
  6: "Anteprima",
  7: "Controllo Qualità (bloccante)",
  8: "Dominio",
  9: "Pubblicazione",
};

const QA_CHECKLIST: Array<{ id: string; label: string; hint?: string }> = [
  {
    id: "mobile_ok",
    label: "Mobile OK: layout, testo, immagini non spezzate",
    hint: "Apri anteprima con viewport ≤480px",
  },
  { id: "desktop_ok", label: "Desktop OK: layout desktop pulito", hint: "Viewport ≥1280px" },
  {
    id: "copy_ok",
    label: "Testi e prezzi OK: nessun placeholder",
    hint: "Nessun Lorem ipsum o prezzo €0 non voluto",
  },
  { id: "images_alt_ok", label: "Immagini con alt-text compilato", hint: "Nessun campo alt vuoto" },
  {
    id: "links_ok",
    label: "Link interni/esterni non rotti",
    hint: "Tel, email, maps raggiungibili",
  },
  { id: "booking_simul_ok", label: "Prenotazione simulata OK", hint: "Servizio → slot → form" },
  { id: "seo_ok", label: "Sitemap, robots e meta SEO OK", hint: "/sitemap.xml e /robots.txt" },
  {
    id: "privacy_ok",
    label: "Privacy e cookie banner OK",
    hint: "Banner visibile e pagina esistente",
  },
  { id: "contacts_ok", label: "Contatti/orari/mappa coerenti", hint: "Tel, email, orari, maps" },
  {
    id: "lighthouse_ok",
    label: "Lighthouse locale min 80/100",
    hint: "Media 4 pilastri Lighthouse",
  },
];

type Props = {
  prospectId: string;
  prospect: ProspectMeta;
  tenant: TenantMeta;
};

const CLS_INPUT =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

export function OnboardWizard({ prospectId, prospect, tenant }: Props) {
  const [step, setStep] = useState<WizardStep>(1);
  const [lastMsg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [step1, setStep1] = useState({
    business_name: prospect.business_name || tenant.business_name || "",
    description: "",
    phone: prospect.telefono || "",
    email: prospect.email || "",
    address: prospect.comune || "",
    business_category: prospect.business_category || "service_business",
    vat: "",
    instagram: "",
  });

  const [step3Preset, setStep3Preset] = useState<DesignPresetId>("elegant");
  const [step3LogoUrl, setStep3LogoUrl] = useState<string>("");
  const [step3LogoAlt, setStep3LogoAlt] = useState<string>("");
  const [step3Primary, setStep3Primary] = useState<string>("#0f172a");
  const [step3Accent, setStep3Accent] = useState<string>("#0ea5e9");

  const [showMedia, setShowMedia] = useState(false);
  const [mediaField, setMediaField] = useState<string | null>(null);

  const [step4Hero, setStep4Hero] = useState<string>("");
  const [step4Gallery, setStep4Gallery] = useState<[string, string, string]>(["", "", ""]);
  const [step4Staff, setStep4Staff] = useState<[string, string]>(["", ""]);

  const [step5, setStep5] = useState({
    hero_title: "",
    hero_sub: "",
    cta: "Prenota ora",
    about: "",
    seo_title: "",
    seo_desc: "",
  });

  const [step7QA, setStep7QA] = useState<Record<string, boolean>>(() =>
    QA_CHECKLIST.reduce((acc, c) => ({ ...acc, [c.id]: false }), {}),
  );
  const [step7Note, setStep7Note] = useState("");
  const [step7Lh, setStep7Lh] = useState<number | null>(null);

  const [isBusy, startTransition] = useTransition();

  const allQADone = useMemo(() => QA_CHECKLIST.every((c) => Boolean(step7QA[c.id])), [step7QA]);

  const workflowStatus: PublicationStatus = useMemo(() => {
    if (tenant.published) return "published";
    if (step >= 8) return "validated";
    if (allQADone) return "ready_for_qa";
    return "draft";
  }, [tenant.published, step, allQADone]);

  function openMedia(field: string) {
    setMediaField(field);
    setShowMedia(true);
  }

  function onMediaConfirm(selected: MediaLibraryRow) {
    if (!selected || !mediaField) {
      setShowMedia(false);
      setMediaField(null);
      return;
    }
    const url = `https://media.velora.test/placeholder/${encodeURIComponent(selected.stored_path)}`;
    const alt = selected.alt_text || selected.filename_orig || "";
    if (mediaField === "logo") {
      setStep3LogoUrl(url);
      setStep3LogoAlt(alt);
    } else if (mediaField === "hero") {
      setStep4Hero(url);
    } else if (mediaField === "gallery1") {
      const n: [string, string, string] = [...step4Gallery];
      n[0] = url;
      setStep4Gallery(n);
    } else if (mediaField === "gallery2") {
      const n: [string, string, string] = [...step4Gallery];
      n[1] = url;
      setStep4Gallery(n);
    } else if (mediaField === "gallery3") {
      const n: [string, string, string] = [...step4Gallery];
      n[2] = url;
      setStep4Gallery(n);
    } else if (mediaField === "staff1") {
      const n: [string, string] = [...step4Staff];
      n[0] = url;
      setStep4Staff(n);
    } else if (mediaField === "staff2") {
      const n: [string, string] = [...step4Staff];
      n[1] = url;
      setStep4Staff(n);
    }
    setShowMedia(false);
    setMediaField(null);
  }

  function canGoNext(): string | null {
    if (step === 1) {
      if (!step1.business_name.trim()) return "Nome attività obbligatorio";
      if (!step1.phone.trim()) return "Telefono obbligatorio";
      if (!step1.email.trim()) return "Email obbligatoria";
      if (!step1.address.trim()) return "Città / Indirizzo obbligatorio";
      return null;
    }
    if (step === 2) return null;
    if (step === 3) return null;
    if (step === 4) return null;
    if (step === 5) {
      if (step5.seo_title.length < 10) return "SEO title troppo corto (<10)";
      if (step5.seo_desc.length < 40) return "SEO description troppo corta (<40)";
      return null;
    }
    if (step === 6) return null;
    if (step === 7) {
      if (!allQADone) return "Devi spuntare TUTTI i punti della checklist QA";
      if (step7Lh != null && step7Lh < 80) return "Lighthouse minimo 80/100";
      return null;
    }
    if (step === 8) return null;
    if (step === 9) {
      if (workflowStatus !== "validated" && workflowStatus !== "published") {
        return "Stato non VALIDATO. Torna a Step 7 e completa la checklist QA";
      }
      return null;
    }
    return null;
  }

  const nextError = canGoNext();

  function gotoPrev() {
    setMsg(null);
    setStep((s) => Math.max(1, s - 1) as WizardStep);
  }

  function gotoNext() {
    const err = canGoNext();
    if (err) {
      setMsg({ type: "err", text: err });
      return;
    }
    if (step === 7) {
      startTransition(async () => {
        setMsg(null);
        let ok = true;
        let finalMsg = "Stato Validato ✓ Pronto per pubblicazione";
        try {
          const fd1 = new FormData();
          fd1.append("from_status", "draft");
          fd1.append("to_status", "ready_for_qa");
          fd1.append("tenant_slug", tenant.slug);
          fd1.append("note", "Wizard onboarding checklist QA superata");
          const initPrev: TransitionPublicationResult = { ok: false, error: "init" };
          const r1 = await transitionPublicationAction(initPrev, fd1);
          if (r1 && !("ok" in r1 && r1.ok)) {
            ok = false;
            finalMsg =
              "Transizione READY fallita: " + ("error" in r1 ? r1.error : "errore sconosciuto");
          } else {
            const fd2 = new FormData();
            fd2.append("from_status", "ready_for_qa");
            fd2.append("to_status", "validated");
            fd2.append("tenant_slug", tenant.slug);
            fd2.append("note", "Validato da SUPER_ADMIN wizard onboard");
            const initPrev2: TransitionPublicationResult = { ok: false, error: "init2" };
            const r2 = await transitionPublicationAction(initPrev2, fd2);
            if (r2 && !("ok" in r2 && r2.ok)) {
              ok = false;
              finalMsg =
                "Transizione VALIDATED fallita: " +
                ("error" in r2 ? r2.error : "errore sconosciuto");
            }
          }
        } catch (_e) {
          ok = false;
          finalMsg = "Errore transizioni workflow";
        }
        setMsg({ type: ok ? "ok" : "err", text: finalMsg });
        if (ok) setStep(8 as WizardStep);
      });
      return;
    }
    setMsg(null);
    setStep((s) => Math.min(9, s + 1) as WizardStep);
  }

  function handlePublish() {
    if (workflowStatus !== "validated" && workflowStatus !== "published") {
      setMsg({
        type: "err",
        text: "Devi validare (stato VALIDATED) prima di pubblicare. Torna a Step 7.",
      });
      return;
    }
    startTransition(async () => {
      setMsg(null);
      try {
        const fd = new FormData();
        fd.append("tenant_slug", tenant.slug);
        fd.append("note", "Pubblicazione iniziale da wizard onboard");
        const initPrev: EditorialActionResult = { ok: false, error: "init" };
        const r = await publishEditorialAction(initPrev, fd);
        const ok = r && "ok" in r && r.ok;
        setMsg({
          type: ok ? "ok" : "err",
          text: ok
            ? "SITO PUBBLICATO ✓ Apri l'URL pubblico per verificarlo"
            : "Pubblicazione fallita: " + (r && "error" in r ? r.error : "errore sconosciuto"),
        });
      } catch {
        setMsg({ type: "err", text: "Errore pubblicazione" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="text-xs text-slate-500">Prospect → Tenant Onboarding Wizard</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {step1.business_name || tenant.business_name}
          </h1>
          <div className="mt-1 text-sm text-slate-600">
            Tenant <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{tenant.slug}</code>
            {" · "}Step {step}/9 — {STEP_TITLES[step]}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset " +
              (workflowStatus === "published"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : workflowStatus === "validated"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : workflowStatus === "ready_for_qa"
                    ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200")
            }
          >
            {PUBLICATION_STATUS_LABEL[workflowStatus]}
          </span>
          <Link
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            href={`/app/admin/prospects/${prospectId}`}
          >
            ← Torna al prospetto
          </Link>
          <Link
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            href={`/app/site/${tenant.slug}`}
          >
            Apri SiteStudio →
          </Link>
        </div>
      </header>

      <nav aria-label="Progress">
        <ol className="flex w-full items-center gap-1 overflow-x-auto text-xs font-medium text-slate-500 sm:text-sm">
          {([1, 2, 3, 4, 5, 6, 7, 8, 9] as WizardStep[]).map((n, idx) => {
            const isPast = n < step;
            const isCurrent = n === step;
            return (
              <li key={n} className="flex flex-1 items-center">
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 " +
                    (isPast
                      ? "bg-emerald-600 text-white ring-emerald-600"
                      : isCurrent
                        ? "bg-sky-600 text-white ring-sky-600"
                        : "bg-white text-slate-500 ring-slate-300")
                  }
                >
                  {isPast ? "✓" : n}
                </span>
                <span
                  className={
                    "ml-2 hidden whitespace-nowrap sm:block " +
                    (isCurrent ? "font-bold text-slate-900" : "")
                  }
                >
                  {STEP_TITLES[n]}
                </span>
                {idx < 8 ? (
                  <div
                    className={
                      "mx-1 h-0.5 w-full sm:mx-3 " + (isPast ? "bg-emerald-500" : "bg-slate-200")
                    }
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>

      {lastMsg ? (
        <div
          role="alert"
          className={
            "rounded-lg border px-4 py-3 text-sm " +
            (lastMsg.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800")
          }
        >
          {lastMsg.text}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-6 p-6">
          {step === 1 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 1 — Dati attività</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Nome attività *</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.business_name}
                    onChange={(e) => setStep1((s) => ({ ...s, business_name: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Categoria</span>
                  <select
                    className={CLS_INPUT}
                    value={step1.business_category}
                    onChange={(e) => setStep1((s) => ({ ...s, business_category: e.target.value }))}
                  >
                    <option value="parrucchiere">Parrucchiere / Hair Salon</option>
                    <option value="estetista">Estetista / Beauty Center</option>
                    <option value="barbiere">Barbiere / Barber Shop</option>
                    <option value="service_business">Altro servizio locale</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Telefono *</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.phone}
                    onChange={(e) => setStep1((s) => ({ ...s, phone: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Email *</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.email}
                    onChange={(e) => setStep1((s) => ({ ...s, email: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Città / Indirizzo *</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.address}
                    onChange={(e) => setStep1((s) => ({ ...s, address: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">P.IVA / CF</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.vat}
                    onChange={(e) => setStep1((s) => ({ ...s, vat: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Instagram</span>
                  <input
                    className={CLS_INPUT}
                    value={step1.instagram}
                    placeholder="@nomeprofilo"
                    onChange={(e) => setStep1((s) => ({ ...s, instagram: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Descrizione breve</span>
                  <textarea
                    className={CLS_INPUT + " min-h-[96px]"}
                    rows={3}
                    value={step1.description}
                    onChange={(e) => setStep1((s) => ({ ...s, description: e.target.value }))}
                  />
                </label>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 2 — Servizi</h2>
              <p className="text-sm text-slate-600">
                I servizi sono stati generati automaticamente dal seed della categoria &quot;
                <b>{prospect.business_category || step1.business_category}</b>&quot;. Modificali in
                SiteStudio (nomi, prezzi, durate, descrizioni).
              </p>
              <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="font-semibold">Seed servizi pronti</div>
                <Link
                  className="mt-1 inline-block text-sky-700 underline"
                  href={`/app/site/${tenant.slug}#services`}
                >
                  Modifica lista servizi in SiteStudio →
                </Link>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 3 — Tema e Branding</h2>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">Preset tema</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  {Object.values(DESIGN_PRESETS).map((preset) => {
                    const selected = step3Preset === preset.id;
                    const primary = preset.palette.primary;
                    const accent = preset.palette.accent;
                    const card = preset.palette.card;
                    const cssVars: Record<string, string> = {
                      "--primary": primary,
                      "--p": primary,
                      "--accent": accent,
                      "--card": card,
                      "--background": preset.palette.background,
                      "--foreground": preset.palette.foreground,
                      "--muted": preset.palette.muted,
                      "--border": preset.palette.border,
                      "--secondary": preset.palette.secondary,
                      "--site-primary": primary,
                      "--site-bg": preset.palette.background,
                      "--site-fg": preset.palette.foreground,
                      "--site-muted": preset.palette.muted,
                    };
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={
                          "rounded-lg border-2 p-4 text-left transition-all " +
                          (selected
                            ? "border-sky-600 ring-2 ring-sky-200"
                            : "border-slate-200 hover:border-slate-300")
                        }
                        onClick={() => {
                          setStep3Preset(preset.id);
                          setStep3Primary(primary);
                          setStep3Accent(accent);
                        }}
                        style={cssVars as unknown as React.CSSProperties}
                      >
                        <div className="text-base font-semibold">{preset.name}</div>
                        <p className="mt-1 text-xs text-slate-600">{preset.description}</p>
                        <div className="mt-3 flex gap-2">
                          <span
                            className="h-4 w-4 rounded-full"
                            style={{ backgroundColor: primary }}
                          />
                          <span
                            className="h-4 w-4 rounded-full"
                            style={{ backgroundColor: accent }}
                          />
                          <span
                            className="h-4 w-4 rounded-full ring-1 ring-slate-200"
                            style={{ backgroundColor: card }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Colore primario (override)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-10 w-16 rounded border border-slate-300"
                      value={step3Primary}
                      onChange={(e) => setStep3Primary(e.target.value)}
                    />
                    <input
                      className={CLS_INPUT}
                      value={step3Primary}
                      onChange={(e) => setStep3Primary(e.target.value)}
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Colore accento (override)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-10 w-16 rounded border border-slate-300"
                      value={step3Accent}
                      onChange={(e) => setStep3Accent(e.target.value)}
                    />
                    <input
                      className={CLS_INPUT}
                      value={step3Accent}
                      onChange={(e) => setStep3Accent(e.target.value)}
                    />
                  </div>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 font-semibold">Logo attività</div>
                {step3LogoUrl ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <img
                      className="h-16 w-16 rounded border border-slate-200 object-contain bg-white"
                      src={step3LogoUrl}
                      alt={step3LogoAlt || "logo"}
                    />
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-xs text-slate-600">Alt text:</div>
                      <input
                        className={CLS_INPUT}
                        value={step3LogoAlt}
                        onChange={(e) => setStep3LogoAlt(e.target.value)}
                      />
                    </div>
                    <button
                      className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => openMedia("logo")}
                      type="button"
                    >
                      Cambia
                    </button>
                  </div>
                ) : (
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => openMedia("logo")}
                    type="button"
                  >
                    Seleziona logo da Media Manager
                  </button>
                )}
              </div>
            </div>
          ) : step === 4 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Step 4 — Galleria, Staff e Copertina
              </h2>
              <div className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">Immagine copertina Hero</div>
                    <p className="text-sm text-slate-600">16:9, almeno 1920×1080px</p>
                  </div>
                  {step4Hero ? (
                    <button
                      className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => openMedia("hero")}
                      type="button"
                    >
                      Cambia
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => openMedia("hero")}
                      type="button"
                    >
                      Scegli immagine
                    </button>
                  )}
                </div>
                {step4Hero ? (
                  <img
                    className="mt-2 max-h-64 w-full rounded-lg object-cover"
                    src={step4Hero}
                    alt="copertina hero"
                  />
                ) : null}
              </div>
              <div className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-2 font-semibold">Galleria (3 immagini)</div>
                <div className="grid gap-3 md:grid-cols-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="aspect-square overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50"
                    >
                      {step4Gallery[i] ? (
                        <div className="relative h-full w-full">
                          <img
                            className="h-full w-full object-cover"
                            src={step4Gallery[i]}
                            alt={`galleria ${i + 1}`}
                          />
                          <button
                            className="absolute bottom-2 right-2 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => openMedia("gallery" + (i + 1))}
                            type="button"
                          >
                            Cambia
                          </button>
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => openMedia("gallery" + (i + 1))}
                            type="button"
                          >
                            Aggiungi {i + 1}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-2 font-semibold">Staff (2 membri)</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="aspect-square overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50"
                    >
                      {step4Staff[i] ? (
                        <div className="relative h-full w-full">
                          <img
                            className="h-full w-full object-cover"
                            src={step4Staff[i]}
                            alt={`staff ${i + 1}`}
                          />
                          <button
                            className="absolute bottom-2 right-2 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => openMedia("staff" + (i + 1))}
                            type="button"
                          >
                            Cambia
                          </button>
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => openMedia("staff" + (i + 1))}
                            type="button"
                          >
                            Aggiungi {i + 1}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : step === 5 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 5 — Contenuti e SEO</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Titolo Hero</span>
                  <input
                    className={CLS_INPUT}
                    value={step5.hero_title}
                    onChange={(e) => setStep5((s) => ({ ...s, hero_title: e.target.value }))}
                    placeholder="Es. Parrucchiere a Milano — Stile e Qualità dal 1990"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Sottotitolo Hero</span>
                  <input
                    className={CLS_INPUT}
                    value={step5.hero_sub}
                    onChange={(e) => setStep5((s) => ({ ...s, hero_sub: e.target.value }))}
                    placeholder="Slogan / promessa al cliente"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Testo CTA pulsante</span>
                  <input
                    className={CLS_INPUT}
                    value={step5.cta}
                    onChange={(e) => setStep5((s) => ({ ...s, cta: e.target.value }))}
                    placeholder="Prenota ora"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">
                    Testo sezione Chi Siamo (About)
                  </span>
                  <textarea
                    className={CLS_INPUT + " min-h-[128px]"}
                    rows={4}
                    value={step5.about}
                    onChange={(e) => setStep5((s) => ({ ...s, about: e.target.value }))}
                  />
                </label>
                <div className="md:col-span-2 rounded border border-amber-100 bg-amber-50 p-3 text-xs">
                  <div className="text-sm font-semibold text-amber-900">
                    SEO — Title e Description
                  </div>
                  <div className="text-amber-800">
                    Questi campi appariranno nel tag <code>{`<title>`}</code> e in meta description
                    per Google Local Pack.
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">SEO Title (50-60 caratteri) *</span>
                  <input
                    className={CLS_INPUT}
                    maxLength={80}
                    value={step5.seo_title}
                    onChange={(e) => setStep5((s) => ({ ...s, seo_title: e.target.value }))}
                  />
                  <span className="text-xs text-slate-500">{step5.seo_title.length}/80</span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Meta Description (140-160) *</span>
                  <textarea
                    className={CLS_INPUT}
                    rows={3}
                    maxLength={200}
                    value={step5.seo_desc}
                    onChange={(e) => setStep5((s) => ({ ...s, seo_desc: e.target.value }))}
                  />
                  <span className="text-xs text-slate-500">{step5.seo_desc.length}/200</span>
                </label>
              </div>
            </div>
          ) : step === 6 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 6 — Anteprima</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 font-semibold text-slate-800">
                    Riepilogo
                  </div>
                  <div className="p-5">
                    <ul className="space-y-1 text-sm">
                      <li>
                        <b>Nome:</b> {step1.business_name}
                      </li>
                      <li>
                        <b>Categoria:</b> {step1.business_category}
                      </li>
                      <li>
                        <b>Tel:</b>{" "}
                        <a className="text-sky-700 underline" href={"tel:" + step1.phone}>
                          {step1.phone}
                        </a>
                      </li>
                      <li>
                        <b>Email:</b>{" "}
                        <a className="text-sky-700 underline" href={"mailto:" + step1.email}>
                          {step1.email}
                        </a>
                      </li>
                      <li>
                        <b>Città:</b> {step1.address}
                      </li>
                      <li>
                        <b>Slug tenant:</b> <code>{tenant.slug}</code>
                      </li>
                      <li>
                        <b>Stato workflow:</b>{" "}
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                          {PUBLICATION_STATUS_LABEL[workflowStatus]}
                        </span>
                      </li>
                      <li>
                        <b>Checklist QA:</b> {QA_CHECKLIST.filter((c) => step7QA[c.id]).length}/
                        {QA_CHECKLIST.length}
                      </li>
                    </ul>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 font-semibold text-slate-800">
                    URL pubblici (dopo pubblicazione)
                  </div>
                  <div className="p-5">
                    <ul className="space-y-2 text-sm">
                      <li>
                        ✅ SiteStudio:{" "}
                        <Link className="text-sky-700 underline" href={`/app/site/${tenant.slug}`}>
                          apri
                        </Link>
                      </li>
                      <li>
                        🌐 Sito temp:{" "}
                        <Link
                          className="text-sky-700 underline"
                          href={`/s/${tenant.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          /s/{tenant.slug}
                        </Link>
                      </li>
                      <li>
                        🗺️ Sitemap:{" "}
                        <Link
                          className="text-sky-700 underline"
                          href={`/s/${tenant.slug}/sitemap.xml`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          apri
                        </Link>
                      </li>
                      <li>
                        🤖 Robots:{" "}
                        <Link
                          className="text-sky-700 underline"
                          href={`/s/${tenant.slug}/robots.txt`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          apri
                        </Link>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                <span className="font-semibold">Azione:</span>
                Apri l&apos;anteprima e verifica manualmente. Vedi problemi? Torna indietro e
                correggi.
                <Link
                  className="ml-auto rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800"
                  href={`/s/${tenant.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🔍 Apri anteprima pubblica
                </Link>
              </div>
            </div>
          ) : step === 7 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-rose-700">
                Step 7 — Controllo Qualità (BLOCCANTE)
              </h2>
              <p className="text-sm text-slate-600">
                Devi spuntare <b>TUTTI</b> i punti per procedere. Questo step marca il passaggio di
                stato READY_FOR_QA → VALIDATO automaticamente al prossimo step.
              </p>
              <div className="space-y-2 rounded border border-rose-200 bg-rose-50 p-4">
                {QA_CHECKLIST.map((item, idx) => (
                  <label key={item.id} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={Boolean(step7QA[item.id])}
                      onChange={(e) => setStep7QA((s) => ({ ...s, [item.id]: e.target.checked }))}
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-800">
                        {idx + 1}. {item.label}
                      </div>
                      {item.hint ? <div className="text-xs text-slate-500">{item.hint}</div> : null}
                    </div>
                  </label>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Lighthouse score 0-100</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={CLS_INPUT}
                    value={step7Lh == null ? "" : step7Lh}
                    onChange={(e) =>
                      setStep7Lh(e.target.value === "" ? null : Number(e.target.value))
                    }
                    placeholder="Inserisci il punteggio medio da /scripts/lighthouse-check.mjs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Note Supervisor QA</span>
                  <textarea
                    className={CLS_INPUT + " min-h-[96px]"}
                    rows={3}
                    value={step7Note}
                    onChange={(e) => setStep7Note(e.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : step === 8 ? (
            <DomainPanel slug={tenant.slug} />
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">Step 9 — Pubblicazione</h2>
              <div
                className={
                  "rounded-lg border p-4 text-sm " +
                  (workflowStatus === "published"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-sky-200 bg-sky-50")
                }
              >
                <div className="font-semibold">
                  {workflowStatus === "published"
                    ? "Già pubblicato ✓"
                    : "Pronto per la pubblicazione"}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>
                    Sito temp:{" "}
                    <Link
                      className="font-semibold underline"
                      href={`/s/${tenant.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      /s/{tenant.slug}
                    </Link>
                  </li>
                  <li>Stato workflow: {PUBLICATION_STATUS_LABEL[workflowStatus]}</li>
                  <li>Ultima pubblicazione: {tenant.published ? "attiva" : "mai pubblicata"}</li>
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1"
                  onClick={handlePublish}
                  disabled={
                    isBusy || (workflowStatus !== "validated" && workflowStatus !== "published")
                  }
                  type="button"
                >
                  🚀 Pubblica Sito (definitivo)
                </button>
                <Link
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100"
                  href={`/s/${tenant.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verifica sito pubblico
                </Link>
                <Link
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  href={`/app/site/${tenant.slug}`}
                >
                  Vai a SiteStudio
                </Link>
                {tenant.custom_domain ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Dominio custom: {tenant.custom_domain}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={gotoPrev}
          disabled={step === 1}
          type="button"
        >
          ← Indietro
        </button>
        {step < 9 ? (
          <button
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1"
            onClick={gotoNext}
            disabled={Boolean(nextError) || isBusy}
            type="button"
          >
            {step === 7 ? "Contrassegna QA → Valida" : "Avanti →"}
          </button>
        ) : null}
      </div>

      <MediaPicker
        open={showMedia}
        onCancel={() => {
          setShowMedia(false);
          setMediaField(null);
        }}
        onConfirm={onMediaConfirm}
        initialCategory="general"
        ownerTenantId={tenant.id}
        allowUpload
        searchPlaceholder={"Cerca o carica: " + (mediaField ?? "media")}
      />
    </div>
  );
}

function DomainPanel({ slug }: { slug: string }) {
  const [st, setSt] = useState<DomainStateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [custom, setCustom] = useState<string>("");

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await getDomainState();
      if (r && "ok" in r && r.ok) {
        setSt(r as DomainStateResult);
      } else {
        setMsg("Errore: " + (r && "error" in r ? r.error : "sconosciuto"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!st) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Step 8 — Dominio</h2>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 hover:bg-slate-800"
        >
          Carica stato dominio
        </button>
      </div>
    );
  }

  async function addDom() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("tenant_slug", slug);
      fd.append("domain", custom.trim());
      const initPrev: DomainActionResult = { ok: false, error: "init" };
      const r = await addCustomDomainAction(initPrev, fd);
      const ok = r && "ok" in r && r.ok;
      setMsg(ok ? "Aggiunto! Verifica DNS..." : r && "error" in r ? r.error : "errore");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function verifyDom() {
    setBusy(true);
    try {
      const r = await verifyCustomDomainAction();
      const ok = r && "ok" in r && r.ok;
      setMsg(ok ? "Verificato ✓" : r && "error" in r ? r.error : "errore verifica");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeDom() {
    setBusy(true);
    try {
      const r = await removeCustomDomainAction();
      const ok = r && "ok" in r && r.ok;
      setMsg(ok ? "Rimosso" : r && "error" in r ? r.error : "errore");
      setCustom("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const badgeClass =
    st.status === "verified"
      ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
      : st.status === "failed"
        ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700"
        : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Step 8 — Dominio</h2>
      {msg ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{msg}</div>
      ) : null}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-3 text-sm font-semibold">
          Stato dominio
        </div>
        <div className="space-y-4 p-6">
          <ul className="space-y-1 text-sm">
            <li>
              Dominio custom: <b>{st.customDomain ?? "(non impostato)"}</b>
            </li>
            <li>
              Dominio temporaneo:{" "}
              <code className="rounded bg-slate-100 px-1">
                {st.temporaryDomain ?? slug + ".velora.site"}
              </code>
            </li>
            <li>
              Stato: <span className={badgeClass}>{st.status}</span>
            </li>
            <li>
              Token verifica:{" "}
              <code className="break-all text-xs rounded bg-slate-100 px-1">
                {st.verificationToken}
              </code>
            </li>
            <li>Routing Ready: {st.routingReady ? "✅ Sì" : "❌ No"}</li>
            <li>
              Target CNAME: <code className="rounded bg-slate-100 px-1">{st.targetCname}</code>
            </li>
            <li>
              Target A (IPv4): <code className="rounded bg-slate-100 px-1">{st.targetA}</code>
            </li>
            <li>
              Canonical URL:{" "}
              <code className="rounded bg-slate-100 px-1">{st.canonicalUrl ?? "—"}</code>
            </li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={CLS_INPUT + " min-w-[280px]"}
          placeholder="mioattivita.it"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !custom.trim()}
          onClick={addDom}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 hover:bg-slate-800"
        >
          Aggiungi dominio
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={verifyDom}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-60 hover:bg-slate-50"
        >
          Verifica DNS
        </button>
        <button
          type="button"
          disabled={busy || !st.customDomain}
          onClick={removeDom}
          className="rounded-md px-4 py-2 text-sm text-slate-700 disabled:opacity-60 hover:bg-slate-100"
        >
          Rimuovi
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-800 disabled:opacity-60 hover:bg-slate-200"
        >
          Ricarica
        </button>
      </div>
    </div>
  );
}
