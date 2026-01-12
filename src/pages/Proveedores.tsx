import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Building2, Warehouse } from "lucide-react";
import { Supplier } from "@/types";
import SupplierDialog from "@/components/SupplierDialog";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useProductListsIndex } from "@/hooks/useProductListsIndex";
import { SupplierBreadcrumbs } from "@/components/suppliers/SupplierBreadcrumbs";
import { SupplierListsView } from "@/components/suppliers/SupplierListsView";
import { ListConfigurationView } from "@/components/suppliers/ListConfigurationView";
import { OfflineActionDialog } from "@/components/OfflineActionDialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useNavigationBlock } from "@/hooks/useNavigationBlock";

type ViewState = 
  | { type: 'suppliers' }
  | { type: 'supplier-lists'; supplier: Supplier }
  | { type: 'list-config'; supplier: Supplier; listId: string; listName: string };

const Proveedores = () => {
  const [currentView, setCurrentView] = useState<ViewState>({ type: 'suppliers' });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [showOfflineWarning, setShowOfflineWarning] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const { suppliers, isLoading: isLoadingSuppliers, createSupplier, updateSupplier, deleteSupplier } = useSuppliers();
  const { data: lists = [] } = useProductListsIndex();
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const { setBlocked, clearBlock } = useNavigationBlock();

  // Trigger shake and warning when navigation is blocked
  const handleBlockedNavigation = useCallback(() => {
    setShowUnsavedWarning(true);
    setShakeKey(prev => prev + 1);
  }, []);

  // Register/unregister navigation block based on unsaved changes
  useEffect(() => {
    if (currentView.type === 'list-config' && hasUnsavedChanges) {
      setBlocked(true, handleBlockedNavigation);
    } else {
      setShowUnsavedWarning(false);
      clearBlock();
    }
    return () => clearBlock();
  }, [currentView.type, hasUnsavedChanges, setBlocked, clearBlock, handleBlockedNavigation]);

  const handleCreateSupplier = () => {
    setSelectedSupplier(null);
    setIsDialogOpen(true);
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (supplier: Supplier) => {
    setSupplierToDelete(supplier);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (supplierToDelete) {
      deleteSupplier(supplierToDelete.id);
      setSupplierToDelete(null);
    }
  };

  const handleSaveSupplier = async (supplier: Omit<Supplier, "id"> & { id?: string }) => {
    try {
      if (supplier.id) {
        await updateSupplier({ id: supplier.id, name: supplier.name, logo: supplier.logo });
      } else {
        await createSupplier({ name: supplier.name, logo: supplier.logo });
      }
      setIsDialogOpen(false);
      setSelectedSupplier(null);
    } catch (error) {
      console.error("Error saving supplier:", error);
    }
  };

  const handleViewSupplier = (supplier: Supplier) => {
    setCurrentView({ type: 'supplier-lists', supplier });
  };

  // If navigated with query params, open list config view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const listId = params.get('listId');
    const supplierId = params.get('supplierId');
    const listName = params.get('listName') || '';

    if (!listId || !supplierId) return;

    if (suppliers && suppliers.length > 0) {
      const sup = suppliers.find((s: any) => s.id === supplierId);
      if (sup) {
        setCurrentView({ type: 'list-config', supplier: sup, listId, listName });
      }
    }
  }, [location.search, suppliers]);

  const handleConfigureList = (listId: string, listName: string) => {
    // Block list configuration when offline
    if (!isOnline) {
      setShowOfflineWarning(true);
      return;
    }
    
    if (currentView.type === 'supplier-lists') {
      setCurrentView({ 
        type: 'list-config', 
        supplier: currentView.supplier, 
        listId, 
        listName 
      });
    }
  };

  const handleBack = () => {
    if (currentView.type === 'list-config') {
      // Navigation block is handled by the hook, this is only called when not blocked
      setCurrentView({ type: 'supplier-lists', supplier: currentView.supplier });
    } else if (currentView.type === 'supplier-lists') {
      setCurrentView({ type: 'suppliers' });
    }
  };

  const handleConfigSaved = () => {
    setHasUnsavedChanges(false);
    setShowUnsavedWarning(false);
    if (currentView.type === 'list-config') {
      setCurrentView({ type: 'supplier-lists', supplier: currentView.supplier });
    }
  };

  const handleResetChanges = () => {
    setHasUnsavedChanges(false);
    setShowUnsavedWarning(false);
  };

  const getProductCount = (supplierId: string) => {
    return lists
      .filter((list: any) => list.supplier_id === supplierId)
      .reduce((sum, list: any) => sum + (list.product_count || 0), 0);
  };

  const getBreadcrumbSteps = (): { label: string; onClick?: () => void }[] => {
    const steps: { label: string; onClick?: () => void }[] = [
      { label: 'Proveedores', onClick: () => setCurrentView({ type: 'suppliers' }) }
    ];
    
    if (currentView.type === 'supplier-lists' || currentView.type === 'list-config') {
      steps.push({ 
        label: currentView.supplier.name, 
        onClick: () => setCurrentView({ type: 'supplier-lists', supplier: currentView.supplier }) 
      });
    }
    
    if (currentView.type === 'list-config') {
      steps.push({ label: currentView.listName });
    }
    
    return steps;
  };

  // Render supplier grid view
  const renderSuppliersView = () => (
    <>
      <Header title="Proveedores" subtitle="Gestiona tus proveedores y sus productos." showSearch={false} icon={<Warehouse className="h-8 w-8" />} />

      <div className="mb-6 flex justify-end">
        <Button onClick={handleCreateSupplier} className="gap-2">
          <Plus className="w-4 h-4" />
          Nuevo Proveedor
        </Button>
      </div>

      {isLoadingSuppliers ? (
        <div className="glassmorphism rounded-xl shadow-lg p-12 text-center space-y-4">
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
          <p className="text-muted-foreground">Cargando proveedores...</p>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="glassmorphism rounded-xl shadow-lg p-12 text-center">
          <Building2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold text-foreground mb-2">No hay proveedores</h2>
          <p className="text-muted-foreground mb-6">Comienza agregando tu primer proveedor</p>
          <Button onClick={handleCreateSupplier} className="gap-2">
            <Plus className="w-4 h-4" />
            Agregar Proveedor
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {suppliers.map((supplier) => {
            const productCount = getProductCount(supplier.id);
            return (
              <Card
                key={supplier.id}
                className="glassmorphism border-primary/20 hover:border-primary/40 transition-all cursor-pointer"
                onClick={() => handleViewSupplier(supplier)}
              >
                <CardHeader>
                  <div className="flex items-center gap-4">
                    {supplier.logo ? (
                      <img src={supplier.logo} alt={supplier.name} className="w-16 h-16 rounded-lg object-cover" />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-primary" />
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground">{supplier.name}</h3>
                      <p className="text-sm text-muted-foreground">{productCount} productos</p>
                    </div>
                  </div>
                </CardHeader>
                <CardFooter className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditSupplier(supplier);
                    }}
                    className="flex-1 gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClick(supplier);
                    }}
                    className="flex-1 gap-2 border-red-500/20 text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="flex-1 w-full max-w-full overflow-hidden flex flex-col">
      <div className="p-4 pt-11 lg:px-4 lg:py-10 flex-1 flex flex-col">
        {currentView.type !== 'suppliers' && (
          <SupplierBreadcrumbs steps={getBreadcrumbSteps()} onBack={handleBack} />
        )}

        {currentView.type === 'suppliers' && renderSuppliersView()}

        {currentView.type === 'supplier-lists' && (
          <SupplierListsView
            supplierId={currentView.supplier.id}
            supplierName={currentView.supplier.name}
            onConfigureList={handleConfigureList}
          />
        )}

        {currentView.type === 'list-config' && (
          <div 
            key={shakeKey}
            className={`flex-1 flex flex-col glassmorphism rounded-xl overflow-hidden transition-colors duration-300 ${
              showUnsavedWarning 
                ? 'border-2 border-destructive animate-shake' 
                : 'border border-primary/20'
            }`}
          >
            <ListConfigurationView
              listId={currentView.listId}
              onSaved={handleConfigSaved}
              onHasUnsavedChanges={setHasUnsavedChanges}
              onReset={handleResetChanges}
              showWarning={showUnsavedWarning}
            />
          </div>
        )}

        <SupplierDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onSave={handleSaveSupplier}
          supplier={selectedSupplier}
        />

        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={handleDeleteConfirm}
          title="¿Eliminar proveedor?"
          description={`¿Estás seguro de que deseas eliminar a ${supplierToDelete?.name}? Esto también eliminará todos los productos asociados.`}
        />

        <OfflineActionDialog
          open={showOfflineWarning}
          onOpenChange={setShowOfflineWarning}
          title="Configuración no disponible offline"
          description="La configuración de listas requiere conexión a internet. Por favor, conéctate y vuelve a intentarlo."
        />
      </div>
    </div>
  );
};

export default Proveedores;
