import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigationBlock } from "@/hooks/useNavigationBlock";

interface BreadcrumbStep {
  label: string;
  onClick?: () => void;
}

interface SupplierBreadcrumbsProps {
  steps: BreadcrumbStep[];
  onBack: () => void;
}

export function SupplierBreadcrumbs({ steps, onBack }: SupplierBreadcrumbsProps) {
  const isMobile = useIsMobile();
  const { triggerBlockedNavigation } = useNavigationBlock();

  const handleBack = () => {
    if (triggerBlockedNavigation()) return;
    onBack();
  };

  const handleStepClick = (step: BreadcrumbStep) => {
    if (triggerBlockedNavigation()) return;
    step.onClick?.();
  };

  if (steps.length === 0) return null;

  // Mobile: show back button + current title only
  if (isMobile) {
    const currentStep = steps[steps.length - 1];
    return (
      <div className="flex items-center gap-3 mb-4">
        {steps.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="shrink-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <h1 className="text-xl font-semibold text-foreground truncate">
          {currentStep.label}
        </h1>
      </div>
    );
  }

  // Desktop: full breadcrumb navigation
  return (
    <div className="flex items-center gap-4 mb-6">
      {steps.length > 1 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          className="shrink-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      <Breadcrumb>
        <BreadcrumbList>
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            return (
              <BreadcrumbItem key={index}>
                {isLast ? (
                  <BreadcrumbPage className="font-semibold text-foreground">
                    {step.label}
                  </BreadcrumbPage>
                ) : (
                  <>
                    <BreadcrumbLink
                      onClick={() => handleStepClick(step)}
                      className="cursor-pointer hover:text-foreground transition-colors"
                    >
                      {step.label}
                    </BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </>
                )}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
