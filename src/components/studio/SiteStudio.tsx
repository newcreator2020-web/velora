"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  saveEditorialAction,
  publishEditorialAction,
  unpublishEditorialAction,
  type EditorialInitialState,
} from "@/app/app/site/actions";
import {
  SECTION_TYPES,
  ALLOWED_VARIANTS,
  SINGLETON_TYPES,
  FONT_HEADING_ALLOWED,
  FONT_BODY_ALLOWED,
  RADIUS_ALLOWED,
  validateHexColor,
  type SectionType,
} from "@/lib/server/content-engine";
type SectionVariant = (typeof ALLOWED_VARIANTS)[number];
import {
  CURRENCY_ALLOWED,
  type Currency,
  type StudioDraftSection,
  type StudioDraftService,
  type StudioDraftTheme,
} from "@/lib/server/site-studio-pure";

type Props = EditorialInitialState;

type SaveState = Awaited<ReturnType<typeof saveEditorialAction>>;
type PublishState = Awaited<ReturnType<typeof publishEditorialAction>>;
type UnpublishState = Awaited<ReturnType<typeof unpublishEditorialAction>>;

function SubmitButton({
  label,
  loadingLabel,
  variant = "primary",
  disabled,
}: {
  label: string;
  loadingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const status = useFormStatus();
  const pending = status.pending || false;
  const isDisabled = disabled || pending;
  const classes = [
    "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
    variant === "primary" &&
      "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500",
    variant === "secondary" &&
      "bg-white text-slate-900 border-slate-300 hover:bg-slate-50 focus:ring-slate-300",
    variant === "ghost" &&
      "bg-transparent text-slate-700 border-transparent hover:bg-slate-100 focus:ring-slate-300",
    variant === "danger" &&
      "bg-red-600 text-white border-red-600 hover:bg-red-700 focus:ring-red-500",
    isDisabled ? "opacity-60 cursor-not-allowed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="submit" disabled={isDisabled} className={classes} aria-busy={pending}>
      {pending && loadingLabel ? loadingLabel : label}
    </button>
  );
}

function Alert({
  kind,
  message,
  title,
}: {
  kind: "success" | "error" | "info";
  message?: string;
  title?: string;
}) {
  if (!message && !title) return null;
  const styles =
    kind === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : kind === "error"
        ? "bg-red-50 border-red-200 text-red-800"
        : "bg-sky-50 border-sky-200 text-sky-800";
  const msg = message ?? "";
  const tit = title ?? "";
  return (
    <div role="status" aria-live="polite" className={`border rounded-lg p-3 text-sm ${styles}`}>
      {tit ? <p className="font-semibold mb-0.5">{tit}</p> : null}
      {msg ? <p className="opacity-90">{msg}</p> : null}
    </div>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {actions}
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

type RowProps = {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  children: React.ReactNode;
};
function Row({ label, htmlFor, error, children }: RowProps) {
  const id = htmlFor;
  const errId = error && id ? `${id}-err` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <div>{children}</div>
      {error && errId ? (
        <p id={errId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> & {
  error?: string | undefined;
};
const Input = ({ error, className, id, "aria-describedby": des, ...rest }: InputProps) => {
  const errId = error && id ? `${id}-err` : undefined;
  return (
    <input
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={[des, errId].filter(Boolean).join(" ") || undefined}
      className={[
        "block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2",
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-300"
          : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-300",
        className || "",
      ].join(" ")}
      {...rest}
    />
  );
};

const Textarea = ({
  error,
  className,
  id,
  ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "error"> & {
  error?: string | undefined;
}) => {
  const errId = error && id ? `${id}-err` : undefined;
  return (
    <textarea
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={[rest["aria-describedby"], errId].filter(Boolean).join(" ") || undefined}
      className={[
        "block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2",
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-300"
          : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-300",
        className || "",
      ].join(" ")}
      {...rest}
    />
  );
};

const Select = ({
  error,
  className,
  id,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "error"> & {
  error?: string | undefined;
}) => {
  const errId = error && id ? `${id}-err` : undefined;
  return (
    <select
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={[rest["aria-describedby"], errId].filter(Boolean).join(" ") || undefined}
      className={[
        "block w-full rounded-md border px-3 py-2 text-sm shadow-sm bg-white focus:outline-none focus:ring-2",
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-300"
          : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-300",
        className || "",
      ].join(" ")}
      {...rest}
    />
  );
};

const Checkbox = ({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label htmlFor={id} className="inline-flex items-center gap-2 text-sm text-slate-700 select-none">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
    />
    {label}
  </label>
);

export function SiteStudio(props: Props) {
  const initialState: SaveState = {
    ok: false,
    error: props.error,
    values: props.values,
  };

  const initialPublishState: PublishState = initialState as unknown as PublishState;
  const initialUnpublishState: UnpublishState = initialState as unknown as UnpublishState;

  const [saveState, saveAction] = useFormState(
    saveEditorialAction as unknown as (p: SaveState, f: FormData) => Promise<SaveState>,
    initialState,
  );
  const [publishState, publishAction] = useFormState(
    publishEditorialAction as unknown as (p: PublishState, f: FormData) => Promise<PublishState>,
    initialPublishState,
  );
  const [unpublishState, unpublishAction] = useFormState(
    unpublishEditorialAction as unknown as (
      p: UnpublishState,
      f: FormData,
    ) => Promise<UnpublishState>,
    initialUnpublishState,
  );

  const currentValues: {
    sections: StudioDraftSection[];
    services: StudioDraftService[];
    theme: StudioDraftTheme;
  } =
    (saveState.ok || (saveState as { values?: unknown }).values
      ? (saveState as { values: NonNullable<typeof saveState.values> }).values
      : publishState.ok || (publishState as { values?: unknown }).values
        ? (publishState as { values: NonNullable<typeof saveState.values> }).values
        : unpublishState.ok || (unpublishState as { values?: unknown }).values
          ? (unpublishState as { values: NonNullable<typeof saveState.values> }).values
          : props.values) ?? props.values;

  const revision = useMemo<string | null>(() => {
    if (saveState.ok) return saveState.revision;
    if (publishState.ok) return publishState.revision;
    if (unpublishState.ok) return unpublishState.revision;
    return props.state.revision;
  }, [saveState, publishState, unpublishState, props.state.revision]);

  return (
    <SiteStudioInner
      key={revision ?? "initial-studio-mount"}
      outer={{
        props,
        saveState,
        saveAction,
        publishState,
        publishAction,
        unpublishState,
        unpublishAction,
        currentValues,
        revision,
      }}
    />
  );
}

type InnerOuter = {
  props: Props;
  saveState: SaveState;
  saveAction: ReturnType<typeof useFormState<SaveState, FormData>>[1];
  publishState: PublishState;
  publishAction: ReturnType<typeof useFormState<PublishState, FormData>>[1];
  unpublishState: UnpublishState;
  unpublishAction: ReturnType<typeof useFormState<UnpublishState, FormData>>[1];
  currentValues: {
    sections: StudioDraftSection[];
    services: StudioDraftService[];
    theme: StudioDraftTheme;
  };
  revision: string | null;
};

type FieldErrors = Partial<Record<string, string[]>>;

function fieldErrorFor(fieldErrors: FieldErrors | undefined, path: string): string | undefined {
  if (!fieldErrors) return undefined;
  const arr = fieldErrors[path];
  if (!arr || arr.length === 0) return undefined;
  return arr[0];
}

function fieldErrorsDomId(path: string): string | null {
  // sections.0.section_type -> sect-0-type
  // services.0.name -> svc-0-name
  // theme.primary -> theme-primary-text
  // theme.background -> theme-bg-text
  // theme.foreground -> theme-fg-text
  // theme.muted -> theme-muted-text
  // theme.radius -> theme-radius
  // theme.headingFont -> theme-head
  // theme.bodyFont -> theme-body
  const sec = /^sections\.(\d+)\.(section_type|variant|enabled)$/.exec(path);
  if (sec) {
    const i = sec[1];
    const k = sec[2] === "section_type" ? "type" : sec[2];
    return `sect-${i}-${k}`;
  }
  const svc =
    /^services\.(\d+)\.(name|price_from|duration_minutes|currency|active|description)$/.exec(path);
  if (svc) {
    const i = svc[1] as string;
    const svcField = svc[2] as
      "name" | "price_from" | "duration_minutes" | "currency" | "active" | "description";
    const map: Record<typeof svcField, string> = {
      name: "name",
      price_from: "price",
      duration_minutes: "dur",
      currency: "currency",
      active: "active",
      description: "desc",
    };
    return `svc-${i}-${map[svcField]}`;
  }
  const th = /^theme\.(primary|background|foreground|muted|radius|headingFont|bodyFont)$/.exec(
    path,
  );
  if (th) {
    const k = th[1] as
      "primary" | "background" | "foreground" | "muted" | "radius" | "headingFont" | "bodyFont";
    const map: Record<typeof k, string> = {
      primary: "theme-primary-text",
      background: "theme-bg-text",
      foreground: "theme-fg-text",
      muted: "theme-muted-text",
      radius: "theme-radius",
      headingFont: "theme-head",
      bodyFont: "theme-body",
    };
    return map[k];
  }
  return null;
}

function SiteStudioInner({ outer }: { outer: InnerOuter }) {
  const {
    props,
    saveState,
    saveAction,
    publishState,
    publishAction,
    unpublishState,
    unpublishAction,
    currentValues,
    revision,
  } = outer;
  const [sections, setSections] = useState<StudioDraftSection[]>(currentValues.sections);
  const [services, setServices] = useState<StudioDraftService[]>(currentValues.services);
  const [theme, setTheme] = useState<StudioDraftTheme>(currentValues.theme);
  const focusOnceRef = useRef<string | null>(null);

  const publishedNow = publishState.ok && publishState.info?.kind === "PUBLISHED";
  const unpublishedNow = unpublishState.ok && unpublishState.info?.kind === "UNPUBLISHED";
  const savedNow = saveState.ok && saveState.info?.kind === "SAVED";

  const { state } = props;
  const published = publishedNow ? true : unpublishedNow ? false : state.published;
  const slug = state.slug;

  const publicUrl = slug ? `/s/${slug}` : null;

  const saveErr = saveState.ok ? "" : ((saveState as { error?: string }).error ?? "");
  const pubErr = publishState.ok ? "" : ((publishState as { error?: string }).error ?? "");
  const unpubErr = unpublishState.ok ? "" : ((unpublishState as { error?: string }).error ?? "");

  const fieldErrors: FieldErrors | undefined =
    (!saveState.ok && (saveState as { fieldErrors?: FieldErrors }).fieldErrors) ||
    (!publishState.ok && (publishState as { fieldErrors?: FieldErrors }).fieldErrors) ||
    undefined;

  const stamp =
    (saveState as { updated_at?: string }).updated_at ||
    (publishState as { updated_at?: string }).updated_at ||
    "";
  useEffect(() => {
    if (!fieldErrors) return;
    const paths = Object.keys(fieldErrors);
    if (paths.length === 0) return;
    const token = `${stamp}|${paths.join(",")}`;
    if (focusOnceRef.current === token) return;
    focusOnceRef.current = token;
    for (const p of paths) {
      const id = fieldErrorsDomId(p);
      if (!id) continue;
      const el = document.getElementById(id);
      if (el && typeof (el as HTMLElement).focus === "function") {
        (el as HTMLElement).focus({ preventScroll: false });
        return;
      }
    }
  }, [fieldErrors, stamp]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">
              Gestione Sito
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              {state.business_name || "Attività"} · Slug pubblico:{" "}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                {slug || "(non impostato)"}
              </code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/app/site/preview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
            >
              Anteprima privata
              <span aria-hidden>↗</span>
            </a>
            <a
              href={publicUrl || "#"}
              target={publicUrl && published ? "_blank" : undefined}
              rel={publicUrl && published ? "noopener noreferrer" : undefined}
              aria-disabled={!publicUrl || !published ? "true" : undefined}
              className={[
                "inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border",
                publicUrl && published
                  ? "bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
                  : "bg-slate-100 text-slate-400 border-slate-200 pointer-events-none",
              ].join(" ")}
            >
              Sito pubblico
              <span aria-hidden>↗</span>
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-4 sm:pb-5 flex flex-wrap gap-3 items-center">
          <div
            className={[
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
              published
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "inline-block h-2 w-2 rounded-full",
                published ? "bg-emerald-500" : "bg-amber-500",
              ].join(" ")}
            />
            {published ? "Pubblicato" : "Bozza (non visibile al pubblico)"}
          </div>
          {state.published_at && published ? (
            <span className="text-xs text-slate-600">
              Ultima pubblicazione:{" "}
              <time dateTime={state.published_at}>
                {new Date(state.published_at).toLocaleString("it-IT")}
              </time>
            </span>
          ) : null}
          {props.entitlements ? (
            <div
              className={[
                "ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
                props.entitlements.planId === "pro" || props.entitlements.planId === "internal_test"
                  ? "bg-indigo-50 text-indigo-800 border-indigo-200"
                  : "bg-slate-100 text-slate-700 border-slate-300",
              ].join(" ")}
              role="status"
            >
              <span aria-hidden>◈</span>
              <span>
                Piano:{" "}
                <strong className="uppercase tracking-wide">
                  {props.entitlements.planId === "internal_test"
                    ? "TEST"
                    : props.entitlements.planId}
                </strong>
              </span>
              <span className="text-[11px] opacity-80">
                {(props.entitlements.limits.maxServices === null
                  ? "Servizi: illimitati"
                  : `Servizi: ${services.length}/${props.entitlements.limits.maxServices}`) +
                  " · " +
                  (props.entitlements.limits.maxSections === null
                    ? "Sezioni: illimitate"
                    : `Sezioni: ${sections.length}/${props.entitlements.limits.maxSections}`)}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-1 gap-4">
          {!saveState.ok && saveState.code === "LIMIT_REACHED" ? (
            <Alert
              kind="error"
              title="Limite raggiunto"
              message={saveState.error || "Hai superato il massimo consentito dal piano corrente."}
            />
          ) : null}
          {!saveState.ok && saveState.code === "ENTITLEMENT_DENIED" ? (
            <Alert
              kind="error"
              title="Funzionalità non disponibile"
              message={saveState.error || "Questa funzionalità non è inclusa nel tuo piano."}
            />
          ) : null}
          {!publishState.ok && publishState.code === "ENTITLEMENT_DENIED" ? (
            <Alert
              kind="error"
              title="Pubblicazione non consentita"
              message={publishState.error || "Il tuo piano non include la pubblicazione del sito."}
            />
          ) : null}
          {savedNow || publishState.ok || unpublishState.ok ? (
            <Alert
              kind="success"
              title={
                publishedNow
                  ? "Pubblicazione riuscita"
                  : unpublishedNow
                    ? "Pubblicazione ritirata"
                    : "Salvato"
              }
              message={
                publishedNow
                  ? "La nuova versione del sito è ora disponibile al pubblico."
                  : unpublishedNow
                    ? "Il sito pubblico è stato rimosso. La bozza è conservata."
                    : "Le modifiche sono state salvate come bozza."
              }
            />
          ) : null}
          {!saveState.ok && saveErr ? (
            <Alert kind="error" title="Impossibile salvare la bozza" message={saveErr} />
          ) : null}
          {!publishState.ok && pubErr ? (
            <Alert kind="error" title="Pubblicazione fallita" message={pubErr} />
          ) : null}
          {!unpublishState.ok && unpubErr ? (
            <Alert kind="error" title="Ritiro pubblicazione fallito" message={unpubErr} />
          ) : null}
        </div>

        <div className="space-y-6">
          <Card
            title="Sezioni del sito"
            actions={
              <button
                type="button"
                onClick={() => {
                  const usedSingletons = new Set(
                    sections
                      .filter((s) =>
                        SINGLETON_TYPES.includes(
                          s.section_type as (typeof SINGLETON_TYPES)[number],
                        ),
                      )
                      .map((s) => s.section_type),
                  );
                  const available: SectionType[] = [];
                  for (const t of SECTION_TYPES) {
                    if (SINGLETON_TYPES.includes(t as (typeof SINGLETON_TYPES)[number])) {
                      if (!usedSingletons.has(t)) available.push(t);
                    } else {
                      available.push(t);
                    }
                  }
                  if (available.length === 0) return;
                  const ty = available[0] as SectionType;
                  setSections((prev) => [
                    ...rewritePositions([
                      ...prev,
                      {
                        section_type: ty,
                        enabled: true,
                        position: prev.length,
                        variant: "default" as SectionVariant,
                        settings: {},
                      },
                    ]),
                  ]);
                }}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                + Aggiungi sezione
              </button>
            }
          >
            <div className="space-y-3">
              {sections.length === 0 ? (
                <p className="text-sm text-slate-500">Nessuna sezione configurata.</p>
              ) : null}
              {sections.map((s, idx) => (
                <SectionsEditorItem
                  key={`${s.id ?? `n${idx}`}-${idx}`}
                  index={idx}
                  section={s}
                  sections={sections}
                  setSections={setSections}
                  fieldErrors={fieldErrors}
                />
              ))}
            </div>
          </Card>

          <Card
            title="Servizi"
            actions={
              <button
                type="button"
                onClick={() =>
                  setServices((prev) =>
                    rewriteServicesPositions([
                      ...prev,
                      {
                        name: "",
                        description: null,
                        price_from: null,
                        currency: "EUR" as Currency,
                        duration_minutes: null,
                        position: prev.length,
                        active: true,
                      },
                    ]),
                  )
                }
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                + Aggiungi servizio
              </button>
            }
          >
            <div className="space-y-3">
              {services.length === 0 ? (
                <p className="text-sm text-slate-500">Nessun servizio ancora aggiunto.</p>
              ) : null}
              {services.map((s, idx) => (
                <ServicesEditorItem
                  key={`${s.id ?? `n${idx}`}-${idx}`}
                  index={idx}
                  service={s}
                  services={services}
                  setServices={setServices}
                  fieldErrors={fieldErrors}
                />
              ))}
            </div>
          </Card>

          <Card title="Tema">
            <ThemeEditor theme={theme} setTheme={setTheme} fieldErrors={fieldErrors} />
          </Card>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <form action={saveAction} className="inline-flex items-center">
            <input type="hidden" name="sections" value={JSON.stringify(sections)} />
            <input type="hidden" name="services" value={JSON.stringify(services)} />
            <input type="hidden" name="theme" value={JSON.stringify(theme)} />
            <SubmitButton label="Salva bozza" loadingLabel="Salvataggio…" variant="primary" />
          </form>

          <form action={publishAction} className="inline-flex items-center">
            <input type="hidden" name="sections" value={JSON.stringify(sections)} />
            <input type="hidden" name="services" value={JSON.stringify(services)} />
            <input type="hidden" name="theme" value={JSON.stringify(theme)} />
            <input type="hidden" name="revision" value={revision ?? ""} />
            <SubmitButton
              label={published ? "Ripubblica le modifiche" : "Pubblica"}
              loadingLabel="Pubblicazione…"
              variant="secondary"
            />
          </form>

          {published ? (
            <form action={unpublishAction} className="inline-flex items-center ml-auto">
              <SubmitButton label="Ritira pubblicazione" loadingLabel="Ritiro…" variant="danger" />
            </form>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SectionsEditorItem({
  index,
  section,
  sections,
  setSections,
  fieldErrors,
}: {
  index: number;
  section: StudioDraftSection;
  sections: StudioDraftSection[];
  setSections: React.Dispatch<React.SetStateAction<StudioDraftSection[]>>;
  fieldErrors?: FieldErrors | undefined;
}) {
  const usedSingletons = useMemo(() => {
    return new Set(
      sections
        .filter(
          (s, i) =>
            i !== index &&
            SINGLETON_TYPES.includes(s.section_type as (typeof SINGLETON_TYPES)[number]),
        )
        .map((s) => s.section_type),
    );
  }, [sections, index]);

  const patch = (partial: Partial<StudioDraftSection>) => {
    setSections((prev) => {
      const next = [...prev];
      const cur = next[index] as StudioDraftSection;
      next[index] = {
        id: cur.id ?? null,
        section_type: partial.section_type ?? cur.section_type,
        enabled: partial.enabled ?? cur.enabled,
        position: partial.position ?? cur.position,
        variant: partial.variant ?? cur.variant,
        settings: partial.settings ?? cur.settings,
      };
      return rewritePositions(next);
    });
  };

  const moveUp = () => {
    if (index === 0) return;
    setSections((prev) => {
      const next = [...prev];
      const t = next[index - 1]!;
      next[index - 1] = next[index]!;
      next[index] = t;
      return rewritePositions(next);
    });
  };

  const moveDown = () => {
    if (index >= sections.length - 1) return;
    setSections((prev) => {
      const next = [...prev];
      const t = next[index + 1]!;
      next[index + 1] = next[index]!;
      next[index] = t;
      return rewritePositions(next);
    });
  };

  const remove = () => {
    setSections((prev) => rewritePositions(prev.filter((_, i) => i !== index)));
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/40">
      <div className="flex flex-wrap gap-3 items-start">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 min-w-0">
          <Row
            label="Tipo sezione"
            htmlFor={`sect-${index}-type`}
            error={fieldErrorFor(fieldErrors, `sections.${index}.section_type`)}
          >
            <Select
              id={`sect-${index}-type`}
              value={section.section_type}
              onChange={(e) => patch({ section_type: e.target.value as SectionType })}
              error={fieldErrorFor(fieldErrors, `sections.${index}.section_type`)}
            >
              {SECTION_TYPES.map((t) => {
                const isSingleton = SINGLETON_TYPES.includes(t as (typeof SINGLETON_TYPES)[number]);
                const disabled = isSingleton && usedSingletons.has(t);
                return (
                  <option key={t} value={t} disabled={disabled}>
                    {labelForSection(t)}
                    {isSingleton ? " (singola)" : ""}
                  </option>
                );
              })}
            </Select>
          </Row>

          <Row
            label="Variante"
            htmlFor={`sect-${index}-variant`}
            error={fieldErrorFor(fieldErrors, `sections.${index}.variant`)}
          >
            <Select
              id={`sect-${index}-variant`}
              value={section.variant || "default"}
              onChange={(e) => patch({ variant: e.target.value as SectionVariant })}
              error={fieldErrorFor(fieldErrors, `sections.${index}.variant`)}
            >
              {ALLOWED_VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Row>

          <div className="self-end">
            <Checkbox
              id={`sect-${index}-enabled`}
              label="Sezione visibile"
              checked={section.enabled}
              onChange={(v) => patch({ enabled: v })}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label="Sposta sezione su"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            onClick={moveUp}
            disabled={index === 0}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Sposta sezione giù"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            onClick={moveDown}
            disabled={index >= sections.length - 1}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Rimuovi sezione"
            className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 text-sm font-medium"
            onClick={remove}
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  );
}

function ServicesEditorItem({
  index,
  service,
  services,
  setServices,
  fieldErrors,
}: {
  index: number;
  service: StudioDraftService;
  services: StudioDraftService[];
  setServices: React.Dispatch<React.SetStateAction<StudioDraftService[]>>;
  fieldErrors?: FieldErrors | undefined;
}) {
  const patch = (partial: Partial<StudioDraftService>) => {
    setServices((prev) => {
      const next = [...prev];
      const cur = next[index] as StudioDraftService;
      next[index] = {
        id: cur.id ?? null,
        name: partial.name ?? cur.name,
        currency: partial.currency ?? cur.currency,
        position: partial.position ?? cur.position,
        active: partial.active ?? cur.active,
        description:
          "description" in partial ? (partial.description ?? cur.description) : cur.description,
        price_from:
          "price_from" in partial ? (partial.price_from ?? cur.price_from) : cur.price_from,
        duration_minutes:
          "duration_minutes" in partial
            ? (partial.duration_minutes ?? cur.duration_minutes)
            : cur.duration_minutes,
      };
      return rewriteServicesPositions(next);
    });
  };

  const moveUp = () => {
    if (index === 0) return;
    setServices((prev) => {
      const next = [...prev];
      const t = next[index - 1]!;
      next[index - 1] = next[index]!;
      next[index] = t;
      return rewriteServicesPositions(next);
    });
  };
  const moveDown = () => {
    if (index >= services.length - 1) return;
    setServices((prev) => {
      const next = [...prev];
      const t = next[index + 1]!;
      next[index + 1] = next[index]!;
      next[index] = t;
      return rewriteServicesPositions(next);
    });
  };
  const remove = () => {
    setServices((prev) => rewriteServicesPositions(prev.filter((_, i) => i !== index)));
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/40">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-12">
          <Row
            label="Nome servizio"
            htmlFor={`svc-${index}-name`}
            error={fieldErrorFor(fieldErrors, `services.${index}.name`)}
          >
            <Input
              id={`svc-${index}-name`}
              value={service.name}
              maxLength={120}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="es. Taglio uomo"
              error={fieldErrorFor(fieldErrors, `services.${index}.name`)}
            />
          </Row>
        </div>

        <div className="md:col-span-4">
          <Row
            label="Prezzo da (€/$/…)"
            htmlFor={`svc-${index}-price`}
            error={fieldErrorFor(fieldErrors, `services.${index}.price_from`)}
          >
            <Input
              id={`svc-${index}-price`}
              type="number"
              step="0.01"
              min="0"
              value={
                service.price_from === null || service.price_from === undefined
                  ? ""
                  : String(service.price_from)
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return patch({ price_from: null });
                const n = Number(raw);
                if (Number.isNaN(n)) return;
                patch({ price_from: Math.max(0, n) });
              }}
              error={fieldErrorFor(fieldErrors, `services.${index}.price_from`)}
            />
          </Row>
        </div>

        <div className="md:col-span-2">
          <Row
            label="Valuta"
            htmlFor={`svc-${index}-currency`}
            error={fieldErrorFor(fieldErrors, `services.${index}.currency`)}
          >
            <Select
              id={`svc-${index}-currency`}
              value={service.currency}
              onChange={(e) => patch({ currency: e.target.value as Currency })}
              error={fieldErrorFor(fieldErrors, `services.${index}.currency`)}
            >
              {CURRENCY_ALLOWED.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Row>
        </div>

        <div className="md:col-span-3">
          <Row
            label="Durata (minuti)"
            htmlFor={`svc-${index}-dur`}
            error={fieldErrorFor(fieldErrors, `services.${index}.duration_minutes`)}
          >
            <Input
              id={`svc-${index}-dur`}
              type="number"
              min={1}
              max={1440}
              value={
                service.duration_minutes === null || service.duration_minutes === undefined
                  ? ""
                  : String(service.duration_minutes)
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return patch({ duration_minutes: null });
                const n = Number(raw);
                if (Number.isNaN(n)) return;
                patch({ duration_minutes: Math.max(1, Math.min(1440, Math.round(n))) });
              }}
              error={fieldErrorFor(fieldErrors, `services.${index}.duration_minutes`)}
            />
          </Row>
        </div>

        <div className="md:col-span-3 self-end flex items-center justify-between gap-3">
          <Checkbox
            id={`svc-${index}-active`}
            label="Attivo"
            checked={Boolean(service.active)}
            onChange={(v) => patch({ active: v })}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Sposta servizio su"
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              onClick={moveUp}
              disabled={index === 0}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Sposta servizio giù"
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              onClick={moveDown}
              disabled={index >= services.length - 1}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Rimuovi servizio"
              className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 text-sm font-medium"
              onClick={remove}
            >
              Elimina
            </button>
          </div>
        </div>

        <div className="md:col-span-12">
          <Row
            label="Descrizione (opzionale)"
            htmlFor={`svc-${index}-desc`}
            error={fieldErrorFor(fieldErrors, `services.${index}.description`)}
          >
            <Textarea
              id={`svc-${index}-desc`}
              rows={2}
              maxLength={1000}
              value={service.description ?? ""}
              onChange={(e) => patch({ description: e.target.value || null })}
              error={fieldErrorFor(fieldErrors, `services.${index}.description`)}
            />
          </Row>
        </div>
      </div>
    </div>
  );
}

function ThemeEditor({
  theme,
  setTheme,
  fieldErrors,
}: {
  theme: StudioDraftTheme;
  setTheme: React.Dispatch<React.SetStateAction<StudioDraftTheme>>;
  fieldErrors?: FieldErrors | undefined;
}) {
  const [hexErrors, setHexErrors] = useState<
    Partial<Record<"primary" | "background" | "foreground" | "muted", string>>
  >({});

  const setHex = (k: "primary" | "background" | "foreground" | "muted", v: string) => {
    const ok = v.length === 0 || validateHexColor(v);
    setHexErrors((prev) => ({
      ...prev,
      [k]: ok ? "" : "Colore hex non valido (#RRGGBB o #RGB)",
    }));
    setTheme((prev) => ({ ...prev, [k]: v.length > 0 && ok ? v : prev[k] }));
  };

  const pErr = hexErrors.primary || fieldErrorFor(fieldErrors, "theme.primary") || undefined;
  const bErr = hexErrors.background || fieldErrorFor(fieldErrors, "theme.background") || undefined;
  const fErr = hexErrors.foreground || fieldErrorFor(fieldErrors, "theme.foreground") || undefined;
  const mErr = hexErrors.muted || fieldErrorFor(fieldErrors, "theme.muted") || undefined;
  const rErr = fieldErrorFor(fieldErrors, "theme.radius") || undefined;
  const hErr = fieldErrorFor(fieldErrors, "theme.headingFont") || undefined;
  const bfErr = fieldErrorFor(fieldErrors, "theme.bodyFont") || undefined;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Row label="Colore primario" htmlFor="theme-primary-text" error={pErr}>
        <div className="flex gap-2">
          <input
            id="theme-primary-color"
            type="color"
            className="h-10 w-16 rounded border border-slate-300 bg-white"
            value={
              theme.primary && validateHexColor(theme.primary)
                ? normalizeHexForPicker(theme.primary)
                : "#4f46e5"
            }
            onChange={(e) => setHex("primary", e.target.value)}
            aria-label="Colore primario (picker)"
          />
          <Input
            id="theme-primary-text"
            type="text"
            value={theme.primary ?? ""}
            onChange={(e) => setHex("primary", e.target.value.trim())}
            placeholder="#RRGGBB"
            error={pErr}
          />
        </div>
      </Row>

      <Row label="Sfondo" htmlFor="theme-bg-text" error={bErr}>
        <div className="flex gap-2">
          <input
            id="theme-bg-color"
            type="color"
            className="h-10 w-16 rounded border border-slate-300 bg-white"
            value={
              theme.background && validateHexColor(theme.background)
                ? normalizeHexForPicker(theme.background)
                : "#ffffff"
            }
            onChange={(e) => setHex("background", e.target.value)}
            aria-label="Sfondo (picker)"
          />
          <Input
            id="theme-bg-text"
            type="text"
            value={theme.background ?? ""}
            onChange={(e) => setHex("background", e.target.value.trim())}
            placeholder="#ffffff"
            error={bErr}
          />
        </div>
      </Row>

      <Row label="Testo principale" htmlFor="theme-fg-text" error={fErr}>
        <div className="flex gap-2">
          <input
            id="theme-fg-color"
            type="color"
            className="h-10 w-16 rounded border border-slate-300 bg-white"
            value={
              theme.foreground && validateHexColor(theme.foreground)
                ? normalizeHexForPicker(theme.foreground)
                : "#0f172a"
            }
            onChange={(e) => setHex("foreground", e.target.value)}
            aria-label="Testo principale (picker)"
          />
          <Input
            id="theme-fg-text"
            type="text"
            value={theme.foreground ?? ""}
            onChange={(e) => setHex("foreground", e.target.value.trim())}
            placeholder="#0f172a"
            error={fErr}
          />
        </div>
      </Row>

      <Row label="Secondario / Muted" htmlFor="theme-muted-text" error={mErr}>
        <div className="flex gap-2">
          <input
            id="theme-muted-color"
            type="color"
            className="h-10 w-16 rounded border border-slate-300 bg-white"
            value={
              theme.muted && validateHexColor(theme.muted)
                ? normalizeHexForPicker(theme.muted)
                : "#64748b"
            }
            onChange={(e) => setHex("muted", e.target.value)}
            aria-label="Secondario Muted (picker)"
          />
          <Input
            id="theme-muted-text"
            type="text"
            value={theme.muted ?? ""}
            onChange={(e) => setHex("muted", e.target.value.trim())}
            placeholder="#64748b"
            error={mErr}
          />
        </div>
      </Row>

      <Row label="Raggio angoli" htmlFor="theme-radius" error={rErr}>
        <Select
          id="theme-radius"
          value={theme.radius ?? "md"}
          onChange={(e) =>
            setTheme((prev) => ({
              ...prev,
              radius: e.target.value as (typeof RADIUS_ALLOWED)[number],
            }))
          }
          error={rErr}
        >
          {RADIUS_ALLOWED.map((r) => (
            <option key={r} value={r}>
              {labelForRadius(r)}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Font titoli" htmlFor="theme-head" error={hErr}>
        <Select
          id="theme-head"
          value={theme.headingFont ?? "display"}
          onChange={(e) =>
            setTheme((prev) => ({
              ...prev,
              headingFont: e.target.value as (typeof FONT_HEADING_ALLOWED)[number],
            }))
          }
          error={hErr}
        >
          {FONT_HEADING_ALLOWED.map((f) => (
            <option key={f} value={f}>
              {labelForFont(f)}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Font testo" htmlFor="theme-body" error={bfErr}>
        <Select
          id="theme-body"
          value={theme.bodyFont ?? "sans"}
          onChange={(e) =>
            setTheme((prev) => ({
              ...prev,
              bodyFont: e.target.value as (typeof FONT_BODY_ALLOWED)[number],
            }))
          }
          error={bfErr}
        >
          {FONT_BODY_ALLOWED.map((f) => (
            <option key={f} value={f}>
              {labelForFont(f)}
            </option>
          ))}
        </Select>
      </Row>
    </div>
  );
}

function rewritePositions(arr: StudioDraftSection[]): StudioDraftSection[] {
  return arr.map((s, i) => ({ ...s, position: i }));
}
function rewriteServicesPositions(arr: StudioDraftService[]): StudioDraftService[] {
  return arr.map((s, i) => ({ ...s, position: i }));
}

function labelForSection(t: SectionType): string {
  switch (t) {
    case "hero":
      return "Hero";
    case "about":
      return "Chi siamo";
    case "services":
      return "Lista servizi";
    case "gallery":
      return "Galleria";
    case "staff":
      return "Staff";
    case "reviews":
      return "Recensioni";
    case "contact":
      return "Contatti";
  }
}

function labelForRadius(r: (typeof RADIUS_ALLOWED)[number]) {
  const map: Record<string, string> = {
    none: "Nessuno",
    sm: "Piccolo",
    md: "Medio",
    lg: "Grande",
    xl: "Molto grande",
    full: "Arrotondato",
  };
  return map[r] ?? r;
}

function labelForFont(f: string) {
  const map: Record<string, string> = {
    sans: "Senza grazie",
    serif: "Con grazie",
    mono: "Monospaziato",
    display: "Titoli",
  };
  return map[f] ?? f;
}

function normalizeHexForPicker(v: string): string {
  if (v.length === 4 && v[0] === "#") {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return v;
}
