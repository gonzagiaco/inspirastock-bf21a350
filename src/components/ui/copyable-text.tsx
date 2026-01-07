import { useState, useCallback, type ReactNode, type MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

interface CopyableTextProps {
  children: ReactNode;
  textToCopy?: string;
  className?: string;
}

export function CopyableText({ children, textToCopy, className }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      const text = textToCopy ?? (typeof children === "string" ? children : "");
      if (!text) return;

      try {
        await navigator.clipboard.writeText(String(text));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (error) {
        console.error("Error al copiar:", error);
      }
    },
    [textToCopy, children],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            onClick={handleCopy}
            className={cn("cursor-pointer hover:text-primary transition-colors", className)}
          >
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
