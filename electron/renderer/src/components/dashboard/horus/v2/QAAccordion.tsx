/**
 * QAAccordion Component
 *
 * Expandable accordion for Q&A clinical reasoning pairs.
 * Shows the AI's thought process in analyzing findings.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";

export interface QAReasoning {
  question: string;
  answer: string;
}

interface QAAccordionProps {
  items: QAReasoning[];
  defaultOpenIndex?: number;
  className?: string;
}

export function QAAccordion({
  items,
  defaultOpenIndex,
  className,
}: QAAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex ?? null);

  if (items.length === 0) {
    return null;
  }

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className={cn("space-y-1", className)} role="list">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const itemId = `qa-item-${index}`;
        const contentId = `qa-content-${index}`;

        return (
          <div
            key={index}
            role="listitem"
            className="rounded-lg border border-[var(--tropx-border)] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleItem(index)}
              className={cn(
                "w-full flex items-start gap-2 p-2 text-left transition-colors",
                "hover:bg-[var(--tropx-muted)]",
                isOpen && "bg-[var(--tropx-muted)]"
              )}
              aria-expanded={isOpen}
              aria-controls={contentId}
              id={itemId}
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--tropx-text-sub)] transition-transform",
                  isOpen && "rotate-90"
                )}
                aria-hidden="true"
              />
              <MessageCircleQuestion
                className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--tropx-info-text)]"
                aria-hidden="true"
              />
              <span className="flex-1 text-xs font-medium text-[var(--tropx-text-main)] leading-relaxed">
                {item.question}
              </span>
            </button>

            {isOpen && (
              <div
                id={contentId}
                role="region"
                aria-labelledby={itemId}
                className="px-2 pb-2"
              >
                <div className="pl-10 pt-1">
                  <p className="text-xs leading-relaxed text-[var(--tropx-text-sub)]">
                    {item.answer}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
