import { useState, useCallback, useEffect, useRef, type ReactNode, type MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

interface CopyableTextProps {
  children: ReactNode;
  textToCopy?: string;
  className?: string;
}

export function CopyableText({ children, textToCopy, className }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const forceTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (copiedTimerRef.current != null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    if (forceTimerRef.current != null) {
      window.clearTimeout(forceTimerRef.current);
      forceTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const handleCopy = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      const text = textToCopy ?? (typeof children === "string" ? children : "");
      if (!text) return;

      try {
        await navigator.clipboard.writeText(String(text));
        clearTimers();
        setCopied(true);
        setForceOpen(true);

        forceTimerRef.current = window.setTimeout(() => {
          setForceOpen(false);
        }, 1000);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopied(false);
        }, 1600);
      } catch (error) {
        console.error("Error al copiar:", error);
      }
    },
    [textToCopy, children],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={forceOpen || undefined}>
        <TooltipTrigger asChild>
          <span onClick={handleCopy} className={cn("cursor-pointer hover:text-primary transition-colors", className)}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{copied ? "¡Copiado!" : "Copiar"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
