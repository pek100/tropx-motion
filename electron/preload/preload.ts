import { contextBridge, ipcRenderer } from 'electron';
import { ApiResponse, DeviceConnectionResponse, RecordingResponse, RecordingSession } from '../shared/types';

export interface ElectronAPI {
    // Quick access for WebSocket port (used by new tropx-ws-client)
    getWSPort: () => Promise<number>;

    // Config (environment variables)
    config: {
        convexUrl: string | undefined;
    };

    // OAuth authentication
    auth: {
        signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
        signOut: () => Promise<{ success: boolean; error?: string }>;
    };

    window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
    };

    zoom: {
        in: () => Promise<void>;
        out: () => Promise<void>;
        reset: () => Promise<void>;
        get: () => Promise<number>;
    };

    motion: {
        getStatus: () => Promise<unknown>;
        connectDevices: () => Promise<ApiResponse>;
        scanDevices: () => Promise<ApiResponse>;
        connectToDevice: (deviceName: string) => Promise<DeviceConnectionResponse>;
        startRecording: (sessionData: RecordingSession) => Promise<RecordingResponse>;
        stopRecording: () => Promise<RecordingResponse>;
        getWebSocketPort: () => Promise<number>;
    };

    bluetooth: {
        selectDevice: (deviceId: string) => Promise<ApiResponse>;
        getSystemInfo: () => Promise<unknown>;
    };

    monitor: {
        start: (opts?: { intervalMs?: number }) => Promise<{ running?: boolean; error?: string }>;

        stop: () => Promise<{ running?: boolean; error?: string }>;
        status: () => Promise<{ running: boolean }>;
        getSnapshot: () => Promise<any>;
        getRecentSamples: (limit?: number) => Promise<any[]>;
        setInterval: (intervalMs: number) => Promise<{ ok?: boolean; error?: string }>;
    };

    system: {
        platform: string;
        arch: string;
        version: string;
        getPlatformInfo: () => Promise<any>;
    };

    testClient: {
        discoverPort: () => Promise<{ success: boolean; port?: number; url?: string; error?: string }>;
    };

    file: {
        writeCSV: (filePath: string, content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
        openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        openFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        selectFolder: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
        importCSV: () => Promise<{ success: boolean; content?: string; filePath?: string; fileName?: string; canceled?: boolean; error?: string }>;
    };

    recording: {
        start: () => Promise<{ success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean; error?: string }>;
        getState: () => Promise<{ isRecording: boolean; sampleCount: number; durationMs: number; startTime: number | null; error?: string }>;
        export: (options?: { interpolated?: boolean; outputPath?: string }) => Promise<{ success: boolean; filePath?: string; fileName?: string; sampleCount?: number; error?: string }>;
        clear: () => Promise<{ success: boolean; error?: string }>;
        getSamples: () => Promise<{
            success: boolean;
            samples: Array<{ t: number; lq: { w: number; x: number; y: number; z: number } | null; rq: { w: number; x: number; y: number; z: number } | null }>;
            metadata: { startTime: number; endTime: number; sampleCount: number; targetHz: number } | null;
            sampleCount: number;
            error?: string;
        }>;
    };
}

const electronAPI: ElectronAPI = {
    getWSPort: () => ipcRenderer.invoke('motion:getWebSocketPort'),

    config: {
        convexUrl: process.env.VITE_CONVEX_URL,
    },

    auth: {
        signInWithGoogle: () => ipcRenderer.invoke('auth:signInWithGoogle'),
        signOut: () => ipcRenderer.invoke('auth:signOut'),
    },

    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
    },

    zoom: {
        in: () => ipcRenderer.invoke('zoom:in'),
        out: () => ipcRenderer.invoke('zoom:out'),
        reset: () => ipcRenderer.invoke('zoom:reset'),
        get: () => ipcRenderer.invoke('zoom:get'),
    },

    motion: {
        getStatus: () => ipcRenderer.invoke('motion:getStatus'),
        connectDevices: () => ipcRenderer.invoke('motion:connectDevices'),
        scanDevices: () => ipcRenderer.invoke('motion:scanDevices'),
        connectToDevice: (deviceName: string) => ipcRenderer.invoke('motion:connectToDevice', deviceName),
        startRecording: (sessionData) => ipcRenderer.invoke('motion:startRecording', sessionData),
        stopRecording: () => ipcRenderer.invoke('motion:stopRecording'),
        getWebSocketPort: () => ipcRenderer.invoke('motion:getWebSocketPort'),
    },

    bluetooth: {
        selectDevice: (deviceId: string) => ipcRenderer.invoke('bluetooth:selectDevice', deviceId),
        getSystemInfo: () => ipcRenderer.invoke('bluetooth:getSystemInfo'),
    },

    monitor: {
        start: (opts) => ipcRenderer.invoke('monitor:start', opts),
        stop: () => ipcRenderer.invoke('monitor:stop'),
        status: () => ipcRenderer.invoke('monitor:status'),
        getSnapshot: () => ipcRenderer.invoke('monitor:getSnapshot'),
        getRecentSamples: (limit?: number) => ipcRenderer.invoke('monitor:getRecentSamples', limit),
        setInterval: (intervalMs: number) => ipcRenderer.invoke('monitor:setInterval', intervalMs),
    },

    system: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        getPlatformInfo: () => ipcRenderer.invoke('system:getPlatformInfo'),
    },

    testClient: {
        discoverPort: () => ipcRenderer.invoke('testClient:discoverPort'),
    },

    file: {
        writeCSV: (filePath: string, content: string) => ipcRenderer.invoke('file:writeCSV', filePath, content),
        openFile: (filePath: string) => ipcRenderer.invoke('file:openFile', filePath),
        openFolder: (filePath: string) => ipcRenderer.invoke('file:openFolder', filePath),
        selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
        importCSV: () => ipcRenderer.invoke('file:importCSV'),
    },

    recording: {
        start: () => ipcRenderer.invoke('recording:start'),
        stop: () => ipcRenderer.invoke('recording:stop'),
        getState: () => ipcRenderer.invoke('recording:getState'),
        export: (options) => ipcRenderer.invoke('recording:export', options),
        clear: () => ipcRenderer.invoke('recording:clear'),
        getSamples: () => ipcRenderer.invoke('recording:getSamples'),
    },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
    interface Window {
        electronAPI: ElectronAPI;
        electron: {
            getWSPort: () => Promise<number>;
        };
    }
}

// Also expose simplified electron API for new components
contextBridge.exposeInMainWorld('electron', {
    getWSPort: () => ipcRenderer.invoke('motion:getWebSocketPort'),
});