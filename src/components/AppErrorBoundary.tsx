import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  error?: unknown;
  errorInfo?: React.ErrorInfo;
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    stack: undefined,
  };
}

function shouldHardReload(error: unknown): boolean {
  const { message, stack } = serializeError(error);
  const combined = `${message}\n${stack ?? ""}`.toLowerCase();
  return (
    combined.includes("chunkloaderror") ||
    combined.includes("loading chunk") ||
    combined.includes("failed to fetch dynamically imported module") ||
    combined.includes("importing a module script failed")
  );
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => {
    this.capture(event.reason);
  };

  private readonly onWindowError = (event: ErrorEvent) => {
    this.capture(event.error ?? event.message);
  };

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo });
    this.persist(error, errorInfo);
  }

  componentDidMount() {
    window.addEventListener("unhandledrejection", this.onUnhandledRejection);
    window.addEventListener("error", this.onWindowError);
  }

  componentWillUnmount() {
    window.removeEventListener("unhandledrejection", this.onUnhandledRejection);
    window.removeEventListener("error", this.onWindowError);
  }

  private capture(error: unknown) {
    if (this.state.error) return;

    this.setState({ error });
    this.persist(error);

    if (shouldHardReload(error)) {
      const key = "app_error_boundary_hard_reload_v1";
      const alreadyReloaded = sessionStorage.getItem(key) === "1";
      if (!alreadyReloaded) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
    }
  }

  private persist(error: unknown, errorInfo?: React.ErrorInfo) {
    try {
      const entry = {
        at: new Date().toISOString(),
        url: window.location.href,
        ua: navigator.userAgent,
        error: serializeError(error),
        errorInfo,
      };
      localStorage.setItem("last_app_error_v1", JSON.stringify(entry));
    } catch {
      // ignore
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const err = serializeError(this.state.error);

    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-primary/20 bg-card/60 backdrop-blur p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Ocurrió un error</h1>
            <p className="text-sm text-muted-foreground">
              Si te pasa seguido en un dispositivo, copiá el detalle y pasámelo para corregirlo.
            </p>
          </div>

          <div className="rounded-md bg-muted/40 border border-primary/10 p-3 text-xs whitespace-pre-wrap break-words">
            {err.name}: {err.message}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-md border border-primary/30"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        at: new Date().toISOString(),
                        url: window.location.href,
                        ua: navigator.userAgent,
                        error: err,
                        errorInfo: this.state.errorInfo,
                      },
                      null,
                      2,
                    ),
                  );
                } catch {
                  // ignore
                }
              }}
            >
              Copiar detalle
            </button>
          </div>
        </div>
      </div>
    );
  }
}

