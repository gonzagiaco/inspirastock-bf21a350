import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { useDeliveryClients } from "@/hooks/useDeliveryClients";

const { mockGetUser, supabaseTables } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  supabaseTables: {} as Record<string, any>,
}));

const { onlineStatusMock } = vi.hoisted(() => ({ onlineStatusMock: vi.fn() }));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: onlineStatusMock,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    from: (table: string) => {
      const handlers = supabaseTables[table] || {};
      const defaultEq = () => vi.fn().mockResolvedValue({ error: null });
      return {
        select: handlers.select || vi.fn().mockResolvedValue({ data: [], error: null }),
        insert:
          handlers.insert ||
          vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
        update: handlers.update || vi.fn().mockReturnValue({ eq: defaultEq() }),
        delete: handlers.delete || vi.fn().mockReturnValue({ eq: defaultEq() }),
        eq: handlers.eq || vi.fn().mockReturnThis(),
        order: handlers.order || vi.fn().mockReturnThis(),
        maybeSingle: handlers.maybeSingle || vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    },
  },
}));

const {
  mockCreateClientOffline,
  mockUpdateDeliveryNotesLocal,
  mockDetachClientLocal,
  mockUpdateClientOffline,
  mockDeleteClientOffline,
} = vi.hoisted(() => ({
  mockCreateClientOffline: vi.fn(),
  mockUpdateDeliveryNotesLocal: vi.fn(),
  mockDetachClientLocal: vi.fn(),
  mockUpdateClientOffline: vi.fn(),
  mockDeleteClientOffline: vi.fn(),
}));

vi.mock("@/lib/localDB", () => ({
  createClientOffline: mockCreateClientOffline,
  updateClientOffline: mockUpdateClientOffline,
  deleteClientOffline: mockDeleteClientOffline,
  updateDeliveryNotesForClientLocal: mockUpdateDeliveryNotesLocal,
  detachClientFromDeliveryNotesLocal: mockDetachClientLocal,
  localDB: { clients: { clear: vi.fn(), bulkAdd: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));

const setOnline = (online: boolean) => {
  onlineStatusMock.mockReturnValue(online);
};

const renderClientsHook = () => {
  const queryClient = new QueryClient();
  return renderHook(() => useDeliveryClients(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
};

describe("useDeliveryClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    supabaseTables["clients"] = {};
    supabaseTables["delivery_notes"] = {};
  });

  it("crea cliente en modo offline", async () => {
    setOnline(false);
    mockCreateClientOffline.mockResolvedValue({
      id: "offline-client-1",
      name: "Cli Offline",
      phone: null,
      address: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    });
    const { result } = renderClientsHook();

    await act(async () => {
      await result.current.createClient({ name: "Cli Offline", phone: null, address: null });
    });

    expect(mockCreateClientOffline).toHaveBeenCalledWith({
      name: "Cli Offline",
      phone: null,
      address: null,
    });
  });

  it("actualiza cliente online y propaga cambios a remitos", async () => {
    setOnline(true);
    const updateClients = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const updateNotes = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    supabaseTables["clients"].update = updateClients;
    supabaseTables["delivery_notes"].update = updateNotes;

    const { result } = renderClientsHook();

    await act(async () => {
      await result.current.updateClient({
        id: "client-55",
        name: "Nuevo Nombre",
        phone: "+5411111111",
        address: "Dir",
        createdAt: "",
        updatedAt: "",
      });
    });

    expect(updateClients).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Nuevo Nombre", phone: "+5411111111", address: "Dir" }),
    );
    expect(updateNotes).toHaveBeenCalledWith(
      expect.objectContaining({ customer_name: "Nuevo Nombre", customer_phone: "+5411111111" }),
    );
    expect(mockUpdateDeliveryNotesLocal).toHaveBeenCalledWith(
      "client-55",
      expect.objectContaining({ customer_name: "Nuevo Nombre" }),
      expect.objectContaining({ enqueue: false }),
    );
  });

  it("actualiza cliente offline", async () => {
    setOnline(false);
    const { result } = renderClientsHook();

    await act(async () => {
      await result.current.updateClient({
        id: "client-10",
        name: "Offline Edit",
        phone: null,
        address: "Dir",
        createdAt: "",
        updatedAt: "",
      });
    });

    expect(mockUpdateClientOffline).toHaveBeenCalledWith("client-10", {
      name: "Offline Edit",
      phone: null,
      address: "Dir",
    });
  });

  it("elimina cliente offline", async () => {
    setOnline(false);
    const { result } = renderClientsHook();

    await act(async () => {
      await result.current.deleteClient("client-11");
    });

    expect(mockDeleteClientOffline).toHaveBeenCalledWith("client-11");
  });
});
