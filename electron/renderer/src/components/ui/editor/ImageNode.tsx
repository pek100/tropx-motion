/**
 * ImageNode - Custom Lexical node for displaying images in the editor.
 * Images are stored in Convex storage and referenced by storageId.
 */

import { useState, type ReactNode } from "react";
import {
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  $applyNodeReplacement,
} from "lexical";
import { useQuery } from "@/lib/customConvex";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ImagePayload {
  storageId: string;
  altText?: string;
  width?: number;
  height?: number;
  key?: NodeKey;
}

export type SerializedImageNode = Spread<
  {
    storageId: string;
    altText: string;
    width?: number;
    height?: number;
  },
  SerializedLexicalNode
>;

// ─────────────────────────────────────────────────────────────────
// DOM Conversion
// ─────────────────────────────────────────────────────────────────

function convertImageElement(domNode: Node): null | DOMConversionOutput {
  // DOM images cannot be converted - they don't have storageId
  // Only Lexical JSON serialization is supported for images
  return null;
}

// ─────────────────────────────────────────────────────────────────
// ImageNode Class
// ─────────────────────────────────────────────────────────────────

export class ImageNode extends DecoratorNode<ReactNode> {
  __storageId: string;
  __altText: string;
  __width?: number;
  __height?: number;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__storageId,
      node.__altText,
      node.__width,
      node.__height,
      node.__key
    );
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const { storageId, altText, width, height } = serializedNode;
    return $createImageNode({ storageId, altText, width, height });
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 0,
      }),
    };
  }

  constructor(
    storageId: string,
    altText?: string,
    width?: number,
    height?: number,
    key?: NodeKey
  ) {
    super(key);
    this.__storageId = storageId;
    this.__altText = altText || "";
    this.__width = width;
    this.__height = height;
  }

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      version: 1,
      storageId: this.__storageId,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
    };
  }

  exportDOM(): DOMExportOutput {
    // DOM export creates placeholder - actual image requires storageId resolution
    const img = document.createElement("img");
    img.setAttribute("data-storage-id", this.__storageId);
    img.setAttribute("alt", this.__altText);
    if (this.__width) img.setAttribute("width", String(this.__width));
    if (this.__height) img.setAttribute("height", String(this.__height));
    return { element: img };
  }

  createDOM(): HTMLElement {
    const div = document.createElement("div");
    div.style.display = "contents";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  getStorageId(): string {
    return this.__storageId;
  }

  getAltText(): string {
    return this.__altText;
  }

  decorate(): ReactNode {
    return (
      <ImageComponent
        storageId={this.__storageId}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        nodeKey={this.__key}
      />
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// Image Component (rendered by DecoratorNode)
// ─────────────────────────────────────────────────────────────────

interface ImageComponentProps {
  storageId: string;
  altText: string;
  width?: number;
  height?: number;
  nodeKey: NodeKey;
}

function ImageComponent({
  storageId,
  altText,
  width,
  height,
}: ImageComponentProps): ReactNode {
  const [error, setError] = useState(false);

  // Query Convex for the image URL
  const imageUrl = useQuery(
    api.notes.getImageUrl,
    { storageId: storageId as Id<"_storage"> }
  );

  // Loading state: imageUrl is undefined while query is in flight
  if (imageUrl === undefined) {
    return (
      <div className="my-2 flex justify-center">
        <div className="w-32 h-32 rounded-lg border border-[var(--tropx-border)] bg-[var(--tropx-muted)] flex items-center justify-center">
          <span className="text-xs text-[var(--tropx-text-sub)]">Loading...</span>
        </div>
      </div>
    );
  }

  // Error state: imageUrl is null (not found) or image failed to load
  if (error || imageUrl === null) {
    return (
      <div className="my-2 flex justify-center">
        <div className="w-32 h-32 rounded-lg border border-red-300 bg-red-50 flex items-center justify-center">
          <span className="text-xs text-red-500">Image unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 flex justify-center">
      <img
        src={imageUrl}
        alt={altText}
        width={width}
        height={height}
        className="max-w-full h-auto rounded-lg border border-[var(--tropx-border)]"
        style={{ maxHeight: "300px", objectFit: "contain" }}
        draggable={false}
        onError={() => setError(true)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

export function $createImageNode({
  storageId,
  altText,
  width,
  height,
  key,
}: ImagePayload): ImageNode {
  return $applyNodeReplacement(
    new ImageNode(storageId, altText, width, height, key)
  );
}

export function $isImageNode(
  node: LexicalNode | null | undefined
): node is ImageNode {
  return node instanceof ImageNode;
}
