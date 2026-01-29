/**
 * HorusChatInput Component
 *
 * Compact chat input that lives in the header and becomes sticky at the bottom when scrolling.
 * Design matches the reference with atom icon, input field, send button, and previous chat pills.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, History, Minus, Pencil, Trash2, RotateCcw, Copy, Check, User, GitBranch, Maximize2, X, Plus, ArrowLeft, MessageSquare } from "lucide-react";
import { AtomSpin } from "@/components/AtomSpin";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PreviousChat {
  id: string;
  text: string;
  timestamp: number;
}

interface PendingMessage {
  text: string;
  timestamp: number;
}

/** AI response with optional links */
interface AIResponse {
  text: string;
  links?: Array<{ url: string; title: string; relevance: string }>;
}

/** Chat message from history */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  userId?: string;
}

/** Full chat item for the list view */
interface ChatListItem {
  sessionId: string;
  name: string | null;
  preview: string;
  messageCount: number;
  timestamp: number;
  ownerId: string | null;
}

interface HorusChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  previousChats?: PreviousChat[];
  onSelectPreviousChat?: (chat: PreviousChat) => void;
  className?: string;
  /** Message that was just sent, triggers expanded view */
  pendingMessage?: PendingMessage | null;
  /** Callback when user dismisses the pending message view */
  onDismissPending?: () => void;
  /** User's profile image URL */
  userImage?: string;
  /** Callback to edit the pending message */
  onEditMessage?: (newText: string) => void;
  /** Callback to delete/cancel the pending message */
  onDeleteMessage?: () => void;
  /** Callback to regenerate the response */
  onRegenerate?: () => void;
  /** AI response to display */
  aiResponse?: AIResponse | null;
  /** Full chat history */
  chatHistory?: ChatMessage[];
  /** Callback when user selects a message from history */
  onSelectMessage?: (messageId: string) => void;
  /** Callback to edit a historical message */
  onEditHistoryMessage?: (messageId: string, newText: string) => void;
  /** Callback to delete a historical message */
  onDeleteHistoryMessage?: (messageId: string) => void;
  /** Callback to regenerate from a specific message */
  onRegenerateFrom?: (messageId: string) => void;
  /** Callback to branch from a specific message */
  onBranchFrom?: (messageId: string) => void;
  /** Callback to open chat in full modal */
  onOpenModal?: () => void;
  /** Whether the chat is in fullscreen mode */
  isFullscreen?: boolean;
  /** Callback to close fullscreen mode */
  onCloseFullscreen?: () => void;
  /** Callback to start a new chat (clears active chat) */
  onNewChat?: () => void;
  /** Whether the current user owns this chat */
  isOwnChat?: boolean;
  /** Current user's ID for ownership checks */
  currentUserId?: string | null;
  /** All chats for the list view */
  allChats?: ChatListItem[];
  /** Callback to rename a chat */
  onRenameChat?: (chatId: string, newName: string) => void;
  /** Callback to delete a chat */
  onDeleteChat?: (chatId: string) => void;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function HorusChatInput({
  value,
  onChange,
  onSend,
  minimized = false,
  onMinimize,
  onExpand,
  isLoading = false,
  disabled = false,
  previousChats = [],
  onSelectPreviousChat,
  className,
  pendingMessage,
  onDismissPending,
  userImage,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
  aiResponse,
  chatHistory = [],
  onSelectMessage,
  onEditHistoryMessage,
  onDeleteHistoryMessage,
  onRegenerateFrom,
  onBranchFrom,
  onOpenModal,
  isFullscreen = false,
  onCloseFullscreen,
  onNewChat,
  isOwnChat = true,
  currentUserId,
  allChats = [],
  onRenameChat,
  onDeleteChat,
}: HorusChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // State for message actions
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgText, setEditingMsgText] = useState("");

  // Chat list state
  const [showChatList, setShowChatList] = useState(false);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Track if we're in expanded chat mode (has messages, pending, or chat list open)
  const hasMessages = chatHistory.length > 0 || pendingMessage;
  const isExpanded = !!pendingMessage || chatHistory.length > 0 || showChatList;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current && isExpanded) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory.length, pendingMessage, aiResponse, isLoading, isExpanded]);

  // Handle copy message (pending)
  const handleCopy = useCallback(() => {
    if (pendingMessage?.text) {
      navigator.clipboard.writeText(pendingMessage.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [pendingMessage?.text]);

  // Handle copy historical message
  const handleCopyHistoryMsg = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  }, []);

  // Handle edit historical message start
  const handleEditHistoryStart = useCallback((msgId: string, content: string) => {
    setEditingMsgId(msgId);
    setEditingMsgText(content);
  }, []);

  // Handle edit historical message save
  const handleEditHistorySave = useCallback(() => {
    if (editingMsgId && editingMsgText.trim() && onEditHistoryMessage) {
      onEditHistoryMessage(editingMsgId, editingMsgText.trim());
      setEditingMsgId(null);
      setEditingMsgText("");
    }
  }, [editingMsgId, editingMsgText, onEditHistoryMessage]);

  // Handle edit historical message cancel
  const handleEditHistoryCancel = useCallback(() => {
    setEditingMsgId(null);
    setEditingMsgText("");
  }, []);

  // Handle edit start
  const handleEditStart = useCallback(() => {
    if (pendingMessage?.text) {
      setEditText(pendingMessage.text);
      setIsEditing(true);
    }
  }, [pendingMessage?.text]);

  // Handle edit save
  const handleEditSave = useCallback(() => {
    if (editText.trim() && onEditMessage) {
      onEditMessage(editText.trim());
      setIsEditing(false);
      setEditText("");
    }
  }, [editText, onEditMessage]);

  // Handle edit cancel
  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditText("");
  }, []);

  // Format relative time for chat list
  const formatRelativeTime = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }, []);

  // Show "coming soon" toast
  const showComingSoonToast = useCallback(() => {
    toast.info("Chat functionality is still underway", {
      description: "This feature will be available soon!",
    });
  }, []);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && value.trim() && !isLoading && !disabled) {
        e.preventDefault();
        onSend?.();
      }
    },
    [value, isLoading, disabled, onSend]
  );

  // Truncate text for pills
  const truncateText = (text: string, maxLength: number = 18) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  // Get recent chats (max 2)
  const recentChats = previousChats.slice(0, 2);

  // Minimized state - just show a small pill button
  if (minimized) {
    return (
      <button
        onClick={onExpand}
        className={cn(
          "p-3 rounded-full",
          "hover:brightness-105",
          "border border-[var(--tropx-border)]",
          "text-[var(--tropx-vibrant)]",
          "shadow-lg transition-transform",
          className
        )}
        style={{
          background: `linear-gradient(135deg, transparent 0%, rgba(var(--tropx-vibrant-rgb), 0.15) 100%), var(--tropx-bg)`,
        }}
        title="Open chat"
      >
        <AtomSpin className="size-5" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col px-4 overflow-hidden",
        "rounded-[24px]",
        "border border-[var(--tropx-border)]",
        isFullscreen ? "h-full" : isExpanded ? "" : "h-[88px]",
        className
      )}
      style={{
        background: `linear-gradient(135deg, transparent 0%, rgba(var(--tropx-vibrant-rgb), 0.08) 100%), var(--tropx-bg)`,
      }}
    >
      {/* History row at top when expanded */}
      {isExpanded && (recentChats.length > 0 || chatHistory.length > 0) && (
        <div className="flex items-center gap-1.5 pt-3 pb-2 overflow-x-auto scrollbar-none shrink-0">
          {/* New chat button - shown when there's an active chat */}
          {chatHistory.length > 0 && onNewChat && (
            <button
              onClick={onNewChat}
              className={cn(
                "flex-shrink-0 p-1 rounded-full",
                "bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]",
                "hover:bg-[var(--tropx-vibrant)]/20",
                "transition-colors duration-150"
              )}
              title="New chat"
            >
              <Plus className="size-3.5" />
            </button>
          )}
          {recentChats.length > 0 && (
            <>
              <button
                onClick={() => setShowChatList(true)}
                className="flex-shrink-0 p-0.5 rounded text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                title="All conversations"
              >
                <History className="size-3.5" />
              </button>
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onSelectPreviousChat?.(chat)}
                  className={cn(
                    "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                    "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                    "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                    "transition-colors duration-150",
                    "max-w-[140px] truncate"
                  )}
                  title={chat.text}
                >
                  {truncateText(chat.text)}
                </button>
              ))}
              {previousChats.length > 2 && (
                <button
                  onClick={() => setShowChatList(true)}
                  className={cn(
                    "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                    "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                    "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                    "transition-colors duration-150"
                  )}
                >
                  More
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Chat list view */}
      {showChatList && isExpanded && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="flex items-center gap-2 py-2 shrink-0">
            <button
              onClick={() => setShowChatList(false)}
              className="p-1 rounded-full hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="text-sm font-medium text-[var(--tropx-text-main)]">
              Conversations
            </span>
            <span className="text-xs text-[var(--tropx-text-sub)]/60">
              ({allChats.length})
            </span>
          </div>

          {/* Chat rows */}
          <ScrollArea className={cn(isFullscreen ? "flex-1 min-h-0" : "h-[400px]")}>
            <div className="flex flex-col gap-1 pr-4 pb-2">
              {allChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--tropx-text-sub)]/60">
                  <MessageSquare className="size-6 mb-2 opacity-40" />
                  <span className="text-xs">No conversations yet</span>
                </div>
              ) : (
                allChats.map((chat) => {
                  const isOwner = chat.ownerId === currentUserId;
                  return (
                    <div
                      key={chat.sessionId}
                      className="group flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-[var(--tropx-card)] cursor-pointer transition-colors"
                      onClick={() => {
                        onSelectPreviousChat?.({ id: chat.sessionId, text: chat.preview, timestamp: chat.timestamp });
                        setShowChatList(false);
                      }}
                    >
                      {/* Chat info */}
                      <div className="flex-1 min-w-0">
                        {renamingChatId === chat.sessionId ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && renameValue.trim()) {
                                onRenameChat?.(chat.sessionId, renameValue.trim());
                                setRenamingChatId(null);
                                setRenameValue("");
                              }
                              if (e.key === "Escape") {
                                setRenamingChatId(null);
                                setRenameValue("");
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full px-2 py-0.5 text-sm bg-[var(--tropx-bg)] border border-[var(--tropx-border)] rounded-md text-[var(--tropx-text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--tropx-vibrant)]"
                            autoFocus
                          />
                        ) : (
                          <div className="text-sm font-medium text-[var(--tropx-text-main)] truncate">
                            {chat.name || chat.preview}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-xs text-[var(--tropx-text-sub)]/60 mt-0.5">
                          <span>{chat.messageCount} messages</span>
                          <span>&middot;</span>
                          <span>{formatRelativeTime(chat.timestamp)}</span>
                        </div>
                      </div>

                      {/* Hover actions (owner only) */}
                      {isOwner && renamingChatId !== chat.sessionId && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingChatId(chat.sessionId);
                              setRenameValue(chat.name || chat.preview);
                            }}
                            className="p-1 rounded-md hover:bg-[var(--tropx-border)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                            title="Rename"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteChat?.(chat.sessionId);
                            }}
                            className="p-1 rounded-md hover:bg-[var(--tropx-border)] text-[var(--tropx-text-sub)]/60 hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Message area - scrollable container with all messages (hidden when chat list is open) */}
      {isExpanded && !showChatList && (
        <ScrollArea className={cn(isFullscreen ? "flex-1 min-h-0" : "h-[400px]", "pb-2")}>
          <div className="flex flex-col gap-3 pt-3 pr-4">
          {/* Render all messages from history */}
          {chatHistory.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "group flex items-end gap-2",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {/* Assistant avatar (left side) */}
              {msg.role === "assistant" && (
                <div className="size-8 rounded-full bg-[var(--tropx-vibrant)]/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <AtomSpin className="size-4 text-[var(--tropx-vibrant)]" />
                </div>
              )}

              {/* Message content + actions */}
              <div className={cn(
                "max-w-[80%] flex flex-col gap-1",
                msg.role === "user" ? "items-end" : "items-start"
              )}>
                {/* Editing state */}
                {editingMsgId === msg.id ? (
                  <div className="flex flex-col gap-2 w-full">
                    <textarea
                      value={editingMsgText}
                      onChange={(e) => setEditingMsgText(e.target.value)}
                      className="w-full p-2.5 text-sm rounded-2xl bg-[var(--tropx-card)] border border-[var(--tropx-border)] text-[var(--tropx-text-main)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--tropx-vibrant)]"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleEditHistoryCancel}
                        className="px-3 py-1.5 text-xs rounded-full hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)] border border-[var(--tropx-border)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleEditHistorySave}
                        className="px-3 py-1.5 text-xs rounded-full bg-[var(--tropx-vibrant)] text-white hover:brightness-110"
                      >
                        Save & Regenerate
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Message bubble */}
                    <div
                      className={cn(
                        "px-3.5 py-2.5 text-sm shadow-sm transition-all",
                        msg.role === "user"
                          ? "rounded-2xl rounded-br-md bg-[var(--tropx-vibrant)] text-white"
                          : "rounded-2xl rounded-bl-md bg-[var(--tropx-card)] border border-[var(--tropx-border)] text-[var(--tropx-text-main)]"
                      )}
                    >
                      {msg.content}
                    </div>

                    {/* Action buttons - visible on hover */}
                    <div className={cn(
                      "flex items-center gap-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity",
                      msg.role === "user" ? "flex-row" : "flex-row"
                    )}>
                      {/* Copy */}
                      <button
                        type="button"
                        onClick={() => handleCopyHistoryMsg(msg.id, msg.content)}
                        className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                        title="Copy"
                      >
                        {copiedMsgId === msg.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>

                      {/* Edit (own user messages only) */}
                      {msg.role === "user" && isOwnChat && (
                        <button
                          type="button"
                          onClick={() => handleEditHistoryStart(msg.id, msg.content)}
                          className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}

                      {/* Regenerate (own chat only) */}
                      {onRegenerateFrom && isOwnChat && (
                        <button
                          type="button"
                          onClick={() => onRegenerateFrom(msg.id)}
                          className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                          title="Regenerate from here"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      )}

                      {/* Branch */}
                      {onBranchFrom && (
                        <button
                          type="button"
                          onClick={() => onBranchFrom(msg.id)}
                          className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                          title="Branch from here"
                        >
                          <GitBranch className="size-3" />
                        </button>
                      )}

                      {/* Delete (own user messages only) */}
                      {msg.role === "user" && isOwnChat && onDeleteHistoryMessage && (
                        <button
                          type="button"
                          onClick={() => onDeleteHistoryMessage(msg.id)}
                          className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* User avatar (right side) */}
              {msg.role === "user" && (
                <Avatar className="size-8 flex-shrink-0 shadow-sm">
                  {userImage ? <AvatarImage src={userImage} alt="You" /> : null}
                  <AvatarFallback className="bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]">
                    <User className="size-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {/* Current pending user message (not yet in history) */}
          {pendingMessage && (
            <div className="flex items-end gap-2 justify-end">
              <div className="max-w-[80%] flex flex-col items-end gap-1">
                {isEditing ? (
                  <div className="flex flex-col gap-2 w-full">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full p-2.5 text-sm rounded-2xl bg-[var(--tropx-card)] border border-[var(--tropx-border)] text-[var(--tropx-text-main)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--tropx-vibrant)]"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleEditCancel}
                        className="px-3 py-1.5 text-xs rounded-full hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)] border border-[var(--tropx-border)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleEditSave}
                        className="px-3 py-1.5 text-xs rounded-full bg-[var(--tropx-vibrant)] text-white hover:brightness-110"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-br-md bg-[var(--tropx-vibrant)] text-sm text-white shadow-sm">
                    {pendingMessage.text}
                  </div>
                )}

                {/* Message actions for pending message */}
                {!isEditing && !isLoading && (
                  <div className="flex items-center gap-1 px-1">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                      title="Copy"
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleEditStart}
                      className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                      title="Edit"
                    >
                      <Pencil className="size-3" />
                    </button>
                    {onDeleteMessage && (
                      <button
                        type="button"
                        onClick={onDeleteMessage}
                        className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-red-500 transition-colors"
                        title="Cancel"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                    {onRegenerate && (
                      <button
                        type="button"
                        onClick={onRegenerate}
                        className="p-1 rounded-md hover:bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
                        title="Regenerate"
                      >
                        <RotateCcw className="size-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <Avatar className="size-8 flex-shrink-0 shadow-sm">
                {userImage ? <AvatarImage src={userImage} alt="You" /> : null}
                <AvatarFallback className="bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]">
                  <User className="size-4" />
                </AvatarFallback>
              </Avatar>
            </div>
          )}

          {/* AI thinking indicator */}
          {isLoading && (
            <div className="flex items-end gap-2">
              <div className="size-8 rounded-full bg-[var(--tropx-vibrant)]/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                <AtomSpin className="size-4 text-[var(--tropx-vibrant)]" />
              </div>
              <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-[var(--tropx-card)] border border-[var(--tropx-border)] text-sm text-[var(--tropx-text-sub)] shadow-sm">
                Thinking...
              </div>
            </div>
          )}

          {/* Current AI response (not yet in history) */}
          {!isLoading && aiResponse && (
            <div className="flex items-end gap-2">
              <div className="size-8 rounded-full bg-[var(--tropx-vibrant)]/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                <AtomSpin className="size-4 text-[var(--tropx-vibrant)]" />
              </div>
              <div className="max-w-[85%] flex flex-col gap-2">
                <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-[var(--tropx-card)] border border-[var(--tropx-border)] text-sm text-[var(--tropx-text-main)] shadow-sm">
                  {aiResponse.text}
                </div>
                {aiResponse.links && aiResponse.links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {aiResponse.links.map((link, idx) => (
                      <a
                        key={idx}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/20 transition-colors"
                        title={link.relevance}
                      >
                        <span className="truncate max-w-[150px]">{link.title}</span>
                        <svg className="size-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      )}

      {/* Input row - pill shaped (hidden when chat list is open) */}
      {!showChatList && <div
        className={cn(
          isExpanded ? "relative mt-2 mb-2" : "absolute inset-x-0 top-0",
          "flex items-center gap-2 px-3 py-1.5",
          "bg-[var(--tropx-card)] rounded-full",
          "border border-[var(--tropx-border)]",
          "transition-all duration-200",
          "focus-within:shadow-[0_0_0_1px_rgba(var(--tropx-vibrant-rgb),0.4)]"
        )}
      >
        {/* Atom icon - only show when no chat */}
        {!isExpanded && (
          <div className="flex-shrink-0 text-[var(--tropx-vibrant)]">
            <AtomSpin className={cn("size-4", isLoading && "opacity-100")} />
          </div>
        )}

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isOwnChat ? "Got any questions?" : "Fork this chat to reply"}
          disabled={disabled || isLoading}
          className={cn(
            "flex-1 bg-transparent text-sm",
            "text-[var(--tropx-text-main)] placeholder:text-[var(--tropx-text-sub)]",
            "focus:outline-none",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={() => onSend?.()}
          disabled={!value.trim() || isLoading || disabled}
          className={cn(
            "flex-shrink-0 p-1 rounded-full transition-all duration-150",
            value.trim() && !isLoading && !disabled
              ? "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
              : "text-[var(--tropx-text-sub)]/40 cursor-not-allowed"
          )}
        >
          <Send className="size-4" />
        </button>

        {/* Expand to fullscreen button (only when not fullscreen) */}
        {onOpenModal && !isFullscreen && (
          <button
            type="button"
            onClick={onOpenModal}
            className={cn(
              "flex-shrink-0 p-1 rounded-full transition-all duration-150",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
            )}
            title="Open full chat"
          >
            <Maximize2 className="size-4" />
          </button>
        )}

        {/* Close fullscreen button (only when fullscreen) */}
        {isFullscreen && onCloseFullscreen && (
          <button
            type="button"
            onClick={onCloseFullscreen}
            className={cn(
              "flex-shrink-0 p-1 rounded-full transition-all duration-150",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
            )}
            title="Close"
          >
            <X className="size-4" />
          </button>
        )}

        {/* Minimize button (only when not fullscreen) */}
        {onMinimize && !isFullscreen && (
          <button
            type="button"
            onClick={onMinimize}
            className={cn(
              "flex-shrink-0 p-1 rounded-full transition-all duration-150",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
            )}
            title="Minimize"
          >
            <Minus className="size-4" />
          </button>
        )}
      </div>}

      {/* History row - drag handle, only when not expanded */}
      {/* History row - bottom when collapsed, hidden when expanded (shown at top instead) */}
      {!isExpanded && (
        <div
          data-drag-handle
          className="absolute inset-x-4 bottom-0 top-[40px] flex items-center gap-1.5 overflow-x-auto scrollbar-none cursor-grab active:cursor-grabbing"
        >
          <button
            onClick={() => { setShowChatList(true); onExpand?.(); }}
            className="flex-shrink-0 p-0.5 rounded text-[var(--tropx-text-sub)]/60 hover:text-[var(--tropx-text-main)] transition-colors"
            title="All conversations"
          >
            <History className="size-3.5" />
          </button>
          {recentChats.length > 0 ? (
            <>
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onSelectPreviousChat?.(chat)}
                  className={cn(
                    "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                    "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                    "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                    "transition-colors duration-150",
                    "max-w-[140px] truncate"
                  )}
                  title={chat.text}
                >
                  {truncateText(chat.text)}
                </button>
              ))}
              {previousChats.length > 2 && (
                <button
                  onClick={() => { setShowChatList(true); onExpand?.(); }}
                  className={cn(
                    "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                    "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                    "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                    "transition-colors duration-150"
                  )}
                >
                  More
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--tropx-text-sub)]/40">No previous chats</span>
          )}
        </div>
      )}

      {/* Bottom drag handle when expanded */}
      {isExpanded && !isFullscreen && (
        <div
          data-drag-handle
          className="h-6 flex items-center justify-center cursor-grab active:cursor-grabbing"
        >
          <div className="w-12 h-1 rounded-full bg-[var(--tropx-border)]" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sticky Wrapper Component
// ─────────────────────────────────────────────────────────────────

interface StickyHorusChatProps extends HorusChatInputProps {
  /** Reference to the scroll container */
  scrollContainerRef?: React.RefObject<HTMLElement>;
  /** Threshold in pixels before becoming sticky */
  stickyThreshold?: number;
}

export function StickyHorusChat({
  scrollContainerRef,
  stickyThreshold = 200,
  ...chatProps
}: StickyHorusChatProps) {
  const [isSticky, setIsSticky] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollContainerRef?.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop;
      setIsSticky(scrollTop > stickyThreshold);
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Check initial state

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [scrollContainerRef, stickyThreshold]);

  return (
    <>
      {/* Placeholder to maintain layout when chat becomes sticky */}
      <div
        ref={placeholderRef}
        className={cn(
          "transition-all duration-200",
          isSticky ? "h-0" : "h-auto"
        )}
      >
        {!isSticky && <HorusChatInput {...chatProps} />}
      </div>

      {/* Sticky chat at bottom */}
      {isSticky && (
        <div
          className={cn(
            "fixed bottom-0 left-0 right-0 z-40",
            "bg-[var(--tropx-card)]/95 backdrop-blur-sm",
            "border-t border-[var(--tropx-border)]",
            "px-4 py-3",
            "animate-in slide-in-from-bottom-2 duration-200"
          )}
        >
          <div className="max-w-4xl mx-auto">
            <HorusChatInput {...chatProps} />
          </div>
        </div>
      )}
    </>
  );
}

export default HorusChatInput;
