import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  createClientOffline,
  deleteClientOffline,
  detachClientFromDeliveryNotesLocal,
  getOfflineData,
  localDB,
  updateClientOffline,
  updateDeliveryNotesForClientLocal,
} from "@/lib/localDB";
import { DeliveryClient } from "@/types";

type DeliveryClientInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
};

const mapClient = (client: any): DeliveryClient => ({
  id: client.id,
  name: client.name,
  phone: client.phone || "",
  address: client.address || "",
  createdAt: client.created_at,
  updatedAt: client.updated_at,
});

export const useDeliveryClients = () => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["delivery-clients"],
    queryFn: async () => {
      if (!isOnline) {
        const offlineClients = (await getOfflineData("clients")) as any[];
        return offlineClients
          .map(mapClient)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data !== undefined) {
        await localDB.clients.clear();
        if (data.length > 0) {
          await localDB.clients.bulkAdd(data as any[]);
        }
      }

      return (data || []).map(mapClient);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input: DeliveryClientInput) => {
      if (!isOnline) {
        const created = await createClientOffline(input);
        return mapClient(created);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuario no autenticado");

      const { data, error } = await supabase
        .from("clients")
        .insert({
          user_id: user.id,
          name: input.name,
          phone: input.phone ?? null,
          address: input.address ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error("No se pudo crear el cliente");

      await localDB.clients.put(data as any);
      return mapClient(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-clients"] });
      toast.success("Cliente guardado correctamente");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al guardar cliente");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (client: DeliveryClient) => {
      const payload = {
        name: client.name,
        phone: client.phone ?? null,
        address: client.address ?? null,
      };

      if (!isOnline) {
        await updateClientOffline(client.id, payload);
        return;
      }

      const now = new Date().toISOString();
      const { error } = await supabase.from("clients").update({ ...payload, updated_at: now }).eq("id", client.id);
      if (error) throw error;

      const { error: notesError } = await supabase
        .from("delivery_notes")
        .update({
          customer_name: payload.name,
          customer_phone: payload.phone ?? null,
          customer_address: payload.address ?? null,
          updated_at: now,
        })
        .eq("client_id", client.id);

      if (notesError) throw notesError;

      await localDB.clients.update(client.id, { ...payload, updated_at: now });
      await updateDeliveryNotesForClientLocal(
        client.id,
        {
          customer_name: payload.name,
          customer_phone: payload.phone ?? null,
          customer_address: payload.address ?? null,
        },
        { enqueue: false },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-clients"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      toast.success("Cliente actualizado correctamente");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al actualizar cliente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (clientId: string) => {
      if (!isOnline) {
        await deleteClientOffline(clientId);
        return;
      }

      const { error } = await supabase.from("clients").delete().eq("id", clientId);
      if (error) throw error;

      await localDB.clients.delete(clientId);
      await detachClientFromDeliveryNotesLocal(clientId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-clients"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
      toast.success("Cliente eliminado correctamente");
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al eliminar cliente");
    },
  });

  return {
    clients,
    isLoading,
    createClient: createMutation.mutateAsync,
    updateClient: updateMutation.mutateAsync,
    deleteClient: deleteMutation.mutateAsync,
  };
};
