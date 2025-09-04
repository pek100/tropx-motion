// electron/preload/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

// Define the API that will be exposed to the renderer process
export interface ElectronAPI {
    // Window controls
    window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
    };

    // Motion processing API
    motion: {
        getStatus: () => Promise<any>;
        connectDevices: () => Promise<{ success: boolean; message: string }>;
        startRecording: (sessionData: any) => Promise<{ success: boolean; message: string; recordingId?: string }>;
        stopRecording: () => Promise<{ success: boolean; message: string; recordingId?: string }>;
        getWebSocketPort: () => Promise<number>;
    };

    // System info
    system: {
        platform: string;
        arch: string;
        version: string;
    };
}

// Create the API object
const electronAPI: ElectronAPI = {
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
    },

    motion: {
        getStatus: () => ipcRenderer.invoke('motion:getStatus'),
        connectDevices: () => ipcRenderer.invoke('motion:connectDevices'),
        startRecording: (sessionData) => ipcRenderer.invoke('motion:startRecording', sessionData),
        stopRecording: () => ipcRenderer.invoke('motion:stopRecording'),
        getWebSocketPort: () => ipcRenderer.invoke('motion:getWebSocketPort'),
    },

    system: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
    },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for TypeScript support in renderer
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}