/**
 * ExecutiveSummary Block
 *
 * Markdown-like text block for overall analysis narrative.
 * Enhanced with variant support for different visual contexts.
 * Supports **bold**, *italic*, and basic formatting.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SummaryVariant = "default" | "info" | "success" | "warning";

interface ExecutiveSummaryProps {
  title: string;
  content: string;
  /** Visual variant - affects gradient background */
  variant?: SummaryVariant;
  className?: string;
}

const variantStyles: Record<SummaryVariant, string> = {
  default: "gradient-coral-card border-none",
  info: "gradient-info-card border-none",
  success: "gradient-green-card border-none",
  warning: "gradient-amber-card border-none",
};

/**
 * Simple markdown-like parser for basic formatting.
 * Supports **bold** and *italic*.
 */
function parseSimpleMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Find **bold**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    // Find *italic*
    const italicMatch = remaining.match(/\*([^*]+)\*/);

    // Choose the earliest match
    const boldIndex = boldMatch ? remaining.indexOf(boldMatch[0]) : Infinity;
    const italicIndex = italicMatch ? remaining.indexOf(italicMatch[0]) : Infinity;

    if (boldIndex === Infinity && italicIndex === Infinity) {
      // No more matches, add remaining text
      parts.push(remaining);
      break;
    }

    if (boldIndex <= italicIndex && boldMatch) {
      // Add text before match
      if (boldIndex > 0) {
        parts.push(remaining.slice(0, boldIndex));
      }
      // Add bold text
      parts.push(
        <strong key={key++} className="text-primary font-semibold">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldIndex + boldMatch[0].length);
    } else if (italicMatch) {
      // Add text before match
      if (italicIndex > 0) {
        parts.push(remaining.slice(0, italicIndex));
      }
      // Add italic text
      parts.push(
        <em key={key++} className="text-muted-foreground">
          {italicMatch[1]}
        </em>
      );
      remaining = remaining.slice(italicIndex + italicMatch[0].length);
    }
  }

  return parts;
}

export function ExecutiveSummary({
  title,
  content,
  variant = "default",
  className,
}: ExecutiveSummaryProps) {
  // Split content into paragraphs
  const paragraphs = (content || "").split("\n\n").filter((p) => p.trim());

  return (
    <Card className={cn("py-2.5", variantStyles[variant], className)}>
      <CardHeader className="pb-1.5 pt-0">
        <CardTitle className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 px-4">
        <div className="space-y-1.5">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="text-xs leading-relaxed text-[var(--tropx-text-main)]">
              {parseSimpleMarkdown(paragraph)}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
