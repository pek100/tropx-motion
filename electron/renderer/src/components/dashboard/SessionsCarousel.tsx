/**
 * SessionsCarousel - Horizontal carousel of session cards with navigation.
 */

import * as React from "react";
import { useCallback, useState, useRef } from "react";
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
  /** Callback to trigger metrics recomputation for selected session */
  onRecomputeMetrics?: () => void;
  /** Whether recomputation is in progress */
  isRecomputing?: boolean;
  /** Callback when edit button is clicked on a session */
  onEditSession?: (sessionId: string) => void;
  /** Callback when delete button is clicked on a session */
  onDeleteSession?: (sessionId: string) => void;
  /** Whether delete is in progress */
  isDeleting?: boolean;
  /** Session IDs matching the active tag filter (for highlighting) */
  matchingSessionIds?: Set<string>;
  /** Callback to apply all tags from a session to the filter */
  onApplyAllTags?: (tags: string[]) => void;
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
  onRecomputeMetrics,
  isRecomputing,
  onEditSession,
  onDeleteSession,
  isDeleting,
  matchingSessionIds,
  onApplyAllTags,
}: SessionsCarouselProps) {
  // Sessions ordered chronologically (oldest first, newest last)
  const orderedSessions = sessions;

  // Local carousel API for navigation buttons
  const [api, setApi] = useState<CarouselApi | null>(null);

  // Hover state for scroll hint
  const [isHovered, setIsHovered] = useState(false);
  const carouselContainerRef = useRef<HTMLDivElement>(null);

  // Handle wheel scroll on carousel (using native event for better preventDefault)
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!api) return;
    e.preventDefault();
    e.stopPropagation();

    // Scroll based on wheel direction
    if (e.deltaY > 0 || e.deltaX > 0) {
      api.scrollNext();
    } else if (e.deltaY < 0 || e.deltaX < 0) {
      api.scrollPrev();
    }
  }, [api]);

  // Attach wheel listener with { passive: false } to allow preventDefault
  React.useEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Carousel API state
  const handleApiReady = useCallback(
    (carouselApi: CarouselApi) => {
      if (!carouselApi) return;
      setApi(carouselApi);
      onApiReady?.(carouselApi);
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
    <div
      ref={carouselContainerRef}
      className={cn("flex flex-col h-full", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-1.5 sm:mb-3 relative">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[var(--tropx-vibrant)]" />
          <h3 className="text-sm font-semibold text-[var(--tropx-text-main)]">
            Recent Sessions
          </h3>
        </div>

        {/* Scroll hint - centered, animated */}
        {isHovered && (
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs text-[var(--tropx-shadow)] animate-in fade-in duration-200">
            <button
              onClick={() => api?.scrollTo(0)}
              className="-m-2 p-2 hover:text-[var(--tropx-vibrant)] transition-colors cursor-pointer"
              title="Go to first"
            >
              <ChevronLeft
                className="size-3"
                style={{ animation: 'bounce-left 1s ease-in-out infinite' }}
              />
            </button>
            <span>scroll</span>
            <button
              onClick={() => api?.scrollTo(orderedSessions.length - 1)}
              className="-m-2 p-2 hover:text-[var(--tropx-vibrant)] transition-colors cursor-pointer"
              title="Go to last"
            >
              <ChevronRight
                className="size-3"
                style={{ animation: 'bounce-right 1s ease-in-out infinite' }}
              />
            </button>
            <style>{`
              @keyframes bounce-left {
                0%, 100% { transform: translateX(0); }
                50% { transform: translateX(-3px); }
              }
              @keyframes bounce-right {
                0%, 100% { transform: translateX(0); }
                50% { transform: translateX(3px); }
              }
            `}</style>
          </div>
        )}
        {/* Navigation buttons */}
        <div className="flex gap-1.5">
          <button
            className={cn(
              "size-6 flex items-center justify-center rounded-full",
              "border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
              "text-[var(--tropx-shadow)]",
              "hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
              "transition-colors disabled:opacity-50"
            )}
            onClick={() => api?.scrollPrev()}
            disabled={!api?.canScrollPrev()}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            className={cn(
              "size-6 flex items-center justify-center rounded-full",
              "border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
              "text-[var(--tropx-shadow)]",
              "hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
              "transition-colors disabled:opacity-50"
            )}
            onClick={() => api?.scrollNext()}
            disabled={!api?.canScrollNext()}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Carousel */}
      <Carousel
        opts={{
          align: "center",
          loop: false,
          containScroll: "keepSnaps",
          startIndex: orderedSessions.length - 1,
        }}
        setApi={handleApiReady}
        className="w-full overflow-visible"
      >
        <CarouselContent className="-ml-2 sm:-ml-4 px-1 py-2">
          {orderedSessions.map((session, index) => (
            <CarouselItem
              key={session.sessionId}
              className="pl-2 sm:pl-4 basis-1/3 sm:basis-1/2 lg:basis-1/3"
            >
              <SessionCard
                session={session}
                isActive={session.sessionId === selectedSessionId}
                isLatest={index === orderedSessions.length - 1}
                onClick={() => {
                  onSelectSession(session.sessionId);
                  // Scroll to center the clicked card
                  requestAnimationFrame(() => {
                    api?.scrollTo(index);
                  });
                }}
                onRecomputeMetrics={session.sessionId === selectedSessionId ? onRecomputeMetrics : undefined}
                isRecomputing={session.sessionId === selectedSessionId ? isRecomputing : false}
                onEdit={session.sessionId === selectedSessionId && onEditSession ? () => onEditSession(session.sessionId) : undefined}
                onDelete={session.sessionId === selectedSessionId && onDeleteSession ? () => onDeleteSession(session.sessionId) : undefined}
                isDeleting={session.sessionId === selectedSessionId ? isDeleting : false}
                isMatchingFilter={matchingSessionIds?.has(session.sessionId)}
                onApplyAllTags={onApplyAllTags ? () => onApplyAllTags(session.tags) : undefined}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}

export default SessionsCarousel;
