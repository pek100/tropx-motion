/**
 * HorusPane
 *
 * AI Analysis pane with beautiful timeline-based sections.
 * Uses the same styling as ChartPane for consistency.
 */

import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Send,
  Clock,
  Dumbbell,
  Timer,
  Zap,
  AlertTriangle,
  Rocket,
  Target,
  Link,
  Unlink,
} from "lucide-react";
import { AtomSpin } from "@/components/AtomSpin";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { VisualizationBlock, EvaluationContext } from "./types";
import { BlockRenderer } from "./BlockRenderer";
import { useVisualization } from "./hooks/useVisualization";

// Sub-components
import { ScoreRing } from "./components/ScoreRing";
import { MetricPill } from "./components/MetricPill";
import { MiniBarChart } from "./components/MiniBarChart";
import { RecommendationCard } from "./components/RecommendationCard";
import {
  Timeline,
  TimelineItem,
  TimelineHeader,
  TimelineSeparator,
  TimelineIndicator,
  TimelineTitle,
  TimelineContent,
  TimelineDate,
} from "./components/Timeline";
import { Check, Play, CircleDot, ArrowRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type AnalysisMode = "overall" | "session";

interface SessionData {
  sessionId: string;
  metrics?: {
    leftLeg: Record<string, number>;
    rightLeg: Record<string, number>;
    bilateral: Record<string, number>;
    opiScore?: number;
  };
  recordedAt: number;
}

interface HorusPaneProps {
  patientId: Id<"users"> | null;
  selectedSessionId: string | null;
  sessions: SessionData[];
  borderless?: boolean;
  className?: string;
  /** Force show demo content for development/showcase */
  forceDemo?: boolean;
  /** Whether tabs are linked with Chart pane */
  isLinked?: boolean;
  /** Callback when link state changes */
  onLinkedChange?: (linked: boolean) => void;
  /** Called when mode changes (so parent can sync other pane) */
  onModeChange?: (mode: AnalysisMode) => void;
  /** External mode to sync to when linked */
  syncToMode?: AnalysisMode;
}

// ─────────────────────────────────────────────────────────────────
// Demo Data
// ─────────────────────────────────────────────────────────────────

const DEMO_VELOCITY_DATA = [
  { name: "Set 1", value: 420 },
  { name: "Set 2", value: 455 },
  { name: "Set 3", value: 515, highlight: true },
  { name: "Set 4", value: 480 },
];

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function HorusPane({
  patientId,
  selectedSessionId,
  sessions,
  borderless,
  className,
  forceDemo = false,
  isLinked = true,
  onLinkedChange,
  onModeChange,
  syncToMode,
}: HorusPaneProps) {
  const [mode, setModeInternal] = useState<AnalysisMode>("overall");

  // Sync to external mode when linked
  useEffect(() => {
    if (isLinked && syncToMode !== undefined && syncToMode !== mode) {
      setModeInternal(syncToMode);
    }
  }, [syncToMode, isLinked]);

  // Handle mode change
  const setMode = useCallback((newMode: AnalysisMode) => {
    setModeInternal(newMode);
    if (isLinked) {
      onModeChange?.(newMode);
    }
  }, [onModeChange, isLinked]);

  const [chatInput, setChatInput] = useState("");

  // Get visualization data
  const { isLoading, hasAnalysis, context, overallBlocks, sessionBlocks, error } =
    useVisualization(patientId, selectedSessionId, sessions);

  const effectiveMode = selectedSessionId ? mode : "overall";

  // Fallback context when real context isn't available (metrics not loaded)
  const fallbackContext: EvaluationContext = {
    current: {
      sessionId: selectedSessionId || "unknown",
      leftLeg: { overallMaxRom: 0, averageRom: 0, peakFlexion: 0, peakExtension: 0, peakAngularVelocity: 0, explosivenessConcentric: 0, explosivenessLoading: 0, rmsJerk: 0, romCoV: 0 },
      rightLeg: { overallMaxRom: 0, averageRom: 0, peakFlexion: 0, peakExtension: 0, peakAngularVelocity: 0, explosivenessConcentric: 0, explosivenessLoading: 0, rmsJerk: 0, romCoV: 0 },
      bilateral: { romAsymmetry: 0, velocityAsymmetry: 0, crossCorrelation: 0, realAsymmetryAvg: 0, netGlobalAsymmetry: 0, phaseShift: 0, temporalLag: 0, maxFlexionTimingDiff: 0 },
      movementType: "bilateral",
      recordedAt: Date.now(),
    },
  };
  const effectiveContext = context || fallbackContext;

  // Force demo mode - skip empty states
  if (forceDemo) {
    return (
      <div
        className={cn(
          "flex flex-col bg-[var(--tropx-card)] overflow-hidden",
          borderless
            ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
            : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
          className
        )}
      >
        {/* Header - shrink-0 to prevent compression */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-[var(--tropx-border)] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-tropx-vibrant">
                <AtomSpin className="size-4" />
              </div>
              <h3 className="font-bold text-base sm:text-lg text-[var(--tropx-text-main)]">
                AI Analysis
              </h3>
            </div>
            <p className="hidden sm:block text-sm text-[var(--tropx-text-sub)]">
              Longitudinal insights across all sessions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={mode} onValueChange={(v) => setMode(v as AnalysisMode)}>
              <TabsList className="h-8 sm:h-9 bg-[var(--tropx-muted)]">
                <TabsTrigger
                  value="overall"
                  className={cn(
                    "text-xs px-2 sm:px-3 transition-all",
                    mode === "overall" &&
                      "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                  )}
                >
                  Overall Analysis
                </TabsTrigger>
                <TabsTrigger
                  value="session"
                  className={cn(
                    "text-xs px-2 sm:px-3 transition-all",
                    mode === "session" &&
                      "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                  )}
                >
                  Session Analysis
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Link toggle */}
            <button
              type="button"
              onClick={() => onLinkedChange?.(!isLinked)}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isLinked
                  ? "text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10"
                  : "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-muted)]"
              )}
              title={isLinked ? "Unlink from Chart" : "Link with Chart"}
            >
              {isLinked ? <Link className="size-4" /> : <Unlink className="size-4" />}
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 sm:p-5">
            <DemoContent mode={mode} />
          </div>
        </ScrollArea>

        {/* Chat input - shrink-0 to prevent compression */}
        <div className="border-t border-[var(--tropx-border)] px-4 sm:px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-[var(--tropx-text-sub)]">
              <Plus className="size-4" />
            </Button>
            <Input
              placeholder="Ask a question about this analysis..."
              className="h-9 text-sm bg-[var(--tropx-muted)] border-0"
            />
            <Button size="icon" className="h-9 w-9 shrink-0 bg-tropx-vibrant hover:bg-tropx-vibrant/90">
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!patientId) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-16 bg-[var(--tropx-card)]",
          borderless
            ? "rounded-none border-0 sm:rounded-xl sm:border sm:border-[var(--tropx-border)]"
            : "rounded-xl border border-[var(--tropx-border)]",
          className
        )}
      >
        <div className="text-tropx-vibrant mb-4">
          <AtomSpin className="size-12" />
        </div>
        <p className="text-[var(--tropx-text-sub)]">Select a patient to view AI analysis</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-16 bg-[var(--tropx-card)]",
          borderless
            ? "rounded-none border-0 sm:rounded-xl sm:border sm:border-[var(--tropx-border)]"
            : "rounded-xl border border-[var(--tropx-border)]",
          className
        )}
      >
        <div className="text-tropx-vibrant mb-4">
          <AtomSpin className="size-12" />
        </div>
        <p className="text-[var(--tropx-text-sub)]">No sessions available for analysis</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--tropx-card)] overflow-hidden",
        borderless
          ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
          : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      {/* Header with Tabs - matches ChartPane style */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-[var(--tropx-border)] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-tropx-vibrant">
              <AtomSpin className="size-4" />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-[var(--tropx-text-main)]">
              AI Analysis
            </h3>
            {isLoading && (
              <Badge variant="outline" className="text-xs">
                Analyzing...
              </Badge>
            )}
          </div>
          <p className="hidden sm:block text-sm text-[var(--tropx-text-sub)]">
            {effectiveMode === "overall"
              ? "Longitudinal insights across all sessions"
              : "Detailed analysis for this session"}
          </p>
        </div>

        {/* Tabs - styled like ChartPane */}
        <div className="flex items-center gap-2">
          <Tabs value={effectiveMode} onValueChange={(v) => setMode(v as AnalysisMode)}>
            <TabsList className="h-8 sm:h-9 bg-[var(--tropx-muted)]">
              <TabsTrigger
                value="overall"
                className={cn(
                  "text-xs px-2 sm:px-3 transition-all",
                  effectiveMode === "overall" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                )}
              >
                Overall Analysis
              </TabsTrigger>
              <TabsTrigger
                value="session"
                disabled={!selectedSessionId}
                className={cn(
                  "text-xs px-2 sm:px-3 transition-all",
                  effectiveMode === "session" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                )}
              >
                Session Analysis
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Link toggle */}
          <button
            type="button"
            onClick={() => onLinkedChange?.(!isLinked)}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isLinked
                ? "text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10"
                : "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-muted)]"
            )}
            title={isLinked ? "Unlink from Chart" : "Link with Chart"}
          >
            {isLinked ? <Link className="size-4" /> : <Unlink className="size-4" />}
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 sm:p-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-tropx-vibrant mb-4">
                <AtomSpin className="size-10" />
              </div>
              <p className="text-sm text-[var(--tropx-text-sub)]">Analyzing session data...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-status-error-text mb-2 font-medium">Analysis Error</div>
              <p className="text-sm text-[var(--tropx-text-sub)]">{error}</p>
            </div>
          ) : hasAnalysis ? (
            <div className="space-y-4">
              {(effectiveMode === "overall" ? overallBlocks : sessionBlocks).map(
                (block, index) => (
                  <BlockRenderer
                    key={index}
                    block={block as VisualizationBlock}
                    context={effectiveContext}
                  />
                )
              )}
              {(effectiveMode === "overall" ? overallBlocks : sessionBlocks).length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="text-tropx-vibrant mb-4">
                    <AtomSpin className="size-10" />
                  </div>
                  <p className="text-sm text-[var(--tropx-text-sub)]">
                    No {effectiveMode} analysis blocks available yet
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="text-tropx-vibrant mb-4">
                <AtomSpin className="size-10" />
              </div>
              <p className="text-sm text-[var(--tropx-text-sub)]">
                {selectedSessionId
                  ? "Analysis pending - regenerate OPI to trigger AI analysis"
                  : "Select a session to view AI analysis"}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Chat Input - shrink-0 to prevent compression */}
      <div className="border-t border-[var(--tropx-border)] px-4 sm:px-5 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)]"
          >
            <Plus className="size-4" />
          </Button>
          <Input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask a question about this analysis or request a specific metric breakdown..."
            className="h-9 text-sm bg-[var(--tropx-muted)] border-0"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 bg-tropx-vibrant hover:bg-tropx-vibrant/90"
            disabled={!chatInput.trim()}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Demo Content (matches concept image with Timeline component)
// ─────────────────────────────────────────────────────────────────

function DemoContent({ mode }: { mode: AnalysisMode }) {
  return (
    <Timeline defaultValue={1}>
      {/* Session Summary */}
      <TimelineItem step={1} status="active">
        <TimelineSeparator />
        <TimelineIndicator>
          <Play className="size-3" />
        </TimelineIndicator>
        <TimelineHeader>
          <TimelineTitle>Session Summary</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>
          <div className="rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] p-4">
            <div className="flex gap-6 items-start">
              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed mb-4">
                  Overall session intensity was <strong className="text-[var(--tropx-text-main)]">High</strong>.
                  Strong power output with eccentric control challenges in later sets.
                  Fatigue pattern detected in quadriceps after 20 minutes.
                </p>
                <div className="flex flex-wrap gap-2">
                  <MetricPill icon={<Timer className="size-3" />} label="Duration" value="45m 12s" />
                  <MetricPill icon={<Dumbbell className="size-3" />} label="Sets" value="12" />
                  <MetricPill icon={<Zap className="size-3" />} label="Load" value="4,200 kg" />
                </div>
              </div>
              {/* Visualization container */}
              <div className="shrink-0 bg-[var(--tropx-card)]/80 dark:bg-[var(--tropx-muted)]/30 p-4 rounded-lg border border-[var(--tropx-border)]/50 min-w-[120px] flex items-center justify-center">
                <ScoreRing value={85} label="Rating" size="sm" />
              </div>
            </div>
          </div>
        </TimelineContent>
      </TimelineItem>

      {/* Velocity Breakthrough */}
      <TimelineItem step={2} status="completed">
        <TimelineSeparator />
        <TimelineIndicator>
          <Check className="size-3" />
        </TimelineIndicator>
        <TimelineHeader>
          <TimelineTitle>Velocity Breakthrough</TimelineTitle>
          <Badge className="bg-status-success-bg text-status-success-text text-xs px-1.5 py-0.5 font-medium">
            +12% vs Avg
          </Badge>
        </TimelineHeader>
        <TimelineContent>
          <div className="rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] p-4">
            <div className="flex gap-6 items-start">
              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed mb-3">
                  Peak angular velocity hit <strong className="text-[var(--tropx-text-main)]">515°/s</strong> during the 3rd set of Knee Extensions.
                  Significant improvement in explosive power compared to last week's 460°/s average.
                </p>
                <div className="flex items-center gap-1.5 text-xs text-tropx-vibrant">
                  <Rocket className="size-3.5 shrink-0" />
                  <span>Suggestion: Maintain this velocity but monitor landing mechanics.</span>
                </div>
              </div>
              {/* Visualization container */}
              <div className="shrink-0 bg-[var(--tropx-card)]/80 dark:bg-[var(--tropx-muted)]/30 p-3 rounded-lg border border-[var(--tropx-border)]/50 min-w-[140px]">
                <MiniBarChart
                  data={DEMO_VELOCITY_DATA}
                  title="Velocity (°/s)"
                  highlightValue="515"
                />
              </div>
            </div>
          </div>
        </TimelineContent>
      </TimelineItem>

      {/* Stability Alert */}
      <TimelineItem step={3} status="warning">
        <TimelineSeparator />
        <TimelineIndicator>
          <AlertTriangle className="size-3" />
        </TimelineIndicator>
        <TimelineHeader>
          <TimelineTitle>Stability Alert</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>
          <div className="rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] p-4">
            <div className="flex gap-6 items-start">
              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed">
                  Rapid deceleration caused form loss in the eccentric phase of squats.
                  Knee valgus angle exceeded safe threshold (15°) during reps 8 and 9.
                </p>
              </div>
              {/* Visualization container */}
              <div className="shrink-0 bg-[var(--tropx-card)]/80 dark:bg-[var(--tropx-muted)]/30 p-4 rounded-lg border border-[var(--tropx-border)]/50 min-w-[120px] flex items-center justify-center">
                <ScoreRing value={42} label="Stability" size="sm" color="warning" />
              </div>
            </div>
          </div>
        </TimelineContent>
      </TimelineItem>

      {/* Next Steps */}
      <TimelineItem step={4} status="upcoming">
        <TimelineSeparator />
        <TimelineIndicator>
          <ArrowRight className="size-3" />
        </TimelineIndicator>
        <TimelineHeader>
          <TimelineTitle>Recommended Next Steps</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>
          <div className="rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RecommendationCard
                icon={<Target className="size-4" />}
                title="Velocity Modulation"
                description="Reduce concentric velocity by 10% in the next session to prioritize control."
                color="coral"
              />
              <RecommendationCard
                icon={<Clock className="size-4" />}
                title="Tempo Training"
                description="Incorporate 3-0-3 tempo squats to improve eccentric stability."
                color="blue"
              />
            </div>
          </div>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  );
}

export default HorusPane;
