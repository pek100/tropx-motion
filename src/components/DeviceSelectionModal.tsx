import React from 'react';
import { DeviceInfo, DeviceState } from '../core/types';

interface DeviceSelectionModalProps {
  isOpen: boolean;
  devices: DeviceInfo[];
  onSelectDevice: (deviceId: string) => void;
  onClose: () => void;
  isConnecting?: boolean;
  connectingDeviceId?: string;
}

export const DeviceSelectionModal: React.FC<DeviceSelectionModalProps> = ({
  isOpen,
  devices,
  onSelectDevice,
  onClose,
  isConnecting = false,
  connectingDeviceId
}) => {
  if (!isOpen) return null;

  const availableDevices = devices.filter(device => 
    device.state === DeviceState.DISCONNECTED_AVAILABLE
  );

  const getDeviceTypeIcon = (deviceName: string) => {
    const name = deviceName.toLowerCase();
    if (name.includes('tropx')) return '🦿';
    if (name.includes('muse')) return '🧠';
    return '📱';
  };

  const isPreferredDevice = (deviceName: string) => {
    const name = deviceName.toLowerCase();
    return name.includes('tropx') || name.includes('muse');
  };

  const handleDeviceSelect = (deviceId: string) => {
    if (isConnecting) return;
    onSelectDevice(deviceId);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Bluetooth Device
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={isConnecting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {availableDevices.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} 
                      d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </div>
            <p className="text-gray-600 dark:text-gray-300 mb-2">No devices found</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Make sure your Tropx devices are:
            </p>
            <ul className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-left">
              <li>• Powered on</li>
              <li>• In pairing mode</li>
              <li>• Within range</li>
              <li>• Bluetooth is enabled on your computer</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Found {availableDevices.length} device(s). Select one to connect:
            </p>
            
            <div className="max-h-64 overflow-y-auto space-y-2">
              {availableDevices.map((device) => {
                const isConnectingThis = isConnecting && connectingDeviceId === device.id;
                const isPreferred = isPreferredDevice(device.name);
                
                return (
                  <button
                    key={device.id}
                    onClick={() => handleDeviceSelect(device.id)}
                    disabled={isConnecting}
                    className={`
                      w-full p-4 rounded-lg border text-left transition-all duration-200
                      ${isPreferred 
                        ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700' 
                        : 'border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-600'
                      }
                      ${isConnecting 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'hover:shadow-md cursor-pointer'
                      }
                      ${isConnectingThis ? 'ring-2 ring-blue-500' : ''}
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">
                          {getDeviceTypeIcon(device.name)}
                        </span>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {device.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {device.id.slice(-8)}
                          </div>
                          {isPreferred && (
                            <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                              ✓ Tropx/Muse Device
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {isConnectingThis && (
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                          <span className="text-sm text-blue-600 dark:text-blue-400">
                            Connecting...
                          </span>
                        </div>
                      )}
                      
                      {device.batteryLevel !== null && (
                        <div className="text-sm text-gray-500">
                          🔋 {device.batteryLevel}%
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            disabled={isConnecting}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          {availableDevices.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 self-center">
              Click a device to connect
            </p>
          )}
        </div>
      </div>
    </div>
  );
};