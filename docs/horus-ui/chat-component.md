# Horus Chat Component

## Overview

The Horus Chat is a floating, draggable AI chat interface that appears at the bottom-right of the HorusPane. It allows users to ask questions about their biomechanical analysis data.

## Features

- **Fixed positioning** - Anchored to bottom-right of the pane
- **Horizontal dragging** - Drag within pane bounds when expanded
- **Auto-expand/collapse** - Expands when scrolling into trigger zone
- **User override** - Manual expansion persists until explicitly minimized
- **Pane-caged** - Chat stays within visible pane bounds during scroll

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HorusPane                                │
│  - Manages position state (bottom, left)                        │
│  - Calculates drag constraints                                   │
│  - Handles scroll/resize repositioning                          │
│  - Implements trigger zone auto-expand logic                    │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    motion.div (Framer Motion)              │ │
│  │  - Fixed positioning with calculated bottom/left           │ │
│  │  - Horizontal drag with constraints                        │ │
│  │  - Scale animations on show/hide                           │ │
│  │                              │                              │ │
│  │                              ▼                              │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │                  HorusChatInput                       │  │ │
│  │  │  - Minimized: Atom button (56x56)                    │  │ │
│  │  │  - Expanded: Full chat input (400x88)                │  │ │
│  │  │  - Handles user input, message display               │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Position Calculation

### Bottom-Right Anchoring

```typescript
const calculateChatPosition = (paneRect: DOMRect, chatWidth: number, chatHeight: number) => {
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Calculate visible pane area
  const visiblePaneTop = Math.max(paneRect.top, 0);
  const visiblePaneBottom = Math.min(paneRect.bottom, vh);

  // Distance from pane bottom to viewport bottom
  const paneBottomOffset = vh - Math.min(paneRect.bottom, vh);

  // Bottom position (magnetized to pane bottom)
  let bottom = Math.max(CHAT_PADDING_Y, paneBottomOffset + CHAT_PADDING_Y);

  // Clamp to visible pane area (prevents going above pane when scrolling)
  const maxBottom = vh - visiblePaneTop - chatHeight - CHAT_PADDING_Y;
  bottom = Math.min(bottom, maxBottom);

  // Right-align within pane
  let left = Math.min(paneRect.right, vw) - chatWidth - CHAT_PADDING_X;

  return { bottom, left };
};
```

### Drag Constraints

```typescript
const calculateDragConstraints = (paneRect: DOMRect, chatWidth: number, currentLeft: number) => {
  const visibleLeft = Math.max(paneRect.left, 0) + CHAT_PADDING_X;
  const visibleRight = Math.min(paneRect.right, window.innerWidth) - CHAT_PADDING_X;

  // How far can we drag from current position
  return {
    left: visibleLeft - currentLeft,   // Negative = can drag left
    right: visibleRight - chatWidth - currentLeft  // Positive = can drag right
  };
};
```

## Trigger Zone Auto-Expand

When the pane bottom is within 150px of the viewport bottom, the chat auto-expands:

```typescript
const TRIGGER_ZONE_HEIGHT = 150;

const checkTriggerZone = () => {
  // Skip if user manually expanded
  if (userExpandedRef.current) return;

  const paneRect = pane.getBoundingClientRect();
  const paneBottomInView = paneRect.bottom <= vh && paneRect.bottom > 0;
  const inTriggerZone = paneBottomInView && (vh - paneRect.bottom) < TRIGGER_ZONE_HEIGHT;

  if (inTriggerZone && !wasInZoneRef.current) {
    setIsMinimized(false);  // Auto-expand
  } else if (!inTriggerZone && wasInZoneRef.current) {
    setIsMinimized(true);   // Auto-collapse
  }
  wasInZoneRef.current = inTriggerZone;
};
```

### User Override

When user manually expands the chat, auto-collapse is disabled:

```typescript
// Use ref for immediate access in scroll handler (no stale closure)
const userExpandedRef = useRef(false);

// On expand button click
onExpand={() => {
  setIsMinimized(false);
  userExpandedRef.current = true;  // Prevents auto-collapse
}}

// On minimize button click
onMinimize={() => {
  setIsMinimized(true);
  userExpandedRef.current = false;  // Re-enables auto behavior
}}
```

## Animation

Using Framer Motion for smooth transitions:

```typescript
<AnimatePresence>
  {chatPosition && (
    <motion.div
      key={isMinimized ? "minimized" : "expanded"}  // Remount on state change
      style={{ bottom: chatPosition.bottom, left: chatPosition.left }}
      drag={isMinimized ? false : "x"}
      dragConstraints={dragConstraints}
      dragElastic={0.1}
      dragMomentum={false}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, x: 0 }}  // x:0 resets drag offset
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <HorusChatInput minimized={isMinimized} ... />
    </motion.div>
  )}
</AnimatePresence>
```

### Key Animation Details

- **Key changes on minimize toggle** - Forces remount, resetting drag transform
- **`animate={{ x: 0 }}`** - Explicitly resets horizontal position
- **No `mode` on AnimatePresence** - Parallel animations (cross-fade)
- **Animation only on parent** - Child `HorusChatInput` renders without animation to prevent SVG clipping

## Constants

```typescript
const CHAT_PADDING_X = 18;        // Horizontal padding from pane edge
const CHAT_PADDING_Y = 20;        // Vertical padding from pane edge
const TRIGGER_ZONE_HEIGHT = 150;  // Auto-expand trigger zone
```

## Component States

### Minimized (56x56 button)
- Atom icon button
- No dragging
- Always bottom-right aligned

### Expanded (400x88 input)
- Full chat input with text field
- Horizontal dragging enabled
- Previous chat pills displayed
- Drag handle at bottom

### Expanded with Pending Message
- Shows user message bubble
- AI "Thinking..." indicator
- Message action buttons (copy, edit, delete, regenerate)

## File Structure

```
electron/renderer/src/components/dashboard/horus/
├── HorusPane.tsx        # Position management, drag, trigger zone
├── HorusChatInput.tsx   # Chat UI (minimized button / expanded input)
└── hooks/
    └── useV2Analysis.ts # Analysis data fetching
```

## Related Documentation

- [Horus UI System](/docs/horus-ui/README.md)
- [Horus Backend](/docs/horus/README.md)
- [Horus V2](/docs/horus-v2/README.md)
