import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";



const {
  mockCreateDeliveryNote,
  mockUpdateDeliveryNote,
  mockCreateClient,
  mockToastError,
  mockToastSuccess,
  mockToastWarning,
  mockClients,
} = vi.hoisted(() => ({
  mockCreateDeliveryNote: vi.fn(),
  mockUpdateDeliveryNote: vi.fn(),
  mockCreateClient: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastWarning: vi.fn(),
  mockClients: [{ id: "cli-1", name: "Cliente Existente", phone: "+5400000000", address: "Dir 1" }],
}));

vi.mock("@/hooks/useDeliveryNotes", () => ({
  useDeliveryNotes: () => ({
    createDeliveryNote: mockCreateDeliveryNote,
    updateDeliveryNote: mockUpdateDeliveryNote,
    deliveryNotes: [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useDeliveryClients", () => ({
  useDeliveryClients: () => ({
    clients: mockClients,
    createClient: mockCreateClient,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/hooks/useProductLists", () => ({
  useProductLists: () => ({ productLists: [] }),
}));

vi.mock("@/components/DeliveryNoteProductSearch", () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (p: any) => void }) => (
    <button onClick={() => onSelect({ id: "p1", code: "C1", name: "Prod 1", price: 10 })} aria-label="agregar-producto">
      Agregar producto mock
    </button>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { quantity: 0 }, error: null }) }) }),
    }),
  },
}));

const { stockStore } = vi.hoisted(() => ({ stockStore: { available: 5 } }));

vi.mock("@/lib/localDB", () => ({
  localDB: {
    dynamic_products_index: {
      where: () => ({
        equals: () => ({
          first: () => Promise.resolve({ quantity: stockStore.available }),
        }),
      }),
    },
    dynamic_products: { get: () => Promise.resolve(null) },
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: mockToastError,
    success: mockToastSuccess,
    warning: mockToastWarning,
  }),
}));

import DeliveryNoteDialog from "@/components/DeliveryNoteDialog";

describe("DeliveryNoteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      id: "client-1",
      name: "Cliente Nuevo",
      phone: null,
      address: null,
    });
  });

  it("debería crear el remito una sola vez al crear un cliente nuevo", async () => {
    render(<DeliveryNoteDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Nombre del Cliente/i), { target: { value: "Cliente Nuevo" } });
    fireEvent.click(screen.getByLabelText("agregar-producto"));

    fireEvent.click(screen.getByRole("button", { name: /Crear Remito/i }));

    await waitFor(() => expect(mockCreateDeliveryNote).toHaveBeenCalled());

    expect(mockCreateDeliveryNote).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it("debería usar cliente existente y no duplicar el remito", async () => {
    render(<DeliveryNoteDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByText(/Existente/i));
    const search = screen.getByPlaceholderText(/Buscar cliente/i);
    fireEvent.change(search, { target: { value: "Clie" } });
    await waitFor(() => expect(screen.getByText("Cliente Existente")).toBeTruthy());
    fireEvent.click(screen.getByText("Cliente Existente"));
    fireEvent.click(screen.getByLabelText("agregar-producto"));

    fireEvent.click(screen.getByRole("button", { name: /Crear Remito/i }));

    await waitFor(() => expect(mockCreateDeliveryNote).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).not.toHaveBeenCalled();
    const payload = mockCreateDeliveryNote.mock.calls[0][0];
    expect(payload.clientId).toBe("cli-1");
  });

  it("no permite agregar más productos que el stock disponible y muestra mensaje", async () => {
    stockStore.available = 1;
    render(<DeliveryNoteDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Nombre del Cliente/i), { target: { value: "Cliente Stock" } });
    fireEvent.click(screen.getByLabelText("agregar-producto")); // primera unidad
    fireEvent.click(screen.getByLabelText("agregar-producto")); // intenta segunda

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(screen.getAllByText(/Prod 1/).length).toBe(1);
  });
});
