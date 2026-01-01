/**
 * NextSteps Block
 *
 * Collapsible list of recommended actions.
 * Uses TropX theme tokens for consistent styling.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Circle, CircleDot } from "lucide-react";

interface NextStepsItem {
  text: string;
  priority?: "high" | "medium" | "low";
}

interface NextStepsProps {
  title?: string;
  items: NextStepsItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
}

const priorityStyles = {
  high: {
    icon: "text-[var(--tropx-vibrant)]",
    text: "font-medium text-[var(--tropx-text-main)]",
    bullet: CircleDot,
  },
  medium: {
    icon: "text-[var(--tropx-warning-text)]",
    text: "text-[var(--tropx-text-main)]",
    bullet: Circle,
  },
  low: {
    icon: "text-[var(--tropx-text-sub)]",
    text: "text-[var(--tropx-text-sub)]",
    bullet: Circle,
  },
};

export function NextSteps({
  title = "Next Steps",
  items,
  collapsible = true,
  defaultCollapsed = false,
  className,
}: NextStepsProps) {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);

  const content = (
    <ol className="space-y-1.5">
      {items.map((item, index) => {
        const priority = item.priority || "medium";
        const styles = priorityStyles[priority];
        const BulletIcon = styles.bullet;

        return (
          <li key={index} className="flex items-start gap-1.5">
            <span className="flex-shrink-0 mt-0.5">
              <BulletIcon className={cn("h-3 w-3", styles.icon)} />
            </span>
            <span className={cn("text-xs leading-relaxed", styles.text)}>{item.text}</span>
          </li>
        );
      })}
    </ol>
  );

  if (!collapsible) {
    return (
      <Card className={cn("py-2.5 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)}>
        <CardHeader className="pb-1.5 pt-0 px-3">
          <CardTitle className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-3">{content}</CardContent>
      </Card>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <Card className="py-0 bg-[var(--tropx-card)] border-[var(--tropx-border)]">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-2 px-3 cursor-pointer hover:bg-[var(--tropx-hover)] transition-colors rounded-t-xl">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-[var(--tropx-text-sub)] transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-2.5 px-3">{content}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
