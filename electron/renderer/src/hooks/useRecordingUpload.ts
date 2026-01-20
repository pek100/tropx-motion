/**
 * useRecordingUpload - React hook for uploading recordings to Convex.
 *
 * Features:
 * - Upload with progress tracking
 * - Offline queue with auto-retry
 * - Toast notifications
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useConvex } from 'convex/react';
import { ConvexClient } from 'convex/browser';
import { useToast } from '@/hooks/use-toast';
import { Id } from '../../../../convex/_generated/dataModel';
import { RawDeviceSample } from '../../../../motionProcessing/recording/types';
import {
  UploadService,
  UploadProgress,
  UploadResult,
  UploadOptions,
} from '../lib/recording/UploadService';
import {
  OfflineHandler,
  OfflineHandlerOptions,
} from '../lib/recording/OfflineHandler';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

export interface UseRecordingUploadOptions {
  subjectId?: Id<'users'>;
  subjectAlias?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  activityProfile?: ActivityProfile;
  sets?: number;
  reps?: number;
  cropRange?: { startMs: number; endMs: number };
}

export interface UseRecordingUploadReturn {
  // State
  isUploading: boolean;
  progress: UploadProgress | null;
  lastResult: UploadResult | null;
  isConnected: boolean;
  queueLength: number;

  // Actions
  upload: (
    samples: RawDeviceSample[],
    options?: UseRecordingUploadOptions
  ) => Promise<UploadResult>;
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useRecordingUpload(): UseRecordingUploadReturn {
  const convex = useConvex();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [queueLength, setQueueLength] = useState(0);

  const offlineHandlerRef = useRef<OfflineHandler | null>(null);
  const toastRef = useRef(toast);

  // Keep toast ref updated
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Initialize offline handler
  useEffect(() => {
    // Create a ConvexClient for the upload service
    // Note: In production, you'd want to share the client or use a different approach
    const client = convex as unknown as ConvexClient;

    const offlineOptions: OfflineHandlerOptions = {
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (connected) {
          toastRef.current({
            title: 'Connection Restored',
            description: 'Uploads will resume.',
          });
        } else {
          toastRef.current({
            title: 'Connection Lost',
            description: 'Uploads will resume when online.',
            variant: 'destructive',
          });
        }
      },
      onUploadSuccess: (result) => {
        toastRef.current({
          title: 'Recording Saved',
          description: `${result.totalSamples} samples uploaded successfully.`,
        });
      },
      onUploadError: (error) => {
        toastRef.current({
          title: 'Upload Failed',
          description: error,
          variant: 'destructive',
        });
      },
      onQueueChange: (length) => {
        setQueueLength(length);
      },
    };

    offlineHandlerRef.current = new OfflineHandler(client, offlineOptions);

    return () => {
      offlineHandlerRef.current?.destroy();
    };
  }, [convex]);

  const upload = useCallback(
    async (
      samples: RawDeviceSample[],
      options: UseRecordingUploadOptions = {}
    ): Promise<UploadResult> => {
      if (!offlineHandlerRef.current) {
        return {
          success: false,
          error: 'Upload service not initialized',
        };
      }

      setIsUploading(true);
      setProgress({
        phase: 'processing',
        currentChunk: 0,
        totalChunks: 0,
        message: 'Preparing upload...',
      });

      try {
        const uploadOptions: UploadOptions = {
          subjectId: options.subjectId,
          subjectAlias: options.subjectAlias,
          title: options.title,
          notes: options.notes,
          tags: options.tags,
          activityProfile: options.activityProfile,
          sets: options.sets,
          reps: options.reps,
          cropRange: options.cropRange,
        };

        // Use the upload service directly for progress tracking
        const client = convex as unknown as ConvexClient;
        const uploadService = new UploadService(client);

        const result = await uploadService.upload(
          samples,
          uploadOptions,
          (prog) => setProgress(prog)
        );

        setLastResult(result);

        if (result.success) {
          toast({
            title: 'Recording Saved',
            description: `${result.totalSamples} samples in ${result.totalChunks} chunks.`,
          });
        } else if (!isConnected) {
          toast({
            title: 'Recording Queued',
            description: 'Will upload when connection is restored.',
          });
        } else {
          toast({
            title: 'Upload Failed',
            description: result.error || 'Unknown error',
            variant: 'destructive',
          });
        }

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        const result: UploadResult = {
          success: false,
          error: errorMessage,
        };

        setLastResult(result);
        toast({
          title: 'Upload Failed',
          description: errorMessage,
          variant: 'destructive',
        });

        return result;
      } finally {
        setIsUploading(false);
        setProgress(null);
      }
    },
    [convex, isConnected, toast]
  );

  return {
    isUploading,
    progress,
    lastResult,
    isConnected,
    queueLength,
    upload,
  };
}

export default useRecordingUpload;
