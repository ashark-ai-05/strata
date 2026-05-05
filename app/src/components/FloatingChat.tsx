import { motion, useMotionValue, useDragControls } from 'framer-motion';
import { useState } from 'react';
import { GripVertical, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { Chat } from './Chat';
import { ChatStatusBar } from './ChatStatusBar';
import { ChatOptionsMenu } from './ChatOptionsMenu';
import { useUiStore } from '../state/ui-store';

/**
 * Draggable floating chat shell. Hosts the existing <Chat /> body —
 * drag/resize/minimize/full are pure UI concerns, the streaming + tool
 * dispatch logic is unchanged.
 *
 * Modes (ui-store.chatWindow.mode):
 *   - 'open'       : full-size, draggable
 *   - 'minimized'  : titlebar only (body hidden via CSS)
 *   - 'collapsed'  : whole shell hidden — launcher bubble is shown instead
 *
 * fullMode toggles a wider variant for "give me the full thing" moments.
 *
 * Spec: REPLICATION-PROMPT.md §13.
 */
export function FloatingChat({ chatKey }: { chatKey: string }) {
  const chatWindow = useUiStore((s) => s.chatWindow);
  const setChatWindow = useUiStore((s) => s.setChatWindow);
  const chatBusy = useUiStore((s) => s.chatBusy);

  const x = useMotionValue(chatWindow.dragX);
  const y = useMotionValue(chatWindow.dragY);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);

  if (chatWindow.mode === 'collapsed') {
    return null;
  }

  return (
    <motion.aside
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      // Constrain to the viewport with some padding.
      dragConstraints={{
        left: -window.innerWidth + 200,
        top: -window.innerHeight + 80,
        right: 200,
        bottom: 100,
      }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        setChatWindow({ dragX: x.get(), dragY: y.get() });
      }}
      style={{ x, y, right: 24, bottom: 24 }}
      data-mode={chatWindow.mode}
      data-fullmode={chatWindow.fullMode}
      data-dragging={dragging ? 'true' : 'false'}
      data-streaming={chatBusy ? 'true' : 'false'}
      className="strata-chat-floating"
    >
      <ChatStatusBar />
      <header
        className="strata-chat-titlebar"
        onPointerDown={(e) => {
          // Only start a drag if the pointer isn't on a button —
          // otherwise the close/minimize buttons require a steady hand.
          if ((e.target as HTMLElement).closest('button')) return;
          dragControls.start(e);
        }}
        onDoubleClick={() => {
          // Double-click resets position to (0, 0) — easy escape if the
          // chat ends up off-screen on a multi-monitor setup.
          x.set(0);
          y.set(0);
          setChatWindow({ dragX: 0, dragY: 0 });
        }}
      >
        <span className="strata-chat-titlebar-grip">
          <GripVertical className="size-3.5" />
        </span>
        <span className="strata-chat-titlebar-title">Strata</span>
        <div className="strata-chat-titlebar-actions">
          <ChatOptionsMenu />
          <button
            type="button"
            className="strata-chat-titlebar-btn"
            title={chatWindow.fullMode === 'full' ? 'Restore size' : 'Expand'}
            onClick={() =>
              setChatWindow({
                fullMode: chatWindow.fullMode === 'full' ? 'normal' : 'full',
              })
            }
          >
            {chatWindow.fullMode === 'full' ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            className="strata-chat-titlebar-btn"
            title={chatWindow.mode === 'minimized' ? 'Expand' : 'Minimize'}
            onClick={() =>
              setChatWindow({
                mode: chatWindow.mode === 'minimized' ? 'open' : 'minimized',
              })
            }
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            className="strata-chat-titlebar-btn"
            data-danger="true"
            title="Hide chat (launcher bubble stays)"
            onClick={() => setChatWindow({ mode: 'collapsed' })}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="strata-chat-body">
        <Chat key={chatKey} />
      </div>
    </motion.aside>
  );
}

/**
 * Bubble shown when the floating chat is collapsed. Click to restore.
 */
export function FloatingChatLauncher() {
  const chatWindow = useUiStore((s) => s.chatWindow);
  const setChatWindow = useUiStore((s) => s.setChatWindow);
  if (chatWindow.mode !== 'collapsed') return null;
  return (
    <button
      type="button"
      className="strata-chat-launcher"
      onClick={() => setChatWindow({ mode: 'open' })}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: 'var(--color-accent)' }}
      />
      Open Strata
    </button>
  );
}
