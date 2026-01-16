/**
 * ImagePlugin - Handles image paste and drag-drop in the Lexical editor.
 * Uploads images to Convex storage and creates ImageNodes with storageId references.
 */

import { useEffect, useCallback, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $insertNodes,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  LexicalCommand,
  PASTE_COMMAND,
  DROP_COMMAND,
} from "lexical";
import { useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { $createImageNode, ImagePayload } from "./ImageNode";

// Command for inserting images programmatically
export const INSERT_IMAGE_COMMAND: LexicalCommand<ImagePayload> =
  createCommand("INSERT_IMAGE_COMMAND");

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Supported image types
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Result of uploading an image to Convex storage */
interface UploadResult {
  storageId: string;
  altText: string;
}

/**
 * Validate an image file before upload
 */
function validateImageFile(file: File): boolean {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    console.warn(`Unsupported image type: ${file.type}`);
    return false;
  }

  if (file.size > MAX_FILE_SIZE) {
    console.warn(`Image too large: ${file.size} bytes (max ${MAX_FILE_SIZE})`);
    return false;
  }

  return true;
}

/**
 * Upload a file to Convex storage using a presigned URL
 */
async function uploadToConvex(
  file: File,
  getUploadUrl: () => Promise<string>
): Promise<string> {
  // Get presigned upload URL from Convex
  const uploadUrl = await getUploadUrl();

  // Upload the file
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  // Get the storageId from the response
  const { storageId } = await response.json();
  return storageId;
}

/**
 * Get image files from a DataTransfer object
 */
function getImageFilesFromDataTransfer(
  dataTransfer: DataTransfer
): File[] {
  const files: File[] = [];

  // Check items first (for paste events)
  if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  // Fallback to files (for drop events)
  if (files.length === 0 && dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      if (file.type.startsWith("image/")) {
        files.push(file);
      }
    }
  }

  return files;
}

export function ImagePlugin(): null {
  const [editor] = useLexicalComposerContext();
  const generateUploadUrl = useMutation(api.notes.generateUploadUrl);
  const registerUpload = useMutation(api.notes.registerUpload);

  // Store mutations in refs to avoid stale closures in event handlers
  const generateUploadUrlRef = useRef(generateUploadUrl);
  const registerUploadRef = useRef(registerUpload);
  generateUploadUrlRef.current = generateUploadUrl;
  registerUploadRef.current = registerUpload;

  // Process and upload an image file
  const processAndUploadImage = useCallback(
    async (file: File, altText: string): Promise<UploadResult | null> => {
      if (!validateImageFile(file)) {
        return null;
      }

      try {
        const storageId = await uploadToConvex(file, () =>
          generateUploadUrlRef.current({})
        );

        // Register upload for orphan tracking
        // This ensures abandoned uploads (user closes modal without saving) get cleaned up
        await registerUploadRef.current({ storageId: storageId as any });

        return { storageId, altText };
      } catch (error) {
        console.error("Failed to upload image:", error);
        return null;
      }
    },
    []
  );

  useEffect(() => {
    // Register the INSERT_IMAGE_COMMAND handler
    const unregisterInsertCommand = editor.registerCommand<ImagePayload>(
      INSERT_IMAGE_COMMAND,
      (payload) => {
        const imageNode = $createImageNode(payload);
        $insertNodes([imageNode]);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    // Handle paste events
    const unregisterPasteCommand = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const imageFiles = getImageFilesFromDataTransfer(clipboardData);
        if (imageFiles.length === 0) return false;

        // Process each image
        event.preventDefault();
        imageFiles.forEach(async (file) => {
          const result = await processAndUploadImage(
            file,
            file.name || "Pasted image"
          );
          if (result) {
            editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
              storageId: result.storageId,
              altText: result.altText,
            });
          }
        });

        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    // Handle drop events
    const unregisterDropCommand = editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return false;

        const imageFiles = getImageFilesFromDataTransfer(dataTransfer);
        if (imageFiles.length === 0) return false;

        // Process each image
        event.preventDefault();
        imageFiles.forEach(async (file) => {
          const result = await processAndUploadImage(
            file,
            file.name || "Dropped image"
          );
          if (result) {
            editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
              storageId: result.storageId,
              altText: result.altText,
            });
          }
        });

        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      unregisterInsertCommand();
      unregisterPasteCommand();
      unregisterDropCommand();
    };
  }, [editor, processAndUploadImage]);

  return null;
}

export default ImagePlugin;
