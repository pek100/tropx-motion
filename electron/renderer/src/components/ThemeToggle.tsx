/**
 * ThemeToggle - A button to toggle between light and dark mode.
 * Uses next-themes for theme management.
 */

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by only rendering after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 rounded-lg bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm hover:bg-gray-100 dark:hover:bg-zinc-600 hover:scale-105 transition-all shadow-sm dark:shadow-none border border-transparent dark:border-zinc-700"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="w-8 h-8 rounded-lg bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm hover:bg-gray-100 dark:hover:bg-zinc-600 hover:scale-105 transition-all shadow-sm dark:shadow-none border border-transparent dark:border-zinc-700"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isDark ? (
            <Sun className="size-4 text-[var(--tropx-text-main)]" />
          ) : (
            <Moon className="size-4 text-[var(--tropx-shadow)]" />
          )}
          <span className="sr-only">
            {isDark ? "Switch to light mode" : "Switch to dark mode"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isDark ? "Light mode" : "Dark mode"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default ThemeToggle;
