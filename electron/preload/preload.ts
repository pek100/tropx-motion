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

    bluetooth: {
        selectDevice: (deviceId: string) => Promise<{ success: boolean; message: string }>;
        connectManual: (deviceName: string) => Promise<{ success: boolean; message: string }>;
        scanEnhanced: () => Promise<{ success: boolean; message: string }>;
        cancelSelection: () => Promise<{ success: boolean; message: string }>;
        pairingResponse: (response: any) => Promise<{ success: boolean; message: string }>;
        getSystemInfo: () => Promise<any>;
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

    bluetooth: {
        selectDevice: (deviceId: string) => ipcRenderer.invoke('bluetooth:selectDevice', deviceId),
        connectManual: (deviceName: string) => ipcRenderer.invoke('bluetooth:connectManual', deviceName),
        scanEnhanced: () => ipcRenderer.invoke('bluetooth:scanEnhanced'),
        cancelSelection: () => ipcRenderer.invoke('bluetooth:cancelSelection'),
        pairingResponse: (response: any) => ipcRenderer.invoke('bluetooth:pairingResponse', response),
        getSystemInfo: () => ipcRenderer.invoke('bluetooth:getSystemInfo'),
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