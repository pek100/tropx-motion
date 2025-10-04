import React from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';
import { Button } from './ui/button';

const CompanyLogo: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
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
);

interface TitleBarProps {
  title?: string;
  className?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = "Tropx Motion",
  className = ""
}) => {
  const handleMinimize = () => {
    window.electronAPI?.window?.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window?.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.window?.close();
  };

  return (
    <div
      className={`
        flex items-center justify-between h-8 px-4 bg-[#1F1E24] border-b border-gray-800
        select-none ${className}
      `}
      style={{
        WebkitAppRegion: 'drag' as any, // Make the entire title bar draggable
      }}
    >
      {/* Left section - Logo and title */}
      <div className="flex items-center space-x-2">
        <CompanyLogo className="w-5 h-5" />
        <span className="text-sm font-medium text-white/90">{title}</span>
      </div>

      {/* Right section - Window controls */}
      <div
        className="flex items-center space-x-1"
        style={{
          WebkitAppRegion: 'no-drag' as any, // Make buttons clickable
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-white/10 text-white/70 hover:text-white"
          onClick={handleMinimize}
          title="Minimize"
        >
          <Minimize2 className="h-3 w-3" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-white/10 text-white/70 hover:text-white"
          onClick={handleMaximize}
          title="Maximize"
        >
          <Maximize2 className="h-3 w-3" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-red-500/20 text-white/70 hover:text-red-400"
          onClick={handleClose}
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};
