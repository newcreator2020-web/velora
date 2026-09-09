import type { Database as DbBase, Json as JsonBase } from "./supabase-base";

export type Json = JsonBase;

export type DepositStrategyEnum = "NONE" | "PERCENT" | "FIXED";
export type PaymentStatusEnum =
  "pending" | "paid" | "failed" | "refunded" | "partially_refunded" | "disputed";
export type BookingPaymentStatusEnum = "unpaid" | "deposit_paid" | "paid";
export type GdprConsentType =
  | "cookie_preferences_accepted"
  | "privacy_policy_read"
  | "marketing_consent_granted"
  | "profiling_consent_granted";
export type DomainVerificationStatus = "pending" | "verified" | "failed_disabled";
export type ProspectStatus =
  | "mai_contattato"
  | "da_chiamare"
  | "chiamato"
  | "richiamare"
  | "interessato"
  | "cliente"
  | "non_interessato"
  | "non_contattare";
export type MediaCategory =
  "immagine_generica" | "servizio" | "staff" | "gallery" | "hero" | "logo" | "sfondo" | "documento";
export type MediaStatus = "draft" | "published" | "archived";
export type MediaAssociationType =
  | "servizio"
  | "staff"
  | "gallery_item"
  | "hero_slide"
  | "sezione_sito"
  | "business_logo"
  | "business_sfondo"
  | "prospetto_foto";

type TablesBase = DbBase["public"]["Tables"];

type ServicesRowExtra = TablesBase["services"]["Row"] & {
  deposit_strategy: DepositStrategyEnum;
  deposit_value: number;
};
type ServicesInsertExtra = TablesBase["services"]["Insert"] & {
  deposit_strategy?: DepositStrategyEnum;
  deposit_value?: number;
};
type ServicesUpdateExtra = TablesBase["services"]["Update"] & {
  deposit_strategy?: DepositStrategyEnum;
  deposit_value?: number;
};

type BookingsRowExtra = TablesBase["bookings"]["Row"] & {
  reminder_sent: boolean;
  payment_status: BookingPaymentStatusEnum;
  deposit_amount: number | null;
};
type BookingsInsertExtra = TablesBase["bookings"]["Insert"] & {
  reminder_sent?: boolean;
  payment_status?: BookingPaymentStatusEnum;
  deposit_amount?: number | null;
};
type BookingsUpdateExtra = TablesBase["bookings"]["Update"] & {
  reminder_sent?: boolean;
  payment_status?: BookingPaymentStatusEnum;
  deposit_amount?: number | null;
};

type TenantsRowExtra = TablesBase["tenants"]["Row"] & {
  custom_domain_status: DomainVerificationStatus;
  custom_domain_verification_token: string | null;
  custom_domain_verified_at: string | null;
  custom_domain_routing_ready: boolean;
  custom_domain_ownership_verified_at: string | null;
  custom_domain_routing_checked_at: string | null;
  custom_domain_routing_verified_at: string | null;
};
type TenantsInsertExtra = TablesBase["tenants"]["Insert"] & {
  custom_domain_status?: DomainVerificationStatus;
  custom_domain_verification_token?: string | null;
  custom_domain_verified_at?: string | null;
  custom_domain_routing_ready?: boolean;
  custom_domain_ownership_verified_at?: string | null;
  custom_domain_routing_checked_at?: string | null;
  custom_domain_routing_verified_at?: string | null;
};
type TenantsUpdateExtra = TablesBase["tenants"]["Update"] & {
  custom_domain_status?: DomainVerificationStatus;
  custom_domain_verification_token?: string | null;
  custom_domain_verified_at?: string | null;
  custom_domain_routing_ready?: boolean;
  custom_domain_ownership_verified_at?: string | null;
  custom_domain_routing_checked_at?: string | null;
  custom_domain_routing_verified_at?: string | null;
};

type Payments = {
  Row: {
    id: string;
    tenant_id: string;
    booking_id: string | null;
    stripe_session_id: string | null;
    stripe_payment_intent_id: string | null;
    stripe_customer_id: string | null;
    amount: number;
    currency: string;
    status: PaymentStatusEnum;
    idempotency_key: string | null;
    failure_reason: string | null;
    failure_code: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    tenant_id: string;
    booking_id?: string | null;
    stripe_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
    stripe_customer_id?: string | null;
    amount: number;
    currency?: string;
    status?: PaymentStatusEnum;
    idempotency_key?: string | null;
    failure_reason?: string | null;
    failure_code?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    tenant_id?: string;
    booking_id?: string | null;
    stripe_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
    stripe_customer_id?: string | null;
    amount?: number;
    currency?: string;
    status?: PaymentStatusEnum;
    idempotency_key?: string | null;
    failure_reason?: string | null;
    failure_code?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type GdprConsents = {
  Row: {
    id: string;
    tenant_id: string;
    booking_id: string | null;
    type: GdprConsentType;
    ip_address: string | null;
    user_agent: string | null;
    consent_url: string | null;
    payload: Json;
    created_at: string;
  };
  Insert: {
    id?: string;
    tenant_id: string;
    booking_id?: string | null;
    type: GdprConsentType;
    ip_address?: string | null;
    user_agent?: string | null;
    consent_url?: string | null;
    payload?: Json;
    created_at?: string;
  };
  Update: {
    id?: string;
    tenant_id?: string;
    booking_id?: string | null;
    type?: GdprConsentType;
    ip_address?: string | null;
    user_agent?: string | null;
    consent_url?: string | null;
    payload?: Json;
    created_at?: string;
  };
  Relationships: [];
};

type PlatformProvisioningRequests = {
  Row: {
    idempotency_key: string;
    actor_user_id: string;
    owner_user_id: string;
    tenant_id: string;
    slug: string;
    plan_id: string;
    result_snapshot: Json | null;
    created_at: string;
  };
  Insert: {
    idempotency_key: string;
    actor_user_id: string;
    owner_user_id: string;
    tenant_id: string;
    slug: string;
    plan_id: string;
    result_snapshot?: Json | null;
    created_at?: string;
  };
  Update: {
    idempotency_key?: string;
    actor_user_id?: string;
    owner_user_id?: string;
    tenant_id?: string;
    slug?: string;
    plan_id?: string;
    result_snapshot?: Json | null;
    created_at?: string;
  };
  Relationships: [];
};

type Prospects = {
  Row: {
    id: string;
    created_by: string | null;
    assigned_to: string | null;
    business_name: string;
    business_category: string | null;
    comune: string;
    telefono: string | null;
    email: string | null;
    sito_web: boolean;
    sito_quality_score: number | null;
    gmb_url: string | null;
    status: ProspectStatus;
    note: string | null;
    ultimo_contatto_at: string | null;
    prossimo_contatto_at: string | null;
    promoted_to_tenant_id: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    created_by?: string | null;
    assigned_to?: string | null;
    business_name: string;
    business_category?: string | null;
    comune: string;
    telefono?: string | null;
    email?: string | null;
    sito_web?: boolean;
    sito_quality_score?: number | null;
    gmb_url?: string | null;
    status?: ProspectStatus;
    note?: string | null;
    ultimo_contatto_at?: string | null;
    prossimo_contatto_at?: string | null;
    promoted_to_tenant_id?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    created_by?: string | null;
    assigned_to?: string | null;
    business_name?: string;
    business_category?: string | null;
    comune?: string;
    telefono?: string | null;
    email?: string | null;
    sito_web?: boolean;
    sito_quality_score?: number | null;
    gmb_url?: string | null;
    status?: ProspectStatus;
    note?: string | null;
    ultimo_contatto_at?: string | null;
    prossimo_contatto_at?: string | null;
    promoted_to_tenant_id?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type ProspectActivities = {
  Row: {
    id: string;
    prospect_id: string;
    author_user_id: string;
    activity_kind:
      | "chiamata"
      | "sms"
      | "email"
      | "appuntamento"
      | "nota_interna"
      | "cambio_stato"
      | "cambio_assegnazione"
      | "promosso_tenant";
    summary: string;
    outcome: string | null;
    metadata: Json;
    created_at: string;
  };
  Insert: {
    id?: string;
    prospect_id: string;
    author_user_id: string;
    activity_kind: ProspectActivities["Row"]["activity_kind"];
    summary: string;
    outcome?: string | null;
    metadata?: Json;
    created_at?: string;
  };
  Update: {
    id?: string;
    prospect_id?: string;
    author_user_id?: string;
    activity_kind?: ProspectActivities["Row"]["activity_kind"];
    summary?: string;
    outcome?: string | null;
    metadata?: Json;
    created_at?: string;
  };
  Relationships: [];
};

type MediaLibrary = {
  Row: {
    id: string;
    filename_orig: string;
    stored_path: string;
    mime_type: string;
    file_size_bytes: number;
    width_px: number | null;
    height_px: number | null;
    checksum_sha256: string | null;
    alt_text: string | null;
    caption: string | null;
    category: MediaCategory;
    variants: Json | null;
    owner_tenant_id: string | null;
    created_by: string;
    status: MediaStatus;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    filename_orig: string;
    stored_path: string;
    mime_type: string;
    file_size_bytes: number;
    width_px?: number | null;
    height_px?: number | null;
    checksum_sha256?: string | null;
    alt_text?: string | null;
    caption?: string | null;
    category?: MediaCategory;
    variants?: Json | null;
    owner_tenant_id?: string | null;
    created_by: string;
    status?: MediaStatus;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    filename_orig?: string;
    stored_path?: string;
    mime_type?: string;
    file_size_bytes?: number;
    width_px?: number | null;
    height_px?: number | null;
    checksum_sha256?: string | null;
    alt_text?: string | null;
    caption?: string | null;
    category?: MediaCategory;
    variants?: Json | null;
    owner_tenant_id?: string | null;
    created_by?: string;
    status?: MediaStatus;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

type MediaAssocs = {
  Row: {
    id: string;
    media_id: string;
    association_type: MediaAssociationType;
    assoc_key_id: string;
    tenant_id: string | null;
    ordine: number;
    metadata: Json | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    media_id: string;
    association_type: MediaAssociationType;
    assoc_key_id: string;
    tenant_id?: string | null;
    ordine?: number;
    metadata?: Json | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    media_id?: string;
    association_type?: MediaAssociationType;
    assoc_key_id?: string;
    tenant_id?: string | null;
    ordine?: number;
    metadata?: Json | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [];
};

export type Database = {
  public: {
    Tables: Omit<TablesBase, "services" | "bookings" | "tenants"> & {
      services: {
        Row: ServicesRowExtra;
        Insert: ServicesInsertExtra;
        Update: ServicesUpdateExtra;
        Relationships: TablesBase["services"]["Relationships"];
      };
      bookings: {
        Row: BookingsRowExtra;
        Insert: BookingsInsertExtra;
        Update: BookingsUpdateExtra;
        Relationships: TablesBase["bookings"]["Relationships"];
      };
      tenants: {
        Row: TenantsRowExtra;
        Insert: TenantsInsertExtra;
        Update: TenantsUpdateExtra;
        Relationships: TablesBase["tenants"]["Relationships"];
      };
      payments: Payments;
      gdpr_consents: GdprConsents;
      platform_provisioning_requests: PlatformProvisioningRequests;
      prospects: Prospects;
      prospect_activities: ProspectActivities;
      media_library: MediaLibrary;
      media_assocs: MediaAssocs;
    };
    Views: DbBase["public"]["Views"];
    Functions: DbBase["public"]["Functions"];
    Enums: DbBase["public"]["Enums"] & {
      deposit_strategy_enum: DepositStrategyEnum;
      payment_status_enum: PaymentStatusEnum;
      booking_payment_status_enum: BookingPaymentStatusEnum;
      gdpr_consent_type: GdprConsentType;
      domain_verification_status: DomainVerificationStatus;
      prospect_status: ProspectStatus;
      media_category: MediaCategory;
      media_status: MediaStatus;
      media_association_type: MediaAssociationType;
    };
    CompositeTypes: DbBase["public"]["CompositeTypes"];
  };
};

type _Wrapper = Database;
type _DefaultSchema = _Wrapper[Extract<keyof _Wrapper, "public">];

export type Tables<
  NameOrOpts extends
    keyof (_DefaultSchema["Tables"] & _DefaultSchema["Views"]) | { schema: keyof _Wrapper },
  TableName extends (NameOrOpts extends { schema: keyof _Wrapper }
    ? keyof (_Wrapper[NameOrOpts["schema"]]["Tables"] & _Wrapper[NameOrOpts["schema"]]["Views"])
    : never) = never,
> = NameOrOpts extends { schema: keyof _Wrapper }
  ? (_Wrapper[NameOrOpts["schema"]]["Tables"] &
      _Wrapper[NameOrOpts["schema"]]["Views"])[TableName] extends { Row: infer R }
    ? R
    : never
  : NameOrOpts extends keyof (_DefaultSchema["Tables"] & _DefaultSchema["Views"])
    ? (_DefaultSchema["Tables"] & _DefaultSchema["Views"])[NameOrOpts] extends { Row: infer R }
      ? R
      : never
    : never;

export type TablesInsert<
  NameOrOpts extends keyof _DefaultSchema["Tables"] | { schema: keyof _Wrapper },
  TableName extends (NameOrOpts extends { schema: keyof _Wrapper }
    ? keyof _Wrapper[NameOrOpts["schema"]]["Tables"]
    : never) = never,
> = NameOrOpts extends { schema: keyof _Wrapper }
  ? _Wrapper[NameOrOpts["schema"]]["Tables"][TableName] extends { Insert: infer I }
    ? I
    : never
  : NameOrOpts extends keyof _DefaultSchema["Tables"]
    ? _DefaultSchema["Tables"][NameOrOpts] extends { Insert: infer I }
      ? I
      : never
    : never;

export type TablesUpdate<
  NameOrOpts extends keyof _DefaultSchema["Tables"] | { schema: keyof _Wrapper },
  TableName extends (NameOrOpts extends { schema: keyof _Wrapper }
    ? keyof _Wrapper[NameOrOpts["schema"]]["Tables"]
    : never) = never,
> = NameOrOpts extends { schema: keyof _Wrapper }
  ? _Wrapper[NameOrOpts["schema"]]["Tables"][TableName] extends { Update: infer U }
    ? U
    : never
  : NameOrOpts extends keyof _DefaultSchema["Tables"]
    ? _DefaultSchema["Tables"][NameOrOpts] extends { Update: infer U }
      ? U
      : never
    : never;
