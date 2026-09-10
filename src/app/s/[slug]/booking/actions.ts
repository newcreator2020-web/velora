"use server";

import "server-only";
import { headers } from "next/headers";
import { BookingError, createPublicBooking, type PublicBookingResult } from "@/lib/server/booking";
import { resolvePublicTenant, slugSchema } from "@/lib/server/site-engine";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  sendBookingConfirmed,
  signBookingCancelToken,
  type EmailBookingContext,
} from "@/lib/server/email";
import type { Database } from "@/types/supabase";

export type BankInfo = {
  account_holder: string | null;
  iban: string | null;
  bic_swift: string | null;
  bank_name: string | null;
  payment_note_template: string | null;
  country: string | null;
};

export type BookingPaymentInfo = {
  total_price_cents: number;
  deposit_amount_cents: number | null;
  currency: string;
  payment_status: string;
  bank_info: BankInfo | null;
  service_name: string | null;
};

export type BookingActionState = {
  ok: boolean;
  error_code?: string | undefined;
  error?: string | undefined;
  booking?: PublicBookingResult | undefined;
  redirectToCheckout?: string | undefined;
  payment?: BookingPaymentInfo | undefined;
  bank_declared?:
    | {
        ok: boolean;
        deposit_payment_ref: string | null;
        deposit_payment_method: string | null;
        deposit_requested_at: string | null;
      }
    | undefined;
  declare_error?: string | undefined;
  fieldErrors?:
    | {
        booking?: string | undefined;
        declare?: string | undefined;
      }
    | undefined;
};

type BookingFullJoinRow = Database["public"]["Tables"]["bookings"]["Row"] & {
  reminder_sent?: boolean | null;
  services: Pick<
    Database["public"]["Tables"]["services"]["Row"],
    "name" | "duration_minutes" | "price_from" | "currency"
  > | null;
  staff_resources: { display_name: string | null } | null;
  tenants: Pick<Database["public"]["Tables"]["tenants"]["Row"], "id" | "name" | "slug"> | null;
  business_profiles: Pick<
    Database["public"]["Tables"]["business_profiles"]["Row"],
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
  > | null;
};

async function savePrivacyConsent(opts: {
  slug: string;
  bookingId: string;
  ipAddressRaw: string | null;
  userAgent: string | null;
  consentUrl: string | null;
}): Promise<void> {
  const parsedSlug = slugSchema.safeParse(opts.slug);
  if (!parsedSlug.success) return;
  const tenant = await resolvePublicTenant({ slug: parsedSlug.data });
  if (tenant._tag !== "Found") return;
  try {
    const sb = getSupabaseServiceClient();
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenant.tenantId,
      booking_id: opts.bookingId,
      type: "privacy_policy_read",
      user_agent: opts.userAgent,
      consent_url: opts.consentUrl,
      payload: {
        privacy_version: "v1",
        form_accepted: true,
      },
    };
    if (opts.ipAddressRaw) {
      insertPayload["ip_address"] = opts.ipAddressRaw;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb as any).from("gdpr_consents").insert(insertPayload);
  } catch {
    // non fallire la prenotazione per un errore audit
  }
}

async function enrichAndSendConfirmation(params: {
  bookingId: string;
  fallbackEmail: string | null;
  fallbackName: string;
  fallbackPhone: string | null;
}) {
  try {
    const svc = getSupabaseServiceClient();

    const bQ = await svc.from("bookings").select("*").eq("id", params.bookingId).maybeSingle();
    const booking = bQ.data;
    if (bQ.error || !booking) {
      console.warn(
        `[booking-actions] enrich fallito booking=${params.bookingId}: ${
          bQ.error?.message ?? "booking non trovato"
        }`,
      );
      return;
    }

    const [svcRes, staffRes, tenantRes, bpRes] = await Promise.all([
      svc
        .from("services")
        .select("name, duration_minutes, price_from, currency")
        .eq("id", booking.service_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("staff_resources")
        .select("display_name")
        .eq("id", booking.resource_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("tenants")
        .select("id, name, slug")
        .eq("id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
      svc
        .from("business_profiles")
        .select(
          "display_name, legal_name, theme_primary, address_line1, city, postal_code, province, country_code, timezone, email, phone",
        )
        .eq("tenant_id", booking.tenant_id!)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!tenantRes.data || !bpRes.data) {
      console.warn(`[booking-actions] enrich fallito booking=${params.bookingId}: dati incompleti`);
      return;
    }
    const data: BookingFullJoinRow = {
      ...booking,
      services: svcRes.data,
      staff_resources: staffRes.data ?? null,
      tenants: tenantRes.data!,
      business_profiles: bpRes.data!,
    };
    const customer = {
      display_name: data.customer_name || params.fallbackName,
      email:
        (data.customer_email && data.customer_email.length > 0 ? data.customer_email : null) ??
        params.fallbackEmail,
      phone:
        (data.customer_phone && data.customer_phone.length > 0 ? data.customer_phone : null) ??
        params.fallbackPhone,
    };
    if (!customer.email || customer.email.length === 0) return;
    const ctx: EmailBookingContext = {
      booking: data,
      customer,
      tenant: data.tenants!,
      businessProfile: data.business_profiles!,
    };
    let cancelToken: string | undefined;
    try {
      cancelToken = signBookingCancelToken({
        booking_id: data.id,
        customer_email: customer.email,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[booking-actions] sign cancel token fallito booking=${data.id}: ${msg}`);
      cancelToken = undefined;
    }
    if (cancelToken != null) {
      await sendBookingConfirmed({ ...ctx, cancelToken });
    } else {
      await sendBookingConfirmed(ctx);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[booking-actions] send email non bloccante fallita: ${msg}`);
  }
}

function scheduleEmailConfirmation(params: {
  bookingId: string;
  fallbackEmail: string | null;
  fallbackName: string;
  fallbackPhone: string | null;
}) {
  void enrichAndSendConfirmation(params);
}

export async function createBookingAction(form: FormData): Promise<BookingActionState> {
  console.warn("🚨 createBookingAction FORM KEYS COUNT:", [...form.keys()].length);
  [...form.entries()].forEach(([k, v]) => {
    const strVal =
      typeof v === "string" ? v : v instanceof File ? `FILE[${v.name} ${v.size}b]` : String(v);
    console.warn(`   📌 [${k}]=${strVal.slice(0, 120)}`);
  });

  const result = await runCreateBookingAction(form);

  console.warn(
    "🚀 createBookingAction RESULT:",
    "ok=" + result.ok,
    "error_code=" + (result.error_code ?? "none"),
    "error=" + (result.error ?? "none").slice(0, 100),
    "booking_id=" +
      (result.booking?.booking_id ? String(result.booking.booking_id).slice(0, 10) + "…" : "null"),
    "redirectToCheckout=" +
      (result.redirectToCheckout ? "YES(" + String(result.redirectToCheckout).length + ")" : "NO"),
  );
  return result;
}

async function runCreateBookingAction(form: FormData): Promise<BookingActionState> {
  const rawPrivacy = form.get("privacy_accepted")?.toString();
  if (rawPrivacy !== "1") {
    return {
      ok: false,
      error_code: "validation_error",
      error:
        "Devi dichiarare di aver letto e accettato la Privacy Policy ai sensi dell'art. 13 GDPR.",
      fieldErrors: {
        booking: "Devi accettare la Privacy Policy per proseguire con la prenotazione.",
      },
    };
  }

  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;
  const host = hdrs.get("host") ?? null;
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const pathname = hdrs.get("x-next-pathname") ?? null;
  const consentUrl = host && pathname ? `${proto}://${host}${pathname}` : null;

  const fallbackEmailRaw = form.get("customer_email")?.toString() ?? "";
  const fallbackEmail = fallbackEmailRaw && fallbackEmailRaw.length > 0 ? fallbackEmailRaw : null;
  const fallbackName = form.get("customer_name")?.toString() ?? "Cliente";
  const fallbackPhoneRaw = form.get("customer_phone")?.toString() ?? "";
  const fallbackPhone = fallbackPhoneRaw && fallbackPhoneRaw.length > 0 ? fallbackPhoneRaw : null;
  const slug = form.get("slug")?.toString() ?? "";

  try {
    const booking = await createPublicBooking({
      slug,
      service_id: form.get("service_id")?.toString() ?? "",
      starts_at: (form.get("starts_at")?.toString() ?? "") as unknown as Date,
      customer_name: fallbackName,
      customer_email: fallbackEmail ?? "",
      customer_phone: fallbackPhone ?? "",
      notes: form.get("notes")?.toString() ?? "",
      resource_slug: form.get("resource_slug")?.toString() ?? "any",
    });

    await savePrivacyConsent({
      slug,
      bookingId: booking.booking_id,
      ipAddressRaw: ipRaw,
      userAgent,
      consentUrl,
    });

    scheduleEmailConfirmation({
      bookingId: booking.booking_id,
      fallbackEmail,
      fallbackName,
      fallbackPhone,
    });

    try {
      const serviceId = form.get("service_id")?.toString() ?? "";
      const parsedSlug = slugSchema.safeParse(slug);
      let tenantId: string | null = null;
      if (parsedSlug.success) {
        const t = await resolvePublicTenant({ slug: parsedSlug.data });
        if (t._tag === "Found") tenantId = t.tenantId;
      }
      if (!tenantId) {
        return { ok: true as const, booking };
      }
      const sb = getSupabaseServiceClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sbAny = sb as unknown as any;
      const [svcRes, bkRes, bankRes] = await Promise.all([
        sb
          .from("services")
          .select("id, tenant_id, currency, price_from, name, deposit_strategy, deposit_value")
          .eq("id", serviceId)
          .eq("tenant_id", tenantId)
          .limit(1)
          .maybeSingle(),
        sb
          .from("bookings")
          .select("id, payment_status, deposit_amount")
          .eq("id", booking.booking_id)
          .limit(1)
          .maybeSingle(),
        sbAny
          .from("tenant_bank_accounts")
          .select("account_holder, iban, bic_swift, bank_name, payment_note_template, country")
          .eq("tenant_id", tenantId)
          .eq("is_primary", true)
          .eq("active", true)
          .limit(1)
          .maybeSingle(),
      ]);

      const svcRow = svcRes.data as {
        id: string;
        tenant_id: string;
        currency: string | null;
        price_from: number | null;
        name: string | null;
        deposit_strategy: string | null;
        deposit_value: number | null;
      } | null;
      const bkRow = bkRes.data as {
        id: string;
        payment_status: string | null;
        deposit_amount: number | null;
      } | null;
      const bankRow = bankRes.data as BankInfo | null;

      const totalCents =
        svcRow?.price_from != null && Number.isFinite(svcRow.price_from)
          ? Number(svcRow.price_from)
          : Number(booking.total_price ?? 0);
      const depositCents =
        bkRow && bkRow.deposit_amount != null && Number.isFinite(bkRow.deposit_amount)
          ? Number(bkRow.deposit_amount)
          : booking.deposit_amount != null && Number.isFinite(booking.deposit_amount)
            ? Number(booking.deposit_amount)
            : null;

      const payment: BookingPaymentInfo = {
        total_price_cents: totalCents,
        deposit_amount_cents: depositCents,
        currency: svcRow?.currency ?? "EUR",
        payment_status: bkRow?.payment_status ?? "unpaid",
        bank_info: bankRow ? bankRow : null,
        service_name: svcRow?.name ?? null,
      };

      return { ok: true as const, booking, payment };
    } catch (err) {
      console.warn(
        `[booking-actions] enrich payment fallito: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: true as const, booking };
    }
  } catch (e) {
    if (e instanceof BookingError) {
      return { ok: false as const, error_code: e.code, error: e.userMessage };
    }
    if (e instanceof Error) {
      return { ok: false as const, error: e.message };
    }
    return { ok: false as const, error: "Impossibile prenotare. Riprova tra qualche minuto." };
  }
}

export async function declareBankTransferAction(
  prev: BookingActionState,
  form: FormData,
): Promise<BookingActionState> {
  const bookingId = form.get("booking_id")?.toString() ?? "";
  const cro = form.get("deposit_payment_ref")?.toString() ?? "";
  const note = form.get("deposit_payment_note")?.toString() ?? "";
  const email = form.get("customer_email")?.toString() ?? "";

  if (!bookingId || bookingId.length < 10) {
    return {
      ...prev,
      ok: false,
      declare_error: "Prenotazione non valida. Ricarica la pagina e riprova.",
      fieldErrors: { declare: "Prenotazione non valida." },
    };
  }
  if (!cro || cro.trim().length < 5) {
    return {
      ...prev,
      ok: false,
      declare_error: "Inserisci il CRO / codice di riferimento del bonifico (almeno 5 caratteri).",
      fieldErrors: { declare: "CRO obbligatorio." },
    };
  }

  try {
    const sb = getSupabaseServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAnyRpc = sb as unknown as any;
    const { data, error } = await sbAnyRpc.rpc("booking_public_declare_bank_transfer", {
      p_booking_id: bookingId,
      p_customer_email: email,
      p_cro_ref: cro,
      p_note: note,
    });
    if (error) {
      return {
        ...prev,
        ok: false,
        declare_error:
          "Non siamo riusciti a registrare la conferma. Contatta la struttura telefonicamente.",
      };
    }
    const rows =
      (data as unknown as Array<{
        ok: boolean;
        deposit_payment_ref: string | null;
        deposit_payment_method: string | null;
        deposit_requested_at: string | null;
      }> | null) ?? [];
    const row = rows[0];
    if (!row || !row.ok) {
      return {
        ...prev,
        ok: false,
        declare_error:
          "Non siamo riusciti a registrare la conferma. Contatta la struttura telefonicamente.",
      };
    }
    return {
      ...prev,
      ok: true,
      bank_declared: {
        ok: true,
        deposit_payment_ref: row.deposit_payment_ref,
        deposit_payment_method: row.deposit_payment_method,
        deposit_requested_at: row.deposit_requested_at,
      },
      declare_error: undefined,
      fieldErrors: undefined,
    };
  } catch (e) {
    return {
      ...prev,
      ok: false,
      declare_error:
        e instanceof Error
          ? e.message
          : "Non siamo riusciti a registrare la conferma. Riprova tra poco.",
    };
  }
}
