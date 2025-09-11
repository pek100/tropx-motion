import { contextBridge, ipcRenderer } from 'electron';
import { ApiResponse, DeviceConnectionResponse, RecordingResponse, RecordingSession } from '../shared/types';

export interface ElectronAPI {
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