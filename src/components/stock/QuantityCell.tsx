import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { localDB, updateProductQuantityOffline } from "@/lib/localDB";

type Props = {
  productId: string;
  listId: string;
  value: number | null | undefined;
  /** Opcional: para actualizar inmediatamente la UI del padre (ej. row.original.quantity) */
  onLocalUpdate?: (newQty: number) => void;
  /** Callback para actualizaciÃ³n optimista inmediata */
  onOptimisticUpdate?: (newQty: number) => void;
  suppressToasts?: boolean;
  visibleSpan: boolean;
};

export const QuantityCell: React.FC<Props> = ({
  productId,
  listId,
  value,
  onLocalUpdate,
  onOptimisticUpdate,
  suppressToasts,
  visibleSpan
}) => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const current = Number(value ?? 0);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => String(current));

  useEffect(() => {
    if (isEditing) return;
    setDraft(String(current));
  }, [current, isEditing]);

  const handleCommit = async (raw: string) => {
    const newQty = Number(raw);
    if (Number.isNaN(newQty) || newQty === current) return;

    // 1. ActualizaciÃ³n optimista INMEDIATA
    onOptimisticUpdate?.(newQty);
    onLocalUpdate?.(newQty);

    // 2. Toast
    if (!suppressToasts) {
      toast.success(isOnline ? "Stock actualizado" : "Stock actualizado (se sincronizarÃ¡ al reconectar)" );
    }

    // 3. Backend en segundo plano
    queueMicrotask(async () => {
      try {
        const now = new Date().toISOString();

        if (isOnline) {
          const { error } = await supabase
            .from("dynamic_products_index")
            .update({ quantity: newQty, updated_at: now })
            .eq("product_id", productId);

          if (error) throw error;

          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const indexRecord = await localDB.dynamic_products_index
              .where({ product_id: productId, list_id: listId })
              .first();
            const stockThreshold = indexRecord?.stock_threshold ?? 0;

            const { error: myStockError } = await supabase
              .from("my_stock_products")
              .upsert(
                {
                  user_id: user.id,
                  product_id: productId,
                  quantity: newQty,
                  stock_threshold: stockThreshold,
                  created_at: now,
                  updated_at: now,
                },
                { onConflict: "user_id,product_id" },
              );

            if (myStockError) throw myStockError;
          }
        }

        await updateProductQuantityOffline(productId, listId, newQty, { enqueue: !isOnline });
        queryClient.invalidateQueries({ queryKey: ["global-search"] });
        queryClient.invalidateQueries({ queryKey: ["list-products", listId] });
        queryClient.invalidateQueries({ queryKey: ["my-stock"] });
      } catch (error: any) {
        console.error("Error al actualizar stock:", error);
        if (!suppressToasts) {
          toast.error(`Error al actualizar stock: ${error.message}`);
        }
      }
    });
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") {
      setDraft(String(current));
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <>
    <input
      type="number"
      className="h-8 w-20 lg-1160:w-16  bg-black border rounded px-2"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setIsEditing(true)}
      onBlur={(e) => {
        setIsEditing(false);
        void handleCommit(e.target.value);
      }}
      onKeyDown={onKeyDown}
    />
    
    </>
  );
};



