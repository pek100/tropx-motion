import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PlatformInfo {
  isRaspberryPi: boolean;
  model?: string;
  architecture: string;
  totalMemoryMB: number;
  cpuCount: number;
  platform: string;
}

interface OptimizationConfig {
  maxOldSpaceSize: number;
  useGPU: boolean;
  maxDevices: number;
}

export function PlatformIndicator() {
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig | null>(null);

  useEffect(() => {
    // Fetch platform info from main process
    window.electronAPI?.system.getPlatformInfo().then((data: any) => {
      setPlatformInfo(data.info);
      setOptimizationConfig(data.config);
    }).catch((error: any) => {
      console.error('Failed to get platform info:', error);
    });
  }, []);

  if (!platformInfo) return null;

  const getPlatformIcon = () => {
    if (platformInfo.isRaspberryPi) {
      // Raspberry Pi icon
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C10.9 2 10 2.9 10 4C10 4.3 10.1 4.6 10.2 4.9C9.5 5.1 8.9 5.5 8.4 6C8.1 5.9 7.7 5.9 7.4 6C6.6 6.2 6 7 6.2 7.8C6.3 8.2 6.6 8.5 6.9 8.7C6.7 9.4 6.6 10.2 6.6 11C6.6 11.8 6.7 11 6.6 11.5C6.3 11.7 6 12 5.9 12.4C5.7 13.2 6.3 14 7.1 14.2C7.4 14.3 7.8 14.3 8.1 14.2C8.6 14.7 9.2 15.1 9.9 15.3C9.8 15.6 9.7 15.9 9.7 16.2C9.7 17.3 10.6 18.2 11.7 18.2C12.8 18.2 13.7 17.3 13.7 16.2C13.7 15.9 13.6 15.6 13.5 15.3C14.2 15.1 14.8 14.7 15.3 14.2C15.6 14.3 16 14.3 16.3 14.2C17.1 14 17.7 13.2 17.5 12.4C17.4 12 17.1 11.7 16.8 11.5C16.8 11.2 16.8 10.8 16.8 10.5C16.8 9.7 16.7 8.9 16.5 8.2C16.8 8 17.1 7.7 17.2 7.3C17.4 6.5 16.8 5.7 16 5.5C15.7 5.4 15.3 5.4 15 5.5C14.5 5 13.9 4.6 13.2 4.4C13.3 4.1 13.4 3.8 13.4 3.5C13.4 2.4 12.5 1.5 11.4 1.5L12 2Z"/>
        </svg>
      );
    }

    // Desktop icon
    if (platformInfo.platform === 'darwin') {
      // Mac icon
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.09997 22C7.78997 22.05 6.79997 20.68 5.95997 19.47C4.24997 17 2.93997 12.45 4.69997 9.39C5.56997 7.87 7.12997 6.91 8.81997 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
        </svg>
      );
    }

    if (platformInfo.platform === 'win32') {
      // Windows icon
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 5.45455V10.9091H10.9091V3.54545L3 5.45455ZM3 18.5455L10.9091 20.4545V13.0909H3V18.5455ZM13.0909 20.9091L21 22.5455V13.0909H13.0909V20.9091ZM21 1.45455L13.0909 3.09091V10.9091H21V1.45455Z"/>
        </svg>
      );
    }

    // Linux icon
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 17.17L18.83 16H15V13H18.83L20 11.83V7.83L18.83 6.66L17.17 8H13V4.83L14.17 3.66L12.83 2L11 3.83V8H7.83L6.66 6.83L5.17 8.5L6.66 10H11V13H7.17L5.66 11.5L4.17 13.17V17.17L5.66 18.5L7.17 17H11V21.17L9.17 23L10.83 24L12.66 22.17L14.5 24L16.17 22.83L14.17 20.83V17H17.17L18.66 18.5L20 17.17Z"/>
      </svg>
    );
  };

  const getPlatformLabel = () => {
    if (platformInfo.isRaspberryPi) {
      if (platformInfo.model?.includes('Raspberry Pi 5')) return 'Pi 5';
      if (platformInfo.model?.includes('Raspberry Pi 4')) return 'Pi 4';
      if (platformInfo.model?.includes('Raspberry Pi 3')) return 'Pi 3';
      return 'Pi';
    }

    if (platformInfo.platform === 'darwin') return 'Mac';
    if (platformInfo.platform === 'win32') return 'Win';
    return 'Linux';
  };

  const getColorClass = () => {
    if (platformInfo.isRaspberryPi) {
      return 'text-[#c51a4a]'; // Raspberry Pi red
    }
    return 'text-gray-700';
  };

  const formatMemory = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)}GB`;
    }
    return `${mb}MB`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="fixed bottom-4 left-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/80 backdrop-blur-sm shadow-sm transition-all hover:bg-white pointer-events-auto cursor-help"
          style={{
            zIndex: 50,
            WebkitAppRegion: 'no-drag' as any,
          }}
        >
          <div className={getColorClass()}>
            {getPlatformIcon()}
          </div>
          <span className="text-xs font-medium text-gray-700">{getPlatformLabel()}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div className="font-semibold border-b pb-1 mb-1">
            {platformInfo.isRaspberryPi ? platformInfo.model : `${getPlatformLabel()} Desktop`}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-gray-500">Memory:</span>
            <span className="font-mono">{formatMemory(platformInfo.totalMemoryMB)}</span>

            <span className="text-gray-500">CPU Cores:</span>
            <span className="font-mono">{platformInfo.cpuCount}</span>

            <span className="text-gray-500">Architecture:</span>
            <span className="font-mono">{platformInfo.architecture}</span>

            {optimizationConfig && (
              <>
                <span className="text-gray-500">Max Heap:</span>
                <span className="font-mono">{optimizationConfig.maxOldSpaceSize}MB</span>

                <span className="text-gray-500">GPU:</span>
                <span className={optimizationConfig.useGPU ? 'text-green-600' : 'text-gray-400'}>
                  {optimizationConfig.useGPU ? 'Enabled' : 'Disabled'}
                </span>

                <span className="text-gray-500">Max Devices:</span>
                <span className="font-mono">{optimizationConfig.maxDevices}</span>
              </>
            )}
          </div>
          <div className="pt-1 mt-1 border-t text-[10px] text-gray-400">
            {platformInfo.isRaspberryPi ? '🍓 Optimized for Raspberry Pi' : '🖥️ Desktop Performance Mode'}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
