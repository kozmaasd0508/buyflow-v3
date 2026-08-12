export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_processing_runs: {
        Row: {
          confidence: number | null
          created_at: string
          estimated_cost: number | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          prompt_version: string | null
          provider: string
          purchase_id: string | null
          purpose: string
          result: Json | null
          source_email_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          estimated_cost?: number | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          prompt_version?: string | null
          provider: string
          purchase_id?: string | null
          purpose: string
          result?: Json | null
          source_email_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          estimated_cost?: number | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          prompt_version?: string | null
          provider?: string
          purchase_id?: string | null
          purpose?: string
          result?: Json | null
          source_email_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_processing_runs_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_processing_runs_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "source_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_processing_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          attachment_id: string | null
          created_at: string
          document_number: string | null
          external_url: string | null
          filename: string | null
          id: string
          issued_at: string | null
          mime_type: string | null
          product_id: string | null
          provider_message_id: string | null
          purchase_id: string
          source_type: string
          type: string
        }
        Insert: {
          attachment_id?: string | null
          created_at?: string
          document_number?: string | null
          external_url?: string | null
          filename?: string | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          product_id?: string | null
          provider_message_id?: string | null
          purchase_id: string
          source_type: string
          type: string
        }
        Update: {
          attachment_id?: string | null
          created_at?: string
          document_number?: string | null
          external_url?: string | null
          filename?: string | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          product_id?: string | null
          provider_message_id?: string | null
          purchase_id?: string
          source_type?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      email_connections: {
        Row: {
          connected_at: string
          email_address: string
          id: string
          last_history_id: string | null
          provider: string
          provider_account_id: string | null
          status: string
          updated_at: string
          user_id: string
          watch_expiration: string | null
        }
        Insert: {
          connected_at?: string
          email_address: string
          id?: string
          last_history_id?: string | null
          provider: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          watch_expiration?: string | null
        }
        Update: {
          connected_at?: string
          email_address?: string
          id?: string
          last_history_id?: string | null
          provider?: string
          provider_account_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          watch_expiration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          currency: string | null
          gtin: string | null
          id: string
          image_url: string | null
          model: string | null
          name: string
          purchase_id: string
          quantity: number
          sku: string | null
          total_price: number | null
          unit_price: number | null
          updated_at: string
          variant: string | null
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          model?: string | null
          name: string
          purchase_id: string
          quantity?: number
          sku?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string
          variant?: string | null
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          gtin?: string | null
          id?: string
          image_url?: string | null
          model?: string | null
          name?: string
          purchase_id?: string
          quantity?: number
          sku?: string | null
          total_price?: number | null
          unit_price?: number | null
          updated_at?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_sources: {
        Row: {
          confidence: number | null
          created_at: string
          purchase_id: string
          relation_type: string
          source_email_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          purchase_id: string
          relation_type?: string
          source_email_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          purchase_id?: string
          relation_type?: string
          source_email_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_sources_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_sources_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "source_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          cancelled_at: string | null
          confidence: number | null
          created_at: string
          currency: string | null
          current_state: string
          delivered_at: string | null
          discount_amount: number | null
          id: string
          merchant_domain: string | null
          merchant_name: string | null
          order_number: string | null
          ordered_at: string | null
          paid_at: string | null
          payment_method: string | null
          payment_status: string | null
          purchase_date: string | null
          shipped_at: string | null
          shipping_amount: number | null
          subtotal: number | null
          total_amount: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          confidence?: number | null
          created_at?: string
          currency?: string | null
          current_state?: string
          delivered_at?: string | null
          discount_amount?: number | null
          id?: string
          merchant_domain?: string | null
          merchant_name?: string | null
          order_number?: string | null
          ordered_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          purchase_date?: string | null
          shipped_at?: string | null
          shipping_amount?: number | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          confidence?: number | null
          created_at?: string
          currency?: string | null
          current_state?: string
          delivered_at?: string | null
          discount_amount?: number | null
          id?: string
          merchant_domain?: string | null
          merchant_name?: string | null
          order_number?: string | null
          ordered_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          purchase_date?: string | null
          shipped_at?: string | null
          shipping_amount?: number | null
          subtotal?: number | null
          total_amount?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier: string | null
          carrier_slug: string | null
          created_at: string
          delivered_at: string | null
          estimated_delivery_at: string | null
          id: string
          last_event_at: string | null
          purchase_id: string | null
          shipped_at: string | null
          status: string
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carrier?: string | null
          carrier_slug?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_delivery_at?: string | null
          id?: string
          last_event_at?: string | null
          purchase_id?: string | null
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          carrier?: string | null
          carrier_slug?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_delivery_at?: string | null
          id?: string
          last_event_at?: string | null
          purchase_id?: string | null
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      source_emails: {
        Row: {
          classification: string | null
          created_at: string
          email_connection_id: string
          from_address: string | null
          id: string
          processed_at: string | null
          processing_status: string
          provider_message_id: string
          provider_thread_id: string | null
          received_at: string | null
          source_query: string | null
          structured_result: Json | null
          subject: string | null
          user_id: string
        }
        Insert: {
          classification?: string | null
          created_at?: string
          email_connection_id: string
          from_address?: string | null
          id?: string
          processed_at?: string | null
          processing_status?: string
          provider_message_id: string
          provider_thread_id?: string | null
          received_at?: string | null
          source_query?: string | null
          structured_result?: Json | null
          subject?: string | null
          user_id: string
        }
        Update: {
          classification?: string | null
          created_at?: string
          email_connection_id?: string
          from_address?: string | null
          id?: string
          processed_at?: string | null
          processing_status?: string
          provider_message_id?: string
          provider_thread_id?: string | null
          received_at?: string | null
          source_query?: string | null
          structured_result?: Json | null
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_emails_email_connection_id_fkey"
            columns: ["email_connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_emails_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Row"]

export type TablesInsert<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Insert"]

export type TablesUpdate<
  TableName extends keyof Database["public"]["Tables"],
> = Database["public"]["Tables"][TableName]["Update"]
