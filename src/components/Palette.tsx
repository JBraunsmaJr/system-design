import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Boxes,
  Cloud,
  Shapes,
  Code2,
  GitBranch,
  ChevronDown,
  Check,
  type LucideIcon,
} from 'lucide-react';
import {
  NODE_TYPES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  CLOUD_SUBCATEGORY_ORDER,
  LOGIC_SUBCATEGORY_ORDER,
  VCS_SUBCATEGORY_ORDER,
} from '../domain/nodeRegistry';
import { GROUP_TYPES } from '../domain/groupRegistry';
import { globalShapeRegistry, getShapePaletteIcon } from '../domain/shapeRegistry';
import { IconRenderer } from './IconRenderer';
import type { NodeCategory, NodeTypeDefinition } from '../domain/types';

const SYSTEM_CATEGORIES: NodeCategory[] = [
  'compute',
  'data',
  'networking',
  'messaging',
  'external',
  'observability',
  'cloud',
];

export const DRAG_MIME_TYPE = 'application/x-archnode';
export const GROUP_DRAG_MIME_TYPE = 'application/x-archgroup';
export const TEXT_DRAG_MIME_TYPE = 'application/x-archtext';
export const SHAPE_DRAG_MIME_TYPE = 'application/x-archshape';
export const CODE_DRAG_MIME_TYPE = 'application/x-archcode';

type PaletteMode = 'system' | 'cloud' | 'shapes' | 'code' | 'git';

const PALETTE_TABS: { id: PaletteMode; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: 'System', icon: Boxes },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'git', label: 'Git', icon: GitBranch },
];

const MODE_HINTS: Record<PaletteMode, string | null> = {
  system: null,
  cloud: 'Preset services and infrastructure components for AWS, Azure, and Google Cloud Platform.',
  shapes:
    'Diagram shapes, flowchart symbols, infrastructure components, and imported custom libraries.',
  code: "Endpoints and pseudo-code steps for modeling request-handling logic - most useful inside a node's sub-diagram (double-click a node to drill in).",
  git: "Branching strategy and release/CI pipeline concepts - handy for a repo's own sub-diagram, or a standalone diagram of your workflow.",
};

export function Palette() {
  const [mode, setMode] = useState<PaletteMode>('system');
  const [, setVersion] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number>(220);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return globalShapeRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setDropdownWidth(rect.width);
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();

    const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - dropdownRect.width - 8));
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const top =
      spaceBelow >= dropdownRect.height + 4 || spaceBelow >= spaceAbove
        ? triggerRect.bottom + 4
        : Math.max(8, triggerRect.top - dropdownRect.height - 4);

    setDropdownPos((prev) =>
      prev && prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [isOpen]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();

    const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - dropdownRect.width - 8));
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const top =
      spaceBelow >= dropdownRect.height + 4 || spaceBelow >= spaceAbove
        ? triggerRect.bottom + 4
        : Math.max(8, triggerRect.top - dropdownRect.height - 4);

    setDropdownPos({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen, reposition]);

  const shapeCategories = globalShapeRegistry.getCategories();
  const currentTab = PALETTE_TABS.find((t) => t.id === mode) || PALETTE_TABS[0];
  const CurrentIcon = currentTab.icon;

  return (
    <aside className="palette">
      <div className="palette__mode-selector">
        <button
          ref={triggerRef}
          type="button"
          className={`palette__mode-trigger${isOpen ? ' is-open' : ''}`}
          onClick={() => (isOpen ? close() : open())}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label="Select shape category"
        >
          <div className="palette__mode-trigger-content">
            <CurrentIcon size={14} className="palette__tab-icon" />
            <span className="palette__mode-trigger-label">{currentTab.label}</span>
          </div>
          <ChevronDown size={14} className="palette__mode-trigger-chevron" />
        </button>

        {isOpen &&
          dropdownPos &&
          createPortal(
            <div
              ref={dropdownRef}
              className="palette__mode-dropdown"
              role="listbox"
              aria-label="Shape category options"
              style={{
                position: 'fixed',
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownWidth,
              }}
            >
              {PALETTE_TABS.map(({ id, label, icon: Icon }) => {
                const isSelected = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`palette__mode-option${isSelected ? ' is-selected' : ''}`}
                    onClick={() => {
                      setMode(id);
                      close();
                    }}
                  >
                    <div className="palette__mode-option-content">
                      <Icon size={14} className="palette__tab-icon" />
                      <span>{label}</span>
                    </div>
                    {isSelected && <Check size={14} className="palette__mode-option-check" />}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </div>

      <div className="palette__list">
        {MODE_HINTS[mode] && <p className="palette__mode-hint">{MODE_HINTS[mode]}</p>}

        {mode === 'system' && (
          <>
            {SYSTEM_CATEGORIES.map((category) => (
              <PaletteGroup
                key={category}
                label={CATEGORY_LABELS[category]}
                color={CATEGORY_COLORS[category]}
                dragMimeType={DRAG_MIME_TYPE}
                items={NODE_TYPES.filter((n) => n.category === category)}
              />
            ))}

            <PaletteGroup
              label="Custom"
              color={CATEGORY_COLORS.custom}
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter((n) => n.category === 'custom')}
            />

            <PaletteGroup
              label="Boundaries"
              color="#8b90a0"
              dragMimeType={GROUP_DRAG_MIME_TYPE}
              items={GROUP_TYPES.map((g) => ({
                id: g.id,
                label: g.label,
                icon: g.icon,
                color: g.color,
              }))}
            />

            <PaletteGroup
              label="General Shapes"
              color="#8b90a0"
              dragMimeType={SHAPE_DRAG_MIME_TYPE}
              items={globalShapeRegistry.getShapesByCategory('General').map((s) => ({
                id: s.id,
                label: s.name,
                icon: getShapePaletteIcon(s.id, s.iconId),
                color: s.defaults.color || '#5B7CFA',
              }))}
            />
          </>
        )}

        {mode === 'cloud' &&
          CLOUD_SUBCATEGORY_ORDER.map((subcategory) => (
            <PaletteGroup
              key={subcategory}
              label={subcategory}
              color={
                subcategory === 'AWS'
                  ? '#FF9900'
                  : subcategory === 'Azure'
                    ? '#0089D6'
                    : '#4285F4'
              }
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter(
                (n) => n.category === 'cloud' && n.subcategory === subcategory,
              )}
            />
          ))}

        {mode === 'shapes' && (
          <>
            {shapeCategories.map((category) => {
              const shapes = globalShapeRegistry.getShapesByCategory(category);
              return (
                <PaletteGroup
                  key={category}
                  label={category}
                  color="#5B7CFA"
                  dragMimeType={SHAPE_DRAG_MIME_TYPE}
                  items={shapes.map((s) => ({
                    id: s.id,
                    label: s.name,
                    icon: getShapePaletteIcon(s.id, s.iconId),
                    color: s.defaults.color || '#5B7CFA',
                  }))}
                />
              );
            })}
          </>
        )}

        {mode === 'code' &&
          LOGIC_SUBCATEGORY_ORDER.map((subcategory) => (
            <PaletteGroup
              key={subcategory}
              label={subcategory}
              color="#8b90a0"
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter(
                (n) => n.category === 'logic' && n.subcategory === subcategory,
              )}
            />
          ))}

        {mode === 'git' &&
          VCS_SUBCATEGORY_ORDER.map((subcategory) => (
            <PaletteGroup
              key={subcategory}
              label={subcategory}
              color="#8b90a0"
              dragMimeType={DRAG_MIME_TYPE}
              items={NODE_TYPES.filter(
                (n) => n.category === 'vcs' && n.subcategory === subcategory,
              )}
            />
          ))}

        <PaletteGroup
          label="Code"
          color="#22B8CF"
          dragMimeType={CODE_DRAG_MIME_TYPE}
          items={[{ id: 'code', label: 'Code Snippet', icon: 'FileCode2', color: '#22B8CF' }]}
        />

        <PaletteGroup
          label="Annotations"
          color="#8b90a0"
          dragMimeType={TEXT_DRAG_MIME_TYPE}
          items={[{ id: 'text', label: 'Text', icon: 'Type', color: '#8b90a0' }]}
        />
      </div>
      <p className="palette__hint">
        Drag a component onto the canvas to place it. Drag a boundary over existing nodes (or nodes
        into a boundary) to group them - drag either back out to release.
      </p>
    </aside>
  );
}

interface PaletteGroupProps {
  label: string;
  color: string;
  items: Pick<NodeTypeDefinition, 'id' | 'label' | 'icon' | 'color'>[];
  dragMimeType: string;
}

function PaletteGroup({ label, color, items, dragMimeType }: PaletteGroupProps) {
  if (!items.length) return null;

  const onDragStart = (event: DragEvent, itemId: string) => {
    event.dataTransfer.setData(dragMimeType, itemId);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="palette__group">
      <div className="palette__group-label" style={{ color }}>
        {label}
      </div>
      {items.map((item) => {
        return (
          <div
            key={item.id}
            className="palette__item"
            draggable
            onDragStart={(event) => onDragStart(event, item.id)}
          >
            <IconRenderer icon={item.icon} size={15} style={{ color: item.color }} />
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
