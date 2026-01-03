import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDeliveryNotes } from "@/hooks/useDeliveryNotes";

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
    auth: {
      getUser: (...args: any[]) => mockGetUser(...args),
    },
    from: (table: string) => {
      const handlers = supabaseTables[table] || {};
      const defaultEq = () => vi.fn().mockResolvedValue({ error: null });
      return {
        select: handlers.select || vi.fn().mockReturnThis(),
        order: handlers.order || vi.fn().mockResolvedValue({ data: [], error: null }),
        insert:
          handlers.insert ||
          vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        update: handlers.update || vi.fn().mockReturnValue({ eq: defaultEq() }),
        delete: handlers.delete || vi.fn().mockReturnValue({ eq: defaultEq() }),
        eq: handlers.eq || vi.fn().mockReturnThis(),
        maybeSingle: handlers.maybeSingle || vi.fn().mockResolvedValue({ data: null, error: null }),
        single: handlers.single || vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    },
  },
}));

const {
  mockCreateOffline,
  mockUpdateOffline,
  mockDeleteOffline,
  mockMarkPaidOffline,
  mockGetOfflineData,
  mockSyncNote,
  mockBulkAdjust,
  mockPrepareAdjustments,
  mockCalculateNet,
} = vi.hoisted(() => ({
  mockCreateOffline: vi.fn(),
  mockUpdateOffline: vi.fn(),
  mockDeleteOffline: vi.fn(),
  mockMarkPaidOffline: vi.fn(),
  mockGetOfflineData: vi.fn(),
  mockSyncNote: vi.fn(),
  mockBulkAdjust: vi.fn().mockResolvedValue({ processed: 0, success: 0 }),
  mockPrepareAdjustments: vi.fn().mockReturnValue([]),
  mockCalculateNet: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/localDB", () => ({
  createDeliveryNoteOffline: mockCreateOffline,
  updateDeliveryNoteOffline: mockUpdateOffline,
  deleteDeliveryNoteOffline: mockDeleteOffline,
  markDeliveryNoteAsPaidOffline: mockMarkPaidOffline,
  getOfflineData: mockGetOfflineData,
  syncDeliveryNoteById: mockSyncNote,
}));

vi.mock("@/services/bulkStockService", () => ({
  bulkAdjustStock: mockBulkAdjust,
  prepareDeliveryNoteAdjustments: mockPrepareAdjustments,
  calculateNetStockAdjustments: mockCalculateNet,
}));

const setOnline = (online: boolean) => {
  onlineStatusMock.mockReturnValue(online);
};

const renderUseDeliveryNotes = () => {
  const queryClient = new QueryClient();
  return renderHook(() => useDeliveryNotes(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
};

describe("useDeliveryNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    supabaseTables["delivery_notes"] = {};
    supabaseTables["delivery_note_items"] = {};
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("crea remito en modo offline incluyendo client_id y items", async () => {
    setOnline(false);
    mockCreateOffline.mockResolvedValue("offline-note-1");
    const items = [{ productId: "p1", productCode: "C1", productName: "Prod 1", quantity: 2, unitPrice: 10 }];

    const { result } = renderUseDeliveryNotes();
    await act(async () => {
      await result.current.createDeliveryNote({
        clientId: "client-1",
        customerName: "Juan",
        customerAddress: "Calle",
        customerPhone: "+5400000000",
        issueDate: "2024-01-01",
        paidAmount: 5,
        items,
      });
    });

    expect(mockCreateOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1",
        customer_name: "Juan",
        user_id: "user-1",
      }),
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "p1",
          product_code: "C1",
          quantity: 2,
          unit_price: 10,
        }),
      ]),
    );
  });

  it("invalida queries de stock/notes después de crear offline", async () => {
    setOnline(false);
    mockCreateOffline.mockResolvedValue("offline-note-2");
    mockPrepareAdjustments.mockReturnValue([{ productId: "p1", quantity: 1 }]);

    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const resetSpy = vi.spyOn(QueryClient.prototype, "resetQueries");

    const { result } = renderUseDeliveryNotes();
    await act(async () => {
      await result.current.createDeliveryNote({
        customerName: "Offline Cliente",
        issueDate: "2024-04-04",
        items: [{ productId: "p1", productCode: "C1", productName: "Prod 1", quantity: 1, unitPrice: 10 }],
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["delivery-notes"] });
    expect(resetSpy).toHaveBeenCalled();
  });

  it("crea remito online y descuenta stock usando bulk adjust", async () => {
    setOnline(true);
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "note-123" },
      error: null,
    });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const insertMock = vi.fn().mockReturnValue({ select: selectMock });
    const itemInsertMock = vi.fn().mockResolvedValue({ error: null });
    supabaseTables["delivery_notes"] = { insert: insertMock };
    supabaseTables["delivery_note_items"] = { insert: itemInsertMock };
    mockPrepareAdjustments.mockReturnValue([{ productId: "p1", quantity: 1 }]);

    const items = [{ productId: "p1", productCode: "C1", productName: "Prod 1", quantity: 1, unitPrice: 50 }];
    const { result } = renderUseDeliveryNotes();

    await act(async () => {
      await result.current.createDeliveryNote({
        clientId: "client-9",
        customerName: "Ana",
        customerPhone: "+5400000000",
        issueDate: "2024-02-02",
        items,
      });
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-9",
        customer_name: "Ana",
      }),
    );
    expect(itemInsertMock).toHaveBeenCalled();
    expect(mockBulkAdjust).toHaveBeenCalled();
  });

  it("invalida queries de stock/notes después de crear online", async () => {
    setOnline(true);
    const selectMock = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "note-1" }, error: null }) });
    supabaseTables["delivery_notes"] = { insert: vi.fn().mockReturnValue({ select: selectMock }) };
    supabaseTables["delivery_note_items"] = { insert: vi.fn().mockResolvedValue({ error: null }) };
    mockPrepareAdjustments.mockReturnValue([{ productId: "p1", quantity: 1 }]);

    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const resetSpy = vi.spyOn(QueryClient.prototype, "resetQueries");

    const { result } = renderUseDeliveryNotes();
    await act(async () => {
      await result.current.createDeliveryNote({
        customerName: "Ana",
        clientId: "cli-1",
        issueDate: "2024-03-03",
        items: [{ productId: "p1", productCode: "C1", productName: "Prod 1", quantity: 1, unitPrice: 10 }],
      });
    });

    expect(mockBulkAdjust).toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["delivery-notes"] });
  });

  it("actualiza remito offline incluyendo client_id", async () => {
    setOnline(false);
    const items = [{ productId: "p2", productCode: "X", productName: "X", quantity: 3, unitPrice: 20 }];

    const { result } = renderUseDeliveryNotes();

    await act(async () => {
      await result.current.updateDeliveryNote({
        id: "offline-note",
        clientId: "client-2",
        customerName: "Maria",
        customerAddress: "Dir",
        items,
      });
    });

    expect(mockUpdateOffline).toHaveBeenCalledWith(
      "offline-note",
      expect.objectContaining({
        client_id: "client-2",
        customer_name: "Maria",
      }),
      expect.any(Array),
    );
  });

  it("elimina remito offline", async () => {
    setOnline(false);
    const { result } = renderUseDeliveryNotes();

    await act(async () => {
      await result.current.deleteDeliveryNote("note-offline-delete");
    });

    expect(mockDeleteOffline).toHaveBeenCalledWith("note-offline-delete");
  });

  it("marca remito como pagado offline", async () => {
    setOnline(false);
    mockGetOfflineData.mockImplementation((table: string) => {
      if (table === "delivery_notes") {
        return Promise.resolve([
          {
            id: "note-offline-paid",
            total_amount: 100,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const { result } = renderUseDeliveryNotes();

    await act(async () => {
      await result.current.markAsPaid("note-offline-paid");
    });

    expect(mockMarkPaidOffline).toHaveBeenCalledWith("note-offline-paid", 100);
  });

  it("devuelve datos offline mapeados con clientId", async () => {
    setOnline(false);
    mockGetOfflineData.mockResolvedValueOnce([
      {
        id: "n1",
        user_id: "user-1",
        client_id: "client-5",
        customer_name: "Cliente 5",
        total_amount: 10,
        paid_amount: 0,
        remaining_balance: 10,
        status: "pending",
        issue_date: "2024-01-01",
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
      },
    ]);
    mockGetOfflineData.mockResolvedValueOnce([]);

    const { result } = renderUseDeliveryNotes();
    await waitFor(() => expect(result.current.deliveryNotes[0]?.clientId).toBe("client-5"));
    expect(result.current.deliveryNotes[0]?.customerName).toBe("Cliente 5");
  });
});
