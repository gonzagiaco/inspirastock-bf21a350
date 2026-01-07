import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DeliveryNote, CreateDeliveryNoteInput, UpdateDeliveryNoteInput } from "@/types";
import { toast } from "sonner";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  createDeliveryNoteOffline,
  updateDeliveryNoteOffline,
  deleteDeliveryNoteOffline,
  markDeliveryNoteAsPaidOffline,
  getOfflineData,
  syncDeliveryNoteById,
} from "@/lib/localDB";
import { bulkAdjustStock, prepareDeliveryNoteAdjustments, calculateNetStockAdjustments } from "@/services/bulkStockService";

// F) Logging helper para observabilidad
const logDelivery = (action: string, details?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[DeliveryNotes ${timestamp}] ${action}`, details || "");
};

const calculateItemsTotal = (
  items: Array<{
    quantity?: number;
    unit_price?: number;
    unitPrice?: number;
    subtotal?: number | null;
  }>,
) =>
  items.reduce((sum, item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price ?? item.unitPrice);
    const subtotal = item.subtotal != null ? Number(item.subtotal) : NaN;
    const lineTotal = Number.isFinite(unitPrice) ? quantity * unitPrice : Number.isFinite(subtotal) ? subtotal : 0;
    return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
  }, 0);

/**
 * C) OPTIMIZADO: Actualiza stock usando bulk RPC
 * Una sola llamada para múltiples productos
 */
async function updateProductStockBulk(
  items: Array<{ productId?: string; quantity: number }>,
  operation: "create" | "delete" | "revert",
  isOnline: boolean,
  queryClient: QueryClient,
) {
  const startTime = performance.now();
  const adjustments = prepareDeliveryNoteAdjustments(items, operation);

  if (adjustments.length === 0) return;

  logDelivery(`Bulk stock ${operation}`, {
    items: adjustments.length,
    isOnline,
  });

  const result = await bulkAdjustStock(adjustments, isOnline);

  const endTime = performance.now();
  logDelivery(`Bulk stock completed in ${(endTime - startTime).toFixed(2)}ms`, {
    processed: result.processed,
    success: result.success,
  });

  // Invalidar queries relevantes
  invalidateProductQueries(queryClient);
}

/**
 * Invalida todas las queries relacionadas con productos
 * Usa resetQueries para forzar re-fetch desde IndexedDB
 */
function invalidateProductQueries(queryClient: QueryClient) {
  logDelivery("Invalidating product queries");
  
  // Invalidar todas las queries relacionadas
  queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
  
  // Usar resetQueries para my-stock y list-products
  // Esto fuerza que se re-ejecute el queryFn desde cero
  queryClient.resetQueries({ queryKey: ["my-stock"] });
  queryClient.resetQueries({ queryKey: ["list-products"] });
  queryClient.resetQueries({ queryKey: ["dynamic-products"] });
  
  queryClient.invalidateQueries({ queryKey: ["global-search"], refetchType: "all" });
  queryClient.invalidateQueries({ queryKey: ["product-lists-index"], refetchType: "all" });
  queryClient.invalidateQueries({ queryKey: ["product-lists"], refetchType: "all" });
}

export const useDeliveryNotes = () => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const { data: deliveryNotes = [], isLoading } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: async () => {
      if (!isOnline) {
        const offlineNotes = (await getOfflineData("delivery_notes")) as any[];
        const offlineItems = (await getOfflineData("delivery_note_items")) as any[];

        return (offlineNotes || []).map((note) => ({
          id: note.id,
          userId: note.user_id,
          clientId: note.client_id,
          customerName: note.customer_name,
          customerAddress: note.customer_address,
          customerPhone: note.customer_phone,
          issueDate: note.issue_date,
          totalAmount: Number(note.total_amount),
          paidAmount: Number(note.paid_amount),
          remainingBalance: Number(note.remaining_balance),
          status: note.status as "pending" | "paid",
          extraFields: note.extra_fields,
          notes: note.notes,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
          items: (offlineItems || [])
            .filter((item: any) => item.delivery_note_id === note.id)
            .map((item: any) => ({
              id: item.id,
              deliveryNoteId: item.delivery_note_id,
              productId: item.product_id,
              productCode: item.product_code,
              productName: item.product_name,
              quantity: item.quantity,
              unitPrice: Number(item.unit_price),
              subtotal: Number(item.subtotal),
              createdAt: item.created_at,
              productListId: item.product_list_id,
              priceColumnKeyUsed: item.price_column_key_used,
            })),
        })) as DeliveryNote[];
      }

      const { data, error } = await supabase
        .from("delivery_notes")
        .select(
          `
          *,
          items:delivery_note_items(*)
        `,
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data.map((note) => ({
        id: note.id,
        userId: note.user_id,
        clientId: note.client_id,
        customerName: note.customer_name,
        customerAddress: note.customer_address,
        customerPhone: note.customer_phone,
        issueDate: note.issue_date,
        totalAmount: Number(note.total_amount),
        paidAmount: Number(note.paid_amount),
        remainingBalance: Number(note.remaining_balance),
        status: note.status as "pending" | "paid",
        extraFields: note.extra_fields,
        notes: note.notes,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        items: note.items.map((item: any) => ({
          id: item.id,
          deliveryNoteId: item.delivery_note_id,
          productId: item.product_id,
          productCode: item.product_code,
          productName: item.product_name,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          createdAt: item.created_at,
          productListId: item.product_list_id,
          priceColumnKeyUsed: item.price_column_key_used,
        })),
      })) as DeliveryNote[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: CreateDeliveryNoteInput) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

      const status = (input.paidAmount || 0) >= total ? "paid" : "pending";

      if (!isOnline) {
        const noteData = {
          user_id: user.user.id,
          client_id: input.clientId ?? null,
          customer_name: input.customerName,
          customer_address: input.customerAddress,
          customer_phone: input.customerPhone,
          issue_date: input.issueDate || new Date().toISOString(),
          total_amount: total,
          paid_amount: input.paidAmount || 0,
          remaining_balance: total - (input.paidAmount || 0),
          extra_fields: input.extraFields,
          notes: input.notes,
          status,
        };

        const items = input.items.map((item) => ({
          product_id: item.productId,
          product_code: item.productCode,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
          product_list_id: item.productListId ?? null,
          price_column_key_used: item.priceColumnKeyUsed ?? null,
        }));

        const id = await createDeliveryNoteOffline(noteData, items);
        return { id };
      }

      // 🔧 Convertir fecha a mediodía UTC para evitar problemas de timezone
      const issueDate = input.issueDate ? `${input.issueDate}T12:00:00.000Z` : new Date().toISOString();

      const { data: note, error: noteError } = await supabase
        .from("delivery_notes")
        .insert({
          user_id: user.user.id,
          client_id: input.clientId ?? null,
          customer_name: input.customerName,
          customer_address: input.customerAddress,
          customer_phone: input.customerPhone,
          issue_date: issueDate,
          total_amount: total,
          paid_amount: input.paidAmount || 0,
          extra_fields: input.extraFields,
          notes: input.notes,
          status,
        })
        .select()
        .single();

      if (noteError) throw noteError;

      const { error: itemsError } = await supabase.from("delivery_note_items").insert(
        input.items.map((item) => ({
          delivery_note_id: note.id,
          product_id: item.productId,
          product_code: item.productCode,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          product_list_id: item.productListId ?? null,
          price_column_key_used: item.priceColumnKeyUsed ?? null,
        })),
      );

      if (itemsError) throw itemsError;

      // C) OPTIMIZADO: Usar bulk adjust en lugar de N llamadas individuales
      await updateProductStockBulk(input.items, "create", isOnline, queryClient);

      // 🆕 SINCRONIZAR A INDEXEDDB DESPUÉS DE CREAR
      if (note?.id) {
        try {
          await syncDeliveryNoteById(note.id);
        } catch (error) {
          console.error("Error al sincronizar remito a IndexedDB:", error);
        }
      }

      return note;
    },
    onSuccess: async () => {
      // Forzar refetch completo desde IndexedDB
      await queryClient.refetchQueries({
        queryKey: ["delivery-notes"],
        type: "active",
      });

      invalidateProductQueries(queryClient);
      toast.success(
        isOnline ? "Remito creado exitosamente y stock actualizado" : "Remito creado (se sincronizará al conectar)",
      );
    },
    onError: (error: any) => {
      toast.error(`Error al crear remito: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateDeliveryNoteInput) => {
      if (!isOnline) {
        // Asegurar que se pasen los items para la reversión offline
        const mappedItems = updates.items?.map((item) => ({
          product_id: item.productId,
          product_code: item.productCode,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
          product_list_id: item.productListId ?? null,
          price_column_key_used: item.priceColumnKeyUsed ?? null,
        }));

        const offlineUpdates: any = {};

        if (updates.clientId !== undefined) offlineUpdates.client_id = updates.clientId;
        if (updates.customerName !== undefined) offlineUpdates.customer_name = updates.customerName;
        if (updates.customerAddress !== undefined) offlineUpdates.customer_address = updates.customerAddress;
        if (updates.customerPhone !== undefined) offlineUpdates.customer_phone = updates.customerPhone;
        if (updates.issueDate !== undefined) offlineUpdates.issue_date = updates.issueDate;
        if (updates.paidAmount !== undefined) offlineUpdates.paid_amount = updates.paidAmount;
        if (updates.notes !== undefined) offlineUpdates.notes = updates.notes;
        if (updates.extraFields !== undefined) offlineUpdates.extra_fields = updates.extraFields;

        await updateDeliveryNoteOffline(id, offlineUpdates, mappedItems);
        return;
      }

      // PASO 1: Obtener remito original con items
      const { data: originalNote, error: fetchError } = await supabase
        .from("delivery_notes")
        .select(`*, items:delivery_note_items(*)`)
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;

      // PASO 2: Solo ajustar stock si hay cambios en items
      if (updates.items) {
        const originalItems = originalNote.items.map((item: any) => ({
          productId: item.product_id,
          quantity: item.quantity,
        }));

        const newItems = updates.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
        }));

        // Calcular ajustes netos (una sola operación atómica)
        const netAdjustments = calculateNetStockAdjustments(originalItems, newItems);
        
        logDelivery("Net stock adjustments calculated", {
          originalCount: originalItems.length,
          newCount: newItems.length,
          adjustments: netAdjustments.map(a => ({ id: a.product_id, delta: a.delta })),
        });

        // Aplicar ajustes netos (positivos devuelven stock, negativos descuentan)
        if (netAdjustments.length > 0) {
          await bulkAdjustStock(netAdjustments, isOnline);
          invalidateProductQueries(queryClient);
        }
      }

      // PASO 3: Calcular nuevo total
      let newTotal = originalNote.total_amount;
      if (updates.items) {
        newTotal = updates.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      }

      const newPaidAmount = updates.paidAmount ?? originalNote.paid_amount;
      const newStatus = newPaidAmount >= newTotal ? "paid" : "pending";

      // PASO 4: Actualizar nota principal
      // 🔧 Convertir fecha a mediodía UTC si se proporciona
      const issueDate = updates.issueDate ? `${updates.issueDate}T12:00:00.000Z` : undefined;

      const noteUpdate: any = {
        customer_name: updates.customerName,
        customer_address: updates.customerAddress,
        customer_phone: updates.customerPhone,
        issue_date: issueDate,
        total_amount: newTotal,
        paid_amount: newPaidAmount,
        notes: updates.notes,
        status: newStatus,
        // remaining_balance es columna generada, no se actualiza directamente
      };

      if (updates.clientId !== undefined) {
        noteUpdate.client_id = updates.clientId;
      }

      const { error: noteError } = await supabase.from("delivery_notes").update(noteUpdate).eq("id", id);

      if (noteError) throw noteError;

      // PASO 5: Reemplazar items si se proporcionaron
      if (updates.items) {
        // Eliminar items antiguos
        const { error: deleteError } = await supabase.from("delivery_note_items").delete().eq("delivery_note_id", id);

        if (deleteError) throw deleteError;

        // Insertar nuevos items
        const { error: itemsError } = await supabase.from("delivery_note_items").insert(
          updates.items.map((item) => ({
            delivery_note_id: id,
            product_id: item.productId,
            product_code: item.productCode,
            product_name: item.productName,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            product_list_id: item.productListId ?? null,
            price_column_key_used: item.priceColumnKeyUsed ?? null,
          })),
        );

        if (itemsError) throw itemsError;
      }

      // 🆕 SINCRONIZAR A INDEXEDDB DESPUÉS DE ACTUALIZAR
      try {
        await syncDeliveryNoteById(id);
      } catch (error) {
        console.error("Error al sincronizar remito actualizado a IndexedDB:", error);
      }
    },
    onSuccess: async (_, variables) => {
      // Forzar refetch completo desde IndexedDB
      await queryClient.refetchQueries({
        queryKey: ["delivery-notes"],
        type: "active",
      });

      if (variables?.id) {
        // Forzar que el editor del remito no se quede con cache viejo (staleTime en useDeliveryNoteWithItems)
        queryClient.invalidateQueries({
          queryKey: ["delivery-note-with-items", variables.id],
          refetchType: "active",
        });
      }

      invalidateProductQueries(queryClient);
      toast.success(isOnline ? "Remito actualizado exitosamente" : "Remito actualizado localmente");
    },
    onError: (error: any) => {
      toast.error(`Error al actualizar remito: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isOnline) {
        await deleteDeliveryNoteOffline(id);
        return;
      }

      const { data: note, error: fetchError } = await supabase
        .from("delivery_notes")
        .select(`*, items:delivery_note_items(*)`)
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;

      // 🆕 SOLO revertir stock si el remito NO está pagado
      const shouldRevertStock = note.status !== "paid";
      
      logDelivery("Delete delivery note", {
        id,
        status: note.status,
        shouldRevertStock,
        itemCount: note.items.length,
      });

      if (shouldRevertStock) {
        // Revertir stock usando bulk
        const deleteItems = note.items.map((item: any) => ({
          productId: item.product_id,
          quantity: item.quantity,
        }));
        await updateProductStockBulk(deleteItems, "delete", isOnline, queryClient);
      } else {
        logDelivery("Skipping stock revert - delivery note is paid");
      }

      const { error: deleteError } = await supabase.from("delivery_notes").delete().eq("id", id);

      if (deleteError) throw deleteError;

      // 🆕 SINCRONIZAR A INDEXEDDB DESPUÉS DE ELIMINAR
      try {
        await syncDeliveryNoteById(id);
      } catch (error) {
        console.error("Error al sincronizar eliminación a IndexedDB:", error);
      }
    },
    onSuccess: async () => {
      // Forzar refetch completo desde IndexedDB
      await queryClient.refetchQueries({
        queryKey: ["delivery-notes"],
        type: "active",
      });

      invalidateProductQueries(queryClient);
      toast.success(isOnline ? "Remito eliminado" : "Remito eliminado (se sincronizará al conectar)");
    },
    onError: (error: any) => {
      toast.error(`Error al eliminar remito: ${error.message}`);
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isOnline) {
        // Obtener el remito desde IndexedDB
        const offlineNotes = (await getOfflineData("delivery_notes")) as any[];
        const offlineItems = (await getOfflineData("delivery_note_items")) as any[];
        const note = offlineNotes.find((n: any) => n.id === id);

        if (!note) throw new Error("Remito no encontrado");

        const noteItems = (offlineItems || []).filter((item: any) => item.delivery_note_id === id);
        const computedTotal = noteItems.length > 0 ? calculateItemsTotal(noteItems) : Number(note.total_amount || 0);

        await markDeliveryNoteAsPaidOffline(id, computedTotal);
        return;
      }

      const { data: note, error: fetchError } = await supabase
        .from("delivery_notes")
        .select("total_amount, items:delivery_note_items(quantity, unit_price, subtotal)")
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;
      if (!note) throw new Error("Remito no encontrado");

      const computedTotal =
        Array.isArray(note.items) && note.items.length > 0 ? calculateItemsTotal(note.items) : Number(note.total_amount || 0);

      const { error } = await supabase
        .from("delivery_notes")
        .update({
          total_amount: computedTotal,
          paid_amount: computedTotal,
          status: "paid",
        })
        .eq("id", id);

      if (error) throw error;

      // 🆕 SINCRONIZAR A INDEXEDDB DESPUÉS DE MARCAR COMO PAGADO
      try {
        await syncDeliveryNoteById(id);
      } catch (error) {
        console.error("Error al sincronizar pago a IndexedDB:", error);
      }
    },
    onSuccess: async () => {
      // Forzar refetch completo desde IndexedDB
      await queryClient.refetchQueries({
        queryKey: ["delivery-notes"],
        type: "active",
      });

      toast.success(
        isOnline ? "Remito marcado como pagado" : "Remito marcado como pagado (se sincronizará al conectar)",
      );
    },
  });

  return {
    deliveryNotes,
    isLoading,
    createDeliveryNote: createMutation.mutateAsync,
    updateDeliveryNote: updateMutation.mutateAsync,
    deleteDeliveryNote: deleteMutation.mutateAsync,
    markAsPaid: markAsPaidMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
};




