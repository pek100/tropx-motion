import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
    window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
    };

    motion: {
        getStatus: () => Promise<any>;
        connectDevices: () => Promise<{ success: boolean; message: string }>;
        scanDevices: () => Promise<{ success: boolean; message: string }>;
        connectToDevice: (deviceName: string) => Promise<{ success: boolean; message: string }>;
        startRecording: (sessionData: any) => Promise<{ success: boolean; message: string; recordingId?: string }>;
        stopRecording: () => Promise<{ success: boolean; message: string; recordingId?: string }>;
        getWebSocketPort: () => Promise<number>;
    };

    system: {
        platform: string;
        arch: string;
        version: string;
    };
}

const electronAPI: ElectronAPI = {
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

    system: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
    },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}