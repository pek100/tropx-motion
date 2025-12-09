import { useState, useCallback } from 'react';
import {
  RecordingBuffer,
  generateCSV,
  generateFilename,
  getDefaultExportPath,
  setDefaultExportPath,
  resetExportPath,
  parseCSV,
  type ImportedRecording
} from '../lib/recording';

interface ExportResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}

interface ImportResult {
  success: boolean;
  recording?: ImportedRecording;
  error?: string;
  canceled?: boolean;
}

interface UseRecordingExportReturn {
  // Export
  isExporting: boolean;
  lastExport: ExportResult | null;
  exportPath: string;
  exportCSV: () => Promise<ExportResult>;
  openFile: (filePath: string) => Promise<void>;
  openFolder: (filePath: string) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  setExportPath: (path: string) => void;
  resetPath: () => void;
  hasRecordingData: () => boolean;
  // Import
  isImporting: boolean;
  importedRecording: ImportedRecording | null;
  importCSV: () => Promise<ImportResult>;
  clearImport: () => void;
}

export function useRecordingExport(): UseRecordingExportReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [exportPath, setExportPathState] = useState(getDefaultExportPath());

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importedRecording, setImportedRecording] = useState<ImportedRecording | null>(null);

  const exportCSV = useCallback(async (): Promise<ExportResult> => {
    if (RecordingBuffer.isEmpty()) {
      const result = { success: false, error: 'No recording data to export' };
      setLastExport(result);
      return result;
    }

    // Check if electronAPI is available
    if (!window.electronAPI?.file?.writeCSV) {
      const result = { success: false, error: 'Export not available (running outside Electron)' };
      setLastExport(result);
      return result;
    }

    setIsExporting(true);

    try {
      const csvContent = generateCSV({ includeMetadata: true });

      if (!csvContent) {
        const result: ExportResult = {
          success: false,
          error: 'Failed to generate CSV content'
        };
        setLastExport(result);
        return result;
      }

      const fileName = generateFilename();
      const filePath = `${exportPath}/${fileName}`;

      const response = await window.electronAPI.file.writeCSV(filePath, csvContent);

      if (response.success) {
        const result: ExportResult = {
          success: true,
          filePath: response.filePath,
          fileName
        };
        setLastExport(result);
        // Data kept until new recording starts
        return result;
      } else {
        const result: ExportResult = {
          success: false,
          error: response.error || 'Failed to write file'
        };
        setLastExport(result);
        return result;
      }
    } catch (err) {
      const result: ExportResult = {
        success: false,
        error: err instanceof Error ? err.message : 'Export failed'
      };
      setLastExport(result);
      return result;
    } finally {
      setIsExporting(false);
    }
  }, [exportPath]);

  const importCSV = useCallback(async (): Promise<ImportResult> => {
    // Check if electronAPI is available
    if (!window.electronAPI?.file?.importCSV) {
      return { success: false, error: 'Import not available (running outside Electron)' };
    }

    setIsImporting(true);

    try {
      const response = await window.electronAPI.file.importCSV();

      if (response.canceled) {
        return { success: false, canceled: true };
      }

      if (!response.success || !response.content) {
        return { success: false, error: response.error || 'Failed to read file' };
      }

      const recording = parseCSV(response.content, response.fileName || 'unknown.csv');

      if (recording.samples.length === 0) {
        return { success: false, error: 'No valid data found in CSV' };
      }

      setImportedRecording(recording);
      return { success: true, recording };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Import failed'
      };
    } finally {
      setIsImporting(false);
    }
  }, []);

  const clearImport = useCallback(() => {
    setImportedRecording(null);
  }, []);

  const openFile = useCallback(async (filePath: string) => {
    await window.electronAPI.file.openFile(filePath);
  }, []);

  const openFolder = useCallback(async (filePath: string) => {
    await window.electronAPI.file.openFolder(filePath);
  }, []);

  const selectFolder = useCallback(async (): Promise<string | null> => {
    const result = await window.electronAPI.file.selectFolder();
    if (result.success && result.path) {
      setDefaultExportPath(result.path);
      setExportPathState(result.path);
      return result.path;
    }
    return null;
  }, []);

  const setExportPath = useCallback((path: string) => {
    setDefaultExportPath(path);
    setExportPathState(path);
  }, []);

  const resetPath = useCallback(() => {
    resetExportPath();
    setExportPathState(getDefaultExportPath());
  }, []);

  const hasRecordingData = useCallback(() => {
    return !RecordingBuffer.isEmpty();
  }, []);

  return {
    // Export
    isExporting,
    lastExport,
    exportPath,
    exportCSV,
    openFile,
    openFolder,
    selectFolder,
    setExportPath,
    resetPath,
    hasRecordingData,
    // Import
    isImporting,
    importedRecording,
    importCSV,
    clearImport
  };
}
