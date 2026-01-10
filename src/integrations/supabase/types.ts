export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          address: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_note_items: {
        Row: {
          created_at: string | null
          delivery_note_id: string
          id: string
          price_column_key_used: string | null
          product_code: string
          product_id: string | null
          product_list_id: string | null
          product_name: string
          quantity: number
          subtotal: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          delivery_note_id: string
          id?: string
          price_column_key_used?: string | null
          product_code: string
          product_id?: string | null
          product_list_id?: string | null
          product_name: string
          quantity: number
          subtotal?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string | null
          delivery_note_id?: string
          id?: string
          price_column_key_used?: string | null
          product_code?: string
          product_id?: string | null
          product_list_id?: string | null
          product_name?: string
          quantity?: number
          subtotal?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_note_items_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          client_id: string | null
          created_at: string | null
          customer_address: string | null
          customer_name: string
          customer_phone: string | null
          extra_fields: Json | null
          id: string
          issue_date: string | null
          notes: string | null
          paid_amount: number
          remaining_balance: number | null
          status: string | null
          total_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_name: string
          customer_phone?: string | null
          extra_fields?: Json | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          paid_amount?: number
          remaining_balance?: number | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          customer_address?: string | null
          customer_name?: string
          customer_phone?: string | null
          extra_fields?: Json | null
          id?: string
          issue_date?: string | null
          notes?: string | null
          paid_amount?: number
          remaining_balance?: number | null
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dynamic_products: {
        Row: {
          code: string | null
          created_at: string
          data: Json
          id: string
          list_id: string
          name: string | null
          price: number | null
          quantity: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          data?: Json
          id?: string
          list_id: string
          name?: string | null
          price?: number | null
          quantity?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          data?: Json
          id?: string
          list_id?: string
          name?: string | null
          price?: number | null
          quantity?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_products_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "product_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      dynamic_products_index: {
        Row: {
          calculated_data: Json | null
          code: string | null
          created_at: string | null
          id: string
          in_my_stock: boolean
          list_id: string
          name: string | null
          price: number | null
          product_id: string
          quantity: number | null
          search_vector: unknown
          stock_threshold: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          calculated_data?: Json | null
          code?: string | null
          created_at?: string | null
          id?: string
          in_my_stock?: boolean
          list_id: string
          name?: string | null
          price?: number | null
          product_id: string
          quantity?: number | null
          search_vector?: unknown
          stock_threshold?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          calculated_data?: Json | null
          code?: string | null
          created_at?: string | null
          id?: string
          in_my_stock?: boolean
          list_id?: string
          name?: string | null
          price?: number | null
          product_id?: string
          quantity?: number | null
          search_vector?: unknown
          stock_threshold?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_products_index_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "product_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dynamic_products_index_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "dynamic_products"
            referencedColumns: ["id"]
          },
        ]
      }
      import_records: {
        Row: {
          created_at: string | null
          file_name: string | null
          id: string
          import_date: string | null
          new_products: number | null
          supplier_id: string
          updated_products: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          file_name?: string | null
          id?: string
          import_date?: string | null
          new_products?: number | null
          supplier_id: string
          updated_products?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          file_name?: string | null
          id?: string
          import_date?: string | null
          new_products?: number | null
          supplier_id?: string
          updated_products?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_records_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_products: {
        Row: {
          cost_price: number | null
          created_at: string | null
          id: string
          invoice_id: string
          product_code: string
          product_name: string
          quantity: number
          sale_price: number | null
          subtotal: number
        }
        Insert: {
          cost_price?: number | null
          created_at?: string | null
          id?: string
          invoice_id: string
          product_code: string
          product_name: string
          quantity: number
          sale_price?: number | null
          subtotal: number
        }
        Update: {
          cost_price?: number | null
          created_at?: string | null
          id?: string
          invoice_id?: string
          product_code?: string
          product_name?: string
          quantity?: number
          sale_price?: number | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_products_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number | null
          client_id: string
          created_at: string | null
          due_date: string
          id: string
          issue_date: string
          status: string | null
          total_amount: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_paid?: number | null
          client_id: string
          created_at?: string | null
          due_date: string
          id?: string
          issue_date: string
          status?: string | null
          total_amount: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_paid?: number | null
          client_id?: string
          created_at?: string | null
          due_date?: string
          id?: string
          issue_date?: string
          status?: string | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      my_stock_products: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string | null
          price: number | null
          product_id: string
          quantity: number
          stock_threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          product_id: string
          quantity?: number
          stock_threshold?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          product_id?: string
          quantity?: number
          stock_threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "my_stock_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "dynamic_products"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      product_lists: {
        Row: {
          column_schema: Json
          created_at: string
          file_name: string
          file_type: string
          id: string
          mapping_config: Json | null
          name: string
          product_count: number
          supplier_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          column_schema?: Json
          created_at?: string
          file_name: string
          file_type: string
          id?: string
          mapping_config?: Json | null
          name: string
          product_count?: number
          supplier_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          column_schema?: Json
          created_at?: string
          file_name?: string
          file_type?: string
          id?: string
          mapping_config?: Json | null
          name?: string
          product_count?: number
          supplier_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_lists_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_logo_url: string | null
          company_name: string | null
          created_at: string | null
          full_name: string | null
          id: string
          profile_onboarding_done: boolean
          updated_at: string | null
          user_name: string | null
        }
        Insert: {
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          profile_onboarding_done?: boolean
          updated_at?: string | null
          user_name?: string | null
        }
        Update: {
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          profile_onboarding_done?: boolean
          updated_at?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      request_items: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          quantity: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          quantity?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          quantity?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          category: string | null
          code: string
          cost_price: number | null
          created_at: string | null
          extras: Json | null
          id: string
          min_stock_limit: number | null
          name: string
          quantity: number | null
          special_discount: boolean | null
          supplier_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          code: string
          cost_price?: number | null
          created_at?: string | null
          extras?: Json | null
          id?: string
          min_stock_limit?: number | null
          name: string
          quantity?: number | null
          special_discount?: boolean | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          code?: string
          cost_price?: number | null
          created_at?: string | null
          extras?: Json | null
          id?: string
          min_stock_limit?: number | null
          name?: string
          quantity?: number | null
          special_discount?: boolean | null
          supplier_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_dollar_conversion: {
        Args: { base_price: number; dollar_rate: number }
        Returns: number
      }
      apply_preserved_fx_conversion: {
        Args: { p_fx_meta: Json; p_mapping: Json; p_new_calc: Json }
        Returns: Json
      }
      bulk_add_to_my_stock: {
        Args: {
          p_product_ids: string[]
          p_quantity?: number
          p_stock_threshold?: number
        }
        Returns: Json
      }
      bulk_adjust_stock: { Args: { p_adjustments: Json }; Returns: Json }
      bulk_convert_usd_ars: {
        Args: {
          p_delivery_note_price_key?: string
          p_list_id: string
          p_primary_key?: string
          p_product_ids?: string[]
          p_target_keys?: string[]
        }
        Returns: Json
      }
      bulk_delete_products: { Args: { p_product_ids: string[] }; Returns: Json }
      bulk_remove_from_my_stock: {
        Args: { p_product_ids: string[] }
        Returns: Json
      }
      bulk_revert_usd_ars: {
        Args: {
          p_delivery_note_price_key?: string
          p_list_id: string
          p_primary_key?: string
          p_product_ids?: string[]
          p_target_keys?: string[]
        }
        Returns: Json
      }
      calculate_price_with_modifiers: {
        Args: {
          add_vat?: boolean
          base_value: string
          percentage?: number
          vat_rate?: number
        }
        Returns: number
      }
      parse_price_string: { Args: { input: string }; Returns: number }
      refresh_list_index: { Args: { p_list_id: string }; Returns: undefined }
      rename_jsonb_key_in_products: {
        Args: { p_list_id: string; p_new_key: string; p_old_key: string }
        Returns: number
      }
      search_products: {
        Args: {
          p_limit?: number
          p_list_id?: string
          p_offset?: number
          p_supplier_id?: string
          p_term?: string
        }
        Returns: {
          calculated_data: Json
          code: string
          list_id: string
          name: string
          price: number
          product_id: string
          quantity: number
          rank: number
        }[]
      }
      upsert_products_batch: {
        Args: { p_list_id: string; p_products: Json; p_user_id: string }
        Returns: {
          deleted_count: number
          inserted_count: number
          updated_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
