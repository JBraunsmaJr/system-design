import {type ReactNode, useLayoutEffect, useRef, useState} from 'react';
import {
    BringToFront,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ClipboardPaste,
    Copy,
    Group,
    LayoutGrid,
    Link2,
    Lock,
    LockOpen,
    PackagePlus,
    Paintbrush,
    Palette,
    SendToBack,
    Sparkles,
    Ungroup,
} from 'lucide-react';
import {createPortal} from 'react-dom';
import type {Node} from '@xyflow/react';
import {ColorPickerPanel} from './ColorPickerPanel';
import {IconPickerPanel} from './IconPicker';
import {RequirementLinkPanel} from './RequirementLinkPanel';
import {ArrangeControls} from './ArrangeControls';
import {SaveFragmentPanel} from './SaveFragmentPanel';
import {canArrange} from '../../domain/canvas/arrange';
import {type CanvasContextActions, CONTEXT_MENU_WIDTH, type useCanvasContextMenu,} from './useCanvasContextMenu';
import type {CanvasProps} from './Canvas';
import {nodeHasIcon} from '../../domain/canvas/nodeDefaults';
import {describeStyle} from '../../domain/canvas/styleClipboard';
import type {ArchNodeData} from '../../domain/canvas/types';

/**
 * The right-click menu and its color, icon and requirement submenus.
 * Canvas renders it only while the menu is open - so this component exists
 * only then, and costs nothing while it is closed.
 *
 * Portaled to document.body and fixed-positioned for the same reason
 * CollabPanel's dropdown is: React Flow's viewport is a transformed,
 * clipping ancestor, and a menu rendered inside it would be scaled with the
 * zoom and clipped at the pane edge.
 *
 * Which items appear depends on what was right-clicked: node commands
 * (icon, duplicate, group, lock, requirements, stacking) only when the
 * targets include nodes, and the extra commands only when App supplies
 * `contextActions`.
 */
type CanvasContextMenuState = ReturnType<typeof useCanvasContextMenu>;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const ALT = IS_MAC ? '⌥' : 'Alt+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

export function CanvasContextMenu({
  contextMenu,
  activeSubmenu,
  setActiveSubmenu,
  closeContextMenu,
  onZOrderCommand,
                                      contextActions,
                                      nodes,
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
    contextActions?: CanvasContextActions;
    /** The nodes at this level - for what the targets currently are
     * (locked? boundaries? do they have icons?). */
    nodes: Node<ArchNodeData>[];
  }) {
    const {targetIds, targetEdgeIds} = contextMenu;
    const targetNodes = nodes.filter((n) => targetIds.includes(n.id));
    const hasNodes = targetNodes.length > 0;
    const anyHasIcon = targetNodes.some(nodeHasIcon);
    const allLocked = hasNodes && targetNodes.every((n) => n.data.locked === true);
    const groupIds = targetNodes.filter((n) => n.type === 'group').map((n) => n.id);
    const ungroupableIds = targetNodes
        .filter((n) => n.type === 'group' && !n.data.locked)
        .map((n) => n.id);

    // The first position is a guess (CONTEXT_MENU_HEIGHT); once the menu
    // exists, move it up if its real height runs off the bottom.
    const menuRef = useRef<HTMLDivElement>(null);
    const [top, setTop] = useState(contextMenu.y);
    useLayoutEffect(() => {
        const height = menuRef.current?.getBoundingClientRect().height ?? 0;
        const fitted = Math.max(8, Math.min(contextMenu.y, window.innerHeight - height - 8));
        setTop(fitted);
    }, [contextMenu.y, hasNodes, contextActions]);

    /** A plain command: closes the submenus while hovered, and the menu once run. */
    const command = (
        label: string,
        icon: ReactNode,
        run: () => void,
        options: { shortcut?: string; disabled?: boolean; title?: string } = {},
    ) => (
        <button
            type="button"
            role="menuitem"
            disabled={options.disabled}
            title={options.title}
            onMouseEnter={() => setActiveSubmenu(null)}
            onClick={() => {
                run();
                closeContextMenu();
            }}
        >
            {icon}
            <span>{label}</span>
            {options.shortcut && <kbd className="canvas-context-menu__shortcut">{options.shortcut}</kbd>}
        </button>
    );

    const submenu = (id: NonNullable<typeof activeSubmenu>, label: string, icon: ReactNode) => (
        <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={activeSubmenu === id}
            className={activeSubmenu === id ? 'is-active' : undefined}
            onClick={() => setActiveSubmenu((prev) => (prev === id ? null : id))}
            onMouseEnter={() => setActiveSubmenu(id)}
        >
            {icon}
            <span>{label}</span>
            <ChevronRight size={13} style={{marginLeft: 'auto', opacity: 0.6}}/>
        </button>
    );

    // Submenus open beside the menu, on whichever side has room.
    const besideMenu = (panelWidth: number, panelHeight: number) => ({
        position: 'fixed' as const,
        top: Math.min(Math.max(8, top), window.innerHeight - panelHeight - 8),
        left:
            contextMenu.x + CONTEXT_MENU_WIDTH + panelWidth <= window.innerWidth - 8
                ? contextMenu.x + CONTEXT_MENU_WIDTH + 4
                : Math.max(8, contextMenu.x - panelWidth - 4),
    });

    const copiedStyle = contextActions?.copiedStyle ?? null;

    return createPortal(
        <>
            <div
                ref={menuRef}
                className="canvas-context-menu"
                style={{
                    position: 'fixed',
                    top,
                    left: contextMenu.x,
                    width: CONTEXT_MENU_WIDTH,
                }}
                role="menu"
                onClick={(e) => e.stopPropagation()}
            >
                {submenu('color', 'Change color', <Palette size={13}/>)}
                {anyHasIcon && submenu('icon', 'Change icon', <Sparkles size={13}/>)}

                {contextActions &&
                    targetNodes.length > 1 &&
                    submenu('arrange', 'Align & distribute', <LayoutGrid size={13}/>)}

                {contextActions && hasNodes && (
                    <>
                        <div className="canvas-context-menu__divider"/>
                        {command('Duplicate', <Copy size={13}/>, () => contextActions.onDuplicate(targetIds), {
                            shortcut: `${MOD}D`,
                        })}
                        {contextActions.onSaveFragment &&
                            submenu('fragment', 'Save as fragment', <PackagePlus size={13}/>)}
                        {command('Group', <Group size={13}/>, () => contextActions.onGroup(targetIds), {
                            shortcut: `${MOD}G`,
                        })}
                        {groupIds.length > 0 &&
                            command(
                                'Ungroup',
                                <Ungroup size={13}/>,
                                () => contextActions.onUngroup(ungroupableIds),
                                {
                                    shortcut: `${SHIFT}${MOD}G`,
                                    disabled: ungroupableIds.length === 0,
                                    title: ungroupableIds.length === 0 ? 'Unlock the boundary first' : undefined,
                                },
                            )}
                        {allLocked
                            ? command('Unlock', <LockOpen size={13}/>, () =>
                                contextActions.onSetLocked(targetIds, false),
                            )
                            : command('Lock', <Lock size={13}/>, () =>
                                contextActions.onSetLocked(targetIds, true),
                            )}
                    </>
                )}

                {contextActions && (
                    <>
                        <div className="canvas-context-menu__divider"/>
                        {command(
                            'Copy style',
                            <Paintbrush size={13}/>,
                            () => contextActions.onCopyStyle(targetIds, targetEdgeIds),
                            {shortcut: `${ALT}${MOD}C`},
                        )}
                        {command(
                            'Paste style',
                            <ClipboardPaste size={13}/>,
                            () => contextActions.onPasteStyle(targetIds, targetEdgeIds),
                            {
                                shortcut: `${ALT}${MOD}V`,
                                disabled: !copiedStyle,
                                title: copiedStyle ? `Applies ${describeStyle(copiedStyle)}` : 'Copy a style first',
                            },
                        )}
                        {hasNodes && submenu('requirements', 'Link requirement', <Link2 size={13}/>)}
                    </>
                )}

                {hasNodes && (
                    <>
                        <div className="canvas-context-menu__divider"/>
                        {command('Bring to front', <BringToFront size={13}/>, () =>
                            onZOrderCommand('front', targetIds),
                        )}
                        {command('Bring forward', <ChevronUp size={13}/>, () =>
                            onZOrderCommand('forward', targetIds),
                        )}
                        {command('Send backward', <ChevronDown size={13}/>, () =>
                            onZOrderCommand('backward', targetIds),
                        )}
                        {command('Send to back', <SendToBack size={13}/>, () =>
                            onZOrderCommand('back', targetIds),
                        )}
                    </>
                )}
      </div>

      {activeSubmenu === 'color' && (
        <ColorPickerPanel
          value={targetCurrentColor}
          defaultValue={targetDefaultColor}
          onChange={handleColorChange}
          onClose={closeContextMenu}
          style={besideMenu(176, 220)}
        />
      )}

      {activeSubmenu === 'icon' && (
        <IconPickerPanel
          value={targetCurrentIcon}
          defaultValue={targetDefaultIcon}
          onChange={handleIconChange}
          onClose={closeContextMenu}
          style={{...besideMenu(340, 420), zIndex: 301}}
        />
      )}

            {activeSubmenu === 'arrange' && contextActions && (
                <div
                    className="arrange-panel"
                    role="dialog"
                    aria-label="Align and distribute"
                    style={besideMenu(240, 132)}
                    onClick={(e) => e.stopPropagation()}
                >
                    <ArrangeControls
                        canRun={(cmd) => canArrange(cmd, targetIds, nodes)}
                        onRun={(cmd) => {
                            contextActions.onArrange(cmd, targetIds);
                            closeContextMenu();
                        }}
                    />
                </div>
            )}

            {activeSubmenu === 'fragment' && contextActions?.onSaveFragment && (
                <SaveFragmentPanel
                    defaultName={targetNodes.length === 1 ? String(targetNodes[0].data.label ?? '') : ''}
                    nodeCount={targetNodes.length}
                    onSave={(name) => {
                        contextActions.onSaveFragment?.(targetIds, name);
                        closeContextMenu();
                    }}
                    onClose={closeContextMenu}
                    style={besideMenu(260, 190)}
                />
            )}

            {activeSubmenu === 'requirements' && contextActions && (
                <RequirementLinkPanel
                    nodes={targetNodes}
                    requirements={contextActions.requirements}
                    onUpdateNodes={contextActions.onUpdateNodes}
                    style={besideMenu(280, 340)}
        />
      )}
    </>,
    document.body,
  );
}
