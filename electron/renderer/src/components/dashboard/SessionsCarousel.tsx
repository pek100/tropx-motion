/**
 * SessionsCarousel - Horizontal carousel of session cards with navigation.
 */

import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { SessionCard, type SessionData } from "./SessionCard";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionsCarouselProps {
  sessions: SessionData[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onApiReady?: (api: CarouselApi) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function SessionsCarousel({
  sessions,
  selectedSessionId,
  onSelectSession,
  onApiReady,
  className,
}: SessionsCarouselProps) {
  // Sessions ordered chronologically (oldest first, newest last)
  const orderedSessions = sessions;

  // Carousel API state
  const handleApiReady = useCallback(
    (api: CarouselApi) => {
      if (!api) return;
      onApiReady?.(api);
    },
    [onApiReady]
  );

  if (sessions.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full p-8",
          "text-[var(--tropx-shadow)] text-sm",
          className
        )}
      >
        No sessions yet
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[var(--tropx-vibrant)]" />
          <h3 className="text-sm font-semibold text-[var(--tropx-text-main)]">
            Recent Sessions
          </h3>
        </div>
        {/* Navigation buttons */}
        <div className="flex gap-1.5">
          <CarouselPrevButton />
          <CarouselNextButton />
        </div>
      </div>

      {/* Carousel */}
      <Carousel
        opts={{
          align: "start",
          loop: false,
        }}
        setApi={handleApiReady}
        className="w-full overflow-visible"
      >
        <CarouselContent className="-ml-4 px-1 py-1">
          {orderedSessions.map((session, index) => (
            <CarouselItem
              key={session.sessionId}
              className="pl-4 basis-full sm:basis-1/2 lg:basis-1/3"
            >
              <SessionCard
                session={session}
                isActive={session.sessionId === selectedSessionId}
                isLatest={index === orderedSessions.length - 1}
                onClick={() => onSelectSession(session.sessionId)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}

/** Custom prev button using carousel context */
function CarouselPrevButton() {
  return (
    <button
      className={cn(
        "size-6 flex items-center justify-center rounded-full",
        "border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
        "text-[var(--tropx-shadow)]",
        "hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
        "transition-colors disabled:opacity-50",
        "carousel-prev"
      )}
      onClick={() => {
        const carousel = document.querySelector('[data-slot="carousel"]');
        const prevBtn = carousel?.querySelector('[data-slot="carousel-previous"]') as HTMLButtonElement | null;
        prevBtn?.click();
      }}
    >
      <ChevronLeft className="size-3.5" />
    </button>
  );
}

/** Custom next button using carousel context */
function CarouselNextButton() {
  return (
    <button
      className={cn(
        "size-6 flex items-center justify-center rounded-full",
        "border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
        "text-[var(--tropx-shadow)]",
        "hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
        "transition-colors disabled:opacity-50",
        "carousel-next"
      )}
      onClick={() => {
        const carousel = document.querySelector('[data-slot="carousel"]');
        const nextBtn = carousel?.querySelector('[data-slot="carousel-next"]') as HTMLButtonElement | null;
        nextBtn?.click();
      }}
    >
      <ChevronRight className="size-3.5" />
    </button>
  );
}

export default SessionsCarousel;
