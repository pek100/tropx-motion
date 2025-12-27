/**
 * HorusAnalysisToast
 *
 * Toast notification showing AI analysis progress.
 * Supports multiple concurrent analyses with a count badge.
 * Starts expanded with timeline, collapses to compact progress bars after 5s.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
// Use standard Convex useQuery for real-time updates (not cached custom version)
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { X, Brain, Search, FlaskConical, ShieldCheck, TrendingUp, Check, Loader2, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { AtomSpin } from "@/components/AtomSpin";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type AgentStatus = "pending" | "running" | "completed" | "error";

interface AgentInfo {
  id: string;
  name: string;
  shortName: string;
  icon: React.ReactNode;
  status: AgentStatus;
}

type PipelineStatus =
  | "pending"
  | "decomposition"
  | "research"
  | "analysis"
  | "validation"
  | "progress"
  | "complete"
  | "error";

interface AnalysisSession {
  sessionId: string;
  label?: string;
}

interface HorusAnalysisToastProps {
  sessions: AnalysisSession[];
  onClose: () => void;
  onRemoveSession: (sessionId: string) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Agent Configuration
// ─────────────────────────────────────────────────────────────────

const AGENTS: Omit<AgentInfo, "status">[] = [
  { id: "decomposition", name: "Pattern Detection", shortName: "Patterns", icon: <Brain className="size-3.5" /> },
  { id: "research", name: "Research Lookup", shortName: "Research", icon: <Search className="size-3.5" /> },
  { id: "analysis", name: "Deep Analysis", shortName: "Analysis", icon: <FlaskConical className="size-3.5" /> },
  { id: "validation", name: "Quality Check", shortName: "Validate", icon: <ShieldCheck className="size-3.5" /> },
  { id: "progress", name: "Progress Report", shortName: "Progress", icon: <TrendingUp className="size-3.5" /> },
];

// ─────────────────────────────────────────────────────────────────
// Helper: Map pipeline status to agent statuses
// ─────────────────────────────────────────────────────────────────

function getAgentStatuses(pipelineStatus: PipelineStatus): AgentInfo[] {
  const statusOrder: PipelineStatus[] = ["decomposition", "research", "analysis", "validation", "progress"];

  return AGENTS.map((agent) => {
    const agentIndex = statusOrder.indexOf(agent.id as PipelineStatus);
    const currentIndex = statusOrder.indexOf(pipelineStatus);

    let status: AgentStatus = "pending";

    if (pipelineStatus === "error") {
      if (agentIndex < currentIndex) status = "completed";
      else if (agentIndex === currentIndex) status = "error";
    } else if (pipelineStatus === "complete") {
      status = "completed";
    } else if (pipelineStatus === "pending") {
      status = "pending";
    } else {
      if (agentIndex < currentIndex) status = "completed";
      else if (agentIndex === currentIndex) status = "running";
    }

    return { ...agent, status };
  });
}

// ─────────────────────────────────────────────────────────────────
// Status Icon Component
// ─────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case "completed":
      return <Check className="size-3 text-[var(--tropx-success-text)]" />;
    case "running":
      return <Loader2 className="size-3 text-tropx-vibrant animate-spin" />;
    case "error":
      return <AlertCircle className="size-3 text-destructive" />;
    default:
      return <div className="size-2 rounded-full bg-[var(--tropx-muted)]" />;
  }
}

// ─────────────────────────────────────────────────────────────────
// Expanded Timeline View
// ─────────────────────────────────────────────────────────────────

function ExpandedView({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="flex items-center gap-1">
      {agents.map((agent, index) => (
        <div key={agent.id} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex items-center justify-center size-7 rounded-full border-2 transition-colors",
                agent.status === "completed" && "border-[var(--tropx-success-text)] bg-[var(--tropx-success-text)]/10",
                agent.status === "running" && "border-tropx-vibrant bg-tropx-vibrant/10",
                agent.status === "error" && "border-destructive bg-destructive/10",
                agent.status === "pending" && "border-[var(--tropx-border)] bg-[var(--tropx-muted)]"
              )}
            >
              {agent.status === "running" ? (
                <Loader2 className="size-3.5 text-tropx-vibrant animate-spin" />
              ) : agent.status === "completed" ? (
                <Check className="size-3.5 text-[var(--tropx-success-text)]" />
              ) : agent.status === "error" ? (
                <AlertCircle className="size-3.5 text-destructive" />
              ) : (
                <span className="text-[var(--tropx-text-sub)]">{agent.icon}</span>
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium whitespace-nowrap",
                agent.status === "running" && "text-tropx-vibrant",
                agent.status === "completed" && "text-[var(--tropx-success-text)]",
                agent.status === "error" && "text-destructive",
                agent.status === "pending" && "text-[var(--tropx-text-sub)]"
              )}
            >
              {agent.shortName}
            </span>
          </div>

          {index < agents.length - 1 && (
            <div
              className={cn(
                "w-6 h-0.5 mx-1 transition-colors",
                agent.status === "completed"
                  ? "bg-[var(--tropx-success-text)]/40"
                  : "bg-[var(--tropx-border)]"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Compact Progress Bar View
// ─────────────────────────────────────────────────────────────────

function CompactView({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {agents.map((agent) => (
        <div key={agent.id} className="flex items-center gap-1">
          <StatusIcon status={agent.status} />
          <div className="w-8 h-1.5 rounded-full bg-[var(--tropx-muted)] overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                agent.status === "completed" && "w-full bg-[var(--tropx-success-text)]",
                agent.status === "running" && "w-1/2 bg-tropx-vibrant animate-pulse",
                agent.status === "error" && "w-full bg-destructive",
                agent.status === "pending" && "w-0"
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Single Session Status Component
// ─────────────────────────────────────────────────────────────────

function SessionStatus({ sessionId, isExpanded }: { sessionId: string; isExpanded: boolean }) {
  const pipelineStatus = useQuery(api.horus.queries.getPipelineStatus, { sessionId });
  const status: PipelineStatus = (pipelineStatus?.status as PipelineStatus) || "pending";
  const agents = getAgentStatuses(status);

  return isExpanded ? <ExpandedView agents={agents} /> : <CompactView agents={agents} />;
}

// ─────────────────────────────────────────────────────────────────
// Main Toast Component (Multi-session)
// ─────────────────────────────────────────────────────────────────

export function HorusAnalysisToast({ sessions, onClose, onRemoveSession, className }: HorusAnalysisToastProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Ensure currentIndex is valid
  const safeIndex = Math.min(currentIndex, sessions.length - 1);
  const currentSession = sessions[safeIndex];

  // Query status for current session
  const pipelineStatus = useQuery(
    api.horus.queries.getPipelineStatus,
    currentSession ? { sessionId: currentSession.sessionId } : "skip"
  );
  const status: PipelineStatus = (pipelineStatus?.status as PipelineStatus) || "pending";

  // Count completed vs in-progress
  const { completed, inProgress, hasErrors } = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let hasErrors = false;
    // Note: We only track the visible one for now, but could query all
    if (status === "complete") completed++;
    else if (status === "error") hasErrors = true;
    else if (status !== "pending") inProgress++;
    return { completed, inProgress, hasErrors };
  }, [status]);

  // Collapse after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExpanded(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Auto-remove completed sessions after delay
  useEffect(() => {
    if (currentSession && status === "complete") {
      const timer = setTimeout(() => {
        onRemoveSession(currentSession.sessionId);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, currentSession, onRemoveSession]);

  // Close toast if no sessions left
  useEffect(() => {
    if (sessions.length === 0) {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }
  }, [sessions.length, onClose]);

  const handleClick = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handlePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((i) => Math.min(sessions.length - 1, i + 1));
  }, [sessions.length]);

  if (!isVisible || sessions.length === 0) return null;

  const agents = getAgentStatuses(status);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 pointer-events-auto cursor-pointer",
        "bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-xl shadow-lg",
        "transition-all duration-300 ease-out",
        isExpanded ? "p-4" : "px-3 py-2",
        !isVisible && "opacity-0 translate-y-2",
        className
      )}
      onClick={handleClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="text-tropx-vibrant">
              <AtomSpin className="size-4" />
            </div>
            {/* Multi-session badge */}
            {sessions.length > 1 && (
              <div className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-tropx-vibrant text-white text-[10px] font-bold flex items-center justify-center">
                {sessions.length}
              </div>
            )}
          </div>
          <span className="text-sm font-semibold text-[var(--tropx-text-main)]">
            {status === "complete" ? "Analysis Complete" : "AI Analysis"}
          </span>
          {!isExpanded && sessions.length === 1 && (
            <span className="text-xs text-[var(--tropx-text-sub)]">
              {agents.find((a) => a.status === "running")?.shortName || "..."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Navigation for multiple sessions */}
          {sessions.length > 1 && isExpanded && (
            <div className="flex items-center gap-1 mr-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={safeIndex === 0}
                className="p-0.5 rounded hover:bg-[var(--tropx-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs text-[var(--tropx-text-sub)] min-w-[40px] text-center">
                {safeIndex + 1} / {sessions.length}
              </span>
              <button
                type="button"
                onClick={handleNext}
                disabled={safeIndex === sessions.length - 1}
                className="p-0.5 rounded hover:bg-[var(--tropx-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            className="p-1 rounded-md hover:bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Session label */}
      {isExpanded && currentSession?.label && (
        <p className="text-xs text-[var(--tropx-text-sub)] mb-2 truncate">
          {currentSession.label}
        </p>
      )}

      {/* Content */}
      <div className="transition-all duration-300">
        {isExpanded ? <ExpandedView agents={agents} /> : <CompactView agents={agents} />}
      </div>

      {/* Status message */}
      {isExpanded && (
        <p className="mt-2 text-xs text-[var(--tropx-text-sub)]">
          {status === "complete"
            ? "All agents finished successfully"
            : status === "error"
              ? "An error occurred during analysis"
              : `Running ${agents.find((a) => a.status === "running")?.name || "analysis"}...`}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Hook to Manage Toast State
// ─────────────────────────────────────────────────────────────────

export function useHorusAnalysisToast() {
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);

  const showToast = useCallback((sessionId: string, label?: string) => {
    setSessions((prev) => {
      // Don't add duplicates
      if (prev.some((s) => s.sessionId === sessionId)) return prev;
      return [...prev, { sessionId, label }];
    });
  }, []);

  const hideToast = useCallback(() => {
    setSessions([]);
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  const ToastComponent = sessions.length > 0 ? (
    <HorusAnalysisToast
      sessions={sessions}
      onClose={hideToast}
      onRemoveSession={removeSession}
    />
  ) : null;

  return {
    showToast,
    hideToast,
    removeSession,
    ToastComponent,
    isActive: sessions.length > 0,
    activeCount: sessions.length,
  };
}

export default HorusAnalysisToast;
