/**
 * Editor - Minimal rich text editor built with Lexical and shadcn/ui styling.
 * Supports basic formatting: bold, italic, underline, lists, links, and images.
 */

import { useEffect, useState, useCallback } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TRANSFORMERS } from "@lexical/markdown";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { CodeNode } from "@lexical/code";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  EditorState,
  SerializedEditorState,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from "lexical";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
} from "@lexical/list";
import { $getNearestNodeOfType } from "@lexical/utils";
import { cn } from "@/lib/utils";
import { Toggle } from "@/components/ui/toggle";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Strikethrough,
} from "lucide-react";
import { ImageNode } from "./editor/ImageNode";
import { ImagePlugin } from "./editor/ImagePlugin";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface EditorProps {
  /** Initial content as plain text or serialized editor state */
  initialValue?: string | SerializedEditorState;
  /** Callback when content changes - receives plain text */
  onChange?: (text: string) => void;
  /** Callback when content changes - receives serialized state */
  onChangeState?: (state: SerializedEditorState) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class names for the editor container */
  className?: string;
  /** Additional class names for the content editable area */
  contentClassName?: string;
  /** Whether the editor is editable */
  editable?: boolean;
  /** Auto focus on mount */
  autoFocus?: boolean;
  /** Remove border/container styling for embedding in other containers */
  borderless?: boolean;
  /** Hide the formatting toolbar */
  hideToolbar?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────

const editorTheme = {
  paragraph: "mb-2 last:mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
  list: {
    ul: "list-disc ml-4 mb-2",
    ol: "list-decimal ml-4 mb-2",
    listitem: "mb-1",
  },
  link: "text-[var(--tropx-vibrant)] underline cursor-pointer",
  heading: {
    h1: "text-2xl font-bold mb-2",
    h2: "text-xl font-bold mb-2",
    h3: "text-lg font-bold mb-2",
  },
  quote: "border-l-4 border-[var(--tropx-border)] pl-4 italic mb-2",
};

// ─────────────────────────────────────────────────────────────────
// Toolbar Plugin
// ─────────────────────────────────────────────────────────────────

function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [listType, setListType] = useState<"ul" | "ol" | null>(null);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      if ($isListNode(element)) {
        const parentList = $getNearestNodeOfType(anchorNode, ListNode);
        setListType(parentList ? parentList.getListType() as "ul" | "ol" : null);
      } else {
        setListType(null);
      }
    }
  }, []);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        updateToolbar();
      });
    });
  }, [editor, updateToolbar]);

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
  };

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
  };

  const formatUnderline = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
  };

  const formatStrikethrough = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
  };

  const formatBulletList = () => {
    if (listType === "ul") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    }
  };

  const formatNumberedList = () => {
    if (listType === "ol") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }
  };

  return (
    <div className="flex items-center gap-0.5 p-1 border-b border-[var(--tropx-border)]">
      <Toggle
        size="sm"
        pressed={isBold}
        onPressedChange={formatBold}
        aria-label="Bold"
        className="h-8 w-8 p-0"
      >
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isItalic}
        onPressedChange={formatItalic}
        aria-label="Italic"
        className="h-8 w-8 p-0"
      >
        <Italic className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isUnderline}
        onPressedChange={formatUnderline}
        aria-label="Underline"
        className="h-8 w-8 p-0"
      >
        <Underline className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={isStrikethrough}
        onPressedChange={formatStrikethrough}
        aria-label="Strikethrough"
        className="h-8 w-8 p-0"
      >
        <Strikethrough className="h-4 w-4" />
      </Toggle>
      <div className="w-px h-5 bg-[var(--tropx-border)] mx-1" />
      <Toggle
        size="sm"
        pressed={listType === "ul"}
        onPressedChange={formatBulletList}
        aria-label="Bullet List"
        className="h-8 w-8 p-0"
      >
        <List className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={listType === "ol"}
        onPressedChange={formatNumberedList}
        aria-label="Numbered List"
        className="h-8 w-8 p-0"
      >
        <ListOrdered className="h-4 w-4" />
      </Toggle>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Auto Focus Plugin
// ─────────────────────────────────────────────────────────────────

function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.focus();
  }, [editor]);

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Initial Content Plugin
// ─────────────────────────────────────────────────────────────────

function InitialContentPlugin({ content }: { content?: string }) {
  const [editor] = useLexicalComposerContext();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (content && !initialized) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(content));
        root.append(paragraph);
      });
      setInitialized(true);
    }
  }, [editor, content, initialized]);

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Main Editor Component
// ─────────────────────────────────────────────────────────────────

export function Editor({
  initialValue,
  onChange,
  onChangeState,
  placeholder = "Start writing...",
  className,
  contentClassName,
  editable = true,
  autoFocus = false,
  borderless = false,
  hideToolbar = false,
}: EditorProps) {
  // Determine if initialValue is serialized state or plain text
  const isSerializedState = initialValue && typeof initialValue === "object" && "root" in initialValue;

  const initialConfig = {
    namespace: "Editor",
    theme: editorTheme,
    onError: (error: Error) => {
      console.error("Lexical error:", error);
    },
    nodes: [ListNode, ListItemNode, LinkNode, HeadingNode, QuoteNode, CodeNode, ImageNode],
    editable,
    // Load serialized state if provided
    editorState: isSerializedState ? JSON.stringify(initialValue) : undefined,
  };

  const handleChange = (editorState: EditorState) => {
    editorState.read(() => {
      if (onChange) {
        const root = $getRoot();
        const text = root.getTextContent();
        onChange(text);
      }
      if (onChangeState) {
        onChangeState(editorState.toJSON());
      }
    });
  };

  // Only use InitialContentPlugin for plain text (not serialized state)
  const initialContent = typeof initialValue === "string" ? initialValue : undefined;

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        className={cn(
          "relative flex flex-col overflow-hidden",
          !borderless && "rounded-lg border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
          className
        )}
      >
        {!hideToolbar && <ToolbarPlugin />}
        <div className="relative flex-1 min-h-0">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "h-full overflow-y-auto px-3 py-2 text-sm outline-none",
                  "text-[var(--tropx-text-main)]",
                  !borderless && "min-h-[120px] max-h-[300px]",
                  contentClassName
                )}
              />
            }
            placeholder={
              <div className="pointer-events-none absolute top-2 left-3 text-sm text-[var(--tropx-text-sub)]">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <ImagePlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
        {autoFocus && <AutoFocusPlugin />}
        {initialContent && <InitialContentPlugin content={initialContent} />}
      </div>
    </LexicalComposer>
  );
}

export default Editor;
