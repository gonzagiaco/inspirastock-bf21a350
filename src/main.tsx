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
    updateSW(true);
    window.location.reload();
  },
  onOfflineReady() {
    console.log("Aplicacion lista para funcionar offline");
  },
  immediate: false,
});

// Configurar handler offline
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


