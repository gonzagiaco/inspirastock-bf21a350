import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MyStockListProducts } from "./MyStockListProducts";

interface MyStockSupplierSectionProps {
  supplierName: string;
  supplierLogo: string | null;
  lists: Array<{
    listId: string;
    listName: string;
    mappingConfig: any;
    columnSchema: any[];
    products: any[];
  }>;
  onAddToRequest: (product: any, mappingConfig?: any) => void;
  onQuantityChange?: (productId: string, newQuantity: number) => void;
  onThresholdChange?: (productId: string, newThreshold: number) => void;
  onRemoveProduct?: (productId: string) => void;
  isMobile: boolean;
}

export function MyStockSupplierSection({
  supplierName,
  supplierLogo,
  lists,
  onAddToRequest,
  onQuantityChange,
  onThresholdChange,
  onRemoveProduct,
  isMobile,
}: MyStockSupplierSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const totalProducts = lists.reduce((sum, list) => sum + list.products.length, 0);

  return (
    <Card className="mb-6 w-full max-w-full overflow-hidden">
      <CardHeader className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {supplierLogo && <img src={supplierLogo} alt={supplierName} className="h-10 w-10 object-contain rounded" />}
            <div>
              <h2 className="text-xl font-semibold">{supplierName}</h2>
              <p className="text-sm text-muted-foreground">
                {lists.length} {lists.length === 1 ? "lista" : "listas"} • {totalProducts} productos
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon">
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6 w-full overflow-hidden">
          {lists.map((list) => (
            <Collapsible key={list.listId} defaultOpen={lists.length === 1}>
              <div className="border rounded-lg">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors overflow-hidden">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChevronDown className="h-4 w-4 shrink-0" />
                      <div className="text-left flex-1 min-w-0">
                        <h4 className="font-medium flex-1 truncate" title={list.listName}>
                          {list.listName}
                        </h4>
                        <p className="text-sm text-muted-foreground">{list.products.length} productos</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <MyStockListProducts
                    listId={list.listId}
                    products={list.products}
                    columnSchema={list.columnSchema}
                    mappingConfig={list.mappingConfig}
                    onAddToRequest={onAddToRequest}
                    onQuantityChange={onQuantityChange}
                    onThresholdChange={onThresholdChange}
                    onRemoveProduct={onRemoveProduct}
                    isMobile={isMobile}
                  />
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
