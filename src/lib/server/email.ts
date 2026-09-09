import "server-only";
import { Resend } from "resend";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";
import { formatDateTimeLocal } from "@/lib/server/booking";
import type { Database } from "@/types/supabase";

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type BusinessProfileRow = Database["public"]["Tables"]["business_profiles"]["Row"];
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"] & {
  reminder_sent?: boolean | null;
};
type ServiceRow = Database["public"]["Tables"]["services"]["Row"];
type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];

export type EmailBookingContext = {
  booking: BookingRow & {
    services?: Pick<ServiceRow, "name" | "duration_minutes" | "price_from" | "currency"> | null;
    staff_resources?: { display_name: string | null } | null;
  };
  customer:
    | Pick<CustomerRow, "display_name" | "email" | "phone">
    | {
        display_name: string;
        email: string | null;
        phone: string | null;
      };
  tenant: Pick<TenantRow, "id" | "name" | "slug">;
  businessProfile: Pick<
    BusinessProfileRow,
    | "display_name"
    | "legal_name"
    | "theme_primary"
    | "address_line1"
    | "city"
    | "postal_code"
    | "province"
    | "country_code"
    | "timezone"
    | "email"
    | "phone"
  >;
};

export type SendBookingConfirmedParams = EmailBookingContext & {
  cancelToken?: string | undefined;
};
export type SendBookingReminderParams = EmailBookingContext;
export type SendBookingModifiedParams = EmailBookingContext;
export type SendBookingCancelledParams = EmailBookingContext;
export type SendDepositPaidParams = EmailBookingContext & {
  amount: number;
  currency: string;
};

const DEFAULT_PRIMARY = "#4F46E5";
const DEFAULT_FROM = "noreply@velora.app";

let resendClient: Resend | null = null;
let useResendSdk = true;

function getResendMode(): { sdk: boolean; apiKey: string | undefined } {
  const apiKey = serverEnv.RESEND_API_KEY;
  if (!apiKey) return { sdk: false, apiKey: undefined };
  if (!resendClient) {
    try {
      resendClient = new Resend(apiKey);
      useResendSdk = true;
    } catch {
      useResendSdk = false;
    }
  }
  return { sdk: useResendSdk, apiKey };
}

export function getFromEmail(bpDisplay?: string | null): string {
  const envFrom = serverEnv.RESEND_FROM_EMAIL;
  const email = envFrom ?? DEFAULT_FROM;
  const name = bpDisplay && bpDisplay.trim().length > 0 ? bpDisplay.trim() : "VELORA";
  const safeName = name.replace(/[<>"\\]/g, "").trim();
  return `${safeName} <${email}>`;
}

async function sendEmailRaw(params: {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string | undefined;
}): Promise<{ id?: string | null }> {
  const { to, from, subject, html, replyTo } = params;
  const { sdk, apiKey } = getResendMode();
  if (!apiKey) {
    return { id: null };
  }
  const payload: Record<string, unknown> = { from, to, subject, html };
  if (replyTo) payload["reply_to"] = replyTo;

  if (sdk && resendClient) {
    try {
      const result = await resendClient.emails.send(payload as never);
      return { id: (result as { id?: string | null })?.id ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[email] resend SDK fallito, tentativo fetch fallback:", msg);
    }
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Resend HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string | null };
  return { id: data?.id ?? null };
}

function base64UrlEncode(buf: Uint8Array | Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : Buffer.from(buf);
  return b.toString("base64url");
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function getCancelJwtSecret(): Buffer {
  const secret = serverEnv.BOOKING_CANCEL_JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BOOKING_CANCEL_JWT_SECRET non configurato o troppo corto (min 32 caratteri). Imposta la variabile d'ambiente prima del build.",
      );
    }
  }
  const fallback = secret ?? "dev-fallback-insecure-secret-change-me-in-prod-0000";
  return Buffer.from(fallback, "utf8");
}

type CancelJwtPayload = {
  booking_id: string;
  sub: string;
  iat: number;
  exp: number;
};

export function signBookingCancelToken(params: {
  booking_id: string;
  customer_email: string;
}): string {
  const secret = getCancelJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: CancelJwtPayload = {
    booking_id: params.booking_id,
    sub: params.customer_email,
    iat: now,
    exp: now + 3 * 24 * 3600,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export function verifyBookingCancelToken(token: string): CancelJwtPayload | null {
  try {
    const secret = getCancelJwtSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [hB64, pB64, sigB64] = parts;
    const signingInput = `${hB64}.${pB64}`;
    const expected = createHmac("sha256", secret).update(signingInput).digest();
    const actual = base64UrlDecode(sigB64!);
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(base64UrlDecode(pB64!).toString("utf8")) as CancelJwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (!payload.booking_id || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildCancelUrl(params: { slug: string; token: string }): string {
  const base = serverEnv.APP_URL ?? "";
  const cleanBase = base.replace(/\/+$/, "");
  return `${cleanBase}/s/${params.slug}/booking/cancel?token=${encodeURIComponent(params.token)}`;
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  const str = String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null || !isFinite(n)) return "";
  const cur = currency ?? "EUR";
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function buildShell(params: {
  businessProfile: SendBookingConfirmedParams["businessProfile"];
  title: string;
  preheader: string;
  bodyRowsHtml: string;
  ctaHref?: string | undefined;
  ctaLabel?: string | undefined;
}): string {
  const { businessProfile, title, preheader, bodyRowsHtml, ctaHref, ctaLabel } = params;
  const primary =
    businessProfile.theme_primary && /^#[0-9A-Fa-f]{6}$/.test(businessProfile.theme_primary)
      ? businessProfile.theme_primary
      : DEFAULT_PRIMARY;
  const bpName = businessProfile.display_name ?? businessProfile.legal_name ?? "VELORA";
  const anno = new Date().getFullYear();
  const parts: string[] = [];
  if (businessProfile.address_line1 && businessProfile.address_line1.length > 0) {
    parts.push(escapeHtml(businessProfile.address_line1));
  }
  const cityParts: string[] = [];
  if (businessProfile.postal_code) cityParts.push(escapeHtml(businessProfile.postal_code));
  if (businessProfile.city) cityParts.push(escapeHtml(businessProfile.city));
  if (businessProfile.province) cityParts.push(`(${escapeHtml(businessProfile.province)})`);
  if (cityParts.length > 0) parts.push(cityParts.join(" "));
  const piva = businessProfile.legal_name ? `P. IVA 00000000000` : "";
  const footerLine = [parts.join(", "), piva].filter((x) => x && x.length > 0).join(" | ");

  const ctaBlock =
    ctaHref && ctaLabel
      ? `
  <tr>
    <td align="center" style="padding:24px 24px 8px 24px;">
      <table border="0" cellpadding="0" cellspacing="0" style="display:inline-block;">
        <tr>
          <td align="center" bgcolor="${primary}" style="border-radius:8px;padding:0;">
            <a href="${escapeHtml(ctaHref)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(ctaLabel)}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`
      : "";

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="it">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td bgcolor="${primary}" style="padding:28px 28px 26px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">${escapeHtml(bpName)}</td>
                </tr>
                <tr>
                  <td style="padding-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:rgba(255,255,255,0.85);">${escapeHtml(preheader)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#111827;padding-bottom:18px;">${escapeHtml(title)}</td>
                </tr>
${bodyRowsHtml}
${ctaBlock}
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f9fafb" style="padding:22px 28px 28px 28px;border-top:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
                    &copy; ${anno} ${escapeHtml(bpName)}${footerLine && footerLine.length > 0 ? ` | ${footerLine}` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function infoRow(label: string, value: string): string {
  return `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="38%" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;vertical-align:top;">${escapeHtml(label)}</td>
                        <td width="62%" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;font-weight:500;vertical-align:top;">${value}</td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

function buildBookingSummaryRows(params: EmailBookingContext): string {
  const { booking, customer, businessProfile } = params;
  const tz = businessProfile.timezone || "Europe/Rome";
  const when = formatDateTimeLocal(booking.starts_at, tz);
  const serviceName = booking.services?.name ?? "Servizio";
  const duration = booking.services?.duration_minutes ?? 0;
  const durationLabel = duration > 0 ? `${duration} min` : "";
  const price =
    booking.services?.price_from != null
      ? formatCurrency(booking.services.price_from / 100, booking.services.currency)
      : "";
  const resource = booking.staff_resources?.display_name ?? "";
  const rows: string[] = [];
  rows.push(
    infoRow(
      "Servizio",
      `${escapeHtml(serviceName)}${durationLabel ? ` <span style="color:#6b7280;font-weight:400;">(${escapeHtml(durationLabel)})</span>` : ""}`,
    ),
  );
  rows.push(infoRow("Data e ora", escapeHtml(when)));
  if (price) rows.push(infoRow("Prezzo", escapeHtml(price)));
  if (resource && resource.length > 0) {
    rows.push(infoRow("Operatore", escapeHtml(resource)));
  }
  rows.push(infoRow("Cliente", escapeHtml(customer.display_name)));
  if (customer.email && customer.email.length > 0) {
    rows.push(infoRow("Email cliente", escapeHtml(customer.email)));
  }
  if (customer.phone && customer.phone.length > 0) {
    rows.push(infoRow("Telefono", escapeHtml(customer.phone)));
  }
  if (booking.notes && booking.notes.length > 0) {
    rows.push(infoRow("Note", escapeHtml(booking.notes)));
  }
  return rows.join("");
}

type ShellArgs = {
  businessProfile: SendBookingConfirmedParams["businessProfile"];
  title: string;
  preheader: string;
  bodyRowsHtml: string;
  ctaHref?: string;
  ctaLabel?: string;
};

function buildShellSafe(args: ShellArgs): string {
  const { ctaHref, ctaLabel, ...rest } = args;
  if (ctaHref != null && ctaLabel != null) {
    return buildShell({ ...rest, ctaHref, ctaLabel });
  }
  return buildShell(rest);
}

type SendEmailArgs = {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
};

async function sendEmailSafe(args: SendEmailArgs): Promise<{ id?: string | null }> {
  const { replyTo, ...rest } = args;
  if (replyTo != null) {
    return sendEmailRaw({ ...rest, replyTo });
  }
  return sendEmailRaw(rest);
}

export async function sendBookingConfirmed(
  params: SendBookingConfirmedParams,
): Promise<{ sent: boolean; id?: string | null }> {
  const { booking, customer, tenant, businessProfile, cancelToken } = params;
  if (!customer.email || customer.email.length === 0) return { sent: false };
  const serviceName = booking.services?.name ?? "Servizio";
  const tz = businessProfile.timezone || "Europe/Rome";
  const when = formatDateTimeLocal(booking.starts_at, tz);
  const subject = `Conferma prenotazione ${serviceName} ${when.split(",")[0] ?? ""}`.trim();
  const summaryRows = buildBookingSummaryRows({ booking, customer, tenant, businessProfile });
  const intro = `
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#374151;line-height:1.55;padding-bottom:14px;">
                    Ciao ${escapeHtml(customer.display_name.split(" ")[0] ?? customer.display_name)}, abbiamo ricevuto la tua prenotazione. Ecco i dettagli:
                  </td>
                </tr>`;
  const bodyRowsHtml = intro + summaryRows;
  const shellArgs: ShellArgs = {
    businessProfile,
    title: "Prenotazione confermata",
    preheader: `Grazie, ${serviceName} il ${when}`,
    bodyRowsHtml,
  };
  if (cancelToken != null) {
    shellArgs.ctaHref = buildCancelUrl({ slug: tenant.slug, token: cancelToken });
    shellArgs.ctaLabel = "Annulla prenotazione";
  }
  const html = buildShellSafe(shellArgs);
  try {
    const emailArgs: SendEmailArgs = {
      to: customer.email,
      from: getFromEmail(businessProfile.display_name),
      subject,
      html,
    };
    if (businessProfile.email != null && businessProfile.email.length > 0) {
      emailArgs.replyTo = businessProfile.email;
    }
    const result = await sendEmailSafe(emailArgs);
    return { sent: true, id: result.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] sendBookingConfirmed fallita per booking=${booking.id}: ${msg}`);
    return { sent: false };
  }
}

export async function sendBookingReminder24h(
  params: SendBookingReminderParams,
): Promise<{ sent: boolean; id?: string | null }> {
  const { booking, customer, tenant, businessProfile } = params;
  if (!customer.email || customer.email.length === 0) return { sent: false };
  const serviceName = booking.services?.name ?? "Servizio";
  const tz = businessProfile.timezone || "Europe/Rome";
  const when = formatDateTimeLocal(booking.starts_at, tz);
  const onlyTime = when.includes("alle") ? (when.split("alle")[1]?.trim() ?? when) : when;
  const subject = `⏰ Promemoria appuntamento domani ${onlyTime} a ${businessProfile.display_name ?? tenant.name}`;
  const intro = `
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#374151;line-height:1.55;padding-bottom:14px;">
                    Ciao ${escapeHtml(customer.display_name.split(" ")[0] ?? customer.display_name)}, ti ricordiamo il tuo appuntamento di domani presso <strong>${escapeHtml(businessProfile.display_name ?? tenant.name)}</strong>.
                  </td>
                </tr>`;
  const summaryRows = buildBookingSummaryRows(params);
  const shellArgs: ShellArgs = {
    businessProfile,
    title: "Promemoria appuntamento",
    preheader: `Domani ${onlyTime}: ${serviceName}`,
    bodyRowsHtml: intro + summaryRows,
  };
  try {
    const token = signBookingCancelToken({
      booking_id: booking.id,
      customer_email: customer.email,
    });
    shellArgs.ctaHref = buildCancelUrl({ slug: tenant.slug, token });
    shellArgs.ctaLabel = "Annulla o modifica";
  } catch {
    /* noop */
  }
  const html = buildShellSafe(shellArgs);
  try {
    const emailArgs: SendEmailArgs = {
      to: customer.email,
      from: getFromEmail(businessProfile.display_name),
      subject,
      html,
    };
    if (businessProfile.email != null && businessProfile.email.length > 0) {
      emailArgs.replyTo = businessProfile.email;
    }
    const result = await sendEmailSafe(emailArgs);
    return { sent: true, id: result.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] sendBookingReminder24h fallita per booking=${booking.id}: ${msg}`);
    return { sent: false };
  }
}

export async function sendBookingModified(
  params: SendBookingModifiedParams,
): Promise<{ sent: boolean; id?: string | null }> {
  const { booking, customer, tenant, businessProfile } = params;
  if (!customer.email || customer.email.length === 0) return { sent: false };
  const serviceName = booking.services?.name ?? "Servizio";
  const subject = `Modifica prenotazione ${serviceName}`;
  const intro = `
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#374151;line-height:1.55;padding-bottom:14px;">
                    Ciao ${escapeHtml(customer.display_name.split(" ")[0] ?? customer.display_name)}, la tua prenotazione è stata aggiornata. Ecco i nuovi dettagli:
                  </td>
                </tr>`;
  const summaryRows = buildBookingSummaryRows(params);
  const shellArgs: ShellArgs = {
    businessProfile,
    title: "Prenotazione modificata",
    preheader: `Nuovi dettagli per ${serviceName}`,
    bodyRowsHtml: intro + summaryRows,
  };
  try {
    const token = signBookingCancelToken({
      booking_id: booking.id,
      customer_email: customer.email,
    });
    shellArgs.ctaHref = buildCancelUrl({ slug: tenant.slug, token });
    shellArgs.ctaLabel = "Annulla prenotazione";
  } catch {
    /* noop */
  }
  const html = buildShellSafe(shellArgs);
  try {
    const emailArgs: SendEmailArgs = {
      to: customer.email,
      from: getFromEmail(businessProfile.display_name),
      subject,
      html,
    };
    if (businessProfile.email != null && businessProfile.email.length > 0) {
      emailArgs.replyTo = businessProfile.email;
    }
    const result = await sendEmailSafe(emailArgs);
    return { sent: true, id: result.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] sendBookingModified fallita per booking=${booking.id}: ${msg}`);
    return { sent: false };
  }
}

export async function sendBookingCancelled(
  params: SendBookingCancelledParams,
): Promise<{ sent: boolean; id?: string | null }> {
  const { booking, customer, businessProfile } = params;
  if (!customer.email || customer.email.length === 0) return { sent: false };
  const serviceName = booking.services?.name ?? "Servizio";
  const subject = `Prenotazione annullata — ${serviceName}`;
  const tz = businessProfile.timezone || "Europe/Rome";
  const when = formatDateTimeLocal(booking.starts_at, tz);
  const bodyRowsHtml = `
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#374151;line-height:1.55;padding-bottom:14px;">
                    Ciao ${escapeHtml(customer.display_name.split(" ")[0] ?? customer.display_name)}, confermiamo che la tua prenotazione per <strong>${escapeHtml(serviceName)}</strong> del <strong>${escapeHtml(when)}</strong> è stata annullata.
                  </td>
                </tr>
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6b7280;line-height:1.55;padding-top:8px;">
                    Se non hai richiesto questa cancellazione o hai bisogno di aiuto, rispondi a questa email.
                  </td>
                </tr>`;
  const html = buildShell({
    businessProfile,
    title: "Prenotazione annullata",
    preheader: `Cancellazione confermata: ${serviceName}`,
    bodyRowsHtml,
  });
  try {
    const emailArgs: SendEmailArgs = {
      to: customer.email,
      from: getFromEmail(businessProfile.display_name),
      subject,
      html,
    };
    if (businessProfile.email != null && businessProfile.email.length > 0) {
      emailArgs.replyTo = businessProfile.email;
    }
    const result = await sendEmailSafe(emailArgs);
    return { sent: true, id: result.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] sendBookingCancelled fallita per booking=${booking.id}: ${msg}`);
    return { sent: false };
  }
}

export async function sendDepositPaid(
  params: SendDepositPaidParams,
): Promise<{ sent: boolean; id?: string | null }> {
  const { booking, customer, tenant, businessProfile, amount, currency } = params;
  if (!customer.email || customer.email.length === 0) return { sent: false };
  const serviceName = booking.services?.name ?? "Servizio";
  const amountLabel = formatCurrency(amount / 100, currency);
  const subject = `Caparra ricevuta — ${serviceName}`;
  const intro = `
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#374151;line-height:1.55;padding-bottom:14px;">
                    Ciao ${escapeHtml(customer.display_name.split(" ")[0] ?? customer.display_name)}, grazie! Abbiamo ricevuto la caparra di <strong>${escapeHtml(amountLabel)}</strong>.
                  </td>
                </tr>`;
  const summaryRows = buildBookingSummaryRows({ booking, customer, tenant, businessProfile });
  const shellArgs: ShellArgs = {
    businessProfile,
    title: "Caparra ricevuta",
    preheader: `Pagamento di ${amountLabel} confermato`,
    bodyRowsHtml: intro + summaryRows,
  };
  try {
    const token = signBookingCancelToken({
      booking_id: booking.id,
      customer_email: customer.email,
    });
    shellArgs.ctaHref = buildCancelUrl({ slug: tenant.slug, token });
    shellArgs.ctaLabel = "Visualizza dettagli";
  } catch {
    /* noop */
  }
  const html = buildShellSafe(shellArgs);
  try {
    const emailArgs: SendEmailArgs = {
      to: customer.email,
      from: getFromEmail(businessProfile.display_name),
      subject,
      html,
    };
    if (businessProfile.email != null && businessProfile.email.length > 0) {
      emailArgs.replyTo = businessProfile.email;
    }
    const result = await sendEmailSafe(emailArgs);
    return { sent: true, id: result.id ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email] sendDepositPaid fallita per booking=${booking.id}: ${msg}`);
    return { sent: false };
  }
}
