"use client"
import * as React from "react"
import { useState, useEffect, useCallback, useRef, useReducer } from "react"
import {
  Play,
  Pause,
  Wifi,
  WifiOff,
  Zap,
  Minimize2,
  Maximize2,
  X,
  Settings,
  Activity,
  Bluetooth,
  Loader2,
} from "lucide-react"
// MotionProcessingCoordinator removed from renderer - processing happens in main process
import { EnhancedMotionDataDisplay } from "./components"
import { museManager } from "../../muse_sdk/core/MuseManager"
import { UnifiedBinaryProtocol } from "../shared/BinaryProtocol"
import type { WSMessage, DeviceInfo } from "../shared/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

// Company Logo SVG Component
const CompanyLogo: React.FC<{ className?: string }> = ({ className = "w-8 h-8" }) => (
    <svg className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
          d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z"
          fill="#FF4D35"
      />
      <path
          d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.077 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z"
          fill="#FF4D35"
      />
    </svg>
)

// Constants
const CONSTANTS = {
  WEBSOCKET: {
    DEFAULT_PORT: 8080,
    RECONNECT_DELAY_BASE: 1000,
    MAX_RECONNECT_DELAY: 10000,
    MAX_RECONNECT_ATTEMPTS: 5,
    CONNECTION_TIMEOUT: 120000,
  },
  TIMEOUTS: {
    DEVICE_SELECTION_WAIT: 500,
    CONNECTION_CLEANUP: 1000,
    DEVICE_DISCOVERY_TRIGGER: 1000,
    SCAN_DURATION: 15000,
    FINAL_RESET_WAIT: 2000,
    FAST_CONNECTION_TIMEOUT: 5000,
  },
  BATTERY: {
    UPDATE_INTERVAL: 30000,
    LOW_BATTERY_THRESHOLD: 20,
  },
  SERVICES: {
    TROPX_SERVICE_UUID: "c8c0a708-e361-4b5e-a365-98fa6b0a836f",
  },
  UI: {
    COLORS: {
      PRIMARY: "#FF4D35",
      PRIMARY_HOVER: "#e63e2b",
      DARK: "#1F1E24",
      GREYISH: "#55535F",
      CORAL_PINK: "#FFBDAD",
      SUCCESS: "#10b981",
      WARNING: "#f59e0b",
      ERROR: "#ef4444",
      STREAMING: "#FF4D35",
      DISCOVERED: "#3b82f6",
      DISCONNECTED: "#6b7280",
      CONNECTING: "#f59e0b",
    },
  },
};

import { MotionProcessingConsumer } from "../../motionProcessing/MotionProcessingConsumer";

// Create minimal consumer for renderer - no heavy processing
const motionProcessingConsumer = new MotionProcessingConsumer();

// Type definitions for Electron API
declare global {
  interface Window {
    electronAPI?: {
      motion: {
        getWebSocketPort(): Promise<number>;
        scanDevices(): Promise<{ success: boolean; message?: string }>;
        connectToDevice(sessionData: any): Promise<{ success: boolean; message?: string }>;
        stopRecording(): Promise<{ success: boolean; message?: string }>;
      };
      bluetooth?: {
        selectDevice(deviceId: string): Promise<any>;
      };
      window: {
        minimize(): void;
        maximize(): void;
        close(): void;
      };
    };
  }
}

// Device state machine types
type DeviceState = "discovered" | "connecting" | "connected" | "streaming" | "disconnected" | "error";

interface DeviceStateMachine {
  id: string;
  name: string;
  state: DeviceState;
  batteryLevel: number | null;
  lastSeen: Date;
  errorMessage?: string;
}

// Unified App State
interface AppState {
  // WebSocket
  wsPort: number;
  isConnected: boolean;
  // Devices - single source of truth
  allDevices: Map<string, DeviceStateMachine>;
  // App States
  isRecording: boolean;
  isScanning: boolean;
  // Motion Data
  motionData: any; // relaxed type; component handles parsing
  status: any;
  recordingStartTime: Date | null;
}

// Action Types
type AppAction =
    | { type: "SET_WS_PORT"; payload: number }
    | { type: "SET_WS_CONNECTED"; payload: boolean }
    | { type: "SET_DEVICE_STATE"; payload: { deviceId: string; device: DeviceStateMachine } }
    | { type: "UPDATE_DEVICE"; payload: { deviceId: string; updates: Partial<DeviceStateMachine> } }
    | { type: "REMOVE_DEVICE"; payload: string }
    | { type: "CLEAR_ALL_DEVICES" }
    | { type: "SET_SCANNING"; payload: boolean }
    | { type: "SET_RECORDING"; payload: { isRecording: boolean; startTime?: Date | null } }
    | { type: "SET_MOTION_DATA"; payload: any }
    | { type: "SET_STATUS"; payload: any }
    | { type: "TRANSITION_FROM_CONNECTING"; payload: { deviceId: string; newState: DeviceState } }
    | { type: "CLEAR_NON_CONNECTING_DEVICES" };

// Initial State
const initialState: AppState = {
  wsPort: CONSTANTS.WEBSOCKET.DEFAULT_PORT,
  isConnected: false,
  allDevices: new Map(),
  isRecording: false,
  isScanning: false,
  motionData: null,
  status: null,
  recordingStartTime: null,
};

// App State Reducer
function appStateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_WS_PORT":
      return { ...state, wsPort: action.payload };
    case "SET_WS_CONNECTED":
      return { ...state, isConnected: action.payload };
    case "SET_DEVICE_STATE": {
      const newDevices = new Map(state.allDevices);
      newDevices.set(action.payload.deviceId, action.payload.device);
      return { ...state, allDevices: newDevices };
    }
    case "UPDATE_DEVICE": {
      const newDevices = new Map(state.allDevices);
      const existing = newDevices.get(action.payload.deviceId);
      if (existing) {
        newDevices.set(action.payload.deviceId, { ...existing, ...action.payload.updates });
      }
      return { ...state, allDevices: newDevices };
    }
    case "REMOVE_DEVICE": {
      const newDevices = new Map(state.allDevices);
      newDevices.delete(action.payload);
      return { ...state, allDevices: newDevices };
    }
    case "CLEAR_ALL_DEVICES":
      return { ...state, allDevices: new Map() };
    case "SET_SCANNING":
      return { ...state, isScanning: action.payload };
    case "SET_RECORDING":
      return {
        ...state,
        isRecording: action.payload.isRecording,
        recordingStartTime: action.payload.startTime ?? state.recordingStartTime,
      };
    case "SET_MOTION_DATA":
      return { ...state, motionData: action.payload };
    case "SET_STATUS":
      return { ...state, status: action.payload };
    case "TRANSITION_FROM_CONNECTING": {
      const newDevices = new Map(state.allDevices);
      const device = newDevices.get(action.payload.deviceId);
      if (device && device.state === "connecting") {
        newDevices.set(action.payload.deviceId, {
          ...device,
          state: action.payload.newState,
          lastSeen: new Date(),
        });
      }
      return { ...state, allDevices: newDevices };
    }
    case "CLEAR_NON_CONNECTING_DEVICES": {
      const newDevices = new Map();
      state.allDevices.forEach((device, id) => {
        // Preserve connecting, connected, and streaming devices - only remove discovered/disconnected
        if (device.state === "connecting" || device.state === "connected" || device.state === "streaming") {
          newDevices.set(id, device);
        }
      });
      return { ...state, allDevices: newDevices };
    }
    default:
      return state;
  }
}

const useWebSocket = (url: string) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const connectionInProgressRef = useRef(false);

  const connect = useCallback(() => {
    if (connectionInProgressRef.current) {
      console.log("🔌 Connection already in progress, skipping duplicate connection attempt");
      return;
    }
    try {
      connectionInProgressRef.current = true;
      console.log("🔌 Attempting WebSocket connection to:", url);
      const websocket = new WebSocket(url);
      // Prefer ArrayBuffer for binary frames to reduce overhead
      try {
        (websocket as any).binaryType = "arraybuffer";
      } catch {}
      websocket.onopen = () => {
        console.log("🔌 WebSocket connected to:", url);
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        connectionInProgressRef.current = false;
        websocket.send(JSON.stringify({ type: "request_status" }));
      };
      websocket.onmessage = async (event) => {
        try {
          let message: WSMessage;
          // Handle binary data using unified binary protocol
          if (event.data instanceof Blob) {
            const arrayBuffer = await event.data.arrayBuffer();
            const parsedMessage = UnifiedBinaryProtocol.deserialize(arrayBuffer);
            if (parsedMessage) {
              message = {
                type: parsedMessage.type as any,
                data: parsedMessage.data,
                timestamp: parsedMessage.timestamp,
              };
            } else {
              console.warn("Failed to parse binary message");
              return;
            }
          } else if (event.data instanceof ArrayBuffer) {
            // Handle direct ArrayBuffer
            const parsedMessage = UnifiedBinaryProtocol.deserialize(event.data);
            if (parsedMessage) {
              message = {
                type: parsedMessage.type as any,
                data: parsedMessage.data,
                timestamp: parsedMessage.timestamp,
              };
            } else {
              console.warn("Failed to parse ArrayBuffer message");
              return;
            }
          } else if (typeof event.data === "string") {
            // Fallback: Handle JSON data for backward compatibility
            message = JSON.parse(event.data);
          } else {
            console.warn("Received unknown message format:", typeof event.data);
            return;
          }
          setLastMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
          console.error("Message data type:", typeof event.data);
          console.error(
              "Message data preview:",
              event.data instanceof ArrayBuffer ? `ArrayBuffer(${event.data.byteLength} bytes)` : event.data,
          );
        }
      };
      websocket.onclose = () => {
        console.log("🔌 WebSocket disconnected");
        setIsConnected(false);
        setWs(null);
        connectionInProgressRef.current = false;
        if (reconnectAttemptsRef.current < CONSTANTS.WEBSOCKET.MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
              CONSTANTS.WEBSOCKET.RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttemptsRef.current),
              CONSTANTS.WEBSOCKET.MAX_RECONNECT_DELAY,
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };
      websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        connectionInProgressRef.current = false;
      };
      setWs(websocket);
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      connectionInProgressRef.current = false;
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [connect]);

  return { isConnected, lastMessage, ws };
};

const DeviceManagementPane: React.FC<{
  allDevices: Map<string, DeviceStateMachine>;
  onScan: () => void;
  onCancelScan: () => void;
  onConnectDevice: (deviceId: string, deviceName: string) => Promise<void>;
  onDisconnectDevice: (deviceId: string) => void;
  onConnectAll: () => void;
  isScanning: boolean;
  onClearDevices: () => void;
  isRecording: boolean;
}> = ({
        allDevices,
        onScan,
        onCancelScan,
        onConnectDevice,
        onDisconnectDevice,
        onConnectAll,
        isScanning,
        onClearDevices,
        isRecording,
      }) => {
  const allDevicesArray = Array.from(allDevices.values());
  const connectedCount = allDevicesArray.filter((d) => d.state === "connected" || d.state === "streaming").length;

  const getStateColor = (state: DeviceState) => {
    switch (state) {
      case "discovered":
        return "bg-blue-500";
      case "connecting":
        return "bg-yellow-500";
      case "connected":
        return "bg-green-500";
      case "streaming":
        return "bg-red-500";
      case "disconnected":
        return "bg-gray-400";
      case "error":
        return "bg-red-600";
      default:
        return "bg-gray-400";
    }
  };

  const getStateText = (state: DeviceState) => {
    switch (state) {
      case "discovered":
        return "Discovered";
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "streaming":
        return "Streaming";
      case "disconnected":
        return "Disconnected";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  return (
      <div
          className="w-80 border-r h-full flex flex-col"
          style={{
            background: `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.CORAL_PINK}08 0%, ${CONSTANTS.UI.COLORS.GREYISH}05 100%)`,
            borderColor: `${CONSTANTS.UI.COLORS.GREYISH}20`,
          }}
      >
        {/* Pane Header */}
        <div
            className="p-4 border-b"
            style={{
              background: `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.PRIMARY}08 0%, ${CONSTANTS.UI.COLORS.PRIMARY}05 100%)`,
              borderColor: `${CONSTANTS.UI.COLORS.GREYISH}20`,
            }}
        >
          <div className="flex items-center gap-2 ">
            <Settings className="w-5 h-5" style={{ color: CONSTANTS.UI.COLORS.PRIMARY }} />
            <h2 className="font-semibold" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
              Device Management
            </h2>
          </div>
        </div>
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Connection Status */}
          <Card
              className="shadow-sm border-0"
              style={{
                background: `linear-gradient(135deg, white 0%, ${CONSTANTS.UI.COLORS.CORAL_PINK}03 100%)`,
                boxShadow: `0 2px 8px ${CONSTANTS.UI.COLORS.GREYISH}15`,
              }}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                  Connection Status
                </CardTitle>
                <div className="flex items-center gap-2">
                  {connectedCount > 0 ? (
                      <Wifi className="w-4 h-4" style={{ color: CONSTANTS.UI.COLORS.PRIMARY }} />
                  ) : (
                      <WifiOff className="w-4 h-4" style={{ color: CONSTANTS.UI.COLORS.GREYISH }} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {allDevicesArray.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: CONSTANTS.UI.COLORS.GREYISH }}>Progress</span>
                      <span className="font-medium" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                    {Math.round((connectedCount / allDevicesArray.length) * 100)}%
                  </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                          className="h-full transition-all duration-300 ease-out rounded-full"
                          style={{
                            width: `${(connectedCount / allDevicesArray.length) * 100}%`,
                            background: `linear-gradient(90deg, ${CONSTANTS.UI.COLORS.PRIMARY} 0%, ${CONSTANTS.UI.COLORS.PRIMARY} 100%)`,
                          }}
                      />
                    </div>
                  </div>
              )}
              <Badge
                  variant="secondary"
                  className="mt-3 border-0"
                  style={{
                    background:
                        connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                            ? `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.PRIMARY} 0%, ${CONSTANTS.UI.COLORS.PRIMARY} 100%)`
                            : `${CONSTANTS.UI.COLORS.GREYISH}15`,
                    color:
                        connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                            ? "white"
                            : CONSTANTS.UI.COLORS.GREYISH,
                  }}
              >
                {connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                    ? "All Connected"
                    : `${connectedCount} Connected`}
              </Badge>
            </CardContent>
          </Card>
          {/* Scan Controls */}
          <Card
              className="shadow-sm border-0"
              style={{
                background: `linear-gradient(135deg, white 0%, ${CONSTANTS.UI.COLORS.CORAL_PINK}03 100%)`,
                boxShadow: `0 2px 8px ${CONSTANTS.UI.COLORS.GREYISH}15`,
              }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                Device Discovery
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex gap-2">
                <Button
                    onClick={isScanning ? onCancelScan : onScan}
                    disabled={isRecording}
                    size="sm"
                    className="flex-1 border-0 shadow-sm"
                    variant={isScanning ? "destructive" : "default"}
                    style={{
                      background: !isScanning
                          ? `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.PRIMARY} 0%, ${CONSTANTS.UI.COLORS.PRIMARY} 100%)`
                          : undefined,
                      color: !isScanning ? "white" : undefined,
                    }}
                >
                  {isScanning ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Cancel Scan
                      </>
                  ) : (
                      <>
                        <Bluetooth className="w-4 h-4 mr-2" />
                        Scan Devices
                      </>
                  )}
                </Button>
              </div>
              {allDevicesArray.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                        onClick={onConnectAll}
                        disabled={isRecording || allDevicesArray.filter((d) => d.state === "discovered").length === 0}
                        size="sm"
                        variant="outline"
                        className="flex-1"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      Connect All
                    </Button>
                    <Button
                        onClick={onClearDevices}
                        disabled={isRecording}
                        size="sm"
                        variant="outline"
                        className="flex-1 bg-transparent"
                    >
                      Clear All
                    </Button>
                  </div>
              )}
            </CardContent>
          </Card>
          {/* Device List */}
          {allDevicesArray.length > 0 && (
              <Card
                  className="shadow-sm border-0"
                  style={{
                    background: `linear-gradient(135deg, white 0%, ${CONSTANTS.UI.COLORS.CORAL_PINK}03 100%)`,
                    boxShadow: `0 2px 8px ${CONSTANTS.UI.COLORS.GREYISH}15`,
                  }}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                    Devices ({allDevicesArray.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {allDevicesArray.map((device) => (
                      <Card
                          key={device.id}
                          className="p-3 border-0 shadow-sm transition-all duration-200 hover:shadow-md"
                          style={{
                            background:
                                device.state === "connected" || device.state === "streaming"
                                    ? `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.PRIMARY}08 0%, ${CONSTANTS.UI.COLORS.PRIMARY}05 100%)`
                                    : device.state === "discovered"
                                        ? `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.CORAL_PINK}05 0%, white 100%)`
                                        : `${CONSTANTS.UI.COLORS.GREYISH}05`,
                            boxShadow:
                                device.state === "connected" || device.state === "streaming"
                                    ? `0 2px 8px ${CONSTANTS.UI.COLORS.PRIMARY}20`
                                    : `0 1px 4px ${CONSTANTS.UI.COLORS.GREYISH}10`,
                          }}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                  className="w-2 h-2 rounded-full shadow-sm"
                                  style={{
                                    backgroundColor:
                                        device.state === "connected" || device.state === "streaming"
                                            ? CONSTANTS.UI.COLORS.PRIMARY
                                            : device.state === "discovered"
                                                ? CONSTANTS.UI.COLORS.CORAL_PINK
                                                : device.state === "connecting"
                                                    ? CONSTANTS.UI.COLORS.CORAL_PINK
                                                    : CONSTANTS.UI.COLORS.GREYISH,
                                    boxShadow:
                                        device.state === "connected" || device.state === "streaming"
                                            ? `0 0 4px ${CONSTANTS.UI.COLORS.PRIMARY}50`
                                            : undefined,
                                  }}
                              />
                              <span className="font-medium text-sm" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                          {device.name}
                        </span>
                            </div>
                            {device.batteryLevel !== null && (
                                <Badge
                                    variant="outline"
                                    className="text-xs border-0"
                                    style={{
                                      background: `${CONSTANTS.UI.COLORS.PRIMARY}10`,
                                      color: CONSTANTS.UI.COLORS.PRIMARY,
                                    }}
                                >
                                  {device.batteryLevel}%
                                </Badge>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <Badge
                                variant="secondary"
                                className="text-xs border-0"
                                style={{
                                  background:
                                      device.state === "connected" || device.state === "streaming"
                                          ? `${CONSTANTS.UI.COLORS.PRIMARY}15`
                                          : device.state === "discovered"
                                              ? `${CONSTANTS.UI.COLORS.CORAL_PINK}15`
                                              : `${CONSTANTS.UI.COLORS.GREYISH}15`,
                                  color:
                                      device.state === "connected" || device.state === "streaming"
                                          ? CONSTANTS.UI.COLORS.PRIMARY
                                          : device.state === "discovered"
                                              ? CONSTANTS.UI.COLORS.PRIMARY
                                              : CONSTANTS.UI.COLORS.GREYISH,
                                }}
                            >
                              {device.state === "connecting" ? (
                                  <div className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {getStateText(device.state)}
                                  </div>
                              ) : (
                                  getStateText(device.state)
                              )}
                            </Badge>
                            {device.state === "discovered" && (
                                <Button
                                    onClick={() => onConnectDevice(device.id, device.name)}
                                    disabled={isRecording}
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs border-0 shadow-sm"
                                    style={{
                                      background: `linear-gradient(135deg, ${CONSTANTS.UI.COLORS.PRIMARY} 0%, ${CONSTANTS.UI.COLORS.PRIMARY} 100%)`,
                                      color: "white",
                                    }}
                                >
                                  Connect
                                </Button>
                            )}
                            {(device.state === "connected" || device.state === "streaming") && (
                                <Button
                                    onClick={() => onDisconnectDevice(device.id)}
                                    disabled={isRecording}
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    style={{
                                      borderColor: `${CONSTANTS.UI.COLORS.GREYISH}30`,
                                      color: CONSTANTS.UI.COLORS.GREYISH,
                                    }}
                                >
                                  Disconnect
                                </Button>
                            )}
                          </div>
                          {device.errorMessage && (
                              <p
                                  className="text-xs p-2 rounded"
                                  style={{
                                    color: "#dc2626",
                                    background: "#fef2f2",
                                  }}
                              >
                                {device.errorMessage}
                              </p>
                          )}
                          <p className="text-xs text-muted-foreground">Last seen: {device.lastSeen.toLocaleTimeString()}</p>
                        </div>
                      </Card>
                  ))}
                </CardContent>
              </Card>
          )}
          {allDevicesArray.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <Bluetooth className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No devices found</p>
                  <p className="text-xs text-muted-foreground mt-1">Start scanning to discover motion sensors</p>
                </CardContent>
              </Card>
          )}
        </div>
      </div>
  );
};

const DeviceManagementSidebar: React.FC<{
  allDevices: Map<string, DeviceStateMachine>;
  onScan: () => void;
  onCancelScan: () => void;
  onConnectDevice: (deviceId: string, deviceName: string) => Promise<void>;
  onDisconnectDevice: (deviceId: string) => void;
  onConnectAll: () => void;
  isScanning: boolean;
  onClearDevices: () => void;
  isRecording: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({
        allDevices,
        onScan,
        onCancelScan,
        onConnectDevice,
        onDisconnectDevice,
        onConnectAll,
        isScanning,
        onClearDevices,
        isRecording,
        isOpen,
        onOpenChange,
      }) => {
  const allDevicesArray = Array.from(allDevices.values());
  const connectedCount = allDevicesArray.filter((d) => d.state === "connected" || d.state === "streaming").length;

  const getStateColor = (state: DeviceState) => {
    switch (state) {
      case "discovered":
        return "bg-blue-500";
      case "connecting":
        return "bg-yellow-500";
      case "connected":
        return "bg-green-500";
      case "streaming":
        return "bg-red-500";
      case "disconnected":
        return "bg-gray-400";
      case "error":
        return "bg-red-600";
      default:
        return "bg-gray-400";
    }
  };

  const getStateText = (state: DeviceState) => {
    switch (state) {
      case "discovered":
        return "Discovered";
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "streaming":
        return "Streaming";
      case "disconnected":
        return "Disconnected";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" style={{ color: CONSTANTS.UI.COLORS.PRIMARY }} />
              Device Management
            </SheetTitle>
            <SheetDescription>Monitor and control your motion sensors</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {/* Connection Status */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Connection Status</CardTitle>
                  <div className="flex items-center gap-2">
                    {connectedCount > 0 ? (
                        <Wifi className="w-4 h-4 text-green-500" />
                    ) : (
                        <WifiOff className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="text-sm font-medium">
                    {connectedCount}/{allDevicesArray.length}
                  </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {allDevicesArray.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{Math.round((connectedCount / allDevicesArray.length) * 100)}%</span>
                      </div>
                      <Progress value={(connectedCount / allDevicesArray.length) * 100} className="h-2" />
                    </div>
                )}
                <Badge
                    variant={
                      connectedCount === allDevicesArray.length && allDevicesArray.length > 0 ? "default" : "secondary"
                    }
                    className="mt-3"
                    style={{
                      backgroundColor:
                          connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                              ? CONSTANTS.UI.COLORS.PRIMARY
                              : undefined,
                    }}
                >
                  {connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                      ? "All Connected"
                      : connectedCount > 0
                          ? "Partial Connection"
                          : "No Devices"}
                </Badge>
              </CardContent>
            </Card>
            {/* Scan Controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Device Discovery</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {isScanning ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-blue-50 text-blue-700">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm font-medium">Scanning for devices...</span>
                      </div>
                      <Button onClick={onCancelScan} variant="destructive" size="sm" className="w-full">
                        Cancel Scan
                      </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                      <Button onClick={onScan} className="w-full" style={{ backgroundColor: CONSTANTS.UI.COLORS.PRIMARY }}>
                        <Bluetooth className="w-4 h-4 mr-2" />
                        {allDevicesArray.length > 0
                            ? `Scan for More (${allDevicesArray.length} found)`
                            : "Scan for Devices"}
                      </Button>
                      {allDevicesArray.filter((d) => d.state === "discovered").length > 0 && (
                          <Button onClick={onConnectAll} variant="outline" size="sm" className="w-full bg-transparent">
                            Connect All ({allDevicesArray.filter((d) => d.state === "discovered").length})
                          </Button>
                      )}
                    </div>
                )}
              </CardContent>
            </Card>
            {/* Device List */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Devices {allDevicesArray.length > 0 && `(${allDevicesArray.length})`}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {allDevicesArray.length > 0 ? (
                    <div className="space-y-3">
                      {allDevicesArray.map((device) => {
                        const isLowBattery =
                            device.batteryLevel !== null &&
                            device.batteryLevel !== undefined &&
                            device.batteryLevel < CONSTANTS.BATTERY.LOW_BATTERY_THRESHOLD;
                        const canConnect = device.state === "discovered" || device.state === "disconnected";
                        return (
                            <div
                                key={device.id}
                                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {/* State Indicator */}
                                <div
                                    className={`w-3 h-3 rounded-full ${getStateColor(device.state)} ${
                                        device.state === "streaming" ? "animate-pulse" : ""
                                    }`}
                                />
                                {/* Device Info */}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium truncate">{device.name}</span>
                                    {isRecording && device.state === "streaming" && (
                                        <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
                                          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse mr-1" />
                                          REC
                                        </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                                    <span>{getStateText(device.state)}</span>
                                    {device.state === "connecting" && <Loader2 className="w-3 h-3 animate-spin" />}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {/* Battery Level */}
                                <div className="flex items-center gap-1">
                                  {isLowBattery && <Zap className="h-3 w-3 text-amber-500" />}
                                  <Badge
                                      variant="outline"
                                      className={`text-xs ${
                                          device.state === "connected" || device.state === "streaming"
                                              ? isLowBattery
                                                  ? "border-amber-500 text-amber-700"
                                                  : "border-green-500 text-green-700"
                                              : "border-gray-300 text-gray-600"
                                      }`}
                                  >
                                    {device.batteryLevel !== null && device.batteryLevel !== undefined
                                        ? `${Math.round(device.batteryLevel)}%`
                                        : "--"}
                                  </Badge>
                                </div>
                                {/* Action Buttons */}
                                {canConnect && (
                                    <Button
                                        onClick={() => onConnectDevice(device.id, device.name)}
                                        disabled={device.state === "connecting"}
                                        size="sm"
                                        style={{ backgroundColor: CONSTANTS.UI.COLORS.PRIMARY }}
                                    >
                                      {device.state === "connecting" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                                    </Button>
                                )}
                                {(device.state === "connected" || device.state === "streaming") && (
                                    <Button
                                        onClick={() => onDisconnectDevice(device.id)}
                                        variant="outline"
                                        size="sm"
                                    >
                                      Disconnect
                                    </Button>
                                )}
                              </div>
                            </div>
                        );
                      })}
                    </div>
                ) : (
                    <div className="text-center py-8">
                      <WifiOff className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <h4 className="font-medium mb-2">No Devices Found</h4>
                      <p className="text-sm text-muted-foreground mb-4">
                        Click "Scan for Devices" to discover available sensors
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Make sure Bluetooth is enabled and sensors are in pairing mode
                      </p>
                    </div>
                )}
                {allDevicesArray.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <Button onClick={onClearDevices} variant="ghost" size="sm" className="w-full text-muted-foreground">
                        Clear All Devices
                      </Button>
                    </>
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>
  );
};

const MotionAnalysisCard: React.FC<{
  motionData: any;
  isRecording: boolean;
  recordingStartTime: Date | null;
  onStartStop: () => void;
  connectedDevices: number;
  isConnected: boolean;
}> = ({ motionData, isRecording, recordingStartTime, onStartStop, connectedDevices, isConnected }) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && recordingStartTime) {
      interval = setInterval(() => {
        const now = new Date();
        const diff = Math.floor((now.getTime() - recordingStartTime.getTime()) / 1000);
        setDuration(diff);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, recordingStartTime]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const canRecord = connectedDevices > 0 && isConnected;

  return (
      <Card className="flex-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5" style={{ color: CONSTANTS.UI.COLORS.PRIMARY }} />
              <CardTitle>Motion Analysis</CardTitle>
            </div>
            {/* Recording Controls */}
            <div className="flex items-center gap-4">
              {isRecording && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <div
                          className="w-2 h-2 rounded-full animate-pulse"
                          style={{ backgroundColor: CONSTANTS.UI.COLORS.PRIMARY }}
                      />
                      <span className="text-sm font-mono font-bold" style={{ color: CONSTANTS.UI.COLORS.PRIMARY }}>
                    {formatDuration(duration)}
                  </span>
                    </div>
                    <Badge variant="destructive" className="text-xs">
                      RECORDING
                    </Badge>
                  </div>
              )}
              <Button
                  onClick={onStartStop}
                  disabled={!canRecord}
                  size="sm"
                  className={`${isRecording ? "bg-red-500 hover:bg-red-600" : ""}`}
                  style={{
                    backgroundColor: !isRecording ? CONSTANTS.UI.COLORS.PRIMARY : undefined,
                    color: "white",
                  }}
              >
                {isRecording ? (
                    <>
                      <Pause className="w-4 h-4 mr-2" />
                      Stop Recording
                    </>
                ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Start Recording
                    </>
                )}
              </Button>
            </div>
          </div>
          <CardDescription>
            Real-time motion data visualization and analysis
            {!canRecord && <span className="block text-amber-600 mt-1">Connect devices to start recording</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Motion Data Display */}
          <div className="min-h-[400px]">
            <EnhancedMotionDataDisplay
                data={motionData}
                isRecording={isRecording}
                recordingStartTime={recordingStartTime}
            />
          </div>
        </CardContent>
      </Card>
  );
};

const WindowControls: React.FC = () => {
  const handleMinimize = () => window.electronAPI?.window.minimize();
  const handleMaximize = () => window.electronAPI?.window.maximize();
  const handleClose = () => window.electronAPI?.window.close();

  return (
      <div className="flex items-center gap-1">
        <Button onClick={handleMinimize} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100">
          <Minimize2 className="w-4 h-4" />
        </Button>
        <Button onClick={handleMaximize} variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100">
          <Maximize2 className="w-4 h-4" />
        </Button>
        <Button
            onClick={handleClose}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-red-100 hover:text-red-600"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
  );
};

const ElectronMotionApp: React.FC = () => {
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  const batteryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_COOLDOWN = 3000;


  useEffect(() => {
    console.log("🔵 RENDERER LOADED: Testing Web Bluetooth availability...");
    console.log("🔵 navigator.bluetooth available:", !!navigator.bluetooth);
    console.log("🔵 window.isSecureContext:", window.isSecureContext);
    console.log("🔵 window.location.href:", window.location.href);
    if (window.electronAPI) {
      window.electronAPI.motion.getWebSocketPort().then((port) => {
        console.log("🌐 Got WebSocket port from main process:", port);
        dispatch({ type: "SET_WS_PORT", payload: port });
      });
    } else {
      console.error("🌐 window.electronAPI not available");
    }
  }, []);

  const { isConnected, lastMessage, ws } = useWebSocket(`ws://localhost:${state.wsPort}`);

  // Store WebSocket reference from the hook
  React.useEffect(() => {
    wsRef.current = ws;
    dispatch({ type: "SET_WS_CONNECTED", payload: isConnected });
  }, [ws, isConnected]);

  useEffect(() => {
    if (!lastMessage) return;
    try {
      switch (lastMessage.type) {
        case "status_update": {
          const statusData: any = lastMessage.data as any;
          dispatch({ type: "SET_STATUS", payload: statusData });
          const statusDevices = statusData.connectedDevices || [];
          statusDevices.forEach((device: DeviceInfo) => {
            const streaming = (device as any).streaming ? true : false;
            const deviceState: DeviceStateMachine = {
              id: device.id,
              name: device.name,
              state: device.connected ? (streaming ? "streaming" : "connected") : "disconnected",
              batteryLevel: device.batteryLevel,
              lastSeen: new Date(),
            };
            dispatch({ type: "SET_DEVICE_STATE", payload: { deviceId: device.id, device: deviceState } });
          });
          dispatch({ type: "SET_RECORDING", payload: { isRecording: !!statusData.isRecording } });
          break;
        }
        case "device_status": {
          const devStatusData: any = lastMessage.data as any;
          const connectedDevices = devStatusData.connectedDevices || [];
          connectedDevices.forEach((device: DeviceInfo) => {
            const streaming = (device as any).streaming ? true : false;
            const deviceState: DeviceStateMachine = {
              id: device.id,
              name: device.name,
              state: device.connected ? (streaming ? "streaming" : "connected") : "disconnected",
              batteryLevel: device.batteryLevel,
              lastSeen: new Date(),
            };
            dispatch({ type: "SET_DEVICE_STATE", payload: { deviceId: device.id, device: deviceState } });
            if (device.connected) {
              dispatch({
                type: "TRANSITION_FROM_CONNECTING",
                payload: { deviceId: device.id, newState: streaming ? "streaming" : "connected" },
              });
            }
          });
          break;
        }
        case "scan_request": {
          const scanReq: any = lastMessage.data as any;
          console.log("📨 grosdode pattern: Received scan request");
          if (scanReq.action === "trigger_bluetooth_scan") {
            console.log("📨 grosdode: Triggering simple Web Bluetooth scan...");
            (async () => {
              try {
                if (!navigator.bluetooth) {
                  console.error("❌ Web Bluetooth not available");
                  return;
                }
                await navigator.bluetooth.requestDevice({
                  acceptAllDevices: true,
                  optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
                });
              } catch (error: any) {
                console.log("📨 grosdode: Web Bluetooth triggered, main process should handle device selection");
                console.log(`📨 Error: ${error?.name} (expected for grosdode pattern)`);
              }
            })();
          }
          break;
        }
        case "device_scan_result": {
          const data: any = lastMessage.data as any;
          try {
            const devices = data.devices || [];
            console.log(`📡 Scan result: ${data.success ? "SUCCESS" : "FAILED"} - ${devices.length} device(s) found`);
            if (devices.length > 0) {
              const newDevices = devices.filter((device: DeviceInfo) => !state.allDevices.has(device.id));
              if (newDevices.length > 0) {
                const sdkDevices = newDevices.map((device: DeviceInfo) => ({
                  deviceId: device.id,
                  deviceName: device.name,
                  batteryLevel: device.batteryLevel
                }));
                
                // Sync to legacy MuseManager (always)
                museManager.addScannedDevices(sdkDevices);
                

              }
              devices.forEach((device: DeviceInfo) => {
                const existingDevice = state.allDevices.get(device.id);
                let deviceState: DeviceState = "discovered";
                if (existingDevice) {
                  if (existingDevice.state === "connected" || existingDevice.state === "streaming") {
                    const isActuallyConnected = museManager.isDeviceConnected(device.name);
                    const isActuallyStreaming = museManager.isDeviceStreaming(device.name);
                    if (isActuallyStreaming) deviceState = "streaming";
                    else if (isActuallyConnected) deviceState = "connected";
                    else deviceState = "discovered";
                  } else if (existingDevice.state === "connecting") {
                    deviceState = "connecting";
                  } else {
                    deviceState = "discovered";
                  }
                }
                const newDeviceState: DeviceStateMachine = {
                  id: device.id,
                  name: device.name,
                  state: deviceState,
                  batteryLevel: device.batteryLevel || existingDevice?.batteryLevel || null,
                  lastSeen: new Date(),
                };
                dispatch({ type: "SET_DEVICE_STATE", payload: { deviceId: device.id, device: newDeviceState } });
                console.log(`📱 ${existingDevice ? "Updated" : "Added"} device: ${device.name} (${deviceState})`);
              });
            } else {
              console.log("⚠️ No devices discovered - check Bluetooth settings");
            }
            dispatch({ type: "SET_SCANNING", payload: false });
          } catch (error) {
            console.error("❌ Error processing scan result:", error);
            dispatch({ type: "SET_SCANNING", payload: false });
          }
          break;
        }
        case "motion_data":
          dispatch({ type: "SET_MOTION_DATA", payload: lastMessage.data as any });
          // Forward to consumer for minimal UI updates only
          if (motionProcessingConsumer && typeof motionProcessingConsumer.updateUIFromWebSocket === 'function') {
            motionProcessingConsumer.updateUIFromWebSocket(lastMessage.data);
          }
          break;
        case "recording_state": {
          const recData: any = lastMessage.data as any;
          const newIsRecording = !!recData.isRecording;
          const startTime =
              newIsRecording && !state.recordingStartTime ? new Date() : !newIsRecording ? null : undefined;
          dispatch({ type: "SET_RECORDING", payload: { isRecording: newIsRecording, startTime } });
          break;
        }
        default:
          console.log("📨 Unhandled message type:", lastMessage.type);
      }
    } catch (error) {
      console.error("📨 Error processing WebSocket message:", error, lastMessage);
    }
  }, [lastMessage, state.recordingStartTime]);

  const handleScan = async () => {
    console.log("🔄 Using legacy scan system");
    
    // Prevent multiple simultaneous scans
    if (state.isScanning) {
      console.log("⚠️ Scan already in progress, skipping...");
      return;
    }
    // 🎙️ SMART SCAN CONTROL: Allow infinite scans EXCEPT during recording
    if (state.isRecording) {
      console.log("🎙️ Scan blocked: Recording in progress - avoiding interference");
      return;
    }
    
    // Relaxed cooldown period to allow more frequent scans (for connection reliability)
    const now = Date.now();
    const RELAXED_SCAN_COOLDOWN = 1000; // 1 second instead of 5 seconds
    if (now - lastScanTimeRef.current < RELAXED_SCAN_COOLDOWN) {
      console.log(
          `⏳ Scan cooldown active (${Math.ceil((RELAXED_SCAN_COOLDOWN - (now - lastScanTimeRef.current)) / 1000)}s remaining)`,
      );
      return;
    }
    lastScanTimeRef.current = now;
    console.log(`🔍 Starting device scan... (${state.allDevices.size} existing devices)`);
    dispatch({ type: "SET_SCANNING", payload: true });
    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth not available");
      }
      // Create a timeout promise to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Scan timeout")), 5000);
      });
      // Race between Bluetooth scan and timeout
      await Promise.race([
        navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
        }),
        timeoutPromise,
      ]);
      console.log("✅ Scan request completed - main process will handle device selection");
    } catch (error: any) {
      console.log(`🔍 Scan trigger: ${error.name} (expected for grosdode pattern)`);
      // Handle timeout specifically
      if (error.message === "Scan timeout") {
        console.log("⏰ Scan timed out - this may be normal for auto-scans");
        dispatch({ type: "SET_SCANNING", payload: false });
        return;
      }
      // Show user-friendly message for Windows Bluetooth issues
      const isWindowsBluetoothIssue =
          error?.name === "NotFoundError" ||
          error?.name === "NotAllowedError" ||
          error?.name === "SecurityError" ||
          error?.message?.includes("chooser") ||
          error?.message?.includes("user gesture");
      if (!isWindowsBluetoothIssue) {
        console.error("❌ Unexpected scan error:", error);
        dispatch({ type: "SET_SCANNING", payload: false });
        alert(`Scan error: ${error?.message || "Unknown error"}`);
        return;
      }
    }
    // Timeout to stop scanning if no results
    setTimeout(() => {
      dispatch({ type: "SET_SCANNING", payload: false });
    }, CONSTANTS.TIMEOUTS.SCAN_DURATION);
  };


  // Battery update timer for connected devices
  const startBatteryUpdateTimer = () => {
    // Clear existing timer
    if (batteryTimerRef.current) {
      clearInterval(batteryTimerRef.current);
    }
    // Update battery levels periodically for connected devices
    batteryTimerRef.current = setInterval(async () => {
      try {
        await museManager.updateAllBatteryLevels();
        const allBatteryLevels = museManager.getAllBatteryLevels();
        // Update unified device state with new battery levels
        allBatteryLevels.forEach((batteryLevel, deviceName) => {
          // Find device by name and update its battery level
          const deviceEntry = Array.from(state.allDevices.entries()).find(([_, device]) => device.name === deviceName);
          if (deviceEntry) {
            const [deviceId] = deviceEntry;
            dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { batteryLevel } } });
          }
        });
        console.log(`🔋 Updated battery levels for ${allBatteryLevels.size} devices`);
      } catch (error) {
        console.error("❌ Battery update timer error:", error);
      }
    }, CONSTANTS.BATTERY.UPDATE_INTERVAL);
    console.log("✅ Battery update timer started");
  };

  // Cancel current scan
  const cancelScan = () => {
    console.log("🚫 Canceling current scan...");
    // Clear scan timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    // Set scanning to false
    dispatch({ type: "SET_SCANNING", payload: false });
    // Try to cancel scan in main process if possible
    // Note: This is a nice-to-have since the main process has its own timeout
    console.log("🚫 Scan canceled by user");
  };


  const handleRecording = async () => {
    console.log("🔄 Using legacy recording system");
    
    try {
      const currentStreamingState = museManager.getIsStreaming();
      console.log(`🎬 RECORDING STATE CHANGE: isRecording=${state.isRecording}, SDK streaming=${currentStreamingState}`);
      
      if (state.isRecording) {
        // Stop recording and streaming
        console.log("🛑 Stopping recording and streaming...");
        
        // Stop SDK streaming
        if (currentStreamingState) {
          await museManager.stopStreaming();
          console.log("✅ SDK streaming stopped");
        }
        
        // Motion processing recording stopped by main process
        
        // Stop recording in main process
        if (window.electronAPI) {
          const result = await window.electronAPI.motion.stopRecording();
          console.log("✅ Stop recording result:", result);
        }
        
        // Update UI state
        dispatch({ type: "SET_RECORDING", payload: { isRecording: false, startTime: null } });
        
        // Update all devices to stop streaming state
        state.allDevices.forEach((device, deviceId) => {
          if (device.state === "streaming") {
            dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "connected" } } });
          }
        });
        
        console.log("✅ Recording and streaming stopped successfully");
        
        // Resume scanning after recording stops
        setTimeout(() => {
          handleScan().catch(error => {
            console.warn("⚠️ Failed to resume scanning after recording:", error);
          });
        }, 1000);
        
      } else {
        // Start recording and streaming
        console.log("🎬 Starting recording...");
        
        // Check connected devices
        const connectedDevices = museManager.getConnectedDevices();
        console.log("🔍 Connected devices for recording:", connectedDevices);
        if (connectedDevices.size === 0) {
          console.error("❌ No connected devices found for recording");
          alert("Please connect at least one device before recording");
          return;
        }
        
        // No motion processing initialization in renderer - handled by main process
        const sessionData = {
          sessionId: `session_${Date.now()}`,
          exerciseId: `exercise_${Date.now()}`,
          setNumber: 1,
        };
        
        // Start real quaternion streaming via GATT service with minimal processing
        const streamingSuccess = await museManager.startStreaming((deviceName: string, data: any) => {
          // MINIMAL RENDERER: Only forward raw data to main process, no processing
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
              wsRef.current.send(
                JSON.stringify({
                  type: "motion_data",
                  data: {
                    deviceName: deviceName,
                    timestamp: data.timestamp,
                    quaternion: data.quaternion,
                  },
                  timestamp: Date.now(),
                }),
              );
            } catch (error) {
              // Silent error - don't log in high-frequency callback
            }
          }
        });
        
        if (streamingSuccess) {
          console.log("✅ SDK quaternion streaming started successfully");
          
          // Update recording state
          dispatch({ type: "SET_RECORDING", payload: { isRecording: true, startTime: new Date() } });
          
          // Update devices to show streaming state
          const streamingDeviceNames = museManager.getStreamingDeviceNames();
          console.log("📡 Devices now streaming:", streamingDeviceNames);
          
          state.allDevices.forEach((device, deviceId) => {
            if (streamingDeviceNames.includes(device.name) && device.state === "connected") {
              dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "streaming" } } });
            }
          });
          
          // Start recording in main process
          if (window.electronAPI) {
            const result = await window.electronAPI.motion.startRecording(sessionData);
            console.log("✅ Main process recording result:", result);
          }
          
          console.log("✅ Recording with quaternion streaming started successfully");
        } else {
          console.error("❌ Failed to start SDK quaternion streaming");

          // Ensure recording state remains false on failure
          dispatch({ type: "SET_RECORDING", payload: { isRecording: false, startTime: null } });
          alert("Failed to start quaternion streaming. Please check device connections.");
        }
      }
    } catch (error) {
      console.error("❌ Recording error:", error);
      
      // Ensure recording state is reset on error
      dispatch({ type: "SET_RECORDING", payload: { isRecording: false, startTime: null } });
      alert(`Recording failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const connectedCount = Array.from(state.allDevices.values()).filter(
      (d) => d.state === "connected" || d.state === "streaming",
  ).length;

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup battery timer
      if (batteryTimerRef.current) {
        clearInterval(batteryTimerRef.current);
      }
      // Cleanup scan timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      // Stop streaming if active on component unmount
      if (museManager.getIsStreaming()) {
        console.log("🧹 Component unmounting, stopping active streaming...");
        museManager.stopStreaming().catch((error) => console.warn("⚠️ Error stopping streaming during unmount:", error));
      }
    };
  }, []);

  // Helper function to clear all devices
  const handleClearDevices = () => {
    console.log("🗑️ Clearing all device lists");
    dispatch({ type: "CLEAR_ALL_DEVICES" });
  };

  // Function to disconnect a device
  const handleDisconnectDevice = async (deviceId: string) => {
    console.log("🔌 Disconnecting device:", deviceId);
    try {
      const device = state.allDevices.get(deviceId);
      if (!device) {
        console.warn("⚠️ Device not found:", deviceId);
        return;
      }
      // Disconnect via SDK
      await museManager.disconnectDevice(device.name);
      // Update device state
      dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "discovered" } } });
      console.log("✅ Device disconnected successfully:", device.name);
    } catch (error) {
      console.error("❌ Failed to disconnect device:", error);
      alert(`Failed to disconnect device: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleConnectDevice = async (deviceId: string, deviceName: string) => {
    console.log("🔄 Using legacy connection system with fresh device acquisition");
    
    try {
      // Set device to connecting state
      dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "connecting" } } });
      
      // Step 1: Acquire fresh BluetoothDevice
      console.log(`🔗 Acquiring fresh BluetoothDevice for ${deviceName}...`);
      const requestPromise = navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
      });
      
      // Instruct main process to select our target device
      try {
        await window.electronAPI?.bluetooth?.selectDevice(deviceId);
      } catch (selectionError) {
        console.warn(`🔗 Device selection warning for ${deviceName}:`, selectionError);
      }
      
      // Get the fresh BluetoothDevice
      const freshDevice = await requestPromise;
      if (freshDevice && freshDevice.name) {
        console.log(`✅ Fresh BluetoothDevice acquired: ${freshDevice.name}`);
        
        // Cache the fresh device
        museManager.cacheRealBluetoothDevice(freshDevice.name, freshDevice);
        
        // Step 2: Connect using fresh device directly with MuseManager
        const connected = await museManager.connectWebBluetoothDevice(
          freshDevice,
          CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT
        );
        
        if (connected) {
          // Update battery info and React state
          await museManager.updateBatteryLevel(deviceName);
          const batteryLevel = museManager.getBatteryLevel(deviceName);
          
          dispatch({ type: "UPDATE_DEVICE", payload: { 
            deviceId, 
            updates: { 
              state: "connected",
              batteryLevel: batteryLevel || null
            } 
          }});
          
          console.log(`✅ Successfully connected to ${deviceName} using fresh device`);
          
          // Start battery update timer
          startBatteryUpdateTimer();
        } else {
          throw new Error(`Connection failed: SDK returned false`);
        }
      } else {
        throw new Error(`No valid fresh device returned`);
      }
    } catch (error) {
      console.error(`❌ Connection error for ${deviceName}:`, error);
      dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "discovered" } } });
      alert(`Failed to connect to ${deviceName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Function to connect all discovered devices
  const handleConnectAll = async () => {
    const discoveredDevices = Array.from(state.allDevices.values()).filter((d) => d.state === "discovered");
    if (discoveredDevices.length === 0) {
      alert("No devices available to connect");
      return;
    }
    
    console.log(`🔗 Connecting to ${discoveredDevices.length} devices...`);
    
    // 🔄 BATCH FRESH DEVICE ACQUISITION SYSTEM
    console.log("🚀 Using batch fresh device acquisition for reliable connections");
    
    // Step 1: Acquire fresh BluetoothDevice objects for all devices at once
    console.log(`🔗 Step 1: Acquiring fresh BluetoothDevices for ${discoveredDevices.length} devices...`);
    const freshDeviceMap = new Map<string, any>(); // deviceName -> fresh BluetoothDevice
    
    for (let i = 0; i < discoveredDevices.length; i++) {
      const device = discoveredDevices[i];
      console.log(`🔗 [${i+1}/${discoveredDevices.length}] Acquiring fresh BluetoothDevice for ${device.name}...`);
      
      try {
        // Update UI to show connecting status
        dispatch({ type: "UPDATE_DEVICE", payload: { deviceId: device.id, updates: { state: "connecting" } } });
        
        // Get fresh device via requestDevice
        const requestPromise = navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
        });
        
        // Instruct main process to select our target device
        try {
          await window.electronAPI?.bluetooth?.selectDevice(device.id);
        } catch (selectionError) {
          console.warn(`🔗 Device selection warning for ${device.name}:`, selectionError);
        }
        
        // Get the fresh BluetoothDevice
        const freshDevice = await requestPromise;
        if (freshDevice && freshDevice.name) {
          freshDeviceMap.set(device.name, freshDevice);
          console.log(`✅ [${i+1}/${discoveredDevices.length}] Fresh BluetoothDevice acquired: ${freshDevice.name}`);
        } else {
          console.warn(`⚠️ [${i+1}/${discoveredDevices.length}] No valid device returned for ${device.name}`);
        }
        
        // Small delay between acquisitions
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ [${i+1}/${discoveredDevices.length}] Failed to acquire fresh device for ${device.name}:`, error);
      }
    }
    
    console.log(`🔗 Step 2: Connecting to ${freshDeviceMap.size} fresh devices immediately...`);
    
    // Step 2: Connect to all fresh devices immediately while GATT interfaces are active
    let successCount = 0;
    for (const device of discoveredDevices) {
      const freshDevice = freshDeviceMap.get(device.name);
      if (!freshDevice) {
        console.error(`❌ No fresh device available for ${device.name}, skipping...`);
        continue;
      }
      
      console.log(`🔗 Connecting to ${device.name} with fresh GATT interface...`);
      
      try {
        // Connect using fresh device directly with MuseManager
        const connected = await museManager.connectWebBluetoothDevice(
          freshDevice,
          CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT
        );
        
        if (connected) {
          // Update battery info and React state
          await museManager.updateBatteryLevel(device.name);
          const batteryLevel = museManager.getBatteryLevel(device.name);
          
          dispatch({ type: "UPDATE_DEVICE", payload: { 
            deviceId: device.id, 
            updates: { 
              state: "connected",
              batteryLevel: batteryLevel || null
            } 
          }});
          
          successCount++;
          console.log(`✅ Successfully connected to ${device.name} using fresh device`);
        } else {
          console.error(`❌ Connection failed for ${device.name}: SDK returned false`);
          dispatch({ type: "UPDATE_DEVICE", payload: { deviceId: device.id, updates: { state: "discovered" } } });
        }
      } catch (error) {
        console.error(`❌ Connection error for ${device.name}:`, error);
        dispatch({ type: "UPDATE_DEVICE", payload: { deviceId: device.id, updates: { state: "discovered" } } });
      }
    }
    
    console.log(`✅ Batch fresh device connection completed: ${successCount}/${discoveredDevices.length} devices connected`);
  };

  return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#fafafa" }}>
        {/* Header */}
        <div className="border-b bg-white px-6 py-3 flex items-center justify-between drag-region">
          <div className="flex items-center gap-3">
            <CompanyLogo className="w-8 h-8" />
            <div>
              <h1 className="text-lg font-semibold" style={{ color: CONSTANTS.UI.COLORS.DARK }}>
                Tropx Motion
              </h1>
              <p className="text-xs text-muted-foreground">Research Suite</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${state.isConnected ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-sm text-muted-foreground">{state.isConnected ? "Connected" : "Disconnected"}</span>
            </div>
            {/* Device Count */}
            <Badge variant="outline" className="text-xs">
              {connectedCount}/{Array.from(state.allDevices.values()).length} Devices
            </Badge>
            <WindowControls />
          </div>
        </div>
        <div className="flex-1 flex">
          {/* Left Pane - Device Management */}
          <DeviceManagementPane
              allDevices={state.allDevices}
              onScan={handleScan}
              onCancelScan={cancelScan}
              onConnectDevice={handleConnectDevice}
              onDisconnectDevice={handleDisconnectDevice}
              onConnectAll={handleConnectAll}
              isScanning={state.isScanning}
              onClearDevices={handleClearDevices}
              isRecording={state.isRecording}
          />
          {/* Right Pane - Motion Analysis */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-full">
              {/* Motion Analysis - Main Focus */}
              <MotionAnalysisCard
                  motionData={state.motionData}
                  isRecording={state.isRecording}
                  recordingStartTime={state.recordingStartTime}
                  onStartStop={handleRecording}
                  connectedDevices={connectedCount}
                  isConnected={state.isConnected}
              />
              {/* Status Bar */}
              <Card className="mt-6">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <span>System Status:</span>
                        <Badge variant={state.status?.isInitialized ? "default" : "secondary"}>
                          {state.status?.isInitialized ? "Ready" : "Initializing"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span>WebSocket:</span>
                        <Badge variant={state.isConnected ? "default" : "destructive"}>
                          {state.isConnected ? "Connected" : "Disconnected"}
                        </Badge>
                      </div>
                      <div>
                        Active Clients: <span className="font-medium">{state.status?.clientCount || 0}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>Port: {state.wsPort}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
  );
};

export default ElectronMotionApp;
