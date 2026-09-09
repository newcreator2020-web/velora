"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { forwardRef, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addCustomDomainAction,
  removeCustomDomainAction,
  verifyCustomDomainAction,
  getDomainState,
} from "../actions";
import { type DomainActionResult, type DomainStatus } from "../lib";

type LoadedDomainState = Extract<Awaited<ReturnType<typeof getDomainState>>, { ok: true }>;

function SubmitButton({
  label,
  loadingLabel,
  variant = "primary",
  disabled,
  type = "submit",
  onClick,
  ariaLabel,
  ariaDescribedBy,
}: {
  label: string;
  loadingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}) {
  const status = useFormStatus();
  const pending = type === "submit" ? status.pending || false : false;
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
    <button
      type={type}
      disabled={isDisabled}
      className={classes}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      onClick={onClick}
    >
      {pending && loadingLabel ? loadingLabel : label}
    </button>
  );
}

function Alert({
  kind,
  message,
  title,
}: {
  kind: "success" | "error" | "info" | "warning";
  message?: string;
  title?: string;
}) {
  if (!message && !title) return null;
  const styles =
    kind === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : kind === "error"
        ? "bg-red-50 border-red-200 text-red-800"
        : kind === "warning"
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-sky-50 border-sky-200 text-sky-800";
  const symbol = kind === "success" ? "✔" : kind === "error" ? "✖" : kind === "warning" ? "⚠" : "ℹ";
  const msg = message ?? "";
  const tit = title ?? "";
  return (
    <div role="status" aria-live="polite" className={`border rounded-lg p-3 text-sm ${styles}`}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="shrink-0 mt-0.5 font-bold">
          {symbol}
        </span>
        <div className="min-w-0 flex-1">
          {tit ? <p className="font-semibold mb-0.5">{tit}</p> : null}
          {msg ? <p className="opacity-90 break-words">{msg}</p> : null}
        </div>
      </div>
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
    <section
      className="bg-white border border-slate-200 rounded-xl shadow-sm"
      aria-labelledby="domain-card-title"
    >
      <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3">
        <h2 id="domain-card-title" className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

type RowProps = {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
};
function Row({ label, htmlFor, error, hint, children }: RowProps) {
  const id = htmlFor;
  const errId = error && id ? `${id}-err` : undefined;
  const hintId = hint && id ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <div>{children}</div>
      {hint && !error ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error && errId ? (
        <p id={errId} className="mt-1 text-xs text-red-600">
          <span aria-hidden className="font-bold mr-1">
            ⚠
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> & {
  error?: string | undefined;
};
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, className, id, "aria-describedby": des, ...rest },
  ref,
) {
  const errId = error && id ? `${id}-err` : undefined;
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={Boolean(error) || undefined}
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
});

function StatusBadge({ status }: { status: DomainStatus }) {
  const map: Record<DomainStatus, { label: string; dot: string; cls: string; srHint: string }> = {
    none: {
      label: "Nessun dominio configurato",
      dot: "bg-slate-400",
      cls: "bg-slate-50 text-slate-700 border-slate-200",
      srHint: "Stato: nessun dominio personalizzato",
    },
    pending: {
      label: "Verifica in corso",
      dot: "bg-amber-500",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      srHint: "Stato: verifica del dominio in corso",
    },
    verified: {
      label: "Dominio verificato",
      dot: "bg-emerald-500",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      srHint: "Stato: dominio verificato e attivo",
    },
    failed: {
      label: "Verifica fallita",
      dot: "bg-red-500",
      cls: "bg-red-50 text-red-700 border-red-200",
      srHint: "Stato: verifica del dominio fallita",
    },
  };
  const key: DomainStatus = Object.prototype.hasOwnProperty.call(map, status) ? status : "none";
  const m = map[key]!;
  return (
    <div
      role="status"
      className={[
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
        m.cls,
      ].join(" ")}
    >
      <span className="sr-only">{m.srHint}</span>
      <span
        aria-hidden
        className={["inline-block h-2 w-2 rounded-full shrink-0", m.dot].join(" ")}
      />
      <span>{m.label}</span>
    </div>
  );
}

function DnsInstructionRow({
  type,
  name,
  value,
  help,
}: {
  type: "TXT" | "CNAME" | "A";
  name: string;
  value: string;
  help?: string;
}) {
  return (
    <tr className="border-b last:border-b-0 border-slate-100">
      <td className="py-3 pr-3 align-top">
        <span
          className={[
            "inline-flex items-center justify-center rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide border",
            type === "TXT"
              ? "bg-violet-50 text-violet-700 border-violet-200"
              : type === "CNAME"
                ? "bg-sky-50 text-sky-700 border-sky-200"
                : "bg-teal-50 text-teal-700 border-teal-200",
          ].join(" ")}
        >
          {type}
        </span>
      </td>
      <th scope="row" className="py-3 pr-3 text-left text-sm font-medium text-slate-700 align-top">
        <code className="font-mono text-xs bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 break-all">
          {name}
        </code>
      </th>
      <td className="py-3 align-top">
        <div className="flex items-start gap-2">
          <code className="font-mono text-xs bg-slate-50 px-2 py-1 rounded border border-slate-200 break-all min-w-0 max-w-full">
            {value}
          </code>
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(value);
              }
            }}
            className="shrink-0 inline-flex items-center px-2 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
            aria-label={`Copia valore record ${type}`}
          >
            Copia
          </button>
        </div>
        {help ? <p className="mt-1.5 text-xs text-slate-500">{help}</p> : null}
      </td>
    </tr>
  );
}

const INITIAL_ADD_STATE: DomainActionResult = { ok: false, error: "" };
const INITIAL_VERIFY_STATE: DomainActionResult = { ok: false, error: "" };

export function DomainSection() {
  const [state, setState] = useState<LoadedDomainState | null>(null);
  const [loadErr, setLoadErr] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const verifyBtnRef = useRef<HTMLButtonElement | null>(null);
  const hostnameInputRef = useRef<HTMLInputElement | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setLoadErr("");
    try {
      const res = await getDomainState();
      if (res.ok) {
        setState(res as LoadedDomainState);
      } else {
        setLoadErr(res.error || "Impossibile caricare i dati.");
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Errore interno";
      setLoadErr(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const [addState, addAction] = useActionState(
    addCustomDomainAction as unknown as (
      p: DomainActionResult,
      f: FormData,
    ) => Promise<DomainActionResult>,
    INITIAL_ADD_STATE,
  );

  useEffect(() => {
    if (addState.ok) {
      setVerifyMsg(null);
      setRemoveMsg(null);
      void loadState();
      if (hostnameInputRef.current) hostnameInputRef.current.value = "";
    }
  }, [addState, loadState]);

  const [verifyState, verifyAction] = useActionState(
    verifyCustomDomainAction as unknown as (
      p: DomainActionResult,
      f: FormData,
    ) => Promise<DomainActionResult>,
    INITIAL_VERIFY_STATE,
  );

  useEffect(() => {
    if (verifyState.ok) {
      setVerifyMsg({
        kind: "success",
        text: "Dominio verificato con successo. Il routing verrà attivato entro pochi minuti.",
      });
      setVerifyPending(false);
      void loadState();
    } else if (verifyState.error && !verifyPending) {
      if (verifyState.code === "VERIFICATION_FAILED" || verifyState.code) {
        setVerifyMsg({ kind: "error", text: verifyState.error });
      }
    }
  }, [verifyState, verifyPending, loadState]);

  const onVerifyClick = useCallback(async () => {
    setVerifyPending(true);
    setVerifyMsg(null);
    try {
      const res = await verifyCustomDomainAction();
      if (res.ok) {
        setVerifyMsg({
          kind: "success",
          text: "Dominio verificato con successo. Il routing verrà attivato entro pochi minuti.",
        });
        void loadState();
      } else {
        setVerifyMsg({ kind: "error", text: res.error });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Errore durante la verifica.";
      setVerifyMsg({ kind: "error", text: m });
    } finally {
      setVerifyPending(false);
      setTimeout(() => verifyBtnRef.current?.focus({ preventScroll: false }), 50);
    }
  }, [loadState]);

  const onRemoveClick = useCallback(async () => {
    setRemovePending(true);
    setRemoveMsg(null);
    try {
      const res = await removeCustomDomainAction();
      if (res.ok) {
        setRemoveMsg({
          kind: "success",
          text: "Dominio personalizzato rimosso. Il sito tornerà accessibile dal percorso /s/{slug}.",
        });
        setVerifyMsg(null);
        void loadState();
      } else {
        setRemoveMsg({ kind: "error", text: res.error });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Errore durante la rimozione.";
      setRemoveMsg({ kind: "error", text: m });
    } finally {
      setRemovePending(false);
    }
  }, [loadState]);

  const status: DomainStatus = state?.status ?? "none";
  const customDomain = state?.customDomain ?? null;
  const verificationToken = state?.verificationToken ?? "";
  const targetCname = state?.targetCname ?? "";
  const targetA = state?.targetA ?? "";
  const canonicalUrl = state?.canonicalUrl ?? null;
  const slug = state?.slug ?? "";
  const defaultPublicUrl = slug ? `/s/${encodeURIComponent(slug)}` : null;

  const addError = !addState.ok && addState.error ? addState.error : undefined;

  const actionsSlot = (
    <div className="flex flex-wrap items-center gap-2">
      {canonicalUrl ? (
        <a
          href={canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border bg-white text-slate-900 border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
          aria-label="Apri il sito sul dominio personalizzato"
        >
          Apri sito
          <span aria-hidden>↗</span>
        </a>
      ) : defaultPublicUrl ? (
        <a
          href={defaultPublicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border bg-slate-100 text-slate-500 border-slate-200 pointer-events-none"
          aria-disabled="true"
          tabIndex={-1}
        >
          Sito pubblico (solo slug)
          <span aria-hidden>↗</span>
        </a>
      ) : null}
    </div>
  );

  return (
    <Card title="Dominio personalizzato" actions={actionsSlot}>
      {loading && !state ? (
        <div
          className="animate-pulse flex flex-col gap-3"
          aria-busy="true"
          aria-label="Caricamento stato dominio"
        >
          <div className="h-4 bg-slate-100 rounded w-1/3" />
          <div className="h-20 bg-slate-100 rounded w-full" />
          <div className="h-10 bg-slate-100 rounded w-2/3" />
        </div>
      ) : null}
      {!loading && loadErr ? (
        <Alert kind="error" title="Impossibile caricare lo stato" message={loadErr} />
      ) : null}

      {state ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={status} />
            {customDomain ? (
              <div className="text-sm text-slate-700 break-all min-w-0">
                Dominio:{" "}
                <code className="font-mono text-xs bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                  {customDomain}
                </code>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Nessun dominio personalizzato ancora configurato.
              </div>
            )}
            {canonicalUrl ? (
              <div className="text-sm text-emerald-700 break-all min-w-0">
                URL canonico:{" "}
                <code className="font-mono text-xs bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  {canonicalUrl}
                </code>
              </div>
            ) : null}
          </div>

          {status === "pending" ? (
            <Alert
              kind="warning"
              title="Dominio in attesa di verifica"
              message="Configura i record DNS indicati di seguito, quindi avvia la verifica. La propagazione DNS può richiedere da pochi minuti a 48 ore."
            />
          ) : null}
          {status === "verified" ? (
            <Alert
              kind="success"
              title="Dominio attivo"
              message="Il dominio personalizzato è verificato e instradato. Il sito pubblico usa ora questo dominio come URL canonico."
            />
          ) : null}

          {verifyMsg ? (
            <Alert
              kind={verifyMsg.kind}
              title={verifyMsg.kind === "success" ? "Verifica completata" : "Verifica non riuscita"}
              message={verifyMsg.text}
            />
          ) : null}
          {removeMsg ? (
            <Alert
              kind={removeMsg.kind}
              title={removeMsg.kind === "success" ? "Dominio rimosso" : "Rimozione fallita"}
              message={removeMsg.text}
            />
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
              <p className="text-sm font-medium text-slate-700">Record DNS da configurare</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Aggiungi questi record nel pannello del tuo provider DNS (es. Aruba, Register,
                Cloudflare, GoDaddy).{" "}
                <strong className="text-slate-700">
                  Attenzione: i record TXT potrebbero non propagarsi immediatamente.
                </strong>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" role="table">
                <caption className="sr-only">
                  Istruzioni DNS per la verifica e l&rsquo;instradamento del dominio personalizzato
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-3 py-2 font-semibold w-20">
                      Tipo
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold w-48">
                      Nome / Host
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Valore / Destinazione
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <DnsInstructionRow
                    type="TXT"
                    name="_velora-verification"
                    value={verificationToken}
                    help="Record di verifica obbligatorio. Puoi anche inserirlo sul nome '@' (dominio principale) se il tuo provider non supporta nomi con trattini."
                  />
                  <DnsInstructionRow
                    type="CNAME"
                    name="www"
                    value={targetCname}
                    help="Per il sottodominio www (es. www.esempio.it). Se vuoi usare anche il dominio radice (esempio.it), configura anche il record A."
                  />
                  <DnsInstructionRow
                    type="A"
                    name="@"
                    value={targetA}
                    help="Solo per dominio radice (esempio.it, senza www). Se il tuo provider supporta record ALIAS/ANAME, preferisci puntare al CNAME indicato sopra."
                  />
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <form
                action={addAction}
                className="space-y-3"
                onSubmit={() => {
                  setVerifyMsg(null);
                  setRemoveMsg(null);
                }}
              >
                <Row
                  label="Dominio personalizzato"
                  htmlFor="domain-hostname"
                  error={addError}
                  hint="Inserisci il nome di dominio senza protocollo (es. www.esempio.it oppure esempio.it)."
                >
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-stretch rounded-md border border-slate-300 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-300 has-[:invalid]:border-red-300">
                        <span
                          aria-hidden
                          className="inline-flex items-center px-3 rounded-l-md bg-slate-50 border-r border-slate-300 text-sm text-slate-500"
                        >
                          https://
                        </span>
                        <Input
                          ref={hostnameInputRef}
                          id="domain-hostname"
                          name="hostname"
                          type="text"
                          inputMode="url"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="www.esempio.it"
                          error={addError}
                          defaultValue=""
                          className="rounded-l-none border-0 focus:ring-0 shadow-none rounded-r-md"
                          aria-required="true"
                        />
                      </div>
                    </div>
                    <div className="shrink-0">
                      <SubmitButton
                        label={customDomain ? "Aggiorna dominio" : "Aggiungi dominio"}
                        loadingLabel="Salvataggio…"
                        variant="primary"
                        ariaLabel={
                          customDomain
                            ? "Aggiorna il dominio personalizzato"
                            : "Aggiungi il dominio personalizzato"
                        }
                      />
                    </div>
                  </div>
                </Row>
                <input type="hidden" name="slug" value={slug} />
              </form>
            </div>

            <div className="flex flex-col gap-2 justify-start sm:justify-end">
              <div className="flex flex-wrap gap-2">
                <form action={verifyAction} className="inline-flex items-center">
                  <button
                    ref={verifyBtnRef}
                    type="submit"
                    onClick={(e) => {
                      if (!customDomain) {
                        e.preventDefault();
                        setVerifyMsg({
                          kind: "error",
                          text: "Aggiungi e salva prima un dominio personalizzato, poi avvia la verifica.",
                        });
                        return;
                      }
                      setVerifyPending(true);
                      setVerifyMsg(null);
                      void onVerifyClick();
                      e.preventDefault();
                    }}
                    disabled={!customDomain || verifyPending || status === "verified"}
                    aria-busy={verifyPending || undefined}
                    className={[
                      "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
                      !customDomain || status === "verified"
                        ? "bg-slate-100 text-slate-400 border-slate-200 opacity-70 cursor-not-allowed"
                        : "bg-white text-slate-900 border-slate-300 hover:bg-slate-50 focus:ring-slate-300",
                      verifyPending ? "opacity-70 cursor-wait" : "",
                    ].join(" ")}
                    aria-label="Avvia verifica DNS del dominio"
                  >
                    {verifyPending ? "Verifica in corso…" : "Verifica DNS"}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window === "undefined") return;
                    const ok = window.confirm(
                      customDomain
                        ? `Rimuovere il dominio personalizzato ${customDomain}? Il sito tornerà accessibile solo tramite /s/${slug}.`
                        : "Nessun dominio personalizzato da rimuovere.",
                    );
                    if (!ok) return;
                    void onRemoveClick();
                  }}
                  disabled={!customDomain || removePending || status === "none"}
                  aria-busy={removePending || undefined}
                  className={[
                    "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
                    !customDomain
                      ? "bg-slate-100 text-slate-400 border-slate-200 opacity-70 cursor-not-allowed"
                      : "bg-white text-red-700 border-red-200 hover:bg-red-50 focus:ring-red-400",
                    removePending ? "opacity-70 cursor-wait" : "",
                  ].join(" ")}
                  aria-label="Rimuovi il dominio personalizzato"
                >
                  {removePending ? "Rimozione…" : "Rimuovi dominio"}
                </button>
              </div>
              {!customDomain ? (
                <p className="text-xs text-slate-500">
                  Per verificare e instradare il dominio, devi prima inserirlo e salvarlo.
                </p>
              ) : status === "verified" ? (
                <p className="text-xs text-emerald-700">
                  Il dominio è già verificato. Puoi ripetere la verifica se hai modificato i DNS.
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  Dopo aver salvato il dominio e configurato i DNS, avvia la verifica per attivare
                  l&rsquo;instradamento.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
