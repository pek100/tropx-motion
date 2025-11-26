import { contextBridge, ipcRenderer } from 'electron';
import { ApiResponse, DeviceConnectionResponse, RecordingResponse, RecordingSession } from '../shared/types';

export interface ElectronAPI {
    // Quick access for WebSocket port (used by new tropx-ws-client)
    getWSPort: () => Promise<number>;

    window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
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
}

const electronAPI: ElectronAPI = {
    getWSPort: () => ipcRenderer.invoke('motion:getWebSocketPort'),

    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
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