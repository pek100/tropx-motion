/**
 * HorusPane
 *
 * AI Analysis pane for biomechanical session analysis.
 * Uses the same styling as ChartPane for consistency.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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

  const [chatInput, setChatInput] = useState("");

  // Sticky chat state - show chat at bottom when scrolled past threshold
  const [showBottomChat, setShowBottomChat] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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

  // Track scroll position to show chat at bottom when scrolled
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    // Find the actual scrollable viewport inside ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) return;

    const handleScroll = () => {
      // Show bottom chat when scrolled past 100px
      setShowBottomChat(viewport.scrollTop > 100);
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  // Previous chats for the header input (user messages only, most recent first)
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
      className={cn(
        "flex flex-col bg-[var(--tropx-card)] overflow-hidden",
        borderless
          ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
          : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      {/* Header - Horus branding with chat input */}
      <div className="flex items-center gap-4 px-4 sm:px-5 py-4 sm:py-5 border-b border-[var(--tropx-border)] shrink-0">
        {/* Left side - Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
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

        {/* Right side - Chat input (hidden when showing at bottom) */}
        <div className={cn("flex-1 max-w-md ml-auto", showBottomChat && "invisible")}>
          {selectedSessionId && (
            <HorusChatInput
              value={chatInput}
              onChange={setChatInput}
              onSend={handleSendQuestion}
              isLoading={chatLoading}
              disabled={!selectedSessionId}
              previousChats={previousChatsForInput}
              onSelectPreviousChat={handleSelectPreviousChat}
            />
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        <div className="p-4 sm:p-5">
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
      </ScrollArea>

      {/* Chat History Display */}
      {(chatHistory.length > 0 || chatLoading) && (
        <div className="border-t border-[var(--tropx-border)] bg-[var(--tropx-muted)]/30 shrink-0 max-h-[40%] overflow-auto">
          <div className="px-4 sm:px-5 py-2 flex items-center justify-between border-b border-[var(--tropx-border)]/50">
            <span className="text-xs font-medium text-[var(--tropx-text-sub)]">Chat</span>
            {chatHistory.length > 0 && (
              showClearConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--tropx-text-sub)]">Clear chat?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-xs text-status-error-text hover:bg-status-error-bg"
                    onClick={handleClearChat}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-xs text-[var(--tropx-text-sub)]"
                    onClick={() => setShowClearConfirm(false)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)]"
                  onClick={() => setShowClearConfirm(true)}
                >
                  Clear
                </Button>
              )
            )}
          </div>
          <div className="px-4 sm:px-5 py-3 space-y-3">
            {chatHistory.map((message: ChatMessage) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-2 group",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {/* Bot avatar - AtomSpin icon */}
                {message.role === "assistant" && (
                  <div className="shrink-0 mt-0.5">
                    <div className="size-7 rounded-full bg-tropx-vibrant/10 flex items-center justify-center">
                      <AtomSpin className="size-4" />
                    </div>
                  </div>
                )}

                {/* Message bubble */}
                <div className="relative max-w-[80%]">
                  {/* User message actions - show on hover */}
                  {message.role === "user" && !editingMessageId && (
                    <>
                      {/* Edit/Delete buttons - positioned to the left */}
                      {deleteConfirmId !== message.id && (
                        <div className="absolute -left-14 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-muted)]"
                            onClick={() => startEditing(message)}
                            title="Edit message"
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-[var(--tropx-text-sub)] hover:text-status-error-text hover:bg-status-error-bg"
                            onClick={() => setDeleteConfirmId(message.id)}
                            title="Delete message"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      )}
                      {/* Delete confirmation - positioned above the message */}
                      {deleteConfirmId === message.id && (
                        <div className="absolute -top-8 right-0 flex items-center gap-1.5 bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-lg px-2 py-1 shadow-sm z-10">
                          <span className="text-xs text-[var(--tropx-text-sub)] whitespace-nowrap">Delete?</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs text-status-error-text hover:bg-status-error-bg"
                            onClick={handleDeleteMessage}
                          >
                            Yes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs text-[var(--tropx-text-sub)]"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            No
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2.5",
                      message.role === "user"
                        ? "gradient-diagonal border border-[var(--tropx-border)]"
                        : "bg-[var(--tropx-card)] border border-[var(--tropx-border)]"
                    )}
                  >
                    {editingMessageId === message.id ? (
                      <div className="space-y-2 min-w-[280px]">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border border-[var(--tropx-border)] bg-[var(--tropx-muted)] text-[var(--tropx-text-main)] resize-none focus:outline-none focus:ring-2 focus:ring-tropx-vibrant/50"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitEdit();
                            }
                            if (e.key === "Escape") {
                              cancelEditing();
                            }
                          }}
                        />
                        <div className="flex gap-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-3 text-xs"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 px-3 text-xs bg-tropx-vibrant hover:bg-tropx-vibrant/90 text-white"
                            onClick={submitEdit}
                            disabled={chatLoading || !editingContent.trim()}
                          >
                            {chatLoading ? "Sending..." : "Edit & Resend"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm leading-relaxed text-[var(--tropx-text-main)]">
                          {message.content}
                        </p>
                        {/* Response Blocks */}
                        {message.blocks && message.blocks.length > 0 && (
                          <div className="space-y-2 pt-2 mt-2 border-t border-[var(--tropx-border)]/50">
                            {message.blocks.map((block: unknown, idx: number) => (
                              <BlockRenderer
                                key={idx}
                                block={block as VisualizationBlock}
                                context={effectiveContext}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* User avatar - Google profile image */}
                {message.role === "user" && (
                  <div className="shrink-0 mt-0.5">
                    <Avatar className="size-7">
                      {userImage ? (
                        <AvatarImage src={userImage} alt="You" />
                      ) : null}
                      <AvatarFallback className="bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]">
                        <User className="size-3.5" />
                      </AvatarFallback>
                    </Avatar>
                  </div>
                )}
              </div>
            ))}
            {/* Loading indicator */}
            {chatLoading && (
              <div className="flex gap-2 justify-start">
                <div className="shrink-0 mt-0.5">
                  <div className="size-7 rounded-full bg-tropx-vibrant/10 flex items-center justify-center">
                    <AtomSpin className="size-4" />
                  </div>
                </div>
                <div className="bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-[var(--tropx-text-sub)]">
                    <Loader2 className="size-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat input at bottom when scrolled past threshold */}
      {showBottomChat && selectedSessionId && (
        <div
          className={cn(
            "shrink-0",
            "bg-[var(--tropx-card)]",
            "border-t border-[var(--tropx-border)]",
            "px-4 sm:px-5 py-3"
          )}
        >
          <HorusChatInput
            value={chatInput}
            onChange={setChatInput}
            onSend={handleSendQuestion}
            isLoading={chatLoading}
            disabled={!selectedSessionId}
            previousChats={previousChatsForInput}
            onSelectPreviousChat={handleSelectPreviousChat}
          />
        </div>
      )}

    </div>
  );
}

export default HorusPane;
