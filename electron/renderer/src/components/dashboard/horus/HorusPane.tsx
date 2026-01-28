/**
 * HorusPane
 *
 * AI Analysis pane for biomechanical session analysis.
 * Uses the same styling as ChartPane for consistency.
 */

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Pencil,
  Trash2,
  User,
} from "lucide-react";
import { HorusChatInput } from "./HorusChatInput";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AtomSpin } from "@/components/AtomSpin";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { VisualizationBlock, EvaluationContext } from "./types";
import { BlockRenderer } from "./BlockRenderer";
import { useVisualization } from "./hooks/useVisualization";
import { useV2Analysis } from "./hooks/useV2Analysis";
import { V2SectionsView } from "./v2";
import gsap from "gsap";
import { Draggable } from "gsap/Draggable";

// Register GSAP plugin
gsap.registerPlugin(Draggable);

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: unknown[];
  timestamp: number;
}

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
  /** User's profile image URL for chat avatar */
  userImage?: string;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function HorusPane({
  patientId,
  selectedSessionId,
  sessions,
  borderless,
  className,
  userImage,
}: HorusPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatInnerRef = useRef<HTMLDivElement>(null);
  const draggableRef = useRef<Draggable | null>(null);
  const animationRef = useRef<gsap.core.Tween | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatMinimized, setChatMinimized] = useState(true); // Actual state (controls content)
  const [targetMinimized, setTargetMinimized] = useState(true); // Target state (triggers animation)
  const [userExpanded, setUserExpanded] = useState(false); // Track if user manually expanded
  const wasInZoneRef = useRef(false); // Persist trigger zone state across effect re-runs
  const isAnimatingRef = useRef(false);

  // GSAP Draggable for chat input - fixed to viewport, trapped in pane
  useLayoutEffect(() => {
    if (!paneRef.current || !chatRef.current || !selectedSessionId) return;

    const pane = paneRef.current;
    const chat = chatRef.current;
    const padding = 16;

    // Check if pane is visible in viewport
    const isPaneVisible = () => {
      const paneRect = pane.getBoundingClientRect();
      return paneRect.bottom > 0 && paneRect.top < window.innerHeight &&
             paneRect.right > 0 && paneRect.left < window.innerWidth;
    };

    // Get bounds relative to the chat's current CSS position
    // GSAP transforms are relative to the element's original position
    const getBounds = () => {
      const paneRect = pane.getBoundingClientRect();
      const chatRect = chat.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const chatW = chat.offsetWidth;
      const chatH = chat.offsetHeight;

      // Visible portion of pane
      const visibleLeft = Math.max(paneRect.left, 0) + padding;
      const visibleRight = Math.min(paneRect.right, vw) - padding;
      const visibleTop = Math.max(paneRect.top, 0) + padding;
      const visibleBottom = Math.min(paneRect.bottom, vh) - padding;

      // Current chat position (CSS left/top + transform)
      const currentX = gsap.getProperty(chat, "x") as number || 0;
      const currentY = gsap.getProperty(chat, "y") as number || 0;

      // Base position (CSS left/top without transforms)
      const baseLeft = chatRect.left - currentX;
      const baseTop = chatRect.top - currentY;

      // Compute bounds for transforms relative to base position
      // Handle case where visible area is smaller than chat
      let minX = visibleLeft - baseLeft;
      let maxX = visibleRight - chatW - baseLeft;
      let minY = visibleTop - baseTop;
      let maxY = visibleBottom - chatH - baseTop;

      // If chat is wider/taller than visible area, center the bounds
      if (maxX < minX) {
        const center = (minX + maxX) / 2;
        minX = maxX = center;
      }
      if (maxY < minY) {
        const center = (minY + maxY) / 2;
        minY = maxY = center;
      }

      return { minX, maxX, minY, maxY };
    };

    // Set initial position (bottom-right of visible pane)
    const setInitialPosition = () => {
      const paneRect = pane.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // Use actual dimensions, with fallbacks based on minimized state
      const defaultW = chatMinimized ? 44 : 400;
      const defaultH = chatMinimized ? 44 : 88;
      const chatW = chat.offsetWidth || defaultW;
      const chatH = chat.offsetHeight || defaultH;

      const visibleRight = Math.min(paneRect.right, vw) - padding;
      const visibleBottom = Math.min(paneRect.bottom, vh) - padding;

      chat.style.position = "fixed";
      chat.style.left = `${visibleRight - chatW}px`;
      chat.style.top = `${visibleBottom - chatH}px`;

      // Reset any transforms
      gsap.set(chat, { x: 0, y: 0 });
    };

    // Track if we've initialized position
    let hasInitialized = false;

    // Initialize position (with frame delay to ensure element has rendered)
    chat.style.position = "fixed";
    const chatInner = chatInnerRef.current;
    requestAnimationFrame(() => {
      // Ensure inner wrapper starts at scale 1
      if (chatInner) {
        gsap.set(chatInner, { scale: 1, transformOrigin: "100% 100%" });
      }
      if (isPaneVisible()) {
        setInitialPosition();
        gsap.set(chat, { autoAlpha: 1 });
        hasInitialized = true;
      } else {
        chat.style.left = "0px";
        chat.style.top = "0px";
        gsap.set(chat, { autoAlpha: 0 });
      }
    });

    // Create Draggable
    const [draggable] = Draggable.create(chat, {
      type: "x,y",
      trigger: "[data-drag-handle]",
      dragClickables: false,
      edgeResistance: 1,
      bounds: getBounds,
      onDragStart: function() {
        chat.style.cursor = "grabbing";
      },
      onDragEnd: function() {
        chat.style.cursor = "";
      },
    });

    draggableRef.current = draggable;

    // Scroll handler - update visibility and reapply bounds
    let scrollTicking = false;
    const handleScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;

      requestAnimationFrame(() => {
        if (!isPaneVisible()) {
          gsap.set(chat, { autoAlpha: 0 });
        } else {
          // Initialize position on first scroll into view
          if (!hasInitialized) {
            setInitialPosition();
            hasInitialized = true;
          }
          gsap.set(chat, { autoAlpha: 1 });
          // Update bounds and apply them
          draggable.applyBounds(getBounds());
        }
        scrollTicking = false;
      });
    };

    // Resize handler - reset position
    const handleResize = () => {
      if (isPaneVisible()) {
        setInitialPosition();
        gsap.set(chat, { autoAlpha: 1 });
        draggable.applyBounds(getBounds());
      }
    };

    // Event listeners
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      draggable.kill();
      draggableRef.current = null;
      gsap.set(chat, { clearProps: "all" });
      if (chatInner) {
        gsap.set(chatInner, { clearProps: "all" });
      }
    };
  }, [selectedSessionId]);

  // Animate scale and reset position on state change
  useEffect(() => {
    const chat = chatRef.current;
    const chatInner = chatInnerRef.current;
    const pane = paneRef.current;
    if (!chat || !chatInner || !pane) return;

    // Skip if already animating or already at target state
    if (isAnimatingRef.current || chatMinimized === targetMinimized) {
      return;
    }

    const padding = 16;

    // Reset position to bottom-right
    const resetPosition = () => {
      const paneRect = pane.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const chatW = chat.offsetWidth;
      const chatH = chat.offsetHeight;

      const visibleRight = Math.min(paneRect.right, vw) - padding;
      const visibleBottom = Math.min(paneRect.bottom, vh) - padding;
      const visibleLeft = Math.max(paneRect.left, 0) + padding;
      const visibleTop = Math.max(paneRect.top, 0) + padding;

      let left = visibleRight - chatW;
      let top = visibleBottom - chatH;
      left = Math.max(left, visibleLeft);
      top = Math.max(top, visibleTop);

      chat.style.left = `${left}px`;
      chat.style.top = `${top}px`;
      gsap.set(chat, { x: 0, y: 0 });
    };

    // Kill any ongoing animation
    if (animationRef.current) {
      animationRef.current.kill();
    }

    isAnimatingRef.current = true;

    // Animate: scale down -> swap content -> scale up
    animationRef.current = gsap.to(chatInner, {
      scale: 0,
      duration: 0.1,
      ease: "power2.in",
      transformOrigin: "100% 100%", // bottom-right
      onComplete: () => {
        // Swap content
        setChatMinimized(targetMinimized);

        // Enable/disable draggable
        if (targetMinimized) {
          draggableRef.current?.disable();
        } else {
          draggableRef.current?.enable();
        }

        // Wait for new content to render, then animate in
        requestAnimationFrame(() => {
          // Ensure new content starts at scale 0
          gsap.set(chatInner, { scale: 0, transformOrigin: "100% 100%" });

          resetPosition();

          animationRef.current = gsap.to(chatInner, {
            scale: 1,
            duration: 0.12,
            ease: "back.out(1.4)",
            transformOrigin: "100% 100%",
            onComplete: () => {
              isAnimatingRef.current = false;
              animationRef.current = null;
            },
          });
        });
      },
    });

    return () => {
      if (animationRef.current) {
        animationRef.current.kill();
        animationRef.current = null;
      }
    };
  }, [targetMinimized, chatMinimized]);

  // Auto-expand/collapse chat based on trigger zone at bottom of pane
  useEffect(() => {
    if (!paneRef.current || !selectedSessionId) return;

    const pane = paneRef.current;
    const triggerZoneHeight = 150; // Trigger zone size
    let hasScrolled = false; // Skip auto-expand until user scrolls

    const checkTriggerZone = () => {
      const paneRect = pane.getBoundingClientRect();
      const vh = window.innerHeight;

      // Bottom trigger zone: bottom of pane is visible and close to viewport bottom
      const paneBottomInView = paneRect.bottom <= vh && paneRect.bottom > 0;
      const inTriggerZone = paneBottomInView && (vh - paneRect.bottom) < triggerZoneHeight;

      // Only auto-expand when ENTERING the zone (and not already manually expanded)
      // Skip on initial load - only trigger after user has scrolled
      if (inTriggerZone && !wasInZoneRef.current && !userExpanded && hasScrolled) {
        setTargetMinimized(false);
      }

      // Only auto-collapse when LEAVING the zone (and not manually expanded)
      if (!inTriggerZone && wasInZoneRef.current && !userExpanded) {
        setTargetMinimized(true);
      }

      wasInZoneRef.current = inTriggerZone;
    };

    const handleScroll = () => {
      hasScrolled = true;
      checkTriggerZone();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    // Set initial zone state without triggering expand
    const paneRect = pane.getBoundingClientRect();
    const vh = window.innerHeight;
    const paneBottomInView = paneRect.bottom <= vh && paneRect.bottom > 0;
    wasInZoneRef.current = paneBottomInView && (vh - paneRect.bottom) < triggerZoneHeight;

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [selectedSessionId, userExpanded]);


  // Chat state
  const [chatLoading, setChatLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  // Confirmation dialogs
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Load chat history from Convex
  const chatHistory = useQuery(
    api.horus.chat.getChatHistory,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip"
  ) ?? [];

  // Mutations
  const addMessagesMutation = useMutation(api.horus.chat.addMessages);
  const deleteMessageMutation = useMutation(api.horus.chat.deleteMessage);
  const clearHistoryMutation = useMutation(api.horus.chat.clearHistory);

  // User query action
  const askAnalysis = useAction(api.horus.userQuery.askAnalysis);

  // V2 Analysis hook for session mode
  const v2Analysis = useV2Analysis(selectedSessionId ?? undefined);

  // Generate unique ID
  const generateId = useCallback(() => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, []);

  // Handle sending a question
  const handleSendQuestion = useCallback(async () => {
    if (!chatInput.trim() || !selectedSessionId) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: chatInput.trim(),
      timestamp: Date.now(),
    };

    const inputText = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    try {
      // Build chat history context (limit to last 10 messages)
      const historyForContext = chatHistory
        .slice(-10)
        .map((msg: ChatMessage) => ({
          role: msg.role,
          content: msg.content,
        }));

      const result = await askAnalysis({
        sessionId: selectedSessionId,
        userPrompt: inputText,
        patientId: patientId ?? undefined,
        chatHistory: historyForContext,
      });

      if (result.success && result.response) {
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result.response.textResponse ?? "",
          blocks: result.response.blocks,
          timestamp: Date.now(),
        };

        // Save both messages to Convex
        await addMessagesMutation({
          sessionId: selectedSessionId,
          patientId: patientId ?? undefined,
          messages: [userMessage, assistantMessage],
        });
      } else {
        // Save user message and error response
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result.error || "Failed to process question",
          timestamp: Date.now(),
        };
        await addMessagesMutation({
          sessionId: selectedSessionId,
          patientId: patientId ?? undefined,
          messages: [userMessage, errorMessage],
        });
      }
    } catch (err) {
      // Save user message and error
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: err instanceof Error ? err.message : "Something went wrong",
        timestamp: Date.now(),
      };
      await addMessagesMutation({
        sessionId: selectedSessionId,
        patientId: patientId ?? undefined,
        messages: [userMessage, errorMessage],
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, selectedSessionId, patientId, chatHistory, askAnalysis, generateId, addMessagesMutation]);

  // Clear chat history (with confirmation)
  const handleClearChat = useCallback(async () => {
    if (!selectedSessionId) return;
    await clearHistoryMutation({ sessionId: selectedSessionId });
    setShowClearConfirm(false);
  }, [selectedSessionId, clearHistoryMutation]);

  // Delete a message (with confirmation)
  const handleDeleteMessage = useCallback(async () => {
    if (!selectedSessionId || !deleteConfirmId) return;
    await deleteMessageMutation({ sessionId: selectedSessionId, messageId: deleteConfirmId });
    setDeleteConfirmId(null);
  }, [selectedSessionId, deleteConfirmId, deleteMessageMutation]);

  // Start editing a message
  const startEditing = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }, []);

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent("");
  }, []);

  // Submit edited message (delete old and immediately resend)
  const submitEdit = useCallback(async () => {
    if (!editingMessageId || !editingContent.trim() || !selectedSessionId) return;

    // Find the message being edited
    const messageIdx = chatHistory.findIndex((m: ChatMessage) => m.id === editingMessageId);
    if (messageIdx === -1) return;

    const newContent = editingContent.trim();

    // Delete the old message from DB
    await deleteMessageMutation({ sessionId: selectedSessionId, messageId: editingMessageId });

    // Clear edit state
    setEditingMessageId(null);
    setEditingContent("");

    // Immediately send the edited message
    setChatLoading(true);

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: newContent,
      timestamp: Date.now(),
    };

    try {
      // Build chat history context (excluding the deleted message)
      const historyForContext = chatHistory
        .filter((m: ChatMessage) => m.id !== editingMessageId)
        .slice(-10)
        .map((msg: ChatMessage) => ({
          role: msg.role,
          content: msg.content,
        }));

      const result = await askAnalysis({
        sessionId: selectedSessionId,
        userPrompt: newContent,
        patientId: patientId ?? undefined,
        chatHistory: historyForContext,
      });

      if (result.success && result.response) {
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result.response.textResponse ?? "",
          blocks: result.response.blocks,
          timestamp: Date.now(),
        };

        await addMessagesMutation({
          sessionId: selectedSessionId,
          patientId: patientId ?? undefined,
          messages: [userMessage, assistantMessage],
        });
      } else {
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: result.error || "Failed to process question",
          timestamp: Date.now(),
        };
        await addMessagesMutation({
          sessionId: selectedSessionId,
          patientId: patientId ?? undefined,
          messages: [userMessage, errorMessage],
        });
      }
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: err instanceof Error ? err.message : "Something went wrong",
        timestamp: Date.now(),
      };
      await addMessagesMutation({
        sessionId: selectedSessionId,
        patientId: patientId ?? undefined,
        messages: [userMessage, errorMessage],
      });
    } finally {
      setChatLoading(false);
    }
  }, [editingMessageId, editingContent, chatHistory, selectedSessionId, patientId, deleteMessageMutation, generateId, askAnalysis, addMessagesMutation]);

  // Previous chats (user messages only, most recent first)
  const previousChatsForInput = useMemo(() => {
    return chatHistory
      .filter((msg: ChatMessage) => msg.role === "user")
      .map((msg: ChatMessage) => ({
        id: msg.id,
        text: msg.content,
        timestamp: msg.timestamp,
      }))
      .reverse();
  }, [chatHistory]);

  // Handle selecting a previous chat from pills
  const handleSelectPreviousChat = useCallback((chat: { id: string; text: string }) => {
    setChatInput(chat.text);
  }, []);

  // Get visualization data
  const { isLoading, context } =
    useVisualization(patientId, selectedSessionId, sessions);

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
      ref={paneRef}
      className={cn(
        "relative flex flex-col bg-[var(--tropx-card)]",
        borderless
          ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
          : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      {/* Header - Horus branding */}
      <div className="flex items-center gap-4 px-4 sm:px-5 py-4 sm:py-5 border-b border-[var(--tropx-border)] shrink-0">
        <div className="flex items-center gap-3">
          <div style={{ color: 'var(--tropx-vibrant)' }}>
            <AtomSpin className="size-8 sm:size-10" />
          </div>
          <div className="flex flex-col">
            <h2 className="font-bold text-lg sm:text-xl bg-gradient-to-r from-[var(--tropx-vibrant)] to-[rgba(var(--tropx-vibrant-rgb),0.8)] bg-clip-text text-transparent leading-tight">
              Horus
            </h2>
            <span className="font-semibold text-xs sm:text-sm bg-gradient-to-r from-black to-black/80 dark:from-white dark:to-white/80 bg-clip-text text-transparent leading-tight">
              AI Analysis
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="p-4 sm:p-5 flex-1">
        {selectedSessionId ? (
          <V2SectionsView
            output={v2Analysis.output}
            status={v2Analysis.status}
            error={v2Analysis.error}
            onRetry={v2Analysis.retryAnalysis}
            patientId={patientId ?? undefined}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="text-tropx-vibrant mb-4">
              <AtomSpin className="size-10" />
            </div>
            <p className="text-sm text-[var(--tropx-text-sub)]">
              Select a session to view AI analysis
            </p>
          </div>
        )}
      </div>

      {/* Chat - fixed to viewport, trapped in pane bounds */}
      {selectedSessionId && (
        <div
          ref={chatRef}
          className={cn("z-30", chatMinimized ? "w-auto" : "w-[400px]")}
        >
          {/* Inner wrapper for scale animation - separate from position transforms */}
          <div ref={chatInnerRef} className="origin-bottom-right">
            <HorusChatInput
              value={chatInput}
              onChange={setChatInput}
              onSend={handleSendQuestion}
              minimized={chatMinimized}
              onMinimize={() => {
                setTargetMinimized(true);
                setUserExpanded(false);
              }}
              onExpand={() => {
                setTargetMinimized(false);
                setUserExpanded(true);
              }}
              isLoading={chatLoading}
              disabled={!selectedSessionId}
              previousChats={previousChatsForInput}
              onSelectPreviousChat={handleSelectPreviousChat}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default HorusPane;
