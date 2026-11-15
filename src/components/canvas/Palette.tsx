import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Boxes,
  Cloud,
  Code2,
  GitBranch,
  type LucideIcon,
  Package,
  Search,
  Shapes,
  Trash2,
  X,
} from 'lucide-react';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CLOUD_SUBCATEGORY_ORDER,
  LOGIC_SUBCATEGORY_ORDER,
  NODE_TYPES,
  VCS_SUBCATEGORY_ORDER,
} from '../../domain/canvas/nodeRegistry';
import { GROUP_TYPES } from '../../domain/canvas/groupRegistry';
import { getShapePaletteIcon, globalShapeRegistry } from '../../domain/canvas/shapeRegistry';
import { IconRenderer } from './IconRenderer';
import {
  deleteFragment,
  type DiagramFragment,
  fragmentNodeCount,
  FRAGMENTS_STORAGE_KEY,
  listFragments,
  reloadFragments,
  renameFragment,
  subscribeToFragments,
} from '../../domain/canvas/diagramFragments';
import type { NodeCategory, NodeTypeDefinition } from '../../domain/canvas/types';
import {
  loadRecentPaletteKeys,
  type PaletteEntry,
  paletteEntryKey,
  saveRecentPaletteKeys,
  searchPalette,
  withRecentPaletteKey,
} from '../../domain/canvas/paletteSearch';
import { requestPaletteAdd } from '../../domain/canvas/paletteAddRequests';

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
export const FRAGMENT_DRAG_MIME_TYPE = 'application/x-archfragment';

type PaletteMode = 'system' | 'cloud' | 'shapes' | 'code' | 'git' | 'fragments';

const PALETTE_TABS: { id: PaletteMode; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: 'System', icon: Boxes },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'fragments', label: 'Fragments', icon: Package },
];

const MODE_HINTS: Record<PaletteMode, string | null> = {
  system: null,
  cloud: 'Preset services and infrastructure components for AWS, Azure, and Google Cloud Platform.',
  shapes:
    'Diagram shapes, flowchart symbols, infrastructure components, and imported custom libraries.',
  code: "Endpoints and pseudo-code steps for modeling request-handling logic - most useful inside a node's sub-diagram (double-click a node to drill in).",
  git: "Branching strategy and release/CI pipeline concepts - handy for a repo's own sub-diagram, or a standalone diagram of your workflow.",
  fragments:
    'Groups of nodes you saved for reuse. Drag one onto any diagram - its connections and sub-diagrams come with it. Saved in this browser, shared by every document.',
};

const NO_FRAGMENTS: DiagramFragment[] = [];

const CODE_SNIPPET_ITEM = {
  id: 'code',
  label: 'Code Snippet',
  icon: 'FileCode2',
  color: '#22B8CF',
};
const TEXT_ITEM = { id: 'text', label: 'Text', icon: 'Type', color: '#8b90a0' };

/**
 * Everything the palette can drop, from every mode, in the order the modes
 * list it - what the search box looks through and what "Recently used" is
 * resolved against. Built on demand rather than at module load because
 * shapes (imported libraries) and fragments change while the app runs.
 */
function buildPaletteEntries(fragments: DiagramFragment[]): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  const add = (
    mimeType: string,
    group: string,
    item: { id: string; label: string; icon?: string; color: string },
  ) =>
    entries.push({
      key: paletteEntryKey(mimeType, item.id),
      id: item.id,
      label: item.label,
      icon: item.icon,
      color: item.color,
      mimeType,
      group,
    });
  for (const node of NODE_TYPES) {
    add(DRAG_MIME_TYPE, node.subcategory ?? CATEGORY_LABELS[node.category], node);
  }
  for (const group of GROUP_TYPES) add(GROUP_DRAG_MIME_TYPE, 'Boundaries', group);
  for (const category of globalShapeRegistry.getCategories()) {
    for (const shape of globalShapeRegistry.getShapesByCategory(category)) {
      add(SHAPE_DRAG_MIME_TYPE, category, {
        id: shape.id,
        label: shape.name,
        icon: getShapePaletteIcon(shape.id, shape.iconId),
        color: shape.defaults.color || '#5B7CFA',
      });
    }
  }
  add(CODE_DRAG_MIME_TYPE, 'Code', CODE_SNIPPET_ITEM);
  add(TEXT_DRAG_MIME_TYPE, 'Annotations', TEXT_ITEM);
  for (const fragment of fragments) {
    add(FRAGMENT_DRAG_MIME_TYPE, 'Fragments', {
      id: fragment.id,
      label: fragment.name,
      icon: 'Package',
      color: '#5B7CFA',
    });
  }
  return entries;
}

/** Whether a key press belongs to something being typed into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

interface PaletteProps {
  /** Folded down to its rail. Left out, the palette manages this itself. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * The left sidebar of the diagram: a narrow rail that is always there - a
 * search button and one button per palette - and, beside it, the open
 * palette's list. Clicking the open palette's button folds the list away,
 * so the canvas gets the width back without losing the way in.
 */
export function Palette({ collapsed: collapsedProp, onCollapsedChange }: PaletteProps) {
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const collapsed = collapsedProp ?? ownCollapsed;
  const setCollapsed = useCallback(
    (next: boolean) => {
      setOwnCollapsed(next);
      onCollapsedChange?.(next);
    },
    [onCollapsedChange],
  );
  const [mode, setMode] = useState<PaletteMode>('system');
  const [shapesVersion, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [recentKeys, setRecentKeys] = useState(loadRecentPaletteKeys);
  const searchRef = useRef<HTMLInputElement>(null);
  // Set when the search box should take focus as soon as it exists - it
  // isn't rendered while the palette is folded.
  const [focusSearchWhenOpen, setFocusSearchWhenOpen] = useState(false);

  useEffect(() => {
    return globalShapeRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  const fragments = useSyncExternalStore(subscribeToFragments, listFragments, () => NO_FRAGMENTS);
  // Fragments saved in another tab show up here without a reload.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === FRAGMENTS_STORAGE_KEY || event.key === null) reloadFragments();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const focusSearch = useCallback(() => {
    setCollapsed(false);
    setFocusSearchWhenOpen(true);
  }, [setCollapsed]);
  useEffect(() => {
    if (!focusSearchWhenOpen || collapsed) return;
    searchRef.current?.focus();
    searchRef.current?.select();
    // Focus is outside React; the flag only says the request was served.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusSearchWhenOpen(false);
  }, [focusSearchWhenOpen, collapsed]);

  // "/" jumps to the search box from anywhere that isn't a text field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusSearch]);

  const entries = useMemo(
    () => buildPaletteEntries(fragments),
    // shapesVersion stands for the shape registry's contents, which the
    // subscription above bumps it for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fragments, shapesVersion],
  );
  const trimmedQuery = query.trim();
  const results = useMemo(() => searchPalette(entries, trimmedQuery), [entries, trimmedQuery]);
  const recentEntries = useMemo(() => {
    const byKey = new Map(entries.map((e) => [e.key, e]));
    return recentKeys.map((k) => byKey.get(k)).filter((e): e is PaletteEntry => Boolean(e));
  }, [entries, recentKeys]);

  /** Called when a drag from the palette ended in a drop somewhere. */
  const onUsed = useCallback((key: string) => {
    setRecentKeys((prev) => {
      const next = withRecentPaletteKey(prev, key);
      saveRecentPaletteKeys(next);
      return next;
    });
  }, []);

  const shapeCategories = globalShapeRegistry.getCategories();
  const currentTab = PALETTE_TABS.find((t) => t.id === mode) || PALETTE_TABS[0];

  const onRailMode = (id: PaletteMode) => {
    // The open palette's own button folds it; any other button opens that
    // palette, clearing a search that would otherwise hide it.
    if (!collapsed && mode === id && !trimmedQuery) {
      setCollapsed(true);
      return;
    }
    setMode(id);
    setQuery('');
    setCollapsed(false);
  };

  return (
    <aside className={`palette-shell${collapsed ? ' is-collapsed' : ''}`}>
      <nav className="palette-rail" aria-label="Palettes">
        <button
          type="button"
          className="palette-rail__button palette-rail__button--search"
          onClick={focusSearch}
          title="Find a component ( / )"
          aria-label="Find a component"
        >
          <Search size={16} />
        </button>
        {PALETTE_TABS.map(({ id, label, icon: Icon }) => {
          const isCurrent = !collapsed && mode === id && !trimmedQuery;
          return (
            <button
              key={id}
              type="button"
              className={`palette-rail__button${isCurrent ? ' is-active' : ''}`}
              aria-pressed={isCurrent}
              onClick={() => onRailMode(id)}
              title={isCurrent ? `${label} - click to hide the palette` : label}
              aria-label={label}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="palette">
          <div className="palette__title">{trimmedQuery ? 'Search' : currentTab.label}</div>

          <div className="palette__search">
            <Search size={13} className="palette__search-icon" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              className="palette__search-input"
              placeholder="Find a component"
              aria-label="Find a component in every palette"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                } else if (e.key === 'Enter' && results.length > 0) {
                  // Enter adds the best match to the middle of the canvas.
                  const top = results[0];
                  if (requestPaletteAdd({ mimeType: top.mimeType, id: top.id })) onUsed(top.key);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="palette__search-clear"
                aria-label="Clear the search"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X size={12} />
              </button>
            ) : (
              <kbd className="palette__search-key" aria-hidden>
                /
              </kbd>
            )}
          </div>

          {trimmedQuery ? (
            <div
              className="palette__list"
              role="region"
              aria-label="Search results"
              aria-live="polite"
            >
              {results.length === 0 ? (
                <p className="palette__empty">Nothing in any palette matches "{trimmedQuery}".</p>
              ) : (
                <div className="palette__group">
                  <div className="palette__group-label" style={{ color: '#8b90a0' }}>
                    {results.length} {results.length === 1 ? 'match' : 'matches'}
                  </div>
                  {results.map((entry, index) => (
                    <PaletteRow
                      key={entry.key}
                      entry={entry}
                      showGroup
                      onUsed={onUsed}
                      isTopResult={index === 0}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="palette__list">
              {recentEntries.length > 0 && (
                <div className="palette__group palette__group--recent">
                  <div className="palette__group-label" style={{ color: '#8b90a0' }}>
                    Recently used
                  </div>
                  {recentEntries.map((entry) => (
                    <PaletteRow key={entry.key} entry={entry} showGroup onUsed={onUsed} />
                  ))}
                </div>
              )}

              {MODE_HINTS[mode] && <p className="palette__mode-hint">{MODE_HINTS[mode]}</p>}

              {mode === 'system' && (
                <>
                  {SYSTEM_CATEGORIES.map((category) => (
                    <PaletteGroup
                      onUsed={onUsed}
                      key={category}
                      label={CATEGORY_LABELS[category]}
                      color={CATEGORY_COLORS[category]}
                      dragMimeType={DRAG_MIME_TYPE}
                      items={NODE_TYPES.filter((n) => n.category === category)}
                    />
                  ))}

                  <PaletteGroup
                    onUsed={onUsed}
                    label="Custom"
                    color={CATEGORY_COLORS.custom}
                    dragMimeType={DRAG_MIME_TYPE}
                    items={NODE_TYPES.filter((n) => n.category === 'custom')}
                  />

                  <PaletteGroup
                    onUsed={onUsed}
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
                    onUsed={onUsed}
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
                    onUsed={onUsed}
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
                        onUsed={onUsed}
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
                    onUsed={onUsed}
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
                    onUsed={onUsed}
                    key={subcategory}
                    label={subcategory}
                    color="#8b90a0"
                    dragMimeType={DRAG_MIME_TYPE}
                    items={NODE_TYPES.filter(
                      (n) => n.category === 'vcs' && n.subcategory === subcategory,
                    )}
                  />
                ))}

              {mode === 'fragments' && <FragmentList fragments={fragments} />}

              <PaletteGroup
                onUsed={onUsed}
                label="Code"
                color="#22B8CF"
                dragMimeType={CODE_DRAG_MIME_TYPE}
                items={[CODE_SNIPPET_ITEM]}
              />

              <PaletteGroup
                onUsed={onUsed}
                label="Annotations"
                color="#8b90a0"
                dragMimeType={TEXT_DRAG_MIME_TYPE}
                items={[TEXT_ITEM]}
              />
            </div>
          )}
          <p className="palette__hint">
            {trimmedQuery
              ? 'Press Enter to add the first match to the middle of the canvas, or drag any match where you want it.'
              : 'Drag a component onto the canvas to place it. Drag a boundary over existing nodes (or nodes into a boundary) to group them - drag either back out to release.'}
          </p>
        </div>
      )}
    </aside>
  );
}

interface PaletteGroupProps {
  label: string;
  color: string;
  items: Pick<NodeTypeDefinition, 'id' | 'label' | 'icon' | 'color'>[];
  dragMimeType: string;
  onUsed: (key: string) => void;
}

/** One draggable line. `showGroup` adds where the entry is filed, for the
 * lists that mix modes (search results, recently used). */
function PaletteRow({
  entry,
  showGroup = false,
  onUsed,
  isTopResult = false,
}: {
  entry: Pick<PaletteEntry, 'key' | 'id' | 'label' | 'icon' | 'color' | 'mimeType'> & {
    group?: string;
  };
  showGroup?: boolean;
  onUsed: (key: string) => void;
  /** The match Enter would add. */
  isTopResult?: boolean;
}) {
  return (
    <div
      className={`palette__item${isTopResult ? ' is-top-result' : ''}`}
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(entry.mimeType, entry.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      // dropEffect is "none" when the drag was cancelled or let go
      // somewhere that doesn't take it.
      onDragEnd={(event: DragEvent) => {
        if (event.dataTransfer.dropEffect !== 'none') onUsed(entry.key);
      }}
    >
      <IconRenderer icon={entry.icon} size={15} style={{ color: entry.color }} />
      <span className="palette__item-label">{entry.label}</span>
      {showGroup && entry.group && <span className="palette__item-group">{entry.group}</span>}
    </div>
  );
}

function PaletteGroup({ label, color, items, dragMimeType, onUsed }: PaletteGroupProps) {
  if (!items.length) return null;

  return (
    <div className="palette__group">
      <div className="palette__group-label" style={{ color }}>
        {label}
      </div>
      {items.map((item) => (
        <PaletteRow
          key={item.id}
          entry={{ ...item, key: paletteEntryKey(dragMimeType, item.id), mimeType: dragMimeType }}
          onUsed={onUsed}
        />
      ))}
    </div>
  );
}

/**
 * The Fragments tab: each saved fragment is draggable onto the canvas like
 * any palette item, and can be renamed (double-click its name) or deleted
 * (click the bin, then confirm).
 */
function FragmentList({ fragments }: { fragments: DiagramFragment[] }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (fragments.length === 0) {
    return (
      <div className="palette__group">
        <div className="palette__group-label" style={{ color: '#8b90a0' }}>
          Saved fragments
        </div>
        <p className="palette__empty">
          None yet. Select some nodes, right-click and choose <strong>Save as fragment</strong>.
        </p>
      </div>
    );
  }

  const commitRename = (id: string) => {
    renameFragment(id, draftName);
    setRenamingId(null);
  };

  return (
    <div className="palette__group">
      <div className="palette__group-label" style={{ color: '#8b90a0' }}>
        Saved fragments
      </div>
      {fragments.map((fragment) => {
        const count = fragmentNodeCount(fragment);
        const isRenaming = renamingId === fragment.id;
        const isConfirming = confirmDeleteId === fragment.id;
        return (
          <div
            key={fragment.id}
            className="palette__item palette__item--fragment"
            draggable={!isRenaming}
            onDragStart={(event) => {
              event.dataTransfer.setData(FRAGMENT_DRAG_MIME_TYPE, fragment.id);
              // Matches the canvas's dragover dropEffect ('move'), or the browser
              // refuses the drop.
              event.dataTransfer.effectAllowed = 'move';
            }}
            title={`${fragment.name} - ${count} ${count === 1 ? 'element' : 'elements'}. Drag onto the canvas to insert; double-click the name to rename.`}
          >
            <Package size={15} style={{ color: '#5B7CFA', flexShrink: 0 }} />
            {isRenaming ? (
              <input
                className="palette__fragment-rename"
                autoFocus
                value={draftName}
                aria-label="Fragment name"
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(fragment.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(fragment.id);
                  else if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <span
                className="palette__fragment-name"
                onDoubleClick={() => {
                  setDraftName(fragment.name);
                  setRenamingId(fragment.id);
                  setConfirmDeleteId(null);
                }}
              >
                {fragment.name}
              </span>
            )}
            <span className="palette__fragment-count">{count}</span>
            <button
              type="button"
              className={`palette__fragment-delete${isConfirming ? ' is-confirming' : ''}`}
              onClick={() => {
                if (isConfirming) {
                  deleteFragment(fragment.id);
                  setConfirmDeleteId(null);
                } else {
                  setConfirmDeleteId(fragment.id);
                }
              }}
              onBlur={() => setConfirmDeleteId((cur) => (cur === fragment.id ? null : cur))}
              aria-label={
                isConfirming ? `Confirm deleting ${fragment.name}` : `Delete ${fragment.name}`
              }
              title={isConfirming ? 'Click again to delete' : 'Delete fragment'}
            >
              {isConfirming ? 'Delete?' : <Trash2 size={12} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
