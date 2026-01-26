import { Search, X } from "lucide-react";
import { ReactNode, useState } from "react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  showSearch?: boolean;
  icon?: ReactNode;
  actions?: ReactNode;
}

const Header = ({ title, subtitle, showSearch = true, icon, actions }: HeaderProps) => {
  const [searchValue, setSearchValue] = useState("");

  return (
    <header className="mb-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {icon && <div className="text-primary">{icon}</div>}
            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          </div>
          {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
        </div>

        {(showSearch || actions) && (
          <div className="flex items-center gap-3 flex-1 justify-end">
            {showSearch && (
              <div className="relative flex-1 max-w-lg">
                <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </div>
                <input
                  className="w-full rounded-lg border-transparent bg-muted/50 backdrop-blur-sm py-3 pl-12 pr-12 text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-300 shadow-sm"
                  placeholder="Buscar por codigo, nombre..."
                  type="text"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                />
                {searchValue.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearchValue("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7588eb]"
                    aria-label="Limpiar busqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
