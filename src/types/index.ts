export interface StockItem {
  id: string;
  code: string;
  name: string;
  quantity: number;
  category: string;
  costPrice: number;
  supplierId: string;
  specialDiscount: boolean;
  minStockLimit: number;
  extras?: Record<string, any>; // Dynamic fields from Excel imports
}

export interface RequestItem {
  id: string;
  productId: string;
  code: string;
  name: string;
  supplierId: string;
  costPrice: number;
  quantity: number;
  autoLowStock?: boolean;
  manualOverride?: boolean;
}

export interface InvoiceProduct {
  code: string;
  name: string;
  costPrice: number;
  salePrice: number;
  quantity: number;
  subtotal: number;
}

export interface Payment {
  id: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Client {
  id: string;
  name: string;
  amount: number;
  amountPaid: number;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
  phone?: string;
  email?: string;
  address?: string;
  products: InvoiceProduct[];
  payments: Payment[];
  issueDate: string;
}

export interface DeliveryClient {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  logo?: string;
}

export interface ImportRecord {
  id: string;
  supplierId: string;
  fileName: string;
  date: string;
  newProducts: number;
  updatedProducts: number;
}

export type CategoryFilter = "Todas" | "Fruits" | "Bakery" | "Dairy" | "Produce";
export type QuantityFilter = "Cualquiera" | "< 100" | "100 - 200" | "> 200" | "Bajo Stock";

export interface DeliveryNote {
  id: string;
  userId: string;
  clientId?: string | null;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  issueDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  status: 'pending' | 'paid';
  globalAdjustmentPct?: number;
  extraFields?: Record<string, any>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  items?: DeliveryNoteItem[];
}

export interface DeliveryNoteItem {
  id: string;
  deliveryNoteId: string;
  productId?: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitPriceBase?: number;
  adjustmentPct?: number;
  subtotal: number;
  createdAt: string;
  productListId?: string | null;
  priceColumnKeyUsed?: string | null;
}

export interface CreateDeliveryNoteInput {
  clientId?: string | null;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  issueDate?: string;
  paidAmount?: number;
  extraFields?: Record<string, any>;
  notes?: string;
  globalAdjustmentPct?: number;
  items: {
    productId?: string;
    productCode: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    unitPriceBase?: number;
    adjustmentPct?: number;
    productListId?: string | null;
    priceColumnKeyUsed?: string | null;
  }[];
}

export interface UpdateDeliveryNoteInput extends Partial<CreateDeliveryNoteInput> {
  id: string;
}
