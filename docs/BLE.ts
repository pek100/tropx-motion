// ElectronMotionApp.tsx - ble scanning logic
import {museManager} from "../muse_sdk/core/MuseManager";

const handleScan = async () => {
    lastScanTimeRef.current = Date.now();
    dispatch({ type: "SET_SCANNING", payload: true });
    let timedOut = false;
    try {
        await Promise.race([
            navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
            }),
            new Promise((_, reject) =>
                setTimeout(() => {
                    timedOut = true;
                    reject(new Error("Scan timeout"));
                }, 10000)
            ),
        ]);
    } catch (error) {
        if (timedOut) {
            console.log("⏰ Scan timed out");
            dispatch({ type: "SET_SCANNING", payload: false });
            return;
        }
        // handle other errors if needed
    }
    setTimeout(() => {
        dispatch({ type: "SET_SCANNING", payload: false });
    }, CONSTANTS.TIMEOUTS.SCAN_DURATION);
};

//Ble communication with api
useEffect(() => {
    if (window.electronAPI) {
        window.electronAPI.motion.getWebSocketPort().then((port) => {
            console.log("🌐 Got WebSocket port from main process:", port);
            dispatch({ type: "SET_WS_PORT", payload: port });
        });
    } else {
        console.error("🌐 window.electronAPI not available");
    }
}, []);

//connect devices
const handleConnectDevices = async (devices: DeviceStateMachine[]) => {
    if (devices.length === 0) {
        alert("No devices available to connect");
        return;
    }

    const log = (message: string) => console.log(`🔗 ${message}`);

    const updateDeviceState = (deviceId: string, state: string, batteryLevel: number | null = null) => {
        dispatch({
            type: "UPDATE_DEVICE",
            payload: {
                deviceId,
                updates: {
                    state,
                    ...(batteryLevel !== null ? { batteryLevel } : {})
                }
            }
        });
    };

    const acquireFreshDevice = async (device: DeviceStateMachine, index: number) => {
        log(`[${index + 1}/${devices.length}] Acquiring fresh BluetoothDevice for ${device.name}...`);

        try {
            updateDeviceState(device.id, "connecting");

            const requestPromise = navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
            });

            try {
                await window.electronAPI?.bluetooth?.selectDevice(device.id);
            } catch (selectionError) {
                console.warn(`Device selection warning for ${device.name}:`, selectionError);
            }

            const freshDevice = await requestPromise;

            if (freshDevice && freshDevice.name) {
                log(`✅ [${index + 1}/${devices.length}] Fresh BluetoothDevice acquired: ${freshDevice.name}`);
                await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay
                return freshDevice;
            } else {
                console.warn(`⚠️ [${index + 1}/${devices.length}] No valid device returned for ${device.name}`);
                return null;
            }
        } catch (error) {
            console.error(`❌ [${index + 1}/${devices.length}] Failed to acquire fresh device for ${device.name}:`, error);
            return null;
        }
    };

    log(`Connecting to ${devices.length} device(s)...`);
    log(`Step 1: Acquiring fresh BluetoothDevices for ${devices.length} device(s)...`);

    const freshDeviceMap = new Map<string, any>();
    for (let i = 0; i < devices.length; i++) {
        const freshDevice = await acquireFreshDevice(devices[i], i);
        if (freshDevice) {
            freshDeviceMap.set(devices[i].name, freshDevice);
        }
    }

    log(`Step 2: Connecting to ${freshDeviceMap.size} fresh device(s) immediately...`);

    let successCount = 0;
    for (const device of devices) {
        const freshDevice = freshDeviceMap.get(device.name);
        if (!freshDevice) {
            console.error(`❌ No fresh device available for ${device.name}, skipping...`);
            continue;
        }

        log(`Connecting to ${device.name} with fresh GATT interface...`);
        try {
            const connected = await museManager.connectWebBluetoothDevice(
                freshDevice,
                CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT
            );

            if (connected) {
                await museManager.updateBatteryLevel(device.name);
                const batteryLevel = museManager.getBatteryLevel(device.name);

                updateDeviceState(device.id, "connected", batteryLevel ?? null);
                successCount++;
                log(`✅ Successfully connected to ${device.name} using fresh device`);
            } else {
                console.error(`❌ Connection failed for ${device.name}: SDK returned false`);
                updateDeviceState(device.id, "discovered");
            }
        } catch (error) {
            console.error(`❌ Connection error for ${device.name}:`, error);
            updateDeviceState(device.id, "discovered");
        }
    }

    if (successCount > 0) {
        startBatteryUpdateTimer();
    }

    log(`✅ Connection completed: ${successCount}/${devices.length} device(s) connected`);
};


UI Click → WebSocket/IPC → MuseManager → GATT Characteristic → BLE Device
