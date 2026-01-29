/**
 * HorusPane
 *
 * AI Analysis pane for biomechanical session analysis.
 * Uses the same styling as ChartPane for consistency.
 */

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import { HorusChatInput } from "./HorusChatInput";
import { AtomSpin } from "@/components/AtomSpin";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useV2Analysis } from "./hooks/useV2Analysis";
import { V2SectionsView } from "./v2";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CHAT_PADDING_X = 18;   // Horizontal padding from pane right edge
const CHAT_PADDING_Y = 20;  // Vertical padding from pane bottom edge
const TRIGGER_ZONE_HEIGHT = 150;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: unknown[];
  timestamp: number;
  userId?: string;
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
  userImage?: string;
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const createMessage = (role: "user" | "assistant", content: string, blocks?: unknown[], userId?: string): ChatMessage => ({
  id: generateMessageId(),
  role,
  content,
  blocks,
  timestamp: Date.now(),
  ...(userId ? { userId } : {}),
});

const buildHistoryContext = (history: ChatMessage[], excludeId?: string) =>
  history
    .filter((m) => !excludeId || m.id !== excludeId)
    .slice(-10)
    .map(({ role, content }) => ({ role, content }));

/** Calculate chat position relative to pane (bottom-right anchored, caged within pane) */
const calculateChatPosition = (paneRect: DOMRect, chatWidth: number, chatHeight: number = 88) => {
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Validate inputs
  if (chatWidth <= 0 || paneRect.width <= 0 || paneRect.height <= 0) {
    return null; // Invalid state, don't render
  }

  // Calculate visible pane area
  const visiblePaneTop = Math.max(paneRect.top, 0);
  const visiblePaneBottom = Math.min(paneRect.bottom, vh);
  const visiblePaneHeight = visiblePaneBottom - visiblePaneTop;

  // If pane is not visible enough, don't show chat
  if (visiblePaneHeight < chatHeight + CHAT_PADDING_Y * 2) {
    return null;
  }

  // Distance from pane bottom to viewport bottom
  const paneBottomOffset = vh - Math.min(paneRect.bottom, vh);

  // Bottom position (distance from viewport bottom)
  let bottom = Math.max(CHAT_PADDING_Y, paneBottomOffset + CHAT_PADDING_Y);

  // Maximum bottom value - chat must stay within visible pane area
  // When pane scrolls up (top goes negative), chat should stop at pane's visible top
  const maxBottom = vh - visiblePaneTop - chatHeight - CHAT_PADDING_Y;
  bottom = Math.min(bottom, maxBottom);

  // Position chat at pane's right edge minus padding
  let left = Math.min(paneRect.right, vw) - chatWidth - CHAT_PADDING_X;
  left = Math.max(0, Math.min(left, vw - chatWidth));

  return { bottom, left };
};

/** Calculate horizontal drag constraints based on pane bounds */
const calculateDragConstraints = (paneRect: DOMRect, chatWidth: number, currentLeft: number) => {
  const vw = window.innerWidth;
  const visibleLeft = Math.max(paneRect.left, 0) + CHAT_PADDING_X;
  const visibleRight = Math.min(paneRect.right, vw) - CHAT_PADDING_X;

  // Calculate how far we can drag left and right from current position
  const minX = visibleLeft - currentLeft;
  const maxX = visibleRight - chatWidth - currentLeft;

  return { left: Math.min(minX, 0), right: Math.max(maxX, 0) };
};

/** Check if pane is visible in viewport */
const isPaneVisible = (paneRect: DOMRect) => {
  return paneRect.bottom > 0 && paneRect.top < window.innerHeight &&
         paneRect.right > 0 && paneRect.left < window.innerWidth;
};

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
  // Current user
  const { user } = useCurrentUser();
  const currentUserId = user?._id ?? null;

  // Refs
  const paneRef = useRef<HTMLDivElement>(null);
  const wasInZoneRef = useRef(false);
  const isInitializedRef = useRef(false);
  const userExpandedRef = useRef(false); // Use ref for immediate access in scroll handler
  const hasAnalysisRef = useRef(false);

  // Position state for fixed positioning
  const [chatPosition, setChatPosition] = useState<{ bottom: number; left: number } | null>(null);
  const [dragConstraints, setDragConstraints] = useState({ left: 0, right: 0 });

  // UI State
  const [chatInput, setChatInput] = useState("");
  const [isMinimized, setIsMinimized] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<{ text: string; timestamp: number } | null>(null);
  const [aiResponse, setAiResponse] = useState<{ text: string; links?: Array<{ url: string; title: string; relevance: string }> } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Convex
  const chatList = useQuery(
    api.horus.chat.listChats,
    selectedSessionId ? { parentSessionId: selectedSessionId } : "skip"
  ) ?? [];
  const chatData = useQuery(
    api.horus.chat.getChatHistory,
    activeChatId ? { sessionId: activeChatId } : "skip"
  );
  const chatHistory = chatData?.messages ?? [];
  const chatOwnerId = chatData?.ownerId ?? null;
  const isOwnChat = !chatOwnerId || chatOwnerId === currentUserId;

  const addMessagesMutation = useMutation(api.horus.chat.addMessages);
  const truncateFromMutation = useMutation(api.horus.chat.truncateFrom);
  const forkChatMutation = useMutation(api.horus.chat.forkChat);
  const renameChatMutation = useMutation(api.horus.chat.renameChat);
  const deleteChatMutation = useMutation(api.horus.chat.deleteChat);
  const askAnalysis = useAction(api.horus.userQuery.askAnalysis);
  const v2Analysis = useV2Analysis(selectedSessionId ?? undefined);
  hasAnalysisRef.current = !!v2Analysis.output;

  // ─────────────────────────────────────────────────────────────────
  // Chat Message Handler (DRY: single function for all send operations)
  // ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (
    messageText: string,
    chatSessionId: string,
    options: { excludeMessageId?: string } = {}
  ) => {
    if (!selectedSessionId || !messageText.trim()) return;

    const userMessage = createMessage("user", messageText.trim(), undefined, currentUserId ?? undefined);
    setChatLoading(true);
    setAiResponse(null);

    try {
      const historyForContext = buildHistoryContext(chatHistory, options.excludeMessageId);

      const result = await askAnalysis({
        sessionId: selectedSessionId,
        userPrompt: messageText,
        patientId: patientId ?? undefined,
        chatHistory: historyForContext,
      });

      if (result.success && result.response) {
        setAiResponse({
          text: result.response.textResponse ?? "",
          links: result.response.links,
        });
      } else {
        setAiResponse({
          text: result.error || "Failed to process question",
        });
      }

      const assistantMessage = result.success && result.response
        ? createMessage("assistant", result.response.textResponse ?? "", result.response.blocks)
        : createMessage("assistant", result.error || "Failed to process question");

      await addMessagesMutation({
        sessionId: chatSessionId,
        patientId: patientId ?? undefined,
        messages: [userMessage, assistantMessage],
      });

      setPendingMessage(null);
      setAiResponse(null);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Something went wrong";
      setAiResponse({ text: errorText });

      const errorMessage = createMessage("assistant", errorText);
      await addMessagesMutation({
        sessionId: chatSessionId,
        patientId: patientId ?? undefined,
        messages: [userMessage, errorMessage],
      });

      setPendingMessage(null);
      setAiResponse(null);
    } finally {
      setChatLoading(false);
    }
  }, [selectedSessionId, patientId, currentUserId, chatHistory, askAnalysis, addMessagesMutation]);

  // ─────────────────────────────────────────────────────────────────
  // Chat Actions
  // ─────────────────────────────────────────────────────────────────

  const handleSendQuestion = useCallback(() => {
    if (!chatInput.trim() || !selectedSessionId) return;

    // Generate new chat ID if no active chat
    const chatId = activeChatId ?? `${selectedSessionId}__chat__${Date.now()}`;
    if (!activeChatId) setActiveChatId(chatId);

    setPendingMessage({ text: chatInput.trim(), timestamp: Date.now() });
    setAiResponse(null);
    setChatInput("");
    sendMessage(chatInput, chatId);
  }, [chatInput, selectedSessionId, activeChatId, sendMessage]);

  const handleEditPendingMessage = useCallback((newText: string) => {
    if (!activeChatId) return;
    setPendingMessage({ text: newText, timestamp: Date.now() });
    sendMessage(newText, activeChatId);
  }, [activeChatId, sendMessage]);

  const handleDeletePendingMessage = useCallback(() => {
    setPendingMessage(null);
    setAiResponse(null);
    setChatLoading(false);
  }, []);

  const handleRegeneratePendingMessage = useCallback(() => {
    if (pendingMessage && activeChatId) {
      sendMessage(pendingMessage.text, activeChatId);
    }
  }, [pendingMessage, activeChatId, sendMessage]);

  // Load a previous chat conversation
  const handleSelectPreviousChat = useCallback((chat: { id: string }) => {
    setActiveChatId(chat.id);
    setIsMinimized(false);
    userExpandedRef.current = true;
  }, []);

  // Start a new chat (clear active chat)
  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setPendingMessage(null);
    setAiResponse(null);
  }, []);

  // Handle edit historical message: truncate from this message (inclusive), then regenerate with new text
  const handleEditHistoryMessage = useCallback(async (messageId: string, newText: string) => {
    if (!activeChatId) return;

    await truncateFromMutation({
      sessionId: activeChatId,
      messageId,
      inclusive: true,
    });

    setPendingMessage({ text: newText, timestamp: Date.now() });
    sendMessage(newText, activeChatId);
  }, [activeChatId, truncateFromMutation, sendMessage]);

  // Handle delete historical message: truncate from this message (inclusive)
  const handleDeleteHistoryMessage = useCallback(async (messageId: string) => {
    if (!activeChatId) return;

    await truncateFromMutation({
      sessionId: activeChatId,
      messageId,
      inclusive: true,
    });
  }, [activeChatId, truncateFromMutation]);

  // Handle regenerate from a specific message: find the user message, truncate, resend
  const handleRegenerateFrom = useCallback(async (messageId: string) => {
    if (!activeChatId) return;

    const msg = chatHistory.find((m: ChatMessage) => m.id === messageId);
    if (!msg) return;

    const userMsg = msg.role === "user"
      ? msg
      : chatHistory
          .slice(0, chatHistory.findIndex((m: ChatMessage) => m.id === messageId))
          .reverse()
          .find((m: ChatMessage) => m.role === "user");

    if (!userMsg) return;

    await truncateFromMutation({
      sessionId: activeChatId,
      messageId: userMsg.id,
      inclusive: true,
    });

    setPendingMessage({ text: userMsg.content, timestamp: Date.now() });
    sendMessage(userMsg.content, activeChatId);
  }, [activeChatId, chatHistory, truncateFromMutation, sendMessage]);

  // Handle fork/branch: create a new chat with messages up to and including the forked message
  const handleBranchFrom = useCallback(async (messageId: string) => {
    if (!activeChatId) return;

    const result = await forkChatMutation({
      sessionId: activeChatId,
      messageId,
      patientId: patientId ?? undefined,
    });

    if (result.success) {
      toast.success(`Chat forked with ${result.messageCount} messages`);
      // Switch to the forked chat
      if (result.newSessionId) setActiveChatId(result.newSessionId);
    } else {
      toast.error(result.error || "Failed to fork chat");
    }
  }, [activeChatId, patientId, forkChatMutation]);

  // Handle rename chat
  const handleRenameChat = useCallback(async (chatId: string, newName: string) => {
    try {
      await renameChatMutation({ sessionId: chatId, name: newName });
    } catch (err) {
      toast.error("Failed to rename chat");
    }
  }, [renameChatMutation]);

  // Handle delete chat
  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await deleteChatMutation({ sessionId: chatId });
      // If deleted chat was the active one, clear it
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setPendingMessage(null);
        setAiResponse(null);
      }
    } catch (err) {
      toast.error("Failed to delete chat");
    }
  }, [deleteChatMutation, activeChatId]);

  // Handle toggling fullscreen mode
  const handleOpenFullscreen = useCallback(() => {
    setIsFullscreen(true);
    setIsMinimized(false);
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  // Previous chat conversations for pills
  const previousChatsForInput = useMemo(() =>
    chatList.map((chat: { sessionId: string; preview: string; lastTimestamp: number }) => ({
      id: chat.sessionId,
      text: chat.preview,
      timestamp: chat.lastTimestamp,
    })),
    [chatList]
  );

  // Full chat list for the list view
  const allChatsForList = useMemo(() =>
    chatList.map((chat: { sessionId: string; name?: string | null; preview: string; messageCount: number; lastTimestamp: number; ownerId: string | null }) => ({
      sessionId: chat.sessionId,
      name: chat.name ?? null,
      preview: chat.preview,
      messageCount: chat.messageCount,
      timestamp: chat.lastTimestamp,
      ownerId: chat.ownerId,
    })),
    [chatList]
  );

  // ─────────────────────────────────────────────────────────────────
  // Position & Constraints Management
  // ─────────────────────────────────────────────────────────────────

  const updatePosition = useCallback((minimized: boolean) => {
    const pane = paneRef.current;
    if (!pane) return;

    const paneRect = pane.getBoundingClientRect();

    // Don't update if pane is completely off-screen
    if (!isPaneVisible(paneRect)) {
      setChatPosition(null);
      return;
    }

    const chatWidth = minimized ? 56 : 500;
    const chatHeight = minimized ? 56 : 88;
    const newPosition = calculateChatPosition(paneRect, chatWidth, chatHeight);

    // If position is null (not enough visible space), hide chat
    if (!newPosition) {
      setChatPosition(null);
      return;
    }

    setChatPosition(newPosition);

    // Only calculate drag constraints for expanded state
    if (!minimized) {
      const constraints = calculateDragConstraints(paneRect, chatWidth, newPosition.left);
      setDragConstraints(constraints);
    }
  }, []);

  // Reset initialization and active chat when session changes
  useEffect(() => {
    isInitializedRef.current = false;
    setChatPosition(null);
    setActiveChatId(null);
    setPendingMessage(null);
    setAiResponse(null);
  }, [selectedSessionId]);

  // Initial positioning - runs once before paint
  useLayoutEffect(() => {
    if (!selectedSessionId || isInitializedRef.current) return;

    // Wait for next frame to ensure pane is rendered
    const frame = requestAnimationFrame(() => {
      updatePosition(isMinimized);
      isInitializedRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedSessionId, isMinimized, updatePosition]);

  // Handle scroll and resize
  useEffect(() => {
    if (!selectedSessionId) return;

    let scrollTicking = false;
    const handleScroll = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        updatePosition(isMinimized);
        scrollTicking = false;
      });
    };

    const handleResize = () => {
      updatePosition(isMinimized);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [selectedSessionId, isMinimized, updatePosition]);

  // Update position when minimize state changes (after animation settles)
  useEffect(() => {
    if (!isInitializedRef.current) return;

    // Small delay to let the component re-render with new dimensions
    const timer = setTimeout(() => {
      updatePosition(isMinimized);
    }, 50);

    return () => clearTimeout(timer);
  }, [isMinimized, updatePosition]);

  // ─────────────────────────────────────────────────────────────────
  // Auto-expand/collapse based on scroll position
  // ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !selectedSessionId) return;

    let hasScrolled = false;

    const checkTriggerZone = () => {
      // Skip if user manually expanded or pane has no analysis content
      if (userExpandedRef.current) return;
      if (!hasAnalysisRef.current) return;

      const paneRect = pane.getBoundingClientRect();
      const vh = window.innerHeight;
      const paneBottomInView = paneRect.bottom <= vh && paneRect.bottom > 0;
      const inTriggerZone = paneBottomInView && (vh - paneRect.bottom) < TRIGGER_ZONE_HEIGHT;

      // Only trigger on zone transitions after user has scrolled
      if (hasScrolled) {
        if (inTriggerZone && !wasInZoneRef.current) {
          setIsMinimized(false);
        } else if (!inTriggerZone && wasInZoneRef.current) {
          setIsMinimized(true);
        }
      }
      wasInZoneRef.current = inTriggerZone;
    };

    const handleScroll = () => {
      hasScrolled = true;
      checkTriggerZone();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    // Set initial zone state (but don't trigger expand)
    const paneRect = pane.getBoundingClientRect();
    const paneBottomInView = paneRect.bottom <= window.innerHeight && paneRect.bottom > 0;
    wasInZoneRef.current = paneBottomInView && (window.innerHeight - paneRect.bottom) < TRIGGER_ZONE_HEIGHT;

    return () => window.removeEventListener("scroll", handleScroll);
  }, [selectedSessionId]); // No dependency on userExpanded - we use the ref

  // ─────────────────────────────────────────────────────────────────
  // Empty States
  // ─────────────────────────────────────────────────────────────────

  const emptyStateClass = cn(
    "flex flex-col items-center justify-center py-16 bg-[var(--tropx-card)]",
    borderless
      ? "rounded-none border-0 sm:rounded-xl sm:border sm:border-[var(--tropx-border)]"
      : "rounded-xl border border-[var(--tropx-border)]",
    className
  );

  if (!patientId) {
    return (
      <div className={emptyStateClass}>
        <div className="text-tropx-vibrant mb-4"><AtomSpin className="size-12" /></div>
        <p className="text-[var(--tropx-text-sub)]">Select a patient to view AI analysis</p>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={emptyStateClass}>
        <div className="text-tropx-vibrant mb-4"><AtomSpin className="size-12" /></div>
        <p className="text-[var(--tropx-text-sub)]">No sessions available for analysis</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Main Render
  // ─────────────────────────────────────────────────────────────────

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
      {/* Header */}
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

      {/* Content */}
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
            <div className="text-tropx-vibrant mb-4"><AtomSpin className="size-10" /></div>
            <p className="text-sm text-[var(--tropx-text-sub)]">Select a session to view AI analysis</p>
          </div>
        )}
      </div>

      {/* Backdrop for fullscreen mode */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCloseFullscreen}
          />
        )}
      </AnimatePresence>

      {/* Chat - Only render when we have a valid position or fullscreen */}
      <AnimatePresence>
        {selectedSessionId && (chatPosition || isFullscreen) && (
          <motion.div
            key={isFullscreen ? "fullscreen" : isMinimized ? "minimized" : "expanded"}
            className={cn(
              "fixed origin-bottom-right",
              isFullscreen
                ? "z-50 top-[12%] left-[12%] right-[12%] bottom-[12%]"
                : cn(
                    "z-30",
                    isMinimized ? "w-auto" : "w-[500px] max-w-[90vw] cursor-grab active:cursor-grabbing"
                  )
            )}
            style={isFullscreen ? {} : {
              bottom: chatPosition?.bottom,
              left: chatPosition?.left,
            }}
            drag={isMinimized && !isFullscreen ? false : isFullscreen ? false : "x"}
            dragConstraints={dragConstraints}
            dragElastic={0.1}
            dragMomentum={false}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, x: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
            }}
          >
            <HorusChatInput
              value={chatInput}
              onChange={setChatInput}
              onSend={handleSendQuestion}
              minimized={isMinimized && !isFullscreen}
              onMinimize={() => { setIsMinimized(true); setIsFullscreen(false); userExpandedRef.current = false; }}
              onExpand={() => { setIsMinimized(false); userExpandedRef.current = true; }}
              isLoading={chatLoading}
              disabled={!selectedSessionId || !isOwnChat}
              previousChats={previousChatsForInput}
              onSelectPreviousChat={handleSelectPreviousChat}
              onNewChat={handleNewChat}
              pendingMessage={pendingMessage}
              onDismissPending={() => { setPendingMessage(null); setAiResponse(null); }}
              userImage={userImage}
              onEditMessage={handleEditPendingMessage}
              onDeleteMessage={handleDeletePendingMessage}
              onRegenerate={handleRegeneratePendingMessage}
              aiResponse={aiResponse}
              chatHistory={chatHistory}
              onEditHistoryMessage={handleEditHistoryMessage}
              onDeleteHistoryMessage={handleDeleteHistoryMessage}
              onRegenerateFrom={handleRegenerateFrom}
              onBranchFrom={handleBranchFrom}
              onOpenModal={handleOpenFullscreen}
              isFullscreen={isFullscreen}
              onCloseFullscreen={handleCloseFullscreen}
              isOwnChat={isOwnChat}
              currentUserId={currentUserId}
              allChats={allChatsForList}
              onRenameChat={handleRenameChat}
              onDeleteChat={handleDeleteChat}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default HorusPane;
