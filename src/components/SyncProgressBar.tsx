import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { SYNC_PROGRESS_EVENT, type SyncProgressDetail } from "@/lib/localDB";

const SyncProgressBar = () => {
  const [syncProgress, setSyncProgress] = useState({
    active: false,
    percent: 0,
    total: 0,
    completed: 0,
  });
  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSyncProgress = (event: Event) => {
      const detail = (event as CustomEvent<SyncProgressDetail>).detail;
      if (!detail) return;

      if (hideTimeoutRef.current != null) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      if (detail.status === "complete") {
        setSyncProgress({
          active: true,
          percent: detail.percent,
          total: detail.total,
          completed: detail.completed,
        });
        hideTimeoutRef.current = window.setTimeout(() => {
          setSyncProgress((prev) => ({ ...prev, active: false }));
          hideTimeoutRef.current = null;
        }, 600);
        return;
      }

      setSyncProgress({
        active: true,
        percent: detail.percent,
        total: detail.total,
        completed: detail.completed,
      });
    };

    window.addEventListener(SYNC_PROGRESS_EVENT, handleSyncProgress as EventListener);
    return () => {
      if (hideTimeoutRef.current != null) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      window.removeEventListener(SYNC_PROGRESS_EVENT, handleSyncProgress as EventListener);
    };
  }, []);

  if (!syncProgress.active) return null;

  return (
    <div className="fixed left-1/2 top-4 z-50 w-[min(560px,calc(100%-2rem))] -translate-x-1/2">
      <div className="rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Sincronizando operaciones</span>
          </div>
          <span className="text-xs font-semibold text-primary">{syncProgress.percent}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${syncProgress.percent}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default SyncProgressBar;
