import { platformInfo } from '@/lib/platform';
import { Monitor, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DesktopRequiredProps {
  feature?: string;
}

export function DesktopRequired({ feature = 'Recording' }: DesktopRequiredProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      {/* Sonar Animation Container */}
      <div className="relative mb-8">
        {/* Sonar Rings */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="sonar-ring sonar-ring-1" />
          <div className="sonar-ring sonar-ring-2" />
          <div className="sonar-ring sonar-ring-3" />
        </div>

        {/* Center Icon */}
        <div className="relative z-10 w-24 h-24 rounded-full bg-gradient-to-br from-[var(--tropx-vibrant)] to-[var(--tropx-dark)] flex items-center justify-center shadow-lg">
          <Monitor className="w-10 h-10 text-white" />
        </div>
      </div>

      {/* Message */}
      <h2 className="text-2xl font-semibold text-[var(--tropx-dark)] mb-3">
        Desktop App Required
      </h2>
      <p className="text-[var(--tropx-shadow)] mb-6 max-w-md">
        {feature} requires the TropX Motion desktop application to connect to
        Bluetooth sensors and capture motion data.
      </p>

      {/* Download Button */}
      <Button
        size="lg"
        className="gap-2 bg-[var(--tropx-vibrant)] hover:bg-[var(--tropx-dark)] text-white"
        onClick={() => window.open(platformInfo.downloadUrl, '_blank')}
      >
        <Download className="w-5 h-5" />
        Download Desktop App
      </Button>

      {/* Features available on web */}
      <div className="mt-8 p-4 rounded-xl bg-white/50 border border-[var(--tropx-vibrant)]/20 max-w-sm">
        <p className="text-sm font-medium text-[var(--tropx-dark)] mb-2">
          Available on Web:
        </p>
        <ul className="text-sm text-[var(--tropx-shadow)] space-y-1">
          <li className="flex items-center gap-2">
            <span className="text-[var(--tropx-vibrant)]">✓</span>
            View cloud recordings
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[var(--tropx-vibrant)]">✓</span>
            Manage contacts
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[var(--tropx-vibrant)]">✓</span>
            Account settings
          </li>
        </ul>
      </div>

      {/* CSS for Sonar Animation */}
      <style>{`
        .sonar-ring {
          position: absolute;
          border: 2px solid var(--tropx-vibrant);
          border-radius: 50%;
          opacity: 0;
          animation: sonar 3s ease-out infinite;
        }

        .sonar-ring-1 {
          width: 96px;
          height: 96px;
          animation-delay: 0s;
        }

        .sonar-ring-2 {
          width: 96px;
          height: 96px;
          animation-delay: 1s;
        }

        .sonar-ring-3 {
          width: 96px;
          height: 96px;
          animation-delay: 2s;
        }

        @keyframes sonar {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          100% {
            transform: scale(2.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default DesktopRequired;
