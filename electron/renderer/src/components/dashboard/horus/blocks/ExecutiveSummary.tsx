/**
 * ExecutiveSummary Block
 *
 * Markdown-like text block for overall analysis narrative.
 * Supports **bold**, *italic*, and basic formatting.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ExecutiveSummaryProps {
  title: string;
  content: string;
  className?: string;
}

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

export function ExecutiveSummary({ title, content, className }: ExecutiveSummaryProps) {
  // Split content into paragraphs
  const paragraphs = (content || "").split("\n\n").filter((p) => p.trim());

  return (
    <Card className={cn("py-4 gradient-coral-card border-none", className)}>
      <CardHeader className="pb-2 pt-0">
        <CardTitle className="text-base font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="text-sm text-[var(--tropx-text-main)]">
              {parseSimpleMarkdown(paragraph)}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
