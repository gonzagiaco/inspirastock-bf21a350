import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from 'virtual:pwa-register';
import { setupOfflineHandler } from './utils/offlineHandler';
import { initDB, cleanupOldOperations } from './lib/localDB';
import { AppErrorBoundary } from "./components/AppErrorBoundary";

// Registrar Service Worker
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('Nueva versión disponible - Actualizando...');
  },
  onOfflineReady() {
    console.log('Aplicación lista para funcionar offline');
  },
  immediate: true
});

// Configurar handler de offline para recarga automática
setupOfflineHandler();

// Inicializar DB y limpiar operaciones obsoletas
initDB().then(() => {
  cleanupOldOperations();
});

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
