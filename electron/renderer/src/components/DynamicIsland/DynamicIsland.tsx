import { motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import './DynamicIsland.css';

interface DynamicIslandProps {
  children?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
}

const BOUNCE_VARIANTS = {
  collapsed: 0.5,
  expanded: 0.3,
} as const;

export function DynamicIsland({ children, expanded: controlledExpanded, onToggle }: DynamicIslandProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalExpanded(!expanded);
    }
  };

  return (
    <div className="dynamic-island-container">
      <motion.div
        className="dynamic-island-morphing"
        layout
        style={{ borderRadius: 32 }}
        transition={{
          type: 'spring',
          bounce: expanded ? BOUNCE_VARIANTS.expanded : BOUNCE_VARIANTS.collapsed,
          duration: 0.4,
        }}
        onClick={handleToggle}
      >
        <motion.div
          className="dynamic-island-content-wrapper"
          animate={{
            scale: 1,
            opacity: 1,
            filter: 'blur(0px)',
          }}
          initial={{
            scale: 0.95,
            opacity: 0,
            filter: 'blur(3px)',
          }}
          key={expanded ? 'expanded' : 'collapsed'}
          transition={{
            type: 'spring',
            bounce: 0.3,
            duration: 0.3,
          }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}
