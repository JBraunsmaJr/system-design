import {
  BringToFront,
  SendToBack,
  ChevronUp,
  ChevronDown,
  Palette,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { ColorPickerPanel } from './ColorPickerPanel';
import { IconPickerPanel } from './IconPicker';
import { CONTEXT_MENU_WIDTH, type useCanvasContextMenu } from './useCanvasContextMenu';
import type { CanvasProps } from './Canvas';

/**
 * The right-click menu and its color and icon submenus. Moved unchanged
 * from Canvas.tsx, which renders it only while the menu is open - so this
 * component exists only then, and costs nothing while it is closed.
 *
 * Portaled to document.body and fixed-positioned for the same reason
 * CollabPanel's dropdown is: React Flow's viewport is a transformed,
 * clipping ancestor, and a menu rendered inside it would be scaled with the
 * zoom and clipped at the pane edge.
 */
type CanvasContextMenuState = ReturnType<typeof useCanvasContextMenu>;

export function CanvasContextMenu({
  contextMenu,
  activeSubmenu,
  setActiveSubmenu,
  closeContextMenu,
  onZOrderCommand,
  targetCurrentColor,
  targetDefaultColor,
  handleColorChange,
  targetCurrentIcon,
  targetDefaultIcon,
  handleIconChange,
}: Omit<
  Pick<
    CanvasContextMenuState,
    | 'contextMenu'
    | 'activeSubmenu'
    | 'setActiveSubmenu'
    | 'closeContextMenu'
    | 'targetCurrentColor'
    | 'targetDefaultColor'
    | 'handleColorChange'
    | 'targetCurrentIcon'
    | 'targetDefaultIcon'
    | 'handleIconChange'
  >,
  'contextMenu'
> &
  Pick<CanvasProps, 'onZOrderCommand'> & {
    contextMenu: NonNullable<CanvasContextMenuState['contextMenu']>;
  }) {
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
