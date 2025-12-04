/**
 * BLE Service Adapter for WebSocket Bridge Integration
 *
 * Platform-agnostic adapter that works with both Noble (Windows/Mac) and node-ble (Linux/RPi).
 * Uses dependency injection to accept any IBleService implementation.
 */

import { IBleService } from './BleServiceFactory';
import { MotionData, TropXDeviceInfo } from './index';
import { QuaternionBinaryProtocol } from './QuaternionBinaryProtocol';
import { TimeSyncManager } from '../time-sync';
import { TropXTimeSyncAdapter } from '../time-sync/adapters/TropXTimeSyncAdapter';
import { DeviceLocateService } from './DeviceLocateService';
import {
  DeviceID,
  DeviceState,
  GlobalState,
  SyncState,
  DisconnectReason,
  UnifiedBLEStateStore,
  StreamingHook,
  MotionData as HookMotionData,
  getDeviceDisplayName,
  getJointDisplayName,
  formatDeviceID,
  isShin,
  Watchdog,
  PollingManager,
  ReconnectionManager,
} from '../ble-management';

// BLE Service interface from WebSocket Bridge
interface BLEService {
  scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }>;
  connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }>;
  disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }>;
  startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  getConnectedDevices(): any[];
  isRecording(): boolean;
}

// Device info conversion
interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  batteryLevel: number | null;
}

export class BLEServiceAdapter implements BLEService {
  private bleService: IBleService;
  private broadcastFunction: ((message: any, clientIds: string[]) => Promise<void>) | null = null;
  private motionCoordinator: any = null;
  private isCurrentlyRecording = false;
  private timeSyncManager = new TimeSyncManager();
  private deviceLocateService = new DeviceLocateService();
  private static scanSequence = 0;
  private lastScanStart = 0;
  private readonly MIN_RESTART_INTERVAL_MS = 700;

  constructor(bleService: IBleService) {
    this.bleService = bleService;
    this.setupStateManagerEventListeners();
  }

  async initialize(): Promise<boolean> {
    try {
      console.log('🔧 Initializing BLE Service Adapter...');
      const initialized = await this.bleService.initialize();

      if (initialized) {
        console.log('✅ BLE Service Adapter ready');
        this.bleService.startStatePolling();

        // Register connect function with ReconnectionManager
        // This allows unified reconnection logic for all platforms
        ReconnectionManager.setConnectFunction(async (bleAddress: string) => {
          try {
            const result = await this.bleService.connectToDevice(bleAddress);
            return result.success;
          } catch (error) {
            console.error(`[ReconnectionManager] Connect failed for ${bleAddress}:`, error);
            return false;
          }
        });

        // Register streaming function for auto-recovery during active streaming
        ReconnectionManager.setStartStreamingFunction(async (deviceId: DeviceID) => {
          try {
            const device = UnifiedBLEStateStore.getDevice(deviceId);
            if (!device) return false;

            const tropxDevice = this.bleService.getDeviceInstance(device.bleAddress);
            if (!tropxDevice) return false;

            return await tropxDevice.startStreaming();
          } catch (error) {
            console.error(`[ReconnectionManager] Start streaming failed for ${formatDeviceID(deviceId)}:`, error);
            return false;
          }
        });

        console.log('🔄 ReconnectionManager configured with connect and streaming functions');
      } else {
        console.error('❌ Failed to initialize BLE Service Adapter');
      }

      return initialized;
    } catch (error) {
      console.error('❌ BLE Service Adapter initialization error:', error);
      return false;
    }
  }

  // Set broadcast function for WebSocket communication
  setBroadcastFunction(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
    this.broadcastFunction = broadcastFn;
    console.log('📡 [BLEServiceAdapter] WebSocket broadcast function configured');

    // If motion coordinator is already connected, configure it now
    if (this.motionCoordinator && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(broadcastFn);
      console.log('📡 [BLEServiceAdapter] Configured motion coordinator to broadcast processed joint angles via WebSocket (from setBroadcastFunction)');
    }
  }

  // Connect motion coordinator for processing operations
  connect(motionCoordinator: any): void {
    this.motionCoordinator = motionCoordinator;
    console.log('🔗 [BLEServiceAdapter] Connected to Motion Processing Coordinator');

    // Configure motion coordinator to send processed joint angles via WebSocket
    if (this.broadcastFunction && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(this.broadcastFunction);
      console.log('📡 [BLEServiceAdapter] Configured motion coordinator to broadcast processed joint angles via WebSocket (from connect)');
    }
  }


  // Scan for TropX devices
  async scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }> {
    try {
      const seq = ++BLEServiceAdapter.scanSequence;
      const scanningActive = this.bleService.isScanningActive();
      console.log(`📡 [SCAN:${seq}] BLE: Starting (or snapshotting). active=${scanningActive}`);

      if (scanningActive) {
        // If active scan has been running long enough, restart to force fresh discovery cycle
        const elapsed = Date.now() - this.lastScanStart;
        if (elapsed > this.MIN_RESTART_INTERVAL_MS) {
          console.log(`♻️ [SCAN:${seq}] Restarting active scan after ${elapsed}ms for burst cycle`);
          try { await this.bleService.stopScanning(); } catch (e) { console.warn('⚠️ Stop scan error (ignored):', e); }
        } else {
          const snapshot = UnifiedBLEStateStore.getDevicesByState(DeviceState.DISCOVERED).map(d => this.convertUnifiedToDeviceInfo(d));
          console.log(`📸 [SCAN:${seq}] Snapshot during active scan: count=${snapshot.length}`);
          return { success: true, devices: snapshot, message: `Snapshot (${snapshot.length}) during active scan [${seq}]` };
        }
      }

      const result = await this.bleService.startScanning();
      if (result.success) {
        this.lastScanStart = Date.now();
        UnifiedBLEStateStore.setGlobalState(GlobalState.SCANNING);
        const isRealNoble = result.message && !result.message.includes('Mock');
        if (!isRealNoble) {
          console.log(`🧪 [SCAN:${seq}] Mock service immediate devices`);
        }
        const discoveredDevices = UnifiedBLEStateStore.getDevicesByState(DeviceState.DISCOVERED);
        const deviceList = discoveredDevices.map(d => this.convertUnifiedToDeviceInfo(d));
        console.log(`✅ [SCAN:${seq}] Kickoff returned ${deviceList.length} devices (non-blocking)`);
        return {
            success: true,
            devices: deviceList,
            message: `Scan started (non-blocking), current ${deviceList.length} [${seq}]`
        };
      } else {
        console.warn(`⚠️ [SCAN:${seq}] Scan start failed: ${result.message}`);
        return result;
      }

    } catch (error) {
      console.error('❌ BLE scan failed:', error);
      return {
        success: false,
        devices: [],
        message: `Scan failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Connect to device
  async connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`🔗 BLE: Connecting to device ${deviceName} (${deviceId})`);

      // Set global state to CONNECTING (blocks polling during connection)
      UnifiedBLEStateStore.setGlobalState(GlobalState.CONNECTING);

      const result = await this.bleService.connectToDevice(deviceId);

      if (result.success) {
        console.log(`✅ BLE: Successfully connected to ${deviceName}`);

        // Register device in UnifiedBLEStateStore (identifies from name pattern)
        const registeredDeviceId = UnifiedBLEStateStore.registerDevice(deviceId, deviceName);
        if (!registeredDeviceId) {
          console.error(`❌ Failed to register device "${deviceName}" - unknown device pattern`);
          // Reset global state on registration failure
          UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
          return {
            success: false,
            message: `Device "${deviceName}" doesn't match any known patterns. Please check device naming.`
          };
        }

        // Transition to CONNECTED
        try {
          UnifiedBLEStateStore.transition(registeredDeviceId, DeviceState.CONNECTED);
        } catch (e) {
          console.warn(`⚠️ Could not transition to CONNECTED:`, e);
        }

        // Register streaming hook with pre-bound DeviceID
        const self = this;
        const boundDeviceId = registeredDeviceId; // Capture for closure
        const hook: StreamingHook = {
          onMotionData(data: HookMotionData): void {
            // Update watchdog heartbeat
            Watchdog.heartbeat(boundDeviceId);
            if (self.motionCoordinator) {
              self.motionCoordinator.processNewData(boundDeviceId, data);
            }
          },
          onDisconnect(): void {
            console.log(`🔌 [Hook] Device ${deviceName} disconnected during streaming`);
          },
          onError(error: Error): void {
            console.error(`❌ [Hook] Streaming error for ${deviceName}:`, error);
          }
        };
        UnifiedBLEStateStore.registerHook(registeredDeviceId, hook);

        const jointName = getJointDisplayName(registeredDeviceId);
        const position = isShin(registeredDeviceId) ? 'shin' : 'thigh';
        console.log(`📋 Device registered: ${deviceName} → ${formatDeviceID(registeredDeviceId)} (${jointName}, ${position})`);

        // CRITICAL: Clear sync state FIRST before any device instance access
        UnifiedBLEStateStore.setSyncState(registeredDeviceId, SyncState.NOT_SYNCED, 0);
        console.log(`🔄 [${deviceName}] Cleared sync state - forcing fresh time sync`);

        // CRITICAL: Clear device instance sync state
        // Must be done AFTER registry clear
        const tropxDeviceInstance = this.bleService.getDeviceInstance(deviceId);
        if (tropxDeviceInstance) {
          // Reset sync state to ensure fresh time sync
          (tropxDeviceInstance as any).wrapper.deviceInfo.syncState = 'not_synced';
          (tropxDeviceInstance as any).wrapper.deviceInfo.clockOffset = undefined;
          console.log(`🔄 [${deviceName}] Cleared device instance sync state`);

          // CRITICAL: Check if device is already streaming and stop it
          // This can happen if device was disconnected unexpectedly while streaming
          try {
            const deviceState = await tropxDeviceInstance.getSystemState();
            const { TROPX_STATES } = await import('./BleBridgeConstants');

            if (deviceState === TROPX_STATES.TX_DIRECT || deviceState === TROPX_STATES.TX_BUFFERED) {
              console.log(`⚠️ [${deviceName}] Device is still streaming (state: 0x${deviceState.toString(16)}) - stopping...`);
              const resetSuccess = await tropxDeviceInstance.resetToIdle();
              if (resetSuccess) {
                console.log(`✅ [${deviceName}] Device reset to IDLE - ready for fresh start`);
              } else {
                console.warn(`⚠️ [${deviceName}] Could not reset device to IDLE - may have streaming issues`);
              }
            } else {
              console.log(`✅ [${deviceName}] Device not streaming (state: 0x${deviceState.toString(16)}) - ready`);
            }
          } catch (stateCheckError) {
            console.warn(`⚠️ [${deviceName}] Could not check device state:`, stateCheckError);
            // Don't fail connection - device might still work
          }
        }

        // Broadcast device status update (connection complete)
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status:`, broadcastError);
          // Don't fail the connection due to broadcast issues
        }

        // Auto-sync disabled - will be handled in batch after all connections complete

        // Reset global state to IDLE after successful connection
        UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      } else {
        console.error(`❌ BLE: Connection failed for ${deviceName}: ${result.message}`);

        // Reset global state to IDLE on failure
        UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);

        // Broadcast device status update on failure (to update UI)
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status on error:`, broadcastError);
        }
      }

      return result;

    } catch (error) {
      console.error(`❌ BLE connection failed for ${deviceId}:`, error);
      // Reset global state on error
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Sync single device using new time-sync module
   */
  private async syncSingleDevice(deviceId: string): Promise<void> {
    const tropxDevice = this.bleService.getDeviceInstance(deviceId);
    if (!tropxDevice) {
      console.warn(`⚠️ Could not get device instance for sync: ${deviceId}`);
      return;
    }

    const adapter = new TropXTimeSyncAdapter(tropxDevice);
    const result = await this.timeSyncManager.syncDevice(adapter);

    if (result.success) {
      console.log(`✅ Sync complete: ${result.deviceName}, offset=${result.finalOffset.toFixed(2)}ms`);
      await this.broadcastDeviceStatus();
    } else {
      console.error(`❌ Sync failed: ${result.deviceName}, error=${result.error}`);
    }
  }

  /**
   * Manually sync all connected devices (called by sync button)
   */
  async syncAllDevices(): Promise<{ success: boolean; results: any[] }> {
    try {
      console.log('⏱️ Manual sync: Synchronizing all connected devices...');

      // Reset manager for new sync session
      this.timeSyncManager.reset();

      // Get all connected devices
      const connectedDevices = this.bleService.getConnectedDevices();
      if (connectedDevices.length === 0) {
        return { success: false, results: [] };
      }

      // Set global state to SYNCING (blocks polling, shows UI indicator)
      UnifiedBLEStateStore.setGlobalState(GlobalState.SYNCING);

      // Clear syncProgress from previous sync session (start fresh)
      for (const deviceInfo of connectedDevices) {
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceInfo.id);
        if (storeDeviceId) {
          UnifiedBLEStateStore.setSyncProgress(storeDeviceId, null);
        }
      }

      // CRITICAL: Transition all devices to SYNCING state BEFORE starting sync
      // This ensures UI shows purple "synchronizing" state
      for (const deviceInfo of connectedDevices) {
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceInfo.id);
        if (storeDeviceId) {
          const device = UnifiedBLEStateStore.getDevice(storeDeviceId);
          const currentState = device?.state;

          // DEBUG: Log device state before sync attempt
          console.log(`🔍 [SYNC] Device ${deviceInfo.name}: currentState=${currentState}, storeDeviceId=0x${storeDeviceId.toString(16)}`);

          // ALWAYS set syncProgress to 0 BEFORE transition attempt
          // This ensures UI shows sync progress even if transition fails
          UnifiedBLEStateStore.setSyncProgress(storeDeviceId, 0);

          try {
            // Transition CONNECTED -> SYNCING (also valid from SYNCED -> SYNCING for re-sync)
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.SYNCING);
            console.log(`🔄 [SYNC] Device ${deviceInfo.name} → SYNCING state (progress: 0%)`);
          } catch (e) {
            // Log detailed error for diagnosis
            console.warn(`⚠️ [SYNC] Could not transition ${deviceInfo.name} from ${currentState} to SYNCING:`, e);
            // syncProgress is already set to 0, so UI will still show progress
          }
        } else {
          console.error(`❌ [SYNC] Device ${deviceInfo.name} (${deviceInfo.id}) not found in store - address lookup failed`);
        }
      }

      // Broadcast STATE_UPDATE immediately to show syncing state in UI (force bypasses throttle)
      await this.broadcastDeviceStatus(true);

      // Broadcast SYNC_STARTED
      if (this.broadcastFunction) {
        await this.broadcastFunction({
          type: 0x33, // SYNC_STARTED
          requestId: 0,
          timestamp: Date.now(),
          deviceCount: connectedDevices.length
        }, []);
      }

      // Set live sample callback to broadcast device timestamps during sync
      this.timeSyncManager.setOnSampleCallback((
        deviceId: string,
        deviceName: string,
        deviceTimestampMs: number,
        sampleIndex: number,
        totalSamples: number
      ) => {
        // Calculate progress percentage (0-99, reserve 100 for completion)
        const progress = Math.round(((sampleIndex + 1) / totalSamples) * 99);

        // Update syncProgress in store
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (storeDeviceId) {
          UnifiedBLEStateStore.setSyncProgress(storeDeviceId, progress);
        }

        if (this.broadcastFunction) {
          this.broadcastFunction({
            type: 0x34, // SYNC_PROGRESS - reuse for live updates
            requestId: 0,
            timestamp: Date.now(),
            deviceId,
            deviceName,
            clockOffsetMs: 0, // Not calculated yet during sampling
            deviceTimestampMs,
            success: true,
            message: `Sampling... ${sampleIndex + 1}/${totalSamples}`
          }, []).catch(err => console.error('Failed to broadcast sync sample:', err));
        }
      });

      // Create adapters
      const adapters = connectedDevices
        .map(info => {
          const device = this.bleService.getDeviceInstance(info.id);
          return device ? new TropXTimeSyncAdapter(device) : null;
        })
        .filter((adapter): adapter is TropXTimeSyncAdapter => adapter !== null);

      // Fix #4: Use Promise.allSettled to handle partial sync failures gracefully
      // This allows some devices to sync successfully even if others fail (e.g., disconnect during sync)
      const syncResults = await Promise.allSettled(
        adapters.map(adapter => this.timeSyncManager.syncDevice(adapter))
      );

      // Convert settled results to standard result format
      const results = syncResults.map((settled, i) => {
        if (settled.status === 'fulfilled') {
          return settled.value;
        } else {
          console.error(`❌ [SYNC] Device sync rejected:`, settled.reason);
          return {
            success: false,
            deviceName: adapters[i]?.deviceName || 'Unknown',
            finalOffset: 0,
            deviceTimestampMs: 0,
            error: settled.reason?.message || 'Sync failed unexpectedly'
          };
        }
      });

      // Broadcast SYNC_PROGRESS for each device with clock offset
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const deviceInfo = connectedDevices[i];

        // DEBUG: Log what we're checking
        console.log(`🔍 [SYNC] Checking result for ${deviceInfo.name}:`, {
          success: result.success,
          finalOffset: result.finalOffset,
          hasOffset: result.finalOffset !== undefined,
          deviceId: deviceInfo.id
        });

        // Store clock offset in UnifiedBLEStateStore for DeviceProcessor to use
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceInfo.id);
        if (result.success && result.finalOffset !== undefined) {
          if (storeDeviceId) {
            // Set sync state and clock offset
            UnifiedBLEStateStore.setSyncState(storeDeviceId, SyncState.SYNCED, result.finalOffset);
            // Mark sync as complete (100%)
            UnifiedBLEStateStore.setSyncProgress(storeDeviceId, 100);
            console.log(`⏱️ [SYNC] Stored clock offset for ${deviceInfo.name} (${formatDeviceID(storeDeviceId)}): ${result.finalOffset}ms`);

            // CRITICAL: Transition from SYNCING -> SYNCED
            try {
              UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.SYNCED);
              // Keep syncProgress at 100 - will be cleared at next sync start
              console.log(`✅ [SYNC] Device ${deviceInfo.name} → SYNCED state (offset: ${result.finalOffset.toFixed(2)}ms)`);
              // Immediately broadcast so UI updates per-device (force bypasses throttle)
              await this.broadcastDeviceStatus(true);
            } catch (e) {
              console.warn(`⚠️ [SYNC] Could not transition ${deviceInfo.name} to SYNCED:`, e);
            }
          } else {
            console.error(`❌ [SYNC] Device ${deviceInfo.name} not found - cannot store offset`);
          }
        } else {
          console.warn(`⚠️ [SYNC] NOT storing offset for ${deviceInfo.name}: success=${result.success}, finalOffset=${result.finalOffset}`);

          // Transition back to CONNECTED if sync failed
          if (storeDeviceId) {
            // Clear sync progress on failure
            UnifiedBLEStateStore.setSyncProgress(storeDeviceId, null);
            try {
              UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
              console.log(`⚠️ [SYNC] Device ${deviceInfo.name} → CONNECTED state (sync failed)`);
              // Immediately broadcast so UI updates per-device (force bypasses throttle)
              await this.broadcastDeviceStatus(true);
            } catch (e) {
              console.warn(`⚠️ [SYNC] Could not transition ${deviceInfo.name} to CONNECTED:`, e);
            }
          }
        }

        if (this.broadcastFunction && deviceInfo) {
          await this.broadcastFunction({
            type: 0x34, // SYNC_PROGRESS
            requestId: 0,
            timestamp: Date.now(),
            deviceId: deviceInfo.id,
            deviceName: deviceInfo.name,
            clockOffsetMs: result.finalOffset || 0,
            deviceTimestampMs: result.deviceTimestampMs || 0,
            success: result.success,
            message: result.error || 'Synced successfully'
          }, []);
        }
      }

      // Broadcast SYNC_COMPLETE
      const successCount = results.filter(r => r.success).length;
      if (this.broadcastFunction) {
        await this.broadcastFunction({
          type: 0x35, // SYNC_COMPLETE
          requestId: 0,
          timestamp: Date.now(),
          totalDevices: results.length,
          successCount,
          failureCount: results.length - successCount
        }, []);
      }

      // Reset global state to IDLE
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);

      // Broadcast final status update (force bypasses throttle)
      await this.broadcastDeviceStatus(true);

      console.log(`✅ Manual sync complete: ${successCount}/${results.length} devices synced`);

      return { success: true, results };
    } catch (error) {
      console.error('❌ Manual sync failed:', error);
      // Ensure global state is reset even on error
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return { success: false, results: [] };
    }
  }

  // Disconnect device (also handles canceling CONNECTING/RECONNECTING states)
  async disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`🔌 BLE: Disconnecting/canceling device ${deviceId}`);

      // Get DeviceID for state checks and cleanup
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      const device = storeDeviceId ? UnifiedBLEStateStore.getDevice(storeDeviceId) : null;
      const currentState = device?.state;

      // Handle RECONNECTING state: cancel reconnection timer, no BLE disconnect needed
      if (currentState === DeviceState.RECONNECTING) {
        console.log(`🛑 Canceling reconnection for ${deviceId} (state: RECONNECTING)`);

        if (storeDeviceId) {
          // Cancel the reconnection timer
          ReconnectionManager.cancelReconnect(storeDeviceId);
          ReconnectionManager.cleanup(storeDeviceId);

          // Clear reconnect state in store
          UnifiedBLEStateStore.clearReconnectState(storeDeviceId);

          // Transition to DISCONNECTED
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
          } catch (e) {
            console.warn(`⚠️ Could not transition to DISCONNECTED:`, e);
          }

          // Clean up from motion processing
          if (this.motionCoordinator && typeof this.motionCoordinator.removeDevice === 'function') {
            this.motionCoordinator.removeDevice(storeDeviceId);
          }
        }

        console.log(`✅ Reconnection canceled for ${deviceId}`);
        await this.broadcastDeviceStatus();
        return { success: true, message: 'Reconnection canceled' };
      }

      // Handle CONNECTING state: try to abort connection and transition to DISCONNECTED
      if (currentState === DeviceState.CONNECTING) {
        console.log(`🛑 Canceling connection for ${deviceId} (state: CONNECTING)`);

        // Try to disconnect (may or may not work depending on connection state)
        try {
          await this.bleService.disconnectDevice(deviceId);
        } catch (e) {
          console.warn(`⚠️ Could not abort BLE connection (may not be established yet):`, e);
        }

        if (storeDeviceId) {
          // Clear any reconnect state
          UnifiedBLEStateStore.clearReconnectState(storeDeviceId);

          // Transition to DISCONNECTED
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
          } catch (e) {
            console.warn(`⚠️ Could not transition to DISCONNECTED:`, e);
          }

          // Clean up from motion processing
          if (this.motionCoordinator && typeof this.motionCoordinator.removeDevice === 'function') {
            this.motionCoordinator.removeDevice(storeDeviceId);
          }
        }

        console.log(`✅ Connection canceled for ${deviceId}`);
        await this.broadcastDeviceStatus();
        return { success: true, message: 'Connection canceled' };
      }

      // Normal disconnect flow for connected devices
      const result = await this.bleService.disconnectDevice(deviceId);

      console.log(`🔌 Disconnect result for ${deviceId}:`, result);

      if (result.success) {
        if (storeDeviceId) {
          // Notify disconnect through store (calls hook)
          UnifiedBLEStateStore.notifyDisconnect(storeDeviceId);

          // Transition to DISCONNECTED
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
          } catch (e) {
            console.warn(`⚠️ Could not transition to DISCONNECTED:`, e);
          }

          // CRITICAL: Clean up from motion processing to prevent stale data
          if (this.motionCoordinator && typeof this.motionCoordinator.removeDevice === 'function') {
            console.log(`🧹 Cleaning up device ${formatDeviceID(storeDeviceId)} from motion processing`);
            this.motionCoordinator.removeDevice(storeDeviceId);
          }
        }
        console.log(`🪝 [BLEServiceAdapter] Device disconnected: ${deviceId}`);

        // Broadcast device status update
        await this.broadcastDeviceStatus();
      } else {
        console.warn(`⚠️ Disconnect failed for ${deviceId}: ${result.message}`);
      }

      return result;

    } catch (error) {
      console.error(`❌ BLE disconnect failed for ${deviceId}:`, error);
      return {
        success: false,
        message: `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Remove device entirely (cancel reconnect and remove from registry)
  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`🗑️ BLE: Removing device ${deviceId}`);

      const result = await this.bleService.removeDevice(deviceId);

      if (result.success) {
        // Get DeviceID before unregistering
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

        if (storeDeviceId) {
          // Clean up from motion processing
          if (this.motionCoordinator && typeof this.motionCoordinator.removeDevice === 'function') {
            console.log(`🧹 Cleaning up device ${formatDeviceID(storeDeviceId)} from motion processing`);
            this.motionCoordinator.removeDevice(storeDeviceId);
          }
          // Full unregister (clears state and hook)
          UnifiedBLEStateStore.unregisterDevice(storeDeviceId);
        }
        console.log(`🪝 [BLEServiceAdapter] Device removed: ${deviceId}`);

        // Broadcast device status update to remove from UI
        await this.broadcastDeviceStatus();
      }

      return result;
    } catch (error) {
      console.error(`❌ BLE remove device failed for ${deviceId}:`, error);
      return {
        success: false,
        message: `Remove device failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Start recording (streaming quaternion data)
  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }> {
    if (this.isCurrentlyRecording) {
      // Idempotent: if already recording, return success
      console.log('🎬 Recording already active - returning success (idempotent)');
      return { success: true, message: 'Recording already active', recordingId: sessionId };
    }

    try {
      console.log(`🎬 BLE: Starting recording session ${sessionId}`);

      // Reset first packet tracking for delta calculations
      const { TropXDevice } = await import('./TropXDevice');
      TropXDevice.resetFirstPacketTracking();

      // Clear clock offsets for all devices - will be recalculated from first streaming packet
      const connectedDevices = this.bleService.getConnectedDevices();
      for (const device of connectedDevices) {
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(device.id);
        if (storeDeviceId) {
          UnifiedBLEStateStore.setSyncState(storeDeviceId, SyncState.NOT_SYNCED, 0);
          console.log(`🔄 [${device.name}] Cleared clock offset - will recalculate from first packet`);
        }
      }

      // Set global streaming state
      UnifiedBLEStateStore.setGlobalState(GlobalState.STREAMING);
      PollingManager.block('streaming');

      // Motion processing will be handled in WebSocket bridge (main process)

      // Start streaming on all connected devices with state validation
      const streamingResult = await this.bleService.startGlobalStreaming();

      if (streamingResult.success && streamingResult.started > 0) {
        this.isCurrentlyRecording = true;

        // Set up streaming recovery callback for watchdog
        Watchdog.setStreamingRecoveryCallback(async (deviceId, bleAddress) => {
          console.log(`🔄 [Watchdog] Attempting streaming recovery for ${bleAddress}...`);
          try {
            const device = this.bleService.getDeviceInstance(bleAddress);
            if (!device) {
              console.warn(`⚠️ [Watchdog] Device ${bleAddress} not found for streaming recovery`);
              return false;
            }

            // Reset device to IDLE first, then restart streaming
            await device.resetToIdle();
            await new Promise(resolve => setTimeout(resolve, 200));

            const success = await device.startStreaming();
            if (success) {
              console.log(`✅ [Watchdog] Streaming restarted for ${bleAddress}`);
            }
            return success;
          } catch (error) {
            console.error(`❌ [Watchdog] Streaming recovery failed for ${bleAddress}:`, error);
            return false;
          }
        });

        // Set up BLE connection check callback for watchdog
        // This prevents false disconnects when data pauses but BLE is still connected
        Watchdog.setBLEConnectionCheckCallback((bleAddress) => {
          return this.bleService.isDeviceActuallyConnected(bleAddress);
        });

        // Start watchdog to detect silent devices
        Watchdog.start();
        console.log('🐕 Watchdog started - monitoring device heartbeats (fast detection)');

        // Broadcast recording state
        await this.broadcastRecordingState(true, sessionId);

        return {
          success: true,
          message: `Recording started on ${streamingResult.started} device(s)`,
          recordingId: sessionId
        };
      } else {
        // Streaming failed - reset global state
        UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
        PollingManager.unblock();

        // Return detailed error if devices couldn't be reset
        return {
          success: false,
          message: streamingResult.error || `Failed to start streaming: ${streamingResult.started}/${streamingResult.total} devices`,
          error: streamingResult.error
        } as any;
      }

    } catch (error) {
      console.error('❌ BLE recording start failed:', error);
      // Reset global state on error
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      PollingManager.unblock();
      return {
        success: false,
        message: `Recording start failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Stop recording
  async stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }> {
    if (!this.isCurrentlyRecording) {
      // Idempotent: return success if not recording
      return { success: true, message: 'No recording in progress' };
    }

    let stopError: Error | null = null;

    try {
      console.log('🛑 BLE: Stopping recording session');

      // Stop watchdog monitoring FIRST (always)
      Watchdog.stop();
      console.log('🐕 Watchdog stopped');

      // Try to stop streaming on all devices (may timeout on disconnected devices)
      try {
        await this.bleService.stopStreamingAll();
      } catch (streamingError) {
        console.warn('⚠️ stopStreamingAll failed (device may be disconnected):', streamingError);
        stopError = streamingError as Error;
        // Continue with cleanup - don't throw
      }

    } catch (error) {
      console.error('❌ BLE recording stop failed:', error);
      stopError = error as Error;
    } finally {
      // CRITICAL: Always reset state regardless of success/failure
      // This ensures the system can recover from failed stops
      console.log('🧹 Resetting recording state (finally block)');

      this.isCurrentlyRecording = false;

      // Reset global state and resume polling
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      PollingManager.unblock();

      // Broadcast recording state and device status
      try {
        await this.broadcastRecordingState(false);
        await this.broadcastDeviceStatus();
      } catch (broadcastError) {
        console.warn('⚠️ Failed to broadcast state after stop:', broadcastError);
      }
    }

    if (stopError) {
      return {
        success: false,
        message: `Recording stop had errors: ${stopError.message}`
      };
    }

    return {
      success: true,
      message: 'Recording stopped successfully'
    };
  }

  // Get connected devices
  getConnectedDevices(): any[] {
    // Get devices from NobleBluetoothService which has actual TropXDevice instances
    const devices = this.bleService.getConnectedDevices();
    return devices.map(this.convertToDeviceInfo);
  }

  // Check if recording
  isRecording(): boolean {
    return this.isCurrentlyRecording;
  }

  // Per-device packet counters for sparse diagnostic logging
  private perDevicePacketCount = new Map<string, number>();

  // Handle motion data from BLE devices
  // Uses UnifiedBLEStateStore for O(1) lookup with pre-bound device context
  private async handleMotionData(deviceId: string, motionData: MotionData): Promise<void> {
    // Per-device packet counting for diagnostics
    const count = (this.perDevicePacketCount.get(deviceId) || 0) + 1;
    this.perDevicePacketCount.set(deviceId, count);

    // Sparse logging: every 50 packets per device
    if (count % 50 === 1) {
      const device = UnifiedBLEStateStore.getDeviceByAddress(deviceId);
      const name = device?.bleName || deviceId.slice(-8);
      console.log(`📊 [${name}] Packet #${count}`);
    }

    try {
      const hookData: HookMotionData = {
        timestamp: motionData.timestamp,
        quaternion: motionData.quaternion
      };

      const resolvedDeviceId = UnifiedBLEStateStore.dispatchMotionData(deviceId, hookData);

      if (!resolvedDeviceId) {
        // Fallback: Try direct lookup (log only first occurrence per device)
        if (count === 1) {
          console.warn(`⚠️ [${deviceId}] No hook registered, using fallback`);
        }

        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (!storeDeviceId) {
          if (count === 1) {
            console.error(`❌ [${deviceId}] Device not found - cannot process data`);
          }
          return;
        }

        if (this.motionCoordinator) {
          this.motionCoordinator.processNewData(storeDeviceId, hookData);
        }
      }

    } catch (error) {
      console.error(`Error handling motion data from ${deviceId}:`, error);
    }
  }

  // Get device name by ID for motion processing
  private getDeviceNameById(deviceId: string): string {
    const device = UnifiedBLEStateStore.getDeviceByAddress(deviceId);
    return device?.bleName || deviceId;
  }

  // Handle device events (public so it can be used as callback from BLE service)
  async handleDeviceEvent(deviceId: string, event: string, data?: any): Promise<void> {
    console.log(`📱 Device event: ${deviceId} - ${event}`, data ? data : '');

    // Broadcast device status updates for connected/discovered
    // NOTE: 'disconnected' is NOT broadcasted here - it's handled by auto_reconnect
    // This prevents the UI from briefly showing wrong state before RECONNECTING
    if (['connected', 'discovered'].includes(event)) {
      await this.broadcastDeviceStatus();
    }

    // Handle battery updates
    if (event === 'battery_update' && data) {
      await this.broadcastBatteryUpdate(deviceId, data.batteryLevel);
      // Also broadcast device status to ensure UI gets battery update
      await this.broadcastDeviceStatus();
    }

    // Handle state changes (from state polling)
    if (event === 'state_changed' && data) {
      // Broadcast device status to update UI with new state
      await this.broadcastDeviceStatus();
    }

    // Handle auto-reconnect trigger
    // CRITICAL: This handles the 'disconnected' → RECONNECTING transition
    // Uses unified ReconnectionManager for cross-platform support
    if (event === 'auto_reconnect' && data) {
      console.log(`🔄 Auto-reconnect triggered for ${data.deviceName}`);

      // Get DeviceID from BLE address
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(data.deviceId);
      if (!storeDeviceId) {
        console.error(`❌ [${data.deviceName}] Cannot reconnect - device not found in store`);
        return;
      }

      // ReconnectionManager handles state transition and scheduling
      // It will transition to RECONNECTING and schedule with exponential backoff
      ReconnectionManager.scheduleReconnect(storeDeviceId, DisconnectReason.CONNECTION_LOST);

      // Broadcast IMMEDIATELY after state update
      await this.broadcastDeviceStatus();
    }

    // Handle explicit disconnect (user-requested, not auto-reconnect)
    if (event === 'disconnected' && !data?.auto_reconnect) {
      // Only broadcast if this is NOT followed by auto_reconnect
      // The 'auto_reconnect' event will handle the state and broadcast
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        const device = UnifiedBLEStateStore.getDevice(storeDeviceId);
        // If device is in ERROR or already DISCONNECTED, broadcast now
        if (device && (device.state === DeviceState.ERROR || device.state === DeviceState.DISCONNECTED)) {
          await this.broadcastDeviceStatus();
        }
        // Otherwise, wait for auto_reconnect event which will handle it
      }
    }
  }

  /**
   * Broadcast device status update
   * Delegates to UnifiedBLEStateStore's single broadcast path
   * @param force - If true, bypass debounce for immediate broadcast
   */
  private async broadcastDeviceStatus(force = false): Promise<void> {
    if (force) {
      // Immediate broadcast for important state changes (sync, locate, etc.)
      UnifiedBLEStateStore.forceBroadcast();
    } else {
      // Debounced broadcast via store (50ms debounce)
      UnifiedBLEStateStore.queueBroadcast();
    }
  }

  // Broadcast battery update - now handled via STATE_UPDATE
  private async broadcastBatteryUpdate(deviceId: string, batteryLevel: number): Promise<void> {
    // Update store and let STATE_UPDATE handle broadcast
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (storeDeviceId) {
      UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { batteryLevel });
      console.log(`🔋 Updated battery level: ${batteryLevel}% for ${formatDeviceID(storeDeviceId)}`);
    }
  }

  // Broadcast recording state
  private async broadcastRecordingState(isRecording: boolean, sessionId?: string): Promise<void> {
    if (!this.broadcastFunction) return;

    try {
      const message = {
        type: 'recording_state',
        data: {
          isRecording,
          startTime: isRecording ? new Date().toISOString() : undefined,
          sessionId
        },
        timestamp: Date.now()
      };

      await this.broadcastFunction(message, []);

    } catch (error) {
      console.error('Error broadcasting recording state:', error);
    }
  }

  // Convert TropX device info to WebSocket Bridge format
  private convertToDeviceInfo(tropxDevice: TropXDeviceInfo): DeviceInfo {
    return {
      id: tropxDevice.id,
      name: tropxDevice.name,
      connected: tropxDevice.state === 'connected' || tropxDevice.state === 'streaming',
      batteryLevel: tropxDevice.batteryLevel
    };
  }

  // Convert UnifiedDeviceState to DeviceInfo format
  private convertUnifiedToDeviceInfo(device: import('../ble-management').UnifiedDeviceState): DeviceInfo {
    return {
      id: device.bleAddress,
      name: device.bleName,
      connected: [DeviceState.CONNECTED, DeviceState.SYNCING, DeviceState.SYNCED, DeviceState.STREAMING].includes(device.state),
      batteryLevel: device.batteryLevel
    };
  }

  // Setup event listeners for immediate UI notifications
  private setupStateManagerEventListeners(): void {
    // Listen for device state changes from UnifiedBLEStateStore
    UnifiedBLEStateStore.on('deviceStateChanged', async (change) => {
      try {
        // State changes trigger STATE_UPDATE broadcast automatically via store
        console.log(`📡 Device state changed: ${change.deviceId} ${change.previousState} → ${change.newState}`);
      } catch (error) {
        console.error('Error handling device state change:', error);
      }
    });

    // Listen for global state changes
    UnifiedBLEStateStore.on('globalStateChanged', async (change) => {
      try {
        console.log(`📡 Global state changed: ${change.previousState} → ${change.newState}`);

        // Update polling manager
        PollingManager.onGlobalStateChange(change.newState);
      } catch (error) {
        console.error('Error handling global state change:', error);
      }
    });

    // Set up broadcast function for store
    UnifiedBLEStateStore.setBroadcastFunction(async (message) => {
      if (this.broadcastFunction) {
        console.log(`📡 [STORE→WS] Broadcasting STATE_UPDATE: globalState=${message.globalState}, devices=${message.devices?.length || 0}`);
        await this.broadcastFunction(message, []);
      } else {
        console.warn('⚠️ [STORE→WS] Broadcast SKIPPED - WebSocket broadcast function not yet configured');
      }
    });
  }

  // Utility delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get all devices (for state query on reconnect)
  // CRITICAL: Also returns globalState and isRecording for full state recovery
  getAllDevices(): { success: boolean; devices: any[]; globalState: string; isRecording: boolean } {
    try {
      const allDevices = UnifiedBLEStateStore.getAllDevices();
      const globalState = UnifiedBLEStateStore.getGlobalState();

      return {
        success: true,
        globalState: globalState,
        isRecording: this.isCurrentlyRecording,
        devices: allDevices.map(d => ({
          id: d.bleAddress,
          name: d.bleName,
          address: d.bleAddress,
          rssi: d.rssi,
          state: d.state,
          batteryLevel: d.batteryLevel,
          deviceId: d.deviceId,
          // Include all state fields for full recovery
          syncState: d.syncState,
          clockOffset: d.clockOffset,
          syncProgress: d.syncProgress,
          isVibrating: d.isVibrating,
          reconnectAttempts: d.reconnectAttempts,
          nextReconnectAt: d.nextReconnectAt,
          lastError: d.lastError,
          displayName: getDeviceDisplayName(d.deviceId),
          shortName: d.deviceId ? formatDeviceID(d.deviceId).split(' ')[0] : '',
          joint: getJointDisplayName(d.deviceId),
          placement: isShin(d.deviceId) ? 'shin' : 'thigh',
        }))
      };
    } catch (error) {
      console.error('Error getting all devices:', error);
      return { success: false, devices: [], globalState: 'idle', isRecording: false };
    }
  }

  // Clear device states (manual cleanup, e.g., before new session)
  clearDeviceStates(): void {
    console.log('🗑️ Manually clearing device states...');
    UnifiedBLEStateStore.clear();
  }

  // @deprecated Use clearDeviceStates() instead
  clearSensorStates(): void {
    this.clearDeviceStates();
  }

  // @deprecated Use clearDeviceStates() instead
  clearDeviceRegistry(): void {
    this.clearDeviceStates();
  }

  // Start locate mode (accelerometer-based device detection)
  async startLocateMode(): Promise<{ success: boolean; message?: string }> {
    try {
      console.log('🔍 Starting locate mode...');

      // CRITICAL: Disable burst scanning to prevent interference with accelerometer notifications
      if (this.bleService.isBurstScanningEnabled) {
        console.log('🛑 Disabling burst scanning during locate mode (prevents notification interference)');
        this.bleService.disableBurstScanning();
      }

      const connectedDevices = this.bleService.getConnectedDevices();
      if (connectedDevices.length === 0) {
        return { success: false, message: 'No connected devices' };
      }

      // Get TropXDevice instances for all connected devices
      const deviceInstances = connectedDevices
        .map(info => this.bleService.getDeviceInstance(info.id))
        .filter(device => device !== null);

      if (deviceInstances.length === 0) {
        return { success: false, message: 'No device instances available' };
      }

      // Set global state to LOCATING (blocks polling, shows UI indicator)
      UnifiedBLEStateStore.setGlobalState(GlobalState.LOCATING);

      // Start accelerometer streaming on all devices
      // isVibrating state is now part of STATE_UPDATE, broadcast automatically via store
      await this.deviceLocateService.startLocateMode(deviceInstances);

      console.log(`✅ Locate mode started for ${deviceInstances.length} devices`);
      return { success: true };

    } catch (error) {
      console.error('❌ Failed to start locate mode:', error);
      // Reset global state on error
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Stop locate mode
  async stopLocateMode(): Promise<{ success: boolean; message?: string }> {
    try {
      console.log('🛑 Stopping locate mode...');

      // Stop accelerometer streaming (also clears isVibrating state in store)
      await this.deviceLocateService.stopLocateMode();

      // Reset global state to IDLE
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);

      console.log('✅ Locate mode stopped');
      return { success: true };

    } catch (error) {
      console.error('❌ Failed to stop locate mode:', error);
      // Reset global state even on error to prevent stuck state
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  enableBurstScanningFor(durationMs: number): void {
    this.bleService.enableBurstScanningFor(durationMs);
  }

  disableBurstScanning(): void {
    this.bleService.disableBurstScanning();
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up BLE Service Adapter...');

    if (this.isCurrentlyRecording) {
      await this.stopRecording();
    }

    // Stop locate mode if active
    await this.deviceLocateService.stopLocateMode();

    // Clear all device state and hooks
    UnifiedBLEStateStore.clear();
    console.log('🪝 [BLEServiceAdapter] Cleared all device state and hooks');

    this.bleService.disableBurstScanning();
    await this.bleService.cleanup();
  }
}