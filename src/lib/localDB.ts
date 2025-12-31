import Dexie, { Table } from "dexie";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllFromTable } from "@/utils/fetchAllProducts";

// ==================== INTERFACES ====================

export interface PendingOperation {
  id?: number;
  table_name: string;
  operation_type: "INSERT" | "UPDATE" | "DELETE";
  record_id: string;
  data: any;
  timestamp: number;
  retry_count: number;
  error?: string;
}

interface SupplierDB {
  id: string;
  user_id: string;
  name: string;
  logo_url?: string;
  created_at: string;
  updated_at: string;
}

interface ClientDB {
  id: string;
  user_id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductListDB {
  id: string;
  user_id: string;
  supplier_id: string;
  name: string;
  file_name: string;
  file_type: string;
  product_count: number;
  column_schema: any;
  mapping_config?: any;
  created_at: string;
  updated_at: string;
}

interface DynamicProductIndexDB {
  id: string;
  user_id: string;
  list_id: string;
  product_id: string;
  code?: string;
  name?: string;
  price?: number;
  quantity?: number;
  stock_threshold?: number;
  in_my_stock: boolean;
  calculated_data?: any;
  created_at: string;
  updated_at: string;
}

interface DynamicProductDB {
  id: string;
  user_id: string;
  list_id: string;
  code?: string;
  name?: string;
  price?: number;
  quantity?: number;
  stock_threshold?: number;
  data: any;
  created_at: string;
  updated_at: string;
}

interface MyStockProductDB {
  id: string;
  product_id: string;
  user_id: string;
  quantity: number;
  stock_threshold: number;
  code?: string;
  name?: string;
  price?: number;
  created_at: string;
  updated_at: string;
}

interface DeliveryNoteDB {
  id: string;
  user_id: string;
  client_id?: string | null;
  customer_name: string;
  customer_address?: string;
  customer_phone?: string;
  issue_date: string;
  total_amount: number;
  paid_amount: number;
  remaining_balance: number;
  status: string;
  extra_fields?: any;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface DeliveryNoteItemDB {
  id: string;
  delivery_note_id: string;
  product_id?: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
}

interface RequestItemDB {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
}

interface StockItemDB {
  id: string;
  user_id: string;
  code: string;
  name: string;
  quantity: number;
  category?: string;
  cost_price?: number;
  supplier_id?: string;
  special_discount: boolean;
  min_stock_limit: number;
  extras?: any;
  created_at: string;
  updated_at: string;
}

interface AuthTokenDB {
  userId: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  updatedAt: string;
}

interface SettingsDB {
  key: string;
  value: any;
  updated_at: string;
  created_at: string;
}

interface IdMappingDB {
  temp_id: string;
  real_id: string;
  table_name: string;
  created_at: string;
}

interface StockCompensationDB {
  id?: number;
  operation_id: number;
  product_id: string;
  quantity_delta: number;
  timestamp: number;
}

// ==================== DEXIE DATABASE ====================

class LocalDatabase extends Dexie {
  suppliers!: Table<SupplierDB, string>;
  clients!: Table<ClientDB, string>;
  product_lists!: Table<ProductListDB, string>;
  dynamic_products_index!: Table<DynamicProductIndexDB, string>;
  dynamic_products!: Table<DynamicProductDB, string>;
  my_stock_products!: Table<MyStockProductDB, string>;
  delivery_notes!: Table<DeliveryNoteDB, string>;
  delivery_note_items!: Table<DeliveryNoteItemDB, string>;
  request_items!: Table<RequestItemDB, string>;
  stock_items!: Table<StockItemDB, string>;
  pending_operations!: Table<PendingOperation, number>;
  tokens!: Table<AuthTokenDB, string>;
  settings!: Table<SettingsDB, string>;
  id_mappings!: Table<IdMappingDB, string>;
  stock_compensations!: Table<StockCompensationDB, number>;

  constructor() {
    super("ProveedoresLocalDB");

    this.version(1).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name",
      dynamic_products: "id, user_id, list_id, code, name",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id",
      tokens: "userId, updatedAt",
    });

    // VersiÃ³n 5: Agregar tablas para mapeo de IDs y compensaciÃ³n de stock
    this.version(5).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name",
      dynamic_products: "id, user_id, list_id, code, name",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });

    // VersiÃ³n 6: Agregar in_my_stock al Ã­ndice de productos
    this.version(6).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name, in_my_stock",
      dynamic_products: "id, user_id, list_id, code, name",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id, product_id",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });

    // VersiÃ³n 7: Agregar stock_threshold al Ã­ndice de productos
    this.version(7).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name, in_my_stock, stock_threshold",
      dynamic_products: "id, user_id, list_id, code, name, stock_threshold",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id, product_id",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });

    // VersiÃ³n 8: Agregar Ã­ndice compuesto para fusiÃ³n de operaciones pendientes
    this.version(8).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name, in_my_stock, stock_threshold",
      dynamic_products: "id, user_id, list_id, code, name, stock_threshold",
      my_stock_products: "id, user_id, product_id, quantity, stock_threshold, code, name, price",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id, product_id, operation_type, [table_name+record_id+operation_type]",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });

    // VersiÃ“n 9: Agregar tabla my_stock_products
    this.version(9).stores({
      suppliers: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name, in_my_stock, stock_threshold",
      dynamic_products: "id, user_id, list_id, code, name, stock_threshold",
      my_stock_products: "id, user_id, product_id, quantity, stock_threshold, code, name, price",
      delivery_notes: "id, user_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id, product_id, operation_type, [table_name+record_id+operation_type]",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });

    // Version 10: agregar clientes y soporte de client_id en remitos
    this.version(10).stores({
      suppliers: "id, user_id, name",
      clients: "id, user_id, name",
      product_lists: "id, user_id, supplier_id, name",
      dynamic_products_index: "id, user_id, list_id, product_id, code, name, in_my_stock, stock_threshold",
      dynamic_products: "id, user_id, list_id, code, name, stock_threshold",
      my_stock_products: "id, user_id, product_id, quantity, stock_threshold, code, name, price",
      delivery_notes: "id, user_id, client_id, customer_name, status, issue_date",
      delivery_note_items: "id, delivery_note_id, product_id",
      settings: "key, updated_at",
      request_items: "id, user_id, product_id",
      stock_items: "id, user_id, code, name, category, supplier_id",
      pending_operations: "++id, table_name, timestamp, record_id, product_id, operation_type, [table_name+record_id+operation_type]",
      tokens: "userId, updatedAt",
      id_mappings: "temp_id, real_id, table_name",
      stock_compensations: "++id, operation_id, product_id",
    });
  }
}

export const localDB = new LocalDatabase();

// ==================== CONSTANTES ====================

const SYNC_ORDER = [
  "suppliers",
  "clients",
  "product_lists",
  "dynamic_products",
  "dynamic_products_index",
  "my_stock_products",
  "stock_items",
  "delivery_notes",
  "delivery_note_items",
  "request_items",
];

// ==================== UTILIDADES ====================

// Variable de control para sincronizaciÃ³n (mutex)
let isSyncInProgress = false;

export function isOnline(): boolean {
  return navigator.onLine;
}

function generateTempId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function isTempId(id: string): boolean {
  return id.startsWith("offline-");
}

// ==================== INICIALIZACIÃ“N ====================

export async function initDB(): Promise<void> {
  try {
    await localDB.open();
    console.log("âœ… IndexedDB inicializada correctamente");
  } catch (error) {
    console.error("âŒ Error al inicializar IndexedDB:", error);
    throw error;
  }
}

// ==================== SINCRONIZACIÃ“N DESDE SUPABASE ====================

export async function syncMyStockFromSupabase(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Usuario no autenticado");
  }

  const { data, error } = await supabase
    .from("my_stock_products")
    .select("id, product_id, user_id, quantity, stock_threshold, code, name, price, created_at, updated_at")
    .eq("user_id", user.id);

  if (error) throw error;

  await localDB.transaction("rw", localDB.my_stock_products, async () => {
    await localDB.my_stock_products.clear();
    if (data && data.length > 0) {
      await localDB.my_stock_products.bulkPut(data as MyStockProductDB[]);
    }
  });
}

export async function syncFromSupabase(): Promise<void> {
  if (!isOnline()) {
    console.warn("âš ï¸ No hay conexiÃ³n. No se puede sincronizar desde Supabase");
    return;
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Usuario no autenticado");
    }

    console.log("ðŸ”„ Iniciando sincronizaciÃ³n desde Supabase...");

    // Sincronizar suppliers
    const { data: suppliers, error: suppliersError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("user_id", user.id);
    if (suppliersError) throw suppliersError;

    if (suppliers !== undefined) {
      await localDB.suppliers.clear(); // limpia proveedores viejos
      if (suppliers.length > 0) {
        await localDB.suppliers.bulkAdd(suppliers as SupplierDB[]);
        console.log(`âœ… ${suppliers.length} proveedores sincronizados`);
      } else {
        console.log("âœ… 0 proveedores sincronizados (tabla vacÃ­a)");
      }
    }

    // Sincronizar clients
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", user.id);
    if (clientsError) throw clientsError;

    if (clients !== undefined) {
      await localDB.clients.clear(); // limpia clientes viejos
      if (clients.length > 0) {
        await localDB.clients.bulkAdd(clients as ClientDB[]);
        console.log(`ƒo. ${clients.length} clientes sincronizados`);
      } else {
        console.log("ƒo. 0 clientes sincronizados (tabla vacia)");
      }
    }

    // Sincronizar product_lists
    const { data: productLists, error: listsError } = await supabase
      .from("product_lists")
      .select("*")
      .eq("user_id", user.id);
    if (listsError) throw listsError;

    if (productLists !== undefined) {
      await localDB.product_lists.clear(); // limpia listas viejas
      if (productLists.length > 0) {
        await localDB.product_lists.bulkAdd(productLists as ProductListDB[]);
        console.log(`âœ… ${productLists.length} listas de productos sincronizadas`);
      } else {
        console.log("âœ… 0 listas de productos sincronizadas (tabla vacÃ­a)");
      }
    }

    // Sincronizar dynamic_products_index (CON PAGINACIÃ“N)
    let productsIndex: any[] = [];
    try {
      productsIndex = await fetchAllFromTable("dynamic_products_index", undefined, user.id);

      await localDB.dynamic_products_index.clear(); // limpia index viejo
      if (productsIndex.length > 0) {
        await localDB.dynamic_products_index.bulkAdd(productsIndex as DynamicProductIndexDB[]);
        console.log(`âœ… ${productsIndex.length} productos (index) sincronizados`);
      } else {
        console.log("âœ… 0 productos (index) sincronizados (tabla vacÃ­a)");
      }
    } catch (indexError) {
      console.error("Error sincronizando products_index:", indexError);
      throw indexError;
    }

    // Sincronizar dynamic_products (CON PAGINACIÃ“N)
    let products: any[] = [];
    try {
      products = await fetchAllFromTable("dynamic_products", undefined, user.id);

      await localDB.dynamic_products.clear(); // limpia productos viejos
      if (products.length > 0) {
        await localDB.dynamic_products.bulkAdd(products as DynamicProductDB[]);
        console.log(`âœ… ${products.length} productos completos sincronizados`);
      } else {
        console.log("âœ… 0 productos completos sincronizados (tabla vacÃ­a)");
      }
    } catch (productsError) {
      console.error("Error sincronizando dynamic_products:", productsError);
      throw productsError;
    }

    await syncMyStockFromSupabase();

    // Sincronizar delivery_notes
    const { data: deliveryNotes, error: notesError } = await supabase
      .from("delivery_notes")
      .select("*")
      .eq("user_id", user.id);
    if (notesError) throw notesError;

    if (deliveryNotes !== undefined) {
      await localDB.delivery_notes.clear(); // limpia remitos viejos
      if (deliveryNotes.length > 0) {
        await localDB.delivery_notes.bulkAdd(deliveryNotes as DeliveryNoteDB[]);
        console.log(`âœ… ${deliveryNotes.length} remitos sincronizados`);
      } else {
        console.log("âœ… 0 remitos sincronizados (tabla vacÃ­a)");
      }
    }

    // Sincronizar delivery_note_items
    const { data: noteItems, error: itemsError } = await supabase.from("delivery_note_items").select("*");
    if (itemsError) throw itemsError;

    if (noteItems !== undefined) {
      await localDB.delivery_note_items.clear(); // limpia items viejos
      if (noteItems.length > 0) {
        await localDB.delivery_note_items.bulkAdd(noteItems as DeliveryNoteItemDB[]);
        console.log(`âœ… ${noteItems.length} items de remitos sincronizados`);
      } else {
        console.log("âœ… 0 items de remitos sincronizados (tabla vacÃ­a)");
      }
    }

    // Sincronizar request_items
    const { data: requestItems, error: requestError } = await supabase
      .from("request_items")
      .select("*")
      .eq("user_id", user.id);
    if (requestError) throw requestError;

    if (requestItems !== undefined) {
      await localDB.request_items.clear(); // limpia items del carrito viejos
      if (requestItems.length > 0) {
        await localDB.request_items.bulkAdd(requestItems as RequestItemDB[]);
        console.log(`âœ… ${requestItems.length} items del carrito sincronizados`);
      } else {
        console.log("âœ… 0 items del carrito sincronizados (tabla vacÃ­a)");
      }
    }

    // Sincronizar stock_items
    const { data: stockItems, error: stockError } = await supabase
      .from("stock_items")
      .select("*")
      .eq("user_id", user.id);
    if (stockError) throw stockError;

    if (stockItems !== undefined) {
      await localDB.stock_items.clear(); // limpia stock viejo
      if (stockItems.length > 0) {
        await localDB.stock_items.bulkAdd(stockItems as StockItemDB[]);
        console.log(`âœ… ${stockItems.length} productos de stock sincronizados`);
      } else {
        console.log("âœ… 0 productos de stock sincronizados (tabla vacÃ­a)");
      }
    }

    // Sincronizar settings (dÃ³lar oficial, etc.)
    console.log("ðŸ“¥ Sincronizando settings...");
    const { data: settingsData, error: settingsError } = await supabase.from("settings").select("*");
    if (settingsError) throw settingsError;

    if (settingsData !== undefined) {
      await localDB.settings.clear(); // limpia settings viejos
      if (settingsData.length > 0) {
        await localDB.settings.bulkAdd(
          settingsData.map((s: any) => ({
            key: s.key,
            value: s.value,
            updated_at: s.updated_at,
            created_at: s.created_at,
          })),
        );
        console.log(`âœ… ${settingsData.length} setting(s) sincronizado(s)`);
      } else {
        console.log("âœ… 0 settings sincronizados (tabla vacÃ­a)");
      }
    }

    console.log("âœ… SincronizaciÃ³n completa desde Supabase");
    // const totalItems = (suppliers?.length || 0) + (productLists?.length || 0) + (productsIndex?.length || 0);
    // if (totalItems > 0) {
    //   toast.success(`${totalItems} elementos sincronizados para uso offline`);
    // }
  } catch (error) {
    console.error("âŒ Error al sincronizar desde Supabase:", error);
    toast.error("Error al sincronizar datos");
    throw error;
  }
}

// ==================== COLA DE OPERACIONES PENDIENTES ====================

/**
 * Sanitiza datos segÃºn la tabla destino
 */
function sanitizeDataForSync(tableName: string, operationType: string, data: any): any {
  const cleanData = { ...data };

  // Siempre eliminar id para INSERTs (Supabase genera el UUID)
  if (operationType === "INSERT") {
    delete cleanData.id;
  }

  delete cleanData.items;

  if (tableName === "delivery_notes") {
    // Eliminar remaining_balance - es columna generada en Supabase
    delete cleanData.remaining_balance;

    if (cleanData.issue_date) {
      cleanData.issue_date = new Date(cleanData.issue_date).toISOString();
    }

    if (cleanData.total_amount !== undefined) {
      cleanData.total_amount = Number(cleanData.total_amount);
    }
    if (cleanData.paid_amount !== undefined) {
      cleanData.paid_amount = Number(cleanData.paid_amount);
    }
  }

  if (tableName === "delivery_note_items") {
    // Para items, reemplazar delivery_note_id temporal por el real si existe
    if (cleanData.delivery_note_id && isTempId(cleanData.delivery_note_id)) {
      // Se resolverÃ¡ en executeOperation
    }

    if (cleanData.quantity !== undefined) {
      cleanData.quantity = Number(cleanData.quantity);
    }
    if (cleanData.unit_price !== undefined) {
      cleanData.unit_price = Number(cleanData.unit_price);
    }
    // subtotal es columna generada en Supabase
    delete cleanData.subtotal;
  }

  return cleanData;
}

export async function queueOperation(
  tableName: string,
  operationType: "INSERT" | "UPDATE" | "DELETE",
  recordId: string,
  data: any,
): Promise<void> {
  const sanitizedData = sanitizeDataForSync(tableName, operationType, data);

  const operation: PendingOperation = {
    table_name: tableName,
    operation_type: operationType,
    record_id: recordId,
    data: sanitizedData,
    timestamp: Date.now(),
    retry_count: 0,
  };

  await localDB.pending_operations.add(operation);
  console.log(`ðŸ“ OperaciÃ³n encolada: ${operationType} en ${tableName}`);
}

/**
 * VersiÃ³n de queueOperation que retorna el ID de la operaciÃ³n
 */
async function queueOperationWithId(
  tableName: string,
  operationType: "INSERT" | "UPDATE" | "DELETE",
  recordId: string,
  data: any,
): Promise<number> {
  const sanitizedData = sanitizeDataForSync(tableName, operationType, data);

  const operation: PendingOperation = {
    table_name: tableName,
    operation_type: operationType,
    record_id: recordId,
    data: sanitizedData,
    timestamp: Date.now(),
    retry_count: 0,
  };

  const id = await localDB.pending_operations.add(operation);
  console.log(`ðŸ“ OperaciÃ³n encolada: ${operationType} ${tableName} ${recordId} (id=${id})`);
  return id as number;
}

/**
 * Resuelve IDs temporales a IDs reales de Supabase
 */
async function resolveRecordId(tableName: string, recordId: string): Promise<string> {
  if (!isTempId(recordId)) return recordId;

  const mapping = await localDB.id_mappings.get(recordId);
  return mapping?.real_id || recordId;
}

/**
 * Deduplica operaciones pendientes antes de sincronizar
 * Mantiene solo la operaciÃ³n mÃ¡s reciente para cada combinaciÃ³n de table_name + record_id + operation_type
 */
async function deduplicatePendingOperations(operations: PendingOperation[]): Promise<void> {
  const operationsByKey = new Map<string, PendingOperation[]>();

  for (const op of operations) {
    const key = `${op.table_name}:${op.record_id}:${op.operation_type}`;
    if (!operationsByKey.has(key)) {
      operationsByKey.set(key, []);
    }
    operationsByKey.get(key)!.push(op);
  }

  let deletedCount = 0;

  for (const [key, ops] of operationsByKey.entries()) {
    if (ops.length > 1) {
      console.log(`âš ï¸ Detectadas ${ops.length} operaciones duplicadas para ${key}`);
      // Ordenar por timestamp y mantener solo la Ãºltima
      ops.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = ops.slice(0, -1); // Eliminar todas excepto la Ãºltima

      for (const dupOp of toDelete) {
        await localDB.pending_operations.delete(dupOp.id!);
        deletedCount++;
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`ðŸ—‘ï¸ Eliminadas ${deletedCount} operaciones duplicadas`);
  }
}

/**
 * Verifica si un remito ya existe en Supabase basÃ¡ndose en datos Ãºnicos
 * Retorna el ID real si existe, null si no
 */
async function checkDeliveryNoteExistsInSupabase(data: any): Promise<string | null> {
  if (!data.user_id || !data.created_at) return null;

  try {
    const { data: existingNote, error } = await supabase
      .from("delivery_notes")
      .select("id")
      .eq("user_id", data.user_id)
      .eq("created_at", data.created_at)
      .maybeSingle();

    if (error) {
      console.warn("âš ï¸ Error verificando duplicado en Supabase:", error);
      return null;
    }

    return existingNote?.id || null;
  } catch (e) {
    console.warn("âš ï¸ Error verificando duplicado:", e);
    return null;
  }
}

/**
 * Actualiza referencias locales despuÃ©s de crear registro en Supabase
 */
async function updateLocalRecordId(tableName: string, tempId: string, realId: string): Promise<void> {
  console.log(`ðŸ”„ Mapeando ID: ${tempId} -> ${realId}`);

  await localDB.id_mappings.put({
    temp_id: tempId,
    real_id: realId,
    table_name: tableName,
    created_at: new Date().toISOString(),
  });

  if (tableName === "delivery_notes") {
    const note = await localDB.delivery_notes.get(tempId);
    if (note) {
      // Eliminar el registro con ID temporal
      await localDB.delivery_notes.delete(tempId);
      // Insertar con el ID real
      await localDB.delivery_notes.put({ ...note, id: realId });

      // Actualizar delivery_note_id en los items asociados
      const items = await localDB.delivery_note_items.where("delivery_note_id").equals(tempId).toArray();

      for (const item of items) {
        // Eliminar item con referencia temporal y reinsertarlo con referencia real
        await localDB.delivery_note_items.delete(item.id);
        await localDB.delivery_note_items.put({
          ...item,
          delivery_note_id: realId,
        });
      }
    }
  } else if (tableName === "delivery_note_items") {
    // Para items, actualizar el ID del item en IndexedDB
    const item = await localDB.delivery_note_items.get(tempId);
    if (item) {
      // Eliminar el registro con ID temporal
      await localDB.delivery_note_items.delete(tempId);
      // Insertar con el ID real
      await localDB.delivery_note_items.put({ ...item, id: realId });
    }
  } else if (tableName === "clients") {
    const client = await localDB.clients.get(tempId);
    if (client) {
      await localDB.clients.delete(tempId);
      await localDB.clients.put({ ...client, id: realId });

      const affectedNotes = await localDB.delivery_notes.where("client_id").equals(tempId).toArray();
      for (const note of affectedNotes) {
        await localDB.delivery_notes.update(note.id, { client_id: realId });
      }
    }
  }
}

export async function syncPendingOperations(): Promise<void> {
  if (!isOnline()) {
    console.warn("âš ï¸ No hay conexiÃ³n. No se pueden sincronizar operaciones pendientes");
    return;
  }

  // Prevenir ejecuciÃ³n simultÃ¡nea (mutex)
  if (isSyncInProgress) {
    console.log("â³ SincronizaciÃ³n ya en progreso, saltando...");
    return;
  }

  isSyncInProgress = true;

  try {
    const operations = await localDB.pending_operations.toArray();

    if (operations.length === 0) {
      console.log("âœ… No hay operaciones pendientes");
      return;
    }

    console.log(`ðŸ”„ Sincronizando ${operations.length} operaciones pendientes...`);

    // Deduplicar operaciones antes de procesar
    await deduplicatePendingOperations(operations);

    // Re-obtener despuÃ©s de deduplicaciÃ³n
    const dedupedOps = await localDB.pending_operations.toArray();

    // Ordenar por timestamp para respetar orden de creaciÃ³n
    const sortedOps = dedupedOps.sort((a, b) => a.timestamp - b.timestamp);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const op of sortedOps) {
      try {
        const result = await executeOperation(op);

        if (result === "skipped") {
          // La operaciÃ³n fue saltada porque depende de un ID temporal no resuelto aÃºn
          skippedCount++;
          console.log(`â­ï¸ OperaciÃ³n ${op.id} saltada (depende de ID temporal)`);
          continue;
        }

        await localDB.pending_operations.delete(op.id!);
        await clearStockCompensation(op.id!);
        successCount++;
      } catch (error: any) {
        errorCount++;
        console.error(`âŒ Error al sincronizar operaciÃ³n ${op.id}:`, error);

        const updatedOp = await localDB.pending_operations.get(op.id!);
        if (updatedOp) {
          const newRetryCount = op.retry_count + 1;

          await localDB.pending_operations.put({
            ...updatedOp,
            retry_count: newRetryCount,
            error: error.message,
          });

          if (newRetryCount >= 3) {
            console.error(`âŒ OperaciÃ³n ${op.id} descartada despuÃ©s de 3 intentos`);
            await rollbackStockCompensation(op.id!);

            // ðŸ†• Rollback especial para DELETE de delivery_notes con snapshot
            if (op.table_name === "delivery_notes" && op.operation_type === "DELETE" && op.data?._snapshot) {
              await rollbackDeliveryNoteDelete(op.data._snapshot);
            }

            // ðŸ†• Rollback especial para UPDATE de delivery_notes con snapshot
            if (op.table_name === "delivery_notes" && op.operation_type === "UPDATE" && op.data?._snapshot) {
              await rollbackDeliveryNoteUpdate(op.data._snapshot);
            }

            await localDB.pending_operations.delete(op.id!);
            // Solo mostrar toast de error crÃ­tico
            toast.error(`OperaciÃ³n fallida: ${op.table_name}`);
          }
        }
      }
    }

    console.log(
      `âœ… SincronizaciÃ³n completada: ${successCount} exitosas, ${errorCount} fallidas, ${skippedCount} saltadas`,
    );

    // Si hubo operaciones saltadas, hacer otra pasada despuÃ©s de un momento
    if (skippedCount > 0 && successCount > 0) {
      console.log(`ðŸ”„ Re-ejecutando sincronizaciÃ³n para operaciones saltadas...`);
      setTimeout(() => syncPendingOperations(), 500);
      return;
    }

    // Mostrar solo errores para evitar ruido en la UI
    if (errorCount > 0 && successCount === 0) {
      toast.error(`${errorCount} operaciones fallaron`);
    }
  } finally {
    isSyncInProgress = false;
  }
}

async function executeOperation(op: PendingOperation): Promise<"success" | "skipped"> {
  console.log(`ðŸ”„ Ejecutando: ${op.operation_type} ${op.table_name} ${op.record_id}`);

  // Resolver ID temporal a ID real si existe mapeo
  const realId = await resolveRecordId(op.table_name, op.record_id);

  if (op.operation_type === "INSERT") {
    if (!isTempId(op.record_id) && op.record_id === realId) {
      console.log(`âœ… Skip INSERT: registro ya existe (${realId})`);
      return "success";
    }
    if (!isTempId(realId) && op.record_id !== realId) {
      console.log(`âœ… Skip INSERT: ID temporal ya mapeado (${realId})`);
      return "success";
    }

    // ðŸ†• Para delivery_notes, verificar si ya existe en Supabase antes de insertar
    if (op.table_name === "delivery_notes") {
      const existingId = await checkDeliveryNoteExistsInSupabase(op.data);
      if (existingId) {
        console.log(`âœ… Skip INSERT: remito ya existe en Supabase (${existingId})`);
        await updateLocalRecordId(op.table_name, op.record_id, existingId);
        return "success";
      }
    }

    // Para INSERTs, preparar datos sin el ID temporal
    let insertData = { ...op.data };
    delete insertData.id; // Supabase genera el UUID
    delete insertData._snapshot; // Eliminar snapshot interno

    if (op.table_name === "delivery_notes" && insertData.client_id) {
      const realClientId = await resolveRecordId("clients", insertData.client_id);
      if (isTempId(realClientId)) {
        console.log(`Remito depende de cliente no sincronizado: ${insertData.client_id}`);
        return "skipped";
      }
      insertData.client_id = realClientId;
    }

    // Para delivery_note_items, resolver delivery_note_id temporal
    if (op.table_name === "delivery_note_items" && insertData.delivery_note_id) {
      const realNoteId = await resolveRecordId("delivery_notes", insertData.delivery_note_id);

      if (isTempId(realNoteId)) {
        // El remito padre aÃºn no se ha sincronizado, saltar esta operaciÃ³n
        console.log(`â­ï¸ Item depende de remito no sincronizado: ${insertData.delivery_note_id}`);
        return "skipped";
      }

      insertData.delivery_note_id = realNoteId;
    }

    const { data, error } = await supabase
      .from(op.table_name as any)
      .insert([insertData])
      .select()
      .single();

    if (error) throw error;

    // Mapear ID temporal al ID real generado por Supabase
    if (data && isTempId(op.record_id)) {
      await updateLocalRecordId(op.table_name, op.record_id, (data as any).id);
    }
  } else if (op.operation_type === "UPDATE") {
    if (isTempId(realId)) {
      // El registro aÃºn no existe en Supabase, saltar hasta que se sincronice el INSERT
      console.log(`â­ï¸ UPDATE depende de INSERT pendiente: ${realId}`);
      return "skipped";
    }

    // ðŸ†• MANEJO ESPECIAL: delivery_notes con snapshot de items
    if (op.table_name === "delivery_notes" && op.data?._snapshot?.newItems) {
      await executeDeliveryNoteUpdateWithItems(realId, op.data);
      return "success";
    }

    // Preparar datos de actualizaciÃ³n (remover campos internos)
    let updateData = { ...op.data };
    delete updateData._snapshot;

    if (op.table_name === "delivery_notes" && updateData.client_id) {
      const realClientId = await resolveRecordId("clients", updateData.client_id);
      if (isTempId(realClientId)) {
        console.log(`UPDATE depende de cliente no sincronizado: ${updateData.client_id}`);
        return "skipped";
      }
      updateData.client_id = realClientId;
    }

    // Para delivery_note_items, resolver delivery_note_id temporal
    if (op.table_name === "delivery_note_items" && updateData.delivery_note_id) {
      const realNoteId = await resolveRecordId("delivery_notes", updateData.delivery_note_id);
      if (!isTempId(realNoteId)) {
        updateData.delivery_note_id = realNoteId;
      }
    }

    const { error } = await supabase
      .from(op.table_name as any)
      .update(updateData)
      .eq("id", realId);

    if (error) throw error;
  } else if (op.operation_type === "DELETE") {
    if (isTempId(realId)) {
      // El registro nunca existiÃ³ en Supabase, simplemente marcar como completado
      console.log(`âœ… Skip DELETE de registro que nunca existiÃ³ en servidor: ${realId}`);
      return "success";
    }

    const { error } = await supabase
      .from(op.table_name as any)
      .delete()
      .eq("id", realId);

    if (error) throw error;
  }

  console.log(`âœ… OperaciÃ³n completada: ${op.operation_type} ${op.table_name}`);
  try {
    await syncDeliveryNoteAfterOperation(op, realId);
  } catch (error) {
    console.warn("âš ï¸ Error al sincronizar remito post-operaciÃ³n:", error);
  }
  return "success";
}

async function syncDeliveryNoteAfterOperation(op: PendingOperation, realId: string): Promise<void> {
  if (op.table_name === "delivery_notes") {
    await syncDeliveryNoteById(realId);
    return;
  }

  if (op.table_name === "delivery_note_items") {
    const noteId =
      typeof op.data?.delivery_note_id === "string"
        ? await resolveRecordId("delivery_notes", op.data.delivery_note_id)
        : null;
    if (noteId && !isTempId(noteId)) {
      await syncDeliveryNoteById(noteId);
    }
  }
}

/**
 * Ejecuta actualizaciÃ³n atÃ³mica de delivery_note con items
 * Esto sincroniza la nota y reemplaza todos sus items en una transacciÃ³n lÃ³gica
 */
async function executeDeliveryNoteUpdateWithItems(noteId: string, data: any): Promise<void> {
  console.log(`ðŸ”„ SincronizaciÃ³n atÃ³mica de remito ${noteId} con items...`);

  const snapshot = data._snapshot;
  const newItems = snapshot?.newItems;

  // PASO 1: Preparar datos de la nota (sin campos internos)
  const noteUpdateData: any = { ...data };
  delete noteUpdateData._snapshot;
  delete noteUpdateData.remaining_balance; // Columna generada

  // PASO 2: Actualizar la nota principal
  const { error: noteError } = await supabase.from("delivery_notes").update(noteUpdateData).eq("id", noteId);

  if (noteError) {
    console.error(`âŒ Error actualizando nota ${noteId}:`, noteError);
    throw noteError;
  }

  // PASO 3: Si hay nuevos items, reemplazar los existentes
  if (newItems && newItems.length > 0) {
    console.log(`  ðŸ“¦ Reemplazando ${newItems.length} items...`);

    // Eliminar items existentes
    const { error: deleteError } = await supabase.from("delivery_note_items").delete().eq("delivery_note_id", noteId);

    if (deleteError) {
      console.error(`âŒ Error eliminando items antiguos:`, deleteError);
      throw deleteError;
    }

    // Insertar nuevos items (sin ID temporal)
    const itemsToInsert = newItems.map((item: any) => ({
      delivery_note_id: noteId,
      product_id: item.product_id,
      product_code: item.product_code,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }));

    const { error: insertError } = await supabase.from("delivery_note_items").insert(itemsToInsert);

    if (insertError) {
      console.error(`âŒ Error insertando items nuevos:`, insertError);
      throw insertError;
    }

    console.log(`  âœ… ${itemsToInsert.length} items sincronizados`);
  }

  // PASO 4: Sincronizar stock en Supabase usando bulk_adjust_stock
  if (snapshot?.stockAdjustments && snapshot.stockAdjustments.length > 0) {
    const adjustments = snapshot.stockAdjustments
      .filter((adj: any) => adj.delta !== 0)
      .map((adj: any) => ({
        product_id: adj.id,
        delta: adj.delta,
        op_id: `sync-${noteId}-${adj.id}`,
      }));

    if (adjustments.length > 0) {
      console.log(`  ðŸ“Š Sincronizando ${adjustments.length} ajustes de stock...`);

      const { error: stockError } = await supabase.rpc("bulk_adjust_stock", {
        p_adjustments: adjustments,
      });

      if (stockError) {
        console.error(`âŒ Error sincronizando stock:`, stockError);
        // No lanzar error aquÃ­ para no fallar toda la operaciÃ³n
        // El stock local ya estÃ¡ correcto
      } else {
        console.log(`  âœ… Stock sincronizado`);
      }
    }
  }

  console.log(`âœ… Remito ${noteId} sincronizado atÃ³micamente`);
}

/**
 * Refresca el Ã­ndice de productos de una lista especÃ­fica
 */
async function refreshProductListIndex(listId: string): Promise<void> {
  console.log(`ðŸ”„ Refrescando Ã­ndice para lista: ${listId}`);

  const { error } = await supabase.rpc("refresh_list_index", { p_list_id: listId });

  if (error) {
    console.error("âŒ Error al refrescar Ã­ndice:", error);
    throw error;
  }

  console.log(`âœ… Ãndice refrescado para lista: ${listId}`);
}

/**
 * Refresca Ã­ndices de productos afectados por un remito
 */
async function refreshAffectedProductsIndex(deliveryNoteId: string): Promise<void> {
  console.log(`ðŸ”„ Refrescando Ã­ndices de productos del remito: ${deliveryNoteId}`);

  // Obtener items del remito
  const { data: items, error } = await supabase
    .from("delivery_note_items")
    .select("product_id, dynamic_products!inner(list_id)")
    .eq("delivery_note_id", deliveryNoteId);

  if (error) {
    console.error("âŒ Error al obtener items del remito:", error);
    return;
  }

  // Obtener listas Ãºnicas afectadas
  const affectedLists = new Set<string>();
  items?.forEach((item: any) => {
    if (item.dynamic_products?.list_id) {
      affectedLists.add(item.dynamic_products.list_id);
    }
  });

  // Refrescar Ã­ndice de cada lista
  for (const listId of affectedLists) {
    await refreshProductListIndex(listId);
  }

  console.log(`âœ… Ãndices refrescados para ${affectedLists.size} listas`);
}

/**
 * Sincroniza un remito especÃ­fico desde Supabase a IndexedDB
 */
export async function syncDeliveryNoteById(noteId: string): Promise<void> {
  console.log(`ðŸ”„ Sincronizando remito ${noteId} a IndexedDB...`);

  const { data: noteData, error: noteError } = await supabase
    .from("delivery_notes")
    .select("*")
    .eq("id", noteId)
    .maybeSingle();

  if (noteError) throw noteError;

  if (!noteData) {
    // Si no existe en Supabase, eliminar de IndexedDB
    await localDB.delivery_notes.delete(noteId);
    await localDB.delivery_note_items.where("delivery_note_id").equals(noteId).delete();
    console.log(`âœ… Remito ${noteId} eliminado de IndexedDB`);
    return;
  }

  // Actualizar remito en IndexedDB
  await localDB.delivery_notes.put(noteData as DeliveryNoteDB);

  // Sincronizar items del remito
  const { data: itemsData, error: itemsError } = await supabase
    .from("delivery_note_items")
    .select("*")
    .eq("delivery_note_id", noteId);

  if (itemsError) throw itemsError;

  // Eliminar items viejos
  await localDB.delivery_note_items.where("delivery_note_id").equals(noteId).delete();

  // Insertar items nuevos
  if (itemsData && itemsData.length > 0) {
    await localDB.delivery_note_items.bulkAdd(itemsData as DeliveryNoteItemDB[]);
  }

  console.log(`âœ… Remito ${noteId} sincronizado a IndexedDB con ${itemsData?.length || 0} items`);
}

/**
 * Sincroniza mÃºltiples remitos a IndexedDB (Ãºtil despuÃ©s de operaciones masivas)
 */
export async function syncDeliveryNotesToLocal(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  console.log("ðŸ”„ Sincronizando todos los remitos a IndexedDB...");

  // Sincronizar delivery_notes
  const { data: notes, error: notesError } = await supabase.from("delivery_notes").select("*").eq("user_id", user.id);

  if (notesError) throw notesError;

  await localDB.delivery_notes.clear();
  if (notes && notes.length > 0) {
    await localDB.delivery_notes.bulkAdd(notes as DeliveryNoteDB[]);
  }

  // Sincronizar delivery_note_items
  const { data: items, error: itemsError } = await supabase.from("delivery_note_items").select("*");

  if (itemsError) throw itemsError;

  await localDB.delivery_note_items.clear();
  if (items && items.length > 0) {
    await localDB.delivery_note_items.bulkAdd(items as DeliveryNoteItemDB[]);
  }

  console.log(`âœ… ${notes?.length || 0} remitos y ${items?.length || 0} items sincronizados a IndexedDB`);
}

/**
 * Refresca los datos de remitos en memoria despuÃ©s de operaciones offline
 */
export async function refreshDeliveryNotesCache(): Promise<DeliveryNoteDB[]> {
  const notes = await localDB.delivery_notes.toArray();
  const items = await localDB.delivery_note_items.toArray();

  return notes.map((note) => ({
    ...note,
    items: items.filter((item) => item.delivery_note_id === note.id),
  })) as any;
}

// ==================== OPERACIONES CRUD OFFLINE ====================

// SUPPLIERS
export async function createSupplierOffline(
  supplier: Omit<SupplierDB, "id" | "created_at" | "updated_at">,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const tempId = generateTempId();
  const now = new Date().toISOString();

  const newSupplier: SupplierDB = {
    id: tempId,
    ...supplier,
    user_id: user.id,
    created_at: now,
    updated_at: now,
  };

  await localDB.suppliers.add(newSupplier);
  await queueOperation("suppliers", "INSERT", tempId, newSupplier);

  return tempId;
}

// CLIENTS
export async function updateDeliveryNotesForClientLocal(
  clientId: string,
  updates: { customer_name: string; customer_phone?: string | null; customer_address?: string | null },
  options: { enqueue?: boolean } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const notes = await localDB.delivery_notes.where("client_id").equals(clientId).toArray();

  for (const note of notes) {
    const noteUpdate = {
      customer_name: updates.customer_name,
      customer_phone: updates.customer_phone ?? null,
      customer_address: updates.customer_address ?? null,
      updated_at: now,
    };

    await localDB.delivery_notes.update(note.id, noteUpdate);
    if (options.enqueue) {
      await queueOperation("delivery_notes", "UPDATE", note.id, noteUpdate);
    }
  }
}

export async function detachClientFromDeliveryNotesLocal(clientId: string): Promise<void> {
  const now = new Date().toISOString();
  const notes = await localDB.delivery_notes.where("client_id").equals(clientId).toArray();

  for (const note of notes) {
    await localDB.delivery_notes.update(note.id, { client_id: null, updated_at: now });
  }
}

export async function createClientOffline(client: {
  name: string;
  phone?: string | null;
  address?: string | null;
}): Promise<ClientDB> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const tempId = generateTempId();
  const now = new Date().toISOString();

  const newClient: ClientDB = {
    id: tempId,
    user_id: user.id,
    name: client.name,
    phone: client.phone ?? null,
    address: client.address ?? null,
    created_at: now,
    updated_at: now,
  };

  await localDB.clients.add(newClient);
  await queueOperation("clients", "INSERT", tempId, newClient);

  return newClient;
}

export async function updateClientOffline(
  clientId: string,
  updates: { name?: string; phone?: string | null; address?: string | null },
): Promise<void> {
  const existing = await localDB.clients.get(clientId);
  if (!existing) throw new Error("Cliente no encontrado");

  const now = new Date().toISOString();
  const updateData = {
    name: updates.name ?? existing.name,
    phone: updates.phone ?? existing.phone ?? null,
    address: updates.address ?? existing.address ?? null,
    updated_at: now,
  };

  await localDB.clients.update(clientId, updateData);
  await queueOperation("clients", "UPDATE", clientId, updateData);

  await updateDeliveryNotesForClientLocal(
    clientId,
    {
      customer_name: updateData.name,
      customer_phone: updateData.phone,
      customer_address: updateData.address,
    },
    { enqueue: true },
  );
}

export async function deleteClientOffline(clientId: string): Promise<void> {
  const existing = await localDB.clients.get(clientId);
  if (!existing) throw new Error("Cliente no encontrado");

  await localDB.clients.delete(clientId);
  await queueOperation("clients", "DELETE", clientId, {});

  await detachClientFromDeliveryNotesLocal(clientId);
}

// PRODUCT LISTS
export async function createProductListOffline(data: {
  supplierId: string;
  name: string;
  fileName: string;
  fileType: string;
  columnSchema: any[];
  products: any[];
}): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const tempId = generateTempId();
  const now = new Date().toISOString();

  const listData: ProductListDB = {
    id: tempId,
    user_id: user.id,
    supplier_id: data.supplierId,
    name: data.name,
    file_name: data.fileName,
    file_type: data.fileType,
    product_count: data.products.length,
    column_schema: data.columnSchema,
    created_at: now,
    updated_at: now,
  };

  await localDB.product_lists.add(listData);
  await queueOperation("product_lists", "INSERT", tempId, listData);

  // Agregar productos
  const productsToAdd = data.products.map((p) => ({
    id: crypto.randomUUID(),
    user_id: user.id,
    list_id: tempId,
    code: p.code,
    name: p.name,
    price: p.price,
    quantity: p.quantity,
    data: p.data,
    created_at: now,
    updated_at: now,
  }));

  await localDB.dynamic_products.bulkAdd(productsToAdd);

  // Encolar operaciÃ³n de productos (se sincronizarÃ¡n cuando se cree la lista)
  for (const product of productsToAdd) {
    await queueOperation("dynamic_products", "INSERT", product.id, product);
  }

  return { id: tempId };
}

export async function updateProductListOffline(
  listId: string,
  data: {
    fileName: string;
    columnSchema: any[];
    products: any[];
  },
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const existing = await localDB.product_lists.get(listId);
  if (!existing) throw new Error("Lista no encontrada");

  const now = new Date().toISOString();

  // 1. Actualizar metadatos
  const updates = {
    name: data.fileName,
    file_name: data.fileName,
    product_count: data.products.length,
    column_schema: data.columnSchema,
    updated_at: now,
  };

  await localDB.product_lists.update(listId, updates);
  await queueOperation("product_lists", "UPDATE", listId, updates);

  // 2. Obtener productos existentes
  const existingProducts = await localDB.dynamic_products.where("list_id").equals(listId).toArray();

  const existingByCode = new Map(existingProducts.map((p) => [p.code, { id: p.id, quantity: p.quantity }]));

  const existingIds = new Set(existingProducts.map((p) => p.id));
  const updatedIds = new Set<string>();

  // 3. UPSERT: Actualizar existentes e insertar nuevos
  for (const product of data.products) {
    if (product.code && existingByCode.has(product.code)) {
      // âœ… UPDATE: Producto existe
      const existing = existingByCode.get(product.code)!;
      updatedIds.add(existing.id);

      await localDB.dynamic_products.update(existing.id, {
        name: product.name,
        price: product.price,
        data: product.data,
        updated_at: now,
      });

      await queueOperation("dynamic_products", "UPDATE", existing.id, {
        name: product.name,
        price: product.price,
        data: product.data,
        updated_at: now,
      });
    } else {
      // âœ… INSERT: Producto nuevo
      const newId = crypto.randomUUID();
      updatedIds.add(newId);

      const newProduct = {
        id: newId,
        user_id: user.id,
        list_id: listId,
        code: product.code,
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        data: product.data,
        created_at: now,
        updated_at: now,
      };

      await localDB.dynamic_products.add(newProduct);
      await queueOperation("dynamic_products", "INSERT", newId, newProduct);
    }
  }

  // 4. DELETE: Eliminar productos obsoletos
  const idsToDelete = Array.from(existingIds).filter((id) => !updatedIds.has(id));

  for (const id of idsToDelete) {
    await localDB.dynamic_products.delete(id);
    await queueOperation("dynamic_products", "DELETE", id, {});
  }

  // 5. Limpiar y regenerar Ã­ndice local
  await localDB.dynamic_products_index.where("list_id").equals(listId).delete();

  const updatedProducts = await localDB.dynamic_products.where("list_id").equals(listId).toArray();

  // Mapear productos al formato de Ã­ndice
  const indexEntries = updatedProducts.map((p) => ({
    id: crypto.randomUUID(),
    user_id: p.user_id,
    list_id: p.list_id,
    product_id: p.id,
    code: p.code,
    name: p.name,
    price: p.price,
    quantity: p.quantity,
    in_my_stock: false, // Deprecado: se determina por my_stock_products
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));

  await localDB.dynamic_products_index.bulkAdd(indexEntries);

  console.log(
    `âœ… [Offline] UPSERT completado: ${updatedIds.size} productos actualizados/insertados, ${idsToDelete.length} eliminados`,
  );
}

export async function deleteProductListOffline(listId: string): Promise<void> {
  await localDB.product_lists.delete(listId);
  await localDB.dynamic_products.where("list_id").equals(listId).delete();
  await localDB.dynamic_products_index.where("list_id").equals(listId).delete();
  await queueOperation("product_lists", "DELETE", listId, {});
}

// Helpers para sincronizaciÃ³n puntual de listas de productos
export async function upsertProductListLocalRecord(
  list: Pick<ProductListDB, "id"> & Partial<Omit<ProductListDB, "id">>,
): Promise<void> {
  const existing = await localDB.product_lists.get(list.id);
  if (!existing && (!list.user_id || !list.supplier_id || !list.name)) {
    throw new Error("Datos insuficientes para crear la lista localmente");
  }

  const now = new Date().toISOString();
  const record: ProductListDB = {
    id: list.id,
    user_id: list.user_id || existing?.user_id || "",
    supplier_id: list.supplier_id || existing?.supplier_id || "",
    name: list.name ?? existing?.name ?? "",
    file_name: list.file_name ?? existing?.file_name ?? "",
    file_type: list.file_type ?? existing?.file_type ?? "",
    product_count: list.product_count ?? existing?.product_count ?? 0,
    column_schema: list.column_schema ?? existing?.column_schema ?? [],
    mapping_config: list.mapping_config ?? existing?.mapping_config,
    created_at: list.created_at || existing?.created_at || now,
    updated_at: list.updated_at || now,
  };

  await localDB.product_lists.put(record);
}

export async function deleteProductListLocalRecord(listId: string): Promise<void> {
  await localDB.product_lists.delete(listId);
  await localDB.dynamic_products.where("list_id").equals(listId).delete();
  await localDB.dynamic_products_index.where("list_id").equals(listId).delete();
}

export async function replaceListProductsLocalData(
  listId: string,
  products: DynamicProductDB[] = [],
  indexEntries: DynamicProductIndexDB[] = [],
): Promise<void> {
  await localDB.dynamic_products.where("list_id").equals(listId).delete();
  if (products.length > 0) {
    await localDB.dynamic_products.bulkAdd(products);
  }

  await localDB.dynamic_products_index.where("list_id").equals(listId).delete();
  if (indexEntries.length > 0) {
    await localDB.dynamic_products_index.bulkAdd(indexEntries);
  }
}

export async function syncProductListById(listId: string): Promise<void> {
  if (!isOnline()) {
    console.warn("âš ï¸ Sin conexiÃ³n. No se puede sincronizar la lista", listId);
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const { data: listData, error: listError } = await supabase
    .from("product_lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();
  if (listError) throw listError;

  if (!listData) {
    await deleteProductListLocalRecord(listId);
    return;
  }

  await upsertProductListLocalRecord(listData as ProductListDB);

  const { data: productsData, error: productsError } = await supabase
    .from("dynamic_products")
    .select("*")
    .eq("list_id", listId);
  if (productsError) throw productsError;

  const { data: indexData, error: indexError } = await supabase
    .from("dynamic_products_index")
    .select("*")
    .eq("list_id", listId);
  if (indexError) throw indexError;

  await replaceListProductsLocalData(
    listId,
    (productsData as DynamicProductDB[]) || [],
    (indexData as DynamicProductIndexDB[]) || [],
  );
}

export async function updateSupplierOffline(id: string, updates: Partial<SupplierDB>): Promise<void> {
  const existing = await localDB.suppliers.get(id);
  if (!existing) throw new Error("Proveedor no encontrado");

  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await localDB.suppliers.put(updated);
  await queueOperation("suppliers", "UPDATE", id, updates);
}

export async function deleteSupplierOffline(id: string): Promise<void> {
  await localDB.suppliers.delete(id);
  await queueOperation("suppliers", "DELETE", id, {});
}

// Helpers para sincronizar proveedores especÃ­ficos cuando hay conexiÃ³n
export async function upsertSupplierLocalRecord(
  supplier: Pick<SupplierDB, "id" | "name"> &
    Partial<Pick<SupplierDB, "logo_url" | "user_id" | "created_at" | "updated_at">>,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await localDB.suppliers.get(supplier.id);

  const record: SupplierDB = {
    id: supplier.id,
    user_id: supplier.user_id || existing?.user_id || "",
    name: supplier.name || existing?.name || "",
    logo_url: supplier.logo_url ?? existing?.logo_url,
    created_at: supplier.created_at || existing?.created_at || now,
    updated_at: supplier.updated_at || now,
  };

  await localDB.suppliers.put(record);
}

export async function deleteSupplierLocalRecord(id: string): Promise<void> {
  await localDB.suppliers.delete(id);
}

/**
 * Actualiza stock y registra compensaciÃ³n para rollback
 */
async function updateProductQuantityDeltaWithCompensation(
  productId: string,
  quantityDelta: number,
  operationId: number,
): Promise<void> {
  await updateProductQuantityDelta(productId, quantityDelta);

  await localDB.stock_compensations.add({
    operation_id: operationId,
    product_id: productId,
    quantity_delta: quantityDelta,
    timestamp: Date.now(),
  });

  console.log(`ðŸ“ŠCompensaciÃ³n registrada: producto=${productId}, delta=${quantityDelta}`);
}

/**
 * Revierte cambios de stock si la operaciÃ³n falla
 */
async function rollbackStockCompensation(operationId: number): Promise<void> {
  const compensations = await localDB.stock_compensations.where("operation_id").equals(operationId).toArray();

  console.log(`ðŸ”„ Revirtiendo ${compensations.length} cambios de stock...`);

  for (const comp of compensations) {
    await updateProductQuantityDelta(comp.product_id, -comp.quantity_delta, { enqueue: false });
    console.log(`  âœ… Revertido: producto=${comp.product_id}, delta=${-comp.quantity_delta}`);
  }

  await localDB.stock_compensations.where("operation_id").equals(operationId).delete();
}

/**
 * Limpia compensaciones exitosas
 */
async function clearStockCompensation(operationId: number): Promise<void> {
  await localDB.stock_compensations.where("operation_id").equals(operationId).delete();
}

/**
 * Rollback para DELETE de delivery_notes fallido
 * Restaura el remito y sus items desde el snapshot
 * Si se habÃ­a revertido stock, deshace esa reversiÃ³n
 */
async function rollbackDeliveryNoteDelete(snapshot: {
  note: DeliveryNoteDB;
  items: DeliveryNoteItemDB[];
  shouldRevertStock: boolean;
}): Promise<void> {
  console.log(`ðŸ”„ Rollback de eliminaciÃ³n de remito: ${snapshot.note.id}`);

  try {
    // PASO 1: Restaurar el remito en IndexedDB
    await localDB.delivery_notes.put(snapshot.note);
    console.log(`  âœ… Remito restaurado: ${snapshot.note.id}`);

    // PASO 2: Restaurar los items
    for (const item of snapshot.items) {
      await localDB.delivery_note_items.put(item);
    }
    console.log(`  âœ… ${snapshot.items.length} items restaurados`);

    // PASO 3: Si se habÃ­a revertido stock, deshacer esa reversiÃ³n (restar cantidades)
    if (snapshot.shouldRevertStock) {
      console.log(`  ðŸ”„ Deshaciendo reversiÃ³n de stock...`);
      for (const item of snapshot.items) {
        if (item.product_id) {
          console.log(`    â¬‡ï¸ Restando: ${item.product_name} (-${item.quantity})`);
          await updateProductQuantityDelta(item.product_id, -item.quantity, { enqueue: false });
        }
      }
    }

    console.log(`âœ… Rollback completado para remito ${snapshot.note.id}`);
  } catch (error) {
    console.error(`âŒ Error en rollback de remito:`, error);
  }
}

/**
 * Rollback para UPDATE de delivery_notes fallido
 * Restaura el estado anterior del remito y sus items desde el snapshot
 * Revierte los ajustes de stock aplicados
 */
async function rollbackDeliveryNoteUpdate(snapshot: {
  previousNote: DeliveryNoteDB;
  previousItems: DeliveryNoteItemDB[];
  newItems: any[] | null;
  stockAdjustments: Array<{ id: string; delta: number }>;
}): Promise<void> {
  const noteId = snapshot.previousNote.id;
  console.log(`ðŸ”„ Rollback de actualizaciÃ³n de remito: ${noteId}`);

  try {
    // PASO 1: Restaurar el remito al estado anterior
    await localDB.delivery_notes.put(snapshot.previousNote);
    console.log(`  âœ… Remito restaurado al estado anterior`);

    // PASO 2: Eliminar items actuales y restaurar los anteriores
    await localDB.delivery_note_items.where("delivery_note_id").equals(noteId).delete();

    for (const item of snapshot.previousItems) {
      await localDB.delivery_note_items.put(item);
    }
    console.log(`  âœ… ${snapshot.previousItems.length} items restaurados`);

    // PASO 3: Revertir ajustes de stock (invertir los deltas)
    if (snapshot.stockAdjustments && snapshot.stockAdjustments.length > 0) {
      console.log(`  ðŸ”„ Revirtiendo ${snapshot.stockAdjustments.length} ajustes de stock...`);
      for (const adj of snapshot.stockAdjustments) {
        if (adj.delta !== 0) {
          // Invertir el delta para revertir el cambio
          console.log(`    ðŸ“¦ Revirtiendo: ${adj.id} (${adj.delta > 0 ? "-" : "+"}${Math.abs(adj.delta)})`);
          await updateProductQuantityDelta(adj.id, -adj.delta, { enqueue: false });
        }
      }
    }

    console.log(`âœ… Rollback de actualizaciÃ³n completado para remito ${noteId}`);
  } catch (error) {
    console.error(`âŒ Error en rollback de actualizaciÃ³n de remito:`, error);
  }
}

// DELIVERY NOTES
export async function createDeliveryNoteOffline(
  note: Omit<DeliveryNoteDB, "id" | "created_at" | "updated_at">,
  items: Omit<DeliveryNoteItemDB, "id" | "delivery_note_id" | "created_at">[],
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const tempNoteId = generateTempId();
  const now = new Date().toISOString();

  const newNote: DeliveryNoteDB = {
    id: tempNoteId,
    ...note,
    user_id: user.id,
    created_at: now,
    updated_at: now,
  };

  await localDB.delivery_notes.add(newNote);

  const operationId = await queueOperationWithId("delivery_notes", "INSERT", tempNoteId, newNote);

  for (const item of items) {
    const tempItemId = generateTempId();
    const newItem: DeliveryNoteItemDB = {
      id: tempItemId,
      delivery_note_id: tempNoteId,
      ...item,
      created_at: now,
    };

    await localDB.delivery_note_items.add(newItem);
    await queueOperation("delivery_note_items", "INSERT", tempItemId, newItem);

    if (item.product_id) {
      await updateProductQuantityDeltaWithCompensation(item.product_id, -item.quantity, operationId);
    }
  }

  console.log(`âœ… Remito ${tempNoteId} creado offline con compensaciÃ³n de stock`);
  return tempNoteId;
}

export async function updateDeliveryNoteOffline(
  id: string,
  updates: Partial<DeliveryNoteDB>,
  items?: Omit<DeliveryNoteItemDB, "id" | "delivery_note_id" | "created_at">[],
): Promise<void> {
  const existing = await localDB.delivery_notes.get(id);
  if (!existing) throw new Error("Remito no encontrado");

  const now = new Date().toISOString();

  // PASO 1: Obtener items ANTERIORES para snapshot (antes de cualquier cambio)
  const oldItems = await localDB.delivery_note_items.where("delivery_note_id").equals(id).toArray();

  // PASO 2: Crear snapshot del estado anterior para posible rollback
  const snapshot = {
    note: { ...existing },
    items: [...oldItems],
    newItems: [] as DeliveryNoteItemDB[],
  };

  console.log(`ðŸ”„ Actualizando remito offline ${id}:`);
  console.log(`  Items antiguos: ${oldItems.length}`);
  console.log(`  Items nuevos: ${items?.length ?? "sin cambios"}`);

  // Calcular nuevo total si se proporcionan items
  let newTotal = existing.total_amount;
  const stockAdjustmentsMap = new Map<string, number>();

  // Si se proporcionan items, calcular ajustes netos de stock
  if (items !== undefined) {
    // Recalcular total basado en nuevos items
    newTotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

    console.log(`  Total anterior: ${existing.total_amount}, Nuevo total: ${newTotal}`);

    // PASO 3: Calcular ajustes NETOS de stock (una sola operaciÃ³n atÃ³mica)
    // Sumar cantidades originales (devuelven stock = delta positivo)
    for (const oldItem of oldItems) {
      if (oldItem.product_id) {
        const current = stockAdjustmentsMap.get(oldItem.product_id) || 0;
        stockAdjustmentsMap.set(oldItem.product_id, current + oldItem.quantity);
      }
    }

    // Restar cantidades nuevas (descuentan stock = delta negativo)
    for (const newItem of items) {
      if (newItem.product_id) {
        const current = stockAdjustmentsMap.get(newItem.product_id) || 0;
        stockAdjustmentsMap.set(newItem.product_id, current - newItem.quantity);
      }
    }

    // PASO 4: Aplicar solo los deltas netos en IndexedDB (SIN encolar para evitar duplicaciÃ³n en sync)
    for (const [productId, delta] of stockAdjustmentsMap.entries()) {
      if (delta !== 0) {
        console.log(`  ðŸ“¦ Ajuste neto: ${productId} (${delta > 0 ? "+" : ""}${delta})`);
        await updateProductQuantityDelta(productId, delta, { enqueue: false });
      }
    }

    // PASO 5: Eliminar items antiguos de IndexedDB (sin encolar operaciones individuales)
    await localDB.delivery_note_items.where("delivery_note_id").equals(id).delete();

    // PASO 6: Insertar nuevos items en IndexedDB (sin encolar operaciones individuales)
    const newItemsToSave: DeliveryNoteItemDB[] = [];
    for (const item of items) {
      const itemId = generateTempId();
      const newItem: DeliveryNoteItemDB = {
        id: itemId,
        delivery_note_id: id,
        ...item,
        created_at: now,
      };
      newItemsToSave.push(newItem);
    }

    if (newItemsToSave.length > 0) {
      await localDB.delivery_note_items.bulkAdd(newItemsToSave);
    }

    // Guardar nuevos items en snapshot para sincronizaciÃ³n
    snapshot.newItems = newItemsToSave;
  }

  // PASO 7: Calcular campos financieros consistentes
  const newPaidAmount = updates.paid_amount ?? existing.paid_amount;
  const newRemainingBalance = newTotal - newPaidAmount;
  const newStatus = newPaidAmount >= newTotal ? "paid" : "pending";

  console.log(`  ðŸ’° Financiero: pagado=${newPaidAmount}, restante=${newRemainingBalance}, status=${newStatus}`);

  // PASO 8: Actualizar nota principal en IndexedDB
  const updated: DeliveryNoteDB = {
    ...existing,
    ...updates,
    total_amount: newTotal,
    paid_amount: newPaidAmount,
    remaining_balance: newRemainingBalance,
    status: newStatus,
    updated_at: now,
  };

  await localDB.delivery_notes.put(updated);

  // PASO 9: Encolar UNA SOLA operaciÃ³n atÃ³mica con snapshot completo
  // Esta operaciÃ³n incluye la nota y todos los items para sincronizaciÃ³n atÃ³mica
  const syncData = {
    // Datos para actualizar en Supabase
    client_id: updates.client_id ?? existing.client_id,
    customer_name: updates.customer_name ?? existing.customer_name,
    customer_address: updates.customer_address ?? existing.customer_address,
    customer_phone: updates.customer_phone ?? existing.customer_phone,
    issue_date: updates.issue_date ?? existing.issue_date,
    total_amount: newTotal,
    paid_amount: newPaidAmount,
    status: newStatus,
    notes: updates.notes ?? existing.notes,
    extra_fields: updates.extra_fields ?? existing.extra_fields,
    updated_at: now,
    // Snapshot para sincronizaciÃ³n atÃ³mica y rollback
    _snapshot: {
      previousNote: snapshot.note,
      previousItems: snapshot.items,
      newItems: items
        ? snapshot.newItems.map((item) => ({
            product_id: item.product_id,
            product_code: item.product_code,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
          }))
        : null,
      stockAdjustments: Array.from(stockAdjustmentsMap.entries()).map(([id, delta]) => ({ id, delta })),
    },
  };

  await queueOperation("delivery_notes", "UPDATE", id, syncData);

  console.log(`âœ… Remito ${id} actualizado offline con operaciÃ³n atÃ³mica`);
}

export async function deleteDeliveryNoteOffline(id: string): Promise<void> {
  const note = await localDB.delivery_notes.get(id);
  if (!note) throw new Error("Remito no encontrado");

  console.log(`ðŸ—‘ï¸ Eliminando remito offline: ${id}, status: ${note.status}`);

  // PASO 1: Obtener items para snapshot y posible reversiÃ³n de stock
  const items = await localDB.delivery_note_items.where("delivery_note_id").equals(id).toArray();

  // PASO 2: Determinar si se debe revertir stock (SOLO si NO estÃ¡ pagado)
  const shouldRevertStock = note.status !== "paid";

  console.log(`  shouldRevertStock: ${shouldRevertStock} (status=${note.status})`);

  // PASO 3: Si corresponde, revertir stock (delta POSITIVO) - SIN encolar para evitar duplicaciÃ³n
  if (shouldRevertStock) {
    for (const item of items) {
      if (item.product_id) {
        console.log(`  â¬†ï¸ Revirtiendo: ${item.product_name} (+${item.quantity})`);
        await updateProductQuantityDelta(item.product_id, item.quantity, { enqueue: false });
      }
    }
  } else {
    console.log(`  â„¹ï¸ Remito pagado: NO se revierte stock`);
  }

  // PASO 4: Eliminar items de la base de datos
  await localDB.delivery_note_items.where("delivery_note_id").equals(id).delete();

  for (const item of items) {
    await queueOperation("delivery_note_items", "DELETE", item.id, {});
  }

  // PASO 5: Eliminar nota
  await localDB.delivery_notes.delete(id);

  // PASO 6: Encolar DELETE con snapshot para posible rollback
  // El snapshot incluye la nota, items y si se revirtiÃ³ stock
  const snapshot = {
    note: note,
    items: items,
    shouldRevertStock: shouldRevertStock,
  };

  await queueOperation("delivery_notes", "DELETE", id, { _snapshot: snapshot });

  console.log(`âœ… Remito ${id} eliminado offline ${shouldRevertStock ? "con" : "sin"} reversiÃ³n de stock`);
}

export async function markDeliveryNoteAsPaidOffline(id: string, paidAmount: number): Promise<void> {
  const note = await localDB.delivery_notes.get(id);
  if (!note) throw new Error("Remito no encontrado");

  const remainingBalance = note.total_amount - paidAmount;
  const status = remainingBalance <= 0 ? "paid" : "pending";
  const now = new Date().toISOString();

  // Actualizaciones para IndexedDB (incluye remaining_balance para UI)
  const localUpdates = {
    paid_amount: paidAmount,
    remaining_balance: remainingBalance,
    status,
    updated_at: now,
  };

  await localDB.delivery_notes.put({
    ...note,
    ...localUpdates,
  });

  // BUSCAR operaciÃ³n UPDATE pendiente para este remito (Ã­ndice compuesto)
  const pendingOp = await localDB.pending_operations
    .where("[table_name+record_id+operation_type]")
    .equals(["delivery_notes", id, "UPDATE"])
    .first();

  if (pendingOp) {
    // FUSIONAR con la operaciÃ³n existente (mantener snapshot e items)
    console.log(`ðŸ”„ Fusionando pago con operaciÃ³n UPDATE existente para remito ${id}`);
    
    const mergedData = {
      ...pendingOp.data,
      paid_amount: paidAmount,
      status,
      updated_at: now,
    };

    await localDB.pending_operations.update(pendingOp.id!, {
      data: mergedData,
      timestamp: Date.now(),
    });
  } else {
    // No hay operaciÃ³n pendiente, encolar nueva
    console.log(`âž• Encolando nueva operaciÃ³n de pago para remito ${id}`);
    
    await queueOperation("delivery_notes", "UPDATE", id, {
      paid_amount: paidAmount,
      status,
      updated_at: now,
    });
  }
}

// PRODUCTOS - Actualizar cantidad (privada, usa delta)
/**
 * Actualiza la cantidad de un producto en modo offline
 * Delta positivo = aumentar stock, Delta negativo = reducir stock
 */
async function updateProductQuantityDelta(
  productId: string,
  quantityDelta: number,
  options: { enqueue?: boolean } = {},
): Promise<void> {
  const enqueue = options.enqueue !== false;
  const now = new Date().toISOString();

  console.log(`ÐY"Ý Actualizando stock offline: productId=${productId}, delta=${quantityDelta}, enqueue=${enqueue}`);

  // PASO 1: Buscar en dynamic_products_index usando product_id
  const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();

  if (!indexRecord) {
    console.warn(`ƒsÿ‹÷? Producto ${productId} no encontrado en Çðndice local`);
    return;
  }

  // PASO 2: Calcular nueva cantidad (no permitir negativos)
  const currentQuantity = indexRecord.quantity || 0;
  const newQuantity = Math.max(0, currentQuantity + quantityDelta);

  console.log(`  Cantidad actual: ${currentQuantity}, Nueva cantidad: ${newQuantity}`);

  // PASO 3: Actualizar en dynamic_products_index
  await localDB.dynamic_products_index.update(indexRecord.id!, {
    quantity: newQuantity,
    updated_at: now,
  });

  if (enqueue) {
    // IMPORTANT: dynamic_products_index se actualiza por su PK (id), NO por product_id
    await queueOperation("dynamic_products_index", "UPDATE", indexRecord.id!, {
      quantity: newQuantity,
      updated_at: now,
    });
  }

  // PASO 4: Actualizar en dynamic_products (tabla principal)
  const fullProduct = await localDB.dynamic_products.get(productId);
  if (fullProduct) {
    await localDB.dynamic_products.update(productId, {
      quantity: newQuantity,
      updated_at: now,
    });

    if (enqueue) {
      // PASO 5: Encolar operaciÇün para sincronizar cuando haya conexiÇün
      await queueOperation("dynamic_products", "UPDATE", productId, {
        quantity: newQuantity,
        updated_at: now,
      });
    }

    console.log(`ƒo. Stock actualizado offline: ${productId} -> ${newQuantity}`);
  } else {
    console.warn(`ƒsÿ‹÷? Producto ${productId} no encontrado en dynamic_products`);
  }


  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const myStockEntry = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
    if (myStockEntry) {
      await localDB.my_stock_products.update(myStockEntry.id, {
        quantity: newQuantity,
        updated_at: now,
      });

      if (enqueue) {
        await queueOperation("my_stock_products", "UPDATE", myStockEntry.id, {
          quantity: newQuantity,
          updated_at: now,
        });
      }
    }
  }
}
// DYNAMIC PRODUCTS - Operaciones offline pÃºblicas
export async function updateProductQuantityOffline(
  productId: string,
  listId: string,
  newQuantity: number,
  options: { enqueue?: boolean } = {},
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const now = new Date().toISOString();
  const enqueue = options.enqueue !== false;

  // Actualizar en dynamic_products_index
  const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId, list_id: listId }).first();

  if (indexRecord) {
    await localDB.dynamic_products_index.put({
      ...indexRecord,
      quantity: newQuantity,
      updated_at: now,
    });
  }

  // Actualizar en dynamic_products
  const productRecord = await localDB.dynamic_products.get(productId);
  if (productRecord) {
    await localDB.dynamic_products.put({
      ...productRecord,
      quantity: newQuantity,
      updated_at: now,
    });
  }

  const myStockEntry = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();

  // La pertenencia a "Mi Stock" NO depende del quantity: una vez que el producto entra, puede tener 0.
  // Si el usuario modifica el stock desde el input, asumimos que el producto debe existir en my_stock_products.
  if (myStockEntry) {
    await localDB.my_stock_products.update(myStockEntry.id, {
      quantity: newQuantity,
      updated_at: now,
    });

    if (enqueue) {
      await queueOperation("my_stock_products", "UPDATE", myStockEntry.id, {
        quantity: newQuantity,
        updated_at: now,
      });
    }
  } else {
    const newEntry: MyStockProductDB = {
      id: isOnline() ? crypto.randomUUID() : generateTempId(),
      user_id: user.id,
      product_id: productId,
      quantity: newQuantity,
      stock_threshold: indexRecord?.stock_threshold ?? 0,
      code: indexRecord?.code ?? "",
      name: indexRecord?.name ?? "",
      price: indexRecord?.price ?? 0,
      created_at: now,
      updated_at: now,
    };

    await localDB.my_stock_products.add(newEntry);

    if (enqueue) {
      await queueOperation("my_stock_products", "INSERT", newEntry.id, newEntry);
    }
  }

  // Encolar operaciÇün para sincronizar
  if (indexRecord && enqueue) {
    await queueOperation("dynamic_products_index", "UPDATE", indexRecord.id!, {
      quantity: newQuantity,
      updated_at: now,
    });
  }
}

export async function updateProductThresholdOffline(
  productId: string,
  listId: string,
  newThreshold: number,
  options: { enqueue?: boolean } = {},
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const normalizedThreshold = Math.max(0, newThreshold);
  const now = new Date().toISOString();
  const enqueue = options.enqueue !== false;

  const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId, list_id: listId }).first();

  if (indexRecord) {
    await localDB.dynamic_products_index.put({
      ...indexRecord,
      stock_threshold: normalizedThreshold,
      updated_at: now,
    });

    if (enqueue) {
      await queueOperation("dynamic_products_index", "UPDATE", indexRecord.id!, {
        stock_threshold: normalizedThreshold,
        updated_at: now,
      });
    }
  }

  const productRecord = await localDB.dynamic_products.get(productId);
  if (productRecord) {
    await localDB.dynamic_products.put({
      ...productRecord,
      stock_threshold: normalizedThreshold,
      updated_at: now,
    });
  }

  const myStockEntry = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
  if (myStockEntry) {
    await localDB.my_stock_products.update(myStockEntry.id, {
      stock_threshold: normalizedThreshold,
      updated_at: now,
    });

    if (enqueue) {
      await queueOperation("my_stock_products", "UPDATE", myStockEntry.id, {
        stock_threshold: normalizedThreshold,
        updated_at: now,
      });
    }
  }
}

export async function addToMyStock(
  productId: string,
  quantity: number,
  stockThreshold: number = 0,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const now = new Date().toISOString();
  const existing = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
  const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();

  const newQuantity = (existing?.quantity || 0) + quantity;
  const nextThreshold = stockThreshold ?? existing?.stock_threshold ?? 0;

  if (existing) {
    await localDB.my_stock_products.update(existing.id, {
      quantity: newQuantity,
      stock_threshold: nextThreshold,
      updated_at: now,
    });
  } else {
    const newEntry: MyStockProductDB = {
      id: isOnline() ? crypto.randomUUID() : generateTempId(),
      user_id: user.id,
      product_id: productId,
      quantity: newQuantity,
      stock_threshold: nextThreshold,
      code: indexRecord?.code ?? "",
      name: indexRecord?.name ?? "",
      price: indexRecord?.price ?? 0,
      created_at: now,
      updated_at: now,
    };

    await localDB.my_stock_products.add(newEntry);
  }

  await localDB.dynamic_products_index.where({ product_id: productId }).modify({
    quantity: newQuantity,
    updated_at: now,
  });

  await localDB.dynamic_products.update(productId, {
    quantity: newQuantity,
    updated_at: now,
  });

  if (isOnline()) {
    if (existing) {
      const { error } = await supabase
        .from("my_stock_products")
        .update({
          quantity: newQuantity,
          stock_threshold: nextThreshold,
          updated_at: now,
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      const inserted = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
      if (inserted) {
        const { error } = await supabase.from("my_stock_products").insert([
          {
            id: inserted.id,
            user_id: inserted.user_id,
            product_id: inserted.product_id,
            quantity: inserted.quantity,
            stock_threshold: inserted.stock_threshold,
            code: inserted.code,
            name: inserted.name,
            price: inserted.price,
            created_at: inserted.created_at,
            updated_at: inserted.updated_at,
          },
        ]);
        if (error) throw error;
      }
    }

    await supabase
      .from("dynamic_products_index")
      .update({ quantity: newQuantity, updated_at: now })
      .eq("product_id", productId);
  } else {
    if (existing) {
      await queueOperation("my_stock_products", "UPDATE", existing.id, {
        quantity: newQuantity,
        stock_threshold: nextThreshold,
        updated_at: now,
      });
    } else {
      const inserted = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
      if (inserted) {
        await queueOperation("my_stock_products", "INSERT", inserted.id, inserted);
      }
    }

    const indexRecordForQueue = await localDB.dynamic_products_index.where({ product_id: productId }).first();
    if (indexRecordForQueue) {
      await queueOperation("dynamic_products_index", "UPDATE", indexRecordForQueue.id, {
        quantity: newQuantity,
        updated_at: now,
      });
    }
  }
}

export async function removeFromMyStock(productId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const now = new Date().toISOString();
  const existing = await localDB.my_stock_products.where({ user_id: user.id, product_id: productId }).first();
  const indexRecord = await localDB.dynamic_products_index.where({ product_id: productId }).first();

  if (!existing) return;

  await localDB.my_stock_products.delete(existing.id);
  await localDB.dynamic_products_index.where({ product_id: productId }).modify({
    quantity: 0,
    updated_at: now,
  });

  await localDB.dynamic_products.update(productId, {
    quantity: 0,
    updated_at: now,
  });

  if (isOnline()) {
    const { error } = await supabase.from("my_stock_products").delete().eq("id", existing.id);
    if (error) throw error;

    await supabase
      .from("dynamic_products_index")
      .update({ quantity: 0, updated_at: now })
      .eq("product_id", productId);
  } else {
    await queueOperation("my_stock_products", "DELETE", existing.id, {});

    if (indexRecord) {
      await queueOperation("dynamic_products_index", "UPDATE", indexRecord.id, {
        quantity: 0,
        updated_at: now,
      });
    }
  }
}
// Rename a column key in JSONB data for all products in a list (offline)
export async function renameColumnKeyOffline(
  listId: string,
  oldKey: string,
  newKey: string
): Promise<number> {
  if (oldKey === newKey) return 0;

  let updatedCount = 0;

  // 1. Update dynamic_products data
  const products = await localDB.dynamic_products.where("list_id").equals(listId).toArray();
  for (const product of products) {
    if (product.data && oldKey in product.data) {
      const newData = { ...product.data };
      newData[newKey] = newData[oldKey];
      delete newData[oldKey];
      
      await localDB.dynamic_products.update(product.id, { 
        data: newData,
        updated_at: new Date().toISOString()
      });
      updatedCount++;
    }
  }

  // 2. Update dynamic_products_index calculated_data
  const indexedProducts = await localDB.dynamic_products_index.where("list_id").equals(listId).toArray();
  for (const indexProduct of indexedProducts) {
    if (indexProduct.calculated_data && oldKey in indexProduct.calculated_data) {
      const newCalcData = { ...indexProduct.calculated_data };
      newCalcData[newKey] = newCalcData[oldKey];
      delete newCalcData[oldKey];
      
      await localDB.dynamic_products_index.update(indexProduct.id, { 
        calculated_data: newCalcData,
        updated_at: new Date().toISOString()
      });
    }
  }

  console.log(`ðŸ”„ Offline: Renamed key "${oldKey}" to "${newKey}" in ${updatedCount} products`);
  return updatedCount;
}

export async function getProductsForListOffline(
  listId: string,
  page: number = 0,
  pageSize: number = 50,
  searchQuery?: string,
): Promise<{ data: any[]; hasMore: boolean; total: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  // Obtener la lista para acceder al mapping_config
  const listRecord = await localDB.product_lists.get(listId);
  const mappingConfig = listRecord?.mapping_config;

  const myStockEntries = await localDB.my_stock_products.where({ user_id: user.id }).toArray();
  const myStockByProductId = new Map(myStockEntries.map((entry) => [entry.product_id, entry]));

  // Obtener todos los productos del list_id del usuario
  let allRecords = await localDB.dynamic_products_index.where({ list_id: listId, user_id: user.id }).toArray();

  // Aplicar bÃºsqueda si existe (mÃ­nimo 2 caracteres)
  if (searchQuery && searchQuery.trim().length >= 2) {
    const lowerQuery = searchQuery.toLowerCase().trim();

    // Obtener productos completos para bÃºsqueda mÃ¡s profunda
    const fullProducts = await localDB.dynamic_products.where({ list_id: listId }).toArray();
    const fullProductsMap = new Map(fullProducts.map((p: any) => [p.id, p]));

    allRecords = allRecords.filter((r) => {
      // Buscar en campos del Ã­ndice (code y name)
      if (r.code?.toLowerCase().includes(lowerQuery) || r.name?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Buscar en producto completo usando mapping_config
      const fullProduct = fullProductsMap.get(r.product_id);
      if (!fullProduct?.data) return false;

      // Buscar en code_keys
      if (mappingConfig?.code_keys && Array.isArray(mappingConfig.code_keys)) {
        for (const key of mappingConfig.code_keys) {
          if (fullProduct.data[key]?.toString().toLowerCase().includes(lowerQuery)) {
            return true;
          }
        }
      }

      // Buscar en name_keys
      if (mappingConfig?.name_keys && Array.isArray(mappingConfig.name_keys)) {
        for (const key of mappingConfig.name_keys) {
          if (fullProduct.data[key]?.toString().toLowerCase().includes(lowerQuery)) {
            return true;
          }
        }
      }

      // Buscar en extra_index_keys si existen
      if (mappingConfig?.extra_index_keys && Array.isArray(mappingConfig.extra_index_keys)) {
        for (const key of mappingConfig.extra_index_keys) {
          if (fullProduct.data[key]?.toString().toLowerCase().includes(lowerQuery)) {
            return true;
          }
        }
      }

      // BÃºsqueda adicional en todos los campos de data (fallback)
      for (const [, value] of Object.entries(fullProduct.data)) {
        if (value && typeof value === "string" && value.toLowerCase().includes(lowerQuery)) {
          return true;
        }
      }

      return false;
    });
  }

  // Ordenar por nombre
  allRecords.sort((a, b) => {
    const nameA = a.name || "";
    const nameB = b.name || "";
    return nameA.localeCompare(nameB);
  });

  const total = allRecords.length;
  const offset = page * pageSize;
  const paginatedRecords = allRecords.slice(offset, offset + pageSize);

  // Enriquecer con data de dynamic_products
  const enrichedData = await Promise.all(
    paginatedRecords.map(async (indexRecord) => {
      const fullProduct = await localDB.dynamic_products.get(indexRecord.product_id);
      return {
        product_id: indexRecord.product_id,
        list_id: indexRecord.list_id,
        code: indexRecord.code,
        name: indexRecord.name,
        price: indexRecord.price,
        quantity: indexRecord.quantity,
        stock_threshold: myStockByProductId.get(indexRecord.product_id)?.stock_threshold ?? indexRecord.stock_threshold ?? 0,
        in_my_stock: myStockByProductId.has(indexRecord.product_id),
        calculated_data: (indexRecord as any).calculated_data ?? {},
        dynamic_products: fullProduct ? { data: fullProduct.data } : null,
      };
    }),
  );

  return {
    data: enrichedData,
    hasMore: offset + pageSize < total,
    total,
  };
}

// REQUEST ITEMS (Carrito)
export async function addToCartOffline(productId: string, quantity: number = 1): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  // Verificar si ya existe
  const existing = await localDB.request_items.where("product_id").equals(productId).first();

  if (existing) {
    const newQuantity = existing.quantity + quantity;
    await localDB.request_items.put({ ...existing, quantity: newQuantity });
    await queueOperation("request_items", "UPDATE", existing.id, { quantity: newQuantity });
    return existing.id;
  }

  const tempId = generateTempId();
  const newItem: RequestItemDB = {
    id: tempId,
    user_id: user.id,
    product_id: productId,
    quantity,
    created_at: new Date().toISOString(),
  };

  await localDB.request_items.add(newItem);
  await queueOperation("request_items", "INSERT", tempId, newItem);

  return tempId;
}

export async function updateCartItemOffline(id: string, quantity: number): Promise<void> {
  const existing = await localDB.request_items.get(id);
  if (existing) {
    await localDB.request_items.put({ ...existing, quantity });
    await queueOperation("request_items", "UPDATE", id, { quantity });
  }
}

export async function removeFromCartOffline(id: string): Promise<void> {
  await localDB.request_items.delete(id);
  await queueOperation("request_items", "DELETE", id, {});
}

export async function clearCartOffline(): Promise<void> {
  const items = await localDB.request_items.toArray();
  for (const item of items) {
    await localDB.request_items.delete(item.id);
    await queueOperation("request_items", "DELETE", item.id, {});
  }
}

// ==================== STOCK ITEMS ====================

export async function createStockItemOffline(
  item: Omit<StockItemDB, "id" | "created_at" | "updated_at">,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Usuario no autenticado");

  const tempId = generateTempId();
  const now = new Date().toISOString();

  const newItem: StockItemDB = {
    id: tempId,
    ...item,
    user_id: user.id,
    created_at: now,
    updated_at: now,
  };

  await localDB.stock_items.add(newItem);
  await queueOperation("stock_items", "INSERT", tempId, newItem);

  return tempId;
}

export async function updateStockItemOffline(id: string, updates: Partial<StockItemDB>): Promise<void> {
  const existing = await localDB.stock_items.get(id);
  if (!existing) throw new Error("Producto no encontrado");

  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  await localDB.stock_items.put(updated);
  await queueOperation("stock_items", "UPDATE", id, updates);
}

export async function deleteStockItemOffline(id: string): Promise<void> {
  await localDB.stock_items.delete(id);
  await queueOperation("stock_items", "DELETE", id, {});
}

// ==================== MANEJO DE TOKENS DE SESIÃ“N ====================

export async function saveAuthToken(
  userId: string,
  refreshToken: string,
  accessToken?: string,
  expiresAt?: number,
): Promise<void> {
  const tokenData: AuthTokenDB = {
    userId,
    refreshToken,
    accessToken,
    expiresAt,
    updatedAt: new Date().toISOString(),
  };

  await localDB.tokens.put(tokenData);
  console.log("ðŸ” Token de sesiÃ³n guardado en IndexedDB");
}

export async function getAuthToken(): Promise<AuthTokenDB | undefined> {
  const token = await localDB.tokens.toCollection().first();
  return token;
}

export async function clearAuthToken(): Promise<void> {
  await localDB.tokens.clear();
  console.log("ðŸ—‘ï¸ Tokens de sesiÃ³n eliminados de IndexedDB");
}

export async function clearAllLocalData(): Promise<void> {
  console.log("ðŸ—‘ï¸ Limpiando todos los datos locales...");

  try {
    await localDB.delete();
    await localDB.open();
    console.log("âœ… Todos los datos locales eliminados");
  } catch (error) {
    console.error("âŒ Error al limpiar datos locales:", error);
    throw error;
  }
}

// Helper para obtener dÃ³lar oficial offline
export async function getOfficialDollarRate(): Promise<number> {
  try {
    const setting = await localDB.settings.get("dollar_official");
    if (!setting || !setting.value || !setting.value.rate) {
      return 0;
    }
    return setting.value.rate;
  } catch (error) {
    console.error("Error obteniendo dÃ³lar oficial offline:", error);
    return 0;
  }
}

/**
 * Limpia operaciones pendientes muy antiguas (mÃ¡s de 7 dÃ­as)
 */
export async function cleanupOldOperations(): Promise<void> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const oldOps = await localDB.pending_operations.where("timestamp").below(sevenDaysAgo).toArray();

  if (oldOps.length === 0) return;

  console.log(`ðŸ—‘ï¸ Limpiando ${oldOps.length} operaciones antiguas...`);

  for (const op of oldOps) {
    await rollbackStockCompensation(op.id!);
    await localDB.pending_operations.delete(op.id!);
  }

}

// ==================== OBTENER DATOS OFFLINE ====================

export async function getOfflineData<T>(tableName: string): Promise<T[]> {
  switch (tableName) {
    case "suppliers":
      return (await localDB.suppliers.toArray()) as any;
    case "clients":
      return (await localDB.clients.toArray()) as any;
    case "product_lists":
      return (await localDB.product_lists.toArray()) as any;
    case "dynamic_products_index":
      return (await localDB.dynamic_products_index.toArray()) as any;
    case "dynamic_products":
      return (await localDB.dynamic_products.toArray()) as any;
    case "my_stock_products":
      return (await localDB.my_stock_products.toArray()) as any;
    case "delivery_notes":
      return (await localDB.delivery_notes.toArray()) as any;
    case "delivery_note_items":
      return (await localDB.delivery_note_items.toArray()) as any;
    case "request_items":
      return (await localDB.request_items.toArray()) as any;
    case "stock_items":
      return (await localDB.stock_items.toArray()) as any;
    default:
      throw new Error(`Tabla no soportada: ${tableName}`);
  }
}

// ==================== AUTO-SINCRONIZACIÃ“N ====================

// Variable de control para debounce del evento online
let onlineSyncTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Escuchar eventos de conexiÃ³n
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("ðŸŒ ConexiÃ³n restaurada. Programando sincronizaciÃ³n...");

    // Debounce de 2 segundos para evitar mÃºltiples ejecuciones
    if (onlineSyncTimeoutId) {
      clearTimeout(onlineSyncTimeoutId);
    }

    onlineSyncTimeoutId = setTimeout(async () => {
      onlineSyncTimeoutId = null;

      try {
        await syncPendingOperations();
        await syncFromSupabase();
      } catch (error) {
        console.error("Error en sincronizaciÃ³n automÃ¡tica:", error);
      }
    }, 2000);
  });

  window.addEventListener("offline", () => {
    console.log("ðŸ“¡ Sin conexiÃ³n. Trabajando en modo offline");
  });
}

/**
 * Getter para estado de sincronizaciÃ³n (Ãºtil para UI)
 */
export function isSyncing(): boolean {
  return isSyncInProgress;
}












