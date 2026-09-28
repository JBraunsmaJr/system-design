import type { Dispatch, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import {
  Palette,
  Sparkles,
  ChevronRight,
  BringToFront,
  ChevronUp,
  ChevronDown,
  SendToBack,
} from 'lucide-react';
import { ColorPickerPanel } from './ColorPickerPanel';
import { IconPickerPanel } from './IconPicker';
import type { ZOrderCommand } from '../../domain/canvas/zOrder';

export const CONTEXT_MENU_WIDTH = 180;
export const CONTEXT_MENU_HEIGHT = 160;

export interface ContextMenuState {
  x: number;
  y: number;
  targetIds: string[];
}

export interface CanvasContextMenuPortalProps {
  contextMenu: ContextMenuState | null;
  activeSubmenu: 'color' | 'icon' | null;
  setActiveSubmenu: Dispatch<SetStateAction<'color' | 'icon' | null>>;
  onZOrderCommand: (command: ZOrderCommand, targetIds: string[]) => void;
  closeContextMenu: () => void;
  targetCurrentColor?: string;
  targetDefaultColor: string;
  handleColorChange: (color: string | undefined) => void;
  targetCurrentIcon?: string;
  targetDefaultIcon?: string;
  handleIconChange: (icon: string | undefined) => void;
}

export function CanvasContextMenuPortal({
  contextMenu,
  activeSubmenu,
  setActiveSubmenu,
  onZOrderCommand,
  closeContextMenu,
  targetCurrentColor,
  targetDefaultColor,
  handleColorChange,
  targetCurrentIcon,
  targetDefaultIcon,
  handleIconChange,
}: CanvasContextMenuPortalProps) {
  if (!contextMenu) return null;

  return createPortal(
    <>
      <div
        className="canvas-context-menu"
        style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          width: CONTEXT_MENU_WIDTH,
        }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          className={activeSubmenu === 'color' ? 'is-active' : undefined}
          onClick={() => setActiveSubmenu((prev) => (prev === 'color' ? null : 'color'))}
          onMouseEnter={() => setActiveSubmenu('color')}
        >
          <Palette size={13} />
          <span>Change color</span>
          <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />
        </button>

        <button
          type="button"
          role="menuitem"
          className={activeSubmenu === 'icon' ? 'is-active' : undefined}
          onClick={() => setActiveSubmenu((prev) => (prev === 'icon' ? null : 'icon'))}
          onMouseEnter={() => setActiveSubmenu('icon')}
        >
          <Sparkles size={13} />
          <span>Change icon</span>
          <ChevronRight size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />
        </button>

        <div className="canvas-context-menu__divider" />

        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setActiveSubmenu(null)}
          onClick={() => {
            onZOrderCommand('front', contextMenu.targetIds);
            closeContextMenu();
          }}
        >
          <BringToFront size={13} />
          Bring to front
        </button>
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setActiveSubmenu(null)}
          onClick={() => {
            onZOrderCommand('forward', contextMenu.targetIds);
            closeContextMenu();
          }}
        >
          <ChevronUp size={13} />
          Bring forward
        </button>
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setActiveSubmenu(null)}
          onClick={() => {
            onZOrderCommand('backward', contextMenu.targetIds);
            closeContextMenu();
          }}
        >
          <ChevronDown size={13} />
          Send backward
        </button>
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setActiveSubmenu(null)}
          onClick={() => {
            onZOrderCommand('back', contextMenu.targetIds);
            closeContextMenu();
          }}
        >
          <SendToBack size={13} />
          Send to back
        </button>
      </div>

      {activeSubmenu === 'color' && (
        <ColorPickerPanel
          value={targetCurrentColor}
          defaultValue={targetDefaultColor}
          onChange={handleColorChange}
          onClose={closeContextMenu}
          style={{
            position: 'fixed',
            top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 220 - 8),
            left:
              contextMenu.x + CONTEXT_MENU_WIDTH + 176 <= window.innerWidth - 8
                ? contextMenu.x + CONTEXT_MENU_WIDTH + 4
                : Math.max(8, contextMenu.x - 176 - 4),
          }}
        />
      )}

      {activeSubmenu === 'icon' && (
        <IconPickerPanel
          value={targetCurrentIcon}
          defaultValue={targetDefaultIcon}
          onChange={handleIconChange}
          onClose={closeContextMenu}
          style={{
            position: 'fixed',
            top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 420 - 8),
            left:
              contextMenu.x + CONTEXT_MENU_WIDTH + 340 <= window.innerWidth - 8
                ? contextMenu.x + CONTEXT_MENU_WIDTH + 4
                : Math.max(8, contextMenu.x - 340 - 4),
            zIndex: 301,
          }}
        />
      )}
    </>,
    document.body,
  );
}
