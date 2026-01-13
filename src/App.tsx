import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "./components/ProtectedRoute";
import CollapsibleSidebar from "./components/CollapsibleSidebar";
import { ConnectionBadge } from "./components/ConnectionBadge";
import AutoAddLowStockToCart from "./components/AutoAddLowStockToCart";
import SyncProgressBar from "./components/SyncProgressBar";

import Stock from "./pages/Stock";
import MiStock from "./pages/MiStock";
import Proveedores from "./pages/Proveedores";
import Remitos from "./pages/Remitos";
import Ayuda from "./pages/Ayuda";
import Configuracion from "./pages/Configuracion";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ConnectionBadge />
        <SyncProgressBar />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <MiStock />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/listas"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <Stock />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/remitos"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <Remitos />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/proveedores"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <Proveedores />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/ayuda"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <Ayuda />
                  </div>
                </ProtectedRoute>
              }
            />
            <Route
              path="/config"
              element={
                <ProtectedRoute>
                  <div className="flex min-h-screen w-full safe-top">
                    <CollapsibleSidebar />
                    <AutoAddLowStockToCart />
                    <Configuracion />
                  </div>
                </ProtectedRoute>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
