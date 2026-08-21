export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type JsonObject = { [key: string]: Json };

export type Database = {
  graphql_public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: JsonObject;
          extensions?: JsonObject;
        };
        Returns: JsonObject;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          id: string;
          tenant_id: string | null;
          actor_user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          actor_user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          actor_user_id?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      business_profiles: {
        Row: {
          tenant_id: string;
          display_name: string | null;
          legal_name: string | null;
          category: string | null;
          description: string | null;
          phone: string | null;
          whatsapp: string | null;
          email: string | null;
          website_url: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          province: string | null;
          postal_code: string | null;
          country_code: string | null;
          latitude: number | null;
          longitude: number | null;
          timezone: string;
          locale: string;
          created_at: string;
          updated_at: string;
          theme_primary: string | null;
          theme_background: string | null;
          theme_foreground: string | null;
          theme_muted: string | null;
          theme_radius: string | null;
          theme_heading_font_preset: string | null;
          theme_body_font_preset: string | null;
        };
        Insert: {
          tenant_id: string;
          display_name?: string | null;
          legal_name?: string | null;
          category?: string | null;
          description?: string | null;
          phone?: string | null;
          whatsapp?: string | null;
          email?: string | null;
          website_url?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          province?: string | null;
          postal_code?: string | null;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          timezone?: string;
          locale?: string;
          created_at?: string;
          updated_at?: string;
          theme_primary?: string | null;
          theme_background?: string | null;
          theme_foreground?: string | null;
          theme_muted?: string | null;
          theme_radius?: string | null;
          theme_heading_font_preset?: string | null;
          theme_body_font_preset?: string | null;
        };
        Update: {
          tenant_id?: string;
          display_name?: string | null;
          legal_name?: string | null;
          category?: string | null;
          description?: string | null;
          phone?: string | null;
          whatsapp?: string | null;
          email?: string | null;
          website_url?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          province?: string | null;
          postal_code?: string | null;
          country_code?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          timezone?: string;
          locale?: string;
          created_at?: string;
          updated_at?: string;
          theme_primary?: string | null;
          theme_background?: string | null;
          theme_foreground?: string | null;
          theme_muted?: string | null;
          theme_radius?: string | null;
          theme_heading_font_preset?: string | null;
          theme_body_font_preset?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "business_profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          user_id: string;
          status: string;
          grant_reason: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          user_id: string;
          status?: string;
          grant_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          user_id?: string;
          status?: string;
          grant_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          price_from: number | null;
          currency: string;
          duration_minutes: number | null;
          active: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          price_from?: number | null;
          currency?: string;
          duration_minutes?: number | null;
          active?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          description?: string | null;
          price_from?: number | null;
          currency?: string;
          duration_minutes?: number | null;
          active?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      business_availability: {
        Row: {
          tenant_id: string;
          weekday: number;
          enabled: boolean;
          start_time: string;
          end_time: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          weekday: number;
          enabled?: boolean;
          start_time?: string;
          end_time?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          weekday?: number;
          enabled?: boolean;
          start_time?: string;
          end_time?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_availability_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          id: string;
          tenant_id: string;
          service_id: string;
          starts_at: string;
          ends_at: string;
          status: string;
          customer_name: string;
          customer_email: string | null;
          customer_phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          service_id: string;
          starts_at: string;
          ends_at: string;
          status?: string;
          customer_name: string;
          customer_email?: string | null;
          customer_phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          service_id?: string;
          starts_at?: string;
          ends_at?: string;
          status?: string;
          customer_name?: string;
          customer_email?: string | null;
          customer_phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      site_editorial_state: {
        Row: {
          tenant_id: string;
          sections: Json;
          services: Json;
          theme: Json;
          draft_revision: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          sections?: Json;
          services?: Json;
          theme?: Json;
          draft_revision?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          sections?: Json;
          services?: Json;
          theme?: Json;
          draft_revision?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_editorial_state_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      site_sections: {
        Row: {
          id: string;
          tenant_id: string;
          section_type: string;
          position: number;
          enabled: boolean;
          variant: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          section_type: string;
          position?: number;
          enabled?: boolean;
          variant?: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          section_type?: string;
          position?: number;
          enabled?: boolean;
          variant?: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_sections_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          role?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: string;
          created_at: string;
          updated_at: string;
          published: boolean;
          temporary_domain: string | null;
          custom_domain: string | null;
          published_at: string | null;
          plan_id: "base" | "pro" | "internal_test";
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
          published?: boolean;
          temporary_domain?: string | null;
          custom_domain?: string | null;
          published_at?: string | null;
          plan_id?: "base" | "pro" | "internal_test";
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
          published?: boolean;
          temporary_domain?: string | null;
          custom_domain?: string | null;
          published_at?: string | null;
          plan_id?: "base" | "pro" | "internal_test";
        };
        Relationships: [];
      };
      billing_customers: {
        Row: {
          id: string;
          tenant_id: string;
          provider: string;
          provider_customer_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          provider?: string;
          provider_customer_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          provider?: string;
          provider_customer_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_customers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_subscriptions: {
        Row: {
          id: string;
          tenant_id: string;
          provider: string;
          provider_customer_id: string;
          provider_subscription_id: string;
          provider_price_id: string;
          status: string;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          ended_at: string | null;
          provider_created_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          provider?: string;
          provider_customer_id: string;
          provider_subscription_id: string;
          provider_price_id: string;
          status: string;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          ended_at?: string | null;
          provider_created_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          provider?: string;
          provider_customer_id?: string;
          provider_subscription_id?: string;
          provider_price_id?: string;
          status?: string;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          ended_at?: string | null;
          provider_created_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_subscriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_webhook_events: {
        Row: {
          provider_event_id: string;
          provider: string;
          event_type: string;
          processed_at: string;
        };
        Insert: {
          provider_event_id: string;
          provider?: string;
          event_type?: string;
          processed_at?: string;
        };
        Update: {
          provider_event_id?: string;
          provider?: string;
          event_type?: string;
          processed_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_tenant_with_owner: {
        Args: {
          p_business_name: string;
          p_category: string;
          p_city: string;
          p_province: string;
          p_phone?: string;
          p_business_email?: string;
          p_timezone?: string;
          p_locale?: string;
        };
        Returns: Json;
      };
      publish_site_draft: {
        Args: {
          p_tenant_id: string;
          p_expected_revision?: string;
        };
        Returns: {
          ok: boolean;
          code: string;
          message: string;
          new_published_at: string;
          sections_applied: number;
          services_applied: number;
          theme_applied: boolean;
        }[];
      };
      admin_set_tenant_plan: {
        Args: {
          p_tenant_id: string;
          p_target_plan: string;
        };
        Returns: {
          ok: boolean;
          code: string;
          message: string;
          old_plan: string;
          new_plan: string;
          is_platform_admin: boolean;
          audit_skipped: boolean;
        }[];
      };
      billing_apply_subscription_plan: {
        Args: {
          p_tenant_id: string;
          p_target_plan: string;
          p_provider_event_id: string;
          p_provider_subscription_id: string;
        };
        Returns: {
          ok: boolean;
          code: string;
          old_plan: string;
          new_plan: string;
          idempotent_replay: boolean;
        }[];
      };
      public_booking_create_slug: {
        Args: {
          p_slug: string;
          p_service_id: string;
          p_starts_at: string;
          p_customer_name: string;
          p_customer_email?: string;
          p_customer_phone?: string;
          p_notes?: string;
        };
        Returns: {
          booking_id: string;
          booking_status: string;
          starts_at: string;
          ends_at: string;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type SchemaName = keyof Database;

type PublicSchemaName = Extract<SchemaName, "public">;

type TableInfo<S extends SchemaName> = Database[S]["Tables"];

type PublicTableName = keyof TableInfo<PublicSchemaName>;

export type Tables<T extends PublicTableName> = Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends PublicTableName> = Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends PublicTableName> = Database["public"]["Tables"][T]["Update"];

export type Enums<E extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][E];

export type Functions<F extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][F];
