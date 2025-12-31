import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOnlineStatus } from "./useOnlineStatus";
import { localDB } from "@/lib/localDB";
import { DeliveryNote, DeliveryNoteItem } from "@/types";

interface DeliveryNoteWithItems {
  note: DeliveryNote | null;
  items: DeliveryNoteItem[];
}

/**
 * Hook para obtener un remito con sus items, funciona tanto online como offline
 * @param noteId - ID del remito a obtener
 * @param enabled - Si debe ejecutarse la query (default: true)
 */
export function useDeliveryNoteWithItems(noteId: string | null, enabled: boolean = true) {
  const isOnline = useOnlineStatus();

  return useQuery<DeliveryNoteWithItems>({
    queryKey: ["delivery-note-with-items", noteId],
    queryFn: async () => {
      if (!noteId) {
        return { note: null, items: [] };
      }

      console.log(`📋 Fetching delivery note ${noteId}, online: ${isOnline}`);

      if (!isOnline) {
        // MODO OFFLINE: Leer de IndexedDB
        const noteData = await localDB.delivery_notes.get(noteId);
        
        if (!noteData) {
          console.warn(`⚠️ Remito ${noteId} no encontrado en IndexedDB`);
          return { note: null, items: [] };
        }

        const itemsData = await localDB.delivery_note_items
          .where("delivery_note_id")
          .equals(noteId)
          .toArray();

        console.log(`✅ Offline: ${itemsData.length} items cargados para remito ${noteId}`);

        const note: DeliveryNote = {
          id: noteData.id,
          userId: noteData.user_id,
          clientId: noteData.client_id,
          customerName: noteData.customer_name,
          customerAddress: noteData.customer_address,
          customerPhone: noteData.customer_phone,
          issueDate: noteData.issue_date,
          totalAmount: Number(noteData.total_amount),
          paidAmount: Number(noteData.paid_amount),
          remainingBalance: Number(noteData.remaining_balance),
          status: noteData.status as "pending" | "paid",
          extraFields: noteData.extra_fields,
          notes: noteData.notes,
          createdAt: noteData.created_at,
          updatedAt: noteData.updated_at,
          items: [],
        };

        const items: DeliveryNoteItem[] = itemsData.map((item) => ({
          id: item.id,
          deliveryNoteId: item.delivery_note_id,
          productId: item.product_id,
          productCode: item.product_code,
          productName: item.product_name,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          createdAt: item.created_at,
        }));

        return { note: { ...note, items }, items };
      }

      // MODO ONLINE: Leer de Supabase y cachear en IndexedDB
      const { data, error } = await supabase
        .from("delivery_notes")
        .select(`*, items:delivery_note_items(*)`)
        .eq("id", noteId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        console.warn(`⚠️ Remito ${noteId} no encontrado en Supabase`);
        return { note: null, items: [] };
      }

      // Cachear en IndexedDB para uso offline
      try {
        await localDB.delivery_notes.put({
          id: data.id,
          user_id: data.user_id,
          client_id: data.client_id,
          customer_name: data.customer_name,
          customer_address: data.customer_address,
          customer_phone: data.customer_phone,
          issue_date: data.issue_date,
          total_amount: data.total_amount,
          paid_amount: data.paid_amount,
          remaining_balance: data.remaining_balance,
          status: data.status,
          extra_fields: data.extra_fields,
          notes: data.notes,
          created_at: data.created_at,
          updated_at: data.updated_at,
        });

        // Eliminar items viejos y reemplazar con los nuevos
        await localDB.delivery_note_items
          .where("delivery_note_id")
          .equals(noteId)
          .delete();

        if (data.items && data.items.length > 0) {
          await localDB.delivery_note_items.bulkAdd(
            data.items.map((item: any) => ({
              id: item.id,
              delivery_note_id: item.delivery_note_id,
              product_id: item.product_id,
              product_code: item.product_code,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.subtotal,
              created_at: item.created_at,
            }))
          );
        }

        console.log(`✅ Remito ${noteId} cacheado en IndexedDB con ${data.items?.length || 0} items`);
      } catch (cacheError) {
        console.error("Error al cachear remito en IndexedDB:", cacheError);
      }

      const note: DeliveryNote = {
        id: data.id,
        userId: data.user_id,
        clientId: data.client_id,
        customerName: data.customer_name,
        customerAddress: data.customer_address,
        customerPhone: data.customer_phone,
        issueDate: data.issue_date,
        totalAmount: Number(data.total_amount),
        paidAmount: Number(data.paid_amount),
        remainingBalance: Number(data.remaining_balance),
        status: data.status as "pending" | "paid",
        extraFields: data.extra_fields as Record<string, any> | undefined,
        notes: data.notes,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items: [],
      };

      const items: DeliveryNoteItem[] = (data.items || []).map((item: any) => ({
        id: item.id,
        deliveryNoteId: item.delivery_note_id,
        productId: item.product_id,
        productCode: item.product_code,
        productName: item.product_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        subtotal: Number(item.subtotal),
        createdAt: item.created_at,
      }));

      return { note: { ...note, items }, items };
    },
    enabled: enabled && !!noteId,
    staleTime: 30000,
  });
}
