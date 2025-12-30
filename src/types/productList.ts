export interface ColumnSchema {
  key: string;
  label: string;
  type: "text" | "number" | "date";
  visible: boolean;
  order: number;
  isStandard?: boolean; // code, name, price
  searchable?: boolean;
  isCustom?: boolean; // Custom calculated price columns
}

export interface DynamicProduct {
  id: string;
  listId: string;
  code?: string;
  name?: string;
  price?: number;
  quantity?: number;
  stock_threshold?: number;
  /** @deprecated Usar my_stock_products para determinar Mi Stock. */
  in_my_stock?: boolean;
  supplierId?: string;
  supplierName?: string;
  listName?: string;
  data: Record<string, any>; // All extra fields
  calculated_data?: Record<string, number>; // Calculated prices with overrides
}

export interface CustomColumnFormula {
  base_column: string;
  percentage: number;
  add_vat: boolean;
  vat_rate?: number;
}

export interface MappingConfig {
  code_keys: string[];
  name_keys: string[];
  quantity_key: string | null;
  price_primary_key: string | null;
  price_alt_keys: string[];
  extra_index_keys: string[];
  low_stock_threshold?: number;
  cart_price_column?: string | null;
  delivery_note_price_column?: string | null;
  price_modifiers?: {
    general: { percentage: number; add_vat: boolean; vat_rate?: number };
    overrides: Record<string, { percentage: number; add_vat: boolean; vat_rate?: number }>;
  };
  dollar_conversion?: {
    rate?: number;
    target_columns: string[];
  };
  custom_columns?: Record<string, CustomColumnFormula>;
}

export interface ProductList {
  id: string;
  supplierId: string;
  name: string;
  fileName: string;
  fileType: string;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  columnSchema: ColumnSchema[];
  mapping_config?: MappingConfig;
}

export interface ProcessedDocument {
  proveedor: string;
  productos: Array<{
    code?: string;
    name?: string;
    descripcion?: string;
    price?: number;
    precio?: number;
    cantidad?: number;
    [key: string]: any;
  }>;
}
