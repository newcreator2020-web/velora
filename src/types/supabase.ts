export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_kind: string;
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_kind?: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_kind?: string;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_customers: {
        Row: {
          created_at: string;
          id: string;
          provider: string;
          provider_customer_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          provider?: string;
          provider_customer_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          provider?: string;
          provider_customer_id?: string;
          tenant_id?: string;
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
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          ended_at: string | null;
          id: string;
          provider: string;
          provider_created_at: string;
          provider_customer_id: string;
          provider_price_id: string;
          provider_subscription_id: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          ended_at?: string | null;
          id?: string;
          provider?: string;
          provider_created_at?: string;
          provider_customer_id: string;
          provider_price_id: string;
          provider_subscription_id: string;
          status: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          ended_at?: string | null;
          id?: string;
          provider?: string;
          provider_created_at?: string;
          provider_customer_id?: string;
          provider_price_id?: string;
          provider_subscription_id?: string;
          status?: string;
          tenant_id?: string;
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
          event_type: string;
          processed_at: string;
          provider: string;
          provider_event_created_at: string | null;
          provider_event_id: string;
          provider_subscription_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          event_type?: string;
          processed_at?: string;
          provider?: string;
          provider_event_created_at?: string | null;
          provider_event_id: string;
          provider_subscription_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          event_type?: string;
          processed_at?: string;
          provider?: string;
          provider_event_created_at?: string | null;
          provider_event_id?: string;
          provider_subscription_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          created_at: string;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          ends_at: string;
          id: string;
          notes: string | null;
          resource_id: string | null;
          service_id: string;
          starts_at: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name: string;
          customer_phone?: string | null;
          ends_at: string;
          id?: string;
          notes?: string | null;
          resource_id?: string | null;
          service_id: string;
          starts_at: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          customer_phone?: string | null;
          ends_at?: string;
          id?: string;
          notes?: string | null;
          resource_id?: string | null;
          service_id?: string;
          starts_at?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_resource_composite_fk";
            columns: ["tenant_id", "resource_id"];
            isOneToOne: false;
            referencedRelation: "staff_resources";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_tenant_service_fk";
            columns: ["tenant_id", "service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      business_availability: {
        Row: {
          created_at: string;
          enabled: boolean;
          end_time: string;
          start_time: string;
          tenant_id: string;
          updated_at: string;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          end_time?: string;
          start_time?: string;
          tenant_id: string;
          updated_at?: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          end_time?: string;
          start_time?: string;
          tenant_id?: string;
          updated_at?: string;
          weekday?: number;
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
      business_profiles: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          category: string | null;
          city: string | null;
          country_code: string | null;
          created_at: string;
          description: string | null;
          display_name: string | null;
          email: string | null;
          latitude: number | null;
          legal_name: string | null;
          locale: string;
          longitude: number | null;
          phone: string | null;
          postal_code: string | null;
          province: string | null;
          tenant_id: string;
          theme_background: string | null;
          theme_body_font_preset: string | null;
          theme_foreground: string | null;
          theme_heading_font_preset: string | null;
          theme_muted: string | null;
          theme_primary: string | null;
          theme_radius: string | null;
          timezone: string;
          updated_at: string;
          website_url: string | null;
          whatsapp: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          category?: string | null;
          city?: string | null;
          country_code?: string | null;
          created_at?: string;
          description?: string | null;
          display_name?: string | null;
          email?: string | null;
          latitude?: number | null;
          legal_name?: string | null;
          locale?: string;
          longitude?: number | null;
          phone?: string | null;
          postal_code?: string | null;
          province?: string | null;
          tenant_id: string;
          theme_background?: string | null;
          theme_body_font_preset?: string | null;
          theme_foreground?: string | null;
          theme_heading_font_preset?: string | null;
          theme_muted?: string | null;
          theme_primary?: string | null;
          theme_radius?: string | null;
          timezone?: string;
          updated_at?: string;
          website_url?: string | null;
          whatsapp?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          category?: string | null;
          city?: string | null;
          country_code?: string | null;
          created_at?: string;
          description?: string | null;
          display_name?: string | null;
          email?: string | null;
          latitude?: number | null;
          legal_name?: string | null;
          locale?: string;
          longitude?: number | null;
          phone?: string | null;
          postal_code?: string | null;
          province?: string | null;
          tenant_id?: string;
          theme_background?: string | null;
          theme_body_font_preset?: string | null;
          theme_foreground?: string | null;
          theme_heading_font_preset?: string | null;
          theme_muted?: string | null;
          theme_primary?: string | null;
          theme_radius?: string | null;
          timezone?: string;
          updated_at?: string;
          website_url?: string | null;
          whatsapp?: string | null;
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
      business_schedule_exceptions: {
        Row: {
          created_at: string;
          end_time: string | null;
          ends_at: string;
          exception_type: string;
          id: string;
          start_time: string | null;
          starts_at: string;
          tenant_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          end_time?: string | null;
          ends_at: string;
          exception_type: string;
          id?: string;
          start_time?: string | null;
          starts_at: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          end_time?: string | null;
          ends_at?: string;
          exception_type?: string;
          id?: string;
          start_time?: string | null;
          starts_at?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_schedule_exceptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          created_at: string;
          display_name: string;
          email: string | null;
          email_normalized: string | null;
          id: string;
          last_booking_at: string | null;
          notes: string | null;
          phone: string | null;
          phone_normalized: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          email?: string | null;
          email_normalized?: string | null;
          id?: string;
          last_booking_at?: string | null;
          notes?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          email?: string | null;
          email_normalized?: string | null;
          id?: string;
          last_booking_at?: string | null;
          notes?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          created_by: string | null;
          grant_reason: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          grant_reason?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          grant_reason?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      resource_availability: {
        Row: {
          created_at: string;
          enabled: boolean;
          end_time: string;
          id: string;
          resource_id: string;
          start_time: string;
          tenant_id: string;
          updated_at: string;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          end_time: string;
          id?: string;
          resource_id: string;
          start_time: string;
          tenant_id: string;
          updated_at?: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          end_time?: string;
          id?: string;
          resource_id?: string;
          start_time?: string;
          tenant_id?: string;
          updated_at?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "resource_availability_resource_fk";
            columns: ["tenant_id", "resource_id"];
            isOneToOne: false;
            referencedRelation: "staff_resources";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      resource_time_off: {
        Row: {
          created_at: string;
          ends_at: string;
          id: string;
          resource_id: string;
          starts_at: string;
          tenant_id: string;
          time_off_type: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_at: string;
          id?: string;
          resource_id: string;
          starts_at: string;
          tenant_id: string;
          time_off_type: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_at?: string;
          id?: string;
          resource_id?: string;
          starts_at?: string;
          tenant_id?: string;
          time_off_type?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_time_off_resource_fk";
            columns: ["tenant_id", "resource_id"];
            isOneToOne: false;
            referencedRelation: "staff_resources";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      services: {
        Row: {
          active: boolean;
          created_at: string;
          currency: string;
          description: string | null;
          duration_minutes: number | null;
          id: string;
          name: string;
          position: number;
          price_from: number | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          name: string;
          position?: number;
          price_from?: number | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          name?: string;
          position?: number;
          price_from?: number | null;
          tenant_id?: string;
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
      site_editorial_state: {
        Row: {
          draft_revision: string;
          sections: Json;
          services: Json;
          tenant_id: string;
          theme: Json;
          updated_at: string;
        };
        Insert: {
          draft_revision?: string;
          sections?: Json;
          services?: Json;
          tenant_id: string;
          theme?: Json;
          updated_at?: string;
        };
        Update: {
          draft_revision?: string;
          sections?: Json;
          services?: Json;
          tenant_id?: string;
          theme?: Json;
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
          created_at: string;
          enabled: boolean;
          id: string;
          position: number;
          section_type: string;
          settings: Json;
          tenant_id: string;
          updated_at: string;
          variant: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          position?: number;
          section_type: string;
          settings?: Json;
          tenant_id: string;
          updated_at?: string;
          variant?: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          position?: number;
          section_type?: string;
          settings?: Json;
          tenant_id?: string;
          updated_at?: string;
          variant?: string;
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
      staff_resource_services: {
        Row: {
          active: boolean;
          created_at: string;
          duration_override_minutes: number | null;
          resource_id: string;
          service_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          duration_override_minutes?: number | null;
          resource_id: string;
          service_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          duration_override_minutes?: number | null;
          resource_id?: string;
          service_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "srs_resource_fk";
            columns: ["tenant_id", "resource_id"];
            isOneToOne: false;
            referencedRelation: "staff_resources";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "srs_service_fk";
            columns: ["tenant_id", "service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      staff_resources: {
        Row: {
          active: boolean;
          bookable: boolean;
          color_hex: string | null;
          created_at: string;
          display_name: string;
          id: string;
          linked_membership_id: string | null;
          slug: string;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          bookable?: boolean;
          color_hex?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          linked_membership_id?: string | null;
          slug: string;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          bookable?: boolean;
          color_hex?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          linked_membership_id?: string | null;
          slug?: string;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_resources_linked_membership_tenant_fk";
            columns: ["tenant_id", "linked_membership_id"];
            isOneToOne: false;
            referencedRelation: "tenant_memberships";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "staff_resources_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          id: string;
          role: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
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
          created_at: string;
          custom_domain: string | null;
          id: string;
          name: string;
          plan_id: string;
          published: boolean;
          published_at: string | null;
          slug: string;
          status: string;
          temporary_domain: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          custom_domain?: string | null;
          id?: string;
          name: string;
          plan_id?: string;
          published?: boolean;
          published_at?: string | null;
          slug: string;
          status?: string;
          temporary_domain?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          custom_domain?: string | null;
          id?: string;
          name?: string;
          plan_id?: string;
          published?: boolean;
          published_at?: string | null;
          slug?: string;
          status?: string;
          temporary_domain?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _audit_insert_trusted: {
        Args: {
          p_action: string;
          p_entity_id: string;
          p_entity_type: string;
          p_metadata?: Json;
          p_tenant_id: string;
        };
        Returns: undefined;
      };
      admin_set_tenant_plan: {
        Args: {
          p_admin_id?: string;
          p_new_plan: string;
          p_reason?: string;
          p_target_tenant: string;
        };
        Returns: {
          code: string;
          new_plan: string;
          ok: boolean;
          old_plan: string;
        }[];
      };
      billing_apply_subscription_plan: {
        Args: {
          p_provider_event_created_at?: string;
          p_provider_event_id: string;
          p_provider_subscription_id: string;
          p_target_plan: string;
          p_tenant_id: string;
        };
        Returns: {
          code: string;
          idempotent_replay: boolean;
          new_plan: string;
          ok: boolean;
          old_plan: string;
        }[];
      };
      booking_validate_business_hours_and_overlap: {
        Args: {
          p_ends_at: string;
          p_service_id: string;
          p_starts_at: string;
          p_tenant_id: string;
        };
        Returns: boolean;
      };
      create_tenant_with_owner: {
        Args: {
          p_business_email?: string;
          p_business_name: string;
          p_category: string;
          p_city: string;
          p_locale?: string;
          p_phone?: string;
          p_province: string;
          p_timezone?: string;
        };
        Returns: Json;
      };
      customer_upsert_for_public_booking: {
        Args: {
          p_email: string;
          p_name: string;
          p_phone: string;
          p_tenant_id: string;
        };
        Returns: {
          created: boolean;
          customer_id: string;
        }[];
      };
      dearmor: { Args: { "": string }; Returns: string };
      gen_random_uuid: { Args: never; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      has_tenant_role: {
        Args: { allowed_roles: string[]; target_tenant_id: string };
        Returns: boolean;
      };
      is_platform_admin: { Args: never; Returns: boolean };
      is_tenant_member: { Args: { target_tenant_id: string }; Returns: boolean };
      pgp_armor_headers: {
        Args: { "": string };
        Returns: Record<string, unknown>[];
      };
      public_booking_create_slug: {
        Args: {
          p_customer_email?: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_notes?: string;
          p_service_id: string;
          p_slug: string;
          p_starts_at: string;
        };
        Returns: {
          booking_id: string;
          booking_status: string;
          customer_id: string;
          ends_at: string;
          starts_at: string;
        }[];
      };
      public_booking_create_v2: {
        Args: {
          p_customer_email?: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_notes?: string;
          p_resource_slug?: string;
          p_service_id: string;
          p_slug: string;
          p_starts_at: string;
        };
        Returns: {
          booking_id: string;
          booking_status: string;
          ends_at: string;
          resource_display_name: string;
          resource_slug: string;
          starts_at: string;
        }[];
      };
      public_booking_create_v3: {
        Args: {
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_notes: string;
          p_resource_slug: string;
          p_service_id: string;
          p_starts_at: string;
          p_tenant_slug: string;
        };
        Returns: {
          booking_id: string;
          end_at: string;
          resource_id: string;
          resource_slug: string;
          start_at: string;
          status: string;
        }[];
      };
      public_booking_get_confirmed_ranges: {
        Args: {
          p_from: string;
          p_service_id: string;
          p_tenant_id: string;
          p_to: string;
        };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      public_booking_resources_list: {
        Args: { p_service_id: string; p_slug: string };
        Returns: {
          resource_display_name: string;
          resource_slug: string;
          sort_order: number;
        }[];
      };
      public_resources_list_v3: {
        Args: { p_service_id: string; p_tenant_slug: string };
        Returns: {
          color_hex: string;
          display_name: string;
          resource_id: string;
          slug: string;
        }[];
      };
      public_slot_get_available_v2: {
        Args: {
          p_resource_slug?: string;
          p_service_id: string;
          p_slug: string;
          p_window_end: string;
          p_window_start: string;
        };
        Returns: {
          ends_at: string;
          resource_display_name: string;
          resource_slug: string;
          starts_at: string;
        }[];
      };
      public_slot_get_available_v3: {
        Args: {
          p_from_date: string;
          p_resource_slug?: string;
          p_service_id: string;
          p_tenant_slug: string;
          p_to_date: string;
        };
        Returns: {
          ends_at: string;
          resource_display_name: string;
          resource_id: string;
          resource_slug: string;
          starts_at: string;
        }[];
      };
      publish_site_draft: {
        Args: { p_expected_revision?: string; p_tenant_id: string };
        Returns: {
          code: string;
          message: string;
          new_published_at: string;
          ok: boolean;
          sections_applied: number;
          services_applied: number;
          theme_applied: boolean;
        }[];
      };
      scheduling_business_weekly_ranges: {
        Args: {
          p_from_date: string;
          p_tenant_id: string;
          p_to_date: string;
          p_tz: string;
        };
        Returns: {
          day_date: string;
          end_tstz: string;
          start_tstz: string;
          weekday: number;
        }[];
      };
      scheduling_constants: {
        Args: never;
        Returns: {
          booking_horizon_days: number;
          lead_time_minutes: number;
          slot_step_minutes: number;
        }[];
      };
      scheduling_local_to_utc: {
        Args: { p_local_date: string; p_local_time: string; p_tz_name: string };
        Returns: {
          dst_status: string;
          local_normal: string;
          utc_tstz: string;
        }[];
      };
      scheduling_resource_has_overlap_confirmed: {
        Args: {
          p_end: string;
          p_resource_id: string;
          p_start: string;
          p_tenant_id: string;
        };
        Returns: boolean;
      };
      scheduling_resource_weekly_ranges: {
        Args: {
          p_from_date: string;
          p_resource_id: string;
          p_tenant_id: string;
          p_to_date: string;
          p_tz: string;
        };
        Returns: {
          day_date: string;
          end_tstz: string;
          start_tstz: string;
        }[];
      };
      uuid_generate_v1: { Args: never; Returns: string };
      uuid_generate_v1mc: { Args: never; Returns: string };
      uuid_generate_v3: {
        Args: { name: string; namespace: string };
        Returns: string;
      };
      uuid_generate_v4: { Args: never; Returns: string };
      uuid_generate_v5: {
        Args: { name: string; namespace: string };
        Returns: string;
      };
      uuid_nil: { Args: never; Returns: string };
      uuid_ns_dns: { Args: never; Returns: string };
      uuid_ns_oid: { Args: never; Returns: string };
      uuid_ns_url: { Args: never; Returns: string };
      uuid_ns_x500: { Args: never; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
