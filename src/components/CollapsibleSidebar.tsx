import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  NotebookText,
  Users,
  Warehouse,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CircleHelp,
  Package,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { isOnline, localDB } from "@/lib/localDB";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNavigationBlock } from "@/hooks/useNavigationBlock";

const ARG_TIMEZONE = "America/Argentina/Buenos_Aires";

const formatArgentinaDateTime = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: ARG_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = getPart("day");
  const month = getPart("month");
  const year = getPart("year");
  const hour = getPart("hour");
  const minute = getPart("minute");
  if (!day || !month || !year || !hour || !minute) return null;
  return `${day}/${month}/${year} ${hour}:${minute}`;
};

const getArgentinaDate = (base: Date) =>
  new Date(base.toLocaleString("en-US", { timeZone: ARG_TIMEZONE }));

const getNextArgentinaUpdate = (base: Date) => {
  const argentinaNow = getArgentinaDate(base);
  const nextArgentina = new Date(argentinaNow);
  nextArgentina.setHours(10, 0, 0, 0);
  if (argentinaNow.getTime() >= nextArgentina.getTime()) {
    nextArgentina.setDate(nextArgentina.getDate() + 1);
  }
  const offsetMs = base.getTime() - argentinaNow.getTime();
  return new Date(nextArgentina.getTime() + offsetMs);
};

const CollapsibleSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [dollarRate, setDollarRate] = useState<number | null>(null);
  const [dollarUpdatedAt, setDollarUpdatedAt] = useState<string | null>(null);
  const [isRefreshingDollar, setIsRefreshingDollar] = useState(false);
  const { user, signOut } = useAuth();
  const refreshInFlightRef = useRef(false);
  const { triggerBlockedNavigation } = useNavigationBlock();

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(" ");
      return names.length > 1
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : names[0][0].toUpperCase();
    }
    return user?.email?.[0].toUpperCase() || "U";
  };

  const navigation = [
    { name: "Mi Stock", href: "/", icon: Package },
    { name: "Listas", href: "/listas", icon: NotebookText },
    { name: "Proveedores", href: "/proveedores", icon: Warehouse },
    { name: "Remitos", href: "/remitos", icon: Receipt },
    { name: "Ayuda", href: "/ayuda", icon: CircleHelp },
    { name: "Configuración", href: "/config", icon: Settings },
  ];

  const isActive = (path: string) => location.pathname === path;

  const applyDollarSetting = useCallback(
    (value: any, updatedAt?: string | null) => {
      const rate = Number(value?.rate ?? value?.venta ?? 0);
      setDollarRate(Number.isFinite(rate) && rate > 0 ? rate : null);
      const resolvedUpdatedAt =
        updatedAt ?? value?.updatedAt ?? value?.fechaActualizacion ?? null;
      setDollarUpdatedAt(resolvedUpdatedAt);
    },
    [],
  );

  useEffect(() => {
    // Si se expande el sidebar, cerramos el panel de logout flotante
    if (!isCollapsed) {
      setShowLogout(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    let isActive = true;

    const loadDollarSetting = async () => {
      try {
        const cached = await localDB.settings.get("dollar_official");
        if (cached?.value && isActive) {
          applyDollarSetting(cached.value, cached.updated_at);
        }

        if (!isOnline()) return;
        const { data, error } = await supabase
          .from("settings")
          .select("value, updated_at, created_at")
          .eq("key", "dollar_official")
          .maybeSingle();
        if (error) throw error;
        if (!data?.value || !isActive) return;

        applyDollarSetting(data.value, data.updated_at);
        await localDB.settings.put({
          key: "dollar_official",
          value: data.value,
          updated_at: data.updated_at ?? new Date().toISOString(),
          created_at: data.created_at ?? new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error cargando dolar oficial:", error);
      }
    };

    void loadDollarSetting();
    return () => {
      isActive = false;
    };
  }, [applyDollarSetting]);

  const handleRefreshDollar = async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!isOnline()) {
      refreshInFlightRef.current = false;
      toast.error("Sin conexión. No se puede actualizar el dólar.");
      return;
    }

    setIsRefreshingDollar(true);
    try {
      const { data, error } =
        await supabase.functions.invoke("update-dollar-rate");
      if (error) throw error;
      if (!data?.success || !data?.data) {
        throw new Error("No se pudo actualizar el dólar oficial");
      }

      const now = new Date().toISOString();
      applyDollarSetting(data.data, now);
      await localDB.settings.put({
        key: "dollar_official",
        value: data.data,
        updated_at: now,
        created_at: now,
      });
      const rate = Number(data.data.rate ?? data.data.venta ?? 0);
      const rateLabel =
        Number.isFinite(rate) && rate > 0 ? rate.toFixed(2) : "--";
      toast.success(`Dólar actualizado: $${rateLabel}`);
    } catch (error: any) {
      console.error("Error actualizando dólar oficial:", error);
      toast.error(error?.message || "Error al actualizar el dólar");
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshingDollar(false);
    }
  };

  const refreshDollarSilent = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    if (!isOnline()) return;

    refreshInFlightRef.current = true;
    try {
      const { data, error } =
        await supabase.functions.invoke("update-dollar-rate");
      if (error) throw error;
      if (!data?.success || !data?.data) {
        throw new Error("No se pudo actualizar el dólar oficial");
      }

      const now = new Date().toISOString();
      applyDollarSetting(data.data, now);
      await localDB.settings.put({
        key: "dollar_official",
        value: data.data,
        updated_at: now,
        created_at: now,
      });
    } catch (error) {
      console.error("Error actualizando dólar oficial:", error);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [applyDollarSetting]);

  useEffect(() => {
    let timerId: number | null = null;
    let cancelled = false;

    const scheduleNext = () => {
      const now = new Date();
      const nextUpdate = getNextArgentinaUpdate(now);
      let delay = nextUpdate.getTime() - now.getTime();
      if (!Number.isFinite(delay) || delay < 0) {
        delay = 60 * 1000;
      }
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        await refreshDollarSilent();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
    };
  }, [refreshDollarSilent]);

  const formattedDollarUpdatedAt = formatArgentinaDateTime(dollarUpdatedAt);
  const displayDollarUpdatedAt =
    formattedDollarUpdatedAt ?? dollarUpdatedAt ?? null;

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="lg:hidden fixed z-50 p-2 rounded-lg glassmorphism"
        style={{
          top: "max(env(safe-area-inset-top), 1rem)",
          right: "1rem",
        }}
      >
        {isMobileOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <style>{`
        @media (max-width: 1023px) {
          .compact-on-mobile nav a {
            padding: 10px 12px !important;
            gap: 0.6rem !important;
            border-radius: 0.625rem !important;
          }
          .compact-on-mobile nav a span {
            font-size: 15px !important;
          }
          .compact-on-mobile nav a > div {
            padding: 7px !important;
          }
          .compact-on-mobile nav a svg {
            width: 18px !important;
            height: 18px !important;
          }
          .compact-on-mobile nav {
            gap: 0.6rem !important;
            margin-bottom: 0.75rem !important;
          }
        }
        @media (min-width: 320px) and (max-width: 375px) {
          .compact-on-mobile nav a {
            padding: 8px 10px !important;
            gap: 0.55rem !important;
          }
          .compact-on-mobile nav a span {
            font-size: 14px !important;
          }
          .compact-on-mobile nav a > div {
            padding: 6px !important;
          }
          .compact-on-mobile nav a svg {
            width: 16px !important;
            height: 16px !important;
          }
        }
      `}</style>

      <aside
        className={`
          fixed lg:sticky top-0 lg:safe-top-fixed right-0 lg:left-0 lg:right-auto min-h-[100dvh] lg:h-screen bg-background/70 backdrop-blur-xl border-l lg:border-r border-primary/20 
          flex flex-col p-4 lg:p-6 z-40 transition-all duration-300
          ${isMobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}
          ${isCollapsed ? "lg:w-32" : "w-60 lg:w-64"}
          compact-on-mobile
        `}
        style={{
          paddingTop: "max(env(safe-area-inset-top), 1rem)",
          paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        }}
      >
        {/* Desktop Collapse Toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3 top-8 p-1.5 rounded-full glassmorphism hover:bg-primary/20 transition-colors z-40"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-primary" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-primary" />
          )}
        </button>

        {/* Logo */}
        <div
          className={`flex items-center mt-6 lg:mt-10 mb-3 lg:mb-5 from-1024:mt-0 ${isCollapsed ? "justify-center" : "gap-2 lg:gap-3"}`}
        >
          <div className="w-10 h-10 lg:w-14 lg:h-14 text-primary flex-shrink-0">
            <img src="LogoTransparente.png" alt="" />
          </div>
          {!isCollapsed && (
            <h1 className="text-lg lg:text-xl font-bold text-foreground whitespace-nowrap">
              InspiraStock
            </h1>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 lg:space-y-4">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            const handleNavClick = (e: React.MouseEvent) => {
              e.preventDefault();
              if (triggerBlockedNavigation()) {
                // Navigation was blocked, don't navigate
                return;
              }
              setIsMobileOpen(false);
              navigate(item.href);
            };

            return (
              <a
                key={item.name}
                href={item.href}
                onClick={handleNavClick}
                className={`
                  flex items-center rounded-xl cursor-pointer
                  ${isCollapsed ? "justify-center p-3" : "gap-3 px-4 py-3"}
                  ${active ? "glassmorphism shadow-lg text-foreground" : "text-foreground"}
                `}
                title={isCollapsed ? item.name : undefined}
              >
                <div
                  className={`p-2 rounded-lg backdrop-blur-sm ${active ? "bg-primary/30" : "bg-primary/20"}`}
                >
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                {!isCollapsed && (
                  <span className="font-medium text-lg">{item.name}</span>
                )}
              </a>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className={`mt-auto ${isCollapsed ? "space-y-2" : "space-y-4"}`}>
          {isCollapsed ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="glassmorphism rounded-xl p-2">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handleRefreshDollar}
                        disabled={isRefreshingDollar}
                        className="rounded-md p-1 hover:bg-primary/10 disabled:opacity-60"
                        aria-label="Actualizar dólar oficial"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${isRefreshingDollar ? "animate-spin" : ""}`}
                        />
                      </button>
                    </div>
                    <div className="mt-1 text-center text-xs font-semibold">
                      {dollarRate ? (
                        <span className="text-foreground">
                          ${dollarRate.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>
                    Dólar oficial: ${dollarRate?.toFixed(2) ?? "--"}
                    {displayDollarUpdatedAt &&
                      ` (Actualizado: ${displayDollarUpdatedAt})`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="glassmorphism rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Dólar oficial
                </span>
                <button
                  type="button"
                  onClick={handleRefreshDollar}
                  disabled={isRefreshingDollar}
                  className="rounded-md p-1 hover:bg-primary/10 disabled:opacity-60"
                  aria-label="Actualizar dólar oficial"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isRefreshingDollar ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                {dollarRate ? (
                  <span className="text-lg font-semibold text-foreground">
                    ${dollarRate.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No disponible
                  </span>
                )}
                {displayDollarUpdatedAt && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] text-muted-foreground truncate cursor-help">
                          {displayDollarUpdatedAt}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>Actualizado: {displayDollarUpdatedAt}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          )}
          <div
            className={`glassmorphism rounded-xl ${isCollapsed ? "p-2" : "p-4 lg:p-4 p-3"}`}
          >
            {isCollapsed ? (
              <div className="relative">
                {/* Avatar centrado y clickeable */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowLogout((prev) => !prev)}
                    className="rounded-full focus:outline-none"
                  >
                    <Avatar className="w-12 h-12 cursor-pointer">
                      <AvatarFallback className="bg-primary/20 text-primary text-xs">
                        {getUserInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </div>

                {/* Panel flotante de logout arriba del Avatar */}
                {showLogout && (
                  <div className="absolute inset-x-16 -top-3 translate-y-[-100%] flex justify-center">
                    <button
                      type="button"
                      onClick={signOut}
                      className="glassmorphism rounded-xl px-4 py-4 flex items-center gap-2 text-xs shadow-lg min-w-[150px] justify-center"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Cerrar sesión</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 lg:gap-3 mb-2 lg:mb-3">
                  <Avatar className="h-8 w-8 lg:h-10 lg:w-10">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs lg:text-sm">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs lg:text-sm font-medium text-foreground truncate">
                      {user?.user_metadata?.full_name || user?.email}
                    </p>
                    <p className="text-[10px] lg:text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs lg:text-sm h-8 lg:h-9"
                  onClick={signOut}
                >
                  <LogOut className="h-3 w-3 lg:h-4 lg:w-4 mr-1 lg:mr-2" />
                  Cerrar Sesión
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default CollapsibleSidebar;
